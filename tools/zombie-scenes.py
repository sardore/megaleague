#!/usr/bin/env python3
"""좀비굴 지역 장면 생성기.

src/styles/zombie-scenes.css 의 CSS 변수(SVG data URI)를 만든다. 이 파일이 장면 그림의 유일한 원본이다.
  --zc-scene-<지역>  정지 장면(필터·질감 포함, 한 번만 그려 캐시된다)
  --zc-fx-<지역>     움직이는 층(기포, 번개, 물결, 흔들림. 필터 없이 그라데이션만)
  --zc-sky-<지역>    하늘/천장 바탕 그라데이션
  --zc-ceiling, --zc-wall-l, --zc-wall-r, --zc-spores  전 지역 공통 동굴 틀과 포자
  --zc-door-wall     문 칸의 돌벽
모든 입체는 빛 방향에 맞춘 그라데이션, 테두리 빛, 접지 그림자, 질감을 가진다. 평평한 단색 도형은 쓰지 않는다.
사용: python3 tools/zombie-scenes.py
"""
import math, random, re, urllib.parse, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'src/styles/zombie-scenes.css'


def uri(svg):
    svg = re.sub(r'\s*\n\s*', '', svg).replace('"', "'")
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ()-,.;<>") + '")'


def n(v):
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


def eased(i, color, op=1.0):
    st = [(0, 1), (.16, .72), (.34, .44), (.58, .2), (.82, .06), (1, 0)]
    return f'<radialGradient id="{i}">' + ''.join(f'<stop offset="{o}" stop-color="{color}" stop-opacity="{round(op * a, 3)}"/>' for o, a in st) + '</radialGradient>'


def lin(i, stops, x1=0, y1=0, x2=0, y2=1):
    s = ''
    for st in stops:
        a = st[2] if len(st) > 2 else 1
        s += f'<stop offset="{st[0]}" stop-color="{st[1]}"' + (f' stop-opacity="{a}"' if a != 1 else '') + '/>'
    return f'<linearGradient id="{i}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>'


def rg(i, stops, cx=.5, cy=.5, r=.5, fx=None, fy=None):
    s = ''.join(f'<stop offset="{st[0]}" stop-color="{st[1]}"' + (f' stop-opacity="{st[2]}"' if len(st) > 2 and st[2] != 1 else '') + '/>' for st in stops)
    f = f' fx="{fx}" fy="{fy}"' if fx is not None else ''
    return f'<radialGradient id="{i}" cx="{cx}" cy="{cy}" r="{r}"{f}>{s}</radialGradient>'


def glow(i, cx, cy, r, sy=1.0, op=1.0):
    t = f' transform="translate({n(cx)} {n(cy)}) scale(1 {sy}) translate({n(-cx)} {n(-cy)})"' if sy != 1 else ''
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="url(#{i})"{t}' + (f' opacity="{op}"' if op != 1 else '') + '/>'


def anim(attr, vals, dur, begin=0, extra=''):
    return f'<animate attributeName="{attr}" values="{vals}" dur="{dur}s" begin="-{begin}s" repeatCount="indefinite" {extra}/>'


def tform(kind, vals, dur, begin=0):
    return f'<animateTransform attributeName="transform" type="{kind}" values="{vals}" dur="{dur}s" begin="-{begin}s" repeatCount="indefinite"/>'


COMMON = '''
<filter id="b1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1"/></filter>
<filter id="b3" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="b6" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="b12" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="rough" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency=".03 .05" numOctaves="3" seed="3" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="tex" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".06 .1" numOctaves="4" seed="9" result="t"/><feDiffuseLighting in="t" surfaceScale="2.6" diffuseConstant="1.25" lighting-color="#fff" result="l"><feDistantLight azimuth="300" elevation="56"/></feDiffuseLighting><feBlend in="SourceGraphic" in2="l" mode="multiply" result="m"/><feComposite in="m" in2="SourceGraphic" operator="in"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 -.2"/></filter>
'''


