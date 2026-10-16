// Disposable owned Cloudflare infrastructure for a real-data proof. This file
// is test infrastructure, never imported by the product runtime.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FormatterVersion = 1 | 2 | 3;
export interface RealDeploymentManifest {
  gatewayUrl: string;
  formatterUrl: string;
  auditorUrl: string;
  adminSecretFile: string;
  workerNames: { formatter: string; auditor: string };
  createdAt: string;
  ownership: string;
}
export interface RealServiceEvent {
  sequence: number;
  at: string;
  service: "formatter" | "auditor";
  action: string;
  detail: Record<string, unknown>;
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_SPEC = "https://en.wikipedia.org/api/rest_v1/?spec";
const COUNTRIES = "https://countries.trevorblades.com/";
const USER_AGENT = "RightClickX-LiveProof/0.1 (bounded read-only deployment preflight)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wrangler(args: string[], input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(ROOT, "node_modules/.bin/wrangler"), args, {
      cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(ROOT, ".rcx-deploy/real-wrangler.log") }, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const safeOutput = input ? output.replaceAll(input, "[REDACTED]") : output;
      if (code === 0) resolvePromise(safeOutput);
      else reject(new Error(`Wrangler ${args[0]} failed (${code}): ${safeOutput.slice(-2500)}`));
    });
    child.stdin.end(input);
  });
}

function config(name: string, service: "formatter" | "auditor", auditorUrl?: string) {
  const className = service === "formatter" ? "FormatterState" : "AuditorState";
  return [
    `name = ${JSON.stringify(name)}`,
    `main = ${JSON.stringify(join(ROOT, "proof/real-service", `${service}.ts`))}`,
    'compatibility_date = "2026-10-16"', "workers_dev = true", "preview_urls = false",
    ...(auditorUrl ? ["[vars]", `AUDITOR_URL = ${JSON.stringify(auditorUrl)}`] : []),
    "[[durable_objects.bindings]]", 'name = "PROOF"', `class_name = ${JSON.stringify(className)}`,
    "[[migrations]]", 'tag = "v1"', `new_sqlite_classes = [${JSON.stringify(className)}]`, "",
  ].join("\n");
}

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { "user-agent": USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${url.split("?")[0]}: ${(await response.text()).slice(0, 300)}`);
  return await response.json() as any;
}

export function connectEnvironment(manifestFile: string) {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as RealDeploymentManifest;
  const token = readFileSync(manifest.adminSecretFile, "utf8").trim();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const setVersion = async (version: FormatterVersion) => {
    if (![1, 2, 3].includes(version)) throw new Error("Unsupported formatter version");
    return jsonFetch(`${manifest.formatterUrl}/__admin/version`, { method: "POST", headers, body: JSON.stringify({ version }) });
  };
  const getEvents = async (since: { formatter?: number; auditor?: number } = {}) => {
    const [formatter, auditor] = await Promise.all([
      jsonFetch(`${manifest.formatterUrl}/__admin/events?since=${since.formatter ?? 0}`, { headers }),
      jsonFetch(`${manifest.auditorUrl}/__admin/events?since=${since.auditor ?? 0}`, { headers }),
    ]);
    return { formatter: formatter.events as RealServiceEvent[], auditor: auditor.events as RealServiceEvent[] };
  };
  const snapshotContracts = async () => {
    const version = await jsonFetch(`${manifest.formatterUrl}/__admin/version`, { headers });
    const [catalog, auditor, formatter] = await Promise.all([
      jsonFetch(`${manifest.gatewayUrl}/.well-known/api-catalog`),
      jsonFetch(`${manifest.auditorUrl}/openapi.json`),
      version.version === 3
        ? jsonFetch(`${manifest.formatterUrl}/formatter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
        : jsonFetch(`${manifest.formatterUrl}/formatter`),
    ]);
    return { version: version.version, catalog, auditor, formatter, publicSources: { countries: COUNTRIES, wikipediaContract: WIKI_SPEC } };
  };
  const cleanup = async () => {
    // The only deletion targets are the unique names in this deployment's own
    // manifest. No pre-existing rcx Worker is a valid cleanup target.
    for (const service of ["formatter", "auditor"] as const) {
      const name = manifest.workerNames[service];
      if (!/^rcx-real-(fmt|audit)-[a-z0-9]+-[a-f0-9]{6}$/.test(name)) throw new Error("Refusing cleanup of a non-proof Worker");
      const cfg = join(dirname(manifest.adminSecretFile), `${service}.toml`);
      if (!readFileSync(cfg, "utf8").includes(`name = ${JSON.stringify(name)}`)) throw new Error("Worker config does not match this deployment manifest");
      await wrangler(["delete", "--config", cfg, "--force"]);
    }
    return { deleted: manifest.workerNames, at: new Date().toISOString() };
  };
  return {
    manifest, manifestFile: resolve(manifestFile), gateway: manifest.gatewayUrl, ...manifest,
    control: { setVersion }, setVersion, getEvents, snapshotContracts, cleanup, stop: cleanup,
    preflight: () => preflightEnvironment(manifest),
  };
}

