"""Faithful static port of the Lalia Journal WordPress build into public/preview/*.

Copies the original DOM, CSS, JS and graphics verbatim. The only transformations are:
  * URL rewrites (WordPress host -> /preview/*), WP/Elementor runtime scripts removed;
  * every green colour literal routed through a CSS custom property so a palette switch
    (Lalia Blue default, Original Green) works on the exact same stylesheet;
  * a preview bar + noindex meta injected; a third article added from partials/.

Usage: ./fetch.sh && python3 port.py   (writes ../../public/preview)
"""
import hashlib, json, os, re, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from colors import (HEX_RE, RGB_RE, OKLCH_RE, parse_hex, _num, rgb_to_oklch, oklch_to_rgb,
                    is_greenish, to_blue, fmt_hex, MIN_CHROMA)

SRC = os.environ.get('LALIA_JOURNAL_SRC', os.path.join(HERE, '.cache'))
A = SRC + '/assets'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(HERE, '../../public/preview'))
ASSETS = OUT + '/assets'
PARTIALS = os.path.join(HERE, 'partials')
W = 'https://wordpress-1672957-6746326.cloudwaysapps.com'
WJ = W.replace('/', '\\/')
LIVE = 'https://lalia.cloud'

PALETTE = {}  # var name -> (green literal, blue literal)
JS_MAP = {}

def var_for(r, g, b, a, original):
    name = '--lp-%02x%02x%02x' % (r, g, b) + ('' if a is None else '-a%d' % round(a * 100))
    br, bg, bb = to_blue(r, g, b)
    if a is None:
        blue = fmt_hex(br, bg, bb)
    else:
        blue = 'rgba(%d,%d,%d,%s)' % (br, bg, bb, ('%.3f' % a).rstrip('0').rstrip('.') or '0')
    PALETTE.setdefault(name, (original, blue))
    return name, blue

def recolor_value(text):
    """Replace greenish colour literals inside CSS text with var(--lp-*, original)."""
    def sub_hex(m):
        r, g, b, a = parse_hex(m.group(0))
        if not is_greenish(r, g, b):
            return m.group(0)
        name, _ = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, m.group(0))
    def sub_rgb(m):
        r, g, b = (_num(m.group(i)) for i in (1, 2, 3))
        a = _num(m.group(4), 1) if m.group(4) else None
        r, g, b = round(r), round(g), round(b)
        if not is_greenish(r, g, b):
            return m.group(0)
        name, _ = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, m.group(0))
    def sub_oklch(m):
        L = _num(m.group(1), 1) if m.group(1).endswith('%') else float(m.group(1))
        C, H = float(m.group(2)), float(m.group(3))
        a = _num(m.group(4), 1) if m.group(4) else None
        if not (C >= MIN_CHROMA and 75 <= H <= 210):
            return m.group(0)
        r, g, b = oklch_to_rgb(L, C, H)
        name, _ = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, m.group(0))
    text = OKLCH_RE.sub(sub_oklch, text)
    text = RGB_RE.sub(sub_rgb, text)
    text = HEX_RE.sub(sub_hex, text)
    return text

def recolor_css(css):
    masks = []
    def mask(m):
        masks.append(m.group(0))
        return '\x00%d\x00' % (len(masks) - 1)
    css = re.sub(r'@property[^{]*\{[^}]*\}', mask, css)
    css = re.sub(r'@supports[^{]*', mask, css)
    css = recolor_value(css)
    return re.sub(r'\x00(\d+)\x00', lambda m: masks[int(m.group(1))], css)

def sha(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:10]

# ---------------------------------------------------------------- assets
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(ASSETS + '/images'); os.makedirs(ASSETS + '/fonts'); os.makedirs(ASSETS + '/vendor')

