import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAgenticMcpRequest,
  buildExtractMcpRequest,
  buildWebMcpRequest,
  createOcrMcpServer,
} from './mcp';

describe('Open OCR MCP server', () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
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
});
