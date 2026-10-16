// PHASE C — drift on real recorded contract changes (PREREGISTRATION.md §9).
//
// A local REPLAY PROXY (harness-side, labelled) stands in for a provider's
// contract URL: before the switch it serves the provider's own archived contract
// (Internet Archive capture, byte-for-byte), after the switch the live current
// contract fetched from the provider. Every other request is forwarded unchanged
// to the live provider, so execution is real.
//
//   C1  RCSB Search 2022-02-05 (v1.13.0, /rcsbsearch/v1/) → today (v2): a breaking change.
//   C2  OLS4 2026-06-05 → today: operationIds that now name a different operation.
//
//   RCX_FREEZE=lifesci-freeze-3 node --import ./experiments/life-science/polite-fetch.ts experiments/life-science/phase-c.ts [--parts c1a,c1b,c1c,c2] [--state <phase-a-state.json>] [--label <evidence name>]
//
// Added post hoc for the run-drift fix (lifesci-rundrift-1), not pre-registered:
//   C1-d  a plain context_run of the stale RCSB capability (no agent, no compose);
//   C2    additionally records the refusal of the shifted id, the successor run and
//         an acknowledged run; C1-c records contract re-reads the agent did not ask for.

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { bodies, frozenBuild, HERE, Mcp, readJsonl, serverCommand, serverFiles, sha256, TAG, WORK } from "./harness.ts";
import { parseAnswer, QUESTIONS } from "./questions.ts";

const argv = process.argv.slice(2);
const parts = (argv.includes("--parts") ? argv[argv.indexOf("--parts") + 1] : "c1a,c1b,c1c,c2").split(",");
const label = argv.includes("--label") ? argv[argv.indexOf("--label") + 1] : `phase-c-${TAG}`;
const phaseAState = argv.includes("--state") ? argv[argv.indexOf("--state") + 1] : `${WORK}/${TAG}/phase-a-state.json`;
const build = frozenBuild();
const log = (...a: unknown[]) => console.log(...a);
const root = `${WORK}/${TAG}/${label === `phase-c-${TAG}` ? "phase-c" : label}`;
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const ev: Record<string, any> = { phase: "C", build: { tag: TAG, commit: build.commit }, startedAt: new Date().toISOString(), replayProxy: "harness-side; contract URL served from the archive (before) or live (after); all other paths forwarded unchanged to the live provider" };

// ------------------------------------------------------------------ replay proxy
interface Replay { url: string; contractUrl: string; mode: "archived" | "live"; switchTo(m: "archived" | "live"): void; log: any[]; server: Server; archivedSha: string; liveSha?: string }
async function replay(name: string, upstream: string, contractPath: string, archivedFile: string): Promise<Replay> {
  const archived = readFileSync(archivedFile);
  let live: Buffer | null = null;
  const r: Replay = {
    url: "",
    contractUrl: "",
    mode: "archived",
    switchTo(m) {
      this.mode = m;
      this.log.push({ at: new Date().toISOString(), switch: m });
    },
    log: [],
    server: null as any,
    archivedSha: sha256(archived),
  };
  r.server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = req.url ?? "/";
    try {
      if (path.split("?")[0] === contractPath) {
        let body = archived;
        if (r.mode === "live") {
          if (!live) {
            live = Buffer.from(await (await fetch(upstream + contractPath, { headers: { accept: "application/json" } })).arrayBuffer());
            r.liveSha = sha256(live);
          }
          body = live;
        }
        r.log.push({ at: new Date().toISOString(), contract: r.mode, method: req.method, path });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(req.method === "HEAD" ? undefined : body);
      }
      const headers: Record<string, string> = {};
      for (const h of ["accept", "content-type", "user-agent"]) if (req.headers[h]) headers[h] = String(req.headers[h]);
      const up = await fetch(upstream + path, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks) });
      const buf = Buffer.from(await up.arrayBuffer());
      r.log.push({ at: new Date().toISOString(), forwarded: `${req.method} ${upstream}${path}`.slice(0, 300), status: up.status });
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream" });
      res.end(buf);
    } catch (e) {
      r.log.push({ at: new Date().toISOString(), path, error: String((e as Error).message ?? e) });
      res.writeHead(502);
      res.end("replay proxy error");
    }
  });
  await new Promise<void>((done) => r.server.listen(0, "127.0.0.1", done));
  r.url = `http://127.0.0.1:${(r.server.address() as any).port}`;
  r.contractUrl = r.url + contractPath;
  log(`replay ${name}: ${r.contractUrl} (archived sha256 ${r.archivedSha.slice(0, 12)}…) → upstream ${upstream}`);
  return r;
}

