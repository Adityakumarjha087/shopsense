import type { NextAuthOptions, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { serverApiUrl } from "./config";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: { id: string; email: string; name: string; role: "CUSTOMER" | "ADMIN" };
}

async function backend<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T | null> {
  const res = await fetch(`${serverApiUrl()}/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

const toUser = (t: TokenPair): User => ({
  id: t.user.id,
  email: t.user.email,
  name: t.user.name,
  role: t.user.role,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  accessTokenExpiresAt: t.accessTokenExpiresAt,
});

/** Refresh a minute before expiry; rotated refresh tokens are stored back in the JWT. */
export const REFRESH_MARGIN_MS = 60_000;

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Email",
    credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" }, sessionId: { type: "text" } },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;
      const pair = await backend<TokenPair>(
        "/auth/login",
        { email: credentials.email, password: credentials.password },
        credentials.sessionId ? { "x-session-id": credentials.sessionId } : {},
      );
      return pair ? toUser(pair) : null;
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
}

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  pages: { signIn: "/login" },
  providers,
  events: {
    // Revoke the backend refresh-token family when the user signs out.
    async signOut({ token }) {
      if (token?.refreshToken) await backend("/auth/logout", { refreshToken: token.refreshToken }).catch(() => null);
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      // Exchange the verified Google identity for backend tokens (server-to-server).
      const pair = await backend<TokenPair>(
        "/auth/oauth",
        { email: user.email, name: user.name ?? user.email, provider: "google" },
        { "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
      );
      if (!pair) return false;
      Object.assign(user, toUser(pair));
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        return { ...token, id: user.id, role: user.role, accessToken: user.accessToken, refreshToken: user.refreshToken, accessTokenExpiresAt: user.accessTokenExpiresAt };
      }
      if (token.accessTokenExpiresAt && Date.now() < token.accessTokenExpiresAt - REFRESH_MARGIN_MS) return token;
      if (!token.refreshToken) return token;
      const pair = await backend<TokenPair>("/auth/refresh", { refreshToken: token.refreshToken });
      if (!pair) return { ...token, accessToken: undefined, error: "RefreshTokenError" as const };
      return { ...token, accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessTokenExpiresAt: pair.accessTokenExpiresAt, role: pair.user.role, error: undefined };
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.user = { id: token.id ?? "", name: session.user?.name ?? "", email: session.user?.email ?? "", role: token.role ?? "CUSTOMER" };
      return session;
    },
  },
};
