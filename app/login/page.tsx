"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!password) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.replace(next);
      router.refresh();
    } else {
      setError("Incorrect password");
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--signal)] text-xl font-black text-white">R</span>
          <h1 className="mt-3 font-display text-xl font-bold">Reel Trax</h1>
          <p className="text-sm text-[var(--muted)]">Enter your password to continue</p>
        </div>
        <div className="card p-5">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            className="w-full px-3 py-2.5 text-sm"
          />
          {error && <p className="mt-2 text-sm text-[var(--bad)]">{error}</p>}
          <button
            onClick={submit}
            disabled={loading || !password}
            className="btn btn-primary mt-3 w-full justify-center py-2.5 disabled:opacity-60"
          >
            {loading ? "Checking…" : "Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
