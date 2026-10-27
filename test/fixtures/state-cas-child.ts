import { FileStore } from "../../src/entry/node-host.ts";
import { STATE_REQUIREMENTS } from "../../src/core/state-format.ts";

const [file, marker] = process.argv.slice(2);
const store = new FileStore(file);
await store.load();
process.send?.({ event: "loaded" });
process.once("message", async () => {
  try {
    await store.save({ version: 2, requirements: [...STATE_REQUIREMENTS], reflections: [], receipts: [], ledger: { marker } });
    process.send?.({ event: "saved", marker }, () => process.disconnect());
  } catch (error) {
    process.send?.({ event: "refused", message: String((error as Error).message) }, () => process.disconnect());
  }
});
