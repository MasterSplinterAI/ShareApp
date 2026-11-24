import { useCallback, useMemo, useState, type CSSProperties } from "react";

export interface EmbedSnippetProps {
  apiBase: string;
  tenantId: string;
  width?: number;
  height?: number;
  className?: string;
}

function normalizeApiBase(apiBase: string): string {
  return apiBase.replace(/\/$/, "");
}

export function buildEmbedIframeSnippet(
  apiBase: string,
  tenantId: string,
  opts?: { width?: number; height?: number },
): string {
  const width = opts?.width ?? 420;
  const height = opts?.height ?? 560;
  const src = `${normalizeApiBase(apiBase)}/embed?tenant=${encodeURIComponent(tenantId)}`;
  return `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" title="Support"></iframe>`;
}

export function EmbedSnippet(props: EmbedSnippetProps) {
  const { apiBase, tenantId, width = 420, height = 560, className } = props;
  const snippet = useMemo(
    () => buildEmbedIframeSnippet(apiBase, tenantId, { width, height }),
    [apiBase, tenantId, width, height],
  );
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [snippet]);

  const box: CSSProperties = {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 13,
    lineHeight: 1.45,
    color: "#0f172a",
  };

  return (
    <div className={className} style={box}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Embed snippet</div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 10,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {snippet}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        style={{
          marginTop: 10,
          padding: "8px 14px",
          border: "none",
          borderRadius: 8,
          background: "#2563eb",
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy iframe code"}
      </button>
    </div>
  );
}
