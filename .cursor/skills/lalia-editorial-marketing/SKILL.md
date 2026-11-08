---
name: lalia-editorial-marketing
description: Design system, editorial voice, CSS product illustration rules, and 8-stage hybrid Claude Opus + OpenAI GPT-5.6 content pipeline for Lalia marketing pages and Lalia Journal articles. Use whenever creating, editing, or reviewing Lalia landing pages, blog posts, SEO pillar pages, or conversion blocks.
---

# Lalia Editorial & Marketing System

This skill codifies the visual design tokens, typography, live CSS product illustrations, editorial voice, and 8-stage hybrid AI content pipeline for **Lalia** (`https://lalia.cloud`).

---

## 1. Brand Palette: Slate & Royal Blue (Never Green)

Lalia's editorial aesthetic combines magazine-grade typography and layout restraint with **Lalia's Slate & Royal Blue palette** (never use forest/sage green):

| Token | Light Mode | Dark Mode | Purpose |
|---|---|---|---|
| `--lalia-ink` | `#0f172a` (`slate-900`) | `#f8fafc` (`slate-50`) | Primary headline & body ink |
| `--lalia-muted` | `#475569` (`slate-600`) | `#94a3b8` (`slate-400`) | Decks, captions, secondary copy |
| `--lalia-paper` | `#f8fafc` (`slate-50`) | `#090d16` (`slate-950`) | Page background canvas |
| `--lalia-surface` | `#ffffff` (`white`) | `#0f172a` (`slate-900`) | Card & article surfaces |
| `--lalia-soft` | `#eff6ff` (`blue-50`) | `rgba(37, 99, 235, 0.12)` | Soft ice-blue feature & callout tint |
| `--lalia-accent-Wash` | `#dbeafe` (`blue-100`) | `rgba(59, 130, 246, 0.2)` | Pills, badges, illustration accents |
| `--lalia-primary` | `#2563eb` (`blue-600`) | `#3b82f6` (`blue-500`) | Primary CTAs, tonal H1 second line, active indicators |
| `--lalia-hairline` | `#e2e8f0` (`slate-200`) | `#1e293b` (`slate-800`) | Magazine 1px borders and dividers |

---

## 2. Typography & Magazine Rhythm

- **Heading Font:** `Manrope` (`font-weight: 600, 700, 800`, tight tracking `-0.03em`, line-height `1.08`).
- **Body Font:** `DM Sans` (`font-weight: 400, 500, 600`, comfortable `1.85` reading line-height, `680px` measure for long-form articles).
- **Signature Opening Rhythm (Every Page & Section):**
  1. **Small-Caps Eyebrow:** `0.72rem`, `font-weight: 700`, `letter-spacing: 0.16em`, uppercase in `#2563eb` (e.g., `MEETINGS WITHOUT BORDERS`, `CHOOSING THE RIGHT SUPPORT`).
  2. **Two-Tone H1 / H2:** First line in deep slate ink (`#0f172a`), second line in Lalia royal blue (`#2563eb` / `#3b82f6`).
     - Example: `A little less distance.` / `<span class="text-blue-600">Your voice, their language, the same conversation.</span>`
  3. **One-Sentence Deck:** Calm, concrete 1–2 sentence summary in `#475569` (`max-w-2xl`).
  4. **Quiet Byline (on Journal posts):** Monogram badge `l.` + Author (`Lalia Editorial`) + Date + Read time.

---

## 3. Live CSS Product Illustrations (Zero Stock Photos)

Never use generic stock photos. Every hero, feature card, and article cover uses accessible (`role="img"` + `aria-label`) CSS/HTML illustrations showing Lalia at work:

1. **`voice-bubbles` ("YOU SAY / THEY HEAR"):**
   - Top bubble (`YOU SAY · ENGLISH`): *"We can ship the first order on Thursday."*
   - Center live audio waveform (`▂ ▅ ▇ ▃ ▆ ▇ ▄ ▂`) with latency/translation pill (`Live voice + captions · 30+ languages`).
   - Bottom bubble (`THEY HEAR · ESPAÑOL` in `#eff6ff` / `#2563eb` border): *"Podemos enviar el primer pedido el jueves."*
