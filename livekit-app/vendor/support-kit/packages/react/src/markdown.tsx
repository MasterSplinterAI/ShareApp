import { Fragment, type ReactNode } from "react";

/** Normalize common model quirks before markdown parse. */
export function normalizeSupportMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    // Models sometimes emit ". **Item**" instead of "- **Item**"
    .replace(/^[ \t]*\.\s+(?=\*\*|[_`]|[A-Za-z0-9])/gm, "- ")
    // Collapse 3+ blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Links, bold, italic, inline code — left-to-right non-overlapping
  const re =
    /(`[^`]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const raw = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (raw.startsWith("`")) {
      nodes.push(
        <code
          key={k}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.9em",
            background: "rgba(15, 23, 42, 0.06)",
            padding: "1px 4px",
            borderRadius: 4,
          }}
        >
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(<strong key={k}>{raw.slice(2, -2)}</strong>);
    } else if (
      (raw.startsWith("*") && raw.endsWith("*")) ||
      (raw.startsWith("_") && raw.endsWith("_"))
    ) {
      nodes.push(<em key={k}>{raw.slice(1, -1)}</em>);
    } else if (raw.startsWith("[")) {
      const link = raw.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a
            key={k}
            href={link[2]}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "#2563eb", textDecoration: "underline" }}
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(raw);
      }
    } else {
      nodes.push(raw);
    }
    last = m.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: HeadingLevel; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

const ATX_HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;

function matchAtxHeading(line: string): { level: HeadingLevel; text: string } | null {
  const m = line.match(ATX_HEADING_RE);
  if (!m) return null;
  const text = m[2]!.replace(/\s+#+\s*$/, "").trim();
  if (!text) return null;
  const level = m[1]!.length;
  if (level < 1 || level > 6) return null;
  return { level: level as HeadingLevel, text };
}

function isListLine(line: string): boolean {
  return /^[ \t]*[-*]\s+/.test(line) || /^[ \t]*\d+\.\s+/.test(line);
}

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = matchAtxHeading(line);
    if (heading) {
      blocks.push({ type: "h", level: heading.level, text: heading.text });
      i += 1;
      continue;
    }

    const ulMatch = line.match(/^[ \t]*[-*]\s+(.*)$/);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]!];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.match(/^[ \t]*[-*]\s+(.*)$/);
        if (!next) break;
        items.push(next[1]!);
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const olMatch = line.match(/^[ \t]*(\d+)\.\s+(.*)$/);
    if (olMatch) {
      const items: string[] = [olMatch[2]!];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.match(/^[ \t]*\d+\.\s+(.*)$/);
        if (!next) break;
        items.push(next[1]!);
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph: gather until blank or list start
    const parts: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      if (!next.trim() || matchAtxHeading(next) || isListLine(next)) break;
      parts.push(next);
      i += 1;
    }
    blocks.push({ type: "p", text: parts.join(" ") });
  }

  return blocks;
}

export type SupportMarkdownBlock = Block;

/** Parse support chat markdown into blocks (headings, paragraphs, lists). */
export function parseSupportMarkdownBlocks(text: string): Block[] {
  const normalized = normalizeSupportMarkdown(text);
  if (!normalized) return [];
  return parseBlocks(normalized);
}

function headingFontSize(level: HeadingLevel): string {
  if (level === 1) return "1.2em";
  if (level === 2) return "1.08em";
  return "1em";
}

/** Minimal markdown for support chat (headings, bold, italic, lists, links, code). */
export function SupportMarkdown({ text }: { text: string }) {
  const normalized = normalizeSupportMarkdown(text);
  if (!normalized) return null;
  const blocks = parseBlocks(normalized);

  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.45,
        wordBreak: "break-word",
      }}
    >
      {blocks.map((block, bi) => {
        if (block.type === "h") {
          const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return (
            <Tag
              key={`h-${bi}`}
              style={{
                fontSize: headingFontSize(block.level),
                fontWeight: 700,
                lineHeight: 1.3,
                margin: bi === 0 ? "0 0 0.35em" : "0.75em 0 0.3em",
              }}
            >
              {renderInline(block.text, `h${bi}`)}
            </Tag>
          );
        }
        if (block.type === "p") {
          return (
            <p key={`p-${bi}`} style={{ margin: bi === 0 ? "0 0 0.55em" : "0.55em 0" }}>
              {renderInline(block.text, `p${bi}`)}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul
              key={`ul-${bi}`}
              style={{ margin: "0.4em 0", paddingLeft: "1.25em" }}
            >
              {block.items.map((item, ii) => (
                <li key={`uli-${bi}-${ii}`} style={{ margin: "0.2em 0" }}>
                  {renderInline(item, `ul${bi}-${ii}`)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol
            key={`ol-${bi}`}
            style={{ margin: "0.4em 0", paddingLeft: "1.25em" }}
          >
            {block.items.map((item, ii) => (
              <li key={`oli-${bi}-${ii}`} style={{ margin: "0.2em 0" }}>
                {renderInline(item, `ol${bi}-${ii}`)}
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

/** For user bubbles: keep plain text + newlines, no markdown surprises. */
export function PlainMultiline({ text }: { text: string }) {
  const parts = String(text ?? "").split("\n");
  return (
    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {parts.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </span>
  );
}
