/** Lightweight chat markdown: **bold**, line breaks. Strips internal URL paths from display. */

export function scrubInternalPaths(text) {
  return String(text || '')
    .replace(/\(`\/v2\/[^`]+`\)/gi, '')
    .replace(/`\/v2\/[^`]+`/gi, '')
    .replace(/\(\/v2\/[^)]+\)/gi, '')
    .replace(/\/v2\/[^\s,)]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function InlineMarkdown({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function ChatMessageContent({ text }) {
  const cleaned = scrubInternalPaths(text);
  const lines = cleaned.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <InlineMarkdown text={line} />
        </span>
      ))}
    </>
  );
}
