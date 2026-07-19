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

export default function MicButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void; // called with each final transcript chunk
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
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
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) onText(text.trim() + " ");
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (!supported) return null;
  return (
    <button
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? "Stop dictation" : "Dictate with your voice"}
      title={listening ? "Stop dictation" : "Dictate with your voice"}
      style={{
        fontFamily: sans,
        fontSize: 16,
        lineHeight: 1,
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${listening ? C.amber : C.line}`,
        background: listening ? C.amberSoft : "transparent",
        color: listening ? C.amber : C.dim,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {listening ? "● …" : "🎤"}
    </button>
  );
}
