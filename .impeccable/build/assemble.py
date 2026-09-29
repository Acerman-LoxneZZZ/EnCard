from pathlib import Path
import base64, re, urllib.request

root = Path.cwd()
build = root / '.impeccable' / 'build'
baseline = (root / 'index.html').read_text(encoding='utf-8')
words = baseline[baseline.index('const WORDS ='):baseline.index('const $ =')]
fonts = [
    ('Manrope', '400 700', 'https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf', 'manrope'),
    ('DM Serif Display', '400', 'https://fonts.gstatic.com/s/dmserifdisplay/v17/-nFnOHM81r4j6k0gjAW3mujVU2B2K_c.ttf', 'dmserifdisplay'),
]
font_css, licenses = [], []
for name, weight, url, slug in fonts:
    cached = build / (slug + '.ttf')
    if not cached.exists():
        cached.write_bytes(urllib.request.urlopen(url, timeout=30).read())
    encoded = base64.b64encode(cached.read_bytes()).decode('ascii')
    font_css.append(f"@font-face{{font-family:'{name}';font-style:normal;font-weight:{weight};font-display:swap;src:url(data:font/ttf;base64,{encoded}) format('truetype');}}")
    license_path = build / (slug + '-OFL.txt')
    if not license_path.exists():
        license_path.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{slug}/OFL.txt', timeout=30).read())
    licenses.append(f'{name} — embedded from {url}\n' + license_path.read_text(encoding='utf-8'))

html = '''<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0d1018"><meta name="description" content="Wordflow — английские слова по карточкам. Учитесь в своём ритме, повторяйте сложное и сохраняйте прогресс."><title>Wordflow — английский по карточкам</title>
'''
html += '<!-- Embedded font licenses.\n' + '\n\n'.join(licenses).replace('--', '—') + '\n-->\n'
html += '<style>\n' + '\n'.join(font_css) + '\n' + (build/'style.css').read_text(encoding='utf-8') + '\n</style></head><body>\n'
html += (build/'body.html').read_text(encoding='utf-8')
html += '\n<script>\n"use strict";\n' + words + (build/'app.js').read_text(encoding='utf-8') + '\n</script></body></html>\n'
(root/'index.html').write_text(html,encoding='utf-8')
print(f'Assembled index.html: {len(html.encode("utf-8")):,} bytes, all fonts embedded.')
