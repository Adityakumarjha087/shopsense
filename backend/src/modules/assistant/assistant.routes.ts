import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../../context.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { defineRoute } from "../../lib/http.js";
import { LlmError } from "../llm/types.js";
import { createSearchService } from "../search/search.routes.js";
import { AssistantService } from "./assistant.service.js";

const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]?.role === "user", "The last message must be from the user"),
  shownProducts: z
    .array(z.object({ id: z.string().max(40), slug: z.string().max(200), name: z.string().max(200), price: z.number().int().nonnegative() }))
    .max(8)
    .default([]),
});

export function createAssistantRouter(ctx: AppContext): Router {
  const router = Router();
  const service = new AssistantService(ctx.llm, ctx.prisma, ctx.cache, createSearchService(ctx));
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: { error: { code: "RATE_LIMITED", message: "Too many assistant requests, slow down" } },
  });

  defineRoute(
    router,
    {
      method: "post",
      path: "/chat",
      summary: "AI shopping assistant turn (tool calling: search, compare, stock, add to cart)",
      tags: ["Assistant"],
      auth: "optional",
      body: ChatBody,
      middleware: [limiter],
    },
    async ({ body }, req) => {
      try {
        return await service.chat({ messages: body.messages, shownProducts: body.shownProducts, userId: req.user?.id });
      } catch (err) {
        if (err instanceof LlmError) throw new AppError(503, "ASSISTANT_UNAVAILABLE", "The assistant is temporarily unavailable");
        throw err;
      }
    },
  );

  return router;
}
