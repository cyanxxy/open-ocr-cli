# Open OCR CLI

Provider-neutral multimodal OCR for images, PDFs, public URLs, structured
schemas, and difficult document agents. It supports Gemini, Kimi K2.6, Meta
Muse Spark 1.1, OpenRouter, generic OpenAI-compatible APIs, and Cloudflare AI
Gateway.

## Install

Node.js 20.19+, 22.13+, or 24+ is required.

```bash
npm install --global open-ocr-cli
export GEMINI_API_KEY="your-key"
open-ocr-cli
```

`open-ocr-cli` is the primary executable. `gemini-ocr` remains an equivalent
backwards-compatible alias.

Running with no arguments in an interactive terminal opens a guided arrow-key
menu covering every command: Extract, Web, Init, Providers, Models, Presets,
Doctor, Status, and Help. Press Enter to select and Ctrl-C to cancel. When stdin
or the prompt stream is not a TTY, the bare command prints help instead. You can
also launch it explicitly with `open-ocr-cli interactive`.

For a project-local install, use `npx open-ocr-cli`. Direct subcommands such as
`open-ocr-cli extract invoice.pdf` remain non-interactive and safe for scripts
and CI.

## Pick a provider

```bash
# Gemini (default)
export GEMINI_API_KEY="your-key"
open-ocr-cli extract invoice.pdf

# Kimi K2.6
export MOONSHOT_API_KEY="your-key"
open-ocr-cli extract invoice.pdf --provider kimi

# Meta Muse Spark 1.1 public preview
export META_API_KEY="your-key"
open-ocr-cli extract invoice.pdf --provider muse

# Kimi or another multimodal model through OpenRouter
export OPENROUTER_API_KEY="your-key"
open-ocr-cli extract invoice.pdf \
  --provider openrouter \
  --model moonshotai/kimi-k2.6

# A compatible local endpoint (model is required)
open-ocr-cli extract scan.png \
  --provider openai-compatible \
  --base-url http://localhost:11434/v1 \
  --model qwen3-vl
```

Run `open-ocr-cli providers` for capability metadata and
`open-ocr-cli models --provider <id>` for recommended IDs. OpenRouter and the
generic profile accept arbitrary upstream model IDs. Generic PDF support is not
assumed; use images or a named PDF-capable profile.

| Profile | Default model | PDF handling | Structured output |
| --- | --- | --- | --- |
| `gemini` | `gemini-3.5-flash` | Native PDF input | Yes |
| `kimi` | `kimi-k2.6` | Kimi file extraction | Yes |
| `muse` | `muse-spark-1.1` | Native multimodal input | Yes |
| `openrouter` | `google/gemini-3.5-flash` | Model-dependent | Model-dependent |
| `openai-compatible` | Required | Endpoint-dependent | Endpoint-dependent |

The CLI reads secrets only from environment variables or `.env`. It never
accepts a raw key in arguments or JSON configuration. Defaults are
`GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `META_API_KEY`, `OPENROUTER_API_KEY`, and
`OPEN_OCR_API_KEY`; override the variable name with `--api-key-env` or
`apiKeyEnv`.

## Cloudflare AI Gateway

Cloudflare is a transport route around a provider, not a separate model:

```bash
export CLOUDFLARE_ACCOUNT_ID="account"
export CLOUDFLARE_AI_GATEWAY_ID="gateway"
export CLOUDFLARE_AI_GATEWAY_TOKEN="gateway-token"
export GEMINI_API_KEY="provider-key"

open-ocr-cli extract invoice.pdf \
  --provider gemini \
  --gateway cloudflare
```

Gemini and OpenRouter use Cloudflare's native provider routes. Kimi, Muse, and
generic endpoints require the configured custom-provider slug:

```bash
open-ocr-cli extract invoice.pdf \
  --provider kimi \
  --gateway cloudflare \
  --cloudflare-provider moonshot
```

Configure the custom provider with the upstream base before `/v1` (for example,
`https://api.moonshot.ai` for Kimi). The CLI forwards the remaining `/v1/...`
path through Cloudflare's custom-provider route.

