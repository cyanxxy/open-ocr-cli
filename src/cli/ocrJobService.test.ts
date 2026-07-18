import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCliOptions } from './config';
import { discoverInputs } from './inputs';
import { OcrJobService, type OcrDocumentExtractor } from './ocrJobService';
import type { OcrJobEvent } from './protocol';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3]);
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'open-ocr-service-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('OcrJobService', () => {
  it('runs independently of terminal I/O and emits ordered reference-first events', async () => {
    const documentPath = path.join(directory, 'document.jpg');
    const outputDirectory = path.join(directory, 'artifacts');
    await writeFile(documentPath, JPEG_BYTES);
    const baseOptions = resolveCliOptions({ dryRun: true }, {}, directory);
    const options = {
      ...baseOptions,
      apiKey: 'test-key',
      dryRun: false,
      output: outputDirectory,
      quiet: true,
    };
    const inputs = await discoverInputs([documentPath], options);
    const extractDocument = vi.fn(() => Promise.resolve({
      artifacts: { markdown: '# Extracted\n\nSensitive body' },
      attempts: 1,
    }));
    const service = new OcrJobService({ extractDocument });
    const events: OcrJobEvent[] = [];

    const execution = await service.run(inputs, options, {
      runId: 'service-run',
      abortController: new AbortController(),
      eventSink: (event) => {
        events.push(event);
      },
    });

    expect(extractDocument).toHaveBeenCalledOnce();
    expect(execution.result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'document.started',
      'document.completed',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(events)).not.toContain('Sensitive body');
    const artifactPath = execution.result.documents[0]?.artifacts[0]?.path;
    if (!artifactPath) throw new Error('Expected an artifact reference');
    expect(artifactPath).toBe(path.join(outputDirectory, 'document.md'));
    expect(await readFile(artifactPath, 'utf8')).toContain('Sensitive body');
  });

  it('reports validation failures as typed document errors without calling a provider', async () => {
    const documentPath = path.join(directory, 'spoofed.jpg');
    await writeFile(documentPath, 'not a jpeg');
    const options = resolveCliOptions({ dryRun: true, output: path.join(directory, 'output') }, {}, directory);
    const inputs = await discoverInputs([documentPath], options);
    const extractDocument = vi.fn();
    const service = new OcrJobService({ extractDocument });

    const execution = await service.run(inputs, options, {
      runId: 'validation-run',
      abortController: new AbortController(),
    });

    expect(extractDocument).not.toHaveBeenCalled();
    expect(execution.result.ok).toBe(false);
    expect(execution.result.documents[0]?.error?.code).toBe('INPUT_INVALID');
  });

  it('resumes a single reference-first document from its manifest', async () => {
    const documentPath = path.join(directory, 'document.jpg');
    const outputDirectory = path.join(directory, 'single-output');
    await writeFile(documentPath, JPEG_BYTES);
    const baseOptions = resolveCliOptions({ dryRun: true }, {}, directory);
    const options = {
      ...baseOptions,
      apiKey: 'test-key',
      dryRun: false,
      output: outputDirectory,
      quiet: true,
    };
    const inputs = await discoverInputs([documentPath], options);
    const extractDocument = vi.fn(() => Promise.resolve({
      artifacts: { markdown: '# Extracted' },
      attempts: 1,
    }));
    const service = new OcrJobService({ extractDocument });

    const first = await service.run(inputs, options, {
      runId: 'single-first',
      abortController: new AbortController(),
      enableSingleInputResume: true,
    });
    const resumed = await service.run(inputs, options, {
      runId: 'single-second',
      abortController: new AbortController(),
      enableSingleInputResume: true,
    });

    expect(first.result.documents[0]?.status).toBe('succeeded');
    expect(resumed.result.documents[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'resumed',
    });
    expect(extractDocument).toHaveBeenCalledOnce();
    expect(await readFile(path.join(outputDirectory, '.gemini-ocr-manifest.json'), 'utf8')).toContain(documentPath);
  });

  it('reserves single-run manifest paths before invoking the provider', async () => {
    const documentPath = path.join(directory, '.gemini-ocr-manifest.jpg');
    const outputDirectory = path.join(directory, 'single-output');
    await writeFile(documentPath, JPEG_BYTES);
    const baseOptions = resolveCliOptions({ dryRun: true }, {}, directory);
    const options = {
      ...baseOptions,
      apiKey: 'test-key',
      dryRun: false,
      format: 'json' as const,
      output: outputDirectory,
      quiet: true,
    };
    const inputs = await discoverInputs([documentPath], options);
    const extractDocument = vi.fn<OcrDocumentExtractor>();
    const service = new OcrJobService({ extractDocument });

    await expect(service.run(inputs, options, {
      runId: 'metadata-collision',
      abortController: new AbortController(),
      enableSingleInputResume: true,
    })).rejects.toThrow('reserved job metadata');
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it('surfaces progress sink failures without leaving an unhandled rejection', async () => {
    const documentPath = path.join(directory, 'document.jpg');
    await writeFile(documentPath, JPEG_BYTES);
    const baseOptions = resolveCliOptions({ dryRun: true }, {}, directory);
    const options = { ...baseOptions, apiKey: 'test-key', dryRun: false, quiet: true };
    const inputs = await discoverInputs([documentPath], options);
    const extractDocument = vi.fn<OcrDocumentExtractor>((_input, _options, _signal, onStep) => {
      onStep({ type: 'thinking', content: 'Inspecting document', timestamp: Date.now() });
      return Promise.resolve({ artifacts: { markdown: '# Extracted' }, attempts: 1 });
    });
    const service = new OcrJobService({ extractDocument });
    const eventTypes: string[] = [];

    await expect(service.run(inputs, options, {
      runId: 'sink-failure',
      abortController: new AbortController(),
      eventSink: (event) => {
        eventTypes.push(event.type);
        if (event.type === 'document.progress') return Promise.reject(new Error('Event sink failed'));
      },
    })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(eventTypes).toContain('run.failed');
  });
});
