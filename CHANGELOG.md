# Changelog

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
