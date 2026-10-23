// Same deterministic task/observer obligations as comparison-script.ts; no live model.
import { bridge, configuration, report } from "./comparison-transport.ts";
import { RightClick, type PersistedState } from "../../src/runtime.ts";
const started = performance.now();
const config = await configuration;
let state: PersistedState | null = config.state;
let result: any;
const rc = await RightClick.create({ directories: [], fetch: bridge,
  store: { load: async () => state, save: async value => { state = value; } } });
try {
  if (!state) await rc.learn({ sources: [config.origin + "/openapi.json", config.task.observer + "/openapi.json"] });
  const posts = rc.graph.list().filter(c => c.invoke.kind === "http" && c.invoke.method === "POST");
  const gets = rc.graph.list().filter(c => c.invoke.kind === "http" && c.invoke.method === "GET" && c.invoke.url.startsWith(config.task.observer));
  if (posts.length !== 1 || gets.length !== 1 || posts[0].inputs.length !== 1) throw new Error("ambiguous fixture contract");
  const run = await rc.run(posts[0].id, { [posts[0].inputs[0].name]: config.task.label });
  if (run.status !== "completed") throw new Error(run.error);
  const value: any = run.output;
  if (value.accepted !== true || value.label !== config.task.label) throw new Error("wrong acknowledgement");
  const hash = rc.graph.list().find(c => c.invoke.kind === "builtin" && c.invoke.fn === "text.sha256");
  if (!hash) throw new Error("no hash operation");
  const hashed = await rc.run(hash.id, { [hash.inputs[0].name]: value.label });
  if (hashed.status !== "completed" || typeof hashed.output !== "string") throw new Error("hash failed");
  const observed = await rc.run(gets[0].id, { label: config.task.label, candidate: hashed.output });
  if (observed.status !== "completed" || (observed.output as any)?.present !== true) throw new Error("independent observer refuted effect");
  result = { status: "completed", label: value.label, digest: hashed.output, independentlyObserved: true, runtimeVerification: run.verification.status };
} catch (error) { result = { status: "failed", error: String(error) }; }
await rc.flush();
const serialized = JSON.stringify(state);
report(config.phase, { ...result, arm: "D", clientMs: performance.now() - started, stateBytes: Buffer.byteLength(serialized) }, JSON.parse(serialized));
