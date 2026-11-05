#!/usr/bin/env python3
"""Self-test for the image conversion toolkit.

Builds its own fixtures (independently of the three converter programs where
possible), then exercises the toolkit end to end: the full conversion matrix,
every refusal path, and the SHA-256 identity mechanism. Exits non-zero if any
check fails. Safe to re-run; all temporary files live under a dir it deletes.
"""
import os
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LANE = os.path.dirname(HERE)
CONVERT = os.path.join(HERE, "convert")  # the shipped wrapper (also tested)
sys.path.insert(0, HERE)
import imgfmt  # noqa: E402
import convert as conv  # noqa: E402

W, H = 20, 12
PASS = 0
FAIL = 0


def check(name, ok, extra=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print("  pass  %s" % name)
    else:
        FAIL += 1
        print("  FAIL  %s  %s" % (name, extra))


def run(args, cwd=LANE):
    p = subprocess.run([CONVERT] + args, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


# ---- fixture builders (no converter program involved) --------------------
def build_ppm(path):
    body = bytearray()
    for y in range(H):
        for x in range(W):
            body += bytes([(x * 11) % 256, (y * 17) % 256, (x * y) % 256])
    open(path, "wb").write(b"P6\n%d %d\n255\n" % (W, H) + bytes(body))


def build_pgm(path):
    body = bytes([(x * y) % 256 for y in range(H) for x in range(W)])
    open(path, "wb").write(b"P5\n%d %d\n255\n" % (W, H) + body)


def build_pbm(path):
    rowbytes = (W + 7) // 8
    body = bytes([0b10101010] * rowbytes * H)
    open(path, "wb").write(b"P4\n%d %d\n" % (W, H) + body)


def build_pam(path):
    hdr = b"P7\nWIDTH %d\nHEIGHT %d\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n" % (W, H)
    body = bytes([(x + y) % 256 for y in range(H) for x in range(W) for _ in range(3)])
    open(path, "wb").write(hdr + body)


def _png_chunk(ctype, data):
    return (struct.pack(">I", len(data)) + ctype + data
            + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF))


def build_png(path):
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter: none
        for x in range(W):
            raw += bytes([(x * 7) % 256, (y * 9) % 256, (x + y) % 256])
    idat = zlib.compress(bytes(raw), 9)
    out = (b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr)
           + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b""))
    open(path, "wb").write(out)


def build_bmp(path):
    w, h = 2, 2
    pixels = bytes([0, 0, 255] * w * h)  # not padded; good enough for header probe
    dib = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(pixels), 2835, 2835, 0, 0)
    filehdr = b"BM" + struct.pack("<IHHI", 14 + len(dib) + len(pixels), 0, 0, 14 + len(dib))
    open(path, "wb").write(filehdr + dib + pixels)


PRODUCIBLE = ("webp", "png", "ppm", "pam", "bmp", "tiff")
EXT = {"webp": ".webp", "png": ".png", "ppm": ".ppm", "pam": ".pam",
       "bmp": ".bmp", "tiff": ".tif"}


