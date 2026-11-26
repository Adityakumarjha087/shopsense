import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { RecommendationsService } from "./recommendations.service.js";

const K = z.coerce.number().int().min(1).max(24);

export function createRecommendationsRouter(ctx: AppContext): Router {
  const router = Router();
  const recs = new RecommendationsService(ctx.prisma, ctx.cache, ctx.ml);

  defineRoute(
    router,
    {
      method: "get",
      path: "/for-you",
      summary: "Personalised recommendations (A/B strategy, cold-start popularity fallback)",
      tags: ["Recommendations"],
      auth: "optional",
      query: z.object({ k: K.default(12), placement: z.string().max(40).default("home") }),
    },
    ({ query }, req) => recs.forYou({ userId: req.user?.id, sessionId: req.sessionId, k: query.k, placement: query.placement }),
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/similar/:productId",
      summary: "Similar items (content embeddings)",
      tags: ["Recommendations"],
      params: z.object({ productId: z.string().min(1).max(200) }),
      query: z.object({ k: K.default(8) }),
    },
    ({ params, query }) => recs.similar(params.productId, query.k),
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/bought-together/:productId",
      summary: "Frequently bought together (association rules)",
      tags: ["Recommendations"],
      params: z.object({ productId: z.string().min(1).max(200) }),
      query: z.object({ k: K.default(4) }),
    },
    ({ params, query }) => recs.boughtTogether(params.productId, query.k),
  );

  defineRoute(
    router,
    {
      method: "post",
      path: "/click",
      summary: "Attribute a click to a recommendation impression (A/B CTR)",
      tags: ["Recommendations"],
      auth: "optional",
      body: z.object({ requestId: z.uuid(), productId: z.string().min(1).max(40) }),
    },
    async ({ body }, req, res) => {
      const recorded = await recs.recordClick({ ...body, sessionId: req.sessionId, userId: req.user?.id });
      res.status(202);
      return { recorded };
    },
  );

  return router;
}
