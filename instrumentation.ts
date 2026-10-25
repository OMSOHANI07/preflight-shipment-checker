/** Dev-only startup check: seeded carriers must equal the CARRIERS constant (the constant wins). */
export async function register() {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { loadCarriers } = await import("@/lib/db");
  const { source } = await loadCarriers();
  console.log(source === "db" ? "[db] carriers table matches the CARRIERS constant." : "[db] using the CARRIERS constant (DB empty, unreachable or different).");
}
