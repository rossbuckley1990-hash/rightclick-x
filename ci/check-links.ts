// Relative links in the repository's Markdown files must point at files that exist.
//   node ci/check-links.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const skip = new Set(["node_modules", ".git", "dist"]);
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (skip.has(e)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".md")) files.push(p);
  }
};
walk(".");
const broken: string[] = [];
for (const f of files) {
  const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(dirname(f), decodeURI(target)))) broken.push(`${f}: ${m[1]}`);
  }
}
console.log(`${files.length} Markdown files, ${broken.length} broken relative links`);
for (const b of broken) console.log(`  ${b}`);
process.exitCode = broken.length ? 1 : 0;
