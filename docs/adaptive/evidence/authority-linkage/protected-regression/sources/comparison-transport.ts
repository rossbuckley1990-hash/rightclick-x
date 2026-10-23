// Identical credential-free IPC transport for both deterministic comparison arms.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const pending = new Map<number, (value: any) => void>();
let sequence = 0;
let configure: (value: any) => void;
export const configuration = new Promise<any>(resolve => { configure = resolve; });
export const requests: any[] = [];
lines.on("line", line => {
  const value = JSON.parse(line);
  if (value.config) configure(value.config);
  else { pending.get(value.id)?.(value); pending.delete(value.id); }
});
export async function bridge(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const id = ++sequence;
  const wire = { method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: Buffer.from(await request.arrayBuffer()).toString("base64") };
  requests.push(wire);
  const response = new Promise<any>(resolve => pending.set(id, resolve));
  process.stdout.write(JSON.stringify({ op: "fetch", id, request: wire }) + "\n");
  const reply = await response;
  if (!reply.ok) throw new Error(`independent authority refused: ${reply.reason}`);
  return new Response(Buffer.from(reply.response.body, "base64"), { status: reply.response.status, headers: reply.response.headers });
}
export function report(phase: string, results: any, state: unknown) {
  process.stdout.write(JSON.stringify({ op: "report", phase, results: { ...results, requests, node: process.version }, state }) + "\n");
  lines.close(); process.stdin.destroy();
}
