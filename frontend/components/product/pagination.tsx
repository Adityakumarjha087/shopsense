import Link from "next/link";

export function Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (p: number) => string }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1 pt-6">
      {page > 1 && <Link className="rounded-md px-3 py-2 text-sm hover:bg-muted" href={hrefFor(page - 1)}>Previous</Link>}
      {pages.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && pages[i - 1]! < p - 1 && <span className="px-1 text-muted-foreground">…</span>}
          <Link
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm ${p === page ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < totalPages && <Link className="rounded-md px-3 py-2 text-sm hover:bg-muted" href={hrefFor(page + 1)}>Next</Link>}
    </nav>
  );
}
