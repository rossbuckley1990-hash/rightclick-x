// Stage 6: does capability knowledge transfer, and is it revalidated before use? (EVALUATION-PLAN §7)
//   node experiments/north-star/transfer.ts export <holdout.json> <bundle-out.json>       (on the Mac)
//   node experiments/north-star/transfer.ts container <bundle.json> <holdout.json> <report-out.json>
//                                                                   (inside the Linux container)
// In the container, for each holdout program present under the same name:
//   cold    - investigate it from nothing (runs, ms)
//   import  - import the Mac's knowledge: each capability revalidated by replaying its examples here
//   tasks   - each holdout task whose reference invocation uses only documented options is run
//             through the imported documented-options capability and compared with the oracle
//             computed HERE (the container's own program is the truth here)
//   linux   - knowledge exported from the cold Linux runtime, imported into a fresh one (positive
//             control: same environment, so it should transfer)
import { readFileSync, writeFileSync } from "node:fs";
import { RightClick } from "../../src/runtime.ts";
import { matches, oracle, type Task } from "./common.ts";

const [mode, a, b, c] = process.argv.slice(2);

if (mode === "export") {
  const holdout = JSON.parse(readFileSync(a, "utf8"));
  const paths = holdout.programs.map((p: any) => p.path);
  const rc = await RightClick.create({ name: "mac-exporter", directories: [], authority: { investigate: paths, shareEvidence: true } });
  const t0 = performance.now();
  const r = await rc.learn({ sources: paths.map((p: string) => `cli:${p}`) });
  const bundle = rc.exportKnowledge();
  writeFileSync(b, JSON.stringify(bundle, null, 2));
  console.log(JSON.stringify({ programs: bundle.programs.length, capabilities: bundle.programs.reduce((n, p) => n + p.capabilities.length, 0), ms: Math.round(performance.now() - t0), errors: r.results.filter((x) => x.error).map((x) => `${x.source}: ${x.error}`) }));
} else if (mode === "container") {
  const bundle = JSON.parse(readFileSync(a, "utf8"));
  const holdout = JSON.parse(readFileSync(b, "utf8"));
  const { existsSync } = await import("node:fs");
  const report: any = { at: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, programs: [] };
  for (const prog of bundle.programs) {
    const local = ["/usr/bin", "/bin", "/usr/local/bin"].map((d) => `${d}/${prog.name}`).find((p) => existsSync(p));
    const entry: any = { name: prog.name, macPath: prog.path, local: local ?? null };
    report.programs.push(entry);
    if (!local) {
      entry.status = "absent here";
      continue;
    }
    // Cold: learn from nothing.
    const cold = await RightClick.create({ name: "linux-cold", directories: [], authority: { investigate: [local], shareEvidence: true } });
    let t0 = performance.now();
    const learned = await cold.learn({ source: `cli:${local}` });
    entry.cold = { ms: Math.round(performance.now() - t0), runs: cold.investigations.get(local)?.runs.length ?? 0, capabilities: cold.graph.list().filter((x) => x.invoke.kind === "cli").length, detail: learned.results[0].error ?? learned.results[0].probes?.[0]?.detail };
    // Import the Mac's knowledge: revalidated here before anything is used.
    const warm = await RightClick.create({ name: "linux-warm", directories: [], authority: { investigate: [local] } });
    t0 = performance.now();
    const imp = await warm.importKnowledge({ ...bundle, programs: [{ ...prog, path: local }] });
    const pr = imp.programs[0];
    entry.importFromMac = { ms: Math.round(performance.now() - t0), status: pr.status, revalidationRuns: pr.revalidationRuns, sameBytes: pr.sameBytes, accepted: pr.capabilities.filter((x) => x.status === "accepted").map((x) => x.id), refused: pr.capabilities.filter((x) => x.status === "refused").map((x) => ({ id: x.id, reason: x.reason?.slice(0, 200) })) };
    // Tasks through the imported documented-options capability, against this host's own truth.
    const h = holdout.programs.find((p: any) => p.name === prog.name);
    const invId = entry.importFromMac.accepted.find((id: string) => id.endsWith(":invoke"));
    entry.tasks = [];
    for (const t of (h?.tasks ?? []).filter((x: Task) => x.kind === "feasible" && x.reference)) {
      const truth = await oracle(local, t);
      if (!truth.valid) {
        entry.tasks.push({ task: t.id, status: "reference invalid here", reason: truth.invalidReason });
        continue;
      }
      if (!invId) {
        entry.tasks.push({ task: t.id, status: "not run: no revalidated capability" });
        continue;
      }
      const files = Object.keys(t.input.files ?? {});
      const options = t.reference!.argv.filter((x: string) => !files.includes(x));
      const r = await warm.run(invId, { input: t.input.stdin ?? "", options, ...(files.length ? { files: Object.fromEntries(files.filter((f) => t.reference!.argv.includes(f)).map((f) => [f, t.input.files![f]])) } : {}) });
      const correct = r.status === "completed" && matches(truth, String(r.output ?? ""));
      entry.tasks.push({ task: t.id, status: r.status, correct, wrong: r.status === "completed" && !correct, ...(r.error ? { error: r.error.slice(0, 200) } : {}) });
    }
    // Positive control: Linux -> Linux (same environment).
    const fresh = await RightClick.create({ name: "linux-second", directories: [], authority: { investigate: [local] } });
    t0 = performance.now();
    const ll = await fresh.importKnowledge(cold.exportKnowledge());
    entry.linuxToLinux = { ms: Math.round(performance.now() - t0), status: ll.programs[0]?.status, revalidationRuns: ll.programs[0]?.revalidationRuns, accepted: ll.programs[0]?.capabilities.filter((x) => x.status === "accepted").length, refused: ll.programs[0]?.capabilities.filter((x) => x.status === "refused").length };
    console.log(`${prog.name}: cold ${entry.cold.runs} runs/${entry.cold.ms} ms; from Mac ${pr.status} (${pr.revalidationRuns} runs); tasks ${entry.tasks.filter((x: any) => x.correct).length}/${entry.tasks.length} correct, ${entry.tasks.filter((x: any) => x.wrong).length} wrong; Linux->Linux ${entry.linuxToLinux.status} (${entry.linuxToLinux.revalidationRuns} runs)`);
  }
  writeFileSync(c, JSON.stringify(report, null, 2));
} else {
  console.log("usage: transfer.ts export <holdout> <bundle> | container <bundle> <holdout> <report>");
}
