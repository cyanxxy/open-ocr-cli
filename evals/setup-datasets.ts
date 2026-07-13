import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './shared';

interface DatasetManifest {
  cord: {
    dataset: string;
    revision: string;
    split: string;
    indices: number[];
    license: string;
    source: string;
  };
  omnidocbench: {
    dataset: string;
    revision: string;
    annotationSha256: string;
    seed: string;
    samplesPerDocumentType: number;
    source: string;
    termsNote: string;
  };
}

interface CordWord {
  text?: unknown;
}

interface CordLine {
  words?: CordWord[];
}

interface CordGroundTruth {
  gt_parse?: unknown;
  valid_line?: CordLine[];
}

interface CordRowsResponse {
  rows: Array<{
    row_idx: number;
    row: {
      image: { src: string };
      ground_truth: string;
    };
  }>;
}

interface OmniBlock {
  category_type?: string;
  ignore?: boolean;
  order?: number;
  text?: string;
  latex?: string;
  html?: string;
}

interface OmniPage {
  layout_dets: OmniBlock[];
  page_info: {
    image_path: string;
    page_attribute: {
      data_source: string;
      language?: string;
      layout?: string;
      special_issue?: string[];
    };
  };
}

const cacheRoot = path.resolve(repoRoot, 'evals', 'cache');

