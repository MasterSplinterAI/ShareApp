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
        es: { name: 'Spanish', native: 'Español', phrase: '¡Hola! Qué alegría conocerte por fin.', lang: 'es-ES', source: 'Me alegro también. Hagamos algo increíble juntos.' },
        ja: { name: 'Japanese', native: '日本語', phrase: 'こんにちは！やっとお会いできてうれしいです。', lang: 'ja-JP', source: '私もです。一緒に素晴らしいものを作りましょう。' },
        fr: { name: 'French', native: 'Français', phrase: 'Bonjour ! Quel plaisir de vous rencontrer enfin.', lang: 'fr-FR', source: "C'est réciproque. Créons quelque chose de formidable ensemble." },
        pt: { name: 'Portuguese', native: 'Português', phrase: 'Olá! Que bom finalmente conhecer você.', lang: 'pt-BR', source: 'Digo o mesmo. Vamos criar algo incrível juntos.' }
    };
    const initialized = new WeakSet();
    function bind(scope) {
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
                [...header.querySelectorAll('.desktop-nav a'), header.querySelector('.nav-demo')].filter(Boolean).forEach(a => { const link = a.cloneNode(true); link.addEventListener('click', close); nav.append(link); });
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
