#!/usr/bin/env python3
"""Independent image inspection.

Detects an image's format and dimensions and checks structural
well-formedness by parsing the file's own bytes -- WITHOUT invoking any
external conversion program. This is what lets the toolkit refuse to trust
a converter's exit code: the output is judged only by what is actually in
the file.

Supported formats: png, jpeg, tiff, webp, bmp, ppm, pgm, pbm, pam.
Pure Python standard library only (struct, zlib).

CLI:  python3 imgfmt.py FILE [FILE...]
      prints  "<fmt> <width>x<height>  <path>"  per file, or an error line,
      and exits non-zero if any file is not a well-formed supported image.
"""
import os
import struct
import sys
import zlib
from collections import namedtuple

Probe = namedtuple("Probe", "fmt width height detail")

MAX_BYTES = 512 * 1024 * 1024  # refuse pathologically large "images"
_WS = b" \t\r\n\x0b\x0c"


class BadImage(ValueError):
    """Raised when a file is not a well-formed image of a supported format."""


def _load(path):
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        raise BadImage("file too large to validate (%d bytes)" % size)
    with open(path, "rb") as f:
        return f.read()


# --------------------------------------------------------------------------
# PNM (PBM/PGM/PPM, P1-P6) and PAM (P7)
# --------------------------------------------------------------------------
def _pnm_next_token(data, i):
    """Return (token_bytes, index_after_token), skipping whitespace/comments."""
    n = len(data)
    while i < n:
        c = data[i : i + 1]
        if c in _WS:
            i += 1
            continue
        if c == b"#":
            while i < n and data[i : i + 1] != b"\n":
                i += 1
            continue
        break
    if i >= n:
        raise BadImage("truncated PNM header")
    j = i
    while j < n and data[j : j + 1] not in _WS and data[j : j + 1] != b"#":
        j += 1
    return data[i:j], j


