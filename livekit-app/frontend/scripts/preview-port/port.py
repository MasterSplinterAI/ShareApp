"""Faithful static port of the Lalia Journal WordPress build into live home & blog routes.

Copies the original DOM, CSS, JS and graphics verbatim. Transformations:
  * URL rewrites (WordPress host -> /, /blog, /studio-assets/*), WP/Elementor runtime scripts removed;
  * every green colour literal routed through a CSS custom property locked to Lalia Blue
    (data-lp-theme="lalia" and data-palette="blue");
  * preview switcher bar and floating theme toggle pill removed;
  * noindex robots tags removed and proper canonicals added;
  * Capacitor / native shell & authenticated session handling wired cleanly;
  * home page interactive demo wired to play real production TTS audio (/assets/demo-voices/*.mp3);
  * blog index and articles served at /blog and /blog/<slug>.

Usage: python3 port.py   (writes ../../public/studio-home.html, ../../public/blog/**, ../../public/studio-assets/**)
"""
import hashlib, json, os, re, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from colors import (HEX_RE, RGB_RE, OKLCH_RE, parse_hex, _num, rgb_to_oklch, oklch_to_rgb,
                    is_greenish, to_blue, fmt_hex, MIN_CHROMA)

SRC = os.environ.get('LALIA_JOURNAL_SRC', os.path.join(HERE, '.cache'))
A = SRC + '/assets'
PUBLIC_DIR = os.path.normpath(os.path.join(HERE, '../../public'))
ASSETS = os.path.join(PUBLIC_DIR, 'studio-assets')
BLOG_DIR = os.path.join(PUBLIC_DIR, 'blog')
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
    """Replace greenish colour literals inside CSS text with var(--lp-*, blue_default)."""
    def sub_hex(m):
        r, g, b, a = parse_hex(m.group(0))
        if not is_greenish(r, g, b):
            return m.group(0)
        name, blue = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, blue)
    def sub_rgb(m):
        r, g, b = (_num(m.group(i)) for i in (1, 2, 3))
        a = _num(m.group(4), 1) if m.group(4) else None
        r, g, b = round(r), round(g), round(b)
        if not is_greenish(r, g, b):
            return m.group(0)
        name, blue = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, blue)
    def sub_oklch(m):
        L = _num(m.group(1), 1) if m.group(1).endswith('%') else float(m.group(1))
        C, H = float(m.group(2)), float(m.group(3))
        a = _num(m.group(4), 1) if m.group(4) else None
        if not (C >= MIN_CHROMA and 75 <= H <= 210):
            return m.group(0)
        r, g, b = oklch_to_rgb(L, C, H)
        name, blue = var_for(r, g, b, a, m.group(0))
        return 'var(%s,%s)' % (name, blue)
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

# Remove legacy public/preview if present
legacy_preview = os.path.join(PUBLIC_DIR, 'preview')
if os.path.isdir(legacy_preview):
    shutil.rmtree(legacy_preview)

# ---------------------------------------------------------------- assets
if os.path.isdir(ASSETS):
    shutil.rmtree(ASSETS)
if os.path.isdir(BLOG_DIR):
    shutil.rmtree(BLOG_DIR)
os.makedirs(ASSETS + '/images', exist_ok=True)
os.makedirs(ASSETS + '/fonts', exist_ok=True)
os.makedirs(ASSETS + '/vendor', exist_ok=True)
os.makedirs(BLOG_DIR, exist_ok=True)

