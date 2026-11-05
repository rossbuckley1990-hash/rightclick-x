#!/usr/bin/env node
// Independent oracle for the Stage 2 reuse tasks (harness code, not product code).
//
//   node oracle.mjs <sealed-input> <answer> <codec>
//
// Correct means: ffprobe reads the answer as <codec> with the input's width and height, and
// ffmpeg's PSNR between input and answer is at least 15 dB (the same picture; lossy encodings
// pass, a different or damaged picture does not). An identical picture (PSNR "inf") is exact.
//
// Calibration, done after the arms had started but before any arm's answer was examined, on
// reference and corrupted answers made outside both arms: cwebp's default encoding of photo.ppm
// 20.3 dB (correct); a different picture 3.6 dB and a brightness-shifted one 8.1 dB (wrong); a
// resized, truncated, missing or wrong-format file is refused before PSNR. A first threshold of
// 30 dB would have marked the correct lossy reference wrong, and was replaced.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [input, answer, codec] = process.argv.slice(2);
const FF = "/opt/homebrew/bin/ffmpeg", FFPROBE = "/opt/homebrew/bin/ffprobe";
const probe = (p) => {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", p], { encoding: "utf8" });
  try { return JSON.parse(r.stdout).streams?.[0]; } catch { return undefined; }
};
if (!existsSync(answer)) { console.log(JSON.stringify({ correct: false, reason: "no answer file" })); process.exit(0); }
const a = probe(answer), i = probe(input);
const sameSize = !!a && !!i && a.width === i.width && a.height === i.height;
let psnr = null;
if (sameSize) {
  // Compare in the input's own pixel format, so a greyscale input is compared as greyscale.
  const r = spawnSync(FF, ["-v", "info", "-i", input, "-i", answer, "-lavfi", `[1:v]format=${i.pix_fmt}[b];[0:v][b]psnr`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /PSNR .*average:(inf|[\d.]+)/.exec(r.stderr);
  psnr = m ? (m[1] === "inf" ? Infinity : Number(m[1])) : null;
}
const correct = !!a && a.codec_name === codec && sameSize && psnr !== null && psnr >= 15;
console.log(JSON.stringify({ correct, codec: a?.codec_name ?? null, width: a?.width ?? null, height: a?.height ?? null, expected: { codec, width: i?.width, height: i?.height }, psnrDb: psnr === Infinity ? "inf" : psnr, exact: psnr === Infinity }));
