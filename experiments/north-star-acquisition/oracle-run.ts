// Emit the oracle's independent expectations to evidence/, BEFORE any product run is compared.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { extractLinks } from "./oracle.ts";

const dir = new URL("./fixtures/", import.meta.url).pathname;
const out: Record<string, ReturnType<typeof extractLinks>> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
  out[f] = extractLinks(f, readFileSync(dir + f, "utf8"));
}
const record = {
  authoredAt: new Date().toISOString(),
  note: "Computed by experiments/north-star-acquisition/oracle.ts from fixtures/ alone. No RightClick X output was read. Written before the product runs it is compared against.",
  fixtures: out,
};
writeFileSync(new URL("./evidence/oracle-expected.json", import.meta.url).pathname, JSON.stringify(record, null, 2));
for (const [f, r] of Object.entries(out)) {
  console.log(`\n${f}`);
  console.log(`  absoluteHttp : ${JSON.stringify(r.absoluteHttp)}`);
  console.log(`  mailto       : ${JSON.stringify(r.mailto)}`);
  console.log(`  relative     : ${JSON.stringify(r.relative)}`);
  console.log(`  bareUrls(GFM): ${JSON.stringify(r.extensionDependentBareUrls)}`);
  console.log(`  excluded     : ${JSON.stringify(r.excludedByCodeOrComment)}`);
}