CSS_FILES = {
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

NAV_SIGNIN_CSS = """
.nav-signin{color:#afbbb1;font-size:11px;font-weight:500;text-decoration:none;transition:color .2s;white-space:nowrap}
.nav-signin:hover{color:var(--mint)}
[data-theme="light"] .lalia-journal .nav-signin{color:var(--muted)}
[data-theme="light"] .lalia-journal .nav-signin:hover{color:var(--mint)}
@media (max-width:680px){.nav-signin{display:none}}
.button-audio{position:relative;overflow:hidden}
.button-audio .audio-progress{position:absolute;left:0;bottom:0;height:2px;width:0%;background:currentColor;opacity:.45;transition:width .08s linear;pointer-events:none}
"""

for frag, (name, src) in CSS_FILES.items():
    content = recolor_css(open(src).read())
    if name == 'app.css':
        content += '\n' + recolor_css(NAV_SIGNIN_CSS)
    open(ASSETS + '/' + name, 'w').write(content)

shutil.copy(A + '/images__kenny.jpg', ASSETS + '/images/kenny.jpg')
shutil.copy(A + '/images__maria.jpg', ASSETS + '/images/maria.jpg')
shutil.copy(A + '/fonts/manrope.woff2', ASSETS + '/fonts/manrope.woff2')
shutil.copy(A + '/fonts/dm-sans.woff2', ASSETS + '/fonts/dm-sans.woff2')
shutil.copy(A + '/globe-points.json', ASSETS + '/globe-points.json')
shutil.copy(A + '/favicon.svg', ASSETS + '/favicon.svg')
shutil.copy(A + '/social-card.png', ASSETS + '/social-card.png')

# Globe canvas colours + production TTS audio player in elementor.js
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

# Replace translations map and conversation-preview handler with real TTS audio playback + waveform sync
OLD_TRANSLATIONS_AND_PREVIEW = """    const translations = {
        es: { name: 'Spanish', native: 'Español', phrase: '¡Hola! Qué alegría conocerte por fin.', lang: 'es-ES', source: 'Me alegro también. Hagamos algo increíble juntos.' },
        ja: { name: 'Japanese', native: '日本語', phrase: 'こんにちは！やっとお会いできてうれしいです。', lang: 'ja-JP', source: '私もです。一緒に素晴らしいものを作りましょう。' },
        fr: { name: 'French', native: 'Français', phrase: 'Bonjour ! Quel plaisir de vous rencontrer enfin.', lang: 'fr-FR', source: "C'est réciproque. Créons quelque chose de formidable ensemble." },
        pt: { name: 'Portuguese', native: 'Português', phrase: 'Olá! Que bom finalmente conhecer você.', lang: 'pt-BR', source: 'Digo o mesmo. Vamos criar algo incrível juntos.' }
    };"""

NEW_TRANSLATIONS = """    const translations = {
        es: { name: 'Spanish', native: 'Español', phrase: '¡Hola! Qué alegría conocerte por fin.', lang: 'es-ES', audio: '/assets/demo-voices/es.mp3', voiceLabel: 'Deepgram Aura-2 · Celeste (ES)', source: 'Me alegro también. Hagamos algo increíble juntos.' },
        ja: { name: 'Japanese', native: '日本語', phrase: 'こんにちは！やっとお会いできてうれしいです。', lang: 'ja-JP', audio: '/assets/demo-voices/ja.mp3', voiceLabel: 'Deepgram Aura-2 · Izanami (JA)', source: '私もです。一緒に素晴らしいものを作りましょう。' },
        fr: { name: 'French', native: 'Français', phrase: 'Bonjour ! Quel plaisir de vous rencontrer enfin.', lang: 'fr-FR', audio: '/assets/demo-voices/fr.mp3', voiceLabel: 'Deepgram Aura-2 · Agathe (FR)', source: "C'est réciproque. Créons quelque chose de formidable ensemble." },
        pt: { name: 'Portuguese', native: 'Português', phrase: 'Olá! Que bom finalmente conhecer você.', lang: 'pt-BR', audio: '/assets/demo-voices/pt.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (PT)', source: 'Digo o mesmo. Vamos criar algo incrível juntos.' },
        de: { name: 'German', native: 'Deutsch', phrase: 'Hallo! Wie schön, dich endlich kennenzulernen.', lang: 'de-DE', audio: '/assets/demo-voices/de.mp3', voiceLabel: 'Deepgram Aura-2 · Julius (DE)', source: 'Ganz meinerseits. Lass uns gemeinsam etwas Großartiges schaffen.' },
        it: { name: 'Italian', native: 'Italiano', phrase: 'Ciao! Che piacere incontrarti finalmente.', lang: 'it-IT', audio: '/assets/demo-voices/it.mp3', voiceLabel: 'Deepgram Aura-2 · Livia (IT)', source: 'Il piacere è mio. Creiamo qualcosa di straordinario insieme.' },
        nl: { name: 'Dutch', native: 'Nederlands', phrase: 'Hallo! Wat fijn om je eindelijk te ontmoeten.', lang: 'nl-NL', audio: '/assets/demo-voices/nl.mp3', voiceLabel: 'Deepgram Aura-2 · Daphne (NL)', source: 'Insgelijks. Laten we samen iets geweldigs bouwen.' },
        zh: { name: 'Mandarin Chinese', native: '中文', phrase: '你好！很高兴终于见到你。', lang: 'zh-CN', audio: '/assets/demo-voices/zh.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (ZH)', source: '我也是。让我们一起创造精彩。' },
        ko: { name: 'Korean', native: '한국어', phrase: '안녕하세요! 드디어 만나 뵙게 되어 정말 반갑습니다.', lang: 'ko-KR', audio: '/assets/demo-voices/ko.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (KO)', source: '저도 반갑습니다. 함께 멋진 일을 만들어 봅시다.' },
        ar: { name: 'Arabic', native: 'العربية', phrase: 'مرحباً! يسعدني جداً لقاؤك أخيراً.', lang: 'ar-SA', audio: '/assets/demo-voices/ar.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (AR)', source: 'الشعور متبادل. لنصنع شيئاً رائعاً معاً.' },
        hi: { name: 'Hindi', native: 'हिन्दी', phrase: 'नमस्ते! आपसे आखिरकार मिलकर बहुत खुशी हुई।', lang: 'hi-IN', audio: '/assets/demo-voices/hi.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (HI)', source: 'मुझे भी बहुत खुशी हुई। आइए मिलकर कुछ शानदार बनाएं।' },
        ru: { name: 'Russian', native: 'Русский', phrase: 'Привет! Как здорово наконец-то познакомиться.', lang: 'ru-RU', audio: '/assets/demo-voices/ru.mp3', voiceLabel: 'OpenAI gpt-4o-mini-tts · Marin (RU)', source: 'Взаимно. Давайте создадим что-то невероятное вместе.' }
    };"""

assert OLD_TRANSLATIONS_AND_PREVIEW in js, "OLD_TRANSLATIONS_AND_PREVIEW not found"
js = js.replace(OLD_TRANSLATIONS_AND_PREVIEW, NEW_TRANSLATIONS, 1)

OLD_PREVIEW_BLOCK = """        scope.querySelectorAll('.conversation-preview').forEach(preview => {
            if (initialized.has(preview))
                return;
            initialized.add(preview);
            const select = preview.querySelector('select'), button = preview.querySelector('.button-audio'), notice = preview.querySelector('.voice-notice');
            let playing = false;
            const stop = () => { playing = false; button.classList.remove('is-playing'); const wave = button.querySelector('.wave'); wave?.classList.remove('wave-active'); };
            select.addEventListener('change', () => {
                if ('speechSynthesis' in window)
                    window.speechSynthesis.cancel();
                stop();
                notice.textContent = '';
                const t = translations[select.value];
                preview.querySelector('.video-language').textContent = t.native;
                const caption = preview.querySelector('.video-caption');
                caption.textContent = '“' + t.source + '”';
                caption.lang = t.lang;
                const phrase = preview.querySelector('.translated-message p');
                phrase.textContent = t.phrase;
                phrase.lang = t.lang;
                const label = preview.querySelector('.translated-message>span');
                label.lastChild.textContent = ' LALIA TRANSLATES TO ' + t.name.toUpperCase();
                preview.querySelector('.reply-message .speaker-line small').textContent = t.name;
            });
            button.addEventListener('click', () => {
                if (!('speechSynthesis' in window)) {
                    notice.textContent = 'Audio preview is unavailable in this browser. Read the sample above or open the live demo.';
                    return;
                }
                window.speechSynthesis.cancel();
                if (playing) {
                    stop();
                    return;
                }
                const phrase = preview.querySelector('.translated-message p'), t = translations[select.value], utterance = new SpeechSynthesisUtterance(phrase.textContent);
                utterance.lang = t.lang;
                utterance.rate = .88;
                const voices = window.speechSynthesis.getVoices(), voice = voices.find(v => v.lang.toLowerCase().startsWith(select.value));
                if (voices.length && !voice) {
                    notice.textContent = 'A ' + t.name + ' voice is not installed in this browser. Try another language or open the live demo.';
                    return;
                }
                if (voice)
                    utterance.voice = voice;
                utterance.onend = stop;
                utterance.onerror = e => { stop(); if (!['canceled', 'interrupted'].includes(e.error))
                    notice.textContent = 'Your browser could not play this voice. Try another language or open the live demo.'; };
                playing = true;
                notice.textContent = '';
                button.classList.add('is-playing');
                button.querySelector('.wave')?.classList.add('wave-active');
                window.speechSynthesis.speak(utterance);
            });
        });"""

NEW_PREVIEW_BLOCK = """        scope.querySelectorAll('.conversation-preview').forEach(preview => {
            if (initialized.has(preview))
                return;
            initialized.add(preview);
            const select = preview.querySelector('select'), button = preview.querySelector('.button-audio'), notice = preview.querySelector('.voice-notice');
            let progressBar = button.querySelector('.audio-progress');
            if (!progressBar) {
                progressBar = document.createElement('span');
                progressBar.className = 'audio-progress';
                progressBar.setAttribute('aria-hidden', 'true');
                button.appendChild(progressBar);
            }
            const waveBars = [...(button.querySelectorAll('.wave i') || [])];
            const baseHeights = waveBars.map(el => parseFloat(el.style.height) || 16);
            let playing = false;
            let activeAudio = null;
            let rafId = 0;

            const stopSync = () => {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                if (progressBar) progressBar.style.width = '0%';
                waveBars.forEach((bar, idx) => { bar.style.height = baseHeights[idx] + 'px'; });
            };

            const stop = () => {
                playing = false;
                if (activeAudio) {
                    try {
                        activeAudio.pause();
                        activeAudio.currentTime = 0;
                    } catch {}
                    activeAudio = null;
                }
                if ('speechSynthesis' in window) {
                    try { window.speechSynthesis.cancel(); } catch {}
                }
                stopSync();
                button.classList.remove('is-playing');
                button.setAttribute('aria-pressed', 'false');
                const wave = button.querySelector('.wave');
                wave?.classList.remove('wave-active');
            };

            const syncWaveform = () => {
                if (!playing || !activeAudio) return;
                const dur = activeAudio.duration || 0;
                const cur = activeAudio.currentTime || 0;
                if (dur > 0 && progressBar) {
                    const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
                    progressBar.style.width = pct.toFixed(1) + '%';
                }
                const tNow = performance.now() * 0.012;
                waveBars.forEach((bar, idx) => {
                    const mod = 0.55 + 0.65 * Math.abs(Math.sin(tNow + idx * 0.65));
                    const h = Math.max(5, Math.min(34, Math.round(baseHeights[idx] * mod)));
                    bar.style.height = h + 'px';
                });
                rafId = requestAnimationFrame(syncWaveform);
            };

            const fallbackSpeechSynthesis = (t, text) => {
                if (!('speechSynthesis' in window)) {
                    stop();
                    notice.textContent = 'Audio preview is unavailable in this browser. Read the sample above or open the live demo.';
                    return;
                }
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = t.lang;
                utterance.rate = 0.92;
                const voices = window.speechSynthesis.getVoices();
                const voice = voices.find(v => v.lang.toLowerCase().startsWith(select.value));
                if (voice) utterance.voice = voice;
                utterance.onend = stop;
                utterance.onerror = e => {
                    stop();
                    if (!['canceled', 'interrupted'].includes(e.error)) {
                        notice.textContent = 'Could not play this voice sample. Try another language or open the live demo.';
                    }
                };
                playing = true;
                button.classList.add('is-playing');
                button.setAttribute('aria-pressed', 'true');
                button.querySelector('.wave')?.classList.add('wave-active');
                window.speechSynthesis.speak(utterance);
            };

            select.addEventListener('change', () => {
                stop();
                notice.textContent = '';
                const t = translations[select.value] || translations.es;
                preview.querySelector('.video-language').textContent = t.native;
                const caption = preview.querySelector('.video-caption');
                caption.textContent = '“' + t.source + '”';
                caption.lang = t.lang;
                const phrase = preview.querySelector('.translated-message p');
                phrase.textContent = t.phrase;
                phrase.lang = t.lang;
                const label = preview.querySelector('.translated-message>span');
                label.lastChild.textContent = ' LALIA TRANSLATES TO ' + t.name.toUpperCase();
                preview.querySelector('.reply-message .speaker-line small').textContent = t.name;
            });

            button.addEventListener('click', () => {
                if (playing) {
                    stop();
                    return;
                }
                const phrase = preview.querySelector('.translated-message p');
                const t = translations[select.value] || translations.es;
                notice.textContent = '';
                if (t.audio) {
                    const audio = new Audio(t.audio);
                    audio.preload = 'auto';
                    activeAudio = audio;
                    playing = true;
                    button.classList.add('is-playing');
                    button.setAttribute('aria-pressed', 'true');
                    button.querySelector('.wave')?.classList.add('wave-active');
                    audio.addEventListener('play', () => {
                        if (rafId) cancelAnimationFrame(rafId);
                        rafId = requestAnimationFrame(syncWaveform);
                    });
                    audio.addEventListener('ended', stop);
                    audio.addEventListener('error', () => {
                        activeAudio = null;
                        fallbackSpeechSynthesis(t, phrase.textContent);
                    });
                    const playPromise = audio.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {
                            activeAudio = null;
                            fallbackSpeechSynthesis(t, phrase.textContent);
                        });
                    }
                } else {
                    fallbackSpeechSynthesis(t, phrase.textContent);
                }
            });
        });"""

assert OLD_PREVIEW_BLOCK in js, "OLD_PREVIEW_BLOCK not found"
js = js.replace(OLD_PREVIEW_BLOCK, NEW_PREVIEW_BLOCK, 1)

# Also include .nav-signin in mobile menu links
js = js.replace(
    "[...header.querySelectorAll('.desktop-nav a'), header.querySelector('.nav-demo')]",
    "[...header.querySelectorAll('.desktop-nav a'), header.querySelector('.nav-signin'), header.querySelector('.nav-demo')]"
)

# Add auth-state CTA upgrade so logged-in web users see "Open workspace" -> /app
AUTH_UPGRADE_JS = """
        try {
            const hasToken = Boolean(localStorage.getItem('v2_token'));
            if (hasToken) {
                scope.querySelectorAll('.nav-signin').forEach(a => {
                    a.textContent = 'Open workspace';
                    a.setAttribute('href', '/app');
                });
                scope.querySelectorAll('.nav-actions .button-primary').forEach(a => {
                    a.innerHTML = 'Go to app <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>';
                    a.setAttribute('href', '/app');
                });
            }
        } catch {}
"""
js = js.replace("function bind(scope) {", "function bind(scope) {\n" + AUTH_UPGRADE_JS, 1)

open(ASSETS + '/elementor.js', 'w').write(js)

# ---------------------------------------------------------------- pages
SLUG_A1 = 'meetings-without-translators'
SLUG_A2 = 'multilingual-meetings-made-easy-with-lalia'
SLUG_A3 = 'interpreter-or-live-ai-translation'
SLUG_PHRASE = 'why-phrase-level-commits-beat-word-by-word-streaming'
SLUG_BILINGUAL = 'designing-bilingual-rooms-where-nobody-waits'

ALL_SLUGS = (SLUG_PHRASE, SLUG_BILINGUAL, SLUG_A3, SLUG_A1, SLUG_A2)

KEEP_INLINE = ('lalia-theme', 'lazyloadRunObserver', 'LALIA_ASSETS')

def canonical_url_for(route):
    if route == '/':
        return LIVE + '/'
    return LIVE + route

def transform(html, route):
    # Ensure html root has data-lp-theme="lalia" and data-palette="blue"
    html = re.sub(
        r'<html\b([^>]*)>',
        lambda m: '<html%s data-lp-theme="lalia" data-palette="blue">' % (
            re.sub(r'\s*data-(?:lp-theme|palette)="[^"]*"', '', m.group(1))
        ),
        html,
        count=1,
    )

    # scripts
    def script(m):
        attrs, body = m.group(1), m.group(2)
        if 'lalia-elementor/assets/elementor.js' in attrs:
            return '<script defer src="/studio-assets/elementor.js?v=%s"></script>' % sha(ASSETS + '/elementor.js')
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
                    href = '/studio-assets/%s?v=%s' % (name, sha(ASSETS + '/' + name))
                    return re.sub(r"href=['\"][^'\"]+['\"]", 'href="%s"' % href, tag)
            raise SystemExit('unmapped stylesheet: ' + tag)
        if 'rel="icon"' in tag:
            return '<link rel="icon" href="/studio-assets/favicon.svg" type="image/svg+xml" />'
        return ''
    html = re.sub(r'<link[^>]+>\s*', link, html)
    html = re.sub(r'<meta name="generator"[^>]*>\s*', '', html)
    html = re.sub(r"<meta name=['\"]robots['\"][^>]*>\s*", '', html)

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

    # URLs: rewrite WP URLs and any /preview/* URLs to live routes (/, /blog, /studio-assets)
    html = html.replace(W + '/wp-content/plugins/lalia-elementor/assets/', '/studio-assets/')
    html = html.replace(W + '/wp-content/uploads/2026/11/kenny.jpg', '/studio-assets/images/kenny.jpg')
    html = html.replace(WJ + '\\/wp-content\\/plugins\\/lalia-elementor\\/assets', '\\/studio-assets')
    for p in ('feed/', 'comments/feed/'):
        html = html.replace(W + '/' + p, '/blog')
    for slug in ALL_SLUGS:
        html = html.replace(W + '/%s/' % slug, '/blog/' + slug)
        html = html.replace(WJ + '\\/%s\\/' % slug, LIVE.replace('/', '\\/') + '\\/blog\\/' + slug)
    html = html.replace(W + '/blog/', '/blog')
    html = html.replace('href="/blog/"', 'href="/blog"')
    html = html.replace(W + '/#', '/#')
    html = html.replace('href="%s/"' % W, 'href="/"')
    html = html.replace(WJ + '\\/', LIVE.replace('/', '\\/') + '\\/')
    html = html.replace('/studio-assets/social-card.png', LIVE + '/studio-assets/social-card.png')
    html = html.replace('window.LALIA_ASSETS="\\/preview\\/assets"', 'window.LALIA_ASSETS="\\/studio-assets"')
    html = html.replace('/preview/assets/', '/studio-assets/')
    html = html.replace('/preview/blog', '/blog')
    html = html.replace('/preview/home', '/')

    # Upgrade language options and audio microcopy on home page
    if route == '/':
        old_select = '<select aria-label="Choose translation language"><option value="es" selected="">Spanish</option><option value="ja">Japanese</option><option value="fr">French</option><option value="pt">Portuguese</option></select>'
        new_select = (
            '<select aria-label="Choose translation language">'
            '<option value="es" selected="">Spanish</option>'
            '<option value="ja">Japanese</option>'
            '<option value="fr">French</option>'
            '<option value="de">German</option>'
            '<option value="it">Italian</option>'
            '<option value="nl">Dutch</option>'
            '<option value="pt">Portuguese</option>'
            '<option value="zh">Mandarin Chinese</option>'
            '<option value="ko">Korean</option>'
            '<option value="ar">Arabic</option>'
            '<option value="hi">Hindi</option>'
            '<option value="ru">Russian</option>'
            '</select>'
        )
        html = html.replace(old_select, new_select)
        html = html.replace(
            'Sample text &amp; browser audio.',
            'Real Lalia neural voice sample.'
        )

    # Add "Sign in" link in header nav-actions and footer links so /login is directly accessible
    html = html.replace(
        '<a class="nav-demo" href="https://lalia.cloud/demo">',
        '<a class="nav-signin" href="/login">Sign in</a><a class="nav-demo" href="/demo">',
    )
    html = html.replace('href="https://lalia.cloud/v2/signup?plan=starter"', 'href="/signup?plan=starter"')
    html = html.replace('href="https://lalia.cloud/v2/signup?plan=pro"', 'href="/signup?plan=pro"')
    html = html.replace('href="https://lalia.cloud/v2/signup"', 'href="/signup"')
    html = html.replace('href="https://lalia.cloud/demo"', 'href="/demo"')
    html = html.replace(
        '<div><span>LET’S CONNECT</span><a href="/signup">',
        '<div><span>LET’S CONNECT</span><a href="/login">Sign in</a><a href="/signup">',
    )

    # Canonical + locked Lalia Blue boot script
    canon = canonical_url_for(route)
    boot = (
        '<link rel="canonical" href="%s" />\n'
        '<meta property="og:url" content="%s" />\n'
        '<script>(function(){'
        'var d=document.documentElement;'
        'd.setAttribute("data-lp-theme","lalia");'
        'd.dataset.palette="blue";'
        'try{'
        'var isCap=Boolean(window.Capacitor&&typeof window.Capacitor.isNativePlatform==="function"&&window.Capacitor.isNativePlatform())||location.protocol==="capacitor:"||location.protocol==="ionic:";'
        'if(isCap&&location.pathname==="/"){location.replace("/app");return;}'
        '}catch(e){}'
        'var M=%s;window.LP=function(c){return M[c]||c};'
        '})();</script>\n'
    ) % (canon, canon, json.dumps(JS_MAP, separators=(',', ':')))

    html = re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + boot, html, count=1)
    tail = '<link rel="stylesheet" href="/studio-assets/palette.css?v=%s" />\n</head>' % sha(ASSETS + '/palette.css')
    html = html.replace('</head>', tail, 1)

    # Strip WordPress cache comments at the bottom
    html = re.sub(r'<!--\s*Cache served by breeze.*?-->\s*', '', html, flags=re.S)
    html = re.sub(r'<!--\s*plugin=object-cache-pro.*?-->\s*', '', html, flags=re.S)

    leftover = [m.start() for m in re.finditer('cloudwaysapps', html)]
    if leftover:
        raise SystemExit('%s: leftover WP URLs at %s: %s' % (route, leftover[:3], html[leftover[0]-120:leftover[0]+80]))
    return html

