import { productSvg } from "@/lib/product-image";

export async function GET(_req: Request, { params }: { params: Promise<{ category: string; kind: string; file: string }> }) {
  const { category, kind, file } = await params;
  const match = /^(\d{1,3})\.svg$/.exec(file);
  if (!match || !/^[a-z-]{2,40}$/.test(category) || !/^[a-z-]{2,40}$/.test(kind)) return new Response("Not found", { status: 404 });
  return new Response(productSvg(category, kind, Number(match[1])), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" },
  });
}
