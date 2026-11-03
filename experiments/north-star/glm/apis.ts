// Two fictional, genuinely unfamiliar HTTP APIs for the development evaluation. The
// competitive thesis requires software the model has no prior knowledge of: famous
// public APIs would let the agent skip discovery entirely. Both are real HTTP servers
// (node:http) with OpenAPI 3 contracts, deterministic data, and different idioms:
// PortLog is a plain REST surface; KilnWatch uses cursor-style lists, nested objects
// and query filters. A compatible change is staged per API (a moved path / a renamed
// parameter, with the contract updated) for the change phase.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const json = (body: unknown, status = 200) => JSON.stringify(body);

// ---------------------------------------------------------------- PortLog data
const PORTLOG_BERTHS = [
  { id: "BR-01", quay: "north", depth_m: 12.5, status: "open" },
  { id: "BR-02", quay: "north", depth_m: 9.0, status: "maintenance" },
  { id: "BR-03", quay: "south", depth_m: 15.2, status: "open" },
  { id: "BR-04", quay: "south", depth_m: 8.1, status: "reserved" },
];
const PORTLOG_VESSELS = [
  { imo: "9321483", name: "MV Alicante", flag: "PT", length_m: 180, draft_m: 9.4, class: "container" },
  { imo: "9455628", name: "TB Meridian", flag: "NL", length_m: 96, draft_m: 5.1, class: "tanker" },
  { imo: "9715210", name: "SS Kiruna", flag: "SE", length_m: 142, draft_m: 7.8, class: "bulk" },
];
const PORTLOG_SCHEDULE: Record<string, { vessel: string; eta: string; etd: string }[]> = {
  "BR-01": [{ vessel: "9321483", eta: "07:40", etd: "19:10" }],
  "BR-02": [],
  "BR-03": [{ vessel: "9715210", eta: "13:05", etd: "22:30" }, { vessel: "9455628", eta: "23:50", etd: "04:15" }],
  "BR-04": [],
};
const PORTLOG_TIDES: Record<string, { time: string; height_m: number }[]> = {
  monday: [{ time: "02:41", height_m: 3.1 }, { time: "08:53", height_m: 4.6 }, { time: "15:07", height_m: 2.8 }, { time: "21:19", height_m: 4.9 }],
  tuesday: [{ time: "03:29", height_m: 3.4 }, { time: "09:44", height_m: 4.8 }, { time: "15:58", height_m: 2.5 }, { time: "22:08", height_m: 5.1 }],
};

