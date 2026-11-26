#!/usr/bin/env node
// Reproducible README screenshots against a running stack (docker compose up -d --wait).
// Usage: node scripts/screenshots.mjs [BASE_URL]   (uses the frontend's Playwright install)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = process.argv[2] ?? "http://localhost:20600";
const API = process.env.API_URL ?? "http://localhost:20601/api/v1";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const PRODUCT = process.env.SCREENSHOT_PRODUCT ?? "voltaris-lite-matte-finish-wireless-earbuds-59";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
mkdirSync(OUT, { recursive: true });

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Wait until every <img> has decoded and no skeleton/spinner is left.
  await page.waitForFunction(
    () =>
      [...document.images].every((i) => i.complete && i.naturalWidth > 0) &&
      !document.querySelector('[aria-busy="true"], .animate-pulse, .animate-spin'),
    undefined,
    { timeout: 20_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function login(page, email, password, next = "/") {
  await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

const HIDE_FAB = '[aria-label="Open shopping assistant"]{display:none !important}';

async function shot(page, name, opts = {}, { hideAssistantButton = true } = {}) {
  if (hideAssistantButton) await page.addStyleTag({ content: HIDE_FAB });
  await settle(page);
  await page.screenshot({ path: `${OUT}${name}.png`, ...opts });
  console.log(`saved docs/screenshots/${name}.png`);
}

const browser = await chromium.launch();
try {
  // Warm the ISR cache for the product page so the first render is complete.
  await fetch(`${BASE}/p/${PRODUCT}`).catch(() => undefined);
  await fetch(`${API}/products/${PRODUCT}`).catch(() => undefined);

  // 1. Home (signed-in demo shopper → personalised "Recommended for you").
  const ctx = await browser.newContext({ viewport: DESKTOP, colorScheme: "light", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await login(page, "demo@shopsense.dev", "Demo@12345", "/");
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: /Recommended for you/i }).first().waitFor({ timeout: 20_000 });
  // Frame the personalised "Recommended for you" grid (two rows).
  await page.getByRole("heading", { name: /Recommended for you/i }).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
  await shot(page, "home");

  // 2. Product page: gallery, AI review summary, similar + frequently bought together.
  await page.goto(`${BASE}/p/${PRODUCT}`);
  await page.getByText(/Frequently bought together/i).first().waitFor({ timeout: 20_000 });
  await page.getByText(/Customers/i).first().waitFor({ timeout: 20_000 });
  await shot(page, "product", { fullPage: true, clip: { x: 0, y: 0, width: DESKTOP.width, height: 1640 } });

  // 3. Hybrid semantic search with a natural-language price constraint.
  await page.goto(`${BASE}/search?q=${encodeURIComponent("cozy winter outfit under ₹3000")}`);
  await page.locator("article").first().waitFor({ timeout: 20_000 });
  await shot(page, "search");

  // 4. AI shopping assistant: search, then compare via tool calls.
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Open shopping assistant" }).click();
  const input = page.getByLabel("Message the shopping assistant");
  await input.fill("running shoes under 4000");
  await input.press("Enter");
  await page.getByTestId("assistant-product").first().waitFor({ timeout: 20_000 });
  await input.fill("compare the first two");
  await input.press("Enter");
  await page.getByTestId("comparison-table").waitFor({ timeout: 20_000 });
  await shot(page, "assistant", {}, { hideAssistantButton: false });
  await ctx.close();

  // 5. Admin dashboard: KPIs, sales charts, A/B CTR and model metrics.
  const adminCtx = await browser.newContext({ viewport: DESKTOP, colorScheme: "light" });
  const admin = await adminCtx.newPage();
  await login(admin, "admin@shopsense.dev", "Admin@12345", "/admin");
  await admin.goto(`${BASE}/admin`);
  await admin.locator(".recharts-surface").first().waitFor({ timeout: 30_000 });
  await admin.waitForTimeout(1500); // chart entry animations
  await shot(admin, "admin", { fullPage: true });
  await adminCtx.close();

  // 6. Dark mode (next-themes honours the stored preference).
  const darkCtx = await browser.newContext({ viewport: DESKTOP, colorScheme: "dark" });
  await darkCtx.addInitScript(() => localStorage.setItem("theme", "dark"));
  const dark = await darkCtx.newPage();
  await dark.goto(`${BASE}/p/${PRODUCT}`);
  await dark.getByText(/Frequently bought together/i).first().waitFor({ timeout: 20_000 });
  await shot(dark, "product-dark");
  await darkCtx.close();

  // 7. Mobile.
  const mobileCtx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
  const mobile = await mobileCtx.newPage();
  await mobile.goto(`${BASE}/p/${PRODUCT}`);
  await mobile.getByTestId("add-to-cart").waitFor({ timeout: 20_000 });
  // Show the tail of the gallery, title, price, variant picker and add-to-cart.
  await mobile.getByRole("heading", { level: 1 }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 330));
  await shot(mobile, "mobile-product");
  await mobileCtx.close();
} finally {
  await browser.close();
}
