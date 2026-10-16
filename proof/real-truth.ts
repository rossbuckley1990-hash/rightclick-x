// Independent oracle for the real-provider destination-brief experiment.
// Deliberately imports no formatter, worker, runtime, or shared render helper.
// All retained evidence is public API data. This is proof infrastructure.

export interface PublicFetchEvidence {
  method: string;
  url: string;
  requestBody?: unknown;
  startedAt: string;
  finishedAt: string;
  finalUrl?: string;
  status: number | null;
  headers?: Record<string, string>;
  rawBody?: string;
  body?: unknown;
  error?: string;
}

export interface DestinationTruth {
  countryCode: string;
  name: string;
  capital: string;
  wikiTitle: string;
  wikiExtract: string;
  wikiUrl: string;
  wikiPageId: number;
  wikiRevision?: number;
  wikiTimestamp?: string;
  fetchedAt: string;
  acceptedSourceUrls: string[];
  aliasVerified: boolean;
  fetches: PublicFetchEvidence[];
}

export interface BriefVerification {
  verified: boolean;
  checks: {
    expectedCountry: string;
    expectedCapital: string;
    recognizedFormat: boolean;
    countryCapitalHeading: boolean;
    fullWikipediaExtract: boolean;
    sourceUrl: boolean;
    sourceLabel: boolean;
  };
  actual: { headingCapital?: string; sourceUrl?: string; sourceLabel?: string; body?: string };
}

export class TruthFetchError extends Error {
  evidence: PublicFetchEvidence[];
  constructor(message: string, evidence: PublicFetchEvidence[]) {
    super(message);
    this.name = "TruthFetchError";
    this.evidence = evidence;
  }
}

const normalize = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
const sameTitle = (left: string, right: string) => normalize(left.replaceAll("_", " ")).toLocaleLowerCase("en") === normalize(right.replaceAll("_", " ")).toLocaleLowerCase("en");

async function publicJson(url: string, evidence: PublicFetchEvidence[], requestBody?: unknown): Promise<any> {
  const record: PublicFetchEvidence = {
    method: requestBody === undefined ? "GET" : "POST", url, requestBody,
    startedAt: new Date().toISOString(), finishedAt: "", status: null,
  };
  evidence.push(record);
  try {
    const response = await fetch(url, {
      method: record.method,
      headers: { "user-agent": "RightClickX-independent-proof/0.1", ...(requestBody === undefined ? {} : { "content-type": "application/json" }) },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      signal: AbortSignal.timeout(20_000),
    });
    record.finalUrl = response.url;
    record.status = response.status;
    record.headers = Object.fromEntries(["content-type", "etag", "last-modified", "date"].map((key) => [key, response.headers.get(key)]).filter((entry): entry is [string, string] => entry[1] !== null));
    record.rawBody = await response.text();
    if (record.rawBody.length > 2_000_000) throw new Error("Public response exceeded the evidence size bound");
    record.body = JSON.parse(record.rawBody);
    if (!response.ok) throw new Error(`Public API returned HTTP ${response.status}`);
    return record.body;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    throw new TruthFetchError(`${url}: ${record.error}`, evidence);
  } finally {
    record.finishedAt = new Date().toISOString();
  }
}

