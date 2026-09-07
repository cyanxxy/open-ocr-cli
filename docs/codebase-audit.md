# Agent integration audit — 2026-09-07

Scope: shared extraction engine, CLI and MCP adapters, request/result schemas,
batch lifecycle and persistence, provider execution, agent progress, packaging,
evaluation tooling, and public integration guidance. Existing uncommitted
contract changes were preserved and used as the starting point.

## Fixed

| Finding | Change and evidence |
| --- | --- |
| The browser checkout contradicted the documented CLI/engine architecture | Relocated shared code to private `packages/engine`, changed consumers to workspace imports, removed the React host and its deployment dependencies, and switched tests/typechecks to Node without DOM libraries. |
| Logging could corrupt machine stdout | All logger levels use stderr, including development and enabled production logging. A regression test checks stdout stays untouched. |
| MCP discovery shared process-specific information through public caching | Discovery is privately cacheable; version-only catalogs remain public. Transport tests assert the distinction. |
| MCP progress could start above zero or exceed total | Start at zero and cap progress at the document total; verify monotonic bounded notifications. |
| Tool annotations understated resume side effects | Extraction tools declare that they may replace their own stale artifacts. |
| Cancellation during a document-start event could still launch extraction | Relay an already-aborted parent signal and check before invoking the extractor. Regression test verifies no extraction call occurs. |
| A worker failure could release the output lock while sibling workers remained active | Abort the pool and join all workers before propagating failure. Regression test checks lock lifetime while a sibling is finishing. |
| An undefined rejection could appear to be successful agent completion | Track rejection independently of the rejection value; test undefined, null, and string reasons. |
| Bundled engine packaging needed verification | Explicitly bundle the private engine and Gemini SDK, support bundled CommonJS dependencies in ESM, and exercise the installed tarball's lazy MCP entry point. |
| Build/release/docs still described a browser product | Update CI artifacts, Docker workspace manifests, release version checks, contributor/security guidance, and the distributed OCR skill. |

## Verification

- Typecheck: engine, CLI, and evaluation/tooling projects passed.
- Tests: 51 files, 687 tests passed. Browser-only suites were removed with their host.
- Coverage gate passed: 84.93% statements, 75.09% branches, 90.17% functions, 87.91% lines.
- Lint: zero errors; 87 warnings remain in the retained code/test surface. They are not represented as fixed by this audit.
- CLI build/help and install-from-tarball smoke passed.
- Packaged MCP stdio discovery, tool catalog, capabilities, invalid stdin input, and shutdown passed using protocol frames against the SDK-backed server.
- GitHub Action wrapper smoke and npm pack dry run passed.
- 64 evaluation cases and the canary provider matrix validated without provider calls. Used `node --import tsx` because the sandbox blocks the tsx CLI's IPC listener.
- Release version consistency and git diff whitespace checks passed.

## Verification limits

Provider behavior was exercised with mocks/local fixtures, not billed live OCR.
The packaged transport smoke is a protocol harness, not a live Pi extension,
Codex client, or Claude Agent SDK session. Those clients' exact MCP revision
support remains unverified. Docker configuration was updated but a container
build was not run. The server remains stdio-only with blocking calls and does
not implement the optional MCP Tasks extension.

See [agent integration guidance](agent-integrations.md) for supported contracts
and host-specific routing. This audit documents findings and checks; passing
tests is not a claim that every possible defect has been eliminated.
