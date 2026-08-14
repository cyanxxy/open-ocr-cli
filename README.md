<!-- markdownlint-disable MD013 MD033 MD041 -->

<div align="center">

# Open OCR CLI

**Agent-first, provider-neutral document extraction for the command line.**

Turn images, PDFs, and public URLs into text or validated structured data —
through Gemini, Kimi K3, Meta Muse Spark, OpenRouter, or any OpenAI-compatible
endpoint — behind one consistent extraction contract.

[![CI](https://github.com/cyanxxy/open-ocr-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/cyanxxy/open-ocr-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/open-ocr-cli?logo=npm&label=open-ocr-cli)](https://www.npmjs.com/package/open-ocr-cli)
[![Release](https://img.shields.io/github/v/release/cyanxxy/open-ocr-cli?display_name=tag)](https://github.com/cyanxxy/open-ocr-cli/releases)
[![Node.js](https://img.shields.io/badge/Node.js-20.19%2B-43853d?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-0f766e.svg)](LICENSE)

[Quick start](#quick-start) · [Modes](#extraction-modes) · [Commands](#commands) ·
[Agents and MCP](#agents-and-mcp) · [Providers](#providers) ·
[Full CLI reference](packages/cli/README.md)

</div>

---

> [!NOTE]
> `open-ocr-cli` is the executable, npm package, and configuration namespace.

## Quick start

Requires Node.js **20.19+**, **22.13+**, or **24+** and one provider key
(`--dry-run` needs none).

```bash
npm install --global open-ocr-cli

export GEMINI_API_KEY="your-key"
open-ocr-cli extract invoice.pdf
```

Switch providers with a flag:

```bash
open-ocr-cli extract invoice.pdf --provider kimi          # MOONSHOT_API_KEY
open-ocr-cli extract invoice.pdf --provider openrouter \
  --model moonshotai/kimi-k3                              # OPENROUTER_API_KEY
```

Keys are read only from the environment or a project `.env` — never from a flag
or config file. With no arguments the CLI prints help and never prompts, so
scripts and CI stay deterministic; `interactive`, `init`, and `doctor` cover the
guided paths.

Also available as a [Docker image](packages/cli/README.md#distribution)
(`ghcr.io/cyanxxy/open-ocr-cli`), a [GitHub Action](action.yml)
(`cyanxxy/open-ocr-cli@v3`), and a Homebrew formula.

## Extraction modes

| Mode | Command | Best for |
| --- | --- | --- |
| **Simple** | `extract --mode simple` | General text, layout, equations, image descriptions |
| **Template** | `extract --preset <id>` | Invoices, receipts, resumes, business cards |
| **Custom schema** | `extract --schema <file>` | Your own validated JSON structure |
| **Agentic** | `extract --mode agentic` | Iterative field recovery and targeted region re-OCR |
| **Web** | `web <urls...>` | Grounded extraction from public URLs |

Schemas are validated locally — both the schema and the model's returned value —
before anything is written. Invalid JSON or a schema mismatch is never persisted
as a success.

Agentic mode uses a two-loop design: an outer document loop evaluates confidence
and coverage, while an inner loop lets the model call one tool (structure
analysis, batch field extraction, region re-OCR), inspect the result, and decide
what to do next. The document is sent once.

## Commands

| Command | Purpose |
| --- | --- |
| `extract <inputs...>` | Extract files, directories, globs, or binary stdin (`-`) |
| `web <urls...>` | Grounded extraction from up to 20 public HTTP(S) URLs |
| `run --request <file>` | Execute a versioned machine-protocol request |
| `mcp` | Serve OCR tools over the Model Context Protocol stdio transport |
| `capabilities` · `schema` | Advertise providers, modes, limits, error codes; print JSON Schemas |
| `init` · `doctor` · `interactive` | Configure, diagnose, and explore |
| `status [output]` | Audit a completed or interrupted batch |
| `presets` · `models` · `providers` | Discover templates, model IDs, and provider profiles |

```bash
# Recursive, resumable batch
open-ocr-cli extract ./documents --output ./results --concurrency 4 --resume

# Structured invoice artifacts (markdown + JSON + CSV)
open-ocr-cli extract ./invoices --preset invoice --format all --output ./invoice-results

# Validate the full plan without credentials, API calls, or writes
open-ocr-cli extract ./documents --dry-run
```

Extracted content and JSONL events go to `stdout`; progress and diagnostics go
to `stderr` — every command composes safely in a pipeline.

> **Flags, configuration keys, batch semantics, cost controls, and exit codes:**
> [packages/cli/README.md](packages/cli/README.md)

## Agents and MCP

Three entry points wrap the same job engine.

**Machine protocol** — `run` executes a protocol v2 request validated against
published Draft 2020-12 JSON Schemas, returning a
typed result object or an ordered JSONL event stream with stable sequence
numbers and typed error codes carrying recovery hints:

```bash
open-ocr-cli capabilities --json
open-ocr-cli run --request request.json --response-format jsonl
```

**MCP server** — `open-ocr-cli mcp` starts a stdio server exposing
`ocr_extract`, `ocr_run_agentic`, and `ocr_web`, plus an
`open-ocr://capabilities` resource. The host must open MCP revision
`2026-07-28`; clients that use the earlier `initialize` handshake are rejected:

```json
{
  "mcpServers": {
    "open-ocr": {
      "command": "open-ocr-cli",
      "args": ["mcp"]
    }
  }
}
```

**Agent skill** — a validated skill for Claude Code, Codex, and compatible
agents ships at
[`integrations/open-ocr/skills/open-ocr/SKILL.md`](integrations/open-ocr/skills/open-ocr/SKILL.md)
and in the npm package under `skills/open-ocr/`.

All three are reference-first: large bodies land in `.open-ocr-results/<runId>`
artifacts instead of flooding an agent's context, cancellation is honored, and
under `mcp` stdout carries only transport messages.

## Providers

| Profile | Default model | Documents | Structured output | Agent tools |
| --- | --- | --- | --- | --- |
| `gemini` | `gemini-3.5-flash` | Images and native PDFs | Yes | Native Interactions API |
| `kimi` | `kimi-k3` | Images; PDFs via Kimi file extraction | Yes | OpenAI-compatible tool calls |
| `muse` | `muse-spark-1.1` | PNG, JPEG, WebP, GIF, PDF | Yes | OpenAI-compatible tool calls |
| `openrouter` | `google/gemini-3.5-flash` | Model-dependent | Model-dependent | Model-dependent |
| `openai-compatible` | Required | Images; PDF not assumed | Endpoint-dependent | Endpoint-dependent |

Named profiles supply endpoints, credential variable names, and multimodal wire
formats; `openrouter` and `openai-compatible` take arbitrary upstream model IDs.
Any provider can also run through **Cloudflare AI Gateway** with `--gateway
cloudflare`, including BYOK.

Model catalogs, reasoning levels, cost estimates, and gateway configuration are
documented in the [CLI reference](packages/cli/README.md#models-reasoning-and-cost).

## Limits and guarantees

| Constraint | Limit |
| --- | --- |
| Formats | PNG · JPEG · WebP · GIF · HEIC · HEIF · PDF (video is rejected) |
| Size | Images 70 MB raw · PDFs 50 MB and 1,000 pages |
| Batches | 1,000 files and 5,120 MB by default; concurrency 1–16 |
| Output | Markdown · JSON · CSV · JSONL · agent audit steps |

Every discovered input gets a succeeded, partial, failed, or skipped result —
no silent loss. Batches are fingerprinted and resumable, output is lock-guarded
and no-clobber, and truncated, blocked, or schema-invalid model responses fail
closed rather than being written as success.

There is no backend and no telemetry: documents go to the selected provider or
gateway and nowhere else. Web OCR rejects credentials in URLs, localhost,
private ranges, and tunnel hosts, and pins DNS across redirects. Report
vulnerabilities privately via [SECURITY.md](SECURITY.md).

## Repository layout

One repository, two entry points over a shared extraction engine:

| Path | What it is |
| --- | --- |
| `packages/engine` | The `@open-ocr/engine` workspace package: providers, extraction modes, agent loop, protocol types. Private and never published — the CLI bundles it at build time. Node-only — typechecked without DOM libs, so a browser API cannot reach it. Region cropping is supplied by the host through an adapter such as `packages/cli/src/nodeRegionCropper.ts`. |
| `packages/cli` | The published `open-ocr-cli` npm package. Owns its own source, build, and protocol schemas. |
| `integrations/open-ocr/skills` | Agent skill definitions. Source of truth; `packages/cli/skills` is a generated copy. |
| `evals/` | The evaluation corpus and runner. |
| `examples/` · `.open-ocr-cli.example.json` | Copy-paste provider configs, a custom JSON Schema, a protocol request, and an annotated config file. |
| `scripts/` | Release, packaging, skill-sync, and smoke-test tooling. |

`open-ocr-cli mcp` is not a separate package — it is a third front end inside
the CLI, alongside `extract` (human-facing) and `run` (versioned protocol), all
routed through the same job service.

Both the engine (`packages/engine/tsconfig.json`) and the CLI (`packages/cli/tsconfig.json`)
are typechecked without DOM libraries on purpose: a browser API reaching this
code fails the build rather than failing at runtime.

## Contributing

Setup, PR gates, and release steps are in [CONTRIBUTING.md](CONTRIBUTING.md).
Behavior changes need tests or evaluation evidence; the evaluation suite is
documented in [evals/README.md](evals/README.md).

<div align="center">

[Issues](https://github.com/cyanxxy/open-ocr-cli/issues) ·
[Releases](https://github.com/cyanxxy/open-ocr-cli/releases) ·
[Changelog](CHANGELOG.md) · [Security](SECURITY.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md)

**MIT Licensed** — see [LICENSE](LICENSE)

</div>