def make_article(base_html, main_partial, slug, title, desc, post_id):
    art = base_html
    main_html = open(os.path.join(PARTIALS, main_partial)).read()
    art = re.sub(r'<main id="journal-main">.*?</main>', lambda m: main_html.strip(), art, flags=re.S)
    art = re.sub(r'<title>.*?</title>', '<title>%s | Lalia Journal</title>' % title, art)
    # Remove duplicate meta description if present, then set the primary one
    desc_count = [0]
    def sub_desc(m):
        desc_count[0] += 1
        if desc_count[0] > 1:
            return ''
        return m.group(1) + desc + '"'
    art = re.sub(r'(<meta name="description" content=")[^"]*"', sub_desc, art)
    art = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + title + ' | Lalia Journal', art)
    art = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m.group(1) + desc, art)
    art = re.sub(r'<link rel="canonical"[^>]*>', '', art)
    art = art.replace('postid-48', post_id)
    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": title,
        "description": desc,
        "datePublished": "2026-11-08T15:00:00+00:00",
        "dateModified": "2026-11-08T15:00:00+00:00",
        "mainEntityOfPage": LIVE + "/blog/" + slug,
        "author": {"@type": "Organization", "name": "Lalia", "url": LIVE + "/"},
        "publisher": {"@type": "Organization", "name": "Lalia", "url": LIVE + "/"}
    }
    art = re.sub(
        r'<script type="application/ld\+json">.*?</script>',
        lambda m: '<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False),
        art,
        flags=re.S,
    )
    return art

