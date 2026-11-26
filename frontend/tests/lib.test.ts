import { formatPercent, formatPrice, rupeesToPaise } from "@/lib/format";
import { qs, rupeeParam, first } from "@/lib/query";
import { luhnValid, validateAddress, EMPTY_ADDRESS } from "@/lib/validation";
import { productSvg } from "@/lib/product-image";
import { getSessionId } from "@/lib/session-id";

describe("formatPrice", () => {
  it("formats whole rupees in en-IN grouping", () => {
    expect(formatPrice(300000)).toBe("₹3,000");
    expect(formatPrice(12345600)).toBe("₹1,23,456");
  });
  it("shows paise only when present", () => {
    expect(formatPrice(9950)).toBe("₹99.50");
  });
  it("handles non-finite input", () => {
    expect(formatPrice(Number.NaN)).toBe("—");
  });
  it("converts rupees to paise and percents", () => {
    expect(rupeesToPaise(29.99)).toBe(2999);
    expect(formatPercent(0.1234)).toBe("12.34%");
  });
});

describe("query helpers", () => {
  it("builds query strings without empty values", () => {
    expect(qs({ q: "running shoes", page: 2, sort: undefined, min: "" })).toBe("?q=running+shoes&page=2");
    expect(qs({})).toBe("");
  });
  it("parses rupee params into paise", () => {
    expect(rupeeParam("3000")).toBe(300000);
    expect(rupeeParam("abc")).toBeUndefined();
    expect(rupeeParam(undefined)).toBeUndefined();
    expect(first(["a", "b"])).toBe("a");
  });
});

describe("checkout validation", () => {
  it("mirrors backend address rules", () => {
    const errs = validateAddress({ ...EMPTY_ADDRESS, postalCode: "1234", phone: "12" });
    expect(Object.keys(errs).sort()).toEqual(["city", "fullName", "line1", "phone", "postalCode", "state"]);
    expect(
      validateAddress({ fullName: "Asha K", line1: "12 MG Road", line2: "", city: "Pune", state: "Maharashtra", postalCode: "411001", phone: "+919876543210" }),
    ).toEqual({});
  });
  it("validates card numbers with Luhn", () => {
    expect(luhnValid("4242 4242 4242 4242")).toBe(true);
    expect(luhnValid("4000 0000 0000 0002")).toBe(true);
    expect(luhnValid("4242 4242 4242 4241")).toBe(false);
    expect(luhnValid("123")).toBe(false);
  });
});

describe("product placeholder art", () => {
  it("is deterministic and escapes labels", () => {
    const a = productSvg("footwear", "running-shoes", 120);
    expect(a).toBe(productSvg("footwear", "running-shoes", 120));
    expect(a).toContain("Running Shoes");
    expect(a).toContain("hsl(120");
    expect(productSvg("unknown", "a<b", 5)).toContain("A&lt;B");
  });
});

describe("session id", () => {
  it("creates and reuses a backend-compatible id", () => {
    const id = getSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(getSessionId()).toBe(id);
    expect(document.cookie).toContain(`ss_sid=${id}`);
  });
});
