import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { CATEGORIES } from "./catalog-data.js";
import { generateInteractions, generateProducts, generateReviews, generateUsers, rng } from "./generate.js";
import { DEFAULT_VARIANTS, REC_EXPERIMENT_KEY } from "../modules/recommendations/experiments.js";

export const DEMO_ADMIN = { email: "admin@shopsense.dev", password: "Admin@12345", name: "Store Admin" };
export const DEMO_CUSTOMER = { email: "demo@shopsense.dev", password: "Demo@12345", name: "Demo Shopper" };

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function seed(prisma: PrismaClient, opts: { perKind?: number; users?: number; seed?: number } = {}) {
  const r = rng(opts.seed ?? 42);
  const started = Date.now();

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE recommendation_events, experiments, webhook_events, events, order_status_events, order_items, orders,
     wishlist_items, cart_items, carts, review_summaries, reviews, product_images, product_variants, products, categories,
     refresh_tokens, users RESTART IDENTITY CASCADE`,
  );

  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.category.create({ data: { slug: c.slug, name: c.name, description: c.description } });
    categoryIds.set(c.slug, row.id);
  }

  const products = generateProducts(r, opts.perKind ?? 10);
  const reviews = generateReviews(r, products);
  const ratingAgg = new Map<string, { sum: number; n: number }>();
  for (const rev of reviews) {
    const a = ratingAgg.get(rev.productId) ?? { sum: 0, n: 0 };
    a.sum += rev.rating;
    a.n += 1;
    ratingAgg.set(rev.productId, a);
  }

  await chunked(products, 200, (chunk) =>
    prisma.product.createMany({
      data: chunk.map((p) => {
        const agg = ratingAgg.get(p.id);
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          brand: p.brand,
          categoryId: categoryIds.get(p.categorySlug)!,
          basePrice: p.basePrice,
          tags: p.tags,
          attributes: p.attributes,
          ratingAvg: agg ? agg.sum / agg.n : 0,
          ratingCount: agg?.n ?? 0,
          createdAt: p.createdAt,
        };
      }),
    }),
  );
  await chunked(products.flatMap((p) => p.images.map((i) => ({ ...i, productId: p.id }))), 1000, (chunk) => prisma.productImage.createMany({ data: chunk }));
  await chunked(products.flatMap((p) => p.variants.map((v) => ({ ...v, productId: p.id }))), 1000, (chunk) => prisma.productVariant.createMany({ data: chunk }));

  const [adminHash, demoHash] = await Promise.all([bcrypt.hash(DEMO_ADMIN.password, 10), bcrypt.hash(DEMO_CUSTOMER.password, 10)]);
  const users = generateUsers(r, opts.users ?? 400);
  // The demo shopper is a regular synthetic user (with history) that can log in.
  users[0] = { ...users[0]!, email: DEMO_CUSTOMER.email, name: DEMO_CUSTOMER.name, favouriteCategories: ["mens-clothing", "footwear"] };
  await prisma.user.create({ data: { email: DEMO_ADMIN.email, name: DEMO_ADMIN.name, passwordHash: adminHash, role: "ADMIN" } });
  await chunked(users, 500, (chunk) =>
    prisma.user.createMany({
      data: chunk.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        provider: u.email === DEMO_CUSTOMER.email ? "credentials" : "seed",
        passwordHash: u.email === DEMO_CUSTOMER.email ? demoHash : null,
      })),
    }),
  );

  const userIdByIndex = users.map((u) => u.id);
  const reviewRows = reviews.map((rev) => ({ ...rev, userId: r.chance(0.5) ? r.pick(userIdByIndex) : null }));
  await chunked(reviewRows, 2000, (chunk) => prisma.review.createMany({ data: chunk }));

  const { events, orders } = generateInteractions(r, users, products);
  await chunked(events, 5000, (chunk) => prisma.event.createMany({ data: chunk }));
  await chunked(orders, 500, (chunk) =>
    prisma.order.createMany({
      data: chunk.map((o) => ({
        id: o.id,
        userId: o.userId,
        status: o.status,
        subtotal: o.subtotal,
        shipping: o.shipping,
        tax: o.tax,
        total: o.total,
        currency: "INR",
        paymentProvider: "mock",
        paymentIntentId: `pi_seed_${o.id.slice(0, 18)}`,
        shippingAddress: o.address,
        paidAt: o.createdAt,
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      })),
    }),
  );
  await chunked(orders.flatMap((o) => o.items.map((i) => ({ ...i, orderId: o.id }))), 2000, (chunk) => prisma.orderItem.createMany({ data: chunk }));
  const statusPath: Record<string, Array<"PENDING" | "PAID" | "SHIPPED" | "DELIVERED">> = {
    PAID: ["PENDING", "PAID"],
    SHIPPED: ["PENDING", "PAID", "SHIPPED"],
    DELIVERED: ["PENDING", "PAID", "SHIPPED", "DELIVERED"],
  };
  const history = orders.flatMap((o) =>
    (statusPath[o.status] ?? ["PENDING"]).map((to, i, arr) => ({
      orderId: o.id,
      fromStatus: i === 0 ? null : arr[i - 1]!,
      toStatus: to,
      reason: i === 0 ? "Order placed" : to === "PAID" ? "Payment confirmed via webhook" : `Marked ${to.toLowerCase()}`,
      createdAt: new Date(o.createdAt.getTime() + i * 86_400_000),
    })),
  );
  await chunked(history, 2000, (chunk) => prisma.orderStatusEvent.createMany({ data: chunk }));

  await prisma.experiment.create({ data: { key: REC_EXPERIMENT_KEY, name: "Recommended-for-you strategy", variants: DEFAULT_VARIANTS } });

  return {
    categories: CATEGORIES.length,
    products: products.length,
    variants: products.reduce((s, p) => s + p.variants.length, 0),
    reviews: reviews.length,
    users: users.length + 1,
    events: events.length,
    orders: orders.length,
    ms: Date.now() - started,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (process.argv.includes("--if-empty") && (await prisma.product.count()) > 0) {
      console.log("Database already seeded; skipping.");
      return;
    }
    const stats = await seed(prisma);
    console.log("Seed complete:", JSON.stringify(stats));
    console.log(`Admin login: ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}`);
    console.log(`Customer login: ${DEMO_CUSTOMER.email} / ${DEMO_CUSTOMER.password}`);
    const mlUrl = process.env.ML_SERVICE_URL;
    if (mlUrl && !process.argv.includes("--no-train")) {
      // The ML service may still be booting; retry so the first model sees the full dataset.
      for (let attempt = 1; attempt <= 12; attempt++) {
        try {
          const res = await fetch(`${mlUrl.replace(/\/$/, "")}/train`, { method: "POST", signal: AbortSignal.timeout(180_000) });
          console.log(`ML training triggered: HTTP ${res.status}`);
          break;
        } catch (err) {
          if (attempt === 12) console.log(`ML service not reachable (${(err as Error).message}); it will train on its own schedule.`);
          else await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed[/\\]index\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
