import { expect, test } from "@playwright/test";

const DEMO = { email: process.env.E2E_EMAIL ?? "demo@shopsense.dev", password: process.env.E2E_PASSWORD ?? "Demo@12345" };

test("browse → search → add to cart → sign in → checkout → mock pay → order PAID", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shopping that understands you." })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Popular right now/ })).toBeVisible();

  // Search
  const search = page.getByRole("combobox", { name: "Search products" }).first();
  await search.fill("running shoes");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=running/);
  await expect(page.getByRole("heading", { name: /Results for “running shoes”/ })).toBeVisible();

  // Open the first product that is in stock
  const cards = page.locator("article").filter({ hasNotText: "Out of stock" });
  await cards.first().getByRole("link").click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Pick an enabled size (if the product has sizes) and add to cart
  const sizes = page.getByRole("radiogroup", { name: "Size" }).getByRole("radio");
  if ((await sizes.count()) > 0) {
    const enabled = sizes.and(page.locator(":enabled"));
    await enabled.last().click();
  }
  const add = page.getByTestId("add-to-cart");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("button", { name: "Added to cart" })).toBeVisible();
  await expect(page.getByTestId("cart-count")).toHaveText(/\d+/);

  // Cart → sign in to checkout
  await page.goto("/cart");
  await expect(page.getByTestId("cart-line").first()).toBeVisible();
  await page.getByRole("button", { name: /Sign in to checkout|Proceed to checkout/ }).click();
  await page.waitForURL(/\/(login|checkout)/);
  if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/checkout/);

  // Shipping address (guest cart was merged into the server cart on login)
  await page.getByLabel("Full name").fill("Demo Shopper");
  await page.getByLabel("Address line 1").fill("12 MG Road");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("State").fill("Karnataka");
  await page.getByLabel("PIN code").fill("560001");
  await page.getByLabel("Phone").fill("9876543210");
  await page.getByTestId("place-order").click();

  // Mock payment with the Stripe success test card
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
  await page.getByLabel("Card number").fill("4242 4242 4242 4242");
  await page.getByTestId("pay-now").click();

  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByTestId("order-status")).toHaveText("Paid");
  await expect(page.getByText("Payment confirmed via webhook")).toBeVisible();
});

test("AI assistant answers with product cards", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open shopping assistant" }).click();
  const input = page.getByLabel("Message the shopping assistant");
  await input.fill("running shoes under 4000");
  await input.press("Enter");
  await expect(page.getByTestId("assistant-product").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/options I found/);

  await input.fill("compare the first two");
  await input.press("Enter");
  await expect(page.getByTestId("comparison-table")).toBeVisible();
});