/** Fetch current facts directly from their public origins, bypassing RightClick X. */
export async function fetchTruth(country: string): Promise<DestinationTruth> {
  const countryCode = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("Expected an ISO alpha-2 country code");
  const fetches: PublicFetchEvidence[] = [];
  const countryResponse = await publicJson("https://countries.trevorblades.com/", fetches, {
    query: "query IndependentCountryTruth($code: ID!) { country(code: $code) { code name capital } }",
    variables: { code: countryCode },
  });
  const found = countryResponse?.data?.country;
  if (countryResponse.errors || !found || found.code !== countryCode || typeof found.name !== "string" || typeof found.capital !== "string" || !found.capital.trim()) {
    throw new TruthFetchError("Country API did not return an unambiguous country and capital", fetches);
  }
  const capital: string = found.capital;
  const summary = await publicJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capital)}`, fetches);
  if (summary?.type === "disambiguation" || typeof summary?.title !== "string" || typeof summary?.extract !== "string" || summary.extract.length < 20 || !Number.isSafeInteger(summary.pageid)) {
    throw new TruthFetchError("Wikipedia did not return an unambiguous article summary", fetches);
  }
  const wikiUrl = summary.content_urls?.desktop?.page;
  if (typeof wikiUrl !== "string" || new URL(wikiUrl).origin !== "https://en.wikipedia.org") {
    throw new TruthFetchError("Wikipedia summary omitted its canonical public article URL", fetches);
  }
  const requestedArticle = `https://en.wikipedia.org/wiki/${encodeURIComponent(capital.replaceAll(" ", "_"))}`;
  let aliasVerified = sameTitle(capital, summary.title);
  if (!aliasVerified) {
    // The Countries API uses e.g. Reykjavik while Wikipedia canonicalizes to
    // Reykjavík. Verify that alias independently; do not simply strip accents.
    const query = new URLSearchParams({ action: "query", format: "json", redirects: "1", titles: capital });
    const redirect = await publicJson(`https://en.wikipedia.org/w/api.php?${query}`, fetches);
    const pages: any[] = Object.values(redirect?.query?.pages ?? {});
    aliasVerified = pages.length === 1 && pages[0].pageid === summary.pageid && sameTitle(pages[0].title, summary.title);
    if (!aliasVerified) throw new TruthFetchError("Wikipedia alias does not independently resolve to the summary article", fetches);
  }
  return {
    countryCode,
    name: found.name,
    capital,
    wikiTitle: summary.title,
    wikiExtract: summary.extract,
    wikiUrl,
    wikiPageId: summary.pageid,
    wikiRevision: summary.revision,
    wikiTimestamp: summary.timestamp,
    fetchedAt: new Date().toISOString(),
    acceptedSourceUrls: [...new Set([wikiUrl, ...(aliasVerified ? [requestedArticle] : [])])],
    aliasVerified,
    fetches,
  };
}

function articleIdentity(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.origin !== "https://en.wikipedia.org" || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/wiki/")) return undefined;
    return decodeURIComponent(url.pathname).normalize("NFC").replaceAll("_", " ");
  } catch { return undefined; }
}

/** Parse and assess facts separately; do not reproduce the formatter function. */
export function verifyBrief(markdown: string, truth: DestinationTruth): BriefVerification {
  const text = typeof markdown === "string" ? markdown.replaceAll("\r\n", "\n").trim() : "";
  const heading = /^# Destination brief:\s*([^\n]+)\n/.exec(text);
  const source = /(?:^|\n)Source:\s*\[Wikipedia\s*—\s*([^\]]+)\]\(([^\s]+)\)\s*$/.exec(text);
  const body = heading && source && source.index >= heading[0].length ? text.slice(heading[0].length, source.index).trim() : undefined;
  const actualUrl = source ? articleIdentity(source[2]) : undefined;
  const checks = {
    expectedCountry: truth.countryCode,
    expectedCapital: truth.capital,
    recognizedFormat: !!heading && !!source && body !== undefined,
    countryCapitalHeading: !!heading && sameTitle(heading[1], truth.capital),
    fullWikipediaExtract: body !== undefined && normalize(body) === normalize(truth.wikiExtract),
    sourceUrl: actualUrl !== undefined && truth.acceptedSourceUrls.some((url) => articleIdentity(url) === actualUrl),
    sourceLabel: !!source && sameTitle(source[1], truth.capital),
  };
  return {
    verified: checks.recognizedFormat && checks.countryCapitalHeading && checks.fullWikipediaExtract && checks.sourceUrl && checks.sourceLabel,
    checks,
    actual: { headingCapital: heading?.[1], sourceUrl: source?.[2], sourceLabel: source?.[1], body },
  };
}

/** Deliberate bad outputs must fail the same verifier used on real candidates. */
export function negativeControls(markdown: string, truth: DestinationTruth, otherTruth: DestinationTruth) {
  if (truth.countryCode === otherTruth.countryCode || sameTitle(truth.capital, otherTruth.capital)) throw new Error("Wrong-country control requires a different country and capital");
  const wrongSummary = markdown.replace(/(^# Destination brief:[^\n]*\n)[\s\S]*?(\nSource:)/, "$1\nThis is fabricated text for a deliberate negative control.\n$2");
  const wrongSource = markdown.replace(/(Source:\s*\[[^\]]*\]\()([^\s]+)(\))/, "$1https://example.com/not-wikipedia$3");
  return [
    { name: "wrong country", markdown, ...verifyBrief(markdown, otherTruth) },
    { name: "wrong summary", markdown: wrongSummary, ...verifyBrief(wrongSummary, truth) },
    { name: "wrong source URL", markdown: wrongSource, ...verifyBrief(wrongSource, truth) },
  ];
}
