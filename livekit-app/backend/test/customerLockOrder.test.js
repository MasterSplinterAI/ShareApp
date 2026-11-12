require("./supportIsolation").prepareSupportTest();
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const db = require("../db/v2Database");
const outbox = require("../lib/opsOutbox");
const profile = require("../routes/v2/auth")
  .stack.find((r) => r.route?.path === "/me" && r.route.methods.patch)
  .route.stack.at(-1).handle;
const rename = require("../routes/v2/orgs")
  .stack.find((r) => r.route?.path === "/me" && r.route.methods.patch)
  .route.stack.at(-1).handle;
const {
  applyStripeSubscriptionToOrg,
} = require("../lib/v2StripeSubscriptionSync");
const { applyStripeDisputeEvent } = require("../lib/v2StripeDispute");
const operation = new AsyncLocalStorage();
async function invoke(handler, req) {
  const res = {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handler(req, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  return res.body;
}
async function raceCustomerOperations(left, right, lastUser) {
  if (!db.isPostgres()) return Promise.all([left(), right()]);
  const original = db.transaction;
  let reached, release;
  const paused = new Promise((r) => (reached = r)),
    resume = new Promise((r) => (release = r));
  const tag = `customer-lock-${db.uuid()}`;
  let intercepted = false;
  db.transaction = (work) =>
    original(async (tx) => {
      const side = operation.getStore();
      await tx.run("SET LOCAL statement_timeout='8s'");
      if (side)
        await tx.get("SELECT set_config('application_name',?,true)", [
          `${tag}-${side}`,
        ]);
      return work({
        ...tx,
        get: async (sql, params) => {
          if (
            side === "left" &&
            !intercepted &&
            sql.startsWith("SELECT id,email,display_name") &&
            params[0] === lastUser
          ) {
            intercepted = true;
            reached();
            await resume;
          }
          return tx.get(sql, params);
        },
      });
    });
  const leftResult = operation.run("left", left);
  let rightResult;
  try {
    await Promise.race([
      paused,
      leftResult.then(() => {
        throw Error("Expected source snapshot interleaving");
      }),
    ]);
    rightResult = operation.run("right", right);
    // Observe the competing real PG transaction waiting, rather than assuming timing.
    let waiting = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      waiting = Boolean(
        await db.get(
          "SELECT pid FROM pg_stat_activity WHERE application_name=? AND cardinality(pg_blocking_pids(pid))>0",
          [`${tag}-right`],
        ),
      );
      if (waiting) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(
      waiting,
      true,
      "Competing mutation must reach the shared lock",
    );
    release();
    const results = await Promise.allSettled([leftResult, rightResult]);
    for (const result of results)
      assert.equal(result.status, "fulfilled", result.reason?.stack);
  } finally {
    release();
    await Promise.allSettled([leftResult, rightResult]);
    db.transaction = original;
  }
}
test("customer mutations acquire the report fence before source rows", async (t) => {
  t.after(() => db.close());
  await db.initDatabase();
  await outbox.ensureOpsOutboxSchema();
  for (const kind of ["organization", "subscription", "personal-dispute"])
    await t.test(kind, async () => {
      const prefix = db.uuid(),
        a = `${prefix}-a`,
        b = `${prefix}-b`,
        org = `${prefix}-org`,
        personal = kind === "personal-dispute";
      for (const user of personal ? [b] : [a, b])
        await db.run(
          "INSERT INTO v2_users(id,email,password_hash,display_name) VALUES(?,?,?,?)",
          [user, `${user}@fixture.invalid`, "disabled", "Before"],
        );
      await db.run(
        "INSERT INTO v2_organizations(id,name,account_type,billing_status) VALUES(?,?,?,?)",
        [org, "Before", personal ? "personal" : "team", "active"],
      );
      for (const user of personal ? [b] : [a, b])
        await db.run(
          "INSERT INTO v2_org_members(org_id,user_id,role) VALUES(?,?,'owner')",
          [org, user],
        );
      await db.run(
        "INSERT INTO v2_org_subscriptions(org_id,plan_id,status,stripe_customer_id) VALUES(?,'free','active',?)",
        [org, `cus_${org}`],
      );
      await db.transaction((tx) => outbox.queueOrgContacts(tx, org));
      const auth = {
        userId: b,
        orgId: org,
        role: "owner",
        email: `${b}@fixture.invalid`,
      };
      const right = () =>
        invoke(profile, {
          v2Auth: auth,
          body: { displayName: "Updated member" },
        });
      const left =
        kind === "organization"
          ? () =>
              invoke(rename, {
                v2Auth: auth,
                body: { name: "Updated organization" },
              })
          : kind === "subscription"
            ? () =>
                applyStripeSubscriptionToOrg(
                  {
                    id: `sub_${org}`,
                    customer: `cus_${org}`,
                    metadata: { org_id: org },
                    status: "canceled",
                    items: { data: [] },
                  },
                  "1",
                )
            : () =>
                applyStripeDisputeEvent("charge.dispute.created", {
                  id: `dp_${org}`,
                  customer: `cus_${org}`,
                  status: "needs_response",
                });
      await raceCustomerOperations(left, right, b);
      const currentOrg = await db.get(
        "SELECT name,billing_status FROM v2_organizations WHERE id=?",
        [org],
      );
      for (const user of personal ? [b] : [a, b]) {
        const source = JSON.parse(
          (
            await db.get(
              "SELECT payload FROM ops_customer_source WHERE source_id=?",
              [user],
            )
          ).payload,
        );
        assert.equal(source.name, user === b ? "Updated member" : "Before");
        assert.equal(source.memberships[0].name, currentOrg.name);
        assert.equal(
          source.memberships[0].account_status,
          currentOrg.billing_status,
        );
        if (kind === "subscription")
          assert.equal(source.memberships[0].status, "canceled");
      }
    });
});
