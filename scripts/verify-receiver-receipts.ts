import { strict as assert } from "node:assert";
import {
  assertCrmReceiptMatchesEnvelope,
  parseCrmReviewEnvelope,
} from "../supabase/functions/_shared/crm-contract.ts";

// Reads only a synthetic snapshot from the disposable PostgreSQL test cluster.
const records: { payload: unknown; receipt: unknown }[] = JSON.parse(
  await Deno.readTextFile(Deno.args[0]),
);
assert.equal(records.length, 3);
for (const record of records) {
  assertCrmReceiptMatchesEnvelope(
    record.receipt,
    await parseCrmReviewEnvelope(record.payload),
  );
}
console.log(
  "PASS: real PostgreSQL receipts and canonical payload hashes satisfy the portable receiver contract",
);
