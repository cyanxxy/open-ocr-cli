# Open OCR CLI

Provider-neutral multimodal OCR for images, PDFs, public URLs, structured
schemas, and difficult document agents. It supports Gemini, Kimi K3, Meta
Muse Spark 1.1, OpenRouter, generic OpenAI-compatible APIs, and Cloudflare AI
Gateway.

## Install

Node.js 20.19+, 22.13+, or 24+ is required.

```bash
npm install --global open-ocr-cli
export GEMINI_API_KEY="your-key"
open-ocr-cli interactive
```

`open-ocr-cli` is the executable and npm package.

Running with no arguments always prints help, including inside a
pseudo-terminal. Launch the guided arrow-key menu explicitly with
`open-ocr-cli interactive`; press Enter to select and Ctrl-C to cancel.

For a project-local install, use `npx open-ocr-cli`. Direct subcommands such as
`open-ocr-cli extract invoice.pdf` remain non-interactive and safe for scripts
and CI.

## Upgrading from 2.x

3.0 keeps one current contract and ships no compatibility shims, so each of these
is a rename or a removal rather than a deprecation. All of them fail loudly.

| 2.x | 3.0 |
| --- | --- |
| `gemini-ocr` executable | `open-ocr-cli` |
| `~/.config/gemini-ocr/config.json`, `./.gemini-ocr.json` | `~/.config/open-ocr-cli/config.json`, `./.open-ocr-cli.json` |
| `GEMINI_OCR_MODEL`, `GEMINI_OCR_THINKING` | `OPEN_OCR_MODEL`, `OPEN_OCR_THINKING` |
| `GEMINI_OCR_DEBUG` | `OPEN_OCR_DEBUG` |
| `./gemini-ocr-output` | `./open-ocr-output` |
| `.gemini-ocr-manifest.json`, `.gemini-ocr.lock` | `.open-ocr-manifest.json`, `.open-ocr.lock` |
| `--include-thoughts` | `--progress standard` |
| `"protocolVersion": 1` requests | `"protocolVersion": 2` |
| `schema request-v1` and the other `-v1` schemas | `schema request` (v2) |
| MCP clients on the 2025 `initialize` handshake | hosts opening revision `2026-07-28` |
| `uses: cyanxxy/open-ocr-cli@v2` | `uses: cyanxxy/open-ocr-cli@v3` |

Four behavior changes have no rename to make:

- **Existing output directories are not readable.** `status` and `--resume`
  require `provider` and `gateway` in `batch-summary.json`, which 2.x omitted for
  Gemini runs. Point them at a fresh `--output` directory; both report
  `INPUT_INVALID` saying so rather than failing obscurely.
- **`--resume` re-extracts `partial` documents** instead of skipping them, so a
  resumed batch finishes work it previously stranded — and bills for it.
- **`--retries` and `--verbose` are mode-scoped.** Agentic runs already ignored
  `--retries`; they now say so on stderr. See the mode-scoping table below.
- **`web` ignores an inherited `format` of `csv` or `all`** and uses Markdown,
  where 2.x failed the run.

Renaming a config file is usually the whole migration:

```bash
mv ~/.config/gemini-ocr/config.json ~/.config/open-ocr-cli/config.json
mv .gemini-ocr.json .open-ocr-cli.json
open-ocr-cli doctor            # confirms the config and credentials resolve
```

Delete any `includeThoughts` key while you are there; it is no longer accepted
and an unknown key is warned about and dropped.

## Pick a provider

