// CONTROLLER-SIDE PROBE. Not part of RightClick-X's execution path.
//
// Boots nothing itself: the workflow starts one genuine open-source application
// per matrix job, then this script asks the FROZEN baseline's own discovery code
// what it can see. It answers one question empirically, before any experiment is
// designed: which real products can RightClick-X reflect at all, through which
// interface, and with what semantic types?
//
// It imports src/reflectors/discover.ts read-only. Nothing here is imported by src/.

import { discover } from "../../../src/reflectors/discover.ts";
import { Authority, type Net } from "../../../src/reflectors/net.ts";

interface Target {
  url: string;
  deep?: boolean;
  note?: string;
}

const targetsPath = process.argv[2];
const authPath = process.argv[3];
const outPath = process.argv[4];

const fs = await import("node:fs/promises");

async function safeJson(p: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return {};
  }
}

const targets: Target[] = await safeJson(targetsPath);
const auth: Record<string, string | Record<string, string>> = authPath ? await safeJson(authPath) : {};

const authority = new Authority();
for (const [origin, v] of Object.entries(auth)) {
  authority.set(origin, typeof v === "string" ? { Authorization: v } : v);
}

const net: Net = {
  fetch: globalThis.fetch,
  auth: authority,
  timeoutMs: 25_000,
  // The applications live on loopback inside an isolated runner. Nothing here
  // reaches the internet; SSRF blocking would only stop the probe from working.
  policy: { blockPrivate: false },
};

/** Record the HTTP status of each target so a 401/404 is visible as such. */
async function probeStatus(url: string): Promise<{ status: number | string; contentType?: string }> {
  try {
    const res = await net.fetch(url, { headers: { accept: "application/json, text/html;q=0.9" }, redirect: "manual" });
    await res.body?.cancel();
    return { status: res.status, contentType: res.headers.get("content-type") ?? undefined };
  } catch (e) {
    return { status: `error: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}

const results = [];
for (const t of targets) {
  const before = await probeStatus(t.url);
  const started = Date.now();
  let entry: any = { target: t.url, deep: !!t.deep, note: t.note, httpStatus: before.status, contentType: before.contentType };
  try {
    const d = await discover(net, t.url, { deep: t.deep });
    entry.probes = d.probes;
    entry.providers = d.reflections.map((r) => ({
      id: r.provider.id,
      title: r.provider.title,
      source: r.provider.source,
      origin: r.provider.origin,
      capabilities: r.capabilities.length,
      meta: r.provider.meta,
    }));
    // Full capability dump: id, title, risk, typed ports. This is the feasibility
    // data - it shows whether a real business operation is expressible at all.
    entry.capabilities = d.reflections.flatMap((r) =>
      r.capabilities.map((c) => ({
        provider: r.provider.id,
        id: c.id,
        title: c.title,
        risk: c.risk,
        invokeKind: c.invoke.kind,
        operation: (c.invoke as any).method ? `${(c.invoke as any).method} ${(c.invoke as any).url}` : (c.invoke as any).field ?? (c.invoke as any).tool,
        inputs: c.inputs.map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}${p.enum ? `[${p.enum.slice(0, 6).join("|")}]` : ""}`),
        outputs: c.outputs.slice(0, 40).map((p) => `${p.name}:${p.type}`),
      })),
    );
    entry.capabilityCount = entry.capabilities.length;
  } catch (e) {
    entry.error = String((e as Error)?.message ?? e).slice(0, 400);
  }
  entry.ms = Date.now() - started;
  results.push(entry);
  // Compact line per target so the job log is readable on its own.
  console.log(
    `[probe] ${t.url} deep=${!!t.deep} http=${before.status} providers=${(entry.providers ?? []).length} caps=${entry.capabilityCount ?? 0} ms=${entry.ms}${entry.error ? ` ERROR=${entry.error}` : ""}`,
  );
  for (const p of entry.providers ?? []) console.log(`         - ${p.id} (${p.source}) ${p.capabilities} capabilities`);
  const kinds = new Map<string, number>();
  for (const p of entry.probes ?? []) kinds.set(`${p.kind}:${p.ok}`, (kinds.get(`${p.kind}:${p.ok}`) ?? 0) + 1);
  if (kinds.size) console.log(`         probes ${[...kinds].map(([k, n]) => `${k}=${n}`).join(" ")}`);
}

await fs.writeFile(outPath, JSON.stringify({ probedAt: new Date().toISOString(), authOrigins: Object.keys(auth), results }, null, 2));
console.log(`[probe] wrote ${outPath}`);