// ------------------------------------------------------------------ true operation-level diff
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
}
function operations(doc: any, docUrl: string) {
  const base = new URL(doc.servers?.[0]?.url ?? "/", docUrl).toString().replace(/\/$/, "");
  const deref = (o: any) => (o?.$ref?.startsWith("#/") ? o.$ref.slice(2).split("/").reduce((c: any, k: string) => c?.[k], doc) : o);
  const props = (schema: any) => Object.keys(deref(schema ?? {})?.properties ?? {}).sort();
  const out = new Map<string, string>();
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    for (const m of ["get", "post", "put", "patch", "delete"]) {
      const op = item?.[m];
      if (!op) continue;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(deref).map((p: any) => `${p.in}:${p.name}${p.required ? "*" : ""}`).sort();
      const body = props(Object.values<any>(op.requestBody?.content ?? {})[0]?.schema);
      const ok = deref(op.responses?.["200"] ?? op.responses?.default);
      const resp = props(Object.values<any>(ok?.content ?? {})[0]?.schema);
      out.set(slug(op.operationId ?? `${m}-${path}`), JSON.stringify({ m, url: base + path, params, body, resp }));
    }
  }
  return out;
}
function trueDiff(oldDoc: any, newDoc: any, url: string) {
  const a = operations(oldDoc, url);
  const b = operations(newDoc, url);
  return {
    added: [...b.keys()].filter((k) => !a.has(k)).sort(),
    removed: [...a.keys()].filter((k) => !b.has(k)).sort(),
    modified: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort(),
    detail: Object.fromEntries([...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).map((k) => [k, { before: JSON.parse(a.get(k)!), after: JSON.parse(b.get(k)!) }])),
  };
}
const opPart = (id: string) => id.split(":").pop()!;
function compareDrift(drift: any, truth: ReturnType<typeof trueDiff>) {
  const rcx = { added: (drift?.added ?? []).map(opPart).sort(), removed: (drift?.removed ?? []).map(opPart).sort(), modified: (drift?.modified ?? []).map(opPart).sort() };
  const same = (x: string[], y: string[]) => JSON.stringify(x) === JSON.stringify(y);
  return { rightclickx: rcx, matches: { added: same(rcx.added, truth.added), removed: same(rcx.removed, truth.removed), modified: same(rcx.modified, truth.modified) }, match: same(rcx.added, truth.added) && same(rcx.removed, truth.removed) && same(rcx.modified, truth.modified) };
}

async function withServer<T>(dir: string, fromState: string | null, f: (m: Mcp) => Promise<T>): Promise<T> {
  const files = serverFiles(dir);
  if (fromState) copyFileSync(fromState, files.state);
  const m = new Mcp(build.rcx, files);
  await m.init();
  try {
    return await f(m);
  } finally {
    await m.close();
  }
}

