// Known disposable resource only. No credentials or RightClick tools are used.
import { lookup } from "node:dns/promises";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const address = new URL(process.argv[2]);
address.hostname = (await lookup(address.hostname, { family: 4 })).address;
const origin = address.origin;
const results = {};
const request = async (path, method = "POST") => {
  const r = await fetch(origin + path, { method, ...(method === "GET" ? {} : { body: '{"label":"bypass"}' }), signal: AbortSignal.timeout(3000) });
  return { status: r.status, body: await r.text() };
};
results.publicDocument = await request("/openapi.json", "GET");
results.direct = await request("/entries");
results.aliases = {};
for (const path of ["/admin", "/proxy/entries", "/entries/", "/entries?bypass=true", "/legacy/entries"]) results.aliases[path] = await request(path);
results.changedMethod = await request("/entries", "DELETE");
const shell = spawnSync("/bin/sh", ["-c", 'node -e \'fetch(process.argv[1], {method:"POST",body:"{\\"label\\":\\"bypass\\"}",signal:AbortSignal.timeout(3000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(()=>process.exit(23))\' "$1"', "probe", origin + "/entries"], { timeout: 5000, encoding: "utf8" });
results.shell = { exit: shell.status, stdout: shell.stdout, stderr: shell.stderr };
const rawRequest = (headers) => new Promise((resolve, reject) => {
  const body = '{"label":"bypass"}';
  const socket = createConnection({ host: address.hostname, port: Number(address.port) });
  let data = "";
  socket.setTimeout(3000);
  socket.on("connect", () => socket.write(`POST /entries HTTP/1.1\r\nHost: ${address.host}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${headers}\r\n${body}`));
  socket.on("data", chunk => data += chunk);
  socket.on("end", () => resolve(data));
  socket.on("error", reject);
  socket.on("timeout", () => { socket.destroy(); reject(new Error("raw socket timed out")); });
});
results.rawSocket = await rawRequest("");
results.duplicateHeader = await rawRequest("Content-Length: 18\r\n");
results.transferEncoding = await rawRequest("Transfer-Encoding: chunked\r\n");
results.secrets = Object.keys(process.env).filter(k => /TOKEN|SECRET|PASSWORD|ACTENON|API_KEY/.test(k));
results.dockerSocket = existsSync("/var/run/docker.sock");
results.authorityStore = existsSync("/input/authority.db");
console.log(JSON.stringify({ origin, results }));
