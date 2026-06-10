/**
 * Export AI transcript reports as nicely formatted PDF or Markdown.
 *
 * PDF layout follows structured-document principles (title block, section
 * hierarchy, generous margins) rendered with pdfkit from the report's
 * markdown. Supports the markdown subset our synthesis templates emit:
 * headings, paragraphs, bullet/numbered lists, bold/italic, simple tables.
 */
const PDFDocument = require('pdfkit');
const { marked } = require('marked');

const COLORS = {
  text: '#1f2430',
  muted: '#6b7280',
  accent: '#2563eb',
  rule: '#e5e7eb',
};

const TEMPLATE_LABELS = {
  executive_summary: 'Executive summary',
  action_items: 'Action items',
  decisions: 'Decisions & open questions',
  timeline: 'Timeline',
  custom: 'Custom report',
};

function templateLabel(templateId) {
  return TEMPLATE_LABELS[templateId] || 'Meeting report';
}

/** Strip markdown inline syntax for plain-text contexts (PDF rendering handles bold separately). */
function inlineToSegments(tokens) {
  // Returns [{ text, bold, italic }] from marked inline tokens
  const out = [];
  for (const t of tokens || []) {
    if (t.type === 'strong') {
      for (const seg of inlineToSegments(t.tokens)) out.push({ ...seg, bold: true });
    } else if (t.type === 'em') {
      for (const seg of inlineToSegments(t.tokens)) out.push({ ...seg, italic: true });
    } else if (t.type === 'codespan') {
      out.push({ text: t.text, code: true });
    } else if (t.type === 'link') {
      out.push({ text: t.text || t.href });
    } else if (t.tokens) {
      out.push(...inlineToSegments(t.tokens));
    } else if (t.text) {
      out.push({ text: t.text });
    }
  }
  return out;
}

function writeSegments(doc, segments, opts = {}) {
  const { fontSize = 10.5 } = opts;
  doc.fontSize(fontSize).fillColor(COLORS.text);
  segments.forEach((seg, i) => {
    const font = seg.bold ? 'Helvetica-Bold' : seg.italic ? 'Helvetica-Oblique' : seg.code ? 'Courier' : 'Helvetica';
    // Options-only call form: passing explicit undefined x/y makes pdfkit
    // restart text positioning, which breaks continued inline runs.
    doc.font(font).text(seg.text, { continued: i < segments.length - 1, lineGap: 2.5 });
  });
  if (!segments.length) doc.text('');
}

function renderTable(doc, token) {
  const headers = token.header.map((h) => h.text);
  const rows = token.rows.map((r) => r.map((c) => c.text));
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usable / headers.length;
  const startX = doc.page.margins.left;

  const drawRow = (cells, bold) => {
    const y = doc.y;
    let maxHeight = 0;
    cells.forEach((cell, i) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5)
        .fillColor(COLORS.text);
      const h = doc.heightOfString(cell, { width: colWidth - 10 });
      maxHeight = Math.max(maxHeight, h);
      doc.text(cell, startX + i * colWidth + 5, y + 4, { width: colWidth - 10 });
    });
    const rowH = maxHeight + 9;
    doc
      .moveTo(startX, y + rowH)
      .lineTo(startX + usable, y + rowH)
      .strokeColor(COLORS.rule)
      .lineWidth(0.5)
      .stroke();
    doc.x = doc.page.margins.left;
    doc.y = y + rowH + 2;
  };

  if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
  drawRow(headers, true);
  rows.forEach((r) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    drawRow(r, false);
  });
  doc.moveDown(0.6);
}

/**
 * Build a PDF buffer from a stored report row + meeting metadata.
 * @returns {Promise<Buffer>}
 */