def main():
    work = tempfile.mkdtemp(prefix="selftest.", dir=LANE)
    rel = lambda p: os.path.relpath(p, LANE)
    try:
        print("== pins ==")
        rc, out, err = run(["--check"])
        check("convert --check (pins valid)", rc == 0, err.strip())

        print("== --list / --probe smoke ==")
        rc, out, err = run(["--list"])
        check("convert --list", rc == 0 and "->" in out)

        print("== build fixtures ==")
        fx = {}
        build_ppm(os.path.join(work, "f.ppm")); fx["ppm"] = os.path.join(work, "f.ppm")
        build_pgm(os.path.join(work, "f.pgm")); fx["pgm"] = os.path.join(work, "f.pgm")
        build_pbm(os.path.join(work, "f.pbm")); fx["pbm"] = os.path.join(work, "f.pbm")
        build_pam(os.path.join(work, "f.pam")); fx["pam"] = os.path.join(work, "f.pam")
        build_png(os.path.join(work, "f.png")); fx["png"] = os.path.join(work, "f.png")
        for k, p in fx.items():
            try:
                pr = imgfmt.probe(p)
                check("fixture %s is %s %dx%d" % (k, pr.fmt, pr.width, pr.height),
                      pr.fmt == k and (pr.width, pr.height) == (W, H))
            except imgfmt.BadImage as e:
                check("fixture %s valid" % k, False, str(e))
        # Derive tiff + webp fixtures through the toolkit (exercises ppm->tiff, ppm->webp)
        rc, _, err = run([rel(fx["ppm"]), rel(os.path.join(work, "f.tif"))])
        check("derive f.tif (ppm->tiff)", rc == 0, err.strip())
        fx["tiff"] = os.path.join(work, "f.tif")
        rc, _, err = run([rel(fx["ppm"]), rel(os.path.join(work, "f.webp"))])
        check("derive f.webp (ppm->webp)", rc == 0, err.strip())
        fx["webp"] = os.path.join(work, "f.webp")

        print("== conversion matrix (dimensions must stay %dx%d) ==" % (W, H))
        for src_fmt in ("ppm", "pgm", "pbm", "pam", "png", "tiff", "webp"):
            for tgt in PRODUCIBLE:
                outp = os.path.join(work, "%s_to_%s%s" % (src_fmt, tgt, EXT[tgt]))
                rc, _, err = run([rel(fx[src_fmt]), rel(outp), "--to", tgt, "--force", "--quiet"])
                ok = rc == 0 and os.path.isfile(outp)
                dimok = False
                if ok:
                    try:
                        pr = imgfmt.probe(outp)
                        dimok = pr.fmt == tgt and (pr.width, pr.height) == (W, H)
                    except imgfmt.BadImage:
                        dimok = False
                check("%-4s -> %-4s" % (src_fmt, tgt), ok and dimok,
                      err.strip()[:160] if not (ok and dimok) else "")

        print("== refusals (must write nothing, exit non-zero) ==")
        # unsupported target format
        outp = os.path.join(work, "no.jpg")
        rc, _, err = run([rel(fx["ppm"]), rel(outp), "--to", "jpeg"])
        check("refuse unsupported target jpeg", rc != 0 and not os.path.exists(outp))
        # unsupported input format (bmp is never a source)
        build_bmp(os.path.join(work, "in.bmp"))
        outp = os.path.join(work, "frombmp.png")
        rc, _, err = run([rel(os.path.join(work, "in.bmp")), rel(outp)])
        check("refuse unsupported input bmp", rc != 0 and not os.path.exists(outp))
        # non-image input
        open(os.path.join(work, "notimg.txt"), "w").write("hello, not an image\n")
        outp = os.path.join(work, "fromtxt.png")
        rc, _, err = run([rel(os.path.join(work, "notimg.txt")), rel(outp)])
        check("refuse non-image input", rc != 0 and not os.path.exists(outp))
        # refuse to clobber without --force, allow with --force
        outp = os.path.join(work, "clobber.png")
        run([rel(fx["ppm"]), rel(outp), "--quiet"])
        before = open(outp, "rb").read()
        rc, _, err = run([rel(fx["pgm"]), rel(outp), "--quiet"])  # no --force
        unchanged = open(outp, "rb").read() == before
        check("refuse overwrite without --force", rc != 0 and unchanged)
        rc, _, err = run([rel(fx["pgm"]), rel(outp), "--force", "--quiet"])
        check("allow overwrite with --force", rc == 0)

        print("== SHA-256 identity mechanism ==")
        # a binary whose bytes match its pin verifies; a changed byte is refused
        fake = os.path.join(work, "fakebin")
        open(fake, "wb").write(b"\x7fELF fake program v1")
        good = conv._sha256(fake)
        pins_ok = {"demo": {"invoke": fake, "sha256": good}}
        try:
            conv.verify_program("demo", pins_ok)
            check("verify_program accepts matching hash", True)
        except conv.ConvertError as e:
            check("verify_program accepts matching hash", False, str(e))
        open(fake, "ab").write(b"TAMPERED")  # change the bytes
        try:
            conv.verify_program("demo", pins_ok)
            check("verify_program refuses changed binary", False, "did not raise")
        except conv.ConvertError:
            check("verify_program refuses changed binary", True)

        print("== validator rejects malformed bytes ==")
        bad_cases = {
            "garbage": b"not an image at all",
            "truncated-png": open(fx["png"], "rb").read()[:30],
            "truncated-ppm": b"P6\n%d %d\n255\nABC" % (W, H),
            "png-bad-crc": (lambda d: d[:40] + bytes([d[40] ^ 0xFF]) + d[41:])(
                open(fx["png"], "rb").read()),
        }
        for name, data in bad_cases.items():
            try:
                imgfmt.probe_bytes(data)
                check("reject %s" % name, False, "accepted bad bytes")
            except imgfmt.BadImage:
                check("reject %s" % name, True)

        print("\n== summary: %d passed, %d failed ==" % (PASS, FAIL))
        return 0 if FAIL == 0 else 1
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