CSS_FILES = {
    # original URL fragment -> local file name
    '/wp-content/plugins/lalia-elementor/assets/app.css': ('app.css', A + '/app.css'),
    '/wp-content/plugins/lalia-elementor/assets/blog.css': ('blog.css', A + '/blog.css'),
    '/wp-content/plugins/lalia-elementor/assets/reference.css': ('reference.css', A + '/reference.css'),
    '/wp-content/plugins/lalia-elementor/assets/reference-layout.css': ('reference-layout.css', A + '/reference-layout.css'),
    '/wp-content/plugins/lalia-elementor/assets/elementor.css': ('elementor.css', A + '/elementor.css'),
    '/wp-content/plugins/elementor/assets/css/frontend.min.css': ('vendor/elementor-frontend.min.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-content__plugins__elementor__assets__css__frontend.min.css'),
    '/wp-content/uploads/elementor/css/post-6.css': ('vendor/elementor-post-6.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-content__uploads__elementor__css__post-6.css'),
    '/wp-content/uploads/elementor/css/post-14.css': ('vendor/elementor-post-14.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-content__uploads__elementor__css__post-14.css'),
    '/wp-content/uploads/elementor/css/base-desktop.css': ('vendor/elementor-base-desktop.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-content__uploads__elementor__css__base-desktop.css'),
    '/wp-content/uploads/elementor/css/base-mobile.css': ('vendor/elementor-base-mobile.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-content__uploads__elementor__css__base-mobile.css'),
    '/wp-includes/css/dist/block-library/style.min.css': ('vendor/wp-block-library.min.css', A + '/wordpress-1672957-6746326.cloudwaysapps.com__wp-includes__css__dist__block-library__style.min.css'),
}
for frag, (name, src) in CSS_FILES.items():
    open(ASSETS + '/' + name, 'w').write(recolor_css(open(src).read()))

shutil.copy(A + '/images__kenny.jpg', ASSETS + '/images/kenny.jpg')
shutil.copy(A + '/images__maria.jpg', ASSETS + '/images/maria.jpg')
shutil.copy(A + '/fonts/manrope.woff2', ASSETS + '/fonts/manrope.woff2')
shutil.copy(A + '/fonts/dm-sans.woff2', ASSETS + '/fonts/dm-sans.woff2')
shutil.copy(A + '/globe-points.json', ASSETS + '/globe-points.json')
shutil.copy(A + '/favicon.svg', ASSETS + '/favicon.svg')
shutil.copy(A + '/social-card.png', ASSETS + '/social-card.png')

# Globe canvas colours: route literals through LP() so the palette switch recolours live.
js = open(A + '/elementor.js').read()
def js_color(m):
    lit = m.group(1)
    hm = HEX_RE.fullmatch(lit); rm = RGB_RE.fullmatch(lit)
    if hm:
        r, g, b, a = parse_hex(lit)
    elif rm:
        r, g, b = (round(_num(rm.group(i))) for i in (1, 2, 3))
        a = _num(rm.group(4), 1) if rm.group(4) else None
    else:
        return m.group(0)
    if not is_greenish(r, g, b):
        return m.group(0)
    br, bg, bb = to_blue(r, g, b)
    JS_MAP[lit] = fmt_hex(br, bg, bb) if a is None else 'rgba(%d,%d,%d,%s)' % (br, bg, bb, rm.group(4) if rm else a)
    return 'LP("%s")' % lit
js = re.sub(r'"(#[0-9a-fA-F]{3,8}|rgba?\([^"]*\))"', js_color, js)
open(ASSETS + '/elementor.js', 'w').write(js)

for name in ('preview.css', 'preview.js'):
    shutil.copy(os.path.join(PARTIALS, name), ASSETS + '/' + name)

# ---------------------------------------------------------------- pages
SLUG1, SLUG2, SLUG3 = ('meetings-without-translators', 'multilingual-meetings-made-easy-with-lalia',
                       'interpreter-or-live-ai-translation')

def route_for(path):
    path = path.strip('/')
    if path == '':
        return '/preview/home'
    if path == 'blog':
        return '/preview/blog'
    return '/preview/blog/' + path

KEEP_INLINE = ('lalia-theme', 'lazyloadRunObserver', 'LALIA_ASSETS')