```bash
# Gemini (default)
export GEMINI_API_KEY="your-key"
open-ocr-cli extract invoice.pdf

# Kimi K3
export MOONSHOT_API_KEY="your-key"
open-ocr-cli extract invoice.pdf --provider kimi

# Meta Muse Spark 1.1 public preview
export META_API_KEY="your-key"
open-ocr-cli extract scan.png --provider muse

# Kimi or another multimodal model through OpenRouter
export OPENROUTER_API_KEY="your-key"
open-ocr-cli extract invoice.pdf \
  --provider openrouter \
  --model moonshotai/kimi-k3

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

| Profile | Default model | Image input | PDF handling | Structured output |
| --- | --- | --- | --- | --- |
| `gemini` | `gemini-3.5-flash` | PNG, JPEG, WebP, HEIC, HEIF | Native PDF input | Yes |
| `kimi` | `kimi-k3` | PNG, JPEG, WebP, GIF | Kimi file extraction | Yes |
| `muse` | `muse-spark-1.1` | PNG, JPEG, WebP, GIF | PDFs supported | Yes |
| `openrouter` | `google/gemini-3.5-flash` | PNG, JPEG, WebP, GIF | Model-dependent | Model-dependent |
| `openai-compatible` | Required | Endpoint-dependent | **Rejected locally** | Endpoint-dependent |

Note the two asymmetries: **GIF is not accepted on the default `gemini` profile**
and **HEIC/HEIF is accepted only there**. The `openai-compatible` profile refuses
PDFs before any request, because a generic endpoint advertises no document
capability to check. `open-ocr-cli capabilities --json` publishes the exact
`inputImageMimeTypes` per profile; an absent list means model/endpoint-specific.

Kimi K3 accepts only LOW, HIGH, and MAX reasoning effort, including through
OpenRouter; `--thinking minimal` is mapped to LOW there rather than refused,
while `medium` and `xhigh` are refused so no level is silently upgraded. Other OpenRouter model IDs use the router's provider-neutral
MINIMAL, LOW, MEDIUM, HIGH, XHIGH, and MAX effort vocabulary; OpenRouter maps
unsupported levels to the closest effort exposed by that model. The CLI allows
non-Gemini compatible routes to request up to 1,048,576 output tokens. The
selected upstream model may
advertise and enforce a smaller limit.

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
# (a bare `open-ocr-cli` prints help and never prompts)
open-ocr-cli interactive

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
open-ocr-cli web https://en.wikipedia.org/wiki/Optical_character_recognition --format markdown

# Validate discovery, schemas, limits, and output plans without credentials
open-ocr-cli extract ./documents --dry-run

# Protocol v2 lifecycle events, one per line, ending in run.completed
open-ocr-cli extract ./documents --jsonl --quiet --output ./results

# Inspect a completed or interrupted batch
open-ocr-cli status ./results --json

# Binary stdin (PNG/JPEG/WebP/GIF/HEIC/HEIF/PDF type is sniffed automatically)
cat scan.png | open-ocr-cli extract - --format json
```

Discovery accepts PNG, JPEG, WebP, GIF, HEIC, HEIF, and PDF, but **which of them
the selected provider accepts is narrower** — see the profile table above. PDFs
are limited to 50 MB and 1,000 pages; images are limited to 70 MB raw. Defaults
are 1,000 files, 5,120 MB total, and concurrency 2. Video formats such as MP4 are
not OCR inputs, even when the selected model has a broader video capability.
HEIC/HEIF is native on Gemini only; the named Kimi, Muse, and OpenRouter profiles
reject it locally with a conversion hint and accept GIF, which Gemini does not.
Muse PDFs use Meta's documented Chat Completions file part. Known profiles
expose their usable `inputImageMimeTypes` through
`open-ocr-cli capabilities --json`; absence means model/endpoint-specific.
A rejected media type fails locally as `INPUT_INVALID` before any billed request.

## Configuration

Precedence from lowest to highest:

1. `~/.config/open-ocr-cli/config.json`
2. `./.open-ocr-cli.json`
3. `--config <path>`
4. `OPEN_OCR_*` environment variables
5. CLI flags

The environment overrides are `OPEN_OCR_PROVIDER`, `OPEN_OCR_GATEWAY`,
`OPEN_OCR_MODEL`, and `OPEN_OCR_THINKING`. `OPEN_OCR_NO_CONFIG=1` ignores every
configuration file and the project `.env`, `OPEN_OCR_MCP_CONFIRM=1` gates billed
MCP runs behind an elicited confirmation, and `OPEN_OCR_DEBUG=1` adds a stack
trace to fatal errors on stderr. Credentials are read only from the provider key
variable (`--api-key-env` / `apiKeyEnv` selects which one).

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k3",
  "gateway": "direct",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "thinking": "MAX",
  "progress": "standard",
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

### Directory discovery

A directory scan is recursive and skips `node_modules`, `dist`, `build`,
`vendor`, and `target`, so pointing at a repository does not spend most of the
scan walking its dependency and build trees, and sprite sheets and favicons do
not land in the results. Whatever a scan passes over is always reported on
stderr, both the unsupported file types and the excluded directories, so the
document set never shrinks silently.

The excludes apply to directory scans only. Naming a file, naming the directory
itself (`extract ./dist`), or passing your own glob (`extract 'dist/**/*.pdf'`)
is explicit intent and is never filtered. To scan them during a recursive walk,
pass `--no-default-excludes` or set `"defaultExcludes": false`. Hidden entries
stay pruned unless `--hidden` is passed, and `--exclude <glob>` adds patterns.

