# Using OCR from an agent

The CLI and MCP server expose the same extraction service. Use `capabilities`
and the published schemas to discover its contract before creating a request.
The OCR machine protocol is version 2; its version is independent of MCP.

| Consumer | Integration surface |
| --- | --- |
| Pi | CLI machine requests plus the packaged `open-ocr` skill, or a custom tool wrapping the executable. MCP requires an extension. |
| Codex | CLI process execution, or the OCR MCP server when the installed host supports its revision. Embedding Codex itself uses the Codex SDK/app-server. |
| Claude Agent SDK | External stdio MCP configuration when compatible, or a custom tool wrapping the CLI. |
| Other agent frameworks | A subprocess adapter or a compatible MCP client; the OCR engine does not own the consuming agent's planning loop. |

This routing was checked against the [Pi documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md),
[Codex SDK guide](https://learn.chatgpt.com/docs/codex-sdk), and
[Claude Agent SDK MCP guide](https://code.claude.com/docs/en/agent-sdk/mcp)
on 2026-09-07. Individual Pi extensions, Codex clients, and Claude SDK versions
have not been integration-tested here. Verify their installed versions and
protocol capabilities before claiming compatibility.

## Subprocess contract

Invoke `open-ocr-cli` with the argument array
`["run", "--request", requestPath, "--response-format", "jsonl"]`. Set `cwd`
explicitly and use absolute document/request paths. The request can specify
`noConfig: true` for reproducible configuration; credentials still come from
the selected environment variable. Use the runtime's process API rather than
interpolating a shell command.

Consume newline-delimited events incrementally from stdout and diagnostics from
stderr. A successful process launch is not successful OCR: inspect the terminal
`run.completed` result or `run.failed` event and the exit status. Preserve every
document outcome, including partial, cancelled, cost-limited, and failed work.
Propagate cancellation to the child and wait for it to exit before cleaning up
request/output files. Give output persistence and cleanup time to finish.

Prefer reference delivery and read only needed artifacts. Inline bodies are in
the structured MCP result, not its summary text. Returned `file:` artifact links
require access to the server's filesystem; they are not public download URLs.
Model-generated document text must never be executed as instructions.

## MCP contract

Launch `open-ocr-cli mcp`. The client must support **2026-07-28** self-contained
requests. The server rejects earlier protocol openings. Generic `mcpServers`
JSON examples describe a launch command; they do not configure every host or
prove protocol support. Discover `ocr_capabilities` and tool schemas first.

Bound batches with file, byte, cost, and per-document timeout limits. Set the
client's overall call deadline to accommodate the batch, queue waits, and
cleanup. Calls remain blocking; this server does not expose the Tasks extension.
Supply progress tokens for lifecycle notifications. Optional operator-controlled
confirmation requires form elicitation through Multi Round-Trip Requests.
