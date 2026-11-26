import { render, waitFor } from "@testing-library/react";
import { CartSync } from "@/components/cart/cart-sync";
import { useCartStore } from "@/store/cart";
import { mockFetch } from "./fixtures";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { accessToken: "tok-1", user: { id: "u", role: "CUSTOMER" } }, status: "authenticated" }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("CartSync", () => {
  it("merges the guest cart into the server cart after login", async () => {
    useCartStore.setState({ lines: [{ variantId: "v1", quantity: 2 }], view: null, serverSynced: false });
    const fetchMock = mockFetch(() => ({ items: [], itemCount: 2, totals: { subtotal: 1, shipping: 0, tax: 0, total: 1 }, currency: "INR" }));
    render(<CartSync />);
    await waitFor(() => expect(useCartStore.getState().serverSynced).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/cart\/merge$/);
    expect(JSON.parse(String(init?.body))).toEqual({ items: [{ variantId: "v1", quantity: 2 }] });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().view?.itemCount).toBe(2);
  });
});
