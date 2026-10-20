#!/usr/bin/env node
// CONTROLLER-SIDE. Waits until each probe target answers anything at all
// (even 401/404) instead of refusing the connection, so the probe measures
// what the application exposes rather than whether it finished booting.

import { readFile } from "node:fs/promises";

const targetsPath = process.argv[2];
const budgetSeconds = Number(process.argv[3] ?? 300);
const targets = JSON.parse(await readFile(targetsPath, "utf8")) as Array<{ url: string; note?: string }>;

const deadline = Date.now() + budgetSeconds * 1000;
const answered = new Set<string>();

while (Date.now() < deadline && answered.size < targets.length) {
  for (const t of targets) {
    if (answered.has(t.url)) continue;
    try {
      const res = await fetch(t.url, { headers: { accept: "application/json, text/html;q=0.9" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
      await res.body?.cancel();
      answered.add(t.url);
      console.log(`[wait] UP   ${t.url} -> HTTP ${res.status}`);
    } catch {
      /* still booting */
    }
  }
  if (answered.size < targets.length) await new Promise((r) => setTimeout(r, 5000));
}

const never = targets.filter((t) => !answered.has(t.url)).map((t) => t.url);
for (const u of never) console.log(`[wait] DOWN ${u} (never answered within ${budgetSeconds}s)`);
console.log(`[wait] ${answered.size}/${targets.length} targets answered`);
// Never fatal: a target that never boots is itself a probe result.