2. **`language-bridge` (Dual-Speaker Bridge):**
   - Two speaker cards (*English* ↔ *Español / 日本語 / Français*) joined by a royal-blue bridge node, with live bilingual caption strip underneath.
3. **`decision-bridge` (Interpreter vs. Live AI Translation):**
   - Split comparison illustration contrasting *Qualified Interpreter (High-stakes, regulated, certified)* with *Live AI Translation (Everyday, instant, self-serve)*.
4. **`direct-call-qr` (1-Tap Ringing & Instant Guest Join):**
   - Shows 1-tap contact calling alongside browser/QR guest join with zero app install required for guests.

---

## 4. Editorial Voice & Claim Discipline

1. **Story Before Specs:** Open with a concrete human situation in 2–3 short declarative sentences (*"A client has a question. A supplier has an update. Your team needs to make a decision."*) before naming features.
2. **Human CTA Verbs (3-Tier Progressive Commitment):**
   - **Primary CTA:** `Start talking for free ↗` (`/v2/signup`)
   - **Secondary CTA:** `Try the live demo` (`/demo`)
   - **Tertiary Contextual Link:** `Compare plans` (`/#pricing` or `/preview/home#pricing`)
3. **Self-Limiting Honesty ("When Not to Use Us"):**
   - Every comparison or buyer guide must state clearly when a qualified human interpreter is the right choice (legal proceedings, medical consultations, safety-critical or regulated settings).
   - Label illustrative scenarios explicitly (*"This is an illustrative example of how a meeting works, not a customer case study"*).
4. **Banned AI Clichés:** Never use *"seamless"*, *"revolutionary"*, *"cutting-edge"*, *"unlock"*, *"leverage"*, *"game-changer"*, *"supercharge"*, or *"in today's fast-paced world"*.
5. **Product Fact Registry Alignment:**
   - 30+ languages for live captions and spoken translation.
   - Guests join in the browser via link or QR code—no download or account required.
   - Direct 1-on-1 calls ring contacts on web, iOS (CallKit), and Android.
   - Meetings are not audio/video recorded; transcript storage is optional per meeting; meeting content is never used to train Lalia's own models.
   - Free plan includes 60 participant-minutes/month with no credit card required.

---

## 5. 8-Stage Hybrid Content Pipeline (Claude Opus + OpenAI GPT-5.6)

1. **[0] Signals & Opportunity Discovery:** Mine `support-kit` knowledge gaps, user questions, and search queries into distinct, non-cannibalizing intents.
2. **[1] Structured Brief (GPT-5.6):** Lock primary query, reader job-to-be-done, required `ProductFactRegistry` IDs, and internal link targets.
3. **[2] Grounded Research Packet:** Collect verified primary sources; zero unsourced statistics allowed.
4. **[3] Argument Outline (Claude Opus 5.5):** Map H2 sections, table slots, HowTo steps, and earned CTA positions.
5. **[4] Sectioned Long-Form Draft (Claude Opus 5.5):** Draft section-by-section using the Lalia voice guide and negative constraints.
6. **[5] Structured Block Extraction (GPT-5.6 / Sonnet):** Emit typed article blocks (`keyTakeaways`, `comparisonTable`, `decisionMatrix`, `steps`, `pullQuote`, `callout`, `faq`).
7. **[6] Cross-Vendor Claims Gate (GPT-5.6 + Deterministic Linter):** Verify every factual claim against the Product Fact Registry and block banned absolutes.
8. **[7–8] SEO Packaging & Prerender Build:** Emit `BlogPosting` + `BreadcrumbList` + `FAQPage` + `HowTo` JSON-LD, sticky TOC with embedded demo CTA, and static HTML shells.