def transform(html, page):
    # scripts
    def script(m):
        attrs, body = m.group(1), m.group(2)
        if 'lalia-elementor/assets/elementor.js' in attrs:
            return '<script defer src="/preview/assets/elementor.js?v=%s"></script>' % sha(ASSETS + '/elementor.js')
        if 'src=' not in attrs and 'application/ld+json' not in attrs and any(k in body for k in KEEP_INLINE):
            return m.group(0)
        if 'application/ld+json' in attrs:
            return m.group(0)
        return ''
    html = re.sub(r'<script([^>]*)>(.*?)</script>\s*', script, html, flags=re.S)

    # head links
    def link(m):
        tag = m.group(0)
        if "rel='stylesheet'" in tag or 'rel="stylesheet"' in tag:
            if 'fonts.googleapis' in tag:
                return ''
            for frag, (name, _) in CSS_FILES.items():
                if frag in tag:
                    href = '/preview/assets/%s?v=%s' % (name, sha(ASSETS + '/' + name))
                    return re.sub(r"href=['\"][^'\"]+['\"]", 'href="%s"' % href, tag)
            raise SystemExit('unmapped stylesheet: ' + tag)
        if 'rel="icon"' in tag:
            return '<link rel="icon" href="/preview/assets/favicon.svg" type="image/svg+xml" />'
        return ''
    html = re.sub(r'<link[^>]+>\s*', link, html)
    html = re.sub(r'<meta name="generator"[^>]*>\s*', '', html)
    html = re.sub(r"<meta name='robots'[^>]*>\s*", '', html)

    # inline style blocks + style attributes + SVG presentation colours
    html = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + recolor_css(m.group(2)) + m.group(3), html, flags=re.S)
    html = re.sub(r'style="([^"]*)"', lambda m: 'style="%s"' % recolor_value(m.group(1)), html)
    def svg_attr(m):
        tag = m.group(0)
        styles = []
        def pull(am):
            prop, val = am.group(1), am.group(2)
            new = recolor_value(val)
            if new == val:
                return am.group(0)
            styles.append('%s:%s' % (prop, new))
            return ''
        tag2 = re.sub(r'\s(fill|stroke|stop-color)="([^"]+)"', pull, tag)
        if not styles:
            return tag
        if 'style="' in tag2:
            return tag2.replace('style="', 'style="%s;' % ';'.join(styles), 1)
        return re.sub(r'^<([a-zA-Z]+)', lambda mm: '<%s style="%s"' % (mm.group(1), ';'.join(styles)), tag2)
    html = re.sub(r'<(?:stop|g|circle|path|ellipse|rect|line|polyline|polygon)\b[^>]*>', svg_attr, html)

    # URLs
    html = html.replace(W + '/wp-content/plugins/lalia-elementor/assets/', '/preview/assets/')
    html = html.replace(W + '/wp-content/uploads/2026/11/kenny.jpg', '/preview/assets/images/kenny.jpg')
    html = html.replace(WJ + '\\/wp-content\\/plugins\\/lalia-elementor\\/assets', '\\/preview\\/assets')
    for p in ('feed/', 'comments/feed/'):
        html = html.replace(W + '/' + p, '/preview/blog')
    for slug in (SLUG1, SLUG2):
        html = html.replace(W + '/%s/' % slug, '/preview/blog/' + slug)
        html = html.replace(WJ + '\\/%s\\/' % slug, LIVE.replace('/', '\\/') + '\\/preview\\/blog\\/' + slug)
    html = html.replace(W + '/blog/', '/preview/blog')
    html = html.replace('href="/blog/"', 'href="/preview/blog"')
    html = html.replace(W + '/#', '/preview/home#')
    html = html.replace('href="%s/"' % W, 'href="/preview/home"')
    html = html.replace(WJ + '\\/', LIVE.replace('/', '\\/') + '\\/preview\\/home')
    html = html.replace('/preview/assets/social-card.png', LIVE + '/preview/assets/social-card.png')

    # head: noindex + palette boot, preview css; body: preview bar
    boot = ('<meta name="robots" content="noindex, nofollow" />\n'
            '<script>(function(){var d=document.documentElement,p;try{p=new URLSearchParams(location.search).get("palette");'
            'if(p==="green"||p==="blue"){localStorage.setItem("lalia-preview-palette",p)}else{p=localStorage.getItem("lalia-preview-palette")}}catch(e){}'
            'd.dataset.palette=p==="green"?"green":"blue";'
            'var M=%s;window.LP=function(c){return d.dataset.palette==="blue"&&M[c]||c}})();</script>\n') % json.dumps(JS_MAP, separators=(',', ':'))
    html = re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + boot, html, count=1)
    tail = ('<link rel="stylesheet" href="/preview/assets/palette.css?v=%s" />\n'
            '<link rel="stylesheet" href="/preview/assets/preview.css?v=%s" />\n</head>') % (sha(ASSETS + '/palette.css'), sha(ASSETS + '/preview.css'))
    html = html.replace('</head>', tail, 1)
    bar = open(os.path.join(PARTIALS, 'preview-bar.html')).read().replace('{{PAGE}}', page)
    bar += '<script defer src="/preview/assets/preview.js?v=%s"></script>\n' % sha(ASSETS + '/preview.js')
    html = html.replace('</body>', bar + '</body>', 1)

    leftover = [m.start() for m in re.finditer('cloudwaysapps', html)]
    if leftover:
        raise SystemExit('%s: leftover WP URLs at %s: %s' % (page, leftover[:3], html[leftover[0]-120:leftover[0]+80]))
    return html

