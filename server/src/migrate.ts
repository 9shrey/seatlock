import { readFileSync } from "node:fs";
import { pool } from "./db.js";

const schemaSql = () => readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8");

/** Creates any missing tables and indexes. Never drops data; run on every server start. */
export async function applySchema() {
  await pool.query(schemaSql());
}

/** Drops everything and recreates the schema. For tests and local seeding only. */
export async function resetSchema() {
  await pool.query("DROP TABLE IF EXISTS seats, bookings, shows, users CASCADE");
  await applySchema();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await applySchema();
  console.log("schema up to date");
  await pool.end();
}
