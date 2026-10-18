// An old receiver must reject a bundle whose inference profile it cannot understand.
// Uses only an existing exposed fixture's synthetic evidence and authorised alias.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [producerRoot, receiverRoot, statePath, output] = process.argv.slice(2);
const { RightClick: Producer } = await import(pathToFileURL(`${producerRoot}/src/runtime.ts`).href);
const { RightClick: Receiver } = await import(pathToFileURL(`${receiverRoot}/src/runtime.ts`).href);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const producer = await Producer.create({ directories: [], sandbox: null, authority: { shareEvidence: true },
  store: { load: async () => state, save: async () => {} } });
const bundle = producer.exportKnowledge();
bundle.source.semantics = 999;
const receiver = await Receiver.create({ directories: [], authority: { investigate: bundle.programs.map((p: any) => p.path) },
  network: { origins: [], blockPrivate: true }, fetch: async () => { throw new Error("unexpected network"); } });
let report, error;
try { report = await receiver.importKnowledge(bundle); } catch (e) { error = String((e as Error).message); }
const accepted = report?.programs.flatMap((p: any) => p.capabilities).filter((c: any) => c.status === "accepted").length ?? 0;
writeFileSync(output, JSON.stringify({ producerRoot, receiverRoot, statePath, format: bundle.format,
  inferenceVersion: bundle.source.semantics, accepted, error, report,
  verdict: error && !accepted ? "REFUSED" : "UNSUPPORTED_PROFILE_ACCEPTED" }, null, 2) + "\n", { flag: "wx" });
