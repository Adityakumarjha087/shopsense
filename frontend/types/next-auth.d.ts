import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
    user: { id: string; name: string; email: string; role: "CUSTOMER" | "ADMIN" };
  }
  interface User {
    id: string;
    role: "CUSTOMER" | "ADMIN";
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "CUSTOMER" | "ADMIN";
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
    error?: "RefreshTokenError";
  }
}