pages_src = {
    '/': open(SRC + '/home.html').read(),
    '/blog': open(SRC + '/blog.html').read(),
    '/blog/' + SLUG_A1: open(SRC + '/%s.html' % SLUG_A1).read(),
    '/blog/' + SLUG_A2: open(SRC + '/%s.html' % SLUG_A2).read(),
}

# Remove duplicate meta descriptions on original WP articles
for r in ('/blog/' + SLUG_A1, '/blog/' + SLUG_A2):
    c = [0]
    def dedup_desc(m):
        c[0] += 1
        return '' if c[0] > 1 else m.group(0)
    pages_src[r] = re.sub(r'<meta name="description" content="[^"]*">\s*', dedup_desc, pages_src[r])

base_article = pages_src['/blog/' + SLUG_A1]

pages_src['/blog/' + SLUG_A3] = make_article(
    base_article,
    'article3-main.html',
    SLUG_A3,
    'Interpreter or live translation? Choose by the meeting.',
    'Some conversations need a professional interpreter. Many don\u2019t. Here is a simple way to tell the difference.',
    'postid-60',
)

pages_src['/blog/' + SLUG_PHRASE] = make_article(
    base_article,
    'article-phrase-main.html',
    SLUG_PHRASE,
    'Why phrase-level commits beat word-by-word streaming',
    'Spoken translation sounds human when it waits for a complete clause\u2014while live interim captions keep everyone reading along in real time.',
    'postid-61',
)

