// Diagnostic: what shapes do context_learn / context_graph / context_providers actually return?
import { connect } from "./mcp-client.ts";
const REPO = new URL("../../", import.meta.url).pathname;
const LYCHEE = "/opt/homebrew/bin/lychee";
const c = await connect({ repo: REPO, state: process.argv[2] ?? "/tmp/rcx-shape.json", investigate: LYCHEE, execute: LYCHEE });
const shape = (v: any, d = 0): any => {
  if (d > 3) return "…";
  if (Array.isArray(v)) return [`[${v.length}]`, v.length ? shape(v[0], d + 1) : null];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, shape(x, d + 1)]));
  return typeof v === "string" ? v.slice(0, 90) : v;
};
const learn = await c.callTool("context_learn", { source: `cli:${LYCHEE}` });
console.log("=== context_learn shape ===");
console.log(JSON.stringify(shape(learn), null, 1).slice(0, 3000));
console.log("\n=== learn.results[0] keys/values ===");
console.log(JSON.stringify(learn?.results?.[0] ?? null, null, 1)?.slice(0, 2500));
const graph = await c.callTool("context_graph", {});
console.log("\n=== context_graph shape ===");
console.log(JSON.stringify(shape(graph), null, 1).slice(0, 2500));
const prov = await c.callTool("context_providers", {});
console.log("\n=== context_providers shape ===");
console.log(JSON.stringify(shape(prov), null, 1).slice(0, 2000));
c.close();
