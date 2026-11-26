import bcrypt from "bcryptjs";
import type { PrismaClient, User } from "@prisma/client";
import { env } from "../../config/env.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import { randomToken, sha256 } from "../../lib/id.js";
import { signAccessToken, type AuthUser } from "../../middleware/auth.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: AuthUser["role"];
}

export const toPublicUser = (u: Pick<User, "id" | "email" | "name" | "role">): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: { email: string; password: string; name: string }): Promise<User> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict("An account with this email already exists");
    const passwordHash = await bcrypt.hash(input.password, 10);
    return this.prisma.user.create({ data: { email, name: input.name, passwordHash } });
  }

  async verifyCredentials(emailRaw: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
    // Constant-ish time: always run a bcrypt compare.
    const hash = user?.passwordHash ?? "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.2yL5bS0m6Gm2b6eL6gC7m1G7n7lS";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok) throw unauthorized("Invalid email or password");
    return user;
  }

  /** Upsert for federated logins (Google via NextAuth). Called only with the internal key. */
  async upsertOAuthUser(input: { email: string; name: string; provider: string }): Promise<User> {
    const email = input.email.toLowerCase();
    return this.prisma.user.upsert({
      where: { email },
      update: { name: input.name },
      create: { email, name: input.name, provider: input.provider },
    });
  }

  async issueTokens(user: User, familyId?: string): Promise<TokenPair> {
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomToken(12),
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });
    return {
      accessToken: signAccessToken({ id: user.id, email: user.email, role: user.role }),
      refreshToken,
      accessTokenExpiresAt: Date.now() + env.JWT_ACCESS_TTL_SECONDS * 1000,
      user: toPublicUser(user),
    };
  }

  /**
   * Rotating refresh tokens with reuse detection: presenting an already-rotated token
   * revokes the whole token family (likely theft).
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record) throw unauthorized("Invalid refresh token");
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized("Refresh token reuse detected");
    }
    if (record.expiresAt < new Date()) throw unauthorized("Refresh token expired");
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) throw unauthorized("Refresh token already used");
    return this.issueTokens(record.user, record.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!record) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Links anonymous browsing history to the user so recommendations warm up after login. */
  async adoptSession(userId: string, sessionId: string): Promise<number> {
    if (sessionId.startsWith("anon-")) return 0;
    const res = await this.prisma.event.updateMany({ where: { sessionId, userId: null }, data: { userId } });
    return res.count;
  }
}
