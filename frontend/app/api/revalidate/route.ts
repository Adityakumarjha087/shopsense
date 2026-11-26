import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/** On-demand ISR invalidation, called by the backend after catalogue changes. */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { slugs?: unknown };
  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string").slice(0, 200) : [];
  for (const slug of slugs) {
    revalidateTag(`product:${slug}`);
    revalidatePath(`/p/${slug}`);
  }
  revalidateTag("catalog");
  return NextResponse.json({ revalidated: slugs.length, now: Date.now() });
}