pages_src['/blog/' + SLUG_BILINGUAL] = make_article(
    base_article,
    'article-bilingual-main.html',
    SLUG_BILINGUAL,
    'Designing bilingual rooms where nobody waits',
    'Why traditional cross-language calls stall\u2014and how per-listener language lanes, browser guest links, and shared recaps keep everyone in the same rhythm.',
    'postid-62',
)

# Blog index: feature the 3 studio articles (phrase-level commits, bilingual rooms, interpreter vs live AI translation)
# plus the 2 additional journal stories below them.
card_phrase = open(os.path.join(PARTIALS, 'article-phrase-card.html')).read().strip()
card_bilingual = open(os.path.join(PARTIALS, 'article-bilingual-card.html')).read().strip()
card_interp = open(os.path.join(PARTIALS, 'article3-card.html')).read().strip()

blog_html = pages_src['/blog']
# Demote the original featured story to a standard journal-story card so phrase-level commits leads as featured
blog_html = blog_html.replace('<article class="journal-story journal-featured">', '<article class="journal-story ">', 1)
blog_html = blog_html.replace('<p class="eyebrow">FEATURED STORY</p>', '<p class="eyebrow">FROM THE JOURNAL</p>', 1)
marker = '<article class="journal-story ">'
assert marker in blog_html, 'story marker missing'
blog_html = blog_html.replace(
    marker,
    card_phrase + '\n' + card_bilingual + '\n' + card_interp + '\n' + marker,
    1,
)
pages_src['/blog'] = blog_html

