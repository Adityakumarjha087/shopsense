import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { EventsService } from "./events.service.js";

// PURCHASE events are emitted server-side from verified payments only.
const ClientEvent = z.object({ type: z.enum(["VIEW", "ADD_TO_CART", "WISHLIST"]), productId: z.string().min(1).max(40) });

export function createEventsRouter(ctx: AppContext): Router {
  const router = Router();
  const events = new EventsService(ctx.prisma);

  defineRoute(
    router,
    {
      method: "post",
      path: "/",
      summary: "Track interaction events (view / add-to-cart / wishlist) for the recommender",
      tags: ["Events"],
      auth: "optional",
      body: z.object({ events: z.array(ClientEvent).min(1).max(50) }),
    },
    async ({ body }, req, res) => {
      const accepted = await events.track(body.events.map((e) => ({ ...e, userId: req.user?.id, sessionId: req.sessionId })));
      res.status(202);
      return { accepted };
    },
  );

  return router;
}
