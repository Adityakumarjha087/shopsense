import { expect, test } from "@playwright/test";

test("admin route requires sign-in and shows analytics, A/B test and model metrics", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL ?? "admin@shopsense.dev");
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD ?? "Admin@12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("kpi-Revenue")).toHaveText(/₹/);
  await expect(page.getByText(/A\/B test:/)).toBeVisible();
  await expect(page.getByTestId("ctr-A")).toBeVisible();
  await expect(page.getByRole("cell", { name: /0\.\d{3}/ }).first()).toBeVisible();
  await expect(page.getByText("Revenue by day")).toBeVisible();

  await page.getByRole("link", { name: "Orders" }).first().click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(page.getByTestId("order-status").first()).toBeVisible();
});
