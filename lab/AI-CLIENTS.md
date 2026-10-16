# Any compatible AI: real agents through RightClick X

Run with `node lab/ai-clients.ts --domain <invoicing|logistics> --clients claude,codex`.

Two AI agents from different vendors, each given exactly one MCP server (RightClick X), the root addresses of a freshly generated Chameleon Lab environment, and the objective in plain language. Nothing else: no protocols, schemas, tool names or hints.

- **Claude Code** (Anthropic), headless, restricted to RightClick X's tools (`--strict-mcp-config`, all other tools disallowed).
- **Codex** (OpenAI), headless, with Codex's own automatic reviewer handling approval requests; its shell runs sandboxed in a temporary directory.
- Answers are checked against the harness's own copy of the data. Each agent gets its own RightClick X state file, so its receipts show which services it actually reached through RightClick X.
- Build `eb757bdebefc` (tag `lab-freeze-3`); environments generated after the freeze.

| Domain | Seed | Agent | Answer | Expected | Correct | Time | RightClick X receipts | Services reached through RightClick X |
|---|---|---|---|---|---|---|---|---|
| invoicing | 850002589 | claude | 14.4 | 14.4 | ✓ | 19.7 s | 5 | graphql:127-0-0-1-51527-graphql, mcp:quillbase, graphql:127-0-0-1-51529-graphql |
| invoicing | 850002589 | codex | 11 | 11 | ✓ | 53.7 s | 6 | graphql:127-0-0-1-51527-graphql, mcp:quillbase, graphql:127-0-0-1-51529-graphql |
| logistics | 414583200 | claude | 37.3 | 37.3 | ✓ | 42.2 s | 3 | openapi:fjordsoft, graphql:127-0-0-1-51712-graphql, mcp:quillbase |
| logistics | 414583200 | codex | 11.2 | 11.2 | ✓ | 52.4 s | 6 | openapi:fjordsoft, graphql:127-0-0-1-51712-graphql, mcp:quillbase |

**4/4 correct.** Each agent discovered the services through RightClick X (OpenAPI, GraphQL and MCP), composed the three-step chain, and answered from it.

What this run found and fixed on the way: RightClick X's tools did not declare MCP annotations, so Codex's non-interactive policy refused to call them; all 13 tools now declare `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.

Not covered: other MCP clients (Cursor, VS Code, Windsurf, Gemini CLI were not installed here); one run per agent per domain.
