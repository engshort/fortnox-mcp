import { env } from "cloudflare:workers";
import stateSchema from "../../apps/worker/migrations/0002_product_state.sql?raw";
import authSchema from "../../apps/worker/migrations/0003_product_auth.sql?raw";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { ownerContract } from "../shared/product-auth.js";

ownerContract(async () => {
  await env.DB.exec(stateSchema.replace(/\n/g, " "));
  if (
    !(await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'user'",
    ).first())
  )
    await env.DB.exec(authSchema.replace(/\n/g, " "));
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all<{ name: string }>();
  // Fresh synthetic fixture; auth tables have foreign keys.
  for (const name of [
    "session",
    "account",
    "verification",
    "rateLimit",
    "user",
    "product_state",
  ]) {
    if (tables.results.some((t) => t.name === name))
      await env.DB.prepare(`DELETE FROM "${name}"`).run();
  }
  return {
    origin: "https://product.example.invalid",
    secret: "synthetic-auth-secret-at-least-32-characters",
    database: env.DB,
    state: d1State(env.DB),
  };
});
