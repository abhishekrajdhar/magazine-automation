"""Colour helpers: conversions, distance, quantisation of rendered pixmaps."""

from __future__ import annotations

import colorsys
from collections import Counter

import numpy as np
from PIL import Image


def int_to_hex(c: int) -> str:
    return "#{:06X}".format(int(c) & 0xFFFFFF)


def rgb_to_hex(rgb: tuple[float, float, float] | list[float]) -> str:
    """Accepts 0..1 floats or 0..255 ints."""
    vals = list(rgb)[:3]
    if all(isinstance(v, float) for v in vals) and max(vals, default=0) <= 1.0:
        vals = [round(v * 255) for v in vals]
    return "#{:02X}{:02X}{:02X}".format(*[max(0, min(255, int(v))) for v in vals])


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def distance(a: str, b: str) -> float:
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    # "redmean" perceptual approximation
    rm = (ra[0] + rb[0]) / 2
    dr, dg, db = ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]
    return ((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) ** 0.5


def hsv(h: str) -> tuple[float, float, float]:
    r, g, b = hex_to_rgb(h)
    return colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)


def luminance(h: str) -> float:
    r, g, b = hex_to_rgb(h)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def is_neutral(h: str) -> bool:
    _, s, v = hsv(h)
    return s < 0.18 or v < 0.12


def is_chromatic(h: str) -> bool:
    _, s, v = hsv(h)
    return s >= 0.3 and v >= 0.2


def is_light(h: str) -> bool:
    return luminance(h) > 0.85


def mix(a: str, b: str, t: float) -> str:
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(tuple(round(ra[i] * (1 - t) + rb[i] * t) for i in range(3)))


def quantize_pixmap(png_or_samples: Image.Image, n: int = 6) -> list[tuple[str, float]]:
    """Return [(hex, fraction)] of the n dominant colours of an image (median cut)."""
    img = png_or_samples.convert("RGB")
    if img.width * img.height > 40_000:
        img = img.resize((max(1, img.width // 2), max(1, img.height // 2)))
    q = img.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    out = []
    for count, idx in sorted(counts, reverse=True):
        rgb = pal[idx * 3: idx * 3 + 3]
        if len(rgb) == 3:
            out.append((rgb_to_hex(rgb), count / total))
    return out


def merge_weighted(colours: Counter, threshold: float = 40.0) -> list[tuple[str, float]]:
    """Merge near-identical colours, keeping the heaviest representative."""
    merged: list[list] = []
    for hexv, w in colours.most_common():
        for m in merged:
            if distance(m[0], hexv) < threshold:
                m[1] += w
                break
        else:
            merged.append([hexv, float(w)])
    merged.sort(key=lambda x: -x[1])
    return [(h, w) for h, w in merged]


def page_background(img: Image.Image) -> str:
    """Most common colour along the page border (paper colour estimate)."""
    a = np.asarray(img.convert("RGB"))
    if a.size == 0:
        return "#FFFFFF"
    border = np.concatenate([a[0, :, :], a[-1, :, :], a[:, 0, :], a[:, -1, :]])
    q = (border // 16) * 16 + 8
    vals, counts = np.unique(q.reshape(-1, 3), axis=0, return_counts=True)
    best = vals[int(np.argmax(counts))]
    return rgb_to_hex(tuple(int(v) for v in best))
