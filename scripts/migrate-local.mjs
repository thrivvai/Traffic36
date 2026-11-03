// Applies pending migrations to the local development database in .netlify/db.
// Stop the dev server first: the local database allows one process at a time.
// Deployed databases never use this: Netlify applies migrations on every deploy.
import { NetlifyDB } from "@netlify/database-dev";

const db = new NetlifyDB({ directory: ".netlify/db" });
await db.start();
try {
  const applied = await db.applyMigrations("netlify/database/migrations");
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Local database is up to date.");
} finally {
  await db.stop();
}
