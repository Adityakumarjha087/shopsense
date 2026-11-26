import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">The page or product you are looking for doesn’t exist or is no longer available.</p>
      <Button asChild className="mt-6">
        <Link href="/">Back to the store</Link>
      </Button>
    </div>
  );
}
