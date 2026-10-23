# Network access at startup

Restoring state never contacts the network. Each entry point makes only the requests listed here, and each is checked by `test/startup-network.test.ts`.

| Entry point | Requests at startup | Configured by |
|---|---|---|
| `RightClick.create()` (every host) | **None.** Network providers typed by an older inference version, or deferred by an earlier load, stay deferred knowledge: listed by `context_providers` and `context_explain`, never executable. They are re-derived on their first use (`context_run`, `context_compose`, a saved goal, or a goal's independent witness) under that call's egress policy, or by `context_learn`. Environment catalogs are not refreshed at startup. | — |
| Node CLI (`rcx mcp`, `rcx <command>`) | None beyond `create()`. `rcx doctor` does not create a runtime at all. `rcx serve --demo` starts local demo services on loopback and learns them. | `serve --demo` |
| Edge Worker (`src/entry/edge.ts`) | Learns each `RCX_SOURCES` URL on every isolate cold start. | `RCX_SOURCES` (unset: none) |
| Durable Object (`src/entry/durable.ts`) | One `GET https://cloudflare.com/cdn-cgi/trace` per object start, to report the datacenter actually serving it. Bounded at 2 s; on failure the configured `RCX_LOCATION` is reported. | always |

Local programs are different. A program typed by an older inference version is re-investigated at startup in the host sandbox. That is local execution, and it reaches the network only when the operator allows it (`RCX_SANDBOX_NET=allow`). A program that cannot be investigated there (no program authority or no sandbox) is deferred, not dropped.

`rcx doctor` reports the Node behaviour as "startup network: none".
