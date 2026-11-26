import { Prisma, type PrismaClient } from "@prisma/client";
import { REVENUE_STATUSES } from "../orders/state-machine.js";

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async sales(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const revenueStatuses = Prisma.join(REVENUE_STATUSES.map((s) => Prisma.sql`${s}::"OrderStatus"`));
    const [daily, top, byCategory, statusCounts, totals] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: Date; revenue: bigint; orders: bigint }>>`
        SELECT date_trunc('day', created_at) AS day, SUM(total)::bigint AS revenue, COUNT(*)::bigint AS orders
        FROM orders WHERE created_at >= ${since} AND status IN (${revenueStatuses})
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<Array<{ product_id: string; name: string; units: bigint; revenue: bigint }>>`
        SELECT oi.product_id, MIN(oi.name) AS name, SUM(oi.quantity)::bigint AS units, SUM(oi.quantity * oi.unit_price)::bigint AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${since} AND o.status IN (${revenueStatuses})
        GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 10`,
      this.prisma.$queryRaw<Array<{ category: string; revenue: bigint }>>`
        SELECT c.name AS category, SUM(oi.quantity * oi.unit_price)::bigint AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
        WHERE o.created_at >= ${since} AND o.status IN (${revenueStatuses})
        GROUP BY c.name ORDER BY revenue DESC`,
      this.prisma.order.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: since }, status: { in: REVENUE_STATUSES } }, _sum: { total: true }, _count: { _all: true } }),
    ]);
    const revenue = totals._sum.total ?? 0;
    const orders = totals._count._all;
    return {
      days,
      revenue,
      orders,
      averageOrderValue: orders ? Math.round(revenue / orders) : 0,
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), revenue: Number(d.revenue), orders: Number(d.orders) })),
      topProducts: top.map((t) => ({ productId: t.product_id, name: t.name, units: Number(t.units), revenue: Number(t.revenue) })),
      revenueByCategory: byCategory.map((c) => ({ category: c.category, revenue: Number(c.revenue) })),
      statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    };
  }

  async inventoryAlerts() {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; sku: string; size: string | null; color: string | null; stock: number; low_stock_threshold: number; product_id: string; name: string; slug: string }>
    >`
      SELECT v.id, v.sku, v.size, v.color, v.stock, v.low_stock_threshold, p.id AS product_id, p.name, p.slug
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.is_active AND v.stock <= v.low_stock_threshold
      ORDER BY v.stock ASC, p.name ASC LIMIT 200`;
    return {
      count: rows.length,
      items: rows.map((r) => ({
        variantId: r.id,
        sku: r.sku,
        size: r.size,
        color: r.color,
        stock: r.stock,
        threshold: r.low_stock_threshold,
        severity: r.stock <= 0 ? "out_of_stock" : "low",
        product: { id: r.product_id, name: r.name, slug: r.slug },
      })),
    };
  }
}
