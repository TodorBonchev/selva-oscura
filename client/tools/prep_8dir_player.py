#!/usr/bin/env python3
"""Knock matte + normalize 8-dir player plates from /workspace/selva-player-8dir.

Run:  /tmp/.venv/bin/python tools/prep_8dir_player.py
"""
from __future__ import annotations
import os
from collections import deque
from PIL import Image

SRC = os.environ.get("SELVA_8DIR_SRC", "/workspace/selva-player-8dir")
HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "..", "public", "assets", "dore")
TARGET_H = 112
PAD = 4

FILES = [
    "player_n.png",
    "player_ne.png",
    "player_e.png",
    "player_se.png",
    "player_s.png",
    "player_e_walkb.png",
    "player_s_walkb.png",
]


def is_plate(p, thr=175, sat=28):
    r, g, b, a = p
    return a > 0 and min(r, g, b) > thr and (max(r, g, b) - min(r, g, b)) < sat


def knockout(im: Image.Image, thr=175, sat=28) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        p = px[x, y]
        if not (p[3] == 0 or is_plate(p, thr, sat)):
            continue
        seen[i] = 1
        if p[3] != 0:
            px[x, y] = (p[0], p[1], p[2], 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or (max(r, g, b) - min(r, g, b)) >= sat + 14:
                continue
            m = min(r, g, b)
            if m <= thr - 35:
                continue
            near = any(
                0 <= x + dx < w and 0 <= y + dy < h and seen[(y + dy) * w + (x + dx)]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if near:
                t = max(0.0, min(1.0, (thr + 25 - m) / 55.0))
                px[x, y] = (r, g, b, int(a * t))
    return im


def alpha_bbox(im, cut=28):
    px = im.load()
    w, h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > cut:
                xs.append(x)
                ys.append(y)
    if not xs:
        return 0, 0, w - 1, h - 1
    return min(xs), min(ys), max(xs), max(ys)


def normalize(im: Image.Image) -> Image.Image:
    x0, y0, x1, y1 = alpha_bbox(im)
    cropped = im.crop((x0, y0, x1 + 1, y1 + 1))
    cw, ch = cropped.size
    nw = max(1, int(round(cw * (TARGET_H / ch))))
    scaled = cropped.resize((nw, TARGET_H), Image.LANCZOS)
    out = Image.new("RGBA", (nw + PAD * 2, TARGET_H + PAD), (0, 0, 0, 0))
    out.alpha_composite(scaled, (PAD, 0))
    return out


def main():
    os.makedirs(DST, exist_ok=True)
    for name in FILES:
        src = os.path.join(SRC, name)
        if not os.path.isfile(src):
            print("skip missing", name)
            continue
        out = normalize(knockout(knockout(Image.open(src), 175, 28), 165, 32))
        out.save(os.path.join(DST, name), optimize=True)
        print("wrote", name, out.size)
    s_path = os.path.join(DST, "player_s.png")
    if os.path.isfile(s_path):
        Image.open(s_path).save(os.path.join(DST, "player.png"))
        print("player.png <- player_s.png")


if __name__ == "__main__":
    main()
