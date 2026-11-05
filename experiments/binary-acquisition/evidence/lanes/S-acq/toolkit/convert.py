#!/usr/bin/env python3
"""Durable, self-defending image format converter.

Converts an image from one format to another using only three installed
programs -- ppm2tiff, cwebp, dwebp -- each run through ./confine (no network,
writes confined to the current directory). The converter chains them when a
single program cannot do the job, and it trusts NOTHING the programs report:

  * program identity is pinned (SHA-256) and re-checked before every run;
  * every intermediate and the final output is re-parsed by imgfmt.py
    (independent of the converters) and must be a well-formed file of the
    expected format with the SAME dimensions as the input;
  * exit codes are advisory only -- validation is authoritative;
  * on ANY failure the tool writes no output file and exits non-zero.

Usage:
    toolkit/convert INPUT OUTPUT [--to FMT] [--force] [--quiet]
    toolkit/convert --probe FILE...
    toolkit/convert --list
    toolkit/convert --check          # verify program pins only

Target format is inferred from OUTPUT's extension unless --to is given.
Producible output formats: webp, png, ppm, pam, bmp, tiff.
Accepted input formats:    ppm, pgm, pbm, pam, png, jpeg, tiff, webp.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import imgfmt  # noqa: E402  (local module, shipped alongside this file)

PINS_PATH = os.path.join(HERE, "pins.json")

# Conversion graph: (src_fmt, dst_fmt, program). Dimensions are preserved by
# every edge (no resize/crop flags are ever passed).
EDGES = (
    [(s, "tiff", "ppm2tiff") for s in ("ppm", "pgm", "pbm")]
    + [(s, "webp", "cwebp") for s in ("png", "jpeg", "tiff", "ppm", "pgm", "pam")]
    + [("webp", d, "dwebp") for d in ("png", "ppm", "pam", "bmp", "tiff")]
)

EXT2FMT = {
    ".ppm": "ppm", ".pgm": "pgm", ".pbm": "pbm", ".pam": "pam",
    ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg",
    ".tif": "tiff", ".tiff": "tiff", ".webp": "webp", ".bmp": "bmp",
}
# Extension to give each intermediate file (content is what matters, but a
# sensible name keeps temp dirs legible).
FMT2EXT = {
    "ppm": ".ppm", "pgm": ".pgm", "pbm": ".pbm", "pam": ".pam",
    "png": ".png", "jpeg": ".jpg", "tiff": ".tif", "webp": ".webp", "bmp": ".bmp",
}


class ConvertError(Exception):
    pass


# --------------------------------------------------------------------------
# program identity pinning
# --------------------------------------------------------------------------
def load_pins():
    with open(PINS_PATH) as f:
        return json.load(f)["programs"]


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def verify_program(name, pins):
    """Return the absolute invoke path, or raise if the binary is not as pinned."""
    if name not in pins:
        raise ConvertError("no pin recorded for program %r" % name)
    pin = pins[name]
    invoke = pin["invoke"]
    if not os.path.exists(invoke):
        raise ConvertError("pinned program missing: %s" % invoke)
    real = os.path.realpath(invoke)
    if not os.path.isfile(real):
        raise ConvertError("program %s does not resolve to a file" % invoke)
    got = _sha256(real)
    if got != pin["sha256"]:
        raise ConvertError(
            "IDENTITY MISMATCH for %s\n  path:     %s\n  expected: %s\n  actual:   %s\n"
            "Refusing to run a program that has changed since it was pinned."
            % (name, real, pin["sha256"], got)
        )
    return invoke


def check_all_pins(pins):
    ok = True
    for name in ("ppm2tiff", "cwebp", "dwebp"):
        try:
            verify_program(name, pins)
            print("OK   %-9s %s" % (name, pins[name]["sha256"][:16] + "..."))
        except ConvertError as e:
            print("FAIL %-9s %s" % (name, str(e).splitlines()[0]))
            ok = False
    return ok


# --------------------------------------------------------------------------
# planning
# --------------------------------------------------------------------------
def plan_path(src, dst):
    """Shortest sequence of (program, out_fmt) edges from src to dst, or None."""
    if src == dst:
        return []
    adj = {}
    for s, d, prog in EDGES:
        adj.setdefault(s, []).append((d, prog))
    q = deque([src])
    prev = {src: None}
    while q:
        cur = q.popleft()
        for nxt, prog in adj.get(cur, []):
            if nxt not in prev:
                prev[nxt] = (cur, prog)
                if nxt == dst:
                    steps = []
                    node = dst
                    while prev[node] is not None:
                        pcur, pprog = prev[node]
                        steps.append((pprog, node))
                        node = pcur
                    steps.reverse()
                    return steps
                q.append(nxt)
    return None


def reachable_targets(src):
    out = set()
    adj = {}
    for s, d, prog in EDGES:
        adj.setdefault(s, []).append(d)
    q = deque([src])
    seen = {src}
    while q:
        cur = q.popleft()
        for nxt in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                out.add(nxt)
                q.append(nxt)
    return out


# --------------------------------------------------------------------------
# running a confined program
# --------------------------------------------------------------------------
def find_confine(explicit):
    if explicit:
        cand = os.path.abspath(explicit)
    else:
        cand = os.path.join(os.path.dirname(HERE), "confine")
    if not (os.path.isfile(cand) and os.access(cand, os.X_OK)):
        raise ConvertError("confine wrapper not found or not executable: %s" % cand)
    return cand


def build_args(program, infile, outfile, out_fmt):
    if program == "ppm2tiff":
        # positional: input output ; default PackBits compression
        return [infile, outfile]
    if program == "cwebp":
        # lossless + exact keeps the encode step faithful to the pixels
        return ["-lossless", "-exact", "-quiet", infile, "-o", outfile]
    if program == "dwebp":
        flag = {"png": None, "ppm": "-ppm", "pam": "-pam", "bmp": "-bmp", "tiff": "-tiff"}[out_fmt]
        args = [infile]
        if flag:
            args.append(flag)
        return args + ["-quiet", "-o", outfile]
    raise ConvertError("unknown program %r" % program)


def run_confined(confine, invoke, args):
    cmd = [confine, invoke] + args
    env = dict(os.environ)
    env["PWD"] = os.getcwd()  # confine confines writes to $PWD
    try:
        p = subprocess.run(cmd, capture_output=True, env=env, timeout=600)
    except subprocess.TimeoutExpired:
        raise ConvertError("program timed out: %s" % invoke)
    return p.returncode, p.stderr.decode("utf-8", "replace")


# --------------------------------------------------------------------------
# the conversion
# --------------------------------------------------------------------------
def convert(input_path, output_path, to_fmt=None, force=False, quiet=False,
            confine_path=None):
    def say(msg):
        if not quiet:
            sys.stderr.write(msg + "\n")

    if not os.path.isfile(input_path):
        raise ConvertError("input not found: %s" % input_path)

    # 1. validate the INPUT independently and learn its true format + dimensions
    try:
        src = imgfmt.probe(input_path)
    except imgfmt.BadImage as e:
        raise ConvertError("input is not a well-formed image: %s" % e)

    # 2. determine target format
    if to_fmt:
        dst_fmt = to_fmt.lower()
    else:
        ext = os.path.splitext(output_path)[1].lower()
        if ext not in EXT2FMT:
            raise ConvertError(
                "cannot infer output format from %r; pass --to FMT" % output_path
            )
        dst_fmt = EXT2FMT[ext]
    if dst_fmt not in FMT2EXT:
        raise ConvertError("unknown target format %r" % dst_fmt)

    say("input : %s  %s %dx%d" % (input_path, src.fmt, src.width, src.height))
    say("target: %s  %s" % (output_path, dst_fmt))

    if os.path.exists(output_path) and not force:
        raise ConvertError("output exists (use --force to overwrite): %s" % output_path)

    # 3. plan a path through the available programs
    steps = plan_path(src.fmt, dst_fmt)
    if steps is None:
        reach = sorted(reachable_targets(src.fmt))
        raise ConvertError(
            "no conversion path from %s to %s (reachable: %s)"
            % (src.fmt, dst_fmt, ", ".join(reach) or "none")
        )

    pins = load_pins()
    confine = find_confine(confine_path)

    # 4. verify EVERY program we will use before touching anything
    for prog, _ in steps:
        verify_program(prog, pins)

    workdir = tempfile.mkdtemp(prefix=".imgconvert-", dir=os.getcwd())
    try:
        if not steps:  # same-format passthrough: validated input, copy through
            say("no conversion needed; validating and copying")
            final = os.path.join(workdir, "out" + FMT2EXT[dst_fmt])
            shutil.copyfile(input_path, final)
        else:
            cur_in = os.path.abspath(input_path)
            final = None
            for n, (prog, out_fmt) in enumerate(steps, 1):
                invoke = verify_program(prog, pins)  # re-check right before use
                out_file = os.path.join(workdir, "step%d%s" % (n, FMT2EXT[out_fmt]))
                args = build_args(prog, cur_in, out_file, out_fmt)
                rc, err = run_confined(confine, invoke, args)
                say("step %d: %s -> %s (rc=%d)" % (n, prog, out_fmt, rc))
                # exit code is advisory; validation below is authoritative
                if not os.path.isfile(out_file):
                    raise ConvertError(
                        "step %d (%s) produced no output. rc=%d stderr=%s"
                        % (n, prog, rc, err.strip()[:300])
                    )
                try:
                    got = imgfmt.probe(out_file)
                except imgfmt.BadImage as e:
                    raise ConvertError(
                        "step %d (%s) output is not well-formed: %s" % (n, prog, e)
                    )
                if got.fmt != out_fmt:
                    raise ConvertError(
                        "step %d (%s) produced %s, expected %s"
                        % (n, prog, got.fmt, out_fmt)
                    )
                if (got.width, got.height) != (src.width, src.height):
                    raise ConvertError(
                        "step %d (%s) dimensions %dx%d != input %dx%d"
                        % (n, prog, got.width, got.height, src.width, src.height)
                    )
                cur_in = out_file
                final = out_file

        # 5. final independent re-validation before publishing the result
        fin = imgfmt.probe(final)
        if fin.fmt != dst_fmt or (fin.width, fin.height) != (src.width, src.height):
            raise ConvertError(
                "final check failed: got %s %dx%d, wanted %s %dx%d"
                % (fin.fmt, fin.width, fin.height, dst_fmt, src.width, src.height)
            )

        # 6. publish atomically, then re-probe the published file in place
        out_dir = os.path.dirname(os.path.abspath(output_path)) or "."
        os.makedirs(out_dir, exist_ok=True)
        tmp_out = os.path.join(out_dir, ".imgconvert-final-%d" % os.getpid())
        shutil.copyfile(final, tmp_out)
        os.replace(tmp_out, output_path)
        done = imgfmt.probe(output_path)
        if done.fmt != dst_fmt or (done.width, done.height) != (src.width, src.height):
            os.remove(output_path)
            raise ConvertError("published output failed re-validation; removed it")
        say("OK: %s %s %dx%d" % (output_path, done.fmt, done.width, done.height))
        return done
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main(argv):
    ap = argparse.ArgumentParser(
        prog="convert", add_help=True,
        description="Confined, validated image format conversion.",
    )
    ap.add_argument("input", nargs="?")
    ap.add_argument("output", nargs="?")
    ap.add_argument("--to", help="target format (overrides output extension)")
    ap.add_argument("--force", action="store_true", help="overwrite existing output")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--confine", help="path to the confine wrapper")
    ap.add_argument("--probe", nargs="+", metavar="FILE",
                    help="independently report format+dimensions of files and exit")
    ap.add_argument("--list", action="store_true",
                    help="print the conversion capability matrix and exit")
    ap.add_argument("--check", action="store_true",
                    help="verify the three program pins and exit")
    args = ap.parse_args(argv[1:])

    if args.probe:
        return imgfmt.main(["imgfmt.py"] + args.probe)

    if args.check:
        return 0 if check_all_pins(load_pins()) else 1

    if args.list:
        inputs = ("ppm", "pgm", "pbm", "pam", "png", "jpeg", "tiff", "webp")
        print("Conversions this toolkit can perform (rows=from, reachable=to):")
        for s in inputs:
            tgts = sorted(reachable_targets(s))
            print("  %-5s -> %s" % (s, ", ".join(tgts) if tgts else "(none)"))
        print("\nProducible output formats: webp, png, ppm, pam, bmp, tiff")
        print("Dimensions are preserved by every conversion.")
        return 0

    if not args.input or not args.output:
        ap.error("INPUT and OUTPUT are required (or use --probe/--list/--check)")

    try:
        convert(args.input, args.output, to_fmt=args.to, force=args.force,
                quiet=args.quiet, confine_path=args.confine)
    except ConvertError as e:
        sys.stderr.write("REFUSED: %s\n" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
