// Harness-side network etiquette for the life-science experiment, loaded into
// every process that touches the public databases (the RightClick X server via
// `node --import`, and the harness's own independent-truth queries).
//
//  - at most 1 request per second per host (requests to a host are serialized
//    and spaced; concurrency inside RightClick X is preserved, only delayed);
//  - read-only: PUT/PATCH/DELETE are refused (POST is allowed for GraphQL
//    queries, search queries and MCP JSON-RPC, which do not change data);
//  - a descriptive user-agent when the caller set none;
//  - every request is appended to RCX_NETLOG (JSONL) as evidence;
//  - with RCX_BODYDIR, every response body received is kept (grounding check).
//
// This is not product code: it wraps globalThis.fetch from outside.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const MIN_GAP_MS = Number(process.env.RCX_MIN_GAP_MS ?? 1000);
const UA = process.env.RCX_UA ?? "rightclick-x-lifescience-experiment/0.1 (read-only research; 1 req/s per host)";
const LOG = process.env.RCX_NETLOG;
const tag = process.env.RCX_NETLOG_TAG ?? "rcx";
const BODIES = process.env.RCX_BODYDIR;
if (BODIES) mkdirSync(BODIES, { recursive: true });
let count = 0;

const original = globalThis.fetch.bind(globalThis);
const next = new Map<string, Promise<void>>();

function slot(host: string): Promise<void> {
  const prev = next.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  next.set(host, prev.then(() => mine));
  return prev.then(() => {
    // the next caller waits MIN_GAP_MS after this one starts
    setTimeout(release, MIN_GAP_MS);
  });
}

globalThis.fetch = async function politeFetch(input: any, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = String(init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local && /^(PUT|PATCH|DELETE)$/.test(method)) {
    if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), tag, method, url: url.href, refused: "read-only experiment" }) + "\n");
    throw new Error(`refused by experiment policy: ${method} ${url.host} (read-only)`);
  }
  if (!local) await slot(url.host);
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  if (!headers.has("user-agent")) headers.set("user-agent", UA);
  const t0 = performance.now();
  try {
    const res = await original(input, { ...init, headers });
    const seq = ++count;
    if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), tag, seq, method, url: url.href.slice(0, 500), status: res.status, ms: Math.round(performance.now() - t0) }) + "\n");
    // Keep what the process actually received, for the grounding check (answers
    // must come from fetched data, not from a model's memory).
    if (BODIES && !local) res.clone().text().then((t) => writeFileSync(`${BODIES}/${process.pid}-${seq}.txt`, `${method} ${url.href}\n\n${t}`), () => {});
    return res;
  } catch (e) {
    if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), tag, method, url: url.href.slice(0, 500), error: String((e as Error)?.message ?? e).slice(0, 200) }) + "\n");
    throw e;
  }
} as typeof fetch;
