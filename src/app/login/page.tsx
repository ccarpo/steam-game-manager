"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [from, setFrom] = useState("/");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "setup">("login");

  useEffect(() => {
    setFrom(new URLSearchParams(window.location.search).get("from") || "/");
    // Ask the server whether any account exists so first-run can be setup.
    fetch("/api/auth/status")
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          if (!d.hasUsers) setMode("setup");
        }
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({ error: "Network error" }));
    if (!res.ok) {
      setError(data.error || "Login failed");
      return;
    }
    router.replace(from);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-xl p-6 shadow-lg">
        <h1 className="text-lg font-semibold mb-1">🔒 Steam Game Manager</h1>
        <p className="text-xs text-muted mb-5">
          {mode === "setup" ? "Create the first admin account." : "Sign in to continue."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[10px] text-muted mb-1">Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
              autoFocus autoComplete="username" required />
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
              autoComplete={mode === "setup" ? "new-password" : "current-password"} required />
          </div>
          {error && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">{error}</div>}
          <button type="submit" className="w-full py-2 rounded bg-accent text-background text-sm font-medium hover:bg-accent/90 transition-colors">
            {mode === "setup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
