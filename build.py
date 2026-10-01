#!/usr/bin/env python3
"""Build of GalleriaBallroom: logos and cartouche from the designer's clean SVGs,
block 1 from its template (polygons from the same geometry as the engine), dist/ by terser.
Usage: python3 build.py <tag> <svg_limpos_dir>"""
import sys, re, json, math, subprocess, os

# guard: the engine refuses a stylesheet of another version (its sentinel), so the two must match
import re as _re
_js=_re.search(r"var VERSION = '([^']+)'", open('src/galleria.js').read()).group(1)
_css=_re.search(r'--gx-v: "([^"]+)"', open('src/galleria.css').read()).group(1)
if _js != _css: raise SystemExit('version mismatch: galleria.js ' + _js + ' vs galleria.css ' + _css)
TAG, SVG = sys.argv[1], sys.argv[2]
def svg(f):
    s = open(os.path.join(SVG, f), encoding='utf-8').read()
    vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', s).group(1).split()]
    return {'w': vb[2], 'h': vb[3], 'd': re.findall(r'<path[^>]*\sd="([^"]+)"', s)}
logos = {'galleria': svg('LOGO_GALLERIA_COR_TEMA-05.svg'), 'beau': svg('LOGO_PATROCINADOR_SVG-05.svg')}
roc = svg('ROCOCOS.svg'); assert len(roc['d']) == 1
os.makedirs('dist', exist_ok=True)
art = '/* GalleriaBallroom v%s art: the cartouche (ROCOCOS.svg, by the event designer), one path. */\nwindow.GX_ART={rococos:%s};\n' % (TAG.lstrip('v'), json.dumps({'w': roc['w'], 'h': roc['h'], 'd': roc['d'][0]}))
open('src/galleria-art.js', 'w').write(art); open('dist/galleria-art.js', 'w').write(art)
src = open('src/galleria.js').read()
assert '/*@LOGOS*/null' in src
open('build/galleria.js', 'w').write(src.replace('/*@LOGOS*/null', json.dumps(logos, separators=(',', ':'))))
subprocess.run(['terser', 'build/galleria.js', '-c', '-m', '--comments', '/^!/', '-o', 'dist/galleria.min.js'], check=True)
css = open('src/galleria.css').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); css = re.sub(r'\s+', ' ', css)
css = re.sub(r'\s*([{}:;,>])\s*', r'\1', css).replace(';}', '}').strip()
open('dist/galleria.css', 'w').write('/* GalleriaBallroom engine %s */\n' % TAG + css + '\n')
# tableau geometry, identical to edgeAt() in the engine at t = 1
def edge(v, t, F):
    Px, Py, a = F[0] * t ** .85, 1 - (1 - F[1]) * t, F[2] * t
    if v < a: return 0
    if v < Py:
        s = (v - a) / max(Py - a, 1e-4); arch = math.sqrt(max(0, 1 - (1 - s) ** 2))
        return Px * (s + (arch - s) * min(t, 1))
    return Px
def f(x): return ('%.1f' % x).rstrip('0').rstrip('.') + '%' if x else '0'
def poly(F, closed=False):
    pts = ['0 0', '100% 0', '100% 100%']
    Py, a = F[1], F[2]
    vs = [1] + [a + (Py - a) * s for s in (1, .55, .22, 0)]
    for v in vs: pts.append('0 100%' if closed else f(edge(v, 1, F) * 100) + ' ' + f(v * 100))
    return ','.join(pts)
L, P = [.86, .42, .06], [.90, .30, .045]
# alphas are bytes (/255); the shader uses the same bytes
LAYERS = ('linear-gradient(0deg,#D3B69C42,#8A1E2680 1.6%,#8A1E262E 7%,#8A1E2600 22%),'
          'linear-gradient(#2A0C10BF,#2A0C1000 16%),'
          'radial-gradient(124% 62% at 0 42%,#2A0C1000 32%,#2A0C109E 80%,#2A0C10D9),'
          'linear-gradient(90deg,#2A0C1000,#2A0C1066,#2A0C1000),'
          'linear-gradient(90deg,#2A0C10,#640D16 40%,#8A1E26 50%,#640D16 62%,#2A0C10)')
b1 = open('page/bloco1.template.html').read()
for k, v in {'LAYERS': LAYERS, 'CLOSED': poly(L, True), 'OPEN_L': poly(L), 'OPEN_P': poly(P), 'TAG': TAG}.items():
    b1 = b1.replace('{{%s}}' % k, v)
assert '{{' not in b1
b1 = b1.strip() + '\n'
open('page/bloco1.html', 'w').write(b1)
b2 = open('page/bloco2_hero_estatico.html').read()
print('bloco1.html', len(b1), 'chars | bloco2', len(b2), 'chars')
for fn in ('dist/galleria.min.js', 'dist/galleria.css', 'dist/galleria-art.js'):
    raw = open(fn, 'rb').read(); import gzip
    print(fn, len(raw), 'bytes, gzip', len(gzip.compress(raw, 9)))
