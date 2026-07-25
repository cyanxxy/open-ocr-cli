import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { isPublicIpAddress, parseSupportedHttpUrl } from '../../../src/lib/urlValidation';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const NETWORK_IDLE_TIMEOUT_MS = 30_000;

export interface SecureFetchResult {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

async function resolvedPublicAddresses(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const directFamily = isIP(hostname);
  const addresses = directFamily
    ? [{ address: hostname, family: directFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new Error(`URL host does not resolve exclusively to public addresses: ${hostname}`);
  }
  return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
}

function decodedStream(response: IncomingMessage): Readable {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

function readBounded(stream: Readable, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      stream.destroy(signal?.reason instanceof Error
        ? signal.reason
        : new DOMException('Operation aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_RESPONSE_BYTES) {
        stream.destroy(new Error(`URL response exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`));
        return;
      }
      chunks.push(buffer);
    });
    stream.once('error', (error) => { cleanup(); reject(error); });
    stream.once('end', () => { cleanup(); resolve(Buffer.concat(chunks)); });
  });
}

async function requestOnce(url: URL, signal?: AbortSignal): Promise<IncomingMessage> {
  const addresses = await resolvedPublicAddresses(url.hostname);
  const selected = addresses[0];
  return new Promise<IncomingMessage>((resolve, reject) => {
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/pdf,image/*,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'open-ocr-cli/2 (+https://github.com/cyanxxy/gemini-ocr)',
      },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    };
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(options, resolve);
    request.setTimeout(NETWORK_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`URL network operation was idle for ${NETWORK_IDLE_TIMEOUT_MS / 1000} seconds`));
    });
    const onAbort = (): void => {
      request.destroy(signal?.reason instanceof Error
        ? signal.reason
        : new DOMException('Operation aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    request.once('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(error); });
    request.once('close', () => signal?.removeEventListener('abort', onAbort));
    request.end();
  });
}

export async function secureFetchPublicUrl(
  value: string,
  signal?: AbortSignal,
  redirectCount = 0,
): Promise<SecureFetchResult> {
  const url = parseSupportedHttpUrl(value);
  if (!url) throw new Error(`Unsupported or unsafe URL: ${value}`);
  const response = await requestOnce(url, signal);
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    response.resume();
    const location = response.headers.location;
    if (!location) throw new Error(`URL redirect from ${value} omitted Location`);
    if (redirectCount >= MAX_REDIRECTS) throw new Error(`URL exceeded ${MAX_REDIRECTS} redirects`);
    return secureFetchPublicUrl(new URL(location, url).toString(), signal, redirectCount + 1);
  }
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(`URL returned HTTP ${status}: ${value}`);
  }
  const declaredLength = Number(response.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    response.destroy();
    throw new Error(`URL response exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024} MB: ${value}`);
  }
  return {
    url: url.toString(),
    contentType: String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase(),
    bytes: await readBounded(decodedStream(response), signal),
  };
}