def write(route, html):
    d = OUT + route[len('/preview'):]
    os.makedirs(d, exist_ok=True)
    open(d + '/index.html', 'w').write(html)

# Palette CSS first: pages hash it. Populate PALETTE by processing everything once.
pages_src = {
    '/preview/home': open(SRC + '/home.html').read(),
    '/preview/blog': open(SRC + '/blog.html').read(),
    '/preview/blog/' + SLUG1: open(SRC + '/%s.html' % SLUG1).read(),
    '/preview/blog/' + SLUG2: open(SRC + '/%s.html' % SLUG2).read(),
}

# Third article: built on post 1's exact document, with new main content + meta.
a3 = pages_src['/preview/blog/' + SLUG1]
a3_main = open(os.path.join(PARTIALS, 'article3-main.html')).read()
A3_TITLE = 'Interpreter or live translation? Choose by the meeting.'
A3_DESC = 'Some conversations need a professional interpreter. Many don\u2019t. Here is a simple way to tell the difference.'
a3 = re.sub(r'<main id="journal-main">.*?</main>', lambda m: a3_main.strip(), a3, flags=re.S)
a3 = re.sub(r'<title>.*?</title>', '<title>%s | Lalia Journal</title>' % A3_TITLE, a3)
a3 = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m.group(1) + A3_DESC, a3)
a3 = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + A3_TITLE + ' | Lalia Journal', a3)
a3 = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m.group(1) + A3_DESC, a3)
a3 = re.sub(r'<link rel="canonical"[^>]*>', '', a3)
a3 = a3.replace('postid-48', 'postid-60')
ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": A3_TITLE, "description": A3_DESC,
      "datePublished": "2026-11-08T15:00:00+00:00", "dateModified": "2026-11-08T15:00:00+00:00",
      "mainEntityOfPage": LIVE + "/preview/blog/" + SLUG3,
      "author": {"@type": "Organization", "name": "Lalia", "url": LIVE + "/"},
      "publisher": {"@type": "Organization", "name": "Lalia", "url": LIVE + "/"}}
a3 = re.sub(r'<script type="application/ld\+json">.*?</script>',
            lambda m: '<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False), a3, flags=re.S)
pages_src['/preview/blog/' + SLUG3] = a3

# Blog index: add the third story card after the featured story.
card = open(os.path.join(PARTIALS, 'article3-card.html')).read().strip()
blog = pages_src['/preview/blog']
marker = '<article class="journal-story ">'
assert marker in blog, 'story marker missing'
pages_src['/preview/blog'] = blog.replace(marker, card + ' ' + marker, 1)

# Dry-run pass to collect every palette variable (including inline/SVG ones), then write palette.css.
for route, html in pages_src.items():
    open(ASSETS + '/palette.css', 'w').write('')
    transform(html, route)

def palette_css():
    green = ''.join('%s:%s;' % (k, v[0]) for k, v in sorted(PALETTE.items()))
    blue = ''.join('%s:%s;' % (k, v[1]) for k, v in sorted(PALETTE.items()))
    return ('/* Generated: Original Studio Green values (fallbacks) and the Lalia Blue/Slate mapping. */\n'
            ':root{%s}\nhtml[data-palette="blue"]{%s}\n' % (green, blue))
open(ASSETS + '/palette.css', 'w').write(palette_css())

for route, html in pages_src.items():
    write(route, transform(html, route))

print('palette vars:', len(PALETTE), 'js colours:', len(JS_MAP))
for k, v in sorted(PALETTE.items()):
    print(' ', k, v[0], '->', v[1])
