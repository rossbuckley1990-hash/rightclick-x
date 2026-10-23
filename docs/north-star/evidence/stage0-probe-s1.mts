// S1 on a given checkout: mandoc and od learned; "octal dump" of a text. Prints the plan and whether the bytes round-trip.
const root = process.argv[2];
const { RightClick } = await import(`${root}/src/runtime.ts`);
const rc = await RightClick.create({ name: "s1", directories: [], authority: { investigate: ["/usr/bin/mandoc", "/usr/bin/od"] } });
for (const s of ["cli:/usr/bin/mandoc", "cli:/usr/bin/od"]) { const r = await rc.learn({ source: s }); console.log(s, r.results[0].error ?? r.results[0].probes?.[0]?.detail); }
const text = "Harbour lights\tat dusk\n";
for (const intent of ["octal dump of the bytes of a text", "octal dump of the text", "show the bytes of the text in octal", "Output octal bytes"]) {
  const r: any = await rc.compose({ have: { input: { type: "text", value: text } }, want: "text", intent, run: true, view: { full: true } } as any);
  const out = String(r.executed?.output ?? "");
  const bytes = out.split("\n").flatMap((l) => l.trim().split(/\s+/).slice(1)).filter((x) => /^[0-7]{3}$/.test(x)).map((x) => parseInt(x, 8));
  const ok = Buffer.from(bytes).toString() === text;
  console.log(JSON.stringify({ intent, plan: r.executed?.titles ?? r.plan?.steps?.map((s: any) => s.title), status: r.executed?.status, roundTrips: ok }));
}
