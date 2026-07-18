"use client";

import { CSSProperties, ReactNode } from "react";
import { readerUrl } from "@/lib/links";

// Shared atoms for the Study Lamp UI — extracted from StudyLamp.tsx so the
// Study Room components (Library/ReaderView/DiscussPanel) use the exact same
// look instead of restyling.

// ---------- palette: "study lamp at night" (handoff §7) ----------
export const C = {
  bg: "#141A26",
  panel: "#1C2433",
  panel2: "#222D40",
  line: "#2C3750",
  ink: "#EFEAE0",
  dim: "#8A94A8",
  amber: "#F5B34E",
  amberSoft: "rgba(245,179,78,0.14)",
  sage: "#8FBF7F",
  danger: "#D9776B",
};
export const serif = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
export const sans = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: sans,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.amber,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "solid",
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost" | "danger";
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    fontFamily: sans,
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    padding: "10px 16px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "none",
    transition: "opacity 0.2s",
  };
  const variants: Record<string, CSSProperties> = {
    solid: { background: C.amber, color: "#1B1406" },
    ghost: {
      background: "transparent",
      color: C.dim,
      border: `1px solid ${C.line}`,
    },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.line}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

// Companion text with URLs as tappable links. Handles markdown [title](url)
// (models emit it even when asked for plain text) and bare https://… /
// www.… URLs; no other markdown. Medium links open via the freedium mirror.
const LINK_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()"']+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>()"']*)/gi;

export function Linkify({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = new RegExp(LINK_RE); // local lastIndex — the module regex is shared
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    let label: string;
    let url: string;
    if (m[1] && m[2]) {
      label = m[1];
      url = m[2];
    } else {
      // Trailing punctuation belongs to the sentence, not the URL.
      url = m[3].replace(/[.,;:!?]+$/, "");
      label = url;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    nodes.push(
      <a
        key={m.index}
        href={readerUrl(href)}
        target="_blank"
        rel="noreferrer"
        style={{ color: C.amber, textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        {label}
      </a>
    );
    last = m.index + (m[1] ? m[0].length : url.length);
  }
  if (nodes.length === 0) return <>{text}</>;
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.dim, fontFamily: sans, fontSize: 14 }}>
      <span
        className="lc-pulse"
        style={{ width: 10, height: 10, borderRadius: "50%", background: C.amber, display: "inline-block" }}
      />
      {label}
    </div>
  );
}
