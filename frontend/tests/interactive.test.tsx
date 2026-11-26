import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBox } from "@/components/layout/search-box";
import { ChatWidget, applyCartActions } from "@/components/assistant/chat-widget";
import { useCartStore } from "@/store/cart";
import { mockFetch, product } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

beforeEach(() => {
  push.mockReset();
  useCartStore.setState({ lines: [], view: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("SearchBox autocomplete", () => {
  it("debounces, shows suggestions and navigates with the keyboard", async () => {
    const fetchMock = mockFetch((url) => {
      expect(url).toContain("/api/v1/search/suggest?q=sweatr");
      return { suggestions: [{ id: "1", slug: "merino-sweater", name: "Merino Sweater", category: "Men's Clothing" }, { id: "2", slug: "knit-sweater", name: "Knit Sweater", category: "Men's Clothing" }] };
    });
    render(<SearchBox debounceMs={0} />);
    const box = screen.getByRole("combobox", { name: "Search products" });
    await userEvent.type(box, "sweatr");
    expect(await screen.findByRole("option", { name: /Merino Sweater/ })).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ "x-session-id": expect.any(String) });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(push).toHaveBeenCalledWith("/p/knit-sweater");
  });

  it("submits a full-text search", async () => {
    mockFetch(() => ({ suggestions: [] }));
    render(<SearchBox debounceMs={0} />);
    await userEvent.type(screen.getByRole("combobox"), "cozy winter outfit{Enter}");
    expect(push).toHaveBeenCalledWith("/search?q=cozy%20winter%20outfit");
  });
});

describe("ChatWidget", () => {
  it("sends the conversation, renders product cards and applies guest cart actions", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/assistant/chat")) {
        return {
          reply: "Here are 1 options I found",
          products: [product()],
          comparison: null,
          cartActions: [{ type: "add", variantId: "v2", productId: "p1", name: "Sweater", quantity: 1, size: "M", color: "Navy", persisted: false }],
          toolCalls: [{ name: "search_products", arguments: {}, isError: false }],
          provider: "fake:shopsense-fake-1",
        };
      }
      return { items: [], itemCount: 1, totals: { subtotal: 249900, shipping: 0, tax: 1, total: 249900 }, currency: "INR" };
    });
    render(<ChatWidget open onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText("Message the shopping assistant"), "warm sweater");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Here are 1 options I found")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-product")).toHaveAttribute("href", "/p/northloom-classic-merino-wool-sweater-1");
    await waitFor(() => expect(useCartStore.getState().lines).toEqual([{ variantId: "v2", quantity: 1 }]));
    const chat = calls.find((c) => c.url.endsWith("/assistant/chat"))!;
    expect(chat.body).toEqual({ messages: [{ role: "user", content: "warm sweater" }], shownProducts: [] });
    expect(screen.getByText(/Cart updated/)).toBeInTheDocument();
  });

  it("passes previously shown products and renders comparisons", async () => {
    let n = 0;
    const bodies: unknown[] = [];
    mockFetch((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      n += 1;
      return n === 1
        ? { reply: "Found", products: [product(), product({ id: "p2", slug: "s2", name: "Second" })], comparison: null, cartActions: [], toolCalls: [], provider: "fake" }
        : {
            reply: "Here's how they compare",
            products: [],
            comparison: [
              { id: "p1", name: "First", price_display: "₹2,499", rating: 4.3, reviews: 21, in_stock: true },
              { id: "p2", name: "Second", price_display: "₹1,999", rating: 4.1, reviews: 5, in_stock: false },
            ],
            cartActions: [],
            toolCalls: [],
            provider: "fake",
          };
    });
    render(<ChatWidget open onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Cozy winter outfit under ₹3000" }));
    await screen.findByText("Found");
    await userEvent.click(screen.getByRole("button", { name: "Compare the first two" }));
    expect(await screen.findByTestId("comparison-table")).toHaveTextContent("Second");
    expect((bodies[1] as { shownProducts: Array<{ id: string }> }).shownProducts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("shows an error message when the assistant is unreachable and closes on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const onClose = vi.fn();
    render(<ChatWidget open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Message the shopping assistant"), "hi{Enter}");
    expect(await screen.findByText(/couldn't reach the assistant/)).toBeInTheDocument();
    await act(async () => {
      await userEvent.keyboard("{Escape}");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("refreshes the server cart for persisted actions", async () => {
    const fetchMock = mockFetch(() => ({ items: [], itemCount: 3, totals: { subtotal: 0, shipping: 0, tax: 0, total: 0 }, currency: "INR" }));
    await applyCartActions([{ type: "add", variantId: "v1", productId: "p", name: "x", quantity: 1, size: null, color: null, persisted: true }], "tok");
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/api\/v1\/cart$/);
    expect(useCartStore.getState().view?.itemCount).toBe(3);
    expect(useCartStore.getState().lines).toEqual([]);
  });
});
