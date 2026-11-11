(() => {
    const assetUrl = (p) => window.LALIA_ASSETS + p;
    const rad = Math.PI / 180;
    const cities = [[-74, 40.7], [-3.7, 40.4], [36.8, -1.3], [-46.6, -23.5], [77.2, 28.6], [139.7, 35.6]];
    const routes = [[0, 1], [1, 2], [0, 3], [1, 4], [2, 4], [4, 5]];
    const vector = ([lon, lat]) => [Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad), Math.cos(lat * rad) * Math.cos(lon * rad)];
    function initGlobe(target) {
        const stage = target.closest('.world-stage');
        const canvas = target;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        let land = [], alive = true, visible = true, frame = 0, size = 600, rotation = -.15, clock = 0, last = 0, tilt = .13, drift = 0;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)"), ocean = [];
        for (let lat = -80; lat <= 80; lat += 6)
            for (let lon = -180; lon < 180; lon += 6)
                ocean.push(vector([lon, lat]));
        fetch(assetUrl("/globe-points.json")).then(r => { if (!r.ok)
            throw Error("map unavailable"); return r.json(); }).then(data => { if (alive && Array.isArray(data))
            land = data.map(vector); }).catch(() => { });
        const resize = new ResizeObserver(entries => { size = entries[0].contentRect.width; const dpr = Math.min(window.devicePixelRatio || 1, 1.75); canvas.width = size * dpr; canvas.height = size * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); });
        resize.observe(canvas);
        const observer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
        observer.observe(canvas);
        const project = (p, scale = 1) => { const x = p[0] * Math.cos(rotation) + p[2] * Math.sin(rotation), z = p[2] * Math.cos(rotation) - p[0] * Math.sin(rotation), y = p[1] * Math.cos(tilt) - z * Math.sin(tilt), depth = z * Math.cos(tilt) + p[1] * Math.sin(tilt), r = size * .365 * scale; return [size / 2 + x * r, size / 2 - y * r, depth]; };
        const draw = (time) => {
            if (!alive)
                return;
            if (!canvas.isConnected) {
                alive = false;
                resize.disconnect();
                observer.disconnect();
                return;
            }
            frame = requestAnimationFrame(draw);
            if (time - last < 34 || !visible)
                return;
            const elapsed = Math.min(time - last, 50);
            last = time;
            if (!stage.classList.contains("is-paused") && !reduced.matches) {
                rotation += elapsed * .000023 * Number(canvas.dataset.speed || 1);
                clock += elapsed * .00020;
                drift += elapsed * .00016;
                tilt = .13 + Math.sin(drift) * .035;
            }
            ctx.clearRect(0, 0, size, size);
            const cx = size / 2, radius = size * .365, glow = ctx.createRadialGradient(cx - radius * .4, cx - radius * .3, 5, cx, cx, radius);
            glow.addColorStop(0, LP("#16372d"));
            glow.addColorStop(.65, LP("#0a1e18"));
            glow.addColorStop(1, LP("#06110e"));
            ctx.beginPath();
            ctx.arc(cx, cx, radius, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();
            ctx.strokeStyle = LP("rgba(145,255,204,.12)");
            ctx.lineWidth = 1;
            ctx.stroke();
            const line = (points) => { ctx.beginPath(); let started = false; points.forEach(p => { const [x, y, z] = project(p); if (z > -.04) {
                if (started)
                    ctx.lineTo(x, y);
                else
                    ctx.moveTo(x, y);
                started = true;
            }
            else
                started = false; }); ctx.stroke(); };
            ctx.strokeStyle = LP("rgba(163,245,201,.065)");
            ctx.lineWidth = .6;
            for (let lat = -60; lat <= 60; lat += 30) {
                const p = [];
                for (let lon = -180; lon <= 180; lon += 3)
                    p.push(vector([lon, lat]));
                line(p);
            }
            for (let lon = 0; lon < 180; lon += 30) {
                const p = [];
                for (let a = 0; a <= 360; a += 3)
                    p.push([Math.sin(a * rad) * Math.sin(lon * rad), Math.cos(a * rad), Math.sin(a * rad) * Math.cos(lon * rad)]);
                line(p);
            }
            for (const p of ocean) {
                const [x, y, z] = project(p);
                if (z < .05)
                    continue;
                ctx.beginPath();
                ctx.arc(x, y, size * .001, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(145,205,170,${z * .13})`;
                ctx.fill();
            }
            for (const p of land) {
                const [x, y, z] = project(p);
                if (z < 0)
                    continue;
                ctx.beginPath();
                ctx.arc(x, y, size * .00135 * (.55 + z * .45), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(146,239,174,${.12 + z * .64})`;
                ctx.fill();
            }
            for (let idx = 0; idx < routes.length; idx++) {
                const [a, b] = routes[idx], va = vector(cities[a]), vb = vector(cities[b]), dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])), angle = Math.acos(dot);
                const routePoint = (t) => { const sa = Math.sin((1 - t) * angle) / Math.sin(angle), sb = Math.sin(t * angle) / Math.sin(angle), elevation = 1 + Math.sin(t * Math.PI) * .22; return project([va[0] * sa + vb[0] * sb, va[1] * sa + vb[1] * sb, va[2] * sa + vb[2] * sb], elevation); };
                ctx.beginPath();
                let connected = false;
                for (let step = 0; step <= 60; step++) {
                    const [x, y, z] = routePoint(step / 60);
                    if (z > -.05) {
                        if (connected)
                            ctx.lineTo(x, y);
                        else
                            ctx.moveTo(x, y);
                        connected = true;
                    }
                    else
                        connected = false;
                }
                ctx.strokeStyle = idx % 2 ? LP("rgba(169,251,156,.32)") : LP("rgba(122,239,210,.5)");
                ctx.lineWidth = size * .0013;
                ctx.stroke();
                for (let tail = 1; tail <= (canvas.dataset.trails === "no" ? 0 : 7); tail++) {
                    const t = ((clock + idx * .21) - tail * .009 + 10) % 1;
                    const [tx, ty, tz] = routePoint(t);
                    if (tz > 0) {
                        ctx.beginPath();
                        ctx.arc(tx, ty, Math.max(.6, 2 - tail * .17), 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(191,255,200,${(1 - tail / 8) * .55})`;
                        ctx.fill();
                    }
                }
                const [px, py, pz] = routePoint((clock + idx * .21) % 1);
                if (pz > 0) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = LP("#b7ffc0");
                    ctx.beginPath();
                    ctx.arc(px, py, 2, 0, Math.PI * 2);
                    ctx.fillStyle = LP("#d0ffce");
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
            cities.forEach((c, i) => { const [x, y, z] = project(vector(c)); if (z < 0)
                return; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = LP("#d6ffb5"); ctx.shadowBlur = 12; ctx.shadowColor = LP("#a9ffa4"); ctx.fill(); ctx.shadowBlur = 0; const pulse = (clock * .7 + i * .2) % 1; ctx.beginPath(); ctx.arc(x, y, 4 + pulse * 9, 0, Math.PI * 2); ctx.strokeStyle = `rgba(192,255,174,${(1 - pulse) * .5})`; ctx.lineWidth = .8; ctx.stroke(); });
        };
        frame = requestAnimationFrame(draw);
        return () => { alive = false; cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); };
    }
    const translations = {
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
    };
    const initialized = new WeakSet();
    function bind(scope) {

        try {
            const hasToken = Boolean(localStorage.getItem('v2_token'));
            if (hasToken) {
                scope.querySelectorAll('.nav-signin').forEach(a => {
                    a.textContent = 'Open workspace';
                    a.setAttribute('href', '/v2/app');
                });
                scope.querySelectorAll('.nav-actions .button-primary').forEach(a => {
                    a.innerHTML = 'Go to app <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>';
                    a.setAttribute('href', '/v2/app');
                });
            }
        } catch {}

        scope.querySelectorAll('[data-lalia-canvas]').forEach(canvas => { if (initialized.has(canvas))
            return; initialized.add(canvas); initGlobe(canvas); });
        scope.querySelectorAll('.world-bottom button').forEach(button => {
            if (initialized.has(button))
                return;
            initialized.add(button);
            const stage = button.closest('.world-stage');
            const update = () => { const paused = stage.classList.contains('is-paused'); button.setAttribute('aria-label', paused ? 'Animate globe' : 'Pause globe animation'); const icon = button.querySelector('svg'); icon.innerHTML = paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M9 5v14M15 5v14"/>'; };
            update();
            button.addEventListener('click', () => { stage.classList.toggle('is-paused'); update(); });
        });
        scope.querySelectorAll('.theme-toggle').forEach(button => {
            if (initialized.has(button))
                return;
            initialized.add(button);
            const sync = () => { const dark = document.documentElement.dataset.theme === 'dark'; button.setAttribute('aria-checked', String(dark)); button.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; };
            sync();
            button.addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try {
                localStorage.setItem('lalia-theme', next);
            }
            catch { } sync(); });
        });

        // Home/marketing language selector — restores the control lost when the
        // React MarketingNav was replaced by the static studio-home port.
        const SITE_LANG_OPTIONS = [
            { code: 'en', label: 'English' },
            { code: 'es', label: 'Español' },
            { code: 'fr', label: 'Français' },
            { code: 'de', label: 'Deutsch' },
            { code: 'pt', label: 'Português' },
            { code: 'ja', label: '日本語' },
            { code: 'zh-CN', label: '中文（简体）' },
        ];
        const SITE_LANG_CODES = new Set(SITE_LANG_OPTIONS.map((o) => o.code));
        const detectSiteLang = () => {
            try {
                const stored = localStorage.getItem('app_language') || localStorage.getItem('parley_locale');
                if (stored) {
                    const normalized = stored.trim().replace('_', '-');
                    if (SITE_LANG_CODES.has(normalized)) return normalized;
                    const base = normalized.split('-')[0];
                    if (base === 'zh') return 'zh-CN';
                    if (SITE_LANG_CODES.has(base)) return base;
                }
            } catch {}
            const tags = (navigator.languages && navigator.languages.length)
                ? navigator.languages
                : [navigator.language];
            for (const tag of tags) {
                if (!tag) continue;
                const normalized = String(tag).trim().replace('_', '-');
                if (SITE_LANG_CODES.has(normalized)) return normalized;
                const base = normalized.split('-')[0];
                if (base === 'zh') return 'zh-CN';
                if (SITE_LANG_CODES.has(base)) return base;
            }
            return 'en';
        };
        const writeSiteLangLocal = (code) => {
            try {
                localStorage.setItem('app_language', code);
                localStorage.setItem('parley_locale', code);
            } catch {}
            document.documentElement.lang = code === 'zh-CN' ? 'zh-Hans' : code.split('-')[0];
        };
        const pushSiteLangRemote = (code) => {
            try {
                const token = localStorage.getItem('v2_token');
                if (!token) return;
                fetch('/api/v2/auth/me', {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + token,
                    },
                    body: JSON.stringify({ preferredLanguage: code }),
                }).catch(() => {});
            } catch {}
        };
        const hydrateSiteLangFromProfile = (select) => {
            try {
                const token = localStorage.getItem('v2_token');
                if (!token) return;
                fetch('/api/v2/auth/me', {
                    headers: { Authorization: 'Bearer ' + token },
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        const remote = data?.user?.preferredLanguage || data?.user?.preferred_language;
                        if (!remote) return;
                        const normalized = String(remote).trim().replace('_', '-');
                        let code = SITE_LANG_CODES.has(normalized)
                            ? normalized
                            : (normalized.split('-')[0] === 'zh' ? 'zh-CN' : normalized.split('-')[0]);
                        if (!SITE_LANG_CODES.has(code)) return;
                        select.value = code;
                        writeSiteLangLocal(code);
                    })
                    .catch(() => {});
            } catch {}
        };
        const ensureSiteLangSelect = (actions) => {
            if (!actions || initialized.has(actions)) return;
            initialized.add(actions);
            let select = actions.querySelector('.site-lang-select');
            if (!select) {
                const wrap = document.createElement('label');
                wrap.className = 'site-lang';
                wrap.setAttribute('data-no-translate', 'true');
                const sr = document.createElement('span');
                sr.className = 'sr-only';
                sr.textContent = 'Language';
                select = document.createElement('select');
                select.className = 'site-lang-select';
                select.setAttribute('aria-label', 'Choose language');
                select.setAttribute('data-no-translate', 'true');
                SITE_LANG_OPTIONS.forEach((opt) => {
                    const option = document.createElement('option');
                    option.value = opt.code;
                    option.textContent = opt.label;
                    select.appendChild(option);
                });
                wrap.append(sr, select);
                const themeToggle = actions.querySelector('.theme-toggle');
                if (themeToggle) actions.insertBefore(wrap, themeToggle);
                else actions.prepend(wrap);
            }
            const current = detectSiteLang();
            select.value = current;
            // Seed local preference from browser/default so join/create flows see it,
            // but only PATCH the profile when the user explicitly changes the select.
            try {
                if (!localStorage.getItem('app_language') && !localStorage.getItem('parley_locale')) {
                    writeSiteLangLocal(current);
                } else {
                    writeSiteLangLocal(current);
                }
            } catch {
                writeSiteLangLocal(current);
            }
            hydrateSiteLangFromProfile(select);
            if (!initialized.has(select)) {
                initialized.add(select);
                select.addEventListener('change', () => {
                    const next = select.value || 'en';
                    writeSiteLangLocal(next);
                    pushSiteLangRemote(next);
                });
            }
        };
        scope.querySelectorAll('.site-header .nav-actions, .nav-actions').forEach(ensureSiteLangSelect);
        scope.querySelectorAll('.menu-toggle').forEach(button => {
            if (initialized.has(button))
                return;
            initialized.add(button);
            const header = button.closest('.site-header');
            function close() { header.querySelector('.mobile-nav')?.remove(); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'Open navigation'); }
            button.addEventListener('click', () => {
                if (header.querySelector('.mobile-nav')) {
                    close();
                    return;
                }
                const nav = document.createElement('nav');
                nav.className = 'mobile-nav';
                nav.id = 'mobile-nav';
                nav.setAttribute('aria-label', 'Mobile navigation');
                [...header.querySelectorAll('.desktop-nav a'), header.querySelector('.nav-signin'), header.querySelector('.nav-demo')].filter(Boolean).forEach(a => { const link = a.cloneNode(true); link.addEventListener('click', close); nav.append(link); });
                header.append(nav);
                button.setAttribute('aria-expanded', 'true');
                button.setAttribute('aria-label', 'Close navigation');
            });
            header.addEventListener('keydown', e => { if (e.key === 'Escape')
                close(); });
        });
        scope.querySelectorAll('.conversation-preview').forEach(preview => {
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
        });
        scope.querySelectorAll('.summary-tabs').forEach(tabs => {
            if (initialized.has(tabs))
                return;
            initialized.add(tabs);
            const buttons = [...tabs.querySelectorAll('button')], panel = tabs.parentElement.querySelector('.insights-content'), summary = panel.innerHTML;
            const samples = [null, ['María: Share the local market brief.', 'Kenny: Send the updated launch plan.'], ['Begin with a small regional pilot.', 'Review progress together next week.']];
            function change(index) { buttons.forEach((b, i) => { b.setAttribute('aria-selected', String(i === index)); b.tabIndex = i === index ? 0 : -1; }); panel.setAttribute('aria-labelledby', buttons[index].id); if (index === 0)
                panel.innerHTML = summary;
            else {
                panel.replaceChildren();
                samples[index].forEach(line => { const p = document.createElement('p'), tick = document.createElement('span'); tick.className = 'check-mini'; tick.textContent = '✓'; p.append(tick, document.createTextNode(line)); panel.append(p); });
            } }
            buttons.forEach((b, i) => { b.addEventListener('click', () => change(i)); b.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key))
                return; e.preventDefault(); const next = (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3; change(next); buttons[next].focus(); }); });
        });
    }
    function start() {
        bind(document);
        const observer = new MutationObserver(records => { for (const record of records)
            for (const node of record.addedNodes)
                if (node.nodeType === 1)
                    bind(node.parentElement || document); });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start);
    else
        start();
})();
