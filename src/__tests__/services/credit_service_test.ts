/**
 * Prepaid credit ledger tests -- the invariants that guard real money:
 * idempotent grants, atomic non-negative debits, refunds, audit entries.
 */

import { assert, assertEquals } from "@std/assert";
import { createIsolatedUser } from "../helpers.ts";
import { creditService } from "@/services/credit.service.ts";

function test(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

test("credits: grants keyed on external_ref are idempotent under replays", async () => {
  const { org, cleanup } = await createIsolatedUser("owner");
  try {
    const ref = `cs:test_${org.id}`;
    const first = await creditService.grant({
      organizationId: org.id,
      amount: 100,
      reason: "credit_pack_purchase",
      externalRef: ref,
    });
    assertEquals(first.granted, true);
    assertEquals(first.balance, 100n);

    // Stripe delivers webhooks at-least-once -- the replay must be a no-op.
    const replay = await creditService.grant({
      organizationId: org.id,
      amount: 100,
      reason: "credit_pack_purchase",
      externalRef: ref,
    });
    assertEquals(replay.granted, false);
    assertEquals(replay.balance, 100n);
    assertEquals(await creditService.getBalance(org.id), 100n);
  } finally {
    await cleanup();
  }
});

test("credits: debit is atomic and never goes negative", async () => {
  const { org, cleanup } = await createIsolatedUser("owner");
  try {
    await creditService.grant({
      organizationId: org.id,
      amount: 10,
      reason: "test_grant",
      externalRef: `t:${org.id}:seed`,
    });

    const ok = await creditService.debit({ organizationId: org.id, amount: 7, reason: "tool_call" });
    assert(ok.ok);
    assertEquals(ok.balance, 3n);

    // 4 > 3 -- must refuse, and the balance must be untouched.
    const insufficient = await creditService.debit({
      organizationId: org.id,
      amount: 4,
      reason: "tool_call",
    });
    assertEquals(insufficient.ok, false);
    assertEquals(insufficient.balance, 3n);
    assertEquals(await creditService.getBalance(org.id), 3n);

    // An org with NO balance row at all reads as zero, not an error.
    const { org: freshOrg, cleanup: cleanup2 } = await createIsolatedUser("owner");
    try {
      const none = await creditService.debit({
        organizationId: freshOrg.id,
        amount: 1,
        reason: "tool_call",
      });
      assertEquals(none.ok, false);
      assertEquals(none.balance, 0n);
    } finally {
      await cleanup2();
    }
  } finally {
    await cleanup();
  }
});

test("credits: refund restores the balance and the ledger records everything", async () => {
  const { org, cleanup } = await createIsolatedUser("owner");
  try {
    await creditService.grant({
      organizationId: org.id,
      amount: 20,
      reason: "test_grant",
      externalRef: `t:${org.id}:seed2`,
    });
    await creditService.debit({ organizationId: org.id, amount: 5, reason: "tool_call" });
    await creditService.refund({ organizationId: org.id, amount: 5, reason: "tool_error_refund" });

    assertEquals(await creditService.getBalance(org.id), 20n);

    const entries = await creditService.listEntries(org.id);
    assertEquals(entries.length, 3);
    const reasons = entries.map((e) => e.reason).sort();
    assertEquals(reasons, ["test_grant", "tool_call", "tool_error_refund"]);
    // Deltas sum to the balance.
    const sum = entries.reduce((acc, e) => acc + BigInt(e.delta), 0n);
    assertEquals(sum, 20n);
  } finally {
    await cleanup();
  }
});
