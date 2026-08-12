#!/usr/bin/env python3
"""inject_pwa.py — add the PWA head block (manifest link, apple-touch-icon, theme-color,
apple web-app metas, tdc-pwa.js) to every top-level *.html page, right before </head>.
Idempotent (skips pages that already have the block). Relative URLs so it works on both
the Vercel root domain and the GitHub Pages subpath. Run: python3 scripts/inject_pwa.py
"""
import os, glob

ROOT = os.path.join(os.path.dirname(__file__), '..')
BLOCK = """  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#141416" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FAF9F6" media="(prefers-color-scheme: light)">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="The Depth Chart">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <script src="tdc-pwa.js?v=2" defer></script>
"""
SKIP = {'offline.html'}

def main():
    added = skipped = nohead = 0
    for path in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        base = os.path.basename(path)
        if base in SKIP:
            continue
        html = open(path, encoding='utf-8').read()
        if 'manifest.webmanifest' in html:
            skipped += 1
            continue
        idx = html.lower().find('</head>')
        if idx == -1:
            print('  no </head>:', base); nohead += 1; continue
        html = html[:idx] + BLOCK + html[idx:]
        open(path, 'w', encoding='utf-8').write(html)
        added += 1
    print('injected:%d  already-had:%d  no-head:%d' % (added, skipped, nohead))

if __name__ == '__main__':
    main()
