import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductCard, ProductGrid } from "@/components/product/product-card";
import { VariantPicker, findVariant } from "@/components/product/variant-picker";
import { ABTestPanel } from "@/components/admin/ab-panel";
import { MlPanel } from "@/components/admin/ml-panel";
import { TotalsBox } from "@/components/cart/totals";
import { OrderStatusBadge } from "@/components/cart/order-status";
import { Rating } from "@/components/product/rating";
import type { ExperimentStats } from "@/lib/types";
import { product, variants } from "./fixtures";

describe("ProductCard", () => {
  it("renders name, brand, INR price and a link to the product", () => {
    render(<ProductCard product={product()} />);
    expect(screen.getByRole("link", { name: /Merino Wool Sweater/ })).toHaveAttribute("href", "/p/northloom-classic-merino-wool-sweater-1");
    expect(screen.getByText("₹2,499")).toBeInTheDocument();
    expect(screen.getByText("Northloom")).toBeInTheDocument();
    expect(screen.queryByText(/Out of stock/)).not.toBeInTheDocument();
  });

  it("flags out-of-stock products and reports clicks", async () => {
    const onSelect = vi.fn();
    render(<ProductCard product={product({ inStock: false })} onSelect={onSelect} />);
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    const link = screen.getByRole("link");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("renders a grid of products", () => {
    render(<ProductGrid products={[product(), product({ id: "p2", slug: "x", name: "Other" })]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Rating", () => {
  it("has an accessible label", () => {
    render(<Rating value={4.26} count={12} />);
    expect(screen.getByLabelText("Rated 4.3 out of 5 from 12 reviews")).toBeInTheDocument();
  });
});

describe("VariantPicker", () => {
  it("disables out-of-stock sizes and colours", () => {
    render(<VariantPicker variants={variants} size="M" color="Navy" onChange={() => undefined} />);
    expect(screen.getByRole("radio", { name: "S" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "M" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "M" })).toHaveAttribute("aria-checked", "true");
    // Every Olive variant is out of stock → colour disabled.
    expect(screen.getByRole("radio", { name: "Olive" })).toBeDisabled();
  });

  it("emits the selected size", () => {
    const onChange = vi.fn();
    render(<VariantPicker variants={variants} size="M" color="Navy" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "L" }));
    expect(onChange).toHaveBeenCalledWith({ size: "L", color: "Navy" });
  });

  it("finds the variant for a selection", () => {
    expect(findVariant(variants, "L", "Navy")?.id).toBe("v3");
    expect(findVariant(variants, "XL", "Navy")).toBeUndefined();
  });
});

const stats: ExperimentStats = {
  experiment: { key: "rec_strategy", name: "Recommended-for-you strategy", isActive: true, variants: [] },
  variants: [
    { variant: "A", strategy: "als", weight: 50, requests: 40, impressions: 400, clicks: 20, ctr: 0.05 },
    { variant: "B", strategy: "item_knn", weight: 50, requests: 40, impressions: 400, clicks: 36, ctr: 0.09 },
  ],
  significance: { z: 2.21, pValue: 0.027, significant: true },
};

describe("ABTestPanel", () => {
  it("shows CTR per variant and significance", () => {
    render(<ABTestPanel stats={stats} />);
    expect(screen.getByTestId("ctr-A")).toHaveTextContent("5.00%");
    expect(screen.getByTestId("ctr-B")).toHaveTextContent("9.00%");
    expect(screen.getByText(/statistically significant/)).toBeInTheDocument();
    expect(screen.getByText("B ★")).toBeInTheDocument();
  });

  it("toggles the experiment", async () => {
    const onToggle = vi.fn();
    render(<ABTestPanel stats={stats} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});

describe("MlPanel", () => {
  it("renders offline metrics and triggers retraining", async () => {
    const onRetrain = vi.fn();
    render(
      <MlPanel
        model={{ version: "v1", metrics: { als: { precision_at_k: 0.1128, recall_at_k: 0.2, ndcg_at_k: 0.18, hit_rate_at_k: 0.64, coverage: 0.87, k: 10 } } }}
        onRetrain={onRetrain}
        busy={false}
      />,
    );
    expect(screen.getByText("0.113")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retrain now" }));
    expect(onRetrain).toHaveBeenCalled();
  });
});

describe("cart totals and order status", () => {
  it("shows free shipping and GST", () => {
    render(<TotalsBox totals={{ subtotal: 120000, shipping: 0, tax: 18305, total: 120000 }} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("₹1,200");
  });
  it("labels order statuses", () => {
    render(<OrderStatusBadge status="PAYMENT_FAILED" />);
    expect(screen.getByTestId("order-status")).toHaveTextContent("Payment failed");
  });
});
