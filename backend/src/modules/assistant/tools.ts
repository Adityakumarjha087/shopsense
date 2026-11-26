import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ToolDefinition } from "../llm/types.js";
import type { ProductCard } from "../catalog/catalog.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { CartService } from "../cart/cart.service.js";
import type { SearchQueryInput } from "../search/search.routes.js";
import { formatInr } from "../../lib/money.js";
import type { Cache } from "../../lib/cache.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_products",
    description:
      "Search the ShopSense catalogue (hybrid keyword + semantic). Use natural language; price limits in rupees go in max_price_inr/min_price_inr.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the shopper is looking for, e.g. 'warm winter jacket'" },
        max_price_inr: { type: "number", description: "Maximum price in rupees" },
        min_price_inr: { type: "number", description: "Minimum price in rupees" },
        category: { type: "string", description: "Category slug filter, e.g. 'mens-clothing'" },
        in_stock_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_product_details",
    description: "Full details (description, attributes, variants, rating) of one product by id or slug.",
    parameters: {
      type: "object",
      properties: { product: { type: "string", description: "Product id or slug" } },
      required: ["product"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_products",
    description: "Side-by-side comparison of 2-4 products (price, rating, key attributes, stock).",
    parameters: {
      type: "object",
      properties: { products: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Product ids or slugs" } },
      required: ["products"],
      additionalProperties: false,
    },
  },
  {
    name: "check_stock",
    description: "Check stock for a product, optionally for a specific size/colour.",
    parameters: {
      type: "object",
      properties: { product: { type: "string" }, size: { type: "string" }, color: { type: "string" } },
      required: ["product"],
      additionalProperties: false,
    },
  },
  {
    name: "add_to_cart",
    description: "Add a product variant to the shopper's cart. If size/colour are omitted the first in-stock variant is used.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string" },
        size: { type: "string" },
        color: { type: "string" },
        quantity: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["product"],
      additionalProperties: false,
    },
  },
];

const SearchArgs = z.object({
  query: z.string().min(1).max(200),
  max_price_inr: z.number().positive().optional(),
  min_price_inr: z.number().nonnegative().optional(),
  category: z.string().max(80).optional(),
  in_stock_only: z.boolean().optional(),
  limit: z.number().int().min(1).max(8).optional(),
});
const ProductArg = z.object({ product: z.string().min(1).max(200) });
const CompareArgs = z.object({ products: z.array(z.string().min(1).max(200)).min(2).max(4) });
const StockArgs = ProductArg.extend({ size: z.string().max(20).optional(), color: z.string().max(40).optional() });
const CartArgs = StockArgs.extend({ quantity: z.number().int().min(1).max(10).optional() });

export interface CartAction {
  type: "add";
  variantId: string;
  productId: string;
  name: string;
  quantity: number;
  size: string | null;
  color: string | null;
  /** True when the server cart was updated (signed-in user); guests apply it client-side. */
  persisted: boolean;
}

export interface ToolEffects {
  products: ProductCard[];
  cartActions: CartAction[];
  comparison?: Array<Record<string, unknown>>;
}

export interface ToolContext {
  prisma: PrismaClient;
  cache: Cache;
  search: (q: SearchQueryInput) => Promise<{ items: ProductCard[] }>;
  userId?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/^uk\s*/, "").replace(/\s+/g, "");
/** Case/format-insensitive option match ("uk 9" == "UK 9" == "9"). */
const eqi = (a: string | null | undefined, b: string | undefined) => !!a && !!b && norm(a) === norm(b);

export class AssistantTools {
  private readonly catalog: CatalogService;
  private readonly cart: CartService;

  constructor(private readonly ctx: ToolContext) {
    this.catalog = new CatalogService(ctx.prisma, ctx.cache);
    this.cart = new CartService(ctx.prisma);
  }

  /** Executes a tool call; returns a JSON string for the model plus UI side effects. Never throws. */
  async execute(name: string, rawArgs: Record<string, unknown>, effects: ToolEffects): Promise<{ content: string; isError: boolean }> {
    try {
      const result = await this.dispatch(name, rawArgs, effects);
      return { content: JSON.stringify(result), isError: false };
    } catch (err) {
      const message = err instanceof z.ZodError ? `Invalid arguments: ${err.issues.map((i) => i.message).join("; ")}` : (err as Error).message;
      return { content: JSON.stringify({ error: message }), isError: true };
    }
  }

