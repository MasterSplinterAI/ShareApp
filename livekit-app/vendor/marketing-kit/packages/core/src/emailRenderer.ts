import type { EmailLayout } from "@rhule/marketing-shared";
import type { MarketingBrandConfig } from "./adapters.js";
import { renderMarkdownToHtmlAndToc } from "./seoRenderer.js";

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absolutize(url: string, brand: MarketingBrandConfig): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("{{") || url.startsWith("mailto:")) return url;
  return `https://${brand.domain}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Inline styles applied to rendered markdown so clients that strip <style> keep the typography. */
function inlineBodyStyles(html: string, layout: EmailLayout, brand: MarketingBrandConfig): string {
  const font = layout === "minimal" ? "Georgia,'Times New Roman',serif" : "inherit";
  return html
    .replace(/href="(\/[^"]*)"/g, (_m, path: string) => `href="https://${brand.domain}${path}"`)
    .replace(/ class="mkt-[a-z-]+"/g, "")
    .replace(/<h2([^>]*)>/g, `<h2$1 style="margin:26px 0 10px;font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#0f172a;">`)
    .replace(/<h3([^>]*)>/g, `<h3$1 style="margin:20px 0 8px;font-size:16px;line-height:1.35;color:#0f172a;">`)
    .replace(/<p>/g, `<p style="margin:0 0 14px;font-family:${font};">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<li>/g, `<li style="margin:0 0 6px;">`)
    .replace(/<blockquote>/g, `<blockquote style="margin:18px 0;padding:12px 16px;border-left:4px solid #cbd5e1;background:#f8fafc;color:#334155;">`)
    .replace(/<a href=/g, `<a style="color:#1d4ed8;text-decoration:underline;" href=`);
}

/**
 * Pure-HTML banner used when no raster artwork exists. Table-based so it survives Outlook and Gmail,
 * neither of which render SVG.
 */
export function renderTableBannerHtml(input: {
  brand: MarketingBrandConfig;
  kicker: string;
  title: string;
  subtitle?: string;
}): string {
  const { brand } = input;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c1931;background-image:linear-gradient(135deg,#0c1931 0%,#173b7a 100%);">
  <tr>
    <td style="padding:36px 32px 34px;color:#ffffff;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${escapeHtml(brand.accentColor)};color:#0c1931;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(input.kicker)}</div>
      <div style="margin-top:14px;font-family:Georgia,serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">${escapeHtml(input.title)}</div>
      ${input.subtitle ? `<div style="margin-top:10px;font-size:14px;line-height:1.5;color:#cbd5e1;">${escapeHtml(input.subtitle)}</div>` : ""}
    </td>
  </tr>
</table>`;
}

export function buildResponsiveEmailHtml(input: {
  brand: MarketingBrandConfig;
  subject: string;
  preheader: string;
  headline: string;
  bodyMarkdown: string;
  ctaLabel: string;
  ctaUrl: string;
  bannerImageUrl?: string | null;
  layout?: EmailLayout;
  bannerKicker?: string;
}): string {
  const { brand, preheader, headline, bodyMarkdown, ctaLabel } = input;
  const layout: EmailLayout = input.layout || "editorial";
  const { html: rawBodyHtml } = renderMarkdownToHtmlAndToc(bodyMarkdown);
  const innerBodyHtml = inlineBodyStyles(rawBodyHtml, layout, brand);
  const fullBannerUrl = input.bannerImageUrl ? absolutize(input.bannerImageUrl, brand) : "";
  const fullCtaUrl = absolutize(input.ctaUrl || "/", brand);
  const primary = escapeHtml(brand.primaryColor);

  const bannerRow = fullBannerUrl
    ? `<tr>
            <td style="padding:0;background-color:#0f172a;">
              <img src="${escapeHtml(fullBannerUrl)}" alt="${escapeHtml(headline)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:0;" />
            </td>
          </tr>`
    : `<tr><td style="padding:0;">${renderTableBannerHtml({
        brand,
        kicker: input.bannerKicker || brand.name,
        title: headline,
        subtitle: preheader,
      })}</td></tr>`;

  const brandHeader =
    layout === "minimal"
      ? `<tr>
            <td style="padding:26px 32px 0;font-family:Georgia,serif;font-size:18px;font-weight:700;color:#0f172a;">
              ${escapeHtml(brand.name)}
            </td>
          </tr>`
      : `<tr>
            <td style="padding:18px 28px;background-color:#0c1931;color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#ffffff;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${primary};">${escapeHtml(brand.name)}</span>
                  </td>
                  <td align="right" style="font-size:12px;color:#94a3b8;">${escapeHtml(brand.domain)}</td>
                </tr>
              </table>
            </td>
          </tr>`;

  const ctaButton = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px ${layout === "spotlight" ? "auto" : "0"} 10px;">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:${primary};">
                    <a href="${escapeHtml(fullCtaUrl)}" style="display:inline-block;padding:${layout === "spotlight" ? "16px 34px" : "14px 26px"};font-size:${layout === "spotlight" ? "16px" : "15px"};font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)} &rarr;</a>
                  </td>
                </tr>
              </table>`;

  const headlineHtml =
    layout === "spotlight"
      ? `<tr>
            <td align="center" style="padding:30px 32px 6px;background-color:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px;line-height:1.2;color:#0f172a;">${escapeHtml(headline)}</h1>
              ${ctaButton}
            </td>
          </tr>`
      : "";

  const mainCopy = `<tr>
            <td style="padding:${layout === "minimal" ? "18px 32px 24px" : "30px 28px 20px"};">
              ${layout === "spotlight" ? "" : `<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:${layout === "minimal" ? "24px" : "26px"};line-height:1.25;color:#0f172a;">${escapeHtml(headline)}</h1>`}
              <div style="font-size:15px;line-height:1.65;color:#334155;">
                ${innerBodyHtml}
              </div>
              ${ctaButton}
            </td>
          </tr>`;

  const rows =
    layout === "minimal"
      ? [brandHeader, mainCopy]
      : layout === "spotlight"
        ? [brandHeader, bannerRow, headlineHtml, mainCopy]
        : [brandHeader, bannerRow, mainCopy];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(input.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .mkt-shell { width: 100% !important; border-radius: 0 !important; }
      .mkt-pad { padding: 16px 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" class="mkt-pad" style="padding:28px 12px;">
        <table role="presentation" class="mkt-shell" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          ${rows.join("\n          ")}
          <tr>
            <td style="padding:20px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
              <p style="margin:0 0 6px;">Sent by <strong>${escapeHtml(brand.name)}</strong> (${escapeHtml(brand.domain)}).</p>
              <p style="margin:0;">You are receiving this because you have an account or subscribed to updates.
                <a href="{{unsubscribeUrl}}" style="color:#475569;text-decoration:underline;">Unsubscribe</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Replaces `{{var}}` placeholders. Values are HTML-escaped unless `raw` is set. */
export function interpolateEmailVariables(
  raw: string,
  vars: Record<string, string>,
  opts: { escape?: boolean } = {},
): string {
  const esc = opts.escape !== false;
  return String(raw || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) return "";
    return esc ? escapeHtml(v) : v;
  });
}
