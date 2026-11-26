import type { PrismaClient } from "@prisma/client";
import type { Cache } from "./lib/cache.js";
import type { MlClient } from "./modules/recommendations/ml-client.js";
import type { SearchEngine } from "./modules/search/engine.js";
import type { LlmProvider } from "./modules/llm/types.js";
import type { PaymentGateway } from "./modules/payments/gateway.js";

/** Explicit dependency container; every router is built from it so tests can swap pieces. */
export interface AppContext {
  prisma: PrismaClient;
  cache: Cache;
  ml: MlClient;
  search: SearchEngine;
  llm: LlmProvider;
  payments: PaymentGateway;
  /** Fire-and-forget hooks run after catalogue mutations (search reindex, ISR revalidation...). */
  onCatalogChange: (productIds: string[]) => Promise<void>;
}
