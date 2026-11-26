import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