def svg(body, defs='', w=400, h=400, par='xMidYMax slice'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="{par}"><defs>{COMMON}{defs}</defs>{body}</svg>'


def grain(op=.5):
    return f'<rect width="400" height="400" filter="url(#grain)" opacity="{op}"/>'


def bubbles(x0, x1, y0, y1, count, seed, col='#caffdd', rmin=1.2, rmax=3.6):
    r = random.Random(seed)
    o = ''
    for _ in range(count):
        x = r.uniform(x0, x1)
        rad = r.uniform(rmin, rmax)
        d = r.uniform(4, 9)
        b = r.uniform(0, d)
        o += (f'<circle cx="{n(x)}" cy="{y0}" r="{n(rad)}" fill="url(#bub)" opacity="0">'
              + anim('cy', f'{y0};{y1}', d, b) + anim('opacity', '0;.9;.9;0', d, b) + anim('cx', f'{n(x)};{n(x + r.uniform(-9, 9))};{n(x)}', d, b) + '</circle>')
    return o


BUB = rg('bub', [(0, '#ffffff', .95), (.45, '#caffe6', .55), (.8, '#8affc0', .25), (1, '#8affc0', .75)], fx=.34, fy=.3)


def tree(out, x, y, ang, ln, w, depth, r):
    x2 = x + math.cos(ang) * ln
    y2 = y - math.sin(ang) * ln
    bend = r.uniform(-.28, .28) * ln
    cx = (x + x2) / 2 + math.sin(ang) * bend
    cy = (y + y2) / 2 + math.cos(ang) * bend
    out.append(f'<path d="M{n(x)} {n(y)}Q{n(cx)} {n(cy)} {n(x2)} {n(y2)}" stroke-width="{n(w)}"/>')
    if depth > 0:
        for _ in range(r.choice((2, 2, 3))):
            tree(out, x2, y2, ang + r.uniform(-.85, .85), ln * r.uniform(.6, .78), max(.7, w * .66), depth - 1, r)


def blades(y, r, count, x0=0, x1=400, hmin=10, hmax=26, spread=5):
    o = ''
    for _ in range(count):
        x = r.uniform(x0, x1)
        h = r.uniform(hmin, hmax)
        b = r.uniform(-spread, spread)
        w = r.uniform(1.1, 2.3)
        o += f'<path d="M{n(x - w)} {n(y)}Q{n(x - w / 2 + b / 2)} {n(y - h / 2)} {n(x + b)} {n(y - h)}Q{n(x + w / 2 + b / 2)} {n(y - h / 2)} {n(x + w)} {n(y)}Z"/>'
    return o


# ============================================================ 묘지
def graveyard():
    r = random.Random(11)
    d = eased('mg', '#cdeec8', .9) + eased('mg2', '#eaffe2', 1) + eased('wl', '#9fffc0', 1) + eased('fogg', '#9fe3a6', .5)
    d += rg('moon', [(0, '#fbfff6'), (.55, '#dbefd3'), (1, '#a9c9ab')], cx=.42, cy=.38, r=.7)
    d += lin('far', [(0, '#2f7355'), (1, '#10301f')]) + lin('midh', [(0, '#1c4a35'), (1, '#07170f')]) + lin('fgh', [(0, '#0e2d1d'), (1, '#010503')])
    d += lin('stoneg', [(0, '#06110b'), (.5, '#1b3a2a'), (1, '#5a8a70')], 0, 0, 1, 0) + lin('rimg', [(0, '#a8e0be', 0), (1, '#d8ffe6', .85)], 0, 0, 1, 0)
    d += lin('chapg', [(0, '#08160f'), (.6, '#1d3b2c'), (1, '#4d7d63')], 0, 0, 1, 0) + lin('roofg', [(0, '#0b1f15'), (1, '#2f5a45')], 0, 0, 1, 1)
    d += lin('iron', [(0, '#03090a'), (.6, '#0f241a'), (1, '#4e8168')], 0, 0, 1, 0)
    s = ''
    s += glow('mg', 318, 96, 190, 1.0, .75) + glow('mg2', 318, 96, 72, 1.0, .55)
    s += '<circle cx="318" cy="96" r="25" fill="url(#moon)"/>'
    s += '<g filter="url(#b1)" opacity=".28"><circle cx="309" cy="90" r="6" fill="#7c9e80"/><circle cx="326" cy="103" r="4.2" fill="#7c9e80"/><circle cx="321" cy="84" r="3" fill="#7c9e80"/><circle cx="310" cy="106" r="2.6" fill="#7c9e80"/></g>'
    s += '<circle cx="318" cy="96" r="25" fill="none" stroke="#f4fff0" stroke-opacity=".5" stroke-width=".8"/>'
    # 먼 언덕과 먼 숲
    s += '<path d="M0 262C46 238 104 246 160 254S290 230 400 248V400H0Z" fill="url(#far)"/>'
    far = []
    for i in range(9):
        x = r.uniform(0, 400)
        tree(far, x, 252 + r.uniform(-6, 4), math.pi / 2 + r.uniform(-.2, .2), r.uniform(18, 32), 1.7, 2, r)
    s += '<g stroke="#12382a" stroke-opacity=".8" fill="none" stroke-linecap="round" filter="url(#b1)">' + ''.join(far) + '</g>'
    s += '<path d="M0 272C60 252 140 272 214 262S340 250 400 266V400H0Z" fill="url(#midh)"/>'
    # 예배당: 빛이 오른쪽 위에서 온다
    s += '<g filter="url(#tex)"><path d="M118 280V228h36V280z" fill="url(#chapg)"/><path d="M154 280V222l30 8v50z" fill="#06120c"/><path d="M118 228l18-26 18 26z" fill="url(#roofg)"/><path d="M154 222l30 8-12-26z" fill="#0a1d14"/><path d="M130 280V248a6 6 0 0 1 12 0V280z" fill="#020705"/></g>'
    s += '<path d="M136 202V170M130 178h12" stroke="#0a1d14" stroke-width="3" stroke-linecap="round"/><path d="M137 203V171M131 179h12" stroke="#9fd8b4" stroke-opacity=".5" stroke-width="1" stroke-linecap="round"/>'
    s += glow('wl', 136, 262, 20, 1.2, .8) + '<path d="M131 280V250a5 5 0 0 1 10 0V280z" fill="#c8ffd8" fill-opacity=".34"/>'
    s += '<path d="M118 228H154M136 202L154 228" stroke="#c8ffe0" stroke-opacity=".55" stroke-width=".9" fill="none"/>'
    s += '<path d="M118 280H154" stroke="#000" stroke-opacity=".6" stroke-width="3" filter="url(#b3)"/>'

    def stone(x, y, w, h, kind, tilt=0, seed=0):
        rr = random.Random(seed)
        g = f'<g transform="rotate({tilt} {n(x + w / 2)} {n(y)})">'
        g += f'<path d="M{n(x + w + 2)} {n(y)}l{n(-w * 2.1)} 7h{n(w)}z" fill="#000" opacity=".55" filter="url(#b3)"/>'
        if kind == 'round':
            p = f'M{n(x)} {n(y)}V{n(y - h + w / 2)}a{n(w / 2)} {n(w / 2)} 0 0 1 {n(w)} 0V{n(y)}Z'
        elif kind == 'cross':
            t = w * .34
            p = f'M{n(x + w / 2 - t / 2)} {n(y)}V{n(y - h * .55)}H{n(x)}V{n(y - h * .55 - t)}H{n(x + w / 2 - t / 2)}V{n(y - h)}H{n(x + w / 2 + t / 2)}V{n(y - h * .55 - t)}H{n(x + w)}V{n(y - h * .55)}H{n(x + w / 2 + t / 2)}V{n(y)}Z'
        else:
            p = f'M{n(x)} {n(y)}V{n(y - h + 5)}L{n(x + 5)} {n(y - h)}H{n(x + w - 3)}L{n(x + w)} {n(y - h + 4)}V{n(y)}Z'
        g += f'<path d="{p}" fill="url(#stoneg)" filter="url(#tex)"/><path d="{p}" fill="none" stroke="url(#rimg)" stroke-width="1"/>'
        if kind != 'cross':
            cx = x + w / 2
            g += f'<path d="M{n(cx)} {n(y - h * .72)}V{n(y - h * .4)}M{n(cx - 4)} {n(y - h * .62)}H{n(cx + 4)}" stroke="#020806" stroke-width="1.6" stroke-linecap="round"/><path d="M{n(cx + .8)} {n(y - h * .72 + .8)}V{n(y - h * .4 + .8)}M{n(cx - 3.2)} {n(y - h * .62 + .8)}H{n(cx + 4.8)}" stroke="#8fc7a4" stroke-opacity=".4" stroke-width=".7" stroke-linecap="round"/>'
        g += f'<path d="M{n(x + w * .3)} {n(y - h * .3)}l{n(rr.uniform(-3, 3))} 6 {n(rr.uniform(-3, 3))} 6 {n(rr.uniform(-3, 3))} 6" stroke="#020806" stroke-width=".9" fill="none" stroke-opacity=".9"/>'
        g += f'<g filter="url(#b3)" opacity=".55"><path d="M{n(x - 2)} {n(y + 1)}q{n(w * .3)} -9 {n(w * .6)} -3t{n(w * .5)} 3z" fill="#4f9a45"/></g>'
        return g + '</g>'

    s += '<path d="M0 316C80 296 150 312 230 306S350 296 400 312V400H0Z" fill="url(#fgh)"/>'
    s += stone(176, 338, 36, 58, 'round', -2, 1) + stone(236, 334, 30, 48, 'slab', 3, 2) + stone(300, 346, 42, 76, 'cross', -4, 3) + stone(356, 330, 32, 54, 'round', 5, 4) + stone(96, 350, 40, 74, 'round', 3, 5) + stone(144, 332, 26, 44, 'slab', -5, 6)
    # 철 울타리
    f = []
    for x in range(200, 404, 13):
        f.append(f'<path d="M{x} 318V288l2.2-7 2.2 7V318z" fill="url(#iron)"/><path d="M{x + 2.2} 281l-1.6 5h3.2z" fill="#a8e0be" fill-opacity=".6"/>')
    s += '<g>' + ''.join(f) + '<path d="M196 296H404M196 308H404" stroke="#06140d" stroke-width="2.4"/><path d="M196 295H404M196 307H404" stroke="#7fc29a" stroke-opacity=".4" stroke-width=".6"/></g>'
    # 고목 (왼쪽, 달빛을 받는 가장자리)
    t = []
    tree(t, 52, 338, math.pi / 2 + .12, 74, 7, 4, r)
    s += '<g stroke="#7ec59a" stroke-opacity=".55" fill="none" stroke-linecap="round" transform="translate(1.4 -1)">' + ''.join(t) + '</g><g stroke="#030a06" fill="none" stroke-linecap="round">' + ''.join(t) + '</g>'
    # 흙무더기와 뿌리
    s += '<g filter="url(#tex)"><path d="M236 400C240 366 262 352 290 354S338 366 346 400Z" fill="url(#fgh)"/></g><path d="M240 392C246 368 264 358 290 359S330 368 338 392" stroke="#6a4a2a" stroke-opacity=".4" stroke-width="1.2" fill="none"/>'
    s += '<path d="M0 392H400V400H0Z" fill="#000" opacity=".5"/>'
    s += grain(.45)
    fx = ''
    fx += '<g>' + ''.join(
        f'<g opacity="0">{anim("opacity", "0;.7;.7;0", 11, b)}<ellipse cx="0" cy="0" rx="150" ry="14" fill="url(#fogg)"/>' + tform('translate', f'-160 {y};560 {y - 8}', 26 + k * 6, b * 2) + '</g>'
        for k, (y, b) in enumerate([(300, 0), (338, 5), (280, 9)])) + '</g>'
    for k, (px, py) in enumerate([(120, 330), (310, 300), (220, 340)]):
        fx += (f'<g>{tform("translate", f"{px} {py};{px + 26} {py - 20};{px - 10} {py - 34};{px} {py}", 9 + k * 3, k * 2)}<circle r="14" fill="url(#wl)" opacity=".5">{anim("opacity", ".25;.7;.25", 2.4 + k, k)}</circle><circle r="2.2" fill="#f0fff2"/></g>')
    cl = lambda y, w, dur, b: f'<path d="M-40 {y}q60 -16 130 -4t{w} 4q-60 14 -130 6t-{w} -6z" fill="url(#cld)" opacity=".7">' + tform('translate', f'0 0;{520} -6', dur, b) + '</path>'
    fx = f'<defs>{lin("cld", [(0, "#0a1e15", 0), (.5, "#0a1e15", .75), (1, "#0a1e15", 0)], 0, 0, 1, 0)}</defs>' + cl(86, 120, 60, 10) + cl(122, 150, 80, 40) + fx
    bat = lambda y, dur, b: f'<path d="M0 0q5-7 10 0 5-7 10 0-4 2.4-10 1.2Q4 2.4 0 0z" fill="#010403"><animateMotion path="M-30 {y}Q120 {y - 50} 240 {y}T440 {y - 12}" dur="{dur}s" begin="-{b}s" repeatCount="indefinite"/>' + anim('transform', 'scale(1 1);scale(1 .5);scale(1 1)', .5) + '</path>'
    fx += bat(70, 11, 0) + bat(104, 15, 6)
    g = '<g fill="url(#grassg)">' + blades(402, r, 90, hmin=14, hmax=40, spread=7) + '</g>'
    fx += f'<defs>{lin("grassg", [(0, "#173826"), (.4, "#04100a"), (1, "#010503")])}</defs><g transform-origin="200 402">{tform("skewX", "-1.5;1.5;-1.5", 6)}{g}</g>'
    return svg(s, d, par='xMidYMax slice'), svg(fx, d)


# ============================================================ 하수구
def sewer():
    r = random.Random(21)
    cx, cy = 200, 196
    d = eased('lt', '#e3f56a', .95) + eased('lt2', '#f6ffa8', 1) + eased('alg', '#9dff5a', .9) + eased('mist', '#cfe85a', .32)
    d += lin('wat', [(0, '#a7c240'), (.18, '#5f7a18'), (.55, '#26340a'), (1, '#0a1002')]) + lin('wallL', [(0, '#010200'), (.7, '#0b1103'), (1, '#27330a')], 0, 0, 1, 0) + lin('wallR', [(0, '#27330a'), (.3, '#0b1103'), (1, '#010200')], 0, 0, 1, 0)
    d += lin('ledgeT', [(0, '#586b1c'), (1, '#2b3810')], 0, 0, 0, 1) + lin('ledgeF', [(0, '#10170a'), (1, '#030601')]) + lin('goo', [(0, '#b3d33a'), (1, '#4f6b10')])
    d += rg('vig', [(.5, '#000', 0), (1, '#000', .86)], cx=.5, cy=.46, r=.78)
    d += lin('pipeD', [(0, '#050702'), (.4, '#0c1004'), (1, '#050702')]) + lin('shaft', [(0, '#efff9a', .5), (1, '#efff9a', 0)])
    s = glow('lt', cx, cy - 6, 150, 1.0, 1) + ''
    rings = ''
    n_ring = 9
    arcs = []
    for i in range(n_ring):
        t = i / (n_ring - 1)
        rx = 218 - 168 * (t ** .78)
        ry = 188 - 142 * (t ** .78)
        arcs.append((rx, ry))
    cols = ['#0a1003', '#101705', '#182107', '#222e09', '#2f3d0c', '#3f500f', '#566a14', '#7d9420', '#b2c83c']
    for (rx, ry), c in zip(arcs, cols):
        rings += f'<path d="M{n(cx - rx)} 290V{n(cy)}A{n(rx)} {n(ry)} 0 0 1 {n(cx + rx)} {n(cy)}V290Z" fill="{c}"/>'
    joints = ''
    for i in range(n_ring - 1):
        (rx1, ry1), (rx2, ry2) = arcs[i], arcs[i + 1]
        for k in range(0, 11):
            a = math.pi * (k + (.5 if i % 2 else 0)) / 10
            x1, y1 = cx - math.cos(a) * rx1, cy - math.sin(a) * ry1
            x2, y2 = cx - math.cos(a) * rx2, cy - math.sin(a) * ry2
            if i % 2 and k == 10:
                continue
            joints += f'M{n(x1)} {n(y1)}L{n(x2)} {n(y2)}'
        joints += f'M{n(cx - arcs[i][0])} 290V{n(cy)}A{n(arcs[i][0])} {n(arcs[i][1])} 0 0 1 {n(cx + arcs[i][0])} {n(cy)}V290'
    s += f'<g filter="url(#tex)">{rings}</g><path d="{joints}" stroke="#050802" stroke-width="1.3" stroke-opacity=".75" fill="none"/>'
    hl = ''.join(f'<path d="M{n(cx - rx)} 270V{n(cy)}A{n(rx)} {n(ry)} 0 0 1 {n(cx + rx)} {n(cy)}V270" stroke="#d9ee5c" stroke-opacity="{round(.1 + i * .045, 3)}" stroke-width=".9" fill="none" transform="translate(1.2 1.4)"/>' for i, (rx, ry) in enumerate(arcs))
    s += hl
    s += glow('lt2', cx, cy + 6, 66, 1.0, .95)
    # 어두운 안쪽 통로 입구와 쇠창살
    bars = ''.join(f'<path d="M{x} {cy - 40}V{cy + 44}" stroke="#0a0f03" stroke-width="2.4"/><path d="M{x - .8} {cy - 40}V{cy + 44}" stroke="#d6ea60" stroke-opacity=".5" stroke-width=".6"/>' for x in range(170, 236, 10))
    s += bars
    s += '<rect width="400" height="400" fill="url(#vig)"/>'
    # 빛줄기: 천장 격자에서 내려온다
    s += '<g filter="url(#b6)"><path d="M92 0L128 0L196 268L128 268Z" fill="url(#shaft)" opacity=".55"/><path d="M262 0L292 0L330 250L244 250Z" fill="url(#shaft)" opacity=".38"/></g>'
    # 천장: 두껍게 처진 아치
    s += '<path d="M0 0H400V44C360 70 332 52 296 78S226 56 190 82 120 58 84 86 26 66 0 90Z" fill="#030501"/>'
    s += '<path d="M0 90C26 66 60 90 84 86S156 58 190 82 262 56 296 78 360 70 400 44" stroke="#c0d84a" stroke-opacity=".38" stroke-width="1.6" fill="none"/>'
    # 큰 파이프 (원통: 겹친 선으로 입체)
    def pipe(path, w):
        o = f'<path d="{path}" stroke="#020301" stroke-width="{w + 5}" fill="none" stroke-linecap="round"/>'
        for k, (ww, col, op, off) in enumerate([(w, '#0f1505', 1, 0), (w * .78, '#273309', 1, -.12), (w * .5, '#56691b', 1, -.24), (w * .22, '#c2da55', .85, -.34)]):
            o += f'<path d="{path}" stroke="{col}" stroke-opacity="{op}" stroke-width="{n(ww)}" fill="none" stroke-linecap="round" transform="translate({n(off * w * .5)} {n(off * w * .5)})"/>'
        o += f'<path d="{path}" stroke="#0a0f03" stroke-width="{n(w + 3)}" stroke-dasharray="3 52" fill="none"/><path d="{path}" stroke="#97af34" stroke-opacity=".5" stroke-width="{n(w + 3)}" stroke-dasharray=".8 54.2" stroke-dashoffset="-2" fill="none"/>'
        return o
    s += pipe('M-14 90C70 54 128 152 236 112', 24) + pipe('M414 30C336 64 344 150 280 212', 28)
    # 밸브 바퀴
    def valve(x, y, rr):
        o = f'<circle cx="{x}" cy="{y}" r="{rr + 2}" fill="#050702"/><circle cx="{x}" cy="{y}" r="{rr}" fill="none" stroke="url(#vg)" stroke-width="3.4"/>'
        for k in range(6):
            a = k * math.pi / 3
            o += f'<path d="M{n(x)} {n(y)}L{n(x + math.cos(a) * rr)} {n(y + math.sin(a) * rr)}" stroke="#3a2a12" stroke-width="2"/><path d="M{n(x - .6)} {n(y - .6)}L{n(x + math.cos(a) * rr - .6)} {n(y + math.sin(a) * rr - .6)}" stroke="#d9a860" stroke-opacity=".5" stroke-width=".7"/>'
        return o + f'<circle cx="{x}" cy="{y}" r="{n(rr * .3)}" fill="url(#hub)"/>'
    d += lin('vg', [(0, '#e0b36a'), (.5, '#6a4a22'), (1, '#2a1c0a')], 0, 0, 1, 1) + rg('hub', [(0, '#f1d49a'), (1, '#4a3416')], .35, .3, .7)
    s += valve(138, 112, 14) + valve(318, 156, 16)
    # 걸쭉하게 흘러내리는 점액 (파이프 이음매)
    def drip(x, y, h):
        return f'<path d="M{x - 2.4} {y}c0 {h * .6} -1.4 {h * .7} -1.4 {h}a3.8 3.8 0 0 0 7.6 0c0-{h * .3} -1.2-{h * .4} -1.2-{h}z" fill="url(#goo)"/><circle cx="{n(x + .4)}" cy="{n(y + h + 1)}" r="1.1" fill="#f3ffb0" opacity=".85"/>'
    s += drip(128, 112, 22) + drip(160, 126, 12) + drip(304, 168, 28) + drip(74, 104, 16)
    # 벽과 통로 턱: 윗면은 밝고 앞면은 어둡다 (입체 상자)
    s += '<g filter="url(#tex)"><path d="M0 0H62C52 90 70 176 54 268V400H0Z" fill="url(#wallL)"/><path d="M400 0H342C352 74 336 150 350 252V400H400Z" fill="url(#wallR)"/></g>'
    s += '<path d="M62 0C52 90 70 176 54 268" stroke="#c4dc4e" stroke-opacity=".35" stroke-width="1.6" fill="none"/><path d="M342 0C352 74 336 150 350 252" stroke="#c4dc4e" stroke-opacity=".3" stroke-width="1.6" fill="none"/>'
    s += '<path d="M0 318L128 274L146 278L0 344Z" fill="url(#ledgeT)"/><path d="M0 344L146 278V292L0 372Z" fill="url(#ledgeF)"/><path d="M0 318L128 274" stroke="#d3e862" stroke-opacity=".6" stroke-width="1.2"/><path d="M0 344L146 278" stroke="#a9c23a" stroke-opacity=".4" stroke-width=".8"/>'
    s += '<path d="M400 306L272 270L254 274L400 332Z" fill="url(#ledgeT)"/><path d="M400 332L254 274V288L400 360Z" fill="url(#ledgeF)"/><path d="M400 306L272 270" stroke="#d3e862" stroke-opacity=".6" stroke-width="1.2"/>'
    # 물: 중앙 빛이 비쳐 밝고 가장자리가 어둡다
    s += '<path d="M0 286C80 280 150 292 200 288S330 280 400 290V400H0Z" fill="url(#wat)"/>'
    s += '<g filter="url(#b3)" opacity=".7"><path d="M150 292H250L300 400H100Z" fill="#e6f870" opacity=".4"/></g>'
    s += '<g filter="url(#b3)" opacity=".8"><path d="M18 322L128 280L130 296L18 344Z" fill="#000"/><path d="M382 310L272 276L270 292L382 332Z" fill="#000"/></g>'
    for i, y in enumerate((300, 318, 342, 372)):
        s += f'<path d="M0 {y}q{20 + i * 6} -{3 + i} {40 + i * 12} 0t{40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0 {40 + i * 12} 0" stroke="#e0f47e" stroke-opacity="{round(.45 - i * .08, 2)}" stroke-width="{round(.8 + i * .5, 1)}" fill="none"/>'
    s += '<rect y="392" width="400" height="8" fill="#000" opacity=".55"/>' + grain(.5)
    # ---- 움직이는 층
    fx = BUB
    drops = ''.join(f'<path d="M{x} 0c0-3 -2.4-5-2.4-6.6a2.4 2.4 0 0 1 4.8 0C{x + 2.4}-5 {x} -3 {x} 0z" fill="url(#goo)" opacity="0">{anim("opacity", "0;1;1;0", dd, b)}<animateTransform attributeName="transform" type="translate" values="0 {y0};0 {y1}" dur="{dd}s" begin="-{b}s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 1 .6" keyTimes="0;1"/></path>' for x, y0, y1, dd, b in [(128, 140, 296, 2.6, 0), (160, 138, 296, 3.1, 1.2), (304, 196, 300, 3.8, .6), (74, 124, 296, 2.9, 1.9), (226, 100, 296, 3.4, 2.4)])
    fx += drops
    for k, (px, py, dd) in enumerate([(128, 296, 2.6), (304, 300, 3.8), (74, 296, 2.9)]):
        fx += f'<ellipse cx="{px}" cy="{py}" rx="1" ry=".4" fill="none" stroke="#e8fa8c" stroke-width="1.1" opacity="0">{anim("rx", "1;16", dd, k)}{anim("ry", ".4;4.6", dd, k)}{anim("opacity", ".8;0", dd, k)}</ellipse>'
    for k, (x, y) in enumerate([(220, 306), (170, 326), (252, 350), (120, 362)]):
        fx += f'<path d="M{x - 14} {y}q14 -5 28 0" stroke="#f1ffa0" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0">{anim("opacity", "0;.75;0", 3 + k * .7, k)}{tform("translate", "0 0;0 3;0 0", 3 + k * .7, k)}</path>'
    fx += '<g>' + tform('translate', '0 0;0 3;0 0', 3.4) + '<ellipse cx="256" cy="304" rx="17" ry="8" fill="url(#deb)"/><path d="M243 301q13 6 26 0" stroke="#7a5a28" stroke-width="1.4" fill="none"/></g>'
    fx += '<g>' + tform('translate', '0 0;7 -2;0 0', 4.6) + '<path d="M130 312l16-7 12 6-7 7z" fill="url(#deb)"/></g>'
    fx += bubbles(40, 360, 396, 296, 9, 5, rmin=1.4, rmax=3.2)
    fx += glow('alg', 90, 316, 36, .25, .95).replace('/>', f'>{anim("opacity", ".4;1;.4", 3)}</circle>') + glow('alg', 316, 334, 44, .22, .9).replace('/>', f'>{anim("opacity", "1;.4;1", 3.6)}</circle>')
    fx += f'<g>{tform("translate", "0 0;60 -3;0 0", 16)}<ellipse cx="120" cy="290" rx="190" ry="20" fill="url(#mist)"/></g><g>{tform("translate", "0 0;-60 3;0 0", 13)}<ellipse cx="300" cy="278" rx="170" ry="16" fill="url(#mist)"/></g>'
    fx += f'<g>{glow("lt2", cx, cy + 6, 70, 1.0, .5)}{anim("opacity", ".5;1;.5", 4)}</g>'
    deb = rg('deb', [(0, '#6a4b24'), (.6, '#2b1d0b'), (1, '#0a0602')], .35, .3, .8)
    return svg(s, d), svg(fx, d + deb)


# ============================================================ 병원
def hospital():
    r = random.Random(31)
    vx, vy = 200, 196
    d = eased('lt', '#cfe8ff', .9) + eased('ex', '#ff4458', 1) + eased('flr', '#bfe0ff', .55)
    d += lin('ceil', [(0, '#02060b'), (1, '#16324c')]) + lin('flo', [(0, '#17344f'), (.4, '#0a1a2a'), (1, '#02060a')])
    d += lin('wl', [(0, '#030a12'), (.55, '#0b2036'), (1, '#1c4468')], 0, 0, 1, 0) + lin('wr', [(0, '#1c4468'), (.45, '#0b2036'), (1, '#030a12')], 0, 0, 1, 0)
    d += lin('panel', [(0, '#c8e6ff'), (1, '#9ac4ec')]) + lin('metal', [(0, '#06101a'), (.45, '#8ab4d8'), (1, '#0a1622')], 0, 0, 1, 0)
    d += lin('blood', [(0, '#8c1420'), (1, '#3a050a')], 0, 0, 1, 1) + rg('whl', [(0, '#a9c6de'), (.5, '#1c2a38'), (1, '#04080c')], .35, .3, .8)
    d += lin('bag', [(0, '#d8ecff', .55), (1, '#7fb4e6', .35)], 0, 0, 1, 0) + lin('sheet', [(0, '#a8b8c6'), (.6, '#dbe6ef'), (1, '#8498aa')], 0, 0, 1, 1)
    s = ''
    s += '<path d="M0 0H400L262 148H138Z" fill="url(#ceil)"/>'
    s += '<path d="M0 0L138 148V252L0 360Z" fill="url(#wl)"/><path d="M400 0L262 148V252L400 360Z" fill="url(#wr)"/>'
    s += '<path d="M138 252H262L400 360V400H0V360Z" fill="url(#flo)"/>'
    s += '<rect x="138" y="148" width="124" height="104" fill="#010306"/>'
    s += glow('lt', vx, vy + 4, 150, .7, .9)
    # 천장 형광등 패널 (원근)
    def quad(t0, t1, hw0, hw1):
        y0 = 0 + (vy - 48) * t0
        y1 = (vy - 48) * t1
        return y0, y1
    for (ya, yb, wa, wb, op) in [(10, 28, 96, 70, .95), (58, 70, 52, 40, .8), (88, 95, 28, 22, .65), (108, 112, 14, 11, .5)]:
        s += f'<path d="M{vx - wa} {ya}H{vx + wa}L{vx + wb} {yb}H{vx - wb}Z" fill="#eaf5ff" opacity="{op}"/><path d="M{vx - wa} {ya}H{vx + wa}" stroke="#fff" stroke-width="1.2"/>'
        s += f'<g filter="url(#b6)" opacity="{round(op * .55, 2)}"><path d="M{vx - wa} {yb}H{vx + wa}L{vx + wa * 1.5} {yb + 44}H{vx - wa * 1.5}Z" fill="#bfe0ff"/></g>'
    # 벽: 문, 손잡이 레일, 걸레받이. 소실점으로 모이도록 그린다.
    def wall(side):
        sg = -1 if side == 'L' else 1
        xo = (lambda t: 0 + 138 * t) if side == 'L' else (lambda t: 400 - 138 * t)
        o = ''
        # 문 (벽 위에서 구 간격으로 나란히)
        for t0, t1 in [(.04, .24), (.34, .5), (.58, .7), (.76, .84)]:
            xa, xb = xo(t0), xo(t1)
            ta, tb = (360 - 212 * t0), (360 - 212 * t1)  # 바닥선
            ha, hb = 168 * (1 - t0) + 22, 168 * (1 - t1) + 22
            top_a = 40 + (148 - 40) * t0 + 30 * (1 - t0) * 0
            top_a = 40 + 108 * t0 + 42 * (1 - t0) * .5
            top_b = 40 + 108 * t1 + 42 * (1 - t1) * .5
            bot_a = 360 - 108 * t0
            bot_b = 360 - 108 * t1
            door_top_a = top_a + 58 * (1 - t0) * .5 + 30 * (1 - t0)
            door_top_b = top_b + 58 * (1 - t1) * .5 + 30 * (1 - t1)
            o += f'<path d="M{n(xa)} {n(door_top_a)}L{n(xb)} {n(door_top_b)}V{n(bot_b)}L{n(xa)} {n(bot_a)}Z" fill="url(#panel)" opacity=".16"/>'
            o += f'<path d="M{n(xa)} {n(door_top_a)}L{n(xb)} {n(door_top_b)}V{n(bot_b)}L{n(xa)} {n(bot_a)}Z" fill="none" stroke="#bfe0ff" stroke-opacity=".5" stroke-width="1.2"/>'
            # 창
            wa0 = door_top_a + (bot_a - door_top_a) * .18
            wa1 = door_top_a + (bot_a - door_top_a) * .5
            wb0 = door_top_b + (bot_b - door_top_b) * .18
            wb1 = door_top_b + (bot_b - door_top_b) * .5
            m = lambda p, q, u: p + (q - p) * u
            xa2, xb2 = m(xa, xb, .3), m(xa, xb, .7)
            def lerp_y(ya, yb, u): return m(ya, yb, u)
            o += f'<path d="M{n(xa2)} {n(lerp_y(wa0, wb0, .3))}L{n(xb2)} {n(lerp_y(wa0, wb0, .7))}V{n(lerp_y(wa1, wb1, .7))}L{n(xa2)} {n(lerp_y(wa1, wb1, .3))}Z" fill="#9fd0ff" fill-opacity=".22" stroke="#d6ecff" stroke-opacity=".5" stroke-width=".8"/>'
            o += f'<path d="M{n(m(xa, xb, .5))} {n(lerp_y(wa0, wb0, .5))}V{n(lerp_y(wa1, wb1, .5))}" stroke="#d6ecff" stroke-opacity=".3" stroke-width=".6"/>'
        return o
    s += wall('L') + wall('R')
    # 손잡이 레일: 원통처럼 위 밝은 선과 아래 어두운 선
    s += '<path d="M0 232L138 206M400 232L262 206" stroke="#04101c" stroke-width="5"/><path d="M0 230L138 205M400 230L262 205" stroke="#cfe6ff" stroke-opacity=".6" stroke-width="1.4"/>'
    s += '<path d="M0 346L138 246M400 346L262 246" stroke="#020810" stroke-width="7"/><path d="M0 343L138 244M400 343L262 244" stroke="#9ac4ec" stroke-opacity=".28" stroke-width="1"/>'
    # 바닥: 타일 줄과 반사
    for k in range(-6, 7):
        s += f'<path d="M{vx + k * 12} 252L{vx + k * 74} 400" stroke="#9fd0ff" stroke-opacity=".12" stroke-width=".8"/>'
    for y in (264, 282, 308, 346, 396):
        s += f'<path d="M{vx - (y - 252) * .9 - 60 * 0} {y}H{vx + (y - 252) * .9}" stroke="#9fd0ff" stroke-opacity="{round(.1 + (y - 252) / 900, 2)}" stroke-width=".8"/>'
    s += '<g filter="url(#b6)" opacity=".5"><path d="M168 252H232L262 400H138Z" fill="#cfe8ff" opacity=".4"/></g>'
    # 핏자국 (유기적, 광택)
    s += '<g filter="url(#rough)"><path d="M168 400C172 360 196 336 190 304S206 270 222 262S232 280 214 300S242 350 250 400Z" fill="url(#blood)" opacity=".6"/></g><path d="M196 330C200 310 212 290 220 272" stroke="#ff8a96" stroke-opacity=".38" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
    # 막다른 문: 붉은 십자 표지
    s += '<rect x="170" y="150" width="60" height="22" rx="3" fill="#12050a" stroke="#40121a" stroke-width="1"/>' + glow('ex', 200, 161, 40, .6, .85)
    s += '<path d="M200 153V169M192 161H208" stroke="#ff7a88" stroke-width="3.6" stroke-linecap="round"/><path d="M200 153V169M192 161H208" stroke="#fff0f2" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".75"/>'
    s += '<path d="M174 252V176H226V252" fill="#030810" stroke="#17324c" stroke-width="1.2"/><path d="M200 176V252" stroke="#17324c" stroke-width="1"/>'
    # 간이침대 (오른쪽 앞)
    s += '<g>'
    s += '<path d="M240 392l112 -12 30 8-120 18z" fill="#000" opacity=".6" filter="url(#b3)"/>'
    s += '<path d="M252 366V346" stroke="url(#metal)" stroke-width="5"/><path d="M366 360V340" stroke="url(#metal)" stroke-width="5"/><path d="M252 348H366" stroke="url(#metal)" stroke-width="4"/>'
    s += '<path d="M244 330Q300 320 372 326L380 340Q310 346 250 348Z" fill="url(#sheet)"/><path d="M244 330Q300 320 372 326" stroke="#fff" stroke-opacity=".7" stroke-width="1" fill="none"/>'
    s += '<g filter="url(#rough)"><path d="M280 332q18 -8 40 -2t14 12q-30 6 -54 0z" fill="url(#blood)" opacity=".9"/></g>'
    s += '<circle cx="264" cy="376" r="9" fill="url(#whl)"/><circle cx="264" cy="376" r="3" fill="#cfe6ff" opacity=".6"/><circle cx="360" cy="372" r="9" fill="url(#whl)"/><circle cx="360" cy="372" r="3" fill="#cfe6ff" opacity=".6"/>'
    s += '</g>'
    # 링거 대
    s += '<path d="M70 392l4-218" stroke="#030a12" stroke-width="5" stroke-linecap="round"/><path d="M68.6 392l4-218" stroke="#cfe6ff" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/><path d="M72 174q16 -2 22 10" stroke="#030a12" stroke-width="3" fill="none"/>'
    s += '<path d="M74 394l-18 5M74 394l20 5" stroke="#030a12" stroke-width="3.4" stroke-linecap="round"/><path d="M90 186q-6 8 -2 24t4 24q10 -12 8 -26t-4 -22z" fill="url(#bag)" stroke="#cfe6ff" stroke-opacity=".6" stroke-width=".8"/><path d="M89 206q6 2 12 0v26q-6 8 -12 0z" fill="#b01c2c" opacity=".6"/>'
    s += '<rect width="400" height="400" fill="#000" opacity=".12"/>' + grain(.5)
    fx = BUB
    fx += f'<g>{tform("translate", "0 0;0 0", 1)}<g opacity="1">{anim("opacity", "1;.45;1;.7;.2;1", 3.2)}<path d="M{vx - 46} 162H{vx + 46}" stroke="#fff" stroke-width="0"/></g></g>'
    # 깜박이는 천장등과 비상등
    fx += f'<g>{anim("opacity", "1;.25;1;.6;1;1;.15;1", 3.6)}<path d="M{vx - 52} 56H{vx + 52}L{vx + 40} 70H{vx - 40}Z" fill="#fff" opacity=".35"/>{glow("lt", vx, 120, 90, .5, .5)}</g>'
    fx += f'<g>{anim("opacity", ".2;.9;.35;.9;.2", 2.2)}{glow("ex", 200, 161, 64, .7, .9)}</g>'
    # 먼지 입자
    for k in range(16):
        x = r.uniform(70, 330)
        y = r.uniform(120, 300)
        dd = r.uniform(6, 12)
        fx += f'<circle cx="{n(x)}" cy="{n(y)}" r="{n(r.uniform(.7, 1.6))}" fill="#dff0ff" opacity="0">{anim("opacity", "0;.55;0", dd, k)}{tform("translate", f"0 0;{n(r.uniform(-14, 14))} {n(r.uniform(-14, 8))}", dd, k)}</circle>'
    # 링거 방울
    fx += f'<ellipse cx="96" cy="236" rx="1.4" ry="2.4" fill="#cfe8ff" opacity="0">{anim("opacity", "0;1;0", 1.8)}{tform("translate", "0 0;0 54", 1.8)}</ellipse>'
    fx += f'<g>{tform("rotate", "-1.4 70 176;1.4 70 176;-1.4 70 176", 5)}<path d="M90 186q-6 8 -2 24t4 24q10 -12 8 -26t-4 -22z" fill="none" stroke="#fff" stroke-opacity=".0"/></g>'
    return svg(s, d), svg(fx, d)


# ============================================================ 도살장
def slaughter():
    r = random.Random(41)
    d = eased('lamp', '#ffd2c0', .95) + eased('red', '#ff3a44', .55) + eased('steam', '#ffd6d0', .35)
    d += lin('wall', [(0, '#1b0607'), (.6, '#3e0d12'), (1, '#240609')])
    d += lin('tileg', [(0, '#7e2229'), (.5, '#4d1219'), (1, '#340b10')], 0, 0, 1, 1)
    d += lin('floor', [(0, '#3a0d12'), (.35, '#1b0507'), (1, '#050102')]) + lin('beam', [(0, '#8f979f'), (.25, '#3b4147'), (1, '#0a0b0d')])
    d += lin('trail', [(0, '#b3141f', .95), (.85, '#7a0c14', .8), (1, '#7a0c14', 0)], 0, 0, 0, 1) + rg('pool', [(0, '#8a0f18'), (.7, '#4a070c'), (1, '#1a0204')], .5, .35, .65)
    d += lin('wood', [(0, '#5a3a22'), (.5, '#3a2314'), (1, '#1f1209')], 0, 0, 1, 0) + lin('steel', [(0, '#f1f4f8'), (.45, '#9aa3ad'), (1, '#2a2f35')], 0, 0, 0, 1)
    d += lin('cone', [(0, '#ffd8c8', .55), (1, '#ffd8c8', 0)])
    d += f'<pattern id="tiles" width="30" height="20" patternUnits="userSpaceOnUse"><rect width="30" height="20" fill="#1a0507"/><rect x="1" y="1" width="28" height="18" rx="1.6" fill="url(#tileg)"/><path d="M2 2.4H27.6" stroke="#ff9a96" stroke-opacity=".34" stroke-width="1"/><path d="M2.4 2V18" stroke="#ff9a96" stroke-opacity=".2" stroke-width="1"/><path d="M2 18.6H28" stroke="#000" stroke-opacity=".5" stroke-width="1"/><path d="M5 6l8-1" stroke="#ffd0cc" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round"/></pattern>'
    s = '<rect y="0" width="400" height="236" fill="url(#wall)"/><g filter="url(#tex)"><rect y="26" width="400" height="214" fill="url(#tiles)"/></g>'
    s += glow('red', 200, 60, 230, .8, .85)
    # 벽에 말라붙은 핏자국과 흘러내린 줄
    s += '<g filter="url(#rough)" opacity=".85"><path d="M40 70c20-14 40 0 36 18s-24 22-40 12-8-22 4-30z" fill="#5a0a10"/><path d="M290 96c22-12 46 4 40 22s-30 18-44 6-4-20 4-28z" fill="#4a070c"/><path d="M150 140c16-8 30 2 26 14s-22 14-30 6z" fill="#5a0a10"/></g>'
    for x, h, w in [(54, 88, 4.4), (66, 52, 3), (310, 110, 5), (322, 64, 3.2), (166, 70, 3.6), (240, 94, 3.8), (96, 44, 2.6)]:
        y0 = 80
        s += f'<path d="M{x - w / 2} {y0}H{x + w / 2}L{x + w / 2 - .4} {y0 + h}H{x - w / 2 + .4}Z" fill="url(#trail)"/><circle cx="{x}" cy="{y0 + h + 1}" r="{n(w * .9)}" fill="#c3202c" opacity=".9"/><circle cx="{n(x - w * .25)}" cy="{n(y0 + h - .4)}" r="{n(w * .28)}" fill="#ffc2c2" opacity=".6"/>'
    # 천장 레일 (I빔)
    s += '<rect y="14" width="400" height="16" fill="url(#beam)"/><rect y="14" width="400" height="2" fill="#d6dce2" opacity=".6"/><rect y="28" width="400" height="2.4" fill="#000" opacity=".6"/>'
    s += ''.join(f'<circle cx="{x}" cy="22" r="1.6" fill="#c9cfd5" opacity=".7"/>' for x in range(14, 400, 28))
    # 조명 (매달린 갓등)과 빛 원뿔
    s += '<g filter="url(#b6)"><path d="M176 40L224 40L330 250L70 250Z" fill="url(#cone)" opacity=".5"/></g>'
    s += '<path d="M200 30V46" stroke="#150506" stroke-width="2"/><path d="M178 58Q200 34 222 58Z" fill="url(#steel)"/><path d="M178 58H222" stroke="#000" stroke-opacity=".5" stroke-width="1.4"/><path d="M184 52Q200 38 216 52" stroke="#fff" stroke-opacity=".8" stroke-width="1" fill="none"/>' + glow('lamp', 200, 62, 38, .6, .95)
    # 바닥: 젖은 타일 원근선, 중앙 배수구, 피웅덩이와 광택
    s += '<path d="M0 236H400V400H0Z" fill="url(#floor)"/>'
    for k in range(-8, 9):
        s += f'<path d="M{200 + k * 14} 236L{200 + k * 62} 400" stroke="#ff7a7a" stroke-opacity=".08" stroke-width=".8"/>'
    for y in (248, 266, 292, 330, 380):
        s += f'<path d="M0 {y}H400" stroke="#ff7a7a" stroke-opacity="{round(.06 + (y - 236) / 1400, 2)}" stroke-width=".8"/>'
    s += '<g filter="url(#rough)"><path d="M70 330C70 300 140 290 200 300S330 296 338 332S260 372 190 366S72 360 70 330Z" fill="url(#pool)"/></g>'
    s += '<path d="M104 322C130 312 168 310 214 314" stroke="#ffb0b0" stroke-opacity=".42" stroke-width="2.4" fill="none" stroke-linecap="round" filter="url(#b1)"/><path d="M236 322C262 316 292 318 312 326" stroke="#ffb0b0" stroke-opacity=".3" stroke-width="1.6" fill="none" stroke-linecap="round" filter="url(#b1)"/>'
    s += '<path d="M170 262h60l8 16h-76z" fill="#0b0204"/><path d="M174 268h52M172 272h56" stroke="#4a4f55" stroke-width="1.4"/><path d="M178 262l-4 16M192 262l-2 16M208 262l2 16M222 262l4 16" stroke="#8d949b" stroke-opacity=".5" stroke-width=".8"/>'
    # 도마와 식칼 (오른쪽 앞): 나무 윗면은 밝고 옆면은 어둡다
    s += '<path d="M268 396l92-8 24 12-100 10z" fill="#000" opacity=".6" filter="url(#b3)"/>'
    s += '<g filter="url(#tex)"><path d="M274 330H368V392H274Z" fill="url(#wood)"/><path d="M262 330L274 316H380L368 330Z" fill="#7a5232"/></g><path d="M274 330H368" stroke="#d6a574" stroke-opacity=".5" stroke-width="1"/>'
    s += '<path d="M290 330L340 262L352 270L312 332Z" fill="url(#steel)"/><path d="M290 330L340 262" stroke="#fff" stroke-opacity=".85" stroke-width="1.2"/><path d="M340 262L356 250L360 258L352 270Z" fill="#2a1a10"/><path d="M296 328L336 268" stroke="#b01c28" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>'
    s += '<g filter="url(#rough)"><path d="M300 320c14-6 34-4 44 4s-16 12-30 10-18-4-14-14z" fill="#7a0c14" opacity=".9"/></g>'
    # 앞쪽 스테인리스 탁자 다리
    s += '<rect y="394" width="400" height="6" fill="#000" opacity=".6"/>' + grain(.5)
    # ---- 움직이는 층: 갈고리에 매달린 고기
    d2 = lin('meat', [(0, '#c0485a'), (.45, '#7a1424'), (1, '#2a050a')], 0, 0, 1, 1) + lin('fat', [(0, '#f1dcd0'), (1, '#d4a898')], 0, 0, 1, 1) + rg('sheen', [(0, '#ffd0d4', .85), (1, '#ffd0d4', 0)])
    fx = ''
    for i, x in enumerate(range(36, 400, 66)):
        drop = (i % 3) * 10
        sw = f'<g>{tform("rotate", f"-3.2 {x} 30;3.2 {x} 30;-3.2 {x} 30", 3.2 + i * .4, i * .7)}'
        ch = f'<path d="M{x} 30V{58 + drop}" stroke="#a9afb6" stroke-width="3" stroke-dasharray="3.4 1.6" stroke-linecap="round" fill="none"/><path d="M{x - 1} 30V{58 + drop}" stroke="#fff" stroke-opacity=".5" stroke-width=".8" stroke-dasharray="1 4" fill="none"/>'
        hk = f'<path d="M{x} {58 + drop}v10a8 8 0 1 1 -9 8" stroke="#d6dbe0" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M{x - .8} {58 + drop}v10a8 8 0 0 0 -3 3" stroke="#fff" stroke-opacity=".6" stroke-width=".8" fill="none"/>'
        if i % 2 == 0:
            cy0 = 100 + drop
            body = (f'<path d="M{x - 17} {cy0 - 10}C{x - 22} {cy0 + 12} {x - 14} {cy0 + 44} {x} {cy0 + 52}C{x + 14} {cy0 + 44} {x + 22} {cy0 + 12} {x + 17} {cy0 - 10}C{x + 8} {cy0 - 18} {x - 8} {cy0 - 18} {x - 17} {cy0 - 10}Z" fill="url(#meat)"/>'
                    f'<path d="M{x - 6} {cy0 - 8}Q{x - 11} {cy0 + 14} {x - 4} {cy0 + 40}M{x + 7} {cy0 - 6}Q{x + 12} {cy0 + 16} {x + 5} {cy0 + 38}" stroke="url(#fat)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".85"/>'
                    f'<path d="M{x - 11} {cy0 + 2}q11 4 22 0M{x - 10} {cy0 + 14}q10 4 20 0M{x - 8} {cy0 + 26}q8 3 16 0" stroke="#2a050a" stroke-opacity=".6" stroke-width="1.2" fill="none"/>'
                    f'<ellipse cx="{x + 7}" cy="{cy0 + 6}" rx="3.6" ry="13" fill="url(#sheen)" transform="rotate(8 {x + 7} {cy0 + 6})"/>')
            sw += ch + hk + body
        else:
            sw += ch + hk
        fx += sw + '</g>'
    fx += ''.join(f'<ellipse cx="{x}" cy="40" rx="1.8" ry="3.2" fill="#c3202c" opacity="0">{anim("opacity", "0;1;1;0", dd, b)}<animateTransform attributeName="transform" type="translate" values="0 0;0 {240 - 40}" dur="{dd}s" begin="-{b}s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 1 .6" keyTimes="0;1"/></ellipse>' for x, dd, b in [(104, 2.8, 0), (214, 3.4, 1), (330, 3.1, 2), (60, 3.9, 1.4)])
    fx += f'<g opacity=".9"><g>{tform("translate", "0 0;0 -26", 5)}{anim("opacity", "0;.6;0", 5)}<path d="M120 300q-14 -22 0 -42t-4 -34" stroke="#ffd6d0" stroke-width="10" fill="none" stroke-linecap="round" opacity=".18"/></g><g>{tform("translate", "0 0;0 -30", 6.4, 2)}{anim("opacity", "0;.5;0", 6.4, 2)}<path d="M286 304q-12 -22 2 -40t-4 -30" stroke="#ffd6d0" stroke-width="12" fill="none" stroke-linecap="round" opacity=".16"/></g></g>'
    fx += f'<g>{anim("opacity", ".7;1;.7;.85;1", 2.6)}{glow("lamp", 200, 62, 56, .7, .55)}</g>'
    fx += f'<ellipse cx="190" cy="334" rx="2" ry="1" fill="none" stroke="#ff9a9a" stroke-width="1" opacity="0">{anim("rx", "2;22", 2.8)}{anim("ry", "1;6", 2.8)}{anim("opacity", ".7;0", 2.8)}</ellipse>'
    return svg(s, d), svg(fx, d + d2)


# ============================================================ 실험실
def lab():
    r = random.Random(51)
    d = eased('pg', '#c9a0ff', .6) + eased('gg', '#7dffb0', .8) + eased('fl', '#c9a0ff', .55) + eased('yg', '#ffe27a', .9) + eased('mist', '#e6dcff', .25)
    d += lin('wall', [(0, '#0d0719'), (.6, '#1c0f33'), (1, '#0a0614')]) + lin('floor', [(0, '#2a1650'), (.35, '#120a26'), (1, '#05020c')])
    d += lin('glass', [(0, '#d8ffe8', .55), (.12, '#d8ffe8', .12), (.5, '#7dffb0', .06), (.88, '#d8ffe8', .14), (1, '#d8ffe8', .5)], 0, 0, 1, 0)
    d += lin('liq', [(0, '#a8ffcf', .72), (.4, '#3fd488', .62), (1, '#0f6a40', .85)])
    d += lin('cyl', [(0, '#0a0614'), (.2, '#4a3a72'), (.42, '#cdbdf0'), (.6, '#6b5aa0'), (1, '#0a0614')], 0, 0, 1, 0)
    d += lin('capT', [(0, '#e0d4ff'), (1, '#5a4a88')], 0, 0, 0, 1) + rg('disc', [(0, '#3a2a62'), (.7, '#1a1030'), (1, '#07030f')], .5, .4, .7)
    d += lin('coil', [(0, '#6b5aa0'), (.5, '#f0e6ff'), (1, '#3a2a62')], 0, 0, 1, 0) + lin('hz', [(0, '#ffd23c'), (1, '#8a6a00')], 0, 0, 1, 1)
    d += rg('spec', [(0, '#a8ffcf'), (.6, '#1a5a3a'), (1, '#05160d')], .4, .3, .8) + lin('con', [(0, '#3a2a62'), (1, '#0d0719')])
    d += f'<pattern id="panels" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="url(#wall)"/><rect x="2" y="2" width="36" height="36" rx="2" fill="#1b1032"/><path d="M2.4 2.8H37.6" stroke="#b79cff" stroke-opacity=".35" stroke-width="1"/><path d="M2.8 2.4V37.6" stroke="#b79cff" stroke-opacity=".18" stroke-width="1"/><path d="M2 37.6H38" stroke="#000" stroke-opacity=".6" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" fill="#cbb6ff" opacity=".6"/><circle cx="34" cy="6" r="1.5" fill="#cbb6ff" opacity=".6"/><circle cx="6" cy="34" r="1.5" fill="#cbb6ff" opacity=".5"/><circle cx="34" cy="34" r="1.5" fill="#cbb6ff" opacity=".5"/></pattern>'
    s = '<g filter="url(#tex)"><rect y="0" width="400" height="262" fill="url(#panels)"/></g>'
    s += glow('pg', 200, 190, 200, .85, .95)
    s += '<path d="M0 262H400V400H0Z" fill="url(#floor)"/>'
    for k in range(-9, 10):
        s += f'<path d="M{200 + k * 14} 262L{200 + k * 70} 400" stroke="#b79cff" stroke-opacity=".14" stroke-width=".8"/>'
    for y in (272, 288, 314, 352, 398):
        s += f'<path d="M0 {y}H400" stroke="#b79cff" stroke-opacity="{round(.08 + (y - 262) / 1000, 2)}" stroke-width=".8"/>'
    # 바닥에 번지는 탱크 반사
    s += '<g filter="url(#b6)"><path d="M168 270H232L262 400H138Z" fill="#7dffb0" opacity=".22"/></g>' + glow('fl', 200, 286, 120, .22, .8)
    # 경고 줄무늬 단
    s += '<path d="M104 292H296L316 318H84Z" fill="url(#disc)"/>' + ''.join(f'<path d="M{96 + i * 16} 318l8 -26h8l-8 26z" fill="url(#hz)" opacity=".85"/>' for i in range(13)).replace('<path d="M96', '<path d="M96') + '<path d="M84 318H316V328H84Z" fill="#05020c"/><path d="M84 318H316" stroke="#cbb6ff" stroke-opacity=".6" stroke-width="1"/>'
    s += '<path d="M104 292H296" stroke="#cbb6ff" stroke-opacity=".5" stroke-width="1"/>'
    # 중앙 원통 탱크 (아래·위 타원 마개와 유리 하이라이트)
    s += '<ellipse cx="200" cy="292" rx="70" ry="13" fill="#04010a"/>'
    s += '<path d="M134 290V132H266V290A66 13 0 0 1 134 290Z" fill="url(#liq)"/><path d="M134 290V132H266V290A66 13 0 0 1 134 290Z" fill="url(#glass)"/>'
    s += '<ellipse cx="200" cy="146" rx="66" ry="11" fill="#a8ffcf" opacity=".55"/><ellipse cx="200" cy="146" rx="66" ry="11" fill="none" stroke="#e6fff0" stroke-opacity=".8" stroke-width="1.2"/>'
    s += '<path d="M146 150V280" stroke="#fff" stroke-opacity=".5" stroke-width="3.4" stroke-linecap="round"/><path d="M154 156V230" stroke="#fff" stroke-opacity=".25" stroke-width="1.4" stroke-linecap="round"/><path d="M254 156V270" stroke="#e6fff0" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/>'
    s += '<path d="M134 132Q134 120 200 120Q266 120 266 132" fill="url(#cyl)"/><ellipse cx="200" cy="132" rx="66" ry="11" fill="url(#capT)"/><ellipse cx="200" cy="130" rx="54" ry="8" fill="#1a1030" opacity=".7"/>'
    s += '<path d="M128 292V132M272 292V132" stroke="url(#cyl)" stroke-width="6"/><path d="M122 276H278V292A78 15 0 0 1 122 292Z" fill="url(#cyl)"/><ellipse cx="200" cy="276" rx="78" ry="14" fill="url(#capT)" opacity=".9"/><ellipse cx="200" cy="276" rx="70" ry="11" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>'
    s += ''.join(f'<circle cx="{n(200 + math.cos(a) * 72)}" cy="{n(284 + math.sin(a) * 12)}" r="2" fill="#efe6ff"/>' for a in [i * math.pi / 5 + .3 for i in range(6)])
    # 천장으로 올라가는 굵은 배관 (원통 하이라이트)
    s += '<rect x="186" y="0" width="28" height="122" fill="url(#cyl)"/><rect x="180" y="40" width="40" height="10" fill="url(#cyl)"/><rect x="180" y="86" width="40" height="8" fill="url(#cyl)"/><path d="M193 0V120" stroke="#fff" stroke-opacity=".5" stroke-width="1.4"/>'
    # 양옆 소형 캡슐 (같은 원통 방식)
    def pod(x, y0, y1, w, seed):
        cxp = x + w / 2
        o = f'<ellipse cx="{n(cxp)}" cy="{y1}" rx="{w / 2 + 4}" ry="6" fill="#000" opacity=".6" filter="url(#b3)"/>'
        o += f'<path d="M{x} {y0}V{y1}A{w / 2} 8 0 0 0 {x + w} {y1}V{y0}Z" fill="url(#liq)"/><path d="M{x} {y0}V{y1}A{w / 2} 8 0 0 0 {x + w} {y1}V{y0}Z" fill="url(#glass)"/>'
        o += f'<ellipse cx="{n(cxp)}" cy="{y0}" rx="{n(w / 2)}" ry="7" fill="#c8ffe0" opacity=".5" stroke="#e6fff0" stroke-opacity=".8" stroke-width=".9"/>'
        o += f'<rect x="{x - 3}" y="{y0 - 10}" width="{w + 6}" height="12" rx="3" fill="url(#cyl)"/><rect x="{x - 3}" y="{y1 - 6}" width="{w + 6}" height="14" rx="3" fill="url(#cyl)"/>'
        o += f'<path d="M{x + 5} {y0 + 10}V{y1 - 12}" stroke="#fff" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"/>'
        return o
    s += pod(24, 150, 286, 46, 1) + pod(330, 166, 286, 46, 2)
    # 케이블 (중력에 처진 곡선, 외피 입체)
    def cable(p):
        return f'<path d="{p}" stroke="#04010a" stroke-width="7" fill="none" stroke-linecap="round"/><path d="{p}" stroke="#2a1d4a" stroke-width="4.6" fill="none" stroke-linecap="round"/><path d="{p}" stroke="#8c76c8" stroke-opacity=".6" stroke-width="1.2" fill="none" stroke-linecap="round" transform="translate(-1 -1.2)"/>'
    s += cable('M70 -4C74 70 120 74 140 124') + cable('M330 -4C326 60 280 78 262 120') + cable('M40 -4C40 40 60 60 40 100')
    # 테슬라 코일: 원환 쌓기와 나선, 윗구는 밝은 구체
    def coil(x, base):
        o = f'<ellipse cx="{x}" cy="{base + 4}" rx="30" ry="6" fill="#000" opacity=".6" filter="url(#b3)"/>'
        o += f'<path d="M{x - 18} {base}L{x - 9} {base - 104}H{x + 9}L{x + 18} {base}Z" fill="url(#cyl)"/>'
        for k in range(7):
            yy = base - 12 - k * 14
            wd = 17 - k * 1.3
            o += f'<path d="M{n(x - wd)} {yy}Q{x} {yy + 6} {n(x + wd)} {yy}" stroke="url(#coil)" stroke-width="3.2" fill="none" stroke-linecap="round"/>'
        o += f'<ellipse cx="{x}" cy="{base - 110}" rx="25" ry="8" fill="url(#cyl)"/><ellipse cx="{x}" cy="{base - 112}" rx="25" ry="6" fill="url(#capT)"/>'
        o += f'<path d="M{x - 24} {base - 8}H{x + 24}V{base + 6}H{x - 24}Z" fill="url(#cyl)"/>'
        return o
    s += coil(80, 360) + coil(320, 360)
    # 앞쪽 콘솔
    s += '<path d="M-4 398L40 360H150L120 398Z" fill="url(#con)"/><path d="M40 360H150" stroke="#cbb6ff" stroke-opacity=".6" stroke-width="1"/><path d="M404 398L360 360H250L280 398Z" fill="url(#con)"/><path d="M360 360H250" stroke="#cbb6ff" stroke-opacity=".6" stroke-width="1"/>'
    s += '<path d="M56 358l10 -22h72l8 22z" fill="#06110b" stroke="#7dffb0" stroke-opacity=".5" stroke-width="1"/><path d="M62 352l8 -14h62l6 14z" fill="#7dffb0" opacity=".16"/><path d="M248 358l8 -22h72l10 22z" fill="#0a0614" stroke="#c9a0ff" stroke-opacity=".5" stroke-width="1"/>'
    s += '<rect width="400" height="400" fill="#000" opacity=".1"/>' + grain(.5)
    # ---- 움직이는 층
    d2 = BUB + lin('spm', [(0, '#0a3a22'), (1, '#04140b')], 0, 0, 0, 1)
    fx = bubbles(150, 250, 280, 150, 12, 9, rmin=1.4, rmax=4.2) + bubbles(32, 64, 282, 162, 6, 3) + bubbles(338, 366, 282, 178, 6, 4)
    spec = (f'<g>{tform("rotate", "-5 200 270;5 200 270;-5 200 270", 6)}'
            '<path d="M200 272c-24-8-30-34-16-52 8-10 4-26-6-34 22 4 40 26 34 52-3 12 4 22 12 30-8 6-14 6-24 4z" fill="url(#spec)" opacity=".92"/>'
            '<path d="M182 196c-10-4-20 2-24 10M214 190c10-6 24-2 28 8M200 240c-6 12-18 18-28 14" stroke="#0a3a22" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>'
            '<circle cx="190" cy="192" r="3.2" fill="#fff"/><circle cx="206" cy="188" r="3.2" fill="#fff"/><circle cx="190.8" cy="191.4" r="1.2" fill="#1a8a50"/><circle cx="206.8" cy="187.4" r="1.2" fill="#1a8a50"/>'
            '</g>')
    fx += spec
    cab = lambda p, col, dur, b: f'<path d="{p}" stroke="{col}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-dasharray="5 18" opacity=".95"><animate attributeName="stroke-dashoffset" values="0;-92" dur="{dur}s" begin="-{b}s" repeatCount="indefinite"/></path>'
    fx += cab('M70 -4C74 70 120 74 140 124', '#7dffb0', 2.6, 0) + cab('M330 -4C326 60 280 78 262 120', '#c9a0ff', 3.1, 1) + cab('M40 -4C40 40 60 60 40 100', '#ffe27a', 2.2, .6)

    def arc(x1, y1, x2, y2, seed, dur, b):
        rr = random.Random(seed)
        pts = [(x1, y1)]
        for i in range(1, 7):
            t = i / 7
            pts.append((x1 + (x2 - x1) * t + rr.uniform(-12, 12), y1 + (y2 - y1) * t + rr.uniform(-10, 10)))
        pts.append((x2, y2))
        dd = 'M' + ' '.join(f'{n(x)} {n(y)}' for x, y in pts)
        op = anim('opacity', '0;1;.2;.9;0;0;0', dur, b)
        return f'<path d="{dd}" stroke="#fff6b0" stroke-width="6" fill="none" stroke-linejoin="round" opacity="0" stroke-opacity=".3">{op}</path><path d="{dd}" stroke="#fff8c8" stroke-width="2" fill="none" stroke-linejoin="round" opacity="0">{op}</path>'
    for (cxk, cyk, tg) in [(80, 250, [(30, 190), (140, 210), (96, 170)]), (320, 250, [(270, 200), (372, 210), (310, 170)])]:
        fx += glow('yg', cxk, cyk, 34, 1.0, .9).replace('/>', f'>{anim("opacity", ".5;1;.5", 1.4)}</circle>')
        for k, (tx, ty) in enumerate(tg):
            fx += arc(cxk, cyk, tx, ty, int(cxk) + k, 1.3 + k * .3, k * .5)
    for k, (x, y) in enumerate([(70, 342), (92, 346), (262, 338), (284, 344), (306, 340)]):
        col = ['#ff5a5a', '#7dffb0', '#ffe27a'][k % 3]
        fx += f'<circle cx="{x}" cy="{y}" r="2" fill="{col}">{anim("opacity", "1;.15;1", 1.2 + k * .35, k * .3)}</circle>' + glow('yg', x, y, 7, 1.0, .5).replace('url(#yg)', f'url(#lg{k % 3})')
    d2 += eased('lg0', '#ff5a5a', .9) + eased('lg1', '#7dffb0', .9) + eased('lg2', '#ffe27a', .9)
    fx += f'<g>{tform("translate", "0 0;40 -4;0 0", 14)}<ellipse cx="120" cy="296" rx="180" ry="16" fill="url(#mist)"/></g><g>{tform("translate", "0 0;-40 3;0 0", 11)}<ellipse cx="290" cy="304" rx="170" ry="14" fill="url(#mist)"/></g>'
    fx += f'<g>{anim("opacity", ".55;1;.55", 5)}{glow("gg", 200, 210, 120, 1.0, .35)}</g>'
    d2 += eased('gg', '#7dffb0', .8) + eased('yg', '#ffe27a', .9) + eased('mist', '#e6dcff', .25)
    return svg(s, d), svg(fx, d2)


# ============================================================ 공통 틀: 천장 종유석, 양옆 암벽, 포자
def frame():
    r = random.Random(61)
    d = lin('rk', [(0, '#050a07'), (.6, '#0f2118'), (1, '#2c5a44')], 0, 0, 1, 0) + lin('rkr', [(0, '#2c5a44'), (.4, '#0f2118'), (1, '#050a07')], 0, 0, 1, 0)
    d += lin('cl', [(0, '#010302'), (.7, '#07110c'), (1, '#1c3a2c')])
    top = 'M0 0H400V' + n(10)
    xs = [400, 384, 372, 356, 338, 322, 300, 282, 262, 238, 218, 196, 172, 150, 130, 106, 86, 64, 44, 24, 8, 0]
    pts = ''
    for i, x in enumerate(xs[:-1]):
        y = r.choice((30, 44, 62, 84, 104, 118)) if i % 2 else r.choice((8, 12, 18))
        pts += f'L{x} {y}'
    p = top + pts + 'L0 20Z'
    ceil = f'<g filter="url(#tex)"><path d="{p}" fill="url(#cl)"/></g><path d="{p}" fill="none" stroke="#7fc29a" stroke-opacity=".28" stroke-width="1.2"/>'
    # 종유석 끝의 물방울 반짝임
    ceil += ''.join(f'<circle cx="{xs[i]}" cy="{n(float(re.findall("L" + str(xs[i]) + " ([0-9.]+)", pts)[0]) + 1)}" r="1.4" fill="#cfffe0" opacity=".7"/>' for i in range(1, len(xs) - 1, 2) if re.findall('L' + str(xs[i]) + ' ([0-9.]+)', pts))
    ceiling = svg(ceil, d, w=400, h=140, par='none')

    def wall(side):
        o = []
        y = 0
        pts = []
        while y < 400:
            pts.append((y, r.uniform(26, 52)))
            y += r.uniform(30, 64)
        pts.append((400, 38))
        if side == 'l':
            p = 'M0 0H' + n(pts[0][1]) + ''.join(f'L{n(w)} {n(yy)}' for yy, w in pts[1:]) + 'V400H0Z'
            fill = 'rk'
            rim = '#7fc29a'
        else:
            p = 'M100 0H' + n(100 - pts[0][1]) + ''.join(f'L{n(100 - w)} {n(yy)}' for yy, w in pts[1:]) + 'V400H100Z'
            fill = 'rkr'
            rim = '#7fc29a'
        edge = p.split('V400')[0]
        return svg(f'<g filter="url(#tex)"><path d="{p}" fill="url(#{fill})"/></g><path d="{edge[edge.index("H") + 1:] if False else edge}" fill="none" stroke="{rim}" stroke-opacity=".3" stroke-width="1.2" stroke-linejoin="round"/>', d, w=100, h=400, par='none')
    # 포자: 불규칙한 위치, 크기, 속도. 천천히 떠오르며 깜박인다.
    sp = ''
    for k in range(22):
        x = r.uniform(0, 400)
        y0 = r.uniform(300, 620)
        dd = r.uniform(14, 30)
        b = r.uniform(0, dd)
        rad = r.uniform(.9, 3.0)
        sp += f'<circle cx="{n(x)}" cy="{n(y0)}" r="{n(rad)}" fill="url(#sporeg)" opacity="0">{anim("cy", f"{n(y0)};{n(y0 - 420)}", dd, b)}{anim("opacity", "0;.9;.5;.9;0", dd, b)}{anim("cx", f"{n(x)};{n(x + r.uniform(-22, 22))};{n(x)}", dd, b)}</circle>'
    spores = svg(sp, eased('sporeg', '#d6ffbe', 1), w=400, h=600, par='xMidYMid slice')
    return ceiling, wall('l'), wall('r'), spores


# ============================================================ 문 칸의 돌벽 (벽돌 하나하나에 모서리 빛과 그림자)
def door_wall():
    d = lin('bg', [(0, '#5a615c'), (.45, '#363c38'), (1, '#1d211f')], 0, 0, 1, 1)
    rr = random.Random(71)
    s = '<rect width="200" height="140" fill="#0b0d0c"/><g filter="url(#tex)">'
    for row in range(7):
        y = row * 22
        off = 0 if row % 2 == 0 else -22
        for k in range(-1, 6):
            x = off + k * 44
            sh = rr.uniform(-.1, .1)
            s += f'<rect x="{x + 1.4}" y="{y + 1.4}" width="41.2" height="19.2" rx="2.2" fill="url(#bg)" opacity="{round(.82 + sh, 2)}"/>'
    s += '</g>'
    for row in range(7):
        y = row * 22
        off = 0 if row % 2 == 0 else -22
        for k in range(-1, 6):
            x = off + k * 44
            s += f'<path d="M{x + 3} {y + 2.4}H{x + 41}" stroke="#aeb5af" stroke-opacity=".45" stroke-width="1"/><path d="M{x + 2.4} {y + 3}V{y + 19}" stroke="#aeb5af" stroke-opacity=".25" stroke-width="1"/><path d="M{x + 3} {y + 20.4}H{x + 42}" stroke="#000" stroke-opacity=".7" stroke-width="1.4"/>'
    # 이끼와 물때가 모서리에서 번져 내려온다
    s += '<g filter="url(#b3)" opacity=".7"><path d="M0 0H52Q40 24 46 44T26 70Q8 60 0 40Z" fill="#2c5a36"/><path d="M200 0H150Q162 28 154 48T178 76Q196 62 200 44Z" fill="#2c5a36"/></g>'
    s += '<path d="M0 0H200V16H0Z" fill="#000" opacity=".4" filter="url(#b6)"/>' + grain(.5).replace('width="400" height="400"', 'width="200" height="140"')
    return svg(s, d, w=200, h=140, par='xMidYMid slice')


SKY = {
    'graveyard': 'linear-gradient(180deg,#06120c 0%,#0f2c1d 50%,#1c4a32 100%)',
    'sewer': 'linear-gradient(180deg,#070a02 0%,#1a2307 50%,#38490f 100%)',
    'hospital': 'linear-gradient(180deg,#030911 0%,#0e2338 50%,#1b3f64 100%)',
    'slaughter': 'linear-gradient(180deg,#100304 0%,#380d11 50%,#681a20 100%)',
    'lab': 'linear-gradient(180deg,#08030e 0%,#27144a 50%,#43237a 100%)',
}

if __name__ == '__main__':
    out = '/* 자동 생성: python3 tools/zombie-scenes.py (원본은 그 스크립트) */\n:root {\n'
    for k, fn in (('graveyard', graveyard), ('sewer', sewer), ('hospital', hospital), ('slaughter', slaughter), ('lab', lab)):
        sc, fx = fn()
        out += f'  --zc-scene-{k}: {uri(sc)};\n  --zc-fx-{k}: {uri(fx)};\n  --zc-sky-{k}: {SKY[k]};\n'
    ceiling, wl, wr, spores = frame()
    out += f'  --zc-ceiling: {uri(ceiling)};\n  --zc-wall-l: {uri(wl)};\n  --zc-wall-r: {uri(wr)};\n  --zc-spores: {uri(spores)};\n  --zc-door-wall: {uri(door_wall())};\n}}\n'
    OUT.write_text(out)
    print(len(out), 'bytes ->', OUT)
