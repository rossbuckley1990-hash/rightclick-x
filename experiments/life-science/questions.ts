// Life-science interoperability questions: wording, answer format, and the
// harness's independent-truth procedure and scorer for each.
//
// Truth is computed by querying each database DIRECTLY (plain fetch from this
// harness process, rate-limited by polite-fetch.ts), never through RightClick X.
// It is recomputed at scoring time, because the databases are live.

export interface Truth {
  /** Expected parts, in answer order. Arrays = any listed value accepted (ties). */
  parts: Array<string | number | string[] | number[] | null>;
  /** Raw facts kept as evidence. */
  facts: Record<string, unknown>;
  /** Harness-side witness: a second, separate source checked for agreement. */
  witness?: { source: string; agrees: boolean; detail: string };
}

export interface Question {
  id: string;
  hops: string[];
  text: string;
  format: string;
  truth: () => Promise<Truth>;
  /** Per-part scoring; returns one boolean per part. */
  score: (answer: string[], t: Truth) => boolean[];
}

const UNIPROT = "https://rest.uniprot.org";
const PROTEINS = "https://www.ebi.ac.uk/proteins/api";
const RCSB_GQL = "https://data.rcsb.org/graphql";
const RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const OLS = "https://www.ebi.ac.uk/ols4";

async function json(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`truth query failed: HTTP ${r.status} ${url}`);
  return r.json();
}
const gql = async (query: string) => (await json(RCSB_GQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).data;
const uniprotSearch = async (q: string, fields = "accession") => (await json(`${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(q)}&fields=${fields}&format=json&size=25`)).results as any[];
const uniprotEntry = (acc: string) => json(`${UNIPROT}/uniprotkb/${acc}?format=json`);
const pdbXrefs = (e: any) => (e.uniProtKBCrossReferences ?? []).filter((x: any) => x.database === "PDB");
async function rcsbEntriesForUniprot(acc: string): Promise<string[]> {
  const query = {
    query: {
      type: "group",
      logical_operator: "and",
      nodes: [
        { type: "terminal", service: "text", parameters: { attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession", operator: "exact_match", value: acc } },
        { type: "terminal", service: "text", parameters: { attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name", operator: "exact_match", value: "UniProt" } },
      ],
    },
    return_type: "entry",
    request_options: { return_all_hits: true },
  };
  const r = await json(RCSB_SEARCH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) });
  return (r?.result_set ?? []).map((x: any) => String(x.identifier ?? x)).sort();
}
async function entries(ids: string[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(`{ entries(entry_ids: ${JSON.stringify(ids.slice(i, i + 50))}) { rcsb_id exptl { method } rcsb_entry_info { resolution_combined experimental_method } } }`);
    out.push(...(d.entries ?? []));
  }
  return out;
}

// ---------------------------------------------------------------- scoring helpers
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[`*"']/g, "").replace(/\s+/g, " ");
const tokens = (s: string) => norm(s).split(/[,;\s]+/).filter(Boolean);
const num = (s: string) => Number(/-?\d+(?:\.\d+)?/.exec(s ?? "")?.[0]);
const eqId = (a: string, b: unknown) => norm(a).replace(/^(uniprot(kb)?|pdb)\s*:\s*/, "") === norm(b);
const set = (a: string) => [...new Set(tokens(a).map((x) => x.toUpperCase()))].sort();
const sameSet = (a: string, b: string[]) => JSON.stringify(set(a)) === JSON.stringify([...new Set(b.map((x) => x.toUpperCase()))].sort());
const method = (a: string, b: string) => {
  const k = (s: string) => (/x-?ray/i.test(s) ? "xray" : /electron microscopy|cryo-?em|\bem\b/i.test(s) ? "em" : /nmr/i.test(s) ? "nmr" : norm(s));
  return k(a) === k(b);
};
const close = (a: string, b: number, tol: number) => Number.isFinite(num(a)) && Math.abs(num(a) - b) <= tol;
const formula = (s: string) => norm(s).replace(/\s+/g, "").toUpperCase();

// ---------------------------------------------------------------- questions
export const QUESTIONS: Question[] = [
  {
    id: "Q01",
    hops: ["gene symbol", "UniProtKB accession"],
    text: "What is the reviewed (Swiss-Prot) UniProtKB accession of the human gene TP53?",
    format: "ANSWER: <accession>",
    truth: async () => {
      const r = await uniprotSearch("gene_exact:TP53 AND organism_id:9606 AND reviewed:true");
      const accs = r.map((x) => x.primaryAccession);
      const w = await json(`${PROTEINS}/proteins?offset=0&size=10&exact_gene=TP53&taxid=9606&reviewed=true`);
      // the Proteins API also lists isoforms (P04637-2 ...); compare canonical accessions
      const waccs = [...new Set<string>((w ?? []).map((x: any) => String(x.accession).split("-")[0]))];
      return { parts: [accs], facts: { uniprot: accs }, witness: { source: "EBI Proteins API /proteins?exact_gene", agrees: JSON.stringify(waccs.sort()) === JSON.stringify([...accs].sort()), detail: waccs.join(",") } };
    },
    score: (a, t) => [(t.parts[0] as string[]).length === 1 && eqId(a[0], (t.parts[0] as string[])[0])],
  },
  {
    id: "Q02",
    hops: ["gene symbol", "UniProtKB accession", "PDB cross-references"],
    text: "For human leptin (gene LEP): give its reviewed UniProtKB accession, the number of PDB entries that UniProtKB cross-references for it, and those PDB IDs.",
    format: "ANSWER: <accession> | <count> | <comma-separated PDB IDs>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:LEP AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const ids = pdbXrefs(await uniprotEntry(acc)).map((x: any) => x.id).sort();
      const rcsb = await rcsbEntriesForUniprot(acc);
      return { parts: [acc, ids.length, ids], facts: { accession: acc, uniprotPdbXrefs: ids, rcsbSearch: rcsb }, witness: { source: "RCSB Search (entries mapped to the accession)", agrees: JSON.stringify(rcsb) === JSON.stringify(ids), detail: `${rcsb.length} entries: ${rcsb.join(",")}` } };
    },
    score: (a, t) => [eqId(a[0], t.parts[0]), num(a[1]) === t.parts[1], sameSet(a[2] ?? "", t.parts[2] as string[])],
  },
  {
    id: "Q03",
    hops: ["gene symbol", "UniProtKB accession", "PDB cross-references", "RCSB entry metadata"],
    text: "Among the PDB entries that UniProtKB cross-references for human leptin (gene LEP), which entry has the best (numerically lowest) resolution according to RCSB PDB, what is that resolution in Å, and what experimental method was used?",
    format: "ANSWER: <PDB ID> | <resolution in Å> | <experimental method>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:LEP AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const x = pdbXrefs(await uniprotEntry(acc));
      const e = await entries(x.map((y: any) => y.id));
      const withRes = e.filter((y) => y.rcsb_entry_info?.resolution_combined?.length).map((y) => ({ id: y.rcsb_id, res: Math.min(...y.rcsb_entry_info.resolution_combined), method: y.exptl?.[0]?.method }));
      const best = Math.min(...withRes.map((y) => y.res));
      const winners = withRes.filter((y) => Math.abs(y.res - best) < 1e-9);
      const uniprotRes = Object.fromEntries(x.map((y: any) => [y.id, y.properties?.find((p: any) => p.key === "Resolution")?.value]));
      const uniBest = winners.every((w) => String(uniprotRes[w.id] ?? "").includes(String(best)));
      return { parts: [winners.map((w) => w.id), best, winners[0].method], facts: { accession: acc, entries: withRes, uniprotResolutions: uniprotRes }, witness: { source: "UniProtKB PDB cross-reference 'Resolution' property", agrees: uniBest, detail: winners.map((w) => `${w.id}: ${uniprotRes[w.id]}`).join("; ") } };
    },
    score: (a, t) => [(t.parts[0] as string[]).some((id) => eqId(a[0], id)), close(a[1], t.parts[1] as number, 0.01), method(a[2] ?? "", String(t.parts[2]))],
  },
  {
    id: "Q04",
    hops: ["PDB ID", "RCSB entry metadata", "polymer entities", "UniProtKB accessions", "gene names"],
    text: "For PDB entry 4HHB: what is its experimental method and resolution (Å), which UniProtKB accessions do its protein entities map to, and what are the primary gene names of those UniProtKB entries?",
    format: "ANSWER: <method> | <resolution in Å> | <accessions, comma-separated> | <gene names, comma-separated>",
    truth: async () => {
      const d = await gql(`{ entry(entry_id: "4HHB") { exptl { method } rcsb_entry_info { resolution_combined } polymer_entities { rcsb_polymer_entity_container_identifiers { uniprot_ids } } } }`);
      const accs = [...new Set<string>(d.entry.polymer_entities.flatMap((p: any) => p.rcsb_polymer_entity_container_identifiers?.uniprot_ids ?? []))].sort();
      const genes: string[] = [];
      for (const a of accs) genes.push((await uniprotEntry(a)).genes?.[0]?.geneName?.value);
      return { parts: [d.entry.exptl[0].method, d.entry.rcsb_entry_info.resolution_combined[0], accs, genes], facts: { entry: d.entry, genes } };
    },
    score: (a, t) => [method(a[0] ?? "", String(t.parts[0])), close(a[1], t.parts[1] as number, 0.01), sameSet(a[2] ?? "", t.parts[2] as string[]), sameSet(a[3] ?? "", t.parts[3] as string[])],
  },
  {
    id: "Q05",
    hops: ["PDB ID", "RCSB entry metadata", "polymer entities", "UniProtKB accessions", "organisms"],
    text: "For PDB entry 6M0J: what is its resolution (Å), and which UniProtKB accessions do its protein entities map to, each with the organism (scientific name) that UniProtKB gives for that accession?",
    format: "ANSWER: <resolution in Å> | <accession>: <organism>; <accession>: <organism>",
    truth: async () => {
      const d = await gql(`{ entry(entry_id: "6M0J") { rcsb_entry_info { resolution_combined } polymer_entities { rcsb_polymer_entity_container_identifiers { uniprot_ids } } } }`);
      const accs = [...new Set<string>(d.entry.polymer_entities.flatMap((p: any) => p.rcsb_polymer_entity_container_identifiers?.uniprot_ids ?? []))].sort();
      const orgs: Record<string, string> = {};
      for (const a of accs) orgs[a] = (await uniprotEntry(a)).organism?.scientificName;
      return { parts: [d.entry.rcsb_entry_info.resolution_combined[0], orgs as any], facts: { entry: d.entry, organisms: orgs } };
    },
    score: (a, t) => {
      const orgs = t.parts[1] as unknown as Record<string, string>;
      const given = new Map((a[1] ?? "").split(";").map((s) => s.split(":").map((x) => x.trim())).filter((p) => p.length >= 2).map(([k, ...v]) => [k.toUpperCase(), v.join(":")]));
      const ok = Object.keys(orgs).length === given.size && Object.entries(orgs).every(([k, v]) => given.has(k) && norm(given.get(k)).includes(norm(v).split(" (")[0]));
      return [close(a[0], t.parts[0] as number, 0.01), ok];
    },
  },
  {
    id: "Q06",
    hops: ["gene symbol", "UniProtKB accession", "UniProtKB disease (MIM)", "OLS MONDO term"],
    text: "For the human gene CFTR: give its reviewed UniProtKB accession; the name of the disease that UniProtKB associates with it under MIM identifier 219700; and the MONDO identifier of that disease, as found in the Ontology Lookup Service (OLS).",
    format: "ANSWER: <accession> | <disease name> | <MONDO ID, e.g. MONDO:0000000>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:CFTR AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const e = await uniprotEntry(acc);
      const dis = (e.comments ?? []).filter((c: any) => c.commentType === "DISEASE").map((c: any) => c.disease).find((d: any) => d?.diseaseCrossReference?.id === "219700");
      const s = await json(`${OLS}/api/search?q=${encodeURIComponent(dis.diseaseId)}&ontology=mondo&exact=true&queryFields=label&rows=5`);
      const mondo = (s.response?.docs ?? []).filter((d: any) => d.is_defining_ontology !== false).map((d: any) => d.obo_id);
      // witness: the MONDO term itself lists OMIM:219700 among its cross-references
      const viaXref: string[] = [];
      for (const m of mondo) {
        const term = (await json(`${OLS}/api/ontologies/mondo/terms?obo_id=${encodeURIComponent(m)}`))?._embedded?.terms?.[0];
        const xrefs = [...(term?.annotation?.database_cross_reference ?? []), ...(term?.obo_xref ?? []).map((x: any) => `${x.database}:${x.id}`)];
        if (xrefs.some((x: string) => /^(OMIM|MIM):219700$/i.test(x))) viaXref.push(m);
      }
      return { parts: [acc, dis.diseaseId, [...new Set<string>(mondo)]], facts: { accession: acc, disease: dis, olsLabelSearch: mondo, olsXrefSearch: viaXref }, witness: { source: "OLS MONDO cross-reference search for OMIM:219700", agrees: viaXref.some((m: string) => mondo.includes(m)), detail: viaXref.join(",") } };
    },
    score: (a, t) => [eqId(a[0], t.parts[0]), norm(a[1]).includes(norm(t.parts[1])), (t.parts[2] as string[]).some((m) => norm(a[2]).includes(norm(m)))],
  },
  {
    id: "Q07",
    hops: ["UniProtKB accession", "GO annotation", "OLS GO hierarchy"],
    text: "UniProtKB entry P68871 (human hemoglobin subunit beta) carries a Gene Ontology biological-process annotation 'oxygen transport'. What is that GO term's identifier, and what is the label of its direct is_a parent term(s) in GO according to the Ontology Lookup Service (OLS)?",
    format: "ANSWER: <GO ID> | <parent label(s), comma-separated>",
    truth: async () => {
      const e = await uniprotEntry("P68871");
      const go = (e.uniProtKBCrossReferences ?? []).find((x: any) => x.database === "GO" && x.properties?.some((p: any) => p.value === "P:oxygen transport"))?.id;
      const iri = encodeURIComponent(encodeURIComponent(`http://purl.obolibrary.org/obo/${go.replace(":", "_")}`));
      const p = await json(`${OLS}/api/ontologies/go/terms/${iri}/parents`);
      const labels = (p._embedded?.terms ?? []).map((t: any) => t.label).sort();
      return { parts: [go, labels], facts: { go, parents: p._embedded?.terms?.map((t: any) => ({ id: t.obo_id, label: t.label })) } };
    },
    score: (a, t) => {
      const want = (t.parts[1] as string[]).map(norm);
      const got = (a[1] ?? "").split(/[,;]/).map(norm).filter(Boolean);
      return [eqId(a[0], t.parts[0]), want.length === got.length && want.every((w) => got.includes(w))];
    },
  },
  {
    id: "Q08",
    hops: ["gene symbol", "UniProtKB accession", "EBI Proteins genomic coordinates"],
    text: "For the human gene BRCA1: give its reviewed UniProtKB accession, and, according to the EBI Proteins API genomic coordinates for that accession, the chromosome and the Ensembl gene ID.",
    format: "ANSWER: <accession> | <chromosome> | <Ensembl gene ID>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:BRCA1 AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const c = await json(`${PROTEINS}/coordinates/${acc}`);
      const g = c.gnCoordinate ?? [];
      const chroms = [...new Set<string>(g.map((x: any) => x.genomicLocation?.chromosome))];
      const genes = [...new Set<string>(g.map((x: any) => x.ensemblGeneId))];
      const e = await uniprotEntry(acc);
      const uniEns = (e.uniProtKBCrossReferences ?? []).filter((x: any) => x.database === "Ensembl").flatMap((x: any) => x.properties?.filter((p: any) => p.key === "GeneId").map((p: any) => String(p.value).split(".")[0]) ?? []);
      return { parts: [acc, chroms, genes], facts: { accession: acc, chromosomes: chroms, ensemblGenes: genes }, witness: { source: "UniProtKB Ensembl cross-references (GeneId)", agrees: genes.every((x) => uniEns.includes(x)), detail: [...new Set(uniEns)].join(",") } };
    },
    score: (a, t) => [eqId(a[0], t.parts[0]), (t.parts[1] as string[]).some((c) => norm(a[1]).replace(/^chr(omosome)?\s*/, "") === norm(c)), (t.parts[2] as string[]).some((g) => norm(a[2]).split(".")[0] === norm(g))],
  },
  {
    id: "Q09",
    hops: ["UniProtKB accession", "canonical sequence", "EBI Proteins isoforms"],
    text: "For UniProtKB P04637: what is the length of the canonical sequence according to UniProtKB, and how many isoform entries does the EBI Proteins API isoforms endpoint return for it?",
    format: "ANSWER: <canonical length> | <number of isoform entries>",
    truth: async () => {
      const e = await uniprotEntry("P04637");
      const iso = await json(`${PROTEINS}/proteins/P04637/isoforms`);
      const n = Array.isArray(iso) ? iso.length : 0;
      const alt = (e.comments ?? []).find((c: any) => c.commentType === "ALTERNATIVE PRODUCTS")?.isoforms?.length;
      return { parts: [e.sequence.length, n], facts: { length: e.sequence.length, isoformEntries: n, isoformAccessions: (iso ?? []).map((x: any) => x.accession), uniprotAlternativeProductsIsoforms: alt } };
    },
    score: (a, t) => [num(a[0]) === t.parts[0], num(a[1]) === t.parts[1]],
  },
  {
    id: "Q10",
    hops: ["PDB ID", "non-polymer entities", "chemical component dictionary"],
    text: "PDB entry 1HSG contains a bound small-molecule ligand (ignore water). What is its chemical component ID, and what are its chemical formula and formula weight according to the RCSB PDB chemical component dictionary?",
    format: "ANSWER: <component ID> | <formula> | <formula weight>",
    truth: async () => {
      const d = await gql(`{ entry(entry_id: "1HSG") { nonpolymer_entities { pdbx_entity_nonpoly { comp_id } } } }`);
      const comps = d.entry.nonpolymer_entities.map((n: any) => n.pdbx_entity_nonpoly.comp_id).filter((c: string) => c !== "HOH");
      const cc = await gql(`{ chem_comp(comp_id: ${JSON.stringify(comps[0])}) { chem_comp { id formula formula_weight name } } }`);
      return { parts: [comps, cc.chem_comp.chem_comp.formula, cc.chem_comp.chem_comp.formula_weight], facts: { comps, chem_comp: cc.chem_comp.chem_comp } };
    },
    score: (a, t) => [(t.parts[0] as string[]).length === 1 && eqId(a[0], (t.parts[0] as string[])[0]), formula(a[1]) === formula(String(t.parts[1])), close(a[2], t.parts[2] as number, 0.1)],
  },
  {
    id: "Q11",
    hops: ["gene symbol", "UniProtKB accession", "RCSB Search (structures mapped to accession)"],
    text: "Using RCSB PDB's search service: how many PDB entries contain a protein entity mapped to the reviewed UniProtKB accession of human leptin (gene LEP), and which are they?",
    format: "ANSWER: <count> | <comma-separated PDB IDs>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:LEP AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const ids = await rcsbEntriesForUniprot(acc);
      return { parts: [ids.length, ids], facts: { accession: acc, rcsbSearch: ids } };
    },
    score: (a, t) => [num(a[0]) === t.parts[0], sameSet(a[1] ?? "", t.parts[1] as string[])],
  },
  {
    id: "Q12",
    hops: ["gene symbol", "UniProtKB accession", "EBI Proteins features"],
    text: "For the human gene EGFR: give its reviewed UniProtKB accession, and, according to the EBI Proteins API sequence features, how many transmembrane regions (feature type TRANSMEM) it has and their start-end positions.",
    format: "ANSWER: <accession> | <count> | <start-end, comma-separated>",
    truth: async () => {
      const acc = (await uniprotSearch("gene_exact:EGFR AND organism_id:9606 AND reviewed:true"))[0].primaryAccession;
      const f = await json(`${PROTEINS}/features/${acc}?types=TRANSMEM`);
      const tm = (f.features ?? []).filter((x: any) => x.type === "TRANSMEM").map((x: any) => `${x.begin}-${x.end}`);
      const e = await uniprotEntry(acc);
      const utm = (e.features ?? []).filter((x: any) => x.type === "Transmembrane").map((x: any) => `${x.location.start.value}-${x.location.end.value}`);
      return { parts: [acc, tm.length, tm], facts: { accession: acc, transmembrane: tm }, witness: { source: "UniProtKB entry features (Transmembrane)", agrees: JSON.stringify(utm) === JSON.stringify(tm), detail: utm.join(",") } };
    },
    score: (a, t) => [eqId(a[0], t.parts[0]), num(a[1]) === t.parts[1], JSON.stringify((a[2] ?? "").split(/[,;]/).map((s) => s.replace(/[^\d-]/g, "")).filter(Boolean).sort()) === JSON.stringify([...(t.parts[2] as string[])].sort())],
  },
  {
    id: "Q13",
    hops: ["gene symbol", "UniProtKB accession (negative control)"],
    text: "What is the reviewed (Swiss-Prot) UniProtKB accession of the human gene QZX9NOTAGENE? If no such entry exists, say so rather than guessing.",
    format: "ANSWER: <accession, or NONE if no such entry exists>",
    truth: async () => {
      const r = await uniprotSearch("gene_exact:QZX9NOTAGENE AND organism_id:9606 AND reviewed:true");
      return { parts: [r.length ? r.map((x) => x.primaryAccession) : null], facts: { hits: r.length } };
    },
    score: (a, t) => [t.parts[0] === null ? /^(none|no such|not found|n\/a)/i.test(norm(a[0])) : (t.parts[0] as string[]).some((x) => eqId(a[0], x))],
  },
  {
    id: "Q14",
    hops: ["UniProtKB accession", "PDB cross-references (large set)", "RCSB Search (large set)"],
    text: "For UniProtKB P04637 (human p53): how many PDB entries does UniProtKB cross-reference, and how many PDB entries does RCSB PDB's search service map to that accession? Report exact totals, not page sizes.",
    format: "ANSWER: <UniProtKB PDB cross-reference count> | <RCSB entry count>",
    truth: async () => {
      const x = pdbXrefs(await uniprotEntry("P04637")).map((y: any) => y.id);
      const r = await rcsbEntriesForUniprot("P04637");
      return { parts: [x.length, r.length], facts: { uniprotCount: x.length, rcsbCount: r.length, onlyInUniprot: x.filter((i: string) => !r.includes(i)), onlyInRcsb: r.filter((i) => !x.includes(i)) } };
    },
    score: (a, t) => [num(a[0]) === t.parts[0], num(a[1]) === t.parts[1]],
  },
];

/** Split "ANSWER: a | b | c" into parts. */
export function parseAnswer(answer: string | undefined): string[] {
  return (answer ?? "").split("|").map((s) => s.trim());
}
