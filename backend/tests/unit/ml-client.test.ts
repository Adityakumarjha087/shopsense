import { describe, expect, it } from "vitest";
import { HttpMlClient, MlUnavailableError } from "../../src/modules/recommendations/ml-client.js";

function fakeFetch(routes: Record<string, unknown>, status = 200) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, urls };
}

describe("HttpMlClient", () => {
  it("maps snake_case responses and builds query strings", async () => {
    const { fn, urls } = fakeFetch({
      "/recommend/user": { items: [{ product_id: "a", score: 0.9 }], strategy: "als", fallback: false },
      "/similar/": { items: [{ product_id: "b", score: 0.8 }] },
      "/bought-together/": { items: [{ product_id: "c", confidence: 0.5, lift: 2, support: 0.01 }], source: "rules" },
      "/popular": { items: [{ product_id: "d", score: 1 }] },
      "/search/semantic": { items: [{ product_id: "e", score: 0.7 }] },
      "/models/current": { version: "v1" },
      "/train": { version: "v2" },
      "/index/refresh": { ok: true },
      "/health": { status: "ok" },
    });
    const ml = new HttpMlClient("http://ml:8000/", 500, fn);
    expect(await ml.recommendForUser({ userId: "u1", recent: ["x", "y"], k: 5, strategy: "als", exclude: ["z"] })).toEqual({
      items: [{ productId: "a", score: 0.9 }],
      strategy: "als",
      fallback: false,
    });
    expect(urls[0]).toBe("http://ml:8000/recommend/user?k=5&strategy=als&user_id=u1&recent=x%2Cy&exclude=z");
    expect(await ml.similar("p 1", 3)).toEqual([{ productId: "b", score: 0.8 }]);
    expect(urls[1]).toContain("/similar/p%201?k=3");
    expect((await ml.boughtTogether("p", 2)).items[0]).toEqual({ productId: "c", confidence: 0.5, lift: 2, support: 0.01 });
    expect(await ml.popular(3, "cat")).toEqual([{ productId: "d", score: 1 }]);
    expect(await ml.semanticSearch("warm", 10)).toEqual([{ productId: "e", score: 0.7 }]);
    expect(await ml.modelInfo()).toEqual({ version: "v1" });
    expect(await ml.train()).toEqual({ version: "v2" });
    await ml.refreshIndex();
    expect(await ml.health()).toBe(true);
  });

  it("raises MlUnavailableError on HTTP errors and network failures", async () => {
    const { fn } = fakeFetch({ "/similar/": {} }, 503);
    await expect(new HttpMlClient("http://ml", 500, fn).similar("p", 1)).rejects.toBeInstanceOf(MlUnavailableError);
    const broken = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const ml = new HttpMlClient("http://ml", 500, broken);
    await expect(ml.popular(1)).rejects.toBeInstanceOf(MlUnavailableError);
    expect(await ml.health()).toBe(false);
  });
});
