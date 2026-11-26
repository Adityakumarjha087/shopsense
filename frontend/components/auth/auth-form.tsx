"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSessionId } from "@/lib/session-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode, googleEnabled }: { mode: "login" | "register"; googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("callbackUrl") ?? "/";
  // Only allow same-origin relative redirects.
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: form });
      }
      const res = await signIn("credentials", { redirect: false, email: form.email, password: form.password, sessionId: getSessionId() });
      if (!res || res.error) {
        setError("Invalid email or password");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details && Array.isArray(err.details) ? (err.details as Array<{ message: string }>).map((d) => d.message).join(". ") : err.message) : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        {mode === "login" && <p className="mt-1 text-sm text-muted-foreground">Demo: demo@shopsense.dev / Demo@12345</p>}
      </div>
      <form onSubmit={submit} className="space-y-4" aria-label={mode === "login" ? "Sign in" : "Register"}>
        {mode === "register" && (
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={mode === "register" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="mt-1"
          />
          {mode === "register" && <p className="mt-1 text-xs text-muted-foreground">At least 8 characters with a letter and a digit.</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      {googleEnabled && (
        <Button variant="outline" className="w-full" onClick={() => void signIn("google", { callbackUrl })}>
          Continue with Google
        </Button>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {mode === "login" ? (
          <>New here? <Link className="text-primary underline" href={`/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Create an account</Link></>
        ) : (
          <>Already registered? <Link className="text-primary underline" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Sign in</Link></>
        )}
      </p>
    </div>
  );
}
