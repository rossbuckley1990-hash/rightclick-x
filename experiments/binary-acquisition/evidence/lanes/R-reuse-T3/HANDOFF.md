# Image conversion via RightClick X (./rcx). State is already learned; do not re-learn.
Providers cli:ppm2tiff, cli:cwebp, cli:dwebp. Types: ppm=bytes:image/x-portable-pixmap, pgm=bytes:image/x-portable-graymap, bytes:image/png, bytes:image/tiff, bytes:image/webp.
Default way to convert: `./rcx call context_compose '{"have":{"image":{"type":"bytes:image/<from>","value":{"type":"bytes","base64":"<b64>"}}},"want":"bytes:image/<to>","run":true}'`
Result is `executed.output.ref`. Read the bytes with `context_run_status {"artefact":"<ref>"}` (base64, at most 8 MiB per read; use offset/length for more).
Composable one-step conversions (tested on real input, output format-validated): ppm->tiff, pgm->tiff (pixel-exact); png->webp, tiff->webp, pgm->webp; webp->png.
Composed routes, tested: ppm->png (tiff->webp->png), pgm->png (webp->png). Not run, but in the graph: ppm->webp, tiff->png.
LOSSY: every route through WebP is lossy (cwebp's default encoder, lossless:false, no option to change it). Only ppm/pgm->tiff keep the pixels.
Refused, and correctly: png->tiff. cli:cwebp:png-to-pgm and tiff-to-pgm are a YUV debug dump (`-d`), not a grayscale conversion. Composition never uses them.
context_actions still lists png->tiff as "reachable"; that is wrong. context_compose is what decides.
Direct-only fallback, webp->ppm (worked once; RCX did not validate the output itself): context_run cli:dwebp:invoke with
  {"files":{"in.webp":<bytes or artefact>},"operands":["in.webp"],"options":["-ppm","-o","out.ppm"],"outputs":["out.ppm"]}
  The ref is at output.outputs["out.ppm"].ref. Passing it to cli:ppm2tiff:ppm-to-tiff gave webp->tiff, and that step validated the PPM.
  Do not use dwebp -pgm (it writes YUV layout). RCX refuses -bmp and -tiff.
Not available: JPEG, BMP and GIF in any direction; a faithful conversion to pgm; ppm from anything except via dwebp invoke.
png/tiff->ppm or ->tiff would need png/tiff->webp (lossy), then dwebp invoke, then ppm2tiff. All of it is manual and lossy.
Saved pipelines: composite:0b15d286928e (ppm->tiff->webp->png), composite:d192b9a17331 (pgm->webp->png).
