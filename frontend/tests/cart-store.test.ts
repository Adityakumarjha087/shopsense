import { mergeLines, MAX_LINE_QTY, selectCount, useCartStore } from "@/store/cart";

beforeEach(() => useCartStore.setState({ lines: [], view: null }));

describe("cart store", () => {
  it("merges lines by variant and clamps quantity", () => {
    expect(mergeLines([{ variantId: "a", quantity: 2 }], [{ variantId: "a", quantity: 3 }, { variantId: "b", quantity: 1 }])).toEqual([
      { variantId: "a", quantity: 5 },
      { variantId: "b", quantity: 1 },
    ]);
    expect(mergeLines([{ variantId: "a", quantity: 9 }], [{ variantId: "a", quantity: 9 }])[0]!.quantity).toBe(MAX_LINE_QTY);
  });

  it("adds, updates and removes guest lines", () => {
    const s = useCartStore.getState();
    s.add("v1");
    s.add("v1", 2);
    s.add("v2");
    expect(useCartStore.getState().lines).toEqual([
      { variantId: "v1", quantity: 3 },
      { variantId: "v2", quantity: 1 },
    ]);
    s.setQuantity("v1", 15);
    expect(useCartStore.getState().lines[0]!.quantity).toBe(10);
    s.setQuantity("v2", 0);
    expect(useCartStore.getState().lines).toHaveLength(1);
    s.remove("v1");
    expect(useCartStore.getState().lines).toEqual([]);
  });

  it("counts from the priced view when available, else from local lines", () => {
    useCartStore.getState().add("v1", 2);
    expect(selectCount(useCartStore.getState())).toBe(2);
    useCartStore.getState().setView({ items: [], itemCount: 7, totals: { subtotal: 0, shipping: 0, tax: 0, total: 0 }, currency: "INR" });
    expect(selectCount(useCartStore.getState())).toBe(7);
  });

  it("persists only lines to localStorage", () => {
    useCartStore.getState().add("v9", 1);
    const raw = JSON.parse(localStorage.getItem("shopsense-cart") ?? "{}");
    expect(raw.state).toEqual({ lines: [{ variantId: "v9", quantity: 1 }] });
  });
});
