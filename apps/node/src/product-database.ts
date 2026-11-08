import { chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function openProductDatabase(path: string, directory: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    await chmod(path, 0o600);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    db.exec(
      "CREATE TABLE IF NOT EXISTS product_migrations (id TEXT PRIMARY KEY)",
    );
    for (const file of (await readdir(directory))
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort()) {
      if (
        db.prepare("SELECT id FROM product_migrations WHERE id = ?").get(file)
      )
        continue;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(await readFile(resolve(directory, file), "utf8"));
        db.prepare("INSERT INTO product_migrations(id) VALUES(?)").run(file);
        db.exec("COMMIT");
      } catch {
        db.exec("ROLLBACK");
        throw new Error("Product migration failed");
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