const q11 = QUESTIONS.find((q) => q.id === "Q11")!;
const searchQuery = (acc: string) =>
  JSON.stringify({
    query: { type: "group", logical_operator: "and", nodes: [
      { type: "terminal", service: "text", parameters: { attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession", operator: "exact_match", value: acc } },
      { type: "terminal", service: "text", parameters: { attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name", operator: "exact_match", value: "UniProt" } },
    ] },
    return_type: "entry",
    request_options: { return_all_hits: true },
  });

const rcsb = await replay("RCSB Search", "https://search.rcsb.org", "/openapi.json", `${HERE}/contracts/rcsb-search-openapi-2022-02-05.json`);
const ols = await replay("OLS4", "https://www.ebi.ac.uk", "/ols4/v3/api-docs", `${HERE}/contracts/ols4-v3-api-docs-2026-06-05.json`);
const liveDoc = async (r: Replay, upstreamContract: string) => JSON.parse(await (await fetch(upstreamContract, { headers: { accept: "application/json" } })).text());

// ------------------------------------------------------------------ C1-a: re-reflection after a breaking change
const staleC1 = `${root}/c1-stale-state.json`;
if (parts.some((p) => p.startsWith("c1"))) {
  rcsb.switchTo("archived");
  const learned0 = await withServer(`${root}/c1-learn-archived`, null, async (m) => (await m.tool("context_learn", { source: rcsb.contractUrl })).value);
  copyFileSync(`${root}/c1-learn-archived/state.json`, staleC1);
  const staleCaps = JSON.parse(readFileSync(staleC1, "utf8")).reflections.flatMap((r: any) => r.capabilities).map((c: any) => ({ id: c.id, url: c.invoke?.url, method: c.invoke?.method }));
  log(`C1 archived contract learned: ${staleCaps.length} capabilities, e.g. ${staleCaps[0]?.method} ${staleCaps[0]?.url}`);
  ev.c1 = { replay: { contractUrl: rcsb.contractUrl, archivedSha256: rcsb.archivedSha }, archivedLearn: { capabilities: staleCaps, probes: learned0?.results?.[0]?.probes } };
}
if (parts.includes("c1a")) {
  rcsb.switchTo("live");
  const t0 = performance.now();
  const relearn = await withServer(`${root}/c1a`, staleC1, async (m) => (await m.tool("context_learn", { source: rcsb.contractUrl })).value);
  const ms = Math.round(performance.now() - t0);
  const drift = relearn?.results?.[0]?.drift;
  const truth = trueDiff(JSON.parse(readFileSync(`${HERE}/contracts/rcsb-search-openapi-2022-02-05.json`, "utf8")), await liveDoc(rcsb, "https://search.rcsb.org/openapi.json"), rcsb.contractUrl);
  const cmp = compareDrift(drift, truth);
  ev.c1a = { ms, drift, trueDiff: truth, comparison: cmp, verdict: drift?.changed && cmp.match ? "PASS" : "FAIL", liveSha256: rcsb.liveSha };
  log(`C1-a drift: +${drift?.added?.length ?? 0} −${drift?.removed?.length ?? 0} ~${drift?.modified?.length ?? 0} (true: +${truth.added.length} −${truth.removed.length} ~${truth.modified.length}) → ${ev.c1a.verdict}`);
}

// ------------------------------------------------------------------ C1-b: self-healing on use
if (parts.includes("c1b")) {
  rcsb.switchTo("live");
  const acc = "P41159";
  const t = await q11.truth();
  const truthIds = (t.facts as any).rcsbSearch as string[];
  const out = await withServer(`${root}/c1b`, staleC1, async (m) => {
    const caps = (await m.tool("context_graph", { op: "export" })).value.capabilities;
    const stale = caps.find((c: any) => c.invoke?.kind === "http" && c.invoke.method === "GET" && /\/query$/.test(c.invoke.url));
    const explained = (await m.tool("context_explain", { id: stale.id })).value;
    const inputPort = explained.capability.inputs.find((p: any) => p.required) ?? explained.capability.inputs[0];
    const have = { [inputPort.name]: { type: inputPort.type, value: searchQuery(acc) } };
    const req = { have, want: "json", intent: "RCSB PDB search query entries", through: [stale.id], maxSteps: 2 };
    const planned = await m.tool("context_compose", { ...req, run: false });
    const t0 = performance.now();
    const ran = await m.tool("context_compose", { ...req, run: true });
    return { staleCapability: { id: stale.id, url: stale.invoke.url }, request: req, planned: planned.value?.plans?.slice?.(0, 3) ?? planned.value, ran: ran.value, ok: ran.ok, ms: Math.round(performance.now() - t0) };
  });
  const output = out.ran?.executed?.output;
  const ids = (output?.result_set ?? []).map((x: any) => String(x.identifier ?? x)).sort();
  const correct = JSON.stringify(ids) === JSON.stringify(truthIds) && output?.total_count === truthIds.length;
  ev.c1b = { ...out, independentTruth: { count: truthIds.length, ids: truthIds }, returned: { count: output?.total_count, ids }, attempts: out.ran?.executed?.attempts, correct, verdict: out.ran?.executed?.status === "completed" && correct ? "PASS" : "FAIL" };
  log(`C1-b: status ${out.ran?.executed?.status ?? (out.ok ? "?" : "error")} · returned ${ids.length} ids (truth ${truthIds.length}) · healing: ${(out.ran?.executed?.attempts ?? []).map((a: any) => a.healing).join(" | ")} → ${ev.c1b.verdict}`);
  if (!out.ok) log(`   error: ${String(out.ran).slice(0, 300)}`);
}

// ------------------------------------------------------------------ C1-d: plain context_run on the stale graph (post hoc)
if (parts.includes("c1d")) {
  rcsb.switchTo("live");
  const acc = "P41159";
  const t = await q11.truth();
  const truthIds = (t.facts as any).rcsbSearch as string[];
  const logFrom = rcsb.log.length;
  const out = await withServer(`${root}/c1d`, staleC1, async (m) => {
    const caps = (await m.tool("context_graph", { op: "export" })).value.capabilities;
    const stale = caps.find((c: any) => c.invoke?.kind === "http" && c.invoke.method === "GET" && /\/query$/.test(c.invoke.url));
    const explained = (await m.tool("context_explain", { id: stale.id })).value;
    const inputPort = explained.capability.inputs.find((p: any) => p.required) ?? explained.capability.inputs[0];
    const t0 = performance.now();
    const ran = await m.tool("context_run", { id: stale.id, args: { [inputPort.name]: searchQuery(acc) } });
    return { staleCapability: { id: stale.id, url: stale.invoke.url }, port: inputPort.name, ran: ran.value, ok: ran.ok, ms: Math.round(performance.now() - t0) };
  });
  const output = out.ran?.output;
  const ids = (output?.result_set ?? []).map((x: any) => String(x.identifier ?? x)).sort();
  const correct = JSON.stringify(ids) === JSON.stringify(truthIds) && output?.total_count === truthIds.length;
  const { output: _omit, ...record } = out.ran ?? {};
  ev.c1d = { posthoc: true, staleCapability: out.staleCapability, port: out.port, ms: out.ms, record, independentTruth: { count: truthIds.length, ids: truthIds }, returned: { count: output?.total_count, ids }, correct, replayLog: rcsb.log.slice(logFrom), verdict: out.ran?.status === "completed" && !!out.ran?.healing?.retried && correct ? "PASS" : "FAIL" };
  log(`C1-d: plain context_run ${out.ran?.status ?? "error"} · returned ${ids.length} ids (truth ${truthIds.length}) · healing: ${out.ran?.healing?.note ?? "none"} → ${ev.c1d.verdict}`);
  if (!out.ok || out.ran?.error) log(`   error: ${String(out.ran?.error ?? out.ran).slice(0, 300)}`);
}

// ------------------------------------------------------------------ C1-c: agents with the stale graph
function runAgent(client: "claude" | "codex", dir: string, prompt: string): Promise<{ output: string; seconds: number; exit: number | null }> {
  const f = serverFiles(dir);
  const s = serverCommand(build.rcx, f);
  const t0 = performance.now();
  let cmd: string;
  let args: string[];
  if (client === "claude") {
    writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: { "rightclick-x": { command: s.command, args: s.args, env: s.env } } }));
    cmd = "claude";
    args = ["-p", prompt, "--mcp-config", `${dir}/mcp.json`, "--strict-mcp-config", "--allowedTools", "mcp__rightclick-x", "--disallowedTools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit", "--output-format", "json", "--max-turns", "40"];
  } else {
    const env = Object.entries(s.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",");
    cmd = "codex";
    // As in phase-b.ts: account-level app connectors must not add MCP servers other than RightClick X.
    args = ["exec", "--skip-git-repo-check", "--approve-for-me", "--disable", "apps", "-c", `mcp_servers.rightclick-x.command=${JSON.stringify(s.command)}`, "-c", `mcp_servers.rightclick-x.args=${JSON.stringify(s.args)}`, "-c", `mcp_servers.rightclick-x.env={${env}}`, "-c", "mcp_servers.rightclick-x.tool_timeout_sec=300", "--output-last-message", `${dir}/last.txt`, prompt];
  }
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", () => {});
    const timer = setTimeout(() => p.kill(), 900_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      let output = "";
      try {
        output = client === "claude" ? JSON.parse(stdout).result ?? "" : readFileSync(`${dir}/last.txt`, "utf8");
      } catch {
        output = stdout.slice(-3000);
      }
      done({ output, seconds: Math.round((performance.now() - t0) / 100) / 10, exit: code });
    });
  });
}
if (parts.includes("c1c")) {
  // The Phase A graph, but with RCSB Search known only from its 2022 contract.
  rcsb.switchTo("archived");
  const base = `${root}/c1c-base`;
  ev.c1cStartState = phaseAState;
  const prep = await withServer(base, phaseAState, async (m) => {
    const forgot = await m.tool("context_forget", { provider: "openapi:rcsb-search-api" });
    const learned = await m.tool("context_learn", { source: rcsb.contractUrl });
    return { forgot: forgot.value, learned: learned.value?.results?.[0]?.learned };
  });
  rcsb.switchTo("live");
  ev.c1c = { preparation: prep, sessions: [] };
  for (const client of ["claude", "codex"] as const) {
    const dir = `${root}/c1c-${client}`;
    mkdirSync(dir, { recursive: true });
    copyFileSync(`${base}/state.json`, `${dir}/state.json`);
    const prompt = [
      "You are connected to exactly one MCP server, rightclick-x. Use only its tools.",
      "RightClick X has already learned several public life-science databases (see context_providers).",
      "Answer the question using only data you obtain through rightclick-x tools, not from memory.",
      "If the tools cannot give you the answer, say so instead of guessing.",
      `Question: ${q11.text}`,
      `End your reply with a final line exactly of the form: ${q11.format}`,
    ].join("\n");
    log(`C1-c ${client} …`);
    const logFrom = rcsb.log.length;
    const a = await runAgent(client, dir, prompt);
    const replayDuring = rcsb.log.slice(logFrom);
    const t = await q11.truth();
    const answer = [...a.output.matchAll(/ANSWER:\s*([^\n]+)/gi)].at(-1)?.[1]?.trim().replace(/[`*]/g, "");
    const perPart = q11.score(parseAnswer(answer), t);
    const fetched = bodies(`${dir}/bodies`);
    const grounded = ((t.parts[1] as string[]) ?? []).every((id) => fetched.includes(id));
    const calls = readJsonl(`${dir}/mcp-calls.jsonl`);
    const st = JSON.parse(readFileSync(`${dir}/state.json`, "utf8"));
    const startReceipts = JSON.parse(readFileSync(`${base}/state.json`, "utf8")).receipts?.length ?? 0;
    const receipts = (st.receipts ?? []).slice(startReceipts).map((x: any) => ({ capability: x.capability, provider: x.provider, status: x.status }));
    // A live contract read the agent did not request (no context_learn of the replay URL) is RightClick X re-reading it on a failed run.
    const agentLearnedReplay = calls.some((c) => c.tool === "context_learn" && JSON.stringify(c.args ?? {}).includes(rcsb.url));
    const contractReads = replayDuring.filter((x: any) => x.contract === "live").length;
    const forwardedQuery = replayDuring.filter((x: any) => /\/query/.test(x.forwarded ?? "")).map((x: any) => `${x.forwarded.replace(/\?.*$/, "")} → ${x.status}`);
    const s = { client, answer, truth: t.parts, perPart, correct: perPart.every(Boolean), grounded, seconds: a.seconds, replay: { contractReadsLive: contractReads, agentLearnedReplayUrl: agentLearnedReplay, rereadByRightClickX: contractReads > 0 && !agentLearnedReplay, forwardedQuery }, mcpCalls: calls.map((c) => ({ tool: c.tool, ok: c.ok, args: c.args, error: c.error })), receipts, agentLearned: calls.filter((c) => c.tool === "context_learn").map((c) => c.args), finalText: a.output.slice(-2500) };
    ev.c1c.sessions.push(s);
    log(`  ${s.correct && s.grounded ? "✓" : "✗"} ${client}: ${answer} · truth ${JSON.stringify(t.parts).slice(0, 120)} · ${a.seconds}s · ${calls.length} calls · learned by agent: ${JSON.stringify(s.agentLearned)}`);
  }
}

// ------------------------------------------------------------------ C2: OLS operationId identity shift
if (parts.includes("c2")) {
  ols.switchTo("archived");
  const staleC2 = `${root}/c2-stale-state.json`;
  const gas = encodeURIComponent("http://purl.obolibrary.org/obo/GO_0015669"); // encoded once; the path parameter is encoded again
  const before = await withServer(`${root}/c2-learn-archived`, null, async (m) => {
    const learned = (await m.tool("context_learn", { source: ols.contractUrl })).value;
    const id = (await m.tool("context_graph", { op: "export" })).value.capabilities.find((c: any) => c.id.endsWith(":gethierarchicalchildrenbyontology"));
    const run = (await m.tool("context_run", { id: id.id, args: { onto: "go", class: gas } })).value;
    return { learnedCapabilities: learned?.results?.[0]?.learned, capability: { id: id.id, url: id.invoke.url, inputs: id.inputs.map((p: any) => `${p.name}:${p.type}`) }, run: { status: run.status, labels: (run.output?.elements ?? []).map((e: any) => e.label).sort(), error: run.error } };
  });
  copyFileSync(`${root}/c2-learn-archived/state.json`, staleC2);
  ols.switchTo("live");
  const after = await withServer(`${root}/c2`, staleC2, async (m) => {
    const relearn = (await m.tool("context_learn", { source: ols.contractUrl })).value;
    const caps = (await m.tool("context_graph", { op: "export" })).value.capabilities;
    const same = caps.find((c: any) => c.id === before.capability.id);
    const renamed = caps.find((c: any) => c.id.endsWith(":gethierarchicalchildrenbyontology-1"));
    const runSame = (await m.tool("context_run", { id: same.id, args: { onto: "go", individual: gas, class: gas } })).value;
    // Post hoc (run-drift fix): on a build that refuses a shifted id, follow its successor, then acknowledge.
    let refusal: any = null;
    if (runSame.changedMeaning && runSame.status === "failed") {
      const individualsBefore = ols.log.filter((x: any) => /\/individuals\//.test(x.forwarded ?? "")).length;
      const succ = runSame.changedMeaning.successor ? (await m.tool("context_run", { id: runSame.changedMeaning.successor, args: { onto: "go", class: gas } })).value : null;
      const ack = (await m.tool("context_run", { id: same.id, args: { onto: "go", individual: gas, class: gas }, acknowledgeChange: true })).value;
      refusal = {
        posthoc: true,
        error: runSame.error,
        changedMeaning: runSame.changedMeaning,
        upstreamCallsByRefusedRun: individualsBefore,
        successorRun: succ ? { id: runSame.changedMeaning.successor, status: succ.status, labels: (succ.output?.elements ?? []).map((e: any) => e.label).sort(), error: succ.error } : null,
        acknowledgedRun: { status: ack.status, labels: (ack.output?.elements ?? []).map((e: any) => e.label).sort(), changedMeaning: ack.changedMeaning, error: ack.error },
      };
    }
    return {
      refusal, drift: relearn?.results?.[0]?.drift, sameIdNow: { id: same.id, url: same.invoke.url, inputs: same.inputs.map((p: any) => `${p.name}:${p.type}`), title: same.title }, renamedClassOp: renamed ? { id: renamed.id, url: renamed.invoke.url, title: renamed.title } : null, runSameIdAfter: { status: runSame.status, labels: (runSame.output?.elements ?? []).map((e: any) => e.label).sort(), error: runSame.error } };
  });
  const truth = trueDiff(JSON.parse(readFileSync(`${HERE}/contracts/ols4-v3-api-docs-2026-06-05.json`, "utf8")), await liveDoc(ols, "https://www.ebi.ac.uk/ols4/v3/api-docs"), ols.contractUrl);
  const cmp = compareDrift(after.drift, truth);
  const shifted = ["gethierarchicalchildrenbyontology", "gethierarchicalancestorsbyontology"];
  const flagged = shifted.every((s) => cmp.rightclickx.modified.includes(s));
  // Independent truth for the class children of GO:0015669, directly from OLS.
  const direct = await (await fetch(`https://www.ebi.ac.uk/ols4/api/v2/ontologies/go/classes/${encodeURIComponent(gas)}/hierarchicalChildren`, { headers: { accept: "application/json" } })).json();
  const truthLabels = ((direct as any).elements ?? []).map((e: any) => e.label).sort();
  ev.c2 = { replay: { contractUrl: ols.contractUrl, archivedSha256: ols.archivedSha, liveSha256: ols.liveSha }, before, after, trueDiff: truth, comparison: cmp, shiftedIdsFlaggedModified: flagged, verdict: flagged && cmp.match ? "PASS" : flagged ? "PASS on the pre-registered criterion (shifted ids flagged); full diff mismatch recorded" : "FAIL", classChildrenTruth: truthLabels, beforeRunMatchesTruth: JSON.stringify(before.run.labels) === JSON.stringify(truthLabels) };
  log(`C2 drift: +${after.drift?.added?.length ?? 0} −${after.drift?.removed?.length ?? 0} ~${after.drift?.modified?.length ?? 0} (true: +${truth.added.length} −${truth.removed.length} ~${truth.modified.length}); shifted ids flagged modified: ${flagged} → ${ev.c2.verdict}`);
  log(`   before: ${before.capability.url} → ${before.run.status} ${before.run.labels.length} children (truth ${truthLabels.length}); after, same id: ${after.sameIdNow.url} → ${after.runSameIdAfter.status}`);
  if (after.refusal) {
    const r = after.refusal;
    ev.c2.refusalCheck = { posthoc: true, refusedWithoutUpstreamCall: r.upstreamCallsByRefusedRun === 0, successorMatchesTruth: JSON.stringify(r.successorRun?.labels) === JSON.stringify(truthLabels), verdict: r.upstreamCallsByRefusedRun === 0 && JSON.stringify(r.successorRun?.labels) === JSON.stringify(truthLabels) ? "PASS" : "FAIL" };
    log(`   refusal: ${r.error?.slice(0, 160)}… · successor ${r.successorRun?.id} → ${r.successorRun?.status} ${r.successorRun?.labels?.length} children · acknowledged → ${r.acknowledgedRun.status} ${r.acknowledgedRun.labels.length} → ${ev.c2.refusalCheck.verdict}`);
  }
}

ev.replayLogs = { rcsb: rcsb.log, ols: ols.log };
ev.finishedAt = new Date().toISOString();
rcsb.server.close();
ols.server.close();
writeFileSync(`${HERE}/evidence/${label}.json`, JSON.stringify(ev, null, 2));
log(`evidence: experiments/life-science/evidence/${label}.json`);
