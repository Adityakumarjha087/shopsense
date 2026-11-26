import { PrismaClient } from "@prisma/client";

declare global {
  var __shopsensePrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.__shopsensePrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__shopsensePrisma = prisma;
