<div align="center">

# Open Gemini OCR

**Browser-first OCR for images, PDFs, and URLs — powered by Google Gemini.**

[![CI](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml/badge.svg)](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cyanxxy/gemini-ocr?display_name=tag)](https://github.com/cyanxxy/gemini-ocr/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-43853d.svg)](package.json)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vite.dev/)

</div>

---

## Overview

Open Gemini OCR is an open-source web app for extracting text and structured data from documents. It runs entirely in the browser: files never leave your machine except as direct requests to the Gemini API using **your** API key.

Unlike many OCR tools, it does not invent content when a URL cannot be retrieved. Web OCR fails closed when grounding cannot be verified.

| | |
| --- | --- |
| **Stack** | React 19 · TypeScript · Vite 7 · Zustand · Tailwind · `@google/genai` |
| **Deployment** | Static SPA (Netlify / Vercel configs included) |
| **License** | [MIT](LICENSE) |

---

## Features

- **Five modes** — plain OCR, structured templates, bulk batches, grounded URL extraction, and an iterative agent for difficult documents
- **Model choice** — Gemini 3.5 Flash (default), 3.1 Flash-Lite, 3 Flash Preview, and 3.1 Pro, with configurable reasoning depth
- **Structured artifacts** — Markdown, JSON, and CSV from template extractions (invoices, receipts, resumes, business cards)
- **Grounded Web OCR** — Gemini URL context with per-URL verification; no fabricated text on failed retrieval
- **Themes** — light, dark, and AMOLED; KaTeX-aware Markdown via `streamdown`
- **Built-in evals** — assertion-based suite under [`evals/`](evals)
- **Privacy-minded** — no app backend, no telemetry; only outbound traffic is to Gemini with your key

---

## Modes

| Mode | Route | Best for | Output |
| --- | --- | --- | --- |
| **Simple** | `/` | Single image or PDF | Markdown |
| **Templates** | `/templates` | Invoices, receipts, resumes, business cards | Markdown · JSON · CSV |
| **Bulk** | `/advanced` | Multi-file jobs | Combined Markdown |
| **Web** | `/web` | Public URL extraction (grounded) | Markdown |
| **Agent** | `/agentic` | Iterative recovery on harder documents | Structured fields |

---

## Quick start

### Requirements

- Node.js **≥ 20.19.0**
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Install and run

```bash
git clone https://github.com/cyanxxy/gemini-ocr.git
cd gemini-ocr
npm ci
npm run dev
```

Open `http://localhost:5173`, set your API key under **Settings**, then choose a mode.

- Structured documents → **Templates**
- Plain text extraction → **Simple**

---

## Models and reasoning

| Model ID | Status | Thinking levels | Notes |
| --- | --- | --- | --- |
| `gemini-3.5-flash` | Stable | MINIMAL · LOW · MEDIUM · HIGH | Default; recommended for most work |
| `gemini-3.1-flash-lite` | Stable | MINIMAL · LOW · MEDIUM · HIGH | Lowest cost / high volume |
| `gemini-3-flash-preview` | Preview¹ | MINIMAL · LOW · MEDIUM · HIGH | Preview Flash |
| `gemini-3.1-pro-preview` | Preview¹ | LOW · MEDIUM · HIGH | Highest reasoning |

¹ Preview models may change or be retired without notice.

**Thinking depth** is set in Settings (app default: **MEDIUM**).

- Pro does not support `MINIMAL` (clamped to supported levels).
- Agentic mode raises `MINIMAL` to `MEDIUM` for extraction quality.
- Unset levels follow model defaults where applicable (e.g. Flash-Lite → minimal, 3.5 Flash → medium).

---

## Limits

| Constraint | Value |
| --- | --- |
| Image upload | **100 MB** |
| PDF upload | **50 MB** |
| Bulk batch | Up to **200** files, **500 MB** total |
| Local formats | `png`, `jpg`/`jpeg`, `webp`, `heic`, `heif`, `pdf` |
| Web OCR URLs | Up to **20** per request |

### Web OCR rules

- Only public `http`/`https` URLs; credentials in URLs, localhost, private ranges, and tunnel hosts (e.g. ngrok) are rejected
- Duplicates are de-duplicated; in-progress runs can be cancelled
- Retrieval metadata is verified per URL; failure or unverifiable grounding surfaces an error instead of guessed content

---

## Development

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm test` | Vitest (single run) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run evals:validate` | Static checks on eval cases/corpus |
| `npm run evals:fixtures` | Rebuild local PDFs plus deterministic raster/degraded fixtures |
| `npm run evals:setup` | Download pinned CORD and OmniDocBench subsets into the ignored cache |
| `npm run evals:canary` | Small live Gemini eval (`GEMINI_API_KEY` required) |
| `npm run evals` | Full local and public-dataset live eval (`GEMINI_API_KEY` required) |
| `npm run evals:benchmark` | Public benchmark subset only (`GEMINI_API_KEY` required) |
| `npm run evals:stability` | Public benchmark subset repeated three times |
| `npm run evals:report` | Render latest eval report as Markdown |

### Quality gates

CI (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull request:

- Type-check · Lint · Tests + coverage thresholds · Dependency audit · Eval fixture validation · Production build

Before opening a PR:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

### Project layout

```text
src/
  components/     UI (atoms → molecules → organisms, layout, modals)
  pages/          One screen per mode
  lib/
    gemini/       Client, Interactions API helpers, extraction, URL ops
    templates/    Structured extraction presets
    agent*.ts     Agentic OCR loop, tools, memory
  store/          Zustand stores (settings + one per mode)
  hooks/          Shared hooks
  design/         Theme tokens
evals/            Assertion-based AI eval suite
```

### AI evals

```bash
npm run evals:fixtures
npm run evals:setup
npm run evals:validate
GEMINI_API_KEY=your_key npm run evals:canary
GEMINI_API_KEY=your_key npm run evals
npm run evals:report
```

The evaluator reports CER, normalized CER, WER, edit similarity, text coverage,
unsupported-text rate, field precision/recall/F1, critical-field exact match,
table-cell F1, latency, and mode/tag breakdowns. Public dataset files and
timestamped raw outputs remain local and untracked. See [`evals/README.md`](evals/README.md)
for dataset terms, scoring details, and suite composition.

| Path | Contents |
| --- | --- |
| [`evals/cases`](evals/cases) | Assertions and fixtures |
| [`evals/corpus`](evals/corpus) | Input documents |
| [`evals/references`](evals/references) | Versioned text and structured ground truth |
| [`evals/reports/latest.md`](evals/reports/latest.md) | Last committed Markdown report |
| [`evals/reports/latest.json`](evals/reports/latest.json) | Last committed JSON summary |

`latest.md` / `latest.json` are snapshots from the last manual run (see the report timestamp). They may lag the current code or case set until you re-run evals.

---

## Security and privacy

- API keys are stored in `localStorage` with **light obfuscation only** — anyone with access to the browser profile can recover them.
- Prefer trusted, private devices. For production, proxy Gemini through a backend instead of embedding long-lived keys in the client.
- Files are read in the browser and sent only to the Gemini API; no other third-party data path.
- Netlify/Vercel configs set hardening headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`) plus the in-document CSP. HSTS omits `preload` by design.
- Production builds omit source maps by default.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## Contributing

Contributions are welcome.

- Setup and PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md)
- User-facing release history: [CHANGELOG.md](CHANGELOG.md)
- Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

---

## License

[MIT](LICENSE)
