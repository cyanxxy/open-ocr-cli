import { webcrypto } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgenticMcpRequest,
  buildExtractMcpRequest,
  buildWebMcpRequest,
  createOcrMcpServer,
  mcpResult,
} from './mcp';
import type { OcrMachineResult } from './protocol';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);

describe('Open OCR MCP server', () => {
  const closeCallbacks: Array<() => Promise<void>> = [];
  const cleanupPaths: string[] = [];

  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
    await Promise.all(cleanupPaths.splice(0).map(
      async (directory) => rm(directory, { recursive: true, force: true }),
    ));
    vi.unstubAllGlobals();
  });

  it('builds versioned requests through the shared semantic validator', () => {
    expect(buildExtractMcpRequest({
      inputs: ['invoice.pdf'],
      mode: 'template',
      preset: 'invoice',
      contentFormat: 'json',
    })).toMatchObject({
      protocolVersion: 2,
      inputs: [{ type: 'path', path: 'invoice.pdf' }],
      extraction: { mode: 'template', preset: 'invoice', contentFormat: 'json' },
      delivery: { mode: 'reference' },
    });
    expect(buildAgenticMcpRequest({
      inputs: ['dense-scan.png'],
      progress: 'detailed',
    })).toMatchObject({ extraction: { mode: 'agentic', progress: 'detailed' } });
    expect(buildWebMcpRequest({
      urls: ['https://example.com/report'],
      analysis: 'combined',
    })).toMatchObject({
      inputs: [{ type: 'url', url: 'https://example.com/report' }],
      web: { analysis: 'combined' },
    });
    expect(() => buildExtractMcpRequest({
      inputs: ['invoice.pdf'],
      mode: 'template',
    })).toThrow('extraction.preset');
  });

  it('rejects tool arguments the protocol forbids with a message an agent can act on', () => {
    // The tool takes delivery and outputDirectory as independent arguments, so
    // the conflict has to be named rather than left to the schema's `not`.
    expect(() => buildExtractMcpRequest({
      inputs: ['invoice.pdf'],
      delivery: 'inline',
      outputDirectory: 'out',
    })).toThrow(/delivery\.outputDirectory.*delivery\.mode inline/su);
    expect(() => buildAgenticMcpRequest({
      inputs: ['scan.png'],
      delivery: 'inline',
      resume: true,
    })).toThrow('delivery.resume');
    expect(buildExtractMcpRequest({
      inputs: ['invoice.pdf'],
      delivery: 'reference',
      outputDirectory: 'out',
    })).toMatchObject({ delivery: { mode: 'reference', outputDirectory: 'out' } });

    // csv from a preset that extracts one record per document can only fail
    // after the call is billed, so it is refused here.
    expect(() => buildExtractMcpRequest({
      inputs: ['card.png'],
      mode: 'template',
      preset: 'business-card',
      contentFormat: 'csv',
    })).toThrow('cannot produce CSV rows');
    expect(buildExtractMcpRequest({
      inputs: ['receipt.png'],
      mode: 'template',
      preset: 'receipt',
      contentFormat: 'csv',
    })).toMatchObject({ extraction: { preset: 'receipt', contentFormat: 'csv' } });
  });

  it('reports a partially failed run as a tool error', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'open-ocr-mcp-'));
    cleanupPaths.push(directory);
    await writeFile(path.join(directory, 'invoice.jpg'), JPEG_BYTES);
    await writeFile(path.join(directory, 'broken.png'), 'not an image');

    const server = createOcrMcpServer('2.6.0', directory);
    const client = new Client({ name: 'open-ocr-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    closeCallbacks.push(
      async () => client.close(),
      async () => server.close(),
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: 'ocr_extract',
      arguments: {
        inputs: ['invoice.jpg', 'broken.png'],
        outputDirectory: path.join(directory, 'out'),
        dryRun: true,
        noConfig: true,
      },
    });
    const structured = result.structuredContent as {
      ok: boolean;
      status: string;
      documents: Array<{ status: string }>;
    };

    // One document failed, so the caller did not get what it asked for. Keying
    // isError on the `failed` status alone left this call looking successful.
    expect(structured.status).toBe('partial');
    expect(structured.ok).toBe(false);
    expect(result.isError).toBe(true);
    expect(structured.documents.some((document) => document.status === 'failed')).toBe(true);
  });

  it('advertises tools and runs URL dry-runs without credentials or network access', async () => {
    const server = createOcrMcpServer('2.3.0', process.cwd());
    const client = new Client({ name: 'open-ocr-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    closeCallbacks.push(
      async () => client.close(),
      async () => server.close(),
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'ocr_extract',
      'ocr_run_agentic',
      'ocr_web',
    ]);
    const resources = await client.listResources();
    expect(resources.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: 'open-ocr://capabilities' }),
    ]));

    const progress: number[] = [];
    const result = await client.callTool({
      name: 'ocr_web',
      arguments: {
        urls: ['https://example.com/report'],
        dryRun: true,
        noConfig: true,
        delivery: 'inline',
      },
    }, {
      onprogress: (notification) => progress.push(notification.progress),
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      type: 'run.result',
      status: 'validated',
      total: 1,
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));

    const invalid = await client.callTool({
      name: 'ocr_extract',
      arguments: { inputs: ['invoice.pdf'], mode: 'template', dryRun: true },
    });
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: {
        status: 'failed',
        error: { code: 'CONFIG_INVALID' },
      },
    });
  });

  // A live run only reaches `partial` easily, so the remaining not-ok statuses
  // are pinned here. Enumerating statuses is what let the original bug survive:
  // `failed` was listed and the other three were not.
  describe('tool error reporting', () => {
    const resultWithStatus = (
      status: OcrMachineResult['status'],
      ok: boolean,
    ): OcrMachineResult => ({
      protocolVersion: 2,
      type: 'run.result',
      ok,
      runId: 'r1',
      status,
      documents: [],
    } as unknown as OcrMachineResult);

    it.each([
      ['partial', false],
      ['failed', false],
      ['cancelled', false],
      ['cost_limited', false],
    ] as const)('reports %s as a tool error', (status, ok) => {
      expect(mcpResult(resultWithStatus(status, ok)).isError).toBe(true);
    });

    it.each([
      ['succeeded', true],
      ['validated', true],
    ] as const)('does not report %s as a tool error', (status, ok) => {
      expect(mcpResult(resultWithStatus(status, ok)).isError).toBeUndefined();
    });

    it('never disagrees with the ok field it is derived from', () => {
      for (const ok of [true, false]) {
        const built = mcpResult(resultWithStatus('partial', ok));
        expect(built.isError === true).toBe(!ok);
        expect(built.structuredContent.ok).toBe(ok);
      }
    });
  });

  // Connecting an McpServer to a transport directly is always the 2025 era, so
  // none of the other tests reach the production entry point's era selection.
  // These drive `serveStdio` itself over a linked in-process transport pair.
  describe('serveStdio dual-era', () => {
    interface JsonRpcReply {
      id?: number;
      result?: Record<string, unknown>;
      error?: { code: number; message: string; data?: unknown };
    }

    const modernMeta = (
      capabilities: Record<string, unknown> = { elicitation: { form: {} } },
    ): Record<string, unknown> => ({
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': capabilities,
      'io.modelcontextprotocol/clientInfo': { name: 'open-ocr-test', version: '1.0.0' },
    });

    const driveServeStdio = async (cwd: string) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const handle = serveStdio(() => createOcrMcpServer('2.6.0', cwd), {
        transport: serverTransport,
        onerror: () => { /* asserted through replies, not side channels */ },
      });
      closeCallbacks.push(async () => handle.close());

      const waiters = new Map<number, (reply: JsonRpcReply) => void>();
      clientTransport.onmessage = (message) => {
        const reply = message as JsonRpcReply;
        if (reply.id === undefined) return;
        const waiter = waiters.get(reply.id);
        if (!waiter) return;
        waiters.delete(reply.id);
        waiter(reply);
      };
      await clientTransport.start();

      const request = async (
        id: number,
        method: string,
        params?: Record<string, unknown>,
      ): Promise<JsonRpcReply> => {
        const reply = new Promise<JsonRpcReply>((resolve) => waiters.set(id, resolve));
        await clientTransport.send(
          { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as never,
        );
        return reply;
      };
      const notify = async (method: string): Promise<void> => {
        await clientTransport.send({ jsonrpc: '2.0', method, params: {} } as never);
      };
      return { request, notify };
    };

    it('serves the 2026-07-28 era, with discovery and cache hints, to a modern opening', async () => {
      const { request } = await driveServeStdio(process.cwd());

      const discover = await request(1, 'server/discover', { _meta: modernMeta() });
      expect(discover.result).toMatchObject({
        supportedVersions: ['2026-07-28'],
        resultType: 'complete',
        ttlMs: 3_600_000,
        cacheScope: 'public',
      });

      const tools = await request(2, 'tools/list', { _meta: modernMeta() });
      expect(tools.result).toMatchObject({ ttlMs: 3_600_000, cacheScope: 'public' });
      const listed = tools.result?.tools as Array<{ name: string; outputSchema?: { type?: string } }>;
      expect(listed.map((tool) => tool.name)).toEqual(['ocr_extract', 'ocr_run_agentic', 'ocr_web']);
      // A non-object root would make the 2025-era codec wrap structuredContent.
      expect(listed.every((tool) => tool.outputSchema?.type === 'object')).toBe(true);

      const read = await request(3, 'resources/read', {
        uri: 'open-ocr://capabilities',
        _meta: modernMeta(),
      });
      expect(read.result).toMatchObject({ ttlMs: 3_600_000, cacheScope: 'public' });
    });

    it('still serves the 2025 era, unchanged and uncached, to a legacy opening', async () => {
      const { request, notify } = await driveServeStdio(process.cwd());

      const initialized = await request(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'open-ocr-test', version: '1.0.0' },
      });
      expect(initialized.result).toMatchObject({ protocolVersion: '2025-11-25' });
      await notify('notifications/initialized');

      const tools = await request(2, 'tools/list');
      // Cache fields and resultType are 2026-only; emitting them here would be
      // a wire change for every client in use today.
      expect(tools.result && 'ttlMs' in tools.result).toBe(false);
      expect(tools.result && 'resultType' in tools.result).toBe(false);

      const call = await request(3, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], dryRun: true, noConfig: true },
      });
      const structured = call.result?.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ type: 'run.result', status: 'validated' });
      expect(Object.hasOwn(structured, 'result')).toBe(false);
    });

    it('carries the confirmation through a modern multi-round-trip retry', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      for (const key of [
        'GEMINI_API_KEY', 'OPEN_OCR_API_KEY', 'MOONSHOT_API_KEY',
        'META_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_AI_GATEWAY_TOKEN',
      ]) vi.stubEnv(key, '');
      const { request } = await driveServeStdio(process.cwd());

      const asked = await request(1, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], noConfig: true },
        _meta: modernMeta(),
      });
      expect(asked.result?.resultType).toBe('input_required');
      const inputRequests = asked.result?.inputRequests as Record<string, { method: string }>;
      expect(Object.keys(inputRequests)).toEqual(['proceed']);
      expect(inputRequests.proceed.method).toBe('elicitation/create');

      // The retry is a NEW request id carrying the answer, per the MRTR rules.
      const retried = await request(2, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], noConfig: true },
        inputResponses: { proceed: { action: 'accept', content: { proceed: true } } },
        ...(asked.result?.requestState === undefined
          ? {}
          : { requestState: asked.result.requestState }),
        _meta: modernMeta(),
      });
      // Asked once, then ran: reaching the credential check proves the answer
      // was read on retry rather than the gate prompting again.
      expect(retried.result?.resultType).toBe('complete');
      expect(retried.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'AUTH_MISSING' },
      });
    });

    it('refuses a forged confirmation without request state', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const { request } = await driveServeStdio(process.cwd());

      const forged = await request(1, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], noConfig: true },
        inputResponses: { proceed: { action: 'accept', content: { proceed: true } } },
        _meta: modernMeta(),
      });
      expect(forged.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CANCELLED' },
      });
    });

    it('binds a confirmation to the exact request and consumes it once', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      for (const key of [
        'GEMINI_API_KEY', 'OPEN_OCR_API_KEY', 'MOONSHOT_API_KEY',
        'META_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_AI_GATEWAY_TOKEN',
      ]) vi.stubEnv(key, '');
      const { request } = await driveServeStdio(process.cwd());
      const args = { urls: ['https://example.com/report'], noConfig: true };

      const asked = await request(1, 'tools/call', {
        name: 'ocr_web',
        arguments: args,
        _meta: modernMeta(),
      });
      const answer = {
        proceed: { action: 'accept', content: { proceed: true } },
      };

      const changed = await request(2, 'tools/call', {
        name: 'ocr_web',
        arguments: { ...args, urls: ['https://example.com/other'] },
        inputResponses: answer,
        requestState: asked.result?.requestState,
        _meta: modernMeta(),
      });
      expect(changed.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CANCELLED' },
      });

      const accepted = await request(3, 'tools/call', {
        name: 'ocr_web',
        arguments: args,
        inputResponses: answer,
        requestState: asked.result?.requestState,
        _meta: modernMeta(),
      });
      expect(accepted.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'AUTH_MISSING' },
      });

      const replayed = await request(4, 'tools/call', {
        name: 'ocr_web',
        arguments: args,
        inputResponses: answer,
        requestState: asked.result?.requestState,
        _meta: modernMeta(),
      });
      expect(replayed.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CANCELLED' },
      });
    });

    it('refuses with a typed error when a modern client cannot be prompted', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const { request } = await driveServeStdio(process.cwd());

      // Capabilities live on the per-request envelope in this era; reading only
      // the session accessor here returned undefined and silently skipped the
      // gate, letting the SDK raise a bare -32021 instead.
      const refused = await request(1, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], noConfig: true },
        _meta: modernMeta({}),
      });
      expect(refused.error).toBeUndefined();
      expect(refused.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CONFIG_INVALID' },
      });
    });

    it('refuses with a typed error when a modern client supports URL elicitation only', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const { request } = await driveServeStdio(process.cwd());

      const refused = await request(1, 'tools/call', {
        name: 'ocr_web',
        arguments: { urls: ['https://example.com/report'], noConfig: true },
        _meta: modernMeta({ elicitation: { url: {} } }),
      });
      expect(refused.error).toBeUndefined();
      expect(refused.result?.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CONFIG_INVALID' },
      });
    });
  });

  describe('artifact resource links', () => {
    const resultWithArtifacts = (
      artifacts: Array<{ path: string; mediaType: string; kind: string }>,
      plannedArtifacts: Array<{ path: string; mediaType: string; kind: string }> = [],
    ): OcrMachineResult => ({
      protocolVersion: 2,
      type: 'run.result',
      ok: true,
      runId: 'r1',
      status: 'succeeded',
      documents: [{ source: 'invoice.pdf', artifacts, plannedArtifacts }],
    } as unknown as OcrMachineResult);

    it('links written artifacts as resolvable file URIs alongside the JSON body', () => {
      const built = mcpResult(resultWithArtifacts([
        { path: '/runs/r1/invoice.md', mediaType: 'text/markdown', kind: 'markdown' },
        { path: '/runs/r1/invoice.json', mediaType: 'application/json', kind: 'json' },
      ]));

      // The JSON envelope stays first and unchanged; links are additive.
      expect(built.content[0]).toMatchObject({ type: 'text' });
      expect(built.content.slice(1)).toEqual([
        {
          type: 'resource_link',
          uri: 'file:///runs/r1/invoice.md',
          name: 'invoice.md',
          mimeType: 'text/markdown',
          description: 'markdown output for invoice.pdf',
        },
        {
          type: 'resource_link',
          uri: 'file:///runs/r1/invoice.json',
          name: 'invoice.json',
          mimeType: 'application/json',
          description: 'json output for invoice.pdf',
        },
      ]);
    });

    it('never links planned artifacts, which name files a dry run did not write', () => {
      const built = mcpResult(resultWithArtifacts([], [
        { path: '/runs/r1/invoice.md', mediaType: 'text/markdown', kind: 'markdown' },
      ]));
      expect(built.content).toHaveLength(1);
      expect(built.content[0]).toMatchObject({ type: 'text' });
    });

    it('emits no links for a failure envelope, which carries no documents', () => {
      const built = mcpResult({
        protocolVersion: 2,
        type: 'run.result',
        ok: false,
        runId: 'r1',
        status: 'failed',
        error: { code: 'INTERNAL', category: 'internal', message: 'boom', retryable: false, hint: 'h' },
      } as unknown as OcrMachineResult);
      expect(built.content).toHaveLength(1);
    });
  });

  // The gate exists so a human can require confirmation before a billed run.
  // It is environment-controlled on purpose: a switch the model can flip by
  // omitting a tool argument would not be a safety gate.
  describe('confirmation gate', () => {
    const connect = async (
      directory: string,
      capabilities: Record<string, unknown> = { elicitation: {} },
    ) => {
      const server = createOcrMcpServer('2.6.0', directory);
      const client = new Client(
        { name: 'open-ocr-test', version: '1.0.0' },
        { capabilities },
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      closeCallbacks.push(async () => client.close(), async () => server.close());
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      return client;
    };

    const makeDirectory = async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'open-ocr-confirm-'));
      cleanupPaths.push(directory);
      await writeFile(path.join(directory, 'invoice.jpg'), JPEG_BYTES);
      return directory;
    };

    afterEach(() => { vi.unstubAllEnvs(); });

    it('does not prompt for a dry run, which neither bills nor writes', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const directory = await makeDirectory();
      const client = await connect(directory);
      let prompts = 0;
      client.setRequestHandler('elicitation/create', () => {
        prompts += 1;
        return Promise.resolve({ action: 'accept' as const, content: { proceed: true } });
      });

      await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], dryRun: true, noConfig: true },
      });
      expect(prompts).toBe(0);
    });

    it('refuses a legacy client that declared no elicitation capability', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const directory = await makeDirectory();
      const client = await connect(directory, {});

      const result = await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], noConfig: true },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CONFIG_INVALID' },
      });
    });

    it('refuses a legacy client that supports URL elicitation only', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const directory = await makeDirectory();
      const client = await connect(directory, { elicitation: { url: {} } });

      const result = await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], noConfig: true },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CONFIG_INVALID' },
      });
    });

    it('proceeds with the run once the prompt is accepted', async () => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      // Accepting proceeds into a real run, so credentials are cleared: the
      // assertion is about the gate and must never spend a developer's key.
      for (const key of [
        'GEMINI_API_KEY', 'OPEN_OCR_API_KEY', 'MOONSHOT_API_KEY',
        'META_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_AI_GATEWAY_TOKEN',
      ]) vi.stubEnv(key, '');

      const directory = await makeDirectory();
      const client = await connect(directory);
      let prompts = 0;
      client.setRequestHandler('elicitation/create', () => {
        prompts += 1;
        return Promise.resolve({ action: 'accept' as const, content: { proceed: true } });
      });

      const result = await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], noConfig: true },
      });
      // Asked exactly once, then reached the credential check — so the accepted
      // answer was read on re-entry rather than prompting again in a loop.
      expect(prompts).toBe(1);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'AUTH_MISSING' },
      });
    });

    // Anything short of an explicit `proceed: true` has to refuse. An accepted
    // form that omits the field, or carries it as false, is the case most
    // likely to be read as consent by mistake.
    it.each([
      ['declined', { action: 'decline' as const }],
      ['cancelled', { action: 'cancel' as const }],
      ['accepted with proceed false', { action: 'accept' as const, content: { proceed: false } }],
      ['accepted without the proceed field', { action: 'accept' as const, content: {} }],
      ['accepted with a non-boolean proceed', { action: 'accept' as const, content: { proceed: 'yes' } }],
    ])('refuses the run with a typed CANCELLED error when %s', async (_label, answer) => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const directory = await makeDirectory();
      const client = await connect(directory);
      let prompts = 0;
      client.setRequestHandler('elicitation/create', (request) => {
        prompts += 1;
        expect(request.params.message).toContain('1 document');
        return Promise.resolve(answer);
      });

      const result = await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], noConfig: true },
      });
      // Exactly one prompt: a refusal must not re-ask in a loop.
      expect(prompts).toBe(1);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CANCELLED', category: 'cancelled' },
      });
    });

    // The gate lives in the shared tool path, so it must not be an ocr_extract
    // special case — the other two tools bill just as readily.
    it.each([
      ['ocr_run_agentic', { inputs: ['invoice.jpg'], noConfig: true }],
      ['ocr_web', { urls: ['https://example.com/report'], noConfig: true }],
    ])('gates %s on the same policy', async (name, args) => {
      vi.stubEnv('OPEN_OCR_MCP_CONFIRM', '1');
      const directory = await makeDirectory();
      const client = await connect(directory);
      let prompts = 0;
      client.setRequestHandler('elicitation/create', () => {
        prompts += 1;
        // Declining means the run never starts, so ocr_web makes no request.
        return Promise.resolve({ action: 'decline' as const });
      });

      const result = await client.callTool({ name, arguments: args });
      expect(prompts).toBe(1);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'CANCELLED' },
      });
    });

    it('runs without prompting when the gate is off', async () => {
      // This is the one case that proceeds past the gate into a real run, so
      // every provider credential is cleared first: the assertion is about the
      // gate, and it must never depend on — or spend — a developer's API key.
      for (const key of [
        'GEMINI_API_KEY', 'OPEN_OCR_API_KEY', 'MOONSHOT_API_KEY',
        'META_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_AI_GATEWAY_TOKEN',
      ]) vi.stubEnv(key, '');

      const directory = await makeDirectory();
      const client = await connect(directory);
      let prompts = 0;
      client.setRequestHandler('elicitation/create', () => {
        prompts += 1;
        return Promise.resolve({ action: 'accept' as const, content: { proceed: true } });
      });

      const result = await client.callTool({
        name: 'ocr_extract',
        arguments: { inputs: ['invoice.jpg'], noConfig: true },
      });
      // Reaching the credential check proves the call went past the gate
      // unprompted rather than being short-circuited by it.
      expect(prompts).toBe(0);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'AUTH_MISSING' },
      });
    });
  });
});