async function readManifest(): Promise<DatasetManifest> {
  const raw = await fs.readFile(path.resolve(repoRoot, 'evals', 'datasets.json'), 'utf8');
  return JSON.parse(raw) as DatasetManifest;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { 'user-agent': 'open-gemini-ocr-evals/1.0' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'user-agent': 'open-gemini-ocr-evals/1.0' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return await response.json() as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function downloadFile(url: string, filePath: string): Promise<void> {
  const bytes = await fetchBytes(url);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

function cordText(groundTruth: CordGroundTruth): string {
  return (groundTruth.valid_line ?? [])
    .map((line) => (line.words ?? []).map((word) => typeof word.text === 'string' ? word.text.trim() : '').filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
}

function localPath(...segments: string[]): string {
  return path.posix.join('evals', 'cache', ...segments);
}

async function setupCord(manifest: DatasetManifest['cord']): Promise<number> {
  const maximumIndex = Math.max(...manifest.indices);
  const query = new URL('https://datasets-server.huggingface.co/rows');
  query.searchParams.set('dataset', manifest.dataset);
  query.searchParams.set('config', 'default');
  query.searchParams.set('split', manifest.split);
  query.searchParams.set('offset', '0');
  query.searchParams.set('length', String(maximumIndex + 1));
  query.searchParams.set('revision', manifest.revision);
  const response = await fetchJson<CordRowsResponse>(query.toString());
  const selectedRows = response.rows.filter((row) => manifest.indices.includes(row.row_idx));

  for (const [selectionIndex, entry] of selectedRows.entries()) {
    const id = String(entry.row_idx).padStart(3, '0');
    const groundTruth = JSON.parse(entry.row.ground_truth) as CordGroundTruth;
    const imageRelative = localPath('cord', 'images', `${id}.jpg`);
    const textRelative = localPath('cord', 'references', `${id}.txt`);
    const jsonRelative = localPath('cord', 'references', `${id}.json`);
    await Promise.all([
      downloadFile(entry.row.image.src, path.resolve(repoRoot, imageRelative)),
      fs.mkdir(path.dirname(path.resolve(repoRoot, textRelative)), { recursive: true })
        .then(() => fs.writeFile(path.resolve(repoRoot, textRelative), `${cordText(groundTruth)}\n`, 'utf8')),
      writeJson(path.resolve(repoRoot, jsonRelative), groundTruth.gt_parse ?? {}),
    ]);
    await writeJson(path.resolve(cacheRoot, 'cases', `cord-simple-${id}.json`), {
      id: `cord-simple-${id}`,
      mode: 'simple',
      inputPath: imageRelative,
      reference: { textPath: textRelative },
      expectedAssertions: [
        { type: 'metric_min', metric: 'normalized_edit_similarity', value: 0.65 },
        { type: 'metric_min', metric: 'text_coverage', value: 0.65 },
        { type: 'metric_max', metric: 'unsupported_text_rate', value: 0.4 },
      ],
      tags: ['external', 'cord', 'receipt', 'photographed', 'real-ocr'],
      suites: selectionIndex < 5 ? ['canary', 'full', 'benchmark'] : ['full', 'benchmark'],
    });
  }
  return selectedRows.length;
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(?:tr|p|div|table)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function omniText(page: OmniPage): string {
  return [...page.layout_dets]
    .filter((block) => !block.ignore)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    .map((block) => block.text?.trim() || block.latex?.trim() || (block.html ? stripHtml(block.html) : ''))
    .filter(Boolean)
    .join('\n');
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeRemotePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function selectOmniPages(pages: OmniPage[], seed: string, samplesPerDocumentType: number): OmniPage[] {
  const grouped = new Map<string, OmniPage[]>();
  for (const page of pages) {
    const source = page.page_info.page_attribute.data_source;
    grouped.set(source, [...(grouped.get(source) ?? []), page]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([, entries]) =>
    entries
      .sort((left, right) => sha256(`${seed}${left.page_info.image_path}`).localeCompare(sha256(`${seed}${right.page_info.image_path}`)))
      .slice(0, samplesPerDocumentType)
  );
}

async function setupOmniDocBench(manifest: DatasetManifest['omnidocbench']): Promise<number> {
  const annotationUrl = `https://huggingface.co/datasets/${manifest.dataset}/resolve/${manifest.revision}/OmniDocBench.json?download=true`;
  const annotationBytes = await fetchBytes(annotationUrl);
  const digest = sha256(annotationBytes);
  if (digest !== manifest.annotationSha256) {
    throw new Error(`OmniDocBench annotation checksum mismatch: expected ${manifest.annotationSha256}, received ${digest}`);
  }
  const pages = JSON.parse(new TextDecoder().decode(annotationBytes)) as OmniPage[];
  const selectedPages = selectOmniPages(pages, manifest.seed, manifest.samplesPerDocumentType);

  for (const [index, page] of selectedPages.entries()) {
    const id = String(index).padStart(3, '0');
    const extension = path.extname(page.page_info.image_path).toLowerCase() || '.png';
    const imageRelative = localPath('omnidocbench', 'images', `${id}${extension}`);
    const textRelative = localPath('omnidocbench', 'references', `${id}.txt`);
    const metadataRelative = localPath('omnidocbench', 'references', `${id}.json`);
    const imageUrl = `https://huggingface.co/datasets/${manifest.dataset}/resolve/${manifest.revision}/images/${encodeRemotePath(page.page_info.image_path)}?download=true`;
    await Promise.all([
      downloadFile(imageUrl, path.resolve(repoRoot, imageRelative)),
      fs.mkdir(path.dirname(path.resolve(repoRoot, textRelative)), { recursive: true })
        .then(() => fs.writeFile(path.resolve(repoRoot, textRelative), `${omniText(page)}\n`, 'utf8')),
      writeJson(path.resolve(repoRoot, metadataRelative), page.page_info),
    ]);
    const attributes = page.page_info.page_attribute;
    await writeJson(path.resolve(cacheRoot, 'cases', `omnidocbench-simple-${id}.json`), {
      id: `omnidocbench-simple-${id}`,
      mode: 'simple',
      inputPath: imageRelative,
      reference: { textPath: textRelative },
      expectedAssertions: [
        { type: 'metric_min', metric: 'normalized_edit_similarity', value: 0.55 },
        { type: 'metric_min', metric: 'text_coverage', value: 0.55 },
        { type: 'metric_max', metric: 'unsupported_text_rate', value: 0.45 },
      ],
      tags: [
        'external',
        'omnidocbench',
        attributes.data_source,
        attributes.language ?? 'unknown-language',
        attributes.layout ?? 'unknown-layout',
        'real-ocr',
      ],
      suites: index < 5 ? ['canary', 'full', 'benchmark'] : ['full', 'benchmark'],
    });
  }
  return selectedPages.length;
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  await fs.rm(cacheRoot, { recursive: true, force: true });
  await fs.mkdir(cacheRoot, { recursive: true });
  console.log(`CORD: ${manifest.cord.license}; ${manifest.cord.source}`);
  console.log(`OmniDocBench: ${manifest.omnidocbench.termsNote} ${manifest.omnidocbench.source}`);
  const cordCount = await setupCord(manifest.cord);
  const omniCount = await setupOmniDocBench(manifest.omnidocbench);
  await writeJson(path.resolve(cacheRoot, 'installed.json'), {
    installedAt: new Date().toISOString(),
    cord: { revision: manifest.cord.revision, cases: cordCount },
    omnidocbench: { revision: manifest.omnidocbench.revision, cases: omniCount },
  });
  console.log(`Prepared ${cordCount + omniCount} public eval cases in ${path.relative(repoRoot, cacheRoot)}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