Unknown keys are ignored with a warning and do not leak through `doctor --json`.
`open-ocr-cli init` writes new configuration atomically with mode `0600`.
For agents and CI, use `open-ocr-cli init --yes`; interactive init intentionally
prompts when attached to a terminal.
`open-ocr-cli doctor --json` performs local checks only. Use
`open-ocr-cli doctor --check-credentials --json` when an agent must prove that
the configured credential and endpoint can complete a minimal request.
Use `--no-config` or set `OPEN_OCR_NO_CONFIG=1` to ignore all config files and
the project `.env` for a fully hermetic `extract`, `run`, `web`, or `doctor` invocation.

## Batch and automation contracts

The two entry points use separate default output directories:

- `extract` writes to `./open-ocr-output`. Override it with `--output <path>`.
  A single document normally prints to stdout instead; it is written to files
  whenever `--output` is given **or** `--format all` is selected, since `all`
  produces several artifacts that cannot share one stream.
- `run` and the MCP tools write to `./.open-ocr-results/<runId>` whenever
  `delivery.outputDirectory` is omitted and delivery mode is `reference`, so
  concurrent agent runs never collide. Override it with
  `delivery.outputDirectory`.

Either directory holds the same layout: artifacts, `.open-ocr-manifest.json`,
`.open-ocr.lock`, and `batch-summary.json`.

- Existing output is never replaced without `--overwrite`.
- Every discovered input gets a succeeded, partial, failed, or skipped result.
- All output destinations are preflighted before paid work starts.
- An exclusive batch lock prevents concurrent manifest races.
- `--resume` fingerprints every output-affecting option, including provider,
  gateway route, model, schema, and agent settings.
- Progress and diagnostics use stderr; machine results use stdout.
  `extract --jsonl` and `run --response-format jsonl` emit the same stream:
  protocol v2 lifecycle events, one JSON object per line, validated by
  `event-v2.schema.json`. There is one dialect to consume.
- A JSONL stream always ends in exactly one terminal event: `run.completed`
  when the batch produced a summary, otherwise a single `run.failed` carrying
  the typed `code`, `category`, `retryable`, and `hint` fields. Unknown flags
  and pre-flight failures end the stream that way too, so an empty stream
  never has to be interpreted.
- Anything the run could not honour in full — flags the resolved mode does not
  read, documents a directory scan passed over, a resume that cannot match, a
  schema construct the provider may refuse — is a `run.warning` event on the
  stream and an entry in the result's `warnings` array, as well as a line on
  stderr.
- Request starts are evenly spaced by `--requests-per-minute` across every API
  surface, including agent continuations and Kimi file extraction.
- `--max-cost` blocks future requests after recorded or estimated cost reaches
  the limit. In-flight requests can finish slightly above it.
- Known Gemini and Kimi K3/K2.7/K2.6 prices are estimated locally, including
  published cached-input rates. OpenRouter-reported cost is recorded when
  available. Supply both `--input-price` and `--output-price` for unknown models
  and for Muse Spark while its public-preview price is not publicly documented.
- Truncated, blocked, empty, malformed, and schema-invalid responses fail closed.

Custom structured extraction remains locally validated on every provider.
Direct Kimi uses Moonshot's optional-property strict schema dialect. Other
known named routes receive `strict: true` only when the supplied schema
satisfies the narrower all-properties-required strict dialect. A generic
`openai-compatible` endpoint is treated as unknown and does not receive an
unsupported `strict` claim. The CLI always validates the result against the
complete original schema before writing it.

Exit status is `0` for success or a clean resume, `1` for failed, partial, or
cost-limited work, `2` for command or configuration errors, `130` for SIGINT,
and `143` for SIGTERM.

## Models, reasoning, and cost

Gemini model IDs are validated because their thinking and pricing contracts are
known. Other profiles accept upstream model IDs.

| Model | Role | Thinking levels |
| --- | --- | --- |
| `gemini-3.5-flash` | Default; recommended for most documents | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3.1-flash-lite` | Lower-cost, high-volume extraction | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3-flash-preview` | Preview Flash option | MINIMAL · LOW · MEDIUM · HIGH |
| `gemini-3.1-pro-preview` | Highest-reasoning option | LOW · MEDIUM · HIGH |
| `kimi-k3` | Default Kimi multimodal and agentic route | LOW · HIGH · MAX |
| `kimi-k2.7-code` | Kimi coding/agent route; thinking always on | HIGH (fixed) |
| `kimi-k2.7-code-highspeed` | Faster K2.7 Code route | HIGH (fixed) |
| `kimi-k2.6` | Kimi multimodal route | MINIMAL · HIGH |
| `muse-spark-1.1` | Meta public-preview multimodal route | MINIMAL · LOW · MEDIUM · HIGH · XHIGH |
| `moonshotai/kimi-k3` | Kimi through OpenRouter | LOW · HIGH · MAX |
| Other OpenRouter models | Selected by upstream ID | Model-dependent (MINIMAL–MAX accepted) |