/** Creates two new Workers only. Call explicitly after reviewing the sources. */
export async function deployEnvironment(options: { manifestFile?: string; log?: (message: string) => void } = {}) {
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const workdir = join(ROOT, ".rcx-deploy", `real-${id}`);
  mkdirSync(workdir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const secretFile = join(workdir, "admin.secret");
  writeFileSync(secretFile, `${token}\n`, { mode: 0o600 });
  const workerNames = { formatter: `rcx-real-fmt-${id}`, auditor: `rcx-real-audit-${id}` };
  const auditorConfig = join(workdir, "auditor.toml");
  const formatterConfig = join(workdir, "formatter.toml");
  writeFileSync(auditorConfig, config(workerNames.auditor, "auditor"));
  const deployed: string[] = [];
  const deploy = async (cfg: string, name: string) => {
    options.log?.(`Deploying new disposable Worker ${name}`);
    const output = await wrangler(["deploy", "--config", cfg]);
    deployed.push(cfg);
    const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(output)?.[0];
    if (!url) throw new Error("Wrangler did not return a Workers URL");
    await wrangler(["secret", "put", "ADMIN_TOKEN", "--config", cfg], token);
    return url;
  };
  try {
    const auditorUrl = await deploy(auditorConfig, workerNames.auditor);
    writeFileSync(formatterConfig, config(workerNames.formatter, "formatter", auditorUrl));
    const formatterUrl = await deploy(formatterConfig, workerNames.formatter);
    const manifest: RealDeploymentManifest = {
      gatewayUrl: formatterUrl, formatterUrl, auditorUrl, adminSecretFile: secretFile, workerNames,
      createdAt: new Date().toISOString(), ownership: "Two new disposable owned Cloudflare Workers; countries and Wikipedia are independent public read-only sources.",
    };
    const manifestFile = resolve(options.manifestFile ?? join(workdir, "manifest.json"));
    mkdirSync(dirname(manifestFile), { recursive: true });
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    // Route propagation is infrastructure readiness, not part of task healing.
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await Promise.all([jsonFetch(`${formatterUrl}/health`), jsonFetch(`${auditorUrl}/health`)]);
        await jsonFetch(`${formatterUrl}/__admin/version`, { headers: { authorization: `Bearer ${token}` } });
        ready = true;
        break;
      } catch { await sleep(1000); }
    }
    if (!ready) throw new Error("New Worker routes did not become ready");
    options.log?.(`Deployment ready. Manifest: ${manifestFile}`);
    return connectEnvironment(manifestFile);
  } catch (error) {
    options.log?.("Deployment failed; removing only newly created proof Workers");
    for (const cfg of deployed.reverse()) await wrangler(["delete", "--config", cfg, "--force"]).catch(() => undefined);
    throw error;
  }
}

/** Confirms cloud egress and verifies valid, corrupt and wrong-country cases
 * before spending an AI run. All data is fetched now from public services. */
export async function preflightEnvironment(manifest: RealDeploymentManifest) {
  const countries = await jsonFetch(COUNTRIES, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: 'query { country(code: "PT") { code name capital } }' }) });
  const capital: string = countries.data.country.capital;
  const wikiRequest = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capital)}`;
  const wiki = await jsonFetch(wikiRequest);
  const token = readFileSync(manifest.adminSecretFile, "utf8").trim();
  await jsonFetch(`${manifest.formatterUrl}/__admin/version`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ version: 1 }) });
  const renderURL = new URL("/v1/brief", manifest.formatterUrl);
  renderURL.searchParams.set("place", capital);
  renderURL.searchParams.set("text", wiki.extract);
  const produced = await jsonFetch(renderURL.href);
  const audit = async (country: string, candidate: string) => {
    const url = new URL("/audit", manifest.auditorUrl);
    url.searchParams.set("country", country);
    url.searchParams.set("candidate", candidate);
    return jsonFetch(url.href);
  };
  const [positive, corrupt, wrongCountry] = await Promise.all([
    audit("PT", produced.markdown),
    audit("PT", produced.markdown.replace(wiki.extract, "This invented summary was not retrieved from Wikipedia.")),
    audit("IS", produced.markdown),
  ]);
  const verdict = positive.valid === true && corrupt.valid === false && wrongCountry.valid === false ? "PASS" : "FAIL";
  const report = { verdict, capital, wikiTitle: wiki.title, wikiPageId: wiki.pageid, positive, corrupt, wrongCountry, sourceURLs: { countries: COUNTRIES, wikipediaRequest: wikiRequest }, checkedAt: new Date().toISOString() };
  if (verdict !== "PASS") throw new Error(`Cloud preflight failed: ${JSON.stringify(report)}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestIndex = process.argv.indexOf("--manifest");
  const manifestFile = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : undefined;
  if (process.argv.includes("--deploy")) {
    const environment = await deployEnvironment({ manifestFile, log: console.log });
    console.log(JSON.stringify({ manifestFile: environment.manifestFile, gatewayUrl: environment.gatewayUrl, auditorUrl: environment.auditorUrl }));
  } else if (manifestFile && process.argv.includes("--cleanup")) {
    console.log(JSON.stringify(await connectEnvironment(manifestFile).cleanup()));
  } else if (manifestFile && process.argv.includes("--preflight")) {
    console.log(JSON.stringify(await connectEnvironment(manifestFile).preflight(), null, 2));
  } else {
    console.log("Usage: node proof/real-environment.ts --deploy [--manifest path] | --preflight --manifest path | --cleanup --manifest path");
  }
}