def _parse_pnm(data):
    magic = data[:2]
    kind = {
        b"P1": "pbm", b"P4": "pbm",
        b"P2": "pgm", b"P5": "pgm",
        b"P3": "ppm", b"P6": "ppm",
    }[magic]
    binary = magic in (b"P4", b"P5", b"P6")
    i = 2
    wtok, i = _pnm_next_token(data, i)
    htok, i = _pnm_next_token(data, i)
    try:
        w = int(wtok)
        h = int(htok)
    except ValueError:
        raise BadImage("non-integer PNM dimensions")
    maxval = None
    if magic not in (b"P1", b"P4"):
        mtok, i = _pnm_next_token(data, i)
        try:
            maxval = int(mtok)
        except ValueError:
            raise BadImage("non-integer PNM maxval")
        if not (0 < maxval <= 65535):
            raise BadImage("PNM maxval out of range: %d" % maxval)
    if w <= 0 or h <= 0:
        raise BadImage("non-positive PNM dimensions %dx%d" % (w, h))
    if binary:
        # exactly one whitespace byte separates header and raster
        if i >= len(data) or data[i : i + 1] not in _WS:
            raise BadImage("missing whitespace before PNM raster")
        raster = i + 1
        bps = 2 if (maxval and maxval > 255) else 1
        if magic == b"P4":
            expect = ((w + 7) // 8) * h
        elif magic == b"P5":
            expect = w * h * bps
        else:  # P6
            expect = w * h * 3 * bps
        if len(data) - raster < expect:
            raise BadImage(
                "truncated PNM raster: have %d bytes, need %d"
                % (len(data) - raster, expect)
            )
    else:
        # ASCII variants: require at least one sample token present
        try:
            _pnm_next_token(data, i)
        except BadImage:
            raise BadImage("PNM header without raster data")
    return Probe(kind, w, h, "P%s %s" % (magic[1:].decode(), "raw" if binary else "ascii"))


def _parse_pam(data):
    end = data.find(b"ENDHDR\n")
    if end < 0:
        raise BadImage("PAM header has no ENDHDR")
    header = data[:end].split(b"\n")
    fields = {}
    for line in header[1:]:
        line = line.strip()
        if not line or line.startswith(b"#"):
            continue
        parts = line.split(None, 1)
        if len(parts) == 2:
            fields[parts[0].upper()] = parts[1]
    try:
        w = int(fields[b"WIDTH"])
        h = int(fields[b"HEIGHT"])
        depth = int(fields[b"DEPTH"])
        maxval = int(fields[b"MAXVAL"])
    except (KeyError, ValueError):
        raise BadImage("PAM header missing WIDTH/HEIGHT/DEPTH/MAXVAL")
    if w <= 0 or h <= 0 or depth <= 0 or not (0 < maxval <= 65535):
        raise BadImage("PAM header values out of range")
    raster = end + len(b"ENDHDR\n")
    bps = 2 if maxval > 255 else 1
    expect = w * h * depth * bps
    if len(data) - raster < expect:
        raise BadImage(
            "truncated PAM raster: have %d bytes, need %d" % (len(data) - raster, expect)
        )
    return Probe("pam", w, h, "P7 depth=%d" % depth)


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _parse_png(data):
    if data[:8] != PNG_MAGIC:
        raise BadImage("bad PNG signature")
    off = 8
    w = h = None
    seen_ihdr = seen_iend = False
    n = len(data)
    while off + 12 <= n:
        (length,) = struct.unpack(">I", data[off : off + 4])
        ctype = data[off + 4 : off + 8]
        if off + 12 + length > n:
            raise BadImage("truncated PNG chunk %r" % ctype)
        body = data[off + 8 : off + 8 + length]
        if len(body) != length:
            raise BadImage("truncated PNG chunk %r" % ctype)
        (crc_stored,) = struct.unpack(">I", data[off + 8 + length : off + 12 + length])
        if (zlib.crc32(ctype + body) & 0xFFFFFFFF) != crc_stored:
            raise BadImage("bad PNG CRC in chunk %r" % ctype)
        if ctype == b"IHDR":
            if length < 8:
                raise BadImage("short IHDR")
            w, h = struct.unpack(">II", body[:8])
            seen_ihdr = True
        elif ctype == b"IEND":
            seen_iend = True
            off += 12 + length
            break
        off += 12 + length
    if not seen_ihdr:
        raise BadImage("PNG without IHDR")
    if not seen_iend:
        raise BadImage("PNG without IEND")
    if not w or not h:
        raise BadImage("PNG with non-positive dimensions")
    return Probe("png", w, h, "png")


# --------------------------------------------------------------------------
# JPEG
# --------------------------------------------------------------------------
_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def _parse_jpeg(data):
    if data[:2] != b"\xff\xd8":
        raise BadImage("bad JPEG SOI")
    i = 2
    n = len(data)
    while i + 1 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        while i < n and data[i] == 0xFF:
            i += 1
        if i >= n:
            break
        marker = data[i]
        i += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            continue
        if i + 2 > n:
            break
        (seglen,) = struct.unpack(">H", data[i : i + 2])
        if seglen < 2:
            raise BadImage("bad JPEG segment length")
        if marker in _SOF:
            if i + 7 > n:
                raise BadImage("truncated JPEG SOF")
            h, w = struct.unpack(">HH", data[i + 3 : i + 7])
            if w <= 0 or h <= 0:
                raise BadImage("JPEG with non-positive dimensions")
            return Probe("jpeg", w, h, "jpeg")
        if marker == 0xDA:  # start of scan, stop scanning headers
            break
        i += seglen
    raise BadImage("JPEG without a frame header (SOF)")


# --------------------------------------------------------------------------
# TIFF
# --------------------------------------------------------------------------
def _parse_tiff(data):
    magic = data[:4]
    if magic == b"II*\x00":
        bo = "<"
    elif magic == b"MM\x00*":
        bo = ">"
    else:
        raise BadImage("bad TIFF magic")
    n = len(data)
    (ifd_off,) = struct.unpack(bo + "I", data[4:8])
    if ifd_off + 2 > n:
        raise BadImage("TIFF IFD offset out of range")
    (count,) = struct.unpack(bo + "H", data[ifd_off : ifd_off + 2])
    base = ifd_off + 2
    if base + count * 12 > n:
        raise BadImage("TIFF IFD out of range")
    w = h = None
    for k in range(count):
        e = base + 12 * k
        tag, typ = struct.unpack(bo + "HH", data[e : e + 4])
        if tag in (256, 257):
            if typ == 3:
                (val,) = struct.unpack(bo + "H", data[e + 8 : e + 10])
            elif typ == 4:
                (val,) = struct.unpack(bo + "I", data[e + 8 : e + 12])
            else:
                continue
            if tag == 256:
                w = val
            else:
                h = val
    if not w or not h:
        raise BadImage("TIFF without ImageWidth/ImageLength")
    return Probe("tiff", w, h, "tiff %s-endian" % ("little" if bo == "<" else "big"))


# --------------------------------------------------------------------------
# WebP (RIFF: VP8 lossy / VP8L lossless / VP8X extended)
# --------------------------------------------------------------------------
def _parse_webp(data):
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise BadImage("bad WebP RIFF header")
    (riff_size,) = struct.unpack("<I", data[4:8])
    if len(data) < riff_size + 8:
        raise BadImage("WebP truncated (RIFF size says %d)" % riff_size)
    fourcc = data[12:16]
    (chunk_size,) = struct.unpack("<I", data[16:20])
    body = data[20:]
    if len(body) < chunk_size:
        raise BadImage("WebP chunk truncated")
    if fourcc == b"VP8 ":
        if len(body) < 10 or body[3:6] != b"\x9d\x01\x2a":
            raise BadImage("bad VP8 lossy frame")
        w = (body[6] | (body[7] << 8)) & 0x3FFF
        h = (body[8] | (body[9] << 8)) & 0x3FFF
        detail = "VP8 lossy"
    elif fourcc == b"VP8L":
        if len(body) < 5 or body[0] != 0x2F:
            raise BadImage("bad VP8L lossless signature")
        bits = body[1] | (body[2] << 8) | (body[3] << 16) | (body[4] << 24)
        w = (bits & 0x3FFF) + 1
        h = ((bits >> 14) & 0x3FFF) + 1
        detail = "VP8L lossless"
    elif fourcc == b"VP8X":
        if len(body) < 10:
            raise BadImage("bad VP8X header")
        w = 1 + (body[4] | (body[5] << 8) | (body[6] << 16))
        h = 1 + (body[7] | (body[8] << 8) | (body[9] << 16))
        detail = "VP8X extended"
    else:
        raise BadImage("unknown WebP chunk %r" % fourcc)
    if w <= 0 or h <= 0:
        raise BadImage("WebP with non-positive dimensions")
    return Probe("webp", w, h, detail)


# --------------------------------------------------------------------------
# BMP
# --------------------------------------------------------------------------
def _parse_bmp(data):
    if data[:2] != b"BM":
        raise BadImage("bad BMP magic")
    if len(data) < 26:
        raise BadImage("BMP too short")
    (hdrsize,) = struct.unpack("<I", data[14:18])
    if hdrsize == 12:
        w, h = struct.unpack("<HH", data[18:22])
        h = abs(h)
    else:
        w, h = struct.unpack("<ii", data[18:26])
        w, h = abs(w), abs(h)
    if w <= 0 or h <= 0:
        raise BadImage("BMP with non-positive dimensions")
    return Probe("bmp", w, h, "bmp")


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------
def _dispatch(data):
    if data[:8] == PNG_MAGIC:
        return _parse_png(data)
    if data[:2] == b"\xff\xd8":
        return _parse_jpeg(data)
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return _parse_tiff(data)
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return _parse_webp(data)
    if data[:2] == b"BM":
        return _parse_bmp(data)
    if data[:2] == b"P7":
        return _parse_pam(data)
    if data[:2] in (b"P1", b"P2", b"P3", b"P4", b"P5", b"P6"):
        return _parse_pnm(data)
    raise BadImage("unrecognised image format (magic %r)" % data[:8])


def probe_bytes(data):
    # Any short-buffer / indexing failure on malformed input becomes a clean
    # BadImage, never an uncaught exception.
    try:
        return _dispatch(data)
    except BadImage:
        raise
    except (struct.error, IndexError, KeyError, ValueError) as e:
        raise BadImage("malformed image: %s" % e)


def probe(path):
    """Return a Probe(fmt, width, height, detail) or raise BadImage."""
    if not os.path.isfile(path):
        raise BadImage("not a regular file: %s" % path)
    if os.path.getsize(path) == 0:
        raise BadImage("empty file: %s" % path)
    return probe_bytes(_load(path))


def main(argv):
    if len(argv) < 2:
        sys.stderr.write("usage: imgfmt.py FILE [FILE...]\n")
        return 2
    rc = 0
    for path in argv[1:]:
        try:
            p = probe(path)
            print("%s %dx%d  %s  (%s)" % (p.fmt, p.width, p.height, path, p.detail))
        except BadImage as e:
            print("INVALID  %s  (%s)" % (path, e))
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