Defaults are model-aware: Gemini 3.5 Flash **MEDIUM**, Flash-Lite **MINIMAL**,
3 Flash Preview and 3.1 Pro **HIGH**, Kimi K3 **MAX**. Explicitly supported
levels are preserved in agentic mode rather than silently raised.

This table is documentation; when a provider exposes reasoning controls, the
machine-readable copy is `capabilities --json` → `providers[].reasoning`. It
gives `byModel[<model>]` (`levels` and `defaultLevel`) plus `fallbackLevels` for
an upstream model ID the profile does not list. An omitted `reasoning` field
means the generic endpoint does not expose a portable control. Prefer this
metadata over parsing the table.

Built-in paid-tier estimates, USD per million tokens:

| Model | Input | Cached input | Output and reasoning |
| --- | ---: | ---: | ---: |
| `gemini-3.5-flash` | $1.50 | $0.15 | $9.00 |
| `gemini-3.1-flash-lite` | $0.25 | $0.025 | $1.50 |
| `gemini-3-flash-preview` | $0.50 | $0.05 | $3.00 |
| `gemini-3.1-pro-preview` | $2.00 / $4.00 above 200K input | $0.20 / $0.40 | $12.00 / $18.00 |
| `kimi-k3` | $3.00 | $0.30 | $15.00 |
| `kimi-k2.7-code` | $0.95 | $0.19 | $4.00 |
| `kimi-k2.7-code-highspeed` | $1.90 | $0.38 | $8.00 |
| `kimi-k2.6` | $0.95 | $0.16 | $4.00 |

Provider prices change, so verify the provider's own pricing page before
budgeting a large run.

Use `--progress off|standard|detailed` to choose observability **in agentic
mode**: standard keeps model output, provider thought summaries, and tool
lifecycle metadata; detailed also exposes provider reasoning and tool payloads.
Simple and template extraction is a single request with no step stream, so
`--progress` (and `extraction.progress`) is reported as an ignored option there.
Reasoning state needed for a tool continuation is always replayed to the provider
regardless of visibility.

The same mode scoping applies to several other options:

| Option | Protocol field | Honoured in |
| --- | --- | --- |
| `--detect-images`, `--detect-math`, `--instruction` | `extraction.detectImages`, `.detectMath`, `.instructions` | simple |
| `--max-iterations`, `--confidence-threshold` | `extraction.maxIterations`, `.confidenceThreshold` | agentic |
| `--progress` | `extraction.progress` | agentic |
| `--retries` | `execution.retries` | simple, template |
| `--verbose` | *(none)* | agentic |

`--retries` is scoped out of agentic mode because the agent loop owns its own
bounded provider retries and the outer wrapper is pinned to a single attempt; an
agentic run therefore takes `--retries 5` and performs one attempt. `--verbose`
prints agent steps and nothing else, so outside agentic mode it is a no-op rather
than "more output"; it has no protocol counterpart, so `run`/MCP never name a
request key for it.

Supplying any of these outside its mode is never silent: the CLI writes
`ignoring option(s) that <mode> mode does not use: …` to stderr, and `run`/MCP
report it on the warning channel.

## Coding-agent protocol

Codex, Claude Code, CI runners, and other automation can discover one stable,
versioned interface instead of reconstructing interactive flags:

```bash
open-ocr-cli capabilities --json
open-ocr-cli schema request
open-ocr-cli schema result
open-ocr-cli schema event
open-ocr-cli schema error
open-ocr-cli schema capabilities
```

An unknown name exits 2 with a typed `CONFIG_INVALID` error whose `hint` lists
every accepted name, so a wrong guess costs one call rather than a doc lookup.

Submit a request from a JSON file (or use `--request -` for request JSON on
stdin):

