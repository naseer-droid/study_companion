"use client";

import { useEffect, useRef, useState } from "react";
import { C, sans } from "./lamp-ui";

// v3.3 voice input: Web Speech API dictation — free, on-device, no deps.
// Renders nothing where unsupported (Firefox), so composers lose nothing.
// The API isn't in TypeScript's dom lib everywhere, hence the local types.
type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative };
type SpeechResultEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecCtor = new () => SpeechRec;

function getRecognitionCtor(): SpeechRecCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// Inline SVG mic — the app ships no icon library, and the old 🎤 / "● …"
// emoji rendered inconsistently across platforms. currentColor lets the button
// tint it (dim idle, amber while listening).
function MicGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export default function MicButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void; // called with each final transcript chunk
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState(""); // live words, not yet committed
  const recRef = useRef<SpeechRec | null>(null);

  // Detection happens client-side only — this also keeps SSR markup stable.
  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
    return () => recRef.current?.stop();
  }, []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true; // v3.4: surface a live preview while speaking
    rec.continuous = true;
    rec.onresult = (e) => {
      let finalText = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else pending += r[0].transcript;
      }
      if (finalText.trim()) onText(finalText.trim() + " ");
      setInterim(pending.trim());
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (!supported) return null;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      {listening && interim && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            maxWidth: 260,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            background: C.panel2,
            border: `1px solid ${C.amber}`,
            borderRadius: 8,
            padding: "6px 10px",
            fontFamily: sans,
            fontSize: 13,
            color: C.ink,
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          {interim}
        </span>
      )}
      <button
        onClick={toggle}
        disabled={disabled}
        aria-label={listening ? "Stop dictation" : "Dictate with your voice"}
        title={listening ? "Stop dictation" : "Dictate with your voice"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: sans,
          fontSize: 13,
          lineHeight: 1,
          padding: "9px 12px",
          borderRadius: 10,
          border: `1px solid ${listening ? C.amber : C.line}`,
          background: listening ? C.amberSoft : "transparent",
          color: listening ? C.amber : C.dim,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <MicGlyph />
        {listening && (
          <span
            className="lc-pulse"
            style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, display: "inline-block" }}
          />
        )}
      </button>
    </span>
  );
}
