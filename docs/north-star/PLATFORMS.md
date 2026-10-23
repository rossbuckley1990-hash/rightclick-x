# Platform support (honest matrix)

Each status means:

- **Supported:** tested here and documented.
- **Tested:** run here with the result stated.
- **Partially tested:** some features run here.
- **Experimental:** builds, but is not exercised by this programme.
- **Unsupported:** known not to work.

| Environment | Status | Evidence | Notes |
|---|---|---|---|
| macOS 15/26 (Apple Silicon), Node 24 | **Tested** | 191 tests, proof 28/28, labs 30/30 ×2, adversarial and semantic suites, UCE challenge, benchmark | Program sandbox: `sandbox-exec` (deprecated by Apple, still shipped) |
| Linux (Debian 12, aarch64, Node 24) in a **privileged** container, bubblewrap 0.8 | **Tested** | 188/190 pass, 2 skipped (programs absent): `ci/linux.Dockerfile` | First time the Linux sandbox path has run. bubblewrap needs unprivileged user namespaces, hence `--privileged` in Docker |
| Linux in an **unprivileged** container (no user namespaces) | **Tested** (degrades correctly) | 152 pass, 38 skipped, 0 fail; `rcx doctor` reports no sandbox | Programs are reported unavailable and never run. Everything else works |
| Linux x86_64, other distributions | Partially tested | — | Same code paths. Not run here |
| Windows | **Unsupported** for local programs; other features untested | — | No sandbox implementation: programs are never investigated or run. The rest is TypeScript with no OS-specific code, but has not been tested |
| Cloudflare Workers (`src/entry/edge.ts`) | Experimental in this programme | `npm run build` produces `dist/edge.js` (0.33 MB) | Earlier main-branch experiments deployed it. It was not redeployed here (no paid infrastructure). Local programs are not available on Workers |
| npm package install (macOS) | **Tested** | `npm pack` → install into a clean project → `rcx version`/`doctor`/`investigate`/`capabilities`/MCP `tools/list` → `npm uninstall` leaves nothing | 1.3 MB installed; no runtime dependencies |
| MCP client: Claude Code 2.1 | **Tested** | Benchmark arm D, UCE challenge B | — |
| MCP client: Codex CLI | **Blocked** | Usage limit (resets 22 Oct) | Not shown to work in this programme |
| Other MCP clients (Cursor, VS Code, Claude Desktop, Windsurf) | Not tested | `rcx connect <client>` prints configuration | Standard MCP over stdio |