```json
{
  "protocolVersion": 2,
  "operation": "extract",
  "inputs": [{ "type": "path", "path": "invoice.pdf" }],
  "extraction": {
    "mode": "template",
    "preset": "invoice",
    "contentFormat": "json"
  },
  "execution": {
    "maxFiles": 50,
    "maxTotalMb": 200,
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

Each input object is keyed on `type`, not `kind`. The `capabilities` document
lists the allowed values under `inputKinds`, but that names the value list, not
the field — `kind` is the discriminator used by artifacts and progress steps,
and inputs are the one union keyed on `type`. A request using `{ "kind": ... }`
is rejected.

The machine protocol also accepts a binary stdin document when the request
itself is stored in a file:

```json
{
  "protocolVersion": 2,
  "operation": "extract",
  "inputs": [{ "type": "stdin", "name": "scan.png" }],
  "delivery": { "mode": "inline" }
}
```

```bash
cat scan.png | open-ocr-cli run --request stdin-request.json --response-format jsonl
```

The media type is sniffed when `name` and `mimeType` do not identify it. Request
JSON and document bytes cannot both occupy stdin, so do not combine a stdin
document with `--request -`.

Public URLs use the same machine job service and lifecycle protocol:

```json
{
  "protocolVersion": 2,
  "operation": "extract",
  "inputs": [
    { "type": "url", "url": "https://en.wikipedia.org/wiki/Optical_character_recognition" },
    { "type": "url", "url": "https://en.wikipedia.org/wiki/Document_layout_analysis" }
  ],
  "web": { "analysis": "combined" },
  "extraction": { "mode": "simple", "contentFormat": "markdown" },
  "delivery": { "mode": "reference", "outputDirectory": "./web-results", "resume": true }
}
```

URL inputs cannot be mixed with path or stdin inputs. They inherit the shared
timeout, request-rate, cost-limit, artifact, resume, and JSONL event contracts.

```bash
open-ocr-cli run --request request.json --response-format json
open-ocr-cli run --request request.json --response-format jsonl
```

JSON returns one `run.result`. JSONL returns ordered lifecycle events ending in
`run.completed` or `run.failed`. Both formats use typed error codes. Reference
delivery returns artifact paths; inline delivery returns only the requested
content format and can include typed agent steps for `contentFormat: "all"`. A request with
`"dryRun": true` validates input discovery, schemas, limits, and planned
artifact references without credentials, provider calls, or writes.

Every `run.result` carries a `warnings` array (empty when there is nothing to
say), and the JSONL stream carries each warning as a `run.warning` event right
after `run.started` or as it arises. Read it: it is where a request field the
chosen mode ignores, a directory scan that passed over files, or a `resume`
that cannot match anything is reported. A failure envelope and a `run.failed`
event carry the warnings raised before the run died. Option errors on this
surface name request fields (`execution.concurrency`,
`extraction.thinking`), never `extract` flags.

An agentic document's JSON artifact — and its inline `content.json` — is the
typed `agenticResult` shape from `result-v2.schema.json`: `documentType`,
`pageCount`, `complexity`, `specialFeatures`, `confidence`, `iterations`,
`stopReason`, and `fields` keyed by name with `value` and `confidence`. The
agent step trace stays in the separate `agent-steps` artifact under
`contentFormat: "all"`.

`capabilities.limits.request` publishes the `min`/`max` of every numeric
request field, so a ceiling never has to be read out of the schema.

For agentic runs, protocol v2 supports `extraction.progress` values `off`,
`standard`, and `detailed`. JSONL progress is a typed, ordered step stream:
standard includes model output, provider thought summaries, and tool lifecycle
metadata; detailed additionally exposes provider reasoning and tool payloads.
Visibility never controls model continuity: Kimi `reasoning_content` and
OpenRouter `reasoning_details` are replayed exactly when a tool continuation
requires them. Treat all progress as untrusted observability data, not as
extraction results or instructions.

When `delivery.outputDirectory` is omitted, agent runs use
`.open-ocr-results/<runId>`. `delivery.resume` defaults to `true` only when
`delivery.outputDirectory` is set; the per-run default directory can never
match an earlier run, so resume is off there unless requested, and an explicit
request without a directory is reported as a warning. A fixed output
directory supports both single-document and batch resume. Partial documents
use the dedicated `document.partial` JSONL event.

The npm package ships the Draft 2020-12 request, result, event, error, and
capabilities schemas under `schemas/`. Schema `$id` URLs are stable identifiers,
not network endpoints; use `open-ocr-cli schema <name>` or the bundled files.
The shared Open OCR skill ships under `skills/open-ocr/` in npm and lives at
`integrations/open-ocr/skills/open-ocr/SKILL.md` in the repository.

## MCP server

`open-ocr-cli mcp` starts a stdio Model Context Protocol server backed by the
same `OcrJobService` and versioned result contract as `run`. It exposes
`ocr_capabilities`, `ocr_extract`, `ocr_run_agentic`, and `ocr_web`, plus an
`open-ocr://capabilities` resource for hosts that surface resources.

