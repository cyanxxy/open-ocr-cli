<div align="center">

# Open Gemini OCR

**A browser-first OCR workspace for images, PDFs, and URLs — powered by Google Gemini.**

[![CI](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml/badge.svg)](https://github.com/cyanxxy/gemini-ocr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-43853d.svg)](package.json)
[![React](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vite.dev/)

</div>

---

## Why

OCR libraries either ship a heavy backend, lock structured extraction behind closed models, or guess content when a URL or page can't actually be retrieved. **Open Gemini OCR** runs entirely in the browser, hands every document to Gemini with full reasoning control, and **fails closed** on grounded URL extraction — no fabricated text when retrieval cannot be verified.

## Highlights

- **Five purpose-built modes** — plain OCR, structured templates, bulk batches, grounded URL extraction, and an iterative agent for harder documents.
- **Frontier models, your choice** — Gemini 3.5 Flash (default), 3.1 Flash-Lite, 3 Flash Preview, and 3.1 Pro, with selectable reasoning depth.
- **Grounded Web OCR** — Gemini URL context with per-URL verification. If retrieval fails or can't be verified, you see an explicit error instead of guessed content.
- **Multiple artifacts per run** — Markdown, JSON, and CSV from a single template extraction.
- **Polished UI** — light / dark / AMOLED themes, KaTeX-aware Markdown rendering via `streamdown`.
- **Assertion-based AI evals** baked into the repo under [`evals/`](evals).
- **No server, no telemetry** — files are read in the browser; the only outbound traffic is to the Gemini API with your own key.

## Modes

| Mode          | Route        | Best for                                  | Output                |
| ------------- | ------------ | ----------------------------------------- | --------------------- |
| **Simple**    | `/`          | Plain OCR from one image or PDF           | Markdown              |
| **Templates** | `/templates` | Invoices, receipts, resumes, business cards | Markdown · JSON · CSV |
| **Bulk**      | `/advanced`  | Multi-file extraction jobs                | Combined Markdown     |
| **Web**       | `/web`       | URL-based extraction (grounded)           | Markdown              |
| **Agent**     | `/agentic`   | Iterative recovery on harder documents    | Structured fields     |

## Quick Start

### Prerequisites

- Node.js **`>= 20.19.0`**
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Install & run

```bash
git clone https://github.com/cyanxxy/gemini-ocr.git
cd gemini-ocr
npm ci
npm run dev
```

Open `http://localhost:5173`, add your API key in **Settings**, then pick a mode. **Templates** is the recommended starting point for structured documents; **Simple** for plain OCR.

## Models

| Model                     | Status   | Reasoning levels             | Notes              |
| ------------------------- | -------- | ---------------------------- | ------------------ |
| `gemini-3.5-flash`        | Stable   | MINIMAL · LOW · MEDIUM · HIGH | Default, recommended |
| `gemini-3.1-flash-lite`   | Stable   | MINIMAL · LOW · MEDIUM · HIGH | Cheapest / high volume |
| `gemini-3-flash-preview`  | Preview¹ | MINIMAL · LOW · MEDIUM · HIGH | Fast preview       |
| `gemini-3.1-pro-preview`  | Preview¹ | LOW · MEDIUM · HIGH           | Highest reasoning  |

¹ Preview models may change or be retired without notice; their API behavior is not covered by stability guarantees.

Reasoning depth is configurable in Settings (default **MEDIUM**). Gemini 3.1 Pro is clamped to `LOW`/`MEDIUM`/`HIGH` per the Gemini 3 API contract. Agentic mode bumps `MINIMAL` up to `MEDIUM` for extraction quality.

## Web OCR Behavior

- Only **public** `http(s)` URLs are accepted. URLs with embedded credentials, `localhost`/loopback, private or link-local IP ranges, or tunneling hosts (e.g. `ngrok`) are rejected before the API call — matching Gemini URL Context's public-URL requirement.
- Duplicate URLs are de-duplicated, and an in-progress run can be cancelled.
- Web OCR uses Gemini URL context and **verifies retrieval metadata** before treating a response as valid.
- If any URL fails to retrieve, is unsupported, or cannot be verified, the app surfaces an explicit error instead of inventing extracted content.
- Up to **20 URLs** per request.

## Limits

- File size: **100 MB** for images, **50 MB** for PDFs (Gemini document limits)
- Bulk batch: up to **200 files** and **500 MB** total per job
- Supported local files: images (`png`, `jpg`, `jpeg`, `webp`, `heic`, `heif`) and `pdf`
- Web OCR: up to 20 URLs per request

## AI Evals

The repo ships with an assertion-based eval suite that runs real Gemini calls against a fixture corpus.

```bash
npm run evals:validate           # static checks on cases/corpus
GEMINI_API_KEY=your_key npm run evals
npm run evals:report             # render latest run as Markdown
```

Files:

- [`evals/cases`](evals/cases) — assertions and fixtures
- [`evals/corpus`](evals/corpus) — input documents
- [`evals/reports/latest.md`](evals/reports/latest.md) · [`evals/reports/latest.json`](evals/reports/latest.json) — last committed run

> **Note:** `evals/reports/latest.md` and `latest.json` are a committed snapshot from the last manual eval run (see the `Run at` timestamp in the report), not live results. They may be stale relative to the current model, codebase, or case set — for example, cases added after the snapshot will not be reflected in its totals until evals are re-run. Regenerating requires a Gemini API key:
>
> ```bash
> GEMINI_API_KEY=your_key npm run evals && npm run evals:report
> ```

## Scripts

```bash
npm run dev              # start Vite dev server
npm run build            # production build
npm run preview          # preview the production build
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit for the app + node project configs
npm run test             # Vitest (single run)
npm run test:run         # Vitest (single run, same as test)
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Vitest coverage
npm run evals            # run AI evals against Gemini
npm run evals:report     # render latest eval run
npm run evals:validate   # validate eval cases/corpus
```

## Quality Gates

Every push and pull request runs the same checks in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **Type-check** — `tsc --noEmit` against both the app and node project configs.
- **Lint** — ESLint (flat config) with React, hooks, and TypeScript rules.
- **Tests + coverage** — Vitest with enforced coverage thresholds.
- **Dependency audit** — `audit-ci` fails the build on moderate-or-higher advisories.
- **Eval fixtures** — `evals:validate` statically checks the eval cases and corpus.
- **Build** — a production Vite build must succeed.

Run the core checks locally before opening a PR:

```bash
npm run typecheck && npm run lint && npm run test:run && npm run build
```

## Tech Stack

| Category   | Tools                                       |
| ---------- | ------------------------------------------- |
| App        | React 19 · TypeScript · Vite 7              |
| Routing    | React Router 7                              |
| State      | Zustand                                     |
| Gemini     | `@google/genai`                             |
| Markdown   | `streamdown` · KaTeX                        |
| Styling    | Tailwind CSS                                |
| Testing    | Vitest · Testing Library · `happy-dom`      |

## Project Layout

```text
src/
  components/    UI components (atoms, molecules, organisms, layout)
  pages/         Route-level screens (one per mode)
  lib/
    gemini/      Gemini client, interactions, structured/URL operations
    templates/   Preset extraction templates
    agentLoop.ts, agentGemini.ts, agentTools.ts, agentTypes.ts
  store/         Zustand stores (one per mode + settings)
  hooks/         Reusable hooks
  design/        Theme primitives
evals/           Assertion-based AI eval suite
```

## Security & Privacy

- The API key is stored in `localStorage` with **lightweight obfuscation only** — treat it as accessible to anyone who can read browser storage on that device.
- Use Open Gemini OCR on trusted, private devices. For production deployments, route Gemini calls through a server-side proxy rather than shipping a long-lived API key to browsers.
- Files are read client-side and sent directly to the Gemini API. No data is sent to any other service.
- The included Netlify/Vercel configs send hardening response headers — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`, and a restrictive `Permissions-Policy` — alongside the in-document CSP. (`Strict-Transport-Security` omits `preload`; opt in deliberately, as it is an irreversible HTTPS-only commitment.)
- Production builds ship without source maps; set `build.sourcemap` to `'hidden'` in `vite.config.ts` if your error tracker needs them.

Vulnerability reports: see [SECURITY.md](SECURITY.md).

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, checks, and PR guidance, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## License

[MIT](LICENSE).