Use `--cloudflare-byok` when Cloudflare stores the provider key, and optionally
`--cloudflare-byok-alias <alias>`. The account, gateway, token-variable name,
BYOK mode, alias, and custom-provider slug can all be stored in configuration.
Unauthenticated gateways need no gateway token. If authentication is enabled in
Cloudflare, set `CLOUDFLARE_AI_GATEWAY_TOKEN` or select another environment
variable with `--cloudflare-token-env`. BYOK always requires an authenticated
gateway and therefore always requires that token.

See Cloudflare's
[gateway authentication](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
and [stored-key documentation](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
for the corresponding dashboard setup.

## Common workflows

```bash
# Guided menu for choosing a command, provider, model, mode, and output
open-ocr-cli

# Guided provider-aware project configuration and credential validation
open-ocr-cli init

# One document to stdout
open-ocr-cli extract invoice.pdf

# Recursive, resumable batch
open-ocr-cli extract ./documents \
  --output ./results \
  --concurrency 4 \
  --resume

# Built-in structured invoice artifacts
open-ocr-cli extract ./invoices \
  --preset invoice \
  --format all \
  --output ./results

# Arbitrary JSON Schema, validated before and after the provider request
open-ocr-cli extract invoice.pdf \
  --schema invoice.schema.json \
  --output invoice.json

# Iterative tool-based field recovery with targeted region re-OCR
open-ocr-cli extract scan.pdf \
  --mode agentic \
  --format json \
  --max-iterations 6

# Safe public-URL extraction
open-ocr-cli web https://example.com/report.pdf --format markdown

# Validate discovery, schemas, limits, and output plans without credentials
open-ocr-cli extract ./documents --dry-run

# Pipeline events and a final machine-readable summary
open-ocr-cli extract ./documents --jsonl --quiet --output ./results

# Inspect a completed or interrupted batch
open-ocr-cli status ./results --json

# Binary stdin
cat scan.png | open-ocr-cli extract - --stdin-name scan.png --format json
```

Supported local formats are PNG, JPEG, WebP, HEIC, HEIF, and PDF. PDFs are
limited to 50 MB and 1,000 pages; images are limited to 70 MB raw. Defaults are
1,000 files, 5,120 MB total, and concurrency 2.

## Configuration

Precedence from lowest to highest:

1. `~/.config/gemini-ocr/config.json` (legacy)
2. `~/.config/open-ocr-cli/config.json`
3. `./.gemini-ocr.json` (legacy)
4. `./.open-ocr-cli.json`
5. `--config <path>`
6. CLI flags

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.6",
  "gateway": "direct",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "thinking": "MEDIUM",
  "concurrency": 4,
  "retries": 3,
  "requestsPerMinute": 60,
  "maxCostUsd": 5,
  "resume": true,
  "format": "markdown"
}
```

Provider fields include `provider`, `gateway`, `model`, `baseUrl`, `apiKeyEnv`,
`cloudflareAccountId`, `cloudflareGatewayId`, `cloudflareTokenEnv`,
`cloudflareByok`, `cloudflareByokAlias`, `cloudflareProvider`,
`inputPricePerMillionUsd`, and `outputPricePerMillionUsd`.

Unknown keys are ignored with a warning and do not leak through `doctor --json`.
`open-ocr-cli init` writes new configuration atomically with mode `0600`.

## Batch and automation contracts

The default output directory remains `./gemini-ocr-output` for backwards
compatibility. It contains artifacts, `.gemini-ocr-manifest.json`,
`.gemini-ocr.lock`, and `batch-summary.json`.

- Existing output is never replaced without `--overwrite`.
- Every discovered input gets a succeeded, partial, failed, or skipped result.
- All output destinations are preflighted before paid work starts.
- An exclusive batch lock prevents concurrent manifest races.
- `--resume` fingerprints every output-affecting option, including provider,
  gateway route, model, schema, and agent settings.
- Progress and diagnostics use stderr; artifacts and JSONL use stdout.
- Request starts are evenly spaced by `--requests-per-minute` across every API
  surface, including agent continuations and Kimi file extraction.
- `--max-cost` blocks future requests after recorded or estimated cost reaches
  the limit. In-flight requests can finish slightly above it.
- Known Gemini, Kimi K2.6, and Muse Spark 1.1 prices are estimated locally,
  including Kimi cached-input tokens. OpenRouter-reported cost is recorded when
  available. Supply both `--input-price` and `--output-price` for unknown models.
- Truncated, blocked, empty, malformed, and schema-invalid responses fail closed.

Custom structured extraction remains locally validated on every provider.
Direct Kimi uses Moonshot's optional-property strict schema dialect. Other
OpenAI-compatible routes receive non-strict schema hints so optional fields are
not rejected up front, then the CLI validates the result against the complete
original schema before writing it.

Exit status is `0` for success, `1` for failed/partial/cost-limited work, `2` for
command or configuration errors, `130` for SIGINT, and `143` for SIGTERM.

## Coding-agent protocol

Codex, Claude Code, CI runners, and other automation can discover one stable,
versioned interface instead of reconstructing interactive flags:

```bash
open-ocr-cli capabilities --json
open-ocr-cli schema request
open-ocr-cli schema result
open-ocr-cli schema event
open-ocr-cli schema error
```

Submit a request from a JSON file (or use `--request -` for request JSON on
stdin):

```json
{
  "protocolVersion": 1,
  "operation": "extract",
  "inputs": [{ "type": "path", "path": "invoice.pdf" }],
  "extraction": {
    "mode": "template",
    "preset": "invoice",
    "contentFormat": "json"
  },
  "execution": {
    "maxCostUsd": 1,
    "timeoutSeconds": 120
  },
  "delivery": {
    "mode": "reference",
    "outputDirectory": "./ocr-results",
    "resume": true
  }
}
```

```bash
open-ocr-cli run --request request.json --response-format json
open-ocr-cli run --request request.json --response-format jsonl
```

JSON returns one `run.result`. JSONL returns ordered lifecycle events ending in
`run.completed` or `run.failed`. Both formats use typed error codes and return
artifact paths rather than embedding large document bodies. A request with
`"dryRun": true` validates input discovery, schemas, limits, and planned
artifact references without credentials, provider calls, or writes.

When `delivery.outputDirectory` is omitted, agent runs use
`.open-ocr-results/<runId>`. A fixed output directory with `resume: true`
supports both single-document and batch resume. Partial documents use the
dedicated `document.partial` JSONL event.

The npm package ships the Draft 2020-12 request, result, event, error, and
capabilities schemas under `schemas/`. Schema `$id` URLs are stable identifiers,
not network endpoints; use `open-ocr-cli schema <name>` or the bundled files.
The shared Open OCR skill ships under `skills/open-ocr/` in npm and lives at
`integrations/open-ocr/skills/open-ocr/SKILL.md` in the repository.

## Web and agentic behavior

Gemini Web OCR uses URL Context and verifies retrieval metadata. Other providers
use a bounded local downloader that rejects unsafe hosts, resolves every DNS
address as public, covers IPv4, IPv6, and IPv4-mapped IPv6, pins the selected
address, validates every redirect, and enforces a 30-second socket inactivity
timeout. Retrieved HTML is converted with a structure-aware text parser before
being sent to the model.

Gemini agentic OCR uses stored Interactions. Compatible providers keep a local
OpenAI-style transcript, return a result for every tool call, execute parallel
requests sequentially, and preserve Kimi `reasoning_content` and OpenRouter
`reasoning_details`. All providers use the same deterministic field validation,
confidence/coverage stop criteria, and region cropper.

## Distribution

- npm: `npm install --global open-ocr-cli`
- container: `ghcr.io/cyanxxy/open-ocr-cli:latest`
- GitHub Action: `uses: cyanxxy/gemini-ocr@v2`
- Homebrew: tagged releases attach a generated `open-ocr-cli.rb` formula

The container runs as the non-root `node` user. Mount input and output beneath
its writable `/work` directory:

```bash
docker run --rm -v "$PWD:/work" -e GEMINI_API_KEY \
  ghcr.io/cyanxxy/open-ocr-cli:latest \
  extract /work/invoice.pdf --output /work/gemini-ocr-output
```

Release automation runs typechecking, lint, tests, the web build, packed install
smoke, npm provenance publishing, multi-architecture container publishing, and
GitHub release generation from the same tag.

Full architecture, security, development, and evaluation documentation lives in
the [project README](https://github.com/cyanxxy/gemini-ocr#readme).
