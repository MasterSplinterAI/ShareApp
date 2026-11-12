require("./supportIsolation").prepareSupportTest();
const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("../db/v2Database");
const outbox = require("../lib/opsOutbox");
const originalQueue = outbox.queueOrgContacts;
let rejectProjection = false;
outbox.queueOrgContacts = async (...args) => {
  await originalQueue(...args);
  if (rejectProjection) throw Error("synthetic projection failure");
};
const { applyStripeDisputeEvent } = require("../lib/v2StripeDispute");

test("dispute access changes and customer snapshots commit together without private billing fields", async (t) => {
  t.after(() => db.close());
  await db.initDatabase();
  await outbox.ensureOpsOutboxSchema();
  const user = db.uuid(),
    org = db.uuid(),
    customer = `cus_fixture_${org}`,
    disputeId = `dp_fixture_${org}`;
  await db.run(
    "INSERT INTO v2_users(id,email,password_hash,display_name) VALUES(?,?,?,?)",
    [user, `${user}@fixture.invalid`, "disabled", "Dispute fixture"],
  );
  await db.run(
    "INSERT INTO v2_organizations(id,name,billing_status) VALUES(?,?,'active')",
    [org, "Synthetic dispute org"],
  );
  await db.run(
    "INSERT INTO v2_org_members(org_id,user_id,role) VALUES(?,?,'owner')",
    [org, user],
  );
  await db.run(
    "INSERT INTO v2_org_subscriptions(org_id,plan_id,status,stripe_customer_id) VALUES(?,'free','active',?)",
    [org, customer],
  );
  await db.transaction((tx) => outbox.queueContact(tx, user));
  const snapshot = async () =>
    JSON.parse(
      (
        await db.get(
          "SELECT payload FROM ops_customer_source WHERE source_id=?",
          [user],
        )
      ).payload,
    );
  const event = {
    id: disputeId,
    customer,
    status: "needs_response",
    reason: "private synthetic reason",
    amount: 89001,
    currency: "usd",
  };
  rejectProjection = true;
  await assert.rejects(
    applyStripeDisputeEvent("charge.dispute.created", event),
    /synthetic projection failure/,
  );
  assert.equal(
    (
      await db.get("SELECT billing_status FROM v2_organizations WHERE id=?", [
        org,
      ])
    ).billing_status,
    "active",
  );
  assert.equal((await snapshot()).memberships[0].account_status, "active");
  rejectProjection = false;
  await applyStripeDisputeEvent("charge.dispute.created", event);
  assert.equal((await snapshot()).memberships[0].account_status, "suspended");
  assert.doesNotMatch(
    JSON.stringify(await snapshot()),
    /private synthetic reason|89001|stripe_dispute:/,
  );
  await applyStripeDisputeEvent("charge.dispute.closed", {
    ...event,
    status: "won",
  });
  assert.equal((await snapshot()).memberships[0].account_status, "active");
  assert.equal(
    (
      await db.get("SELECT billing_status FROM v2_organizations WHERE id=?", [
        org,
      ])
    ).billing_status,
    "active",
  );
});
