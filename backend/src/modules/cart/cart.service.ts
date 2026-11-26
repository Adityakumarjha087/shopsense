import type { PrismaClient } from "@prisma/client";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { computeTotals, type Totals } from "../../lib/money.js";

export const MAX_LINE_QTY = 10;

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  image: string | null;
  size: string | null;
  color: string | null;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  stock: number;
}

export interface CartView {
  items: CartLine[];
  itemCount: number;
  totals: Totals;
  currency: "INR";
}

const variantInclude = {
  product: { include: { images: { orderBy: { position: "asc" as const }, take: 1 } } },
} as const;

export class CartService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Prices arbitrary (variantId, qty) pairs against the live catalogue. Unknown/inactive lines are dropped. */
  async quote(items: Array<{ variantId: string; quantity: number }>): Promise<CartView> {
    const ids = [...new Set(items.map((i) => i.variantId))];
    const variants = await this.prisma.productVariant.findMany({ where: { id: { in: ids } }, include: variantInclude });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines: CartLine[] = [];
    for (const item of items) {
      const v = byId.get(item.variantId);
      if (!v || !v.product.isActive) continue;
      const unitPrice = v.priceOverride ?? v.product.basePrice;
      const quantity = Math.min(item.quantity, MAX_LINE_QTY);
      lines.push({
        variantId: v.id,
        productId: v.productId,
        slug: v.product.slug,
        name: v.product.name,
        brand: v.product.brand,
        image: v.product.images[0]?.url ?? null,
        size: v.size,
        color: v.color,
        sku: v.sku,
        unitPrice,
        quantity,
        lineTotal: unitPrice * quantity,
        stock: v.stock,
      });
    }
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    return { items: lines, itemCount: lines.reduce((s, l) => s + l.quantity, 0), totals: computeTotals(subtotal), currency: "INR" };
  }

  private async cartId(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } });
    return cart.id;
  }

  async get(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, include: { items: { orderBy: { id: "asc" } } } });
    return this.quote(cart?.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) ?? []);
  }

  private async assertAvailable(variantId: string, quantity: number) {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: { select: { isActive: true } } } });
    if (!v || !v.product.isActive) throw notFound("Product variant");
    if (quantity > MAX_LINE_QTY) throw badRequest(`At most ${MAX_LINE_QTY} units per item`);
    if (v.stock < quantity) throw conflict(v.stock === 0 ? "This item is out of stock" : `Only ${v.stock} left in stock`, { available: v.stock });
    return v;
  }

  async add(userId: string, variantId: string, quantity: number): Promise<CartView> {
    const cartId = await this.cartId(userId);
    const existing = await this.prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } });
    const next = (existing?.quantity ?? 0) + quantity;
    await this.assertAvailable(variantId, next);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      update: { quantity: next },
      create: { cartId, variantId, quantity },
    });
    return this.get(userId);
  }

  async setQuantity(userId: string, variantId: string, quantity: number): Promise<CartView> {
    const cartId = await this.cartId(userId);
    if (quantity === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId, variantId } });
      return this.get(userId);
    }
    await this.assertAvailable(variantId, quantity);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      update: { quantity },
      create: { cartId, variantId, quantity },
    });
    return this.get(userId);
  }

  async remove(userId: string, variantId: string): Promise<CartView> {
    return this.setQuantity(userId, variantId, 0);
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  }

  /** Merges a guest cart into the user's cart after login; quantities are clamped to stock. */
  async merge(userId: string, items: Array<{ variantId: string; quantity: number }>): Promise<CartView> {
    const cartId = await this.cartId(userId);
    for (const item of items) {
      const v = await this.prisma.productVariant.findUnique({ where: { id: item.variantId } });
      if (!v || v.stock <= 0) continue;
      const existing = await this.prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId: v.id } } });
      const quantity = Math.min(Math.max(existing?.quantity ?? 0, item.quantity), v.stock, MAX_LINE_QTY);
      await this.prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId: v.id } },
        update: { quantity },
        create: { cartId, variantId: v.id, quantity },
      });
    }
    return this.get(userId);
  }
}
