// Relative links in the repository's Markdown files must point at files that exist.
//   node ci/check-links.ts
//
// Two kinds of target are not in the working tree on purpose, and each is handled by a stated
// rule rather than ignored (docs/adaptive/evidence/README.md explains the policy):
//
// - Archived evidence. docs/adaptive/evidence/ is kept at an archive tag, not in main. A link
//   into it is valid only when its target is listed in that directory's MANIFEST.sha256, or is
//   a directory that contains listed files. A link to an archived path that never existed still
//   fails.
// - Verbatim source snapshots. Files under an evidence tree's sources/ directories are byte
//   copies of files that lived elsewhere; their relative links were written for that original
//   location. They are counted and listed, never silently dropped, but do not fail the check.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ARCHIVE = "docs/adaptive/evidence";
const SNAPSHOT = /(^|\/)evidence\/(.+\/)?sources\//;

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

const archived = new Set<string>();
const archivedDirs = new Set<string>();
const manifest = join(ARCHIVE, "MANIFEST.sha256");
if (existsSync(manifest)) {
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    const path = line.slice(66).trim();
    if (!path) continue;
    archived.add(path);
    for (let d = dirname(path); d.startsWith(ARCHIVE) && d !== ARCHIVE; d = dirname(d)) archivedDirs.add(d);
  }
}

const broken: string[] = [];
const snapshots: string[] = [];
let viaArchive = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const path = resolve(dirname(f), decodeURI(target));
    if (existsSync(path)) continue;
    const rel = relative(".", path);
    if (rel.startsWith(`${ARCHIVE}/`) && (archived.has(rel) || archivedDirs.has(rel))) { viaArchive++; continue; }
    if (SNAPSHOT.test(relative(".", f))) { snapshots.push(`${f}: ${m[1]}`); continue; }
    broken.push(`${f}: ${m[1]}`);
  }
}
console.log(`${files.length} Markdown files, ${broken.length} broken relative links`);
console.log(`${viaArchive} links resolve to archived evidence listed in ${manifest}`);
console.log(`${snapshots.length} links inside verbatim source snapshots, written for their original location (not failing):`);
for (const s of snapshots) console.log(`  ${s}`);
if (broken.length) console.log("Broken:");
for (const b of broken) console.log(`  ${b}`);
process.exitCode = broken.length ? 1 : 0;
