// Strong deterministic saved-script control: derive contracts once, retain them, verify every call.
// No RightClick imports. This is NOT a model-authored benchmark arm.
import { createHash } from "node:crypto";
import { bridge, configuration, report } from "./comparison-transport.ts";
const started = performance.now();
const config = await configuration;
let state = config.state;
let result: any;
try {
  if (!state) {
    const [provider, observer] = await Promise.all([bridge(config.origin + "/openapi.json").then(r => r.json()), bridge(config.task.observer + "/openapi.json").then(r => r.json())]);
    const posts = Object.entries(provider.paths).filter(([, methods]: any) => methods.post);
    const gets = Object.entries(observer.paths).filter(([, methods]: any) => methods.get);
    if (posts.length !== 1 || gets.length !== 1) throw new Error("ambiguous fixture contract");
    const post: any = posts[0][1], get: any = gets[0][1];
    const inputs = Object.keys(post.post.requestBody.content["application/json"].schema.properties);
    if (inputs.length !== 1 || !get.get.parameters.some((p: any) => p.name === "candidate") || !get.get.parameters.some((p: any) => p.name === "label")) throw new Error("unsupported fixture contract");
    state = { post: new URL(posts[0][0], provider.servers[0].url).href, input: inputs[0], get: new URL(gets[0][0], observer.servers[0].url).href };
  }
  const reply = await bridge(state.post, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [state.input]: config.task.label }) });
  if (!reply.ok) throw new Error(`write returned ${reply.status}`);
  const value = await reply.json();
  if (value.accepted !== true || value.label !== config.task.label) throw new Error("wrong acknowledgement");
  const digest = createHash("sha256").update(value.label).digest("hex");
  const query = new URLSearchParams({ label: config.task.label, candidate: digest });
  const observed = await bridge(state.get + "?" + query).then(r => r.json());
  if (observed.present !== true) throw new Error("independent observer refuted effect");
  result = { status: "completed", label: value.label, digest, independentlyObserved: true };
} catch (error) { result = { status: "failed", error: String(error) }; }
const serialized = JSON.stringify(state);
report(config.phase, { ...result, arm: "C", clientMs: performance.now() - started, stateBytes: Buffer.byteLength(serialized) }, JSON.parse(serialized));
