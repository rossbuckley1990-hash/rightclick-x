// Known failing acceptance: metadata is not yet protected by a trusted
// operator classification boundary. Exit 1 when the opaque value leaks.
import { RightClick } from "../../src/runtime.ts";
import { reflectOpenAPI } from "../../src/reflectors/openapi.ts";
import { MemoryStore } from "../../test/helpers.ts";

const canary = "opaque-fixture-metadata-82641";
const store = new MemoryStore();
const rc = await RightClick.create({ directories: [], store, authority: { shareEvidence: true } });
rc.graph.add(reflectOpenAPI({ openapi: "3.0.0", info: { title: canary }, servers: [{ url: "https://metadata.test" }],
  paths: { "/": { get: { operationId: "list", responses: { "200": { description: "ok" } } } } } }, "https://metadata.test/spec"));
// A synthetic CLI reflection demonstrates that public knowledge export includes
// unclassified program/provider text as well; no local program is executed.
rc.graph.addCapability({ id: "cli:fixture:run", provider: "cli:fixture", source: "cli", title: "fixture", description: canary,
  tags: [], risk: "read", inputs: [], outputs: [], invoke: { kind: "builtin", fn: "fixture" } },
  { id: "cli:fixture", title: "fixture", source: "cli", origin: "/fixture", learnedAt: new Date().toISOString(),
    meta: { investigation: { program: { name: "fixture", bin: "/fixture", sha256: "0".repeat(64) }, runs: [], summary: canary, claims: [] } } });
const goal = await rc.compose({ have: { text: "example" }, want: "hash", through: ["builtin:text.sha256"], run: true, publish: canary });
await rc.flush();
const stateLeak = JSON.stringify(store.state).includes(canary);
const graphLeak = JSON.stringify(rc.graph.list()).includes(canary);
const exportLeak = JSON.stringify(rc.exportKnowledge()).includes(canary);
process.stdout.write(JSON.stringify({ goalDurable: goal.published?.durable, stateLeak, graphLeak, exportLeak,
  disposition: stateLeak || graphLeak || exportLeak ? "FAIL_UNCLASSIFIED_METADATA_RETAINED" : "METADATA_CANARY_NOT_OBSERVED" }) + "\n");
if (stateLeak || graphLeak || exportLeak) process.exitCode = 1;
