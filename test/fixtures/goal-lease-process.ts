import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";

const [file, mode] = process.argv.slice(2);
const store = new FileStore(file);
const rc = await RightClick.create({ store, directories: [] });
if (mode === "hold") {
  const original = store.withGoalLease.bind(store);
  store.withGoalLease = (pins, invoke) => original(pins, async () => {
    process.send?.({ event: "leased" });
    await new Promise<void>(resolve => process.once("message", () => resolve()));
    return invoke();
  });
}
process.send?.({ event: "ready" });
process.once("message", async () => {
  try {
    if (mode === "publish") {
      const result = await rc.compose({ have: { text: { type: "text", value: "new", fixed: true } },
        want: "hash", through: ["builtin:text.sha256"], run: true, publish: "shared" });
      process.send?.({ event: "done", durable: result.published?.durable === true, refusal: result.publishRefused });
    } else {
      const result = await rc.run("goal:shared", {});
      process.send?.({ event: "done", status: result.status, output: result.output, error: result.error });
    }
  } catch (error) { process.send?.({ event: "done", status: "refused", error: String((error as Error).message) }); }
  // Drain scheduled writes before leaving; a stale writer must not overwrite.
  await rc.flush().catch(() => {});
  process.disconnect();
});
