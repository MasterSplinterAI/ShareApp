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

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

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
      if (!next.trim()) break;
      if (/^[ \t]*[-*]\s+/.test(next) || /^[ \t]*\d+\.\s+/.test(next)) break;
      parts.push(next);
      i += 1;
    }
    blocks.push({ type: "p", text: parts.join(" ") });
  }

  return blocks;
}

/** Minimal markdown for support chat (bold, italic, lists, links, code). */
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