const portlogPaths = (berthsPath: string) => ({
  [`${berthsPath}`]: { get: { operationId: "listBerths", summary: "All berths with quay, depth and current status.", responses: { "200": { description: "ok" } } } },
  "/v1/vessels/{imo}": { get: { operationId: "getVessel", summary: "One vessel by IMO number.", parameters: [{ name: "imo", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown vessel" } } } },
  "/v1/schedule": { get: { operationId: "berthSchedule", summary: "Arrivals and departures for one berth.", parameters: [{ name: "berth", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
  "/v1/tides": { get: { operationId: "tideTable", summary: "Tide times and heights for a weekday.", parameters: [{ name: "day", in: "query", required: true, schema: { type: "string", enum: ["monday", "tuesday"] } }], responses: { "200": { description: "ok" } } } },
});

// ---------------------------------------------------------------- KilnWatch data
const KILN_BATCHES = [
  { id: "KB-1042", clay: "porcelain", stage: "glazed", weight_g: 820, firings: 3, glaze: { name: "celadon", temp_c: 1250 } },
  { id: "KB-1043", clay: "stoneware", stage: "glazed", weight_g: 1120, firings: 2, glaze: { name: "tenmoku", temp_c: 1220 } },
  { id: "KB-1051", clay: "porcelain", stage: "bisque", weight_g: 640, firings: 1, glaze: null },
  { id: "KB-1052", clay: "earthenware", stage: "glazed", weight_g: 990, firings: 4, glaze: { name: "tin-white", temp_c: 1180 } },
];
const KILN_KILNS = [
  { id: "K-1", max_temp_c: 1300, status: "idle" },
  { id: "K-2", max_temp_c: 1240, status: "firing" },
  { id: "K-3", max_temp_c: 1290, status: "idle" },
];
const KILN_GLAZES = [
  { name: "celadon", temp_c: 1250 },
  { name: "tenmoku", temp_c: 1220 },
  { name: "tin-white", temp_c: 1180 },
  { name: "shino", temp_c: 1210 },
];

const kilnPaths = (listPath: string) => ({
  [`${listPath}`]: { get: { operationId: "listBatches", summary: "Batches, optionally filtered by stage.", parameters: [{ name: "stage", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "paged list" } } } },
  "/api/batches/{id}": { get: { operationId: "getBatch", summary: "One batch by id.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown batch" } } } },
  "/api/kilns": { get: { operationId: "listKilns", summary: "Kilns with maximum temperature and current status.", responses: { "200": { description: "ok" } } } },
  "/api/glazes": { get: { operationId: "listGlazes", summary: "Glaze recipes; below_temp keeps only those firing below the given Celsius temperature.", parameters: [{ name: "below_temp", in: "query", required: false, schema: { type: "number" } }], responses: { "200": { description: "ok" } } } },
});

export interface FictionalApi {
  name: string;
  base: string;
  contractUrl: string;
  docs: string;
  server: Server;
  port: number;
  applyCompatibleChange(): void;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

export async function startPortLog(): Promise<FictionalApi> {
  let berthsPath = "/v1/berths";
  const spec = () => ({ openapi: "3.0.0", info: { title: "PortLog", version: "1.0", description: "Berth scheduling for the fictional harbour of Vessby." }, servers: [{ url: `http://127.0.0.1:${port}` }], paths: portlogPaths(berthsPath) });
  let port = 0;
  let base = "";
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const send = (body: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(json(body)); };
    if (url.pathname === "/openapi.json") return send(spec());
    if (url.pathname === "/") {
      const specNow = spec();
      return send({ name: "PortLog", description: specNow.info.description, contract: `${base}/openapi.json`,
        endpoints: Object.entries(specNow.paths).flatMap(([path, def]) => Object.entries(def as any).map(([method, op]) => ({ path, method, summary: (op as any).summary }))) });
    }
    if (url.pathname === berthsPath) return send(PORTLOG_BERTHS);
    const vessel = /^\/v1\/vessels\/(\d+)$/.exec(url.pathname);
    if (vessel) {
      const v = PORTLOG_VESSELS.find((x) => x.imo === vessel[1]);
      return v ? send(v) : send({ error: "unknown vessel" }, 404);
    }
    if (url.pathname === "/v1/schedule") {
      const berth = url.searchParams.get("berth") ?? "";
      return Object.hasOwn(PORTLOG_SCHEDULE, berth) ? send(PORTLOG_SCHEDULE[berth]) : send({ error: "unknown berth" }, 404);
    }
    if (url.pathname === "/v1/tides") {
      const day = url.searchParams.get("day") ?? "";
      return Object.hasOwn(PORTLOG_TIDES, day) ? send(PORTLOG_TIDES[day]) : send({ error: "unknown day" }, 404);
    }
    return send({ error: "not found" }, 404);
  });
  port = await listen(server);
  base = `http://127.0.0.1:${port}`;
  return {
    name: "portlog",
    base,
    contractUrl: `${base}/openapi.json`,
    docs: JSON.stringify(spec()),
    server,
    port,
    applyCompatibleChange: () => (berthsPath = "/v1/docking/berths"),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export async function startKilnWatch(): Promise<FictionalApi> {
  let listPath = "/api/batches";
  const spec = () => ({ openapi: "3.0.0", info: { title: "KilnWatch", version: "2.0", description: "Batch and kiln registry for the Overfield ceramics studio." }, servers: [{ url: `http://127.0.0.1:${port}` }], paths: kilnPaths(listPath) });
  let port = 0;
  let base = "";
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const send = (body: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(json(body)); };
    if (url.pathname === "/api/openapi.json") return send(spec());
    if (url.pathname === "/" || url.pathname === "/api") {
      const specNow = spec();
      return send({ name: "KilnWatch", description: specNow.info.description, contract: `${base}/api/openapi.json`,
        endpoints: Object.entries(specNow.paths).flatMap(([path, def]) => Object.entries(def as any).map(([method, op]) => ({ path, method, summary: (op as any).summary }))) });
    }
    if (url.pathname === listPath) {
      const stage = url.searchParams.get("stage");
      const items = stage ? KILN_BATCHES.filter((b) => b.stage === stage) : KILN_BATCHES;
      return send({ items, next: null });
    }
    const batch = /^\/api\/batches\/([\w-]+)$/.exec(url.pathname);
    if (batch) {
      const b = KILN_BATCHES.find((x) => x.id === batch[1]);
      return b ? send(b) : send({ error: "unknown batch" }, 404);
    }
    if (url.pathname === "/api/kilns") return send(KILN_KILNS);
    if (url.pathname === "/api/glazes") {
      const below = Number(url.searchParams.get("below_temp") ?? NaN);
      return send(Number.isFinite(below) ? KILN_GLAZES.filter((g) => g.temp_c < below) : KILN_GLAZES);
    }
    return send({ error: "not found" }, 404);
  });
  port = await listen(server);
  base = `http://127.0.0.1:${port}`;
  return {
    name: "kilnwatch",
    base,
    contractUrl: `${base}/api/openapi.json`,
    docs: JSON.stringify(spec()),
    server,
    port,
    // A compatible change: the batch list moves to /api/lots; behaviour is unchanged and
    // the contract is updated. A renamed parameter would silently widen unfiltered
    // results, which no honest oracle should reward.
    applyCompatibleChange: () => (listPath = "/api/lots"),
    close: () => new Promise((r) => server.close(() => r())),
  };
}
