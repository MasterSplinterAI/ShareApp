import type { StudioCardSpec } from "@rhule/marketing-shared";
import type { MarketingBrandConfig } from "./adapters.js";

function escapeXml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + " " + w).length <= maxCharsPerLine) {
      cur += " " + w;
    } else {
      lines.push(cur);
      if (lines.length >= maxLines) return lines;
      cur = w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function fitText(text: string, maxChars: number): string {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars - 1);
  const atWord = cut.lastIndexOf(" ") > maxChars * 0.5 ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return `${atWord.replace(/[\s,.;:·-]+$/, "")}…`;
}

/** Wraps into at most maxLines; the final line gets an ellipsis if text remains. */
function wrapFitted(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const lines = wrapLines(text, maxCharsPerLine, maxLines);
  const consumed = lines.join(" ").length;
  const total = String(text || "").trim().replace(/\s+/g, " ").length;
  if (lines.length && consumed < total) {
    lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} ${String(text).trim().replace(/\s+/g, " ").slice(consumed + 1)}`, maxCharsPerLine);
  }
  return lines.map((l) => (l.length > maxCharsPerLine ? fitText(l, maxCharsPerLine) : l));
}

/** The left column is ~520px wide; Georgia bold averages ~0.56em per glyph. */
function headlineLayout(title: string): { lines: string[]; fontSize: number; lineHeight: number } {
  for (const fontSize of [44, 38, 32]) {
    const perLine = Math.floor(520 / (fontSize * 0.56));
    const maxLines = fontSize === 32 ? 5 : 4;
    const lines = wrapLines(title, perLine, 99);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight: Math.round(fontSize * 1.22) };
  }
  return { lines: wrapFitted(title, Math.floor(520 / (32 * 0.56)), 5), fontSize: 32, lineHeight: 39 };
}

export function buildDefaultStudioCardSpec(input: {
  title: string;
  kicker?: string;
  customInstruction?: string;
  brand: MarketingBrandConfig;
}): StudioCardSpec {
  const lower = `${input.title} ${input.kicker || ""} ${input.customInstruction || ""}`.toLowerCase();
  const palette: StudioCardSpec["palette"] = lower.includes("emerald") || lower.includes("green")
    ? "emerald"
    : lower.includes("amber") || lower.includes("gold") || lower.includes("warm")
      ? "amber"
      : lower.includes("purple") || lower.includes("lalia")
        ? "purple"
        : "navy";

  if (lower.includes("cite") || lower.includes("citation") || lower.includes("sanction") || lower.includes("courtlistener")) {
    return {
      caption: `${input.brand.name} · Authority Verification`,
      docTitle: "Table of Authorities · Pre-Filing Audit",
      docHighlight: "Every case reporter & statutory citation cross-checked against CourtListener & Cornell LII.",
      docReference: "(28 U.S.C. § 1927 · Fed. R. Civ. P. 11)",
      calloutBadge: "Verified on Record",
      calloutTitle: "Primary Sources Confirmed",
      calloutSubtitle: "Unmatched authorities flagged before filing",
      chipFrom: "DRAFT CITATIONS",
      chipTo: "Verified against official sources",
      palette,
    };
  }
  if (lower.includes("contract") || lower.includes("redline") || lower.includes("lease") || lower.includes("agreement")) {
    return {
      caption: `${input.brand.name} · Contract Review & Redline`,
      docTitle: "Master Agreement · Risk & Fallback Audit",
      docHighlight: "Customer's aggregate liability shall not exceed fees paid in the prior 12 months.",
      docReference: "(§ 14.2 Limitation of Liability · Redlined)",
      calloutBadge: "Protective Clause",
      calloutTitle: "One-Sided Indemnity Flagged",
      calloutSubtitle: "Counter-proposal & fallback language ready",
      chipFrom: "UNCAPPED RISK",
      chipTo: "Balanced market standard",
      palette,
    };
  }
  if (lower.includes("evict") || lower.includes("summons") || lower.includes("debt") || lower.includes("answer")) {
    return {
      caption: `${input.brand.name} · Court Response Package`,
      docTitle: "Verified Answer & Affirmative Defenses",
      docHighlight: "Response deadline calculated from service date; statutory defenses grounded in the record.",
      docReference: "(Court-Ready PDF + Editable Word .docx)",
      calloutBadge: "Court-Ready",
      calloutTitle: "Deadline & Filing Checklist Included",
      calloutSubtitle: "Plain-English step-by-step service guide",
      chipFrom: "UPLOADED SUMMONS",
      chipTo: "Filing-ready response",
      palette,
    };
  }

  return {
    caption: `${input.brand.name} · ${input.kicker || "Editorial Studio"}`,
    docTitle: input.title,
    docHighlight: input.customInstruction
      ? input.customInstruction
      : "Grounded in the uploaded record with every source and statutory citation verified.",
    docReference: `(${input.brand.domain})`,
    calloutBadge: "Verified Workflow",
    calloutTitle: input.brand.name,
    calloutSubtitle: input.brand.tagline,
    chipFrom: "RAW RECORD",
    chipTo: "Verified deliverable",
    palette,
  };
}

/**
 * Generates a high-resolution 1200x630 editorial SVG artwork buffer (for blog hero or email banner)
 * that is always crisp, brand-aligned, and never fails even when external image APIs are offline.
 */
export function renderEditorialSvgArtwork(input: {
  title: string;
  kicker?: string;
  targetType: "blog" | "email";
  spec: StudioCardSpec;
  brand: MarketingBrandConfig;
}): Buffer {
  const paletteColors = {
    navy: { bg1: "#0c1931", bg2: "#173b7a", accent: "#38bdf8", pillBg: "#1e3a8a", gold: "#f59e0b" },
    emerald: { bg1: "#062c22", bg2: "#0f5132", accent: "#34d399", pillBg: "#065f46", gold: "#fbbf24" },
    amber: { bg1: "#271705", bg2: "#78350f", accent: "#fbbf24", pillBg: "#92400e", gold: "#38bdf8" },
    purple: { bg1: "#1e1035", bg2: "#4c1d95", accent: "#c084fc", pillBg: "#5b21b6", gold: "#f472b6" },
  };
  const pal = paletteColors[input.spec.palette || "navy"] || paletteColors.navy;
  const headline = headlineLayout(input.title);
  const highlightLines = wrapFitted(input.spec.docHighlight, 50, 2);
  const kickerText = fitText((input.kicker || input.brand.name).toUpperCase(), 28);
  const kickerWidth = Math.min(500, Math.round(48 + kickerText.length * 9.4));
  const badgeText = `✓ ${fitText(input.spec.calloutBadge.toUpperCase(), 26)}`;
  const badgeWidth = Math.min(420, Math.round(26 + badgeText.length * 7.6));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${pal.bg1}" />
      <stop offset="100%" stop-color="${pal.bg2}" />
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="60%">
      <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.24" />
      <stop offset="100%" stop-color="${pal.bg1}" stop-opacity="0" />
    </radialGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="125%" height="125%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#020617" flood-opacity="0.45" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect width="1200" height="630" fill="url(#glow)" />

  <!-- Subtle architectural grid lines -->
  <g stroke="#ffffff" stroke-opacity="0.06" stroke-width="1">
    <line x1="72" y1="0" x2="72" y2="630" />
    <line x1="620" y1="0" x2="620" y2="630" />
    <line x1="1128" y1="0" x2="1128" y2="630" />
    <line x1="0" y1="90" x2="1200" y2="90" />
    <line x1="0" y1="540" x2="1200" y2="540" />
  </g>

  <!-- Left Editorial Column -->
  <g transform="translate(72, 108)">
    <rect x="0" y="0" width="${kickerWidth}" height="34" rx="17" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.2" />
    <circle cx="20" cy="17" r="5" fill="${pal.accent}" />
    <text x="36" y="22" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="1.2">
      ${escapeXml(kickerText)}
    </text>

    ${headline.lines
      .map(
        (line, idx) => `
    <text x="0" y="${88 + idx * headline.lineHeight}" fill="#ffffff" font-family="Georgia, 'Times New Roman', serif" font-size="${headline.fontSize}" font-weight="700">
      ${escapeXml(line)}
    </text>`,
      )
      .join("")}

    <text x="0" y="310" fill="#cbd5e1" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="400">
      ${escapeXml(input.brand.name)} · ${escapeXml(input.brand.domain)}
    </text>

    <!-- Bottom pill chip -->
    <g transform="translate(0, 355)">
      <rect x="0" y="0" width="460" height="46" rx="12" fill="#0f172a" fill-opacity="0.72" stroke="#ffffff" stroke-opacity="0.16" />
      <text x="20" y="29" fill="${pal.accent}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">
        ${escapeXml(fitText(input.spec.chipFrom, 22))}
      </text>
      <text x="195" y="29" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">
        →  ${escapeXml(fitText(input.spec.chipTo, 30))}
      </text>
    </g>
  </g>

  <!-- Right Studio Artifact Card -->
  <g transform="translate(610, 102)" filter="url(#cardShadow)">
    <rect x="0" y="0" width="518" height="418" rx="20" fill="#ffffff" />
    <rect x="0" y="0" width="518" height="48" rx="20" fill="#f1f5f9" />
    <circle cx="24" cy="24" r="6" fill="#f87171" />
    <circle cx="44" cy="24" r="6" fill="#fbbf24" />
    <circle cx="64" cy="24" r="6" fill="#34d399" />
    <text x="88" y="29" fill="#475569" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600">
      ${escapeXml(fitText(input.spec.caption, 50))}
    </text>

    <!-- Document sheet inside card -->
    <g transform="translate(28, 72)">
      <text x="0" y="20" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="600">
        ${escapeXml(fitText(input.spec.docTitle.toUpperCase(), 58))}
      </text>
      <rect x="0" y="36" width="410" height="8" rx="4" fill="#e2e8f0" />
      <rect x="0" y="52" width="340" height="8" rx="4" fill="#e2e8f0" />

      <!-- Highlighted legal passage box -->
      <rect x="0" y="76" width="462" height="86" rx="10" fill="#eff6ff" stroke="#93c5fd" stroke-width="1.5" />
      ${highlightLines
        .map(
          (l, i) => `
      <text x="16" y="${104 + i * 24}" fill="#1e3a8a" font-family="Georgia, serif" font-size="15" font-weight="600">
        ${escapeXml(l)}
      </text>`,
        )
        .join("")}
      <text x="16" y="150" fill="#2563eb" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">
        ${escapeXml(fitText(input.spec.docReference, 60))}
      </text>

      <!-- Callout Verification Card -->
      <g transform="translate(0, 184)">
        <rect x="0" y="0" width="462" height="122" rx="14" fill="#0f172a" />
        <rect x="18" y="18" width="${badgeWidth}" height="24" rx="12" fill="${pal.gold}" fill-opacity="0.2" />
        <text x="30" y="34" fill="${pal.gold}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700">
          ${escapeXml(badgeText)}
        </text>
        <text x="18" y="68" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700">
          ${escapeXml(fitText(input.spec.calloutTitle, 40))}
        </text>
        <text x="18" y="96" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14">
          ${escapeXml(fitText(input.spec.calloutSubtitle, 56))}
        </text>
      </g>
    </g>
  </g>
</svg>`;

  return Buffer.from(svg, "utf8");
}