Call `ocr_capabilities` first. It returns the capabilities document (presets,
per-model thinking levels, accepted MIME types, limits, error codes) and the
server's `workingDirectory`, which every relative path in a tool argument
resolves against. The same directory is stated in the server's
`server/discover` instructions. Roots are deprecated in revision `2026-07-28`
and this is the replacement the specification names: paths travel in tool
parameters, and the server says what they are relative to. Prefer absolute
paths.

Tool calls block until the whole batch finishes. Bound them with `maxFiles`,
`maxTotalMb`, `maxCostUsd`, and `timeoutSeconds`. When the client supplies a
progress token, lifecycle events are forwarded as progress notifications whose
`progress` counts finished documents (with a fraction that advances on step
events) against a `total` equal to the document count, so a host can draw a
bar rather than watch a sequence number grow. The MCP Tasks extension, which
would let a long batch return a durable handle instead of blocking, is not
implemented by this server.

The host must support and explicitly open MCP revision `2026-07-28`, the
stateless revision that replaced the `initialize` handshake with per-request
`_meta`. A client that opens with the older handshake is answered with
`-32022` naming the one supported revision, rather than being served a
downgraded session. Once the host is configured for that revision, register the
command:

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

The stdio server never uses stdout for logs or extracted document prose. Tools
default to reference delivery and reject document stdin — both `-` as an input
path and an explicit stdin input — because stdin belongs to the MCP transport.

Tool arguments are strict: an unrecognized key is refused by name rather than
dropped, so a misspelled `dryRun` cannot turn a validation pass into a billed
run. Every argument carries a description in `tools/list`, and the batch
envelope (`maxFiles`, `maxTotalMb`, `maxCostUsd`, `requestsPerMinute`,
`timeoutSeconds`) is settable per call. `ocr_extract` accepts an inline
`schema` as well as `schemaPath`, plus `detectImages`, `detectMath`, `hidden`,
and `exclude`.

Tools advertise an `outputSchema` (`result-v2.schema.json`), so the full result
envelope — including its `warnings` array — always arrives in
`structuredContent`, and written artifacts come back as `resource_link` blocks.
The accompanying text block mirrors that envelope for reference delivery, where
it is only metadata and paths; under inline delivery it collapses to a one-line
summary instead, because mirroring would send every extracted document body
twice in one response. That is a deliberate departure from the tools
specification's SHOULD that structured content also be serialised into a text
block. Read inline content from `structuredContent.documents[].content`, never
from the text block.

`tools/list`, `resources/list`, `resources/templates/list`, and the capabilities
resource are publicly cacheable for an hour. Discovery is privately cacheable
for an hour because its instructions contain the server working directory.

Set `OPEN_OCR_MCP_CONFIRM=1` to require confirmation before any run that reaches
a provider. Dry runs are never gated, and the switch is environment-only so the
calling model cannot turn it off. A client that declares no form elicitation
capability is answered with the protocol's `MissingRequiredClientCapability`
error (`-32021`) naming `elicitation.form`, not with a tool result that tells
the model to fix its arguments.

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
`reasoning_details`. Provider-authored progress remains available as typed v2
steps with stable streaming IDs. All providers use the same deterministic field
validation, confidence/coverage stop criteria, and region cropper.

## Distribution

- npm: `npm install --global open-ocr-cli`
- container: `ghcr.io/cyanxxy/open-ocr-cli:latest`
- GitHub Action: `uses: cyanxxy/open-ocr-cli@v3`
- Homebrew: tagged releases attach a generated `open-ocr-cli.rb` formula

The container runs as the non-root `node` user. Mount input and output beneath
its writable `/work` directory:

```bash
docker run --rm -v "$PWD:/work" -e GEMINI_API_KEY \
  ghcr.io/cyanxxy/open-ocr-cli:latest \
  extract /work/invoice.pdf --output /work/open-ocr-output
```

Release automation runs typechecking, lint, tests, the web build, packed install
smoke, npm provenance publishing, multi-architecture container publishing, and
GitHub release generation from the same tag.

Full architecture, security, development, and evaluation documentation lives in
the [project README](https://github.com/cyanxxy/open-ocr-cli#readme).
