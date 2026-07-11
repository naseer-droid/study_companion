"use client";

import { useState, CSSProperties, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Palette mirrors components/StudyLamp.tsx ("study lamp at night", handoff §7).
const C = {
  bg: "#141A26",
  panel: "#1C2433",
  line: "#2C3750",
  ink: "#EFEAE0",
  dim: "#8A94A8",
  amber: "#F5B34E",
  amberSoft: "rgba(245,179,78,0.14)",
  sage: "#8FBF7F",
  danger: "#D9776B",
};
const serif = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const sans = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: C.bg,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "12px 12px",
  color: C.ink,
  fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
  fontFamily: sans,
  outline: "none",
};

type Mode = "signin" | "signup" | "code";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    params.get("error") === "confirm" ? "That confirmation link didn't work — it may have expired. Try signing in, or sign up again." : ""
  );
  const [notice, setNotice] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        router.push("/");
        router.refresh();
      } else if (mode === "signup") {
        // Friendly pre-check; the DB trigger is the real enforcement.
        const { data: allowed } = await supabase.rpc("email_is_allowed", {
          check_email: email,
        });
        if (allowed === false) {
          throw new Error("Signups are invite-only. Ask Naseer to add your email.");
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/confirm` },
        });
        if (error) throw new Error(error.message);
        setNotice("Almost there — check your email and tap the confirmation link.");
      } else if (mode === "code") {
        if (!otpSent) {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false }, // codes sign in existing accounts only
          });
          if (error) throw new Error(error.message);
          setOtpSent(true);
          setNotice("Check your email for a 6-digit code.");
        } else {
          const { error } = await supabase.auth.verifyOtp({
            email,
            token: otp.trim(),
            type: "email",
          });
          if (error) throw new Error(error.message);
          router.push("/");
          router.refresh();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    }
    setBusy(false);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
    setNotice("");
    setOtpSent(false);
    setOtp("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.ink,
        fontFamily: sans,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              margin: "0 auto 12px",
              borderRadius: "50%",
              background: `radial-gradient(circle at 50% 60%, rgba(255,222,166,0.9) 0%, rgba(245,179,78,0.7) 22%, rgba(120,86,38,0.4) 40%, #202A3C 62%, #171F2E 100%)`,
              border: "1px solid #33405C",
              boxShadow: "0 0 22px rgba(245,179,78,0.35), inset 0 2px 6px rgba(0,0,0,0.45)",
            }}
          />
          <h1 style={{ fontFamily: serif, fontSize: 28, fontWeight: 500, margin: 0 }}>Study Lamp</h1>
          <div style={{ color: C.dim, fontSize: 14, marginTop: 4 }}>A companion that learns alongside you</div>
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Sign up"],
                ["code", "Email me a code"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                style={{
                  fontFamily: sans,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: `1px solid ${mode === m ? C.amber : C.line}`,
                  background: mode === m ? C.amberSoft : "transparent",
                  color: mode === m ? C.amber : C.dim,
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
              disabled={mode === "code" && otpSent}
            />
            {(mode === "signin" || mode === "signup") && (
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Choose a password (8+ characters)" : "Password"}
                style={inputStyle}
              />
            )}
            {mode === "code" && otpSent && (
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                style={{ ...inputStyle, letterSpacing: "0.2em" }}
              />
            )}
            <button
              type="submit"
              disabled={busy}
              style={{
                fontFamily: sans,
                fontSize: 15,
                fontWeight: 600,
                borderRadius: 10,
                padding: "12px 16px",
                border: "none",
                background: C.amber,
                color: "#1B1406",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
                marginTop: 4,
              }}
            >
              {busy
                ? "One moment..."
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : otpSent
                      ? "Verify code"
                      : "Send code"}
            </button>
          </form>

          {error && <div style={{ marginTop: 12, color: C.danger, fontSize: 13, lineHeight: 1.5 }}>{error}</div>}
          {notice && <div style={{ marginTop: 12, color: C.sage, fontSize: 13, lineHeight: 1.5 }}>{notice}</div>}

          <div style={{ marginTop: 14, color: C.dim, fontSize: 12, lineHeight: 1.6 }}>
            {mode === "signin" && "Forgot your password? Use “Email me a code” instead."}
            {mode === "signup" && "Invite-only: your email needs to be on the list first."}
            {mode === "code" && "Signs you into an existing account — no password needed."}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary at build time.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
