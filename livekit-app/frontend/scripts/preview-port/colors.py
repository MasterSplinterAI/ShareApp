"""sRGB <-> OKLCH helpers and the Studio Green -> Lalia Blue/Slate mapping."""
import math, re

def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _gam(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def rgb_to_oklch(r, g, b):
    r, g, b = _lin(r / 255), _lin(g / 255), _lin(b / 255)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    C = math.hypot(a, bb)
    H = math.degrees(math.atan2(bb, a)) % 360
    return L, C, H

def oklch_to_rgb_float(L, C, H):
    a = C * math.cos(math.radians(H)); b = C * math.sin(math.radians(H))
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return [_gam(x) if x > 0 else x for x in (r, g, bl)]

def oklch_to_rgb(L, C, H):
    lo, hi = 0.0, C
    rgb = oklch_to_rgb_float(L, C, H)
    if any(x < -1e-4 or x > 1 + 1e-4 for x in rgb):
        for _ in range(30):
            mid = (lo + hi) / 2
            t = oklch_to_rgb_float(L, mid, H)
            if any(x < 0 or x > 1 for x in t):
                hi = mid
            else:
                lo = mid
        rgb = oklch_to_rgb_float(L, lo, H)
    return tuple(max(0, min(255, round(x * 255))) for x in rgb)

MIN_CHROMA = 0.004

def is_greenish(r, g, b):
    L, C, H = rgb_to_oklch(r, g, b)
    return C >= MIN_CHROMA and 75 <= H <= 210

SLATE_HUE = 258.0
BLUE_HUE = 259.0

def to_blue(r, g, b):
    """Studio Green -> Lalia Slate/Blue. Neutral greens become slate; accents become brand blue."""
    L, C, H = rgb_to_oklch(r, g, b)
    if not (C >= MIN_CHROMA and 75 <= H <= 210):
        return (r, g, b)
    if C < 0.055:
        # Tinted neutrals (paper, ink, borders, muted text) -> slate.
        return oklch_to_rgb(L, min(max(C * 1.25, 0.008), 0.06), SLATE_HUE)
    # Accents (mint, lime, teal) -> Lalia blue. Very light accents are pulled down a touch so
    # they keep presence on dark slate instead of washing out to near-white.
    h = BLUE_HUE + (H - 145) * 0.12
    if L > 0.8:
        L = 0.8 + (L - 0.8) * 0.45
    return oklch_to_rgb(L, C * 1.1, h)

HEX_RE = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b')
RGB_RE = re.compile(r'rgba?\(\s*([0-9.]+%?)[\s,]+([0-9.]+%?)[\s,]+([0-9.]+%?)\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)')
OKLCH_RE = re.compile(r'oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*(?:/\s*([0-9.]+%?)\s*)?\)')

def parse_hex(h):
    s = h[1:]
    if len(s) in (3, 4):
        s = ''.join(c * 2 for c in s)
    r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    a = int(s[6:8], 16) / 255 if len(s) == 8 else None
    return r, g, b, a

def _num(v, scale=255):
    return float(v[:-1]) / 100 * scale if v.endswith('%') else float(v)

def fmt_hex(r, g, b, a=None):
    s = '#%02x%02x%02x' % (r, g, b)
    if a is not None:
        s += '%02x' % round(a * 255)
    return s
