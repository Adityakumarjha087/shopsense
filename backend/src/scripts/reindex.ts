import { buildContext, syncSearchIndex } from "../bootstrap.js";

const ctx = await buildContext();
const n = await syncSearchIndex(ctx);
console.log(`Indexed ${n} products into ${ctx.search.name}`);
await ctx.prisma.$disconnect();
process.exit(0);
