---
name: lalia-editorial-marketing
description: How Lalia marketing pages and Lalia Journal articles are built and written. Covers the lalia-elementor CSS architecture (ported 1:1 into public/studio-home.html and public/blog/), the locked Lalia Blue palette system, custom CSS/SVG product scenes, real neural TTS demo audio, and the short, effortless copy rules. Use when creating, editing, or reviewing Lalia landing pages, blog posts, or CTA blocks.
---

# Lalia Editorial & Marketing

The reference is the Lalia Journal WordPress build (`lalia-elementor` plugin v1.2.0). It is ported
1:1 to `livekit-app/frontend/public/studio-home.html` and `livekit-app/frontend/public/blog/` and served live at `/`, `/blog`, and
`/blog/<slug>`. A first attempt re-imagined it as Tailwind/shadcn React components and was
rejected: it was denser, harder to read, and lost the graphics. **Port, don't reinterpret.**

## Why his page works

1. **Brevity.** The homepage has ~1,050 visible words in total. The hero is one sentence of value
   ("Your voice. Their language. A real connection.") plus two short lines. Posts are 800–900
   words, with 12–15 words per sentence and 35–40 words per paragraph. Nothing is a wall.
2. **Breathing room.** Each section holds one idea: an eyebrow, a two-line headline, at most one
   short paragraph, then a single visual. Whitespace does the separating; there are no boxes inside boxes.
3. **Product scenes, not features.** Every visual shows Lalia working, and each one is readable in
   about two seconds: an animated globe with María (Madrid, Spanish) and Kenny (New York, English),
   a translated caption ("It's so good to finally meet you." / TRANSLATED TO ENGLISH),
   "YOU SAY Hello, team. / THEY HEAR Hola, equipo." bubbles, and a live meeting with a transcript
   and summary tabs. They are built from HTML, CSS, and SVG, not stock photos or screenshots.
4. **Two-line headlines.** Line one states, line two turns: "Speak your language. / Hear the world in yours.",
   "Three steps. / A world closer.", "Good questions. / Clear answers." The second line is tinted.
5. **Zero SaaS bloat.** No pill rows of features, no icon grids of ten benefits, no comparison
   walls, no "AI-powered" badges. Just four capability facts in one strip ("30+ languages. One connection.").
6. **Low-pressure CTAs.** "Start talking for free", "See how it feels", "Try the live demo".
   The primary goes to `/v2/signup`, the secondary to `/demo`, and pricing is linked only in context.
7. **Honest limits.** "This is an example of how a meeting could work, rather than a customer case
   study." and "Legal proceedings, medical discussions… may still call for a qualified human interpreter."

## Architecture (do not convert to Tailwind)

- Pages are **static HTML** (the original DOM and class names) under `public/studio-home.html` (promoted to `dist/index.html` by `scripts/prerender.mjs`) and `public/blog/**/index.html`.
  nginx serves them directly (`try_files /index.html` at `/` and `try_files $uri $uri/index.html /app-index.html` for `/blog` and SPA routes).
- Why static: his `app.css` is a Tailwind **v4** build that keeps its rules in cascade layers. Our app
  ships unlayered Tailwind v3, and unlayered rules always beat layered ones, so mounting his CSS inside
  the SPA gets clobbered. Static pages load only his CSS.
- Stylesheets in `public/studio-assets/`, unmodified except for colors:
  `app.css` (Tailwind v4 + homepage sections), `elementor.css` (widget resets), `blog.css`
  (journal index, article layout, `journal-art`), `reference.css` + `reference-layout.css`
  (`meeting-art`, article chrome), plus Elementor/WP vendor CSS under `vendor/`.
  `elementor.js` drives the globe canvas, theme toggle, mobile menu, real neural TTS demo audio player (`/assets/demo-voices/*.mp3`), and summary tabs.
- Fonts are self-hosted: Manrope (headings) and DM Sans (body) in `studio-assets/fonts/`.
- **Article DOM** (copy it exactly):
  `main#journal-main > article.journal-single.lalia-reference >`
  `header.article-heading.section-shell` (`.journal-back`, `p.eyebrow`, `h1` + `<br><span>` second line, `p.article-deck`, `.article-meta`),
  `.article-cover.section-shell` (`.journal-art` or `.meeting-art-shell`),
  `.article-layout.section-shell > aside.article-aside` (TOC + `.aside-demo` CTA) `+ .article-body > .article-content`.
  Inside the content: `p.article-lead`, `h2.wp-block-heading[id]`, `ul.wp-block-list`, `ol.wp-block-list.article-steps`,
  `.article-pullquote`, `.article-end` (end CTA), `.article-source`.
- **Index card**: `article.journal-story` (add `.journal-featured` for the lead story) `> a.story-art-link + .story-copy`.

## Palette: Lalia Blue (locked default)

- Every green color literal in the CSS, inline styles, SVG attributes, and globe canvas is generated
  as `var(--lp-<hex>, <blue>)`. `studio-assets/palette.css` defines the Lalia Blue/Slate
  mapping on `:root`, `html[data-lp-theme="lalia"]`, and `html[data-palette="blue"]`. Tinted neutrals become slate (hue 258); accents become Lalia blue (hue ~259).
- His own light/dark toggle (`data-theme`) is independent and works with the Lalia Blue palette.
- Never hand-edit colors in the generated CSS. Change `to_blue()` in `colors.py` and regenerate.

## Regenerating and adding articles

```bash
cd livekit-app/frontend/scripts/preview-port
./fetch.sh            # pulls his pages and every asset into .cache/ (gitignored)
python3 port.py       # rewrites public/studio-home.html, public/blog/, and public/studio-assets/
```

- New article: copy `partials/article3-main.html` (same DOM), write the copy, add a card partial, and
  register both in `port.py` the same way as the third article.
- Verify with `node compare.mjs <outDir> orig=<his url> port=<our url>?palette=green` and diff the
  screenshots. The Original Green port must be pixel-identical to his site; it measured 0.000% on home and posts.

## Copy rules

- Write sentences of 8–15 words and paragraphs of 1–3 sentences (≤ 50 words). Posts run 500–900 words with six H2s.
- Open with a three-beat scene: "Your supplier has a delay to explain. A new colleague has questions. A client wants a walkthrough."
- Give each H2 one promise in plain words ("Start with one question", "When to book an interpreter").
- Use one pullquote per post, two short lines: "Interpreters bring judgment. / Live translation brings availability."
- Use numbered `article-steps` with a bold lead-in, never more than 4–5 steps.
- Use bullets for scenarios, written as "label: one sentence". No tables unless a reader truly needs one.
- Banned: seamless, revolutionary, cutting-edge, unlock, leverage, game-changer, supercharge, "AI-powered", stacked feature pills.
- Every claim must match shipped product facts:
  - 30+ languages.
  - Spoken voice translation plus bilingual captions.
  - Guests join by link in the browser with no account.
  - No audio/video recording; transcripts are saved only when the host enables them.
  - AI summary, action items, and decisions report, which can be emailed.
  - The free plan is 60 minutes a month with no credit card.
  - Starter is $49 and Pro is $199 per org per month.
- Label illustrative examples. State plainly when a qualified interpreter is the right choice.
