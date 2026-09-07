import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// Run against an installed tarball, so workspace imports cannot hide packaging
// mistakes in the lazily loaded MCP entry point.
const executable = process.argv[2];
if (!executable) throw new Error('Supply the installed CLI executable');
const child = spawn(executable, ['mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OPEN_OCR_NO_CONFIG: '1', NODE_ENV: 'development' },
});
const pending = new Map();
let buffered = '';
let diagnostics = '';
let nextId = 0;
const exit = new Promise((resolve) => child.once('close', (code) => resolve(code)));
const fail = (error) => {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
};
child.once('error', fail);
child.once('close', () => fail(new Error(`MCP closed before replying: ${diagnostics}`)));
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffered += chunk;
  if (buffered.length > 1024 * 1024) {
    fail(new Error('MCP response exceeded smoke-test bound'));
    child.kill();
    return;
  }
  let newline;
  while ((newline = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      const waiting = pending.get(message.id);
      if (waiting) {
        pending.delete(message.id);
        waiting.resolve(message);
      }
    } catch (error) {
      fail(error);
      child.kill();
    }
  }
});
const deadline = setTimeout(() => {
  fail(new Error('MCP smoke timed out'));
  child.kill('SIGKILL');
}, 15000);

function request(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id, method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'open-ocr-smoke', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }) + '\n');
  return response;
}

try {
  const discovery = await request('server/discover');
  assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
  assert.equal(discovery.result.cacheScope, 'private');
  const catalog = await request('tools/list');
  assert.ok(catalog.result.tools.some((tool) => tool.name === 'ocr_extract'));
  const capabilities = await request('tools/call', { name: 'ocr_capabilities', arguments: {} });
  assert.equal(capabilities.result.structuredContent.capabilities.protocolVersion, 2);
  const invalid = await request('tools/call', {
    name: 'ocr_extract', arguments: { inputs: ['-'], dryRun: true },
  });
  assert.ok(invalid.error || invalid.result?.isError);
  child.stdin.end();
  assert.equal(await exit, 0);
  process.stdout.write('Packed MCP stdio smoke passed\n');
} finally {
  child.kill('SIGKILL');
  await exit;
  clearTimeout(deadline);
}
