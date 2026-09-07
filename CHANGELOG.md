# Changelog

## Unreleased

Agent-facing contract changes. Protocol v2 schemas, the `run`/MCP surfaces,
and the direct CLI's JSONL stream change together; there is no compatibility
branch.

### Fixed

- Restore the CI dependency audit by updating `fast-uri`, `html-to-text` /
  `deepmerge-ts`, `@humanfs/node`, and `fflate` to patched releases. Remove the
  obsolete advisory exception and clean up workflow shell lint findings.

- Keep every logger level on stderr so development logging cannot corrupt machine output.
- Keep MCP discovery private to the client because it includes the server cwd;
  clamp progress to its total and describe artifact replacement in tool annotations.
- Honor cancellation during document-start events and join failed worker pools
  before releasing the output lock.
- Fail closed when an agent operation rejects with an undefined or non-Error reason.
- Smoke-test the installed package's MCP stdio entry point as well as the CLI.

### Breaking changes

- Remove the obsolete browser application and its deployment tooling. Shared OCR
  code now lives in the private `@open-ocr/engine` workspace, bundled into the
  CLI and typechecked without DOM libraries.

- `extract --jsonl` emits protocol v2 lifecycle events, the same stream as
  `run --response-format jsonl`. The CLI-native `document`/`summary`/`error`
  record family carrying `"version": 1` is gone.
- `run.result` carries a required `warnings` array; the failure envelope and
  `run.failed` carry an optional one. A new `run.warning` event with a
  required `message` joins the event stream.
- An agentic document's JSON artifact and inline `content.json` are the typed
  `result-v2.schema.json#/$defs/agenticResult` shape instead of the engine's
  raw `AgentMemory`. The step trace remains in the `agent-steps` artifact.
- `capabilities.limits` drops `batchFiles` and `concurrency` and adds
  `request`, the `min`/`max` of every numeric request field.
- `delivery.resume` defaults to `true` only when `delivery.outputDirectory` is
  set. The per-run default directory can never match an earlier run, so
  resume is off there unless requested.
- Option errors on `run` and MCP name request fields (`execution.concurrency`,
  `extraction.thinking`) instead of `extract` flags.
- MCP: `ocr_run_agentic` no longer accepts `instructions`, which agentic mode
  never read.

### MCP

- New `ocr_capabilities` tool returning the capabilities document and the
  server's `workingDirectory`; the same directory is stated in the server's
  `instructions`. Tool descriptions say that calls block for the whole batch.
- `ocr_extract` accepts an inline `schema`, `detectImages`, `detectMath`,
  `hidden`, and `exclude`.
- Progress notifications count finished documents against a `total` instead
  of relaying a sequence number.
- A client that cannot form-elicit under `OPEN_OCR_MCP_CONFIRM=1` is answered
  with `MissingRequiredClientCapability` (`-32021`) naming `elicitation.form`.
- The inline-delivery text-block summary is documented as a deliberate
  departure from the tools specification's mirroring SHOULD.

### Machine protocol

- Warnings the run could not honour in full — ignored mode-scoped fields,
  discovery skips, a resume that cannot match, schema compatibility — reach
  the result and the event stream, not only stderr.
- Every numeric request bound is declared once in `packages/cli/src/limits.ts`
  and enforced by the schema, the option resolver, the MCP tool schemas, and
  `capabilities` alike; a test guards the schema against drift.
- Protocol requests no longer round-trip validated numbers through strings.

## 3.0.0 - 2026-08-11

`open-ocr-cli` 3.0 establishes the project contract.

### Breaking changes

- Version 3 is a clean contract with no migration or fallback paths for earlier
  project interfaces.
- MCP requires revision `2026-07-28`.
- The machine interface requires protocol v2.
- The executable and configuration namespace are `open-ocr-cli`.
- Direct extraction uses `open-ocr-output`, `.open-ocr-manifest.json`, and
  `.open-ocr.lock`.
- A batch output directory written by 2.x is not readable by this release.
  `status` and `--resume` require `provider` and `gateway` in
  `batch-summary.json`, which 2.x omitted for Gemini runs, and the metadata
  filenames changed. Re-run the extraction into a fresh output directory; both
  surfaces report `INPUT_INVALID` with that instruction rather than failing
  obscurely.
- `--include-thoughts` is removed. Use `--progress standard` (or
  `extraction.progress`), which is what the flag mapped to.
- `--resume` no longer skips documents recorded as `partial`. A partial document
  produced less than the extraction asked for, so it is re-extracted rather than
  accepted; a resumed batch that previously reported success while stranding the
  shortfall now does the remaining work and bills for it.
- `--retries` / `execution.retries` and `--verbose` are now mode-scoped and
  reported as ignored outside the modes that consume them. Agentic runs already
  performed a single outer attempt regardless of `--retries`; that is now stated
  instead of silent.
- `web` ignores a `format` of `csv` or `all` inherited from a configuration file
  and uses Markdown. Previously such a config failed the run.
- `OcrErrorType` drops `NETWORK_ERROR`, `RATE_LIMIT`, and `INVALID_RESPONSE`.
  Nothing constructed them; network and rate-limit failures arrive as provider
  errors carrying a status and are typed from that.

### MCP

- Serves Model Context Protocol revision `2026-07-28` over stdio.
- Uses stateless discovery, per-request client capabilities, cache hints,
  resource links, and signed multi-round-trip confirmations.

### Machine protocol

- Accepts and emits protocol v2 requests, results, lifecycle events, errors,
  and capabilities.
- Publishes Draft 2020-12 schemas for every machine payload.
- Supports inline and reference delivery with typed agent progress.

### CLI

- Installs the `open-ocr-cli` executable.
- Reads configuration from `~/.config/open-ocr-cli/config.json`,
  `./.open-ocr-cli.json`, or an explicit `--config` path.
- Writes direct extraction artifacts to `open-ocr-output` with
  `.open-ocr-manifest.json` and `.open-ocr.lock` metadata.
- Supports Gemini, Kimi, Muse, OpenRouter, generic OpenAI-style endpoints, and
  Cloudflare AI Gateway.

### Distribution

- Publishes the `open-ocr-cli` npm package, GitHub release artifacts, container,
  Homebrew formula, agent skill, and GitHub Action from one release commit.
- Upgrades PDF.js and transitive dependencies to patched versions so the
  release security gate reports no known vulnerabilities.

[Full comparison](https://github.com/cyanxxy/open-ocr-cli/compare/v2.7.0...v3.0.0)
