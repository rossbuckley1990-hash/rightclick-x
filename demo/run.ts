// The RightClick X demo: seven acts, all real HTTP, no mocks inside the runtime.
//   node bin/rcx.ts demo            (offline: four local services in four protocols)
//   node bin/rcx.ts demo --online   (adds live research against public directories)

import { createHandler } from "../src/interface/http.ts";
import { serve } from "../src/entry/node-host.ts";
import { ReceiptChain } from "../src/core/ledger.ts";
import { RightClick } from "../src/runtime.ts";
import { startStage } from "./stage.ts";

const tty = (globalThis as any).process?.stdout?.isTTY;
const c = (code: string) => (s: string | number) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c("1"), dim = c("2"), green = c("32"), cyan = c("36"), yellow = c("33"), magenta = c("35"), red = c("31");
const fmt = (n: number) => n.toLocaleString("en-US");
const log = (...a: unknown[]) => console.log(...a);
const act = (n: number, title: string) => log(`\n${bold(cyan(`━━ Act ${n} ━━`))} ${bold(title)}`);

export async function runDemo(opts: { online?: boolean } = {}): Promise<void> {
  const stage = await startStage();
  const rc = await RightClick.create({ name: "rcx-main", region: "local" });
  try {
    log(bold("\nRightClick X — a live capability graph that composes itself\n"));

    // ------------------------------------------------------------------ 1
    act(1, "Research the environment");
    const env = await rc.research();
    const g0 = env.graph;
    log(`  runtime     ${env.environment.runtime.name} ${env.environment.runtime.version ?? ""}  features: ${env.environment.runtime.features.join(", ")}`);
    log(`  graph       ${g0.providers} providers · ${g0.capabilities} capabilities · ${fmt(g0.edges)} typed links · ${bold(fmt(g0.total))} powers`);
    log(`  gaps        ${dim(env.gaps.hint)}`);

    // ------------------------------------------------------------------ 2
    act(2, "Learn four services in four protocols. No integration code.");
    const show = (label: string, r: Awaited<ReturnType<RightClick["learn"]>>) => {
      const l = r.results[0];
      const probe = l?.probes.find((p) => p.ok);
      log(`  ${label.padEnd(9)} ${dim((probe?.kind ?? "?").padEnd(8))} +${String(r.totalNewCapabilities).padStart(2)} capabilities  ${green(`+${fmt(r.totalNewPowers)} powers`)}  ${dim(`→ ${fmt(r.graph.total)} total`)}`);
      if (l?.error) log(red(`    ${l.error}`));
    };
    show("Polyglot", await rc.learn({ source: stage.polyglot }));
    show("Atlas", await rc.learn({ source: stage.atlas }));
    show("Skycast", await rc.learn({ source: stage.skycast }));
    show("Newsroom", await rc.learn({ source: stage.newsroom }));
    const form = rc.graph.list().find((x) => x.source === "web");
    if (form) log(`  ${dim("the Newsroom search box became a capability:")} ${form.title} (${form.inputs.map((p) => `${p.name}:${p.type}`).join(", ")} → html)`);
    log(`  ${dim("semantic types inferred, e.g.")} geocode.latitude→${typeOf(rc, "geocode", "latitude")}, translate.target→${typeOf(rc, "translate", "target", true)}, forecast.summary→${typeOf(rc, "forecast", "summary")}`);

    // ------------------------------------------------------------------ 3
    act(3, "Compose: what I have → what I want, across providers");
    const goal = { have: { place: "Lisbon", language: "es" }, want: "text", intent: "weather translated" };
    log(`  have ${JSON.stringify(goal.have)}  want ${bold(goal.want)}  intent "${goal.intent}"`);
    const first = await rc.compose({ ...goal, run: true, verify: [{ op: "contains", value: "°C" }] });
    first.plans.slice(0, 3).forEach((p, i) => log(`  ${i === 0 ? green("▶") : " "} ${p.titles.join(magenta(" → "))}  ${dim(`[${p.providers.join(", ")}]`)}`));
    log(`  result   ${bold(String(first.executed?.output))}`);
    log(`  verified ${first.executed?.verification.status === "verified" ? green("✓ verified") : red(first.executed?.verification.status ?? "-")}  ${dim(`${first.executed?.durationMs}ms, ${first.executed?.runs.length} receipts`)}`);
    if (first.crystallized) log(`  ${yellow("✦ crystallized")} ${first.crystallized.title}  ${green(`+${fmt(first.crystallized.newPowers)} powers`)}`);

    // ------------------------------------------------------------------ 4
    act(4, "Powers compound: the proven pipeline is now one capability");
    const again = await rc.compose({ ...goal, have: { place: "Tokyo", language: "fr" }, run: true });
    log(`  ${green("▶")} ${again.executed?.titles.join(magenta(" → "))}  ${dim(`(${again.executed?.durationMs}ms vs ${first.executed?.durationMs}ms)`)}`);
    log(`  result   ${bold(String(again.executed?.output))}`);
    const atlasPowers = rc.actions({ type: "place" });
    log(`  a ${bold("place")} can now become: ${atlasPowers.reachableTypes.map((t) => t.type).join(", ")}`);

    // ------------------------------------------------------------------ 5
    act(5, "Federation: absorb another region's graph");
    const peer = await RightClick.create({ name: "rcx-eu-west", region: "eu-west" });
    await peer.learn({ source: stage.skycastMirror });
    const peerServer = await serve(createHandler(peer, { open: true }), 0);
    const fed = await rc.learn({ source: peerServer.url });
    log(`  peer ${peerServer.url}  ${dim("(eu-west)")}  +${fed.totalNewCapabilities} federated capabilities  ${green(`+${fmt(fed.totalNewPowers)} powers`)}`);

    // ------------------------------------------------------------------ 6
    act(6, "Self-healing: a provider dies mid-flight");
    await stage.stop("skycast");
    log(`  ${red("✗")} Skycast (local) is now offline`);
    const healed = await rc.compose({ have: { place: "Nairobi", language: "es" }, want: "text", intent: "weather translated", run: true });
    for (const a of healed.executed?.attempts ?? []) log(`  ${red("✗")} ${a.summary}  ${dim(`failed at ${a.failed} → route around it, re-plan`)}`);
    const via = (healed.executed?.runs ?? []).map((id) => rc.runs.get(id)?.provider ?? "?");
    log(`  ${green("▶")} ${healed.executed?.titles.map((t, i) => `${t} ${dim(`@${via[i]}`)}`).join(magenta(" → "))}`);
    log(`  result   ${bold(String(healed.executed?.output))}`);
    const sky = [...rc.ledger.stats].filter(([id]) => id.includes("forecast"));
    for (const [id, e] of sky) log(`  ${dim("ledger")} ${id.split(":").slice(-1)[0].padEnd(9)} ${dim(id.split(":")[0].padEnd(5))} reliability ${rc.ledger.reliability(id).toFixed(2)}  (${e.ok}/${e.runs} ok)`);
    await peerServer.close();

    // ------------------------------------------------------------------ 7
    act(7, "Receipts: every run is in a tamper-evident hash chain");
    const chain = await rc.verifyReceipts();
    log(`  ${chain.count} receipts · head ${chain.head.slice(0, 16)}… · intact ${chain.intact ? green("✓") : red("✗")}`);
    const forged = rc.chain.receipts.map((r) => ({ ...r }));
    forged[1].durationMs = 1;
    log(`  forge one receipt's timing → chain breaks at #${await ReceiptChain.verify(forged)} ${green("✓ detected")}`);

    if (opts.online) {
      act(8, "Online: research the public internet");
      const world = await rc.research({ topic: "weather", limit: 3 });
      for (const d of world.directories) {
        log(`  ${d.title}: ${d.reachable ? `${d.candidates.length} candidates` : red(`unreachable (${d.error})`)}`);
        for (const cnd of d.candidates) log(`    · ${cnd.title} ${dim(cnd.kind)} ${dim(cnd.source.slice(0, 80))}`);
      }
      const countries = await rc.learn({ source: "https://countries.trevorblades.com/" });
      log(`  learned countries.trevorblades.com (GraphQL): +${countries.totalNewCapabilities} capabilities ${green(`+${fmt(countries.totalNewPowers)} powers`)}${countries.results[0]?.error ? red(" " + countries.results[0].error) : ""}`);
    }

    const final = rc.runtime().graph;
    log(`\n${bold("Final graph")}  ${final.providers} providers · ${final.capabilities} capabilities · ${fmt(final.edges)} typed links · ${bold(green(fmt(final.total)))} composite powers`);
    log(dim(`Started from ${fmt(g0.total)}. Thirteen context_* tools exposed the whole time; none were added.\n`));
    log(`Watch it live:  ${bold("node bin/rcx.ts serve --demo")}  then open the printed URL.\n`);
  } finally {
    await stage.stop();
  }
}

function typeOf(rc: RightClick, capHint: string, port: string, input = false): string {
  const cap = rc.graph.list().find((c) => c.id.toLowerCase().includes(capHint));
  const p = (input ? cap?.inputs : cap?.outputs)?.find((x) => x.name === port);
  return p ? bold(p.type) : "?";
}
