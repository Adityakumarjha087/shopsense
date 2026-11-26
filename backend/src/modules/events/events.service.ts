import type { EventType, PrismaClient } from "@prisma/client";

export interface TrackInput {
  type: EventType;
  productId: string;
  userId?: string;
  sessionId: string;
}

export class EventsService {
  constructor(private readonly prisma: PrismaClient) {}

  async track(events: TrackInput[]): Promise<number> {
    if (!events.length) return 0;
    const ids = [...new Set(events.map((e) => e.productId))];
    const existing = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const valid = new Set(existing.map((p) => p.id));
    const rows = events.filter((e) => valid.has(e.productId));
    if (!rows.length) return 0;
    const res = await this.prisma.event.createMany({
      data: rows.map((e) => ({ type: e.type, productId: e.productId, userId: e.userId ?? null, sessionId: e.sessionId })),
    });
    return res.count;
  }

  /** Most recent distinct products the user/session interacted with (for fold-in recommendations). */
  async recentProductIds(args: { userId?: string; sessionId: string; limit: number }): Promise<string[]> {
    const rows = await this.prisma.event.findMany({
      where: args.userId ? { OR: [{ userId: args.userId }, { sessionId: args.sessionId }] } : { sessionId: args.sessionId },
      orderBy: { createdAt: "desc" },
      select: { productId: true },
      take: args.limit * 4,
    });
    return [...new Set(rows.map((r) => r.productId))].slice(0, args.limit);
  }

  async purchasedProductIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.event.findMany({
      where: { userId, type: "PURCHASE" },
      select: { productId: true },
      distinct: ["productId"],
      take: 200,
    });
    return rows.map((r) => r.productId);
  }
}