function reportToPdfBuffer({ report, meetingTitle, orgName }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      bufferPages: true,
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      info: {
        Title: `${templateLabel(report.template_id)} — ${meetingTitle || 'Meeting'}`,
        Author: 'Parley',
        Creator: 'Parley — multilingual meetings',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Title block
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.accent).text('PARLEY MEETING REPORT', { characterSpacing: 1 });
    doc.moveDown(0.3);
    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.text).text(meetingTitle || 'Meeting');
    doc.moveDown(0.15);
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor(COLORS.muted)
      .text(templateLabel(report.template_id));
    const created = report.created_at ? new Date(report.created_at + 'Z') : new Date();
    const metaBits = [
      orgName ? `Workspace: ${orgName}` : null,
      `Generated: ${created.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
      report.line_count ? `${report.line_count} transcript lines` : null,
    ].filter(Boolean);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor(COLORS.muted).text(metaBits.join('   ·   '));
    doc.moveDown(0.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor(COLORS.accent)
      .lineWidth(1.5)
      .stroke();
    doc.moveDown(1);

    // ---- Body from markdown
    const tokens = marked.lexer(report.content_markdown || '');
    for (const token of tokens) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      switch (token.type) {
        case 'heading': {
          const sizes = { 1: 16, 2: 13.5, 3: 11.5 };
          doc.moveDown(token.depth <= 2 ? 0.8 : 0.5);
          doc
            .fontSize(sizes[token.depth] || 11)
            .font('Helvetica-Bold')
            .fillColor(token.depth <= 2 ? COLORS.accent : COLORS.text)
            .text(token.text);
          doc.moveDown(0.25);
          break;
        }
        case 'paragraph':
          writeSegments(doc, inlineToSegments(token.tokens));
          doc.moveDown(0.5);
          break;
        case 'list': {
          token.items.forEach((item, idx) => {
            if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
            const bullet = token.ordered ? `${(token.start || 1) + idx}. ` : '•  ';
            const segs = inlineToSegments(item.tokens?.[0]?.tokens || item.tokens || []);
            doc.fontSize(10.5).font('Helvetica').fillColor(COLORS.text);
            doc.text(bullet, doc.page.margins.left + 8, undefined, { continued: true, lineGap: 2.5 });
            writeSegments(doc, segs.length ? segs : [{ text: item.text || '' }]);
          });
          doc.x = doc.page.margins.left;
          doc.moveDown(0.5);
          break;
        }
        case 'table':
          renderTable(doc, token);
          break;
        case 'hr':
          doc.moveDown(0.4);
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor(COLORS.rule)
            .lineWidth(0.75)
            .stroke();
          doc.moveDown(0.6);
          break;
        case 'blockquote':
          doc.fontSize(10.5).font('Helvetica-Oblique').fillColor(COLORS.muted).text(token.text, { indent: 16 });
          doc.moveDown(0.5);
          break;
        case 'space':
          break;
        default:
          if (token.text) {
            doc.fontSize(10.5).font('Helvetica').fillColor(COLORS.text).text(token.raw || token.text);
            doc.moveDown(0.4);
          }
      }
    }

    // ---- Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(COLORS.muted)
        .text(
          `Generated by Parley · ${created.toLocaleDateString('en-US', { dateStyle: 'medium' })} · Page ${i + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom + 18,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false }
        );
    }

    doc.end();
  });
}

/** Markdown export with a metadata front-matter header. */
function reportToMarkdown({ report, meetingTitle, orgName }) {
  const created = report.created_at ? new Date(report.created_at + 'Z') : new Date();
  const header = [
    `# ${templateLabel(report.template_id)} — ${meetingTitle || 'Meeting'}`,
    '',
    `> Generated by Parley on ${created.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` +
      (orgName ? ` · Workspace: ${orgName}` : '') +
      (report.line_count ? ` · ${report.line_count} transcript lines` : ''),
    '',
    '---',
    '',
  ].join('\n');
  return header + (report.content_markdown || '');
}

function safeFilename(s) {
  return String(s || 'meeting-report')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'meeting-report';
}

module.exports = { reportToPdfBuffer, reportToMarkdown, templateLabel, safeFilename };
