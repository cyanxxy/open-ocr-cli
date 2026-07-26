import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

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

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
    await Promise.all(cleanupPaths.splice(0).map(
      async (directory) => rm(directory, { recursive: true, force: true }),
    ));
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
});
