#!/usr/bin/env python3
"""Generates images/icon.png: a speech bubble containing the letters "AI".

Written against the Python standard library alone. The obvious alternative — Pillow plus a
system font — was not available in this environment, and pulling in an image library just to
draw two letters would make regenerating the icon depend on a working toolchain rather than
on `python3`. Letterforms are therefore defined as polygons and rasterized here.

Anti-aliasing comes from rendering at SUPERSAMPLE times the final size and box-filtering
down. Averaging is done on premultiplied alpha so that the transparent edge of the bubble
does not pick up a dark fringe.

Usage:  python3 scripts/generate-icon.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 128
SUPERSAMPLE = 4
BIG = SIZE * SUPERSAMPLE

# Blue reads as "assistant" without borrowing any product's brand colour, and holds contrast
# against both the light and dark Marketplace backgrounds.
GRADIENT_TOP = (0x3B, 0x82, 0xF6)
GRADIENT_BOTTOM = (0x1D, 0x4E, 0xD8)
TEXT_COLOR = (0xFF, 0xFF, 0xFF)

Point = tuple[float, float]


def _scale(value: float) -> float:
    return value * SUPERSAMPLE


# --- Geometry -------------------------------------------------------------------------

# Bubble body. Kept clear of the canvas edge so the shape is not clipped when the Marketplace
# rounds the tile's corners.
BUBBLE_LEFT, BUBBLE_TOP, BUBBLE_RIGHT, BUBBLE_BOTTOM = 8.0, 12.0, 120.0, 96.0
BUBBLE_RADIUS = 22.0

# Tail, anchored under the left third of the body so the bubble reads as pointing at the
# commit message box below it.
TAIL: tuple[Point, Point, Point] = ((34.0, 88.0), (30.0, 120.0), (68.0, 88.0))


def _letter_a(x0: float, y0: float, width: float, height: float) -> list[list[Point]]:
    """A bold sans-serif "A" as the union of two legs and a crossbar.

    Built from overlapping convex pieces rather than one outline with a hole: the counter
    then falls out of the geometry for free, and every piece stays trivially convex, which
    keeps the point-in-polygon test simple enough to trust without a test suite.
    """
    stroke = width * 0.21
    cx = x0 + width / 2
    x1, y1 = x0 + width, y0 + height
    bar_top = y0 + height * 0.60
    bar_height = height * 0.19

    left_leg = [(cx - stroke * 0.5, y0), (cx + stroke * 0.5, y0), (x0 + stroke, y1), (x0, y1)]
    right_leg = [(cx - stroke * 0.5, y0), (cx + stroke * 0.5, y0), (x1, y1), (x1 - stroke, y1)]
    crossbar = [
        (x0 + width * 0.155, bar_top),
        (x1 - width * 0.155, bar_top),
        (x1 - width * 0.155, bar_top + bar_height),
        (x0 + width * 0.155, bar_top + bar_height),
    ]
    return [left_leg, right_leg, crossbar]


def _letter_i(x0: float, y0: float, width: float, height: float) -> list[list[Point]]:
    """A bold sans-serif "I": a single stem, no serifs."""
    stroke = width
    return [[(x0, y0), (x0 + stroke, y0), (x0 + stroke, y0 + height), (x0, y0 + height)]]


# Text block, optically centred in the body rather than geometrically: the tail pulls the
# eye downwards, so the letters sit slightly above the body's midpoint.
TEXT_TOP = 33.0
TEXT_HEIGHT = 44.0
A_WIDTH = 40.0
I_WIDTH = 11.0
LETTER_GAP = 9.0
_TEXT_WIDTH = A_WIDTH + LETTER_GAP + I_WIDTH
_TEXT_LEFT = (BUBBLE_LEFT + BUBBLE_RIGHT) / 2 - _TEXT_WIDTH / 2

LETTER_POLYGONS: list[list[Point]] = [
    *_letter_a(_TEXT_LEFT, TEXT_TOP, A_WIDTH, TEXT_HEIGHT),
    *_letter_i(_TEXT_LEFT + A_WIDTH + LETTER_GAP, TEXT_TOP, I_WIDTH, TEXT_HEIGHT),
]


# --- Rasterizing ----------------------------------------------------------------------


def _in_polygon(x: float, y: float, polygon: list[Point]) -> bool:
    """Even-odd ray casting."""
    inside = False
    count = len(polygon)
    for i in range(count):
        ax, ay = polygon[i]
        bx, by = polygon[(i + 1) % count]
        if (ay > y) != (by > y):
            t = (y - ay) / (by - ay)
            if x < ax + t * (bx - ax):
                inside = not inside
    return inside


def _in_rounded_rect(x: float, y: float) -> bool:
    left, top = _scale(BUBBLE_LEFT), _scale(BUBBLE_TOP)
    right, bottom = _scale(BUBBLE_RIGHT), _scale(BUBBLE_BOTTOM)
    radius = _scale(BUBBLE_RADIUS)

    if not (left <= x <= right and top <= y <= bottom):
        return False

    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def _render() -> bytes:
    scaled_tail = [(_scale(px), _scale(py)) for px, py in TAIL]
    scaled_letters = [[(_scale(px), _scale(py)) for px, py in poly] for poly in LETTER_POLYGONS]

    # Premultiplied RGBA accumulation buffers, one entry per final pixel.
    accum = [[0, 0, 0, 0] for _ in range(SIZE * SIZE)]

    for by in range(BIG):
        y = by + 0.5
        row_out = (by // SUPERSAMPLE) * SIZE
        # Vertical gradient across the bubble body only; the tail continues the bottom colour.
        span = _scale(BUBBLE_BOTTOM) - _scale(BUBBLE_TOP)
        t = min(1.0, max(0.0, (y - _scale(BUBBLE_TOP)) / span))
        base = tuple(
            round(GRADIENT_TOP[i] + (GRADIENT_BOTTOM[i] - GRADIENT_TOP[i]) * t) for i in range(3)
        )

        for bx in range(BIG):
            x = bx + 0.5
            if not (_in_rounded_rect(x, y) or _in_polygon(x, y, scaled_tail)):
                continue

            if any(_in_polygon(x, y, poly) for poly in scaled_letters):
                r, g, b = TEXT_COLOR
            else:
                r, g, b = base

            cell = accum[row_out + (bx // SUPERSAMPLE)]
            cell[0] += r
            cell[1] += g
            cell[2] += b
            cell[3] += 255

    samples = SUPERSAMPLE * SUPERSAMPLE
    rows = bytearray()
    for row in range(SIZE):
        rows.append(0)  # PNG filter type 0 (None)
        for col in range(SIZE):
            r, g, b, a = accum[row * SIZE + col]
            alpha = a // samples
            if alpha == 0:
                rows.extend((0, 0, 0, 0))
                continue
            # Un-premultiply: the sums above only counted covered subsamples.
            covered = a // 255
            rows.extend((r // covered, g // covered, b // covered, alpha))
    return bytes(rows)


def _chunk(tag: bytes, data: bytes) -> bytes:
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def _png(raw: bytes) -> bytes:
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA, no interlace
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "images" / "icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(_png(_render()))
    print(f"wrote {out} ({out.stat().st_size} bytes, {SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
