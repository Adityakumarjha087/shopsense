export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  currency: string;
  image: { url: string; alt: string } | null;
  ratingAvg: number;
  ratingCount: number;
  category: { slug: string; name: string };
  inStock: boolean;
  colors: string[];
}

export interface Variant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
  inStock: boolean;
}

export interface ReviewSummary {
  summary: string;
  pros: string[];
  cons: string[];
  provider: string;
  reviewCount?: number;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  brand: string;
  description: string;
  currency: string;
  basePrice: number;
  price: number;
  tags: string[];
  attributes: Record<string, string>;
  ratingAvg: number;
  ratingCount: number;
  category: { id: string; slug: string; name: string };
  images: Array<{ url: string; alt: string }>;
  variants: Variant[];
  reviewSummary: ReviewSummary | null;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  productCount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchResult extends Paged<ProductCard> {
  parsed: { text: string; minPrice?: number; maxPrice?: number; inStock?: boolean };
  facets: Record<string, Record<string, number>>;
  engines: { keyword: string; semantic: boolean };
}

export interface RecResponse {
  requestId: string | null;
  placement: string;
  strategy: string;
  variant: string | null;
  fallback: boolean;
  items: ProductCard[];
}

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  image: string | null;
  size: string | null;
  color: string | null;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  stock: number;
}

export interface Totals {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
}

export interface CartView {
  items: CartLine[];
  itemCount: number;
  totals: Totals;
  currency: string;
}

export type OrderStatus = "PENDING" | "PAID" | "PAYMENT_FAILED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";

export interface Order {
  id: string;
  status: OrderStatus;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  paymentProvider: string;
  shippingAddress: Record<string, string>;
  createdAt: string;
  paidAt: string | null;
  items: Array<{ productId: string; variantId: string; slug: string; image: string | null; name: string; sku: string; unitPrice: number; quantity: number }>;
  history: Array<{ from: OrderStatus | null; to: OrderStatus; reason: string; at: string }>;
}

export interface Review {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
}

export interface CartAction {
  type: "add";
  variantId: string;
  productId: string;
  name: string;
  quantity: number;
  size: string | null;
  color: string | null;
  persisted: boolean;
}

export interface AssistantReply {
  reply: string;
  products: ProductCard[];
  comparison: Array<Record<string, unknown>> | null;
  cartActions: CartAction[];
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; isError: boolean }>;
  provider: string;
}

export interface ExperimentStats {
  experiment: { key: string; name: string; isActive: boolean; variants: Array<{ key: string; strategy: string; weight: number }> };
  variants: Array<{ variant: string; strategy: string; weight: number; requests: number; impressions: number; clicks: number; ctr: number }>;
  significance: { z: number; pValue: number; significant: boolean } | null;
}
