"use client";

import { useEffect, useState } from "react";

// Detects iOS Safari running in the browser (not yet installed).
function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS-only legacy flag
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iOS && !standalone;
}

// Registers the service worker and shows a one-time "Add to Home Screen"
// hint on iOS, which has no install prompt of its own.
export default function PwaSetup() {
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (isIosBrowser() && !localStorage.getItem("lc-ios-hint-dismissed")) {
      setShowIosHint(true);
    }
  }, []);

  if (!showIosHint) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 50,
        background: "#222D40",
        border: "1px solid #2C3750",
        borderRadius: 12,
        padding: "12px 14px",
        color: "#EFEAE0",
        fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
        display: "flex",
        gap: 12,
        alignItems: "center",
        boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      }}
    >
      <span style={{ flex: 1 }}>
        Install Study Lamp: tap <strong>Share</strong> then{" "}
        <strong>Add to Home Screen</strong>.
      </span>
      <button
        onClick={() => {
          localStorage.setItem("lc-ios-hint-dismissed", "1");
          setShowIosHint(false);
        }}
        style={{
          background: "transparent",
          border: "1px solid #2C3750",
          borderRadius: 8,
          color: "#8A94A8",
          padding: "6px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Got it
      </button>
    </div>
  );
}
