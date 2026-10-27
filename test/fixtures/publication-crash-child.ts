// Instrument the real fs.rename in this subprocess only. The parent kills us
// at the requested barrier; this is a process-crash test, not a power-loss test.
import { createRequire, syncBuiltinESMExports } from "node:module";
import { RightClick } from "../../src/runtime.ts";
import { FileStore } from "../../src/entry/node-host.ts";

const [file, barrier] = process.argv.slice(2);
const nodeRequire = createRequire(import.meta.url);
const fs = nodeRequire("node:fs/promises") as typeof import("node:fs/promises");
const originalRename = fs.rename.bind(fs);
// syncBuiltinESMExports updates the dynamic built-in import used by FileStore.
// Do not intercept unrelated writes or add a production fault-injection API.
(fs as any).rename = async (from: string, to: string) => {
  let targetPublication = false;
  if (to === file && from.endsWith(".tmp")) {
    const envelope = JSON.parse(await fs.readFile(from, "utf8"));
    targetPublication = envelope?.state?.published?.some((g: any) => g.slug === "shared" && g.fixed?.text === "new") === true;
  }
  if (targetPublication && barrier === "before") {
    process.send?.({ event: "before-rename" });
    await new Promise<void>(() => {});
  }
  await originalRename(from, to);
  if (targetPublication && barrier === "after") {
    process.send?.({ event: "after-rename" });
    await new Promise<void>(() => {});
  }
};
syncBuiltinESMExports();

const rc = await RightClick.create({ store: new FileStore(file), directories: [] });
process.send?.({ event: "ready" });
process.once("message", async () => {
  try {
    await rc.compose({ have: { text: { type: "text", value: "new", fixed: true } }, want: "hash",
      through: ["builtin:text.sha256"], run: true, publish: "shared" });
    process.send?.({ event: "unexpected-completion" }, () => process.disconnect());
  } catch (error) {
    process.send?.({ event: "unexpected-error", message: String((error as Error).message) }, () => process.disconnect());
  }
});
