#!/usr/bin/env python3
"""gen_pwa_icons.py — rasterize the brand mark (favicon.svg) into PWA PNG icons,
in pure Python (no PIL / cairo available on this box).

The mark: a dark #141416 square (full-bleed for maskable safety) with three ascending
gold #E6D5A8 rounded bars — same geometry as favicon.svg, drawn in the 32-unit viewBox.
Anti-aliased via 4x4 supersampling per pixel. Outputs opaque RGB PNGs:
  icon-192.png, icon-512.png  (manifest, purpose "any maskable")
  apple-touch-icon.png (180)  (iOS home screen; must be opaque)
Run: python3 scripts/gen_pwa_icons.py
"""
import os, zlib, struct

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, '..')
BG   = (0x14, 0x14, 0x16)
GOLD = (0xE6, 0xD5, 0xA8)
# bars in the 32-unit viewBox: (x, y, w, h, r)
BARS = [(6.5, 17.5, 4.6, 8.0, 1.1),
        (13.7, 11.5, 4.6, 14.0, 1.1),
        (20.9, 6.5, 4.6, 19.0, 1.1)]
SS = 4  # supersample grid per pixel

def _rrect_inside(px, py, x, y, w, h, r):
    # rounded-rect inside test via distance to the inner (deflated) rectangle
    qx = min(max(px, x + r), x + w - r)
    qy = min(max(py, y + r), y + h - r)
    dx, dy = px - qx, py - qy
    return dx * dx + dy * dy <= r * r

def _png(path, size):
    scale = size / 32.0
    inv = 1.0 / scale
    rows = bytearray()
    for j in range(size):
        rows.append(0)  # filter byte 0 (None) per scanline
        for i in range(size):
            hit = 0
            for a in range(SS):
                for b in range(SS):
                    wx = (i + (a + 0.5) / SS) * inv
                    wy = (j + (b + 0.5) / SS) * inv
                    for (x, y, w, h, r) in BARS:
                        if _rrect_inside(wx, wy, x, y, w, h, r):
                            hit += 1
                            break
            cov = hit / (SS * SS)
            rows.append(int(BG[0] + (GOLD[0] - BG[0]) * cov + 0.5))
            rows.append(int(BG[1] + (GOLD[1] - BG[1]) * cov + 0.5))
            rows.append(int(BG[2] + (GOLD[2] - BG[2]) * cov + 0.5))

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # RGB, 8-bit
    idat = zlib.compress(bytes(rows), 9)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', idat) + chunk(b'IEND', b''))
    with open(os.path.join(ROOT, path), 'wb') as f:
        f.write(png)
    print('wrote %-22s %dx%d  %d bytes' % (path, size, size, len(png)))

if __name__ == '__main__':
    _png('icon-192.png', 192)
    _png('icon-512.png', 512)
    _png('apple-touch-icon.png', 180)