  private async dispatch(name: string, rawArgs: Record<string, unknown>, effects: ToolEffects): Promise<unknown> {
    switch (name) {
      case "search_products": {
        const a = SearchArgs.parse(rawArgs);
        const res = await this.ctx.search({
          q: a.query,
          category: a.category ? [a.category] : undefined,
          maxPrice: a.max_price_inr ? Math.round(a.max_price_inr * 100) : undefined,
          minPrice: a.min_price_inr ? Math.round(a.min_price_inr * 100) : undefined,
          inStock: a.in_stock_only,
          sort: "relevance",
          page: 1,
          pageSize: a.limit ?? 5,
          brand: undefined,
          color: undefined,
          minRating: undefined,
        });
        effects.products.push(...res.items);
        return {
          count: res.items.length,
          products: res.items.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            price: formatInr(p.price),
            rating: p.ratingAvg,
            reviews: p.ratingCount,
            category: p.category.name,
            in_stock: p.inStock,
          })),
        };
      }
      case "get_product_details": {
        const { product } = ProductArg.parse(rawArgs);
        const d = await this.catalog.detail(product);
        const [card] = await this.catalog.cardsByIds([d.id]);
        if (card) effects.products.push(card);
        return {
          id: d.id,
          name: d.name,
          brand: d.brand,
          price: formatInr(d.price),
          rating: d.ratingAvg,
          reviews: d.ratingCount,
          description: d.description,
          attributes: d.attributes,
          variants: d.variants.map((v) => ({ size: v.size, color: v.color, price: formatInr(v.price), in_stock: v.inStock })),
          review_summary: d.reviewSummary?.summary ?? null,
        };
      }
      case "compare_products": {
        const { products } = CompareArgs.parse(rawArgs);
        const details = await Promise.all(products.map((p) => this.catalog.detail(p)));
        const cards = await this.catalog.cardsByIds(details.map((d) => d.id));
        effects.products.push(...cards);
        const rows = details.map((d) => ({
          id: d.id,
          name: d.name,
          brand: d.brand,
          price: d.price,
          price_display: formatInr(d.price),
          rating: d.ratingAvg,
          reviews: d.ratingCount,
          category: d.category.name,
          in_stock: d.variants.some((v) => v.inStock),
          attributes: d.attributes,
        }));
        effects.comparison = rows;
        const cheapest = [...rows].sort((a, b) => a.price - b.price)[0]!;
        const best = [...rows].sort((a, b) => b.rating - a.rating || b.reviews - a.reviews)[0]!;
        return { products: rows, cheapest: cheapest.name, best_rated: best.name };
      }
      case "check_stock": {
        const a = StockArgs.parse(rawArgs);
        const d = await this.catalog.detail(a.product);
        const fresh = await this.ctx.prisma.productVariant.findMany({ where: { productId: d.id } });
        const matching = fresh.filter((v) => (!a.size || eqi(v.size, a.size)) && (!a.color || eqi(v.color, a.color)));
        return {
          product: d.name,
          requested: { size: a.size ?? null, color: a.color ?? null },
          available: matching.some((v) => v.stock > 0),
          variants: matching.map((v) => ({ size: v.size, color: v.color, stock: v.stock, status: v.stock === 0 ? "out_of_stock" : v.stock <= v.lowStockThreshold ? "low_stock" : "in_stock" })),
        };
      }
      case "add_to_cart": {
        const a = CartArgs.parse(rawArgs);
        const d = await this.catalog.detail(a.product);
        const variants = await this.ctx.prisma.productVariant.findMany({ where: { productId: d.id }, orderBy: [{ color: "asc" }, { size: "asc" }] });
        const candidates = variants.filter((v) => (!a.size || eqi(v.size, a.size)) && (!a.color || eqi(v.color, a.color)));
        const variant = candidates.find((v) => v.stock >= (a.quantity ?? 1));
        if (!variant) {
          return { added: false, reason: candidates.length ? "Requested option is out of stock" : "No such size/colour for this product", options: variants.map((v) => ({ size: v.size, color: v.color, in_stock: v.stock > 0 })) };
        }
        const quantity = a.quantity ?? 1;
        let persisted = false;
        if (this.ctx.userId) {
          await this.cart.add(this.ctx.userId, variant.id, quantity);
          persisted = true;
        }
        effects.cartActions.push({ type: "add", variantId: variant.id, productId: d.id, name: d.name, quantity, size: variant.size, color: variant.color, persisted });
        return { added: true, product: d.name, size: variant.size, color: variant.color, quantity, unit_price: formatInr(variant.priceOverride ?? d.basePrice) };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }
}
