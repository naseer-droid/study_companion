"use client";

import { useEffect, useRef, useState } from "react";
import { C, sans, serif, Card, Eyebrow, Btn } from "./lamp-ui";

// v3.3 focus session: a 25-minute timer with the (long-orphaned) focus music
// loop and a completion chime. Finishing hands the elapsed minutes back so the
// journal composer opens prefilled — every session ends in a reflection.
const FOCUS_MINUTES = 25;

export default function FocusSession({
  topicName,
  onFinish,
  onClose,
}: {
  topicName: string;
  onFinish: (minutes: number) => void;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_MINUTES * 60);
  const [musicOn, setMusicOn] = useState(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const endAtRef = useRef(Date.now() + FOCUS_MINUTES * 60 * 1000);
  const finishedRef = useRef(false);

  // Wall-clock based so a backgrounded phone tab doesn't stretch the session.
  useEffect(() => {
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && !finishedRef.current) {
        finishedRef.current = true;
        clearInterval(tick);
        musicRef.current?.pause();
        new Audio("/audio/success_chime.mp3").play().catch(() => {});
        onFinish(FOCUS_MINUTES);
      }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!musicRef.current) return;
    if (musicOn) musicRef.current.play().catch(() => setMusicOn(false));
    else musicRef.current.pause();
  }, [musicOn]);

  const endEarly = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    musicRef.current?.pause();
    const focusedMin = Math.max(1, Math.round((FOCUS_MINUTES * 60 - secondsLeft) / 60));
    new Audio("/audio/gentle_notification.mp3").play().catch(() => {});
    onFinish(focusedMin);
  };

  const abandon = () => {
    musicRef.current?.pause();
    onClose();
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <Card style={{ borderColor: C.amber, marginBottom: 16 }}>
      <audio ref={musicRef} src="/audio/focus_music_loop.mp3" loop preload="none" />
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Eyebrow>Focus session — {topicName}</Eyebrow>
          <div
            style={{
              fontFamily: serif,
              fontSize: 34,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: C.ink,
            }}
          >
            {mm}:{ss}
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: C.dim, marginTop: 6 }}>
            The lamp is lit. When time&apos;s up, tell me what you learned.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="ghost" onClick={() => setMusicOn((m) => !m)} style={{ padding: "8px 12px", fontSize: 13 }}>
            {musicOn ? "♪ Music off" : "♪ Music on"}
          </Btn>
          <Btn onClick={endEarly} style={{ padding: "8px 12px", fontSize: 13 }}>
            Done early
          </Btn>
          <Btn variant="ghost" onClick={abandon} style={{ padding: "8px 12px", fontSize: 13 }}>
            Cancel
          </Btn>
        </div>
      </div>
    </Card>
  );
}
