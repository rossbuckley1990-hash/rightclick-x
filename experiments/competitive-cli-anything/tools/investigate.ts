import { writeFileSync } from "node:fs";
import { hostSandbox } from "../../../src/core/sandbox.ts";
import { investigateCli } from "../../../src/reflectors/cli.ts";

const [bin, out] = process.argv.slice(2);
if (!bin || !out) throw new Error("usage: investigate.ts <bin> <out.json>");
const sandbox = await hostSandbox();
if (!sandbox) throw new Error("no host sandbox");
const result = await investigateCli(bin, sandbox, { seed: 7 });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(result.reflection ? `reflection: ${result.reflection.capabilities.map((c) => c.id).join(", ")}` : "no reflection");
console.log(`summary: ${result.investigation.summary}`);