# Dry-run pass to collect every palette variable (including inline/SVG ones), then write palette.css.
open(ASSETS + '/palette.css', 'w').write('')
for route, html in pages_src.items():
    transform(html, route)

def palette_css():
    blue = ''.join('%s:%s;' % (k, v[1]) for k, v in sorted(PALETTE.items()))
    return (
        '/* Generated: Lalia Blue/Slate palette locked as default. */\n'
        ':root,html[data-lp-theme="lalia"],html[data-palette="blue"]{%s}\n' % blue
    )

open(ASSETS + '/palette.css', 'w').write(palette_css())

for route, html in pages_src.items():
    out_html = transform(html, route)
    if route == '/':
        open(os.path.join(PUBLIC_DIR, 'studio-home.html'), 'w').write(out_html)
    elif route == '/blog':
        os.makedirs(BLOG_DIR, exist_ok=True)
        open(os.path.join(BLOG_DIR, 'index.html'), 'w').write(out_html)
    elif route.startswith('/blog/'):
        slug_dir = os.path.join(BLOG_DIR, route[len('/blog/'):])
        os.makedirs(slug_dir, exist_ok=True)
        open(os.path.join(slug_dir, 'index.html'), 'w').write(out_html)

print('Generated studio-home.html and blog routes. Palette vars:', len(PALETTE), 'JS colours:', len(JS_MAP))
