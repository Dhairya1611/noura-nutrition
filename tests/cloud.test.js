import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202610100001_noura_user_data.sql", import.meta.url);

test("cloud migration enables row-level security", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all .* from anon/i);
});

test("every cloud operation is restricted to the authenticated owner", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /for select[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
  assert.match(sql, /for insert[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
  assert.match(sql, /for update[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
  assert.match(sql, /for delete[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
});
