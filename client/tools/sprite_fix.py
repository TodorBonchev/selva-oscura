#!/usr/bin/env python3
"""One-off sprite fixes for the Doré kit (Pillow only).

1. Knock out the baked white/checker matte behind item icons (item_chest.png).
2. Synthesize "passing" walk frames (legs together) from the two stride frames so
   the 2-frame cycle reads contact → passing instead of front-view → back-view.
3. Rebuild player.png (idle) from the front passing frame so idle and walk share
   one crisp engraving (old idle was a blocky 2× nearest upscale).

Run from client/:  /tmp/.venv/bin/python tools/sprite_fix.py
"""
from __future__ import annotations

import os
import sys
from collections import deque

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public", "assets")


def is_plate(p, thr=188, sat=22):
    r, g, b, a = p
    return a > 0 and min(r, g, b) > thr and (max(r, g, b) - min(r, g, b)) < sat


def knockout_plate(path: str, thr=188, sat=22, min_plate=800) -> int:
    """Flood from the image border through transparent / near-white low-sat pixels
    and clear them. Only touches images that actually carry a big plate."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    plate = sum(1 for y in range(h) for x in range(w) if is_plate(px[x, y], thr, sat))
    if plate < min_plate:
        return 0
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    cleared = 0
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
            cleared += 1
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Feather: light low-sat pixels touching the cleared region fade by brightness.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or (max(r, g, b) - min(r, g, b)) >= sat + 12:
                continue
            m = min(r, g, b)
            if m <= thr - 30:
                continue
            near = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and seen[ny * w + nx]:
                    near = True
                    break
            if near:
                t = max(0.0, min(1.0, (thr + 20 - m) / 50.0))
                px[x, y] = (r, g, b, int(a * t))
    im.save(path)
    return cleared


def alpha_bbox(im: Image.Image, cut=40):
    px = im.load()
    w, h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > cut:
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def passing_frame(src: str, dst: str, robe_from=0.62, legs_from=0.80, legs_scale=0.52):
    """Legs-together frame: squash rows below the hip toward the leg centroid.
    Robe flare eases from 1.0 (hip) to legs_scale (boots)."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    x0, y0, x1, y1 = alpha_bbox(im)
    fh = y1 - y0
    y_robe = y0 + int(fh * robe_from)
    y_legs = y0 + int(fh * legs_from)
    px = im.load()
    # centroid of the leg band
    sx = sw = 0
    for y in range(y_legs, y1 + 1):
        for x in range(w):
            a = px[x, y][3]
            if a > 40:
                sx += x * a; sw += a
    cx = sx / sw if sw else (x0 + x1) / 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        row = im.crop((0, y, w, y + 1))
        if y < y_robe:
            out.paste(row, (0, y))
            continue
        if y < y_legs:
            t = (y - y_robe) / max(1, (y_legs - y_robe))
            f = 1.0 + (legs_scale - 1.0) * (t * t)
        else:
            f = legs_scale
        nw = max(1, int(round(w * f)))
        rs = row.resize((nw, 1), Image.LANCZOS)
        # keep the point cx fixed
        left = int(round(cx - cx * f))
        out.alpha_composite(rs, (max(0, left), y)) if left >= 0 else out.alpha_composite(rs.crop((-left, 0, nw, 1)), (0, y))
    out.save(dst)
    return out


def main():
    items = os.path.join(PUB, "items")
    for f in sorted(os.listdir(items)):
        if f.endswith(".png"):
            n = knockout_plate(os.path.join(items, f))
            if n:
                print(f"knockout {f}: cleared {n} plate px")
    dore = os.path.join(PUB, "dore")
    a = os.path.join(dore, "player_walk_a.png")
    b = os.path.join(dore, "player_walk_b.png")
    a2 = os.path.join(dore, "player_walk_a2.png")
    b2 = os.path.join(dore, "player_walk_b2.png")
    front_pass = passing_frame(a, a2)
    passing_frame(b, b2)
    # Idle = front passing pose (legs together, face visible)
    front_pass.save(os.path.join(dore, "player.png"))
    print("wrote", a2, b2, "and player.png (idle from front passing frame)")


if __name__ == "__main__":
    sys.exit(main())
