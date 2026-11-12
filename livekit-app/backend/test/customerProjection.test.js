const test = require("node:test"),
  assert = require("node:assert/strict");
require("./supportIsolation").prepareSupportTest();
const db = require("../db/v2Database"),
  outbox = require("../lib/opsOutbox");
let projection;
try {
  projection = require("../lib/customerProjection");
} catch {}
test("Lalia keyset backfill reports exact source inventory including durable tombstones", async (t) => {
  t.after(() => db.close());
  assert.equal(typeof projection?.backfillCustomerProjection, "function");
  await db.initDatabase();
  await outbox.ensureOpsOutboxSchema();
  for (const table of [
    "ops_business_outbox",
    "ops_source_revisions",
    "ops_customer_source",
    "v2_org_members",
  ])
    await db.run(`DELETE FROM ${table}`);
  await db.run(
    db.isPostgres() ? "TRUNCATE v2_users CASCADE" : "DELETE FROM v2_users",
  );
  for (let i = 0; i < 105; i++)
    await db.run(
      "INSERT INTO v2_users(id,email,password_hash,display_name) VALUES(?,?,?,?)",
      [
        `projection-${String(i).padStart(3, "0")}`,
        `projection${i}@fixture.invalid`,
        "disabled",
        "Fixture",
      ],
    );
  assert.equal(await projection.backfillCustomerProjection(17), 105);
  const report = await projection.reportCustomerProjection();
  assert.equal(report.count, 105);
  assert.ok(report.backlog >= 105);
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM v2_users WHERE id=?", ["projection-000"]);
    await outbox.queueContactTombstone(tx, "projection-000");
  });
  assert.equal(await projection.backfillCustomerProjection(17), 104);
  assert.equal(
    Number(
      (
        await db.get(
          "SELECT deleted FROM ops_customer_source WHERE source_id=?",
          ["projection-000"],
        )
      ).deleted,
    ),
    1,
  );
  await db.run(
    "UPDATE ops_business_outbox SET status='delivered',result='{\"status\":\"deferred\"}'",
  );
  assert.ok((await projection.reportCustomerProjection()).backlog > 0);
  await db.run(
    'UPDATE ops_business_outbox SET result=\'{"status":"applied"}\'',
  );
  const clean = await projection.reportCustomerProjection();
  assert.equal(clean.backlog, 0);
  assert.equal(clean.count, 104);
  await assert.rejects(
    db.transaction(async (tx) => {
      await outbox.queueContactTombstone(tx, "projection-001");
      throw Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(
    Number(
      (
        await db.get(
          "SELECT deleted FROM ops_customer_source WHERE source_id=?",
          ["projection-001"],
        )
      ).deleted,
    ),
    0,
  );
  await t.test(
    "actual profile, login, admin and membership mutations publish current identity atomically",
    async () => {
      const mailer = require("../lib/mailer");
      mailer.sendEmail = async () => ({ id: "synthetic-no-send" });
      process.env.V2_SUPERADMIN_EMAILS = "projection-admin@fixture.invalid";
      const express = require("express"),
        app = express();
      app.use(express.json());
      app.use("/auth", require("../routes/v2/auth"));
      app.use("/orgs", require("../routes/v2/orgs"));
      app.use("/admin", require("../routes/v2/admin"));
      const server = app.listen(5396, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      try {
        let token = "";
        const call = (method, path, body) =>
          fetch(`http://127.0.0.1:5396${path}`, {
            method,
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
        const signup = await call("POST", "/auth/signup", {
          email: "projection-admin@fixture.invalid",
          password: "synthetic-fixture-password",
          displayName: "Admin fixture",
        });
        assert.equal(signup.status, 201, await signup.clone().text());
        const account = await signup.json();
        token = account.token;
        const payload = async (id) =>
          JSON.parse(
            (
              await db.get(
                "SELECT payload FROM ops_customer_source WHERE source_id=?",
                [id],
              )
            ).payload,
          );
        assert.equal(
          (
            await call("PATCH", "/auth/me", {
              displayName: "Updated profile",
              preferredLanguage: "en",
            })
          ).status,
          200,
        );
        assert.equal((await payload(account.user.id)).name, "Updated profile");
        assert.equal(
          (await payload(account.user.id)).memberships[0].name,
          "Updated profile",
        );
        assert.equal(
          (
            await call("POST", "/auth/login", {
              email: "projection-admin@fixture.invalid",
              password: "synthetic-fixture-password",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("POST", "/admin/users/projection-001/disable", {
              reason: "Synthetic review",
            })
          ).status,
          200,
        );
        assert.equal(
          (await payload("projection-001")).accountStatus,
          "disabled",
        );
        assert.equal(
          (
            await call("POST", "/admin/users/projection-001/enable", {
              reason: "Synthetic review",
            })
          ).status,
          200,
        );
        assert.equal((await payload("projection-001")).accountStatus, "active");
        const setPlan = await call(
          "PATCH",
          `/admin/orgs/${account.org.id}/plan`,
          { plan_id: "pro", reason: "Synthetic plan" },
        );
        assert.equal(setPlan.status, 200, await setPlan.clone().text());
        assert.equal(
          (await payload(account.user.id)).memberships[0].plan_id,
          "pro",
        );
        const targetResponse = await call("POST", "/auth/signup", {
          email: "projection-target@fixture.invalid",
          password: "synthetic-fixture-password",
          displayName: "Target fixture",
        });
        assert.equal(targetResponse.status, 201);
        const target = await targetResponse.json();
        assert.equal(
          (
            await call("POST", `/admin/orgs/${target.org.id}/suspend`, {
              reason: "Synthetic suspension",
            })
          ).status,
          200,
        );
        assert.equal(
          (await payload(target.user.id)).memberships[0].account_status,
          "suspended",
        );
        assert.equal(
          (
            await call("POST", `/admin/orgs/${target.org.id}/reactivate`, {
              reason: "Synthetic reactivation",
            })
          ).status,
          200,
        );
        assert.equal(
          (await payload(target.user.id)).memberships[0].account_status,
          "active",
        );
        const add = await call("POST", "/orgs/members", {
          email: "projection1@fixture.invalid",
          role: "member",
        });
        assert.equal(add.status, 201, await add.clone().text());
        assert.equal((await payload("projection-001")).memberships.length, 1);
        assert.equal(
          (
            await call("PATCH", "/orgs/members/projection-001", {
              role: "admin",
            })
          ).status,
          200,
        );
        assert.equal(
          (await payload("projection-001")).memberships[0].role,
          "admin",
        );
        assert.equal(
          (await call("DELETE", "/orgs/members/projection-001")).status,
          200,
        );
        assert.equal((await payload("projection-001")).memberships.length, 0);
      } finally {
        await new Promise((r) => server.close(r));
      }
    },
  );
  await db.run(
    "UPDATE ops_business_outbox SET status='delivered',result='{\"status\":\"applied\"}'",
  );
  await projection.reportCustomerProjection();

  await t.test(
    "canonical heartbeat and timed-out peer allow later reporting ticks",
    async () => {
      process.env.OPS_HUB_BUSINESS_ID = "canonical-lalia-fixture";
      process.env.OPS_HUB_URL = "http://127.0.0.1:5396";
      process.env.OPS_HUB_SECRET_KEY = "synthetic-key";
      const { createServer } = require("node:http");
      let requests = 0,
        reports = 0;
      const seen = [];
      const server = createServer((req, res) => {
        requests++;
        seen.push(req.headers["x-ops-tenant"]);
        if (requests > 1) {
          res.setHeader("Content-Type", "application/json");
          res.end("{}");
        }
      });
      await new Promise((r) => server.listen(5396, "127.0.0.1", r));
      const stop = projection.startCustomerReporting({
        intervalMs: 10,
        heartbeatTimeoutMs: 25,
        backfill: async () => {},
        report: async () => {
          reports++;
        },
        onError: () => {},
      });
      try {
        for (let i = 0; i < 100 && requests < 2; i++)
          await new Promise((r) => setTimeout(r, 10));
        assert.ok(requests >= 2);
        assert.ok(reports >= 2);
        assert.ok(seen.every((id) => id === "canonical-lalia-fixture"));
      } finally {
        stop();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        delete process.env.OPS_HUB_BUSINESS_ID;
        delete process.env.OPS_HUB_URL;
        delete process.env.OPS_HUB_SECRET_KEY;
      }
    },
  );
  await t.test(
    "PG source mutation cannot commit across the report observation boundary",
    async () => {
      if (!db.isPostgres()) return;
      let start,
        changed = false;
      const ready = new Promise((r) => (start = r));
      const mutation = ready.then(() =>
        db.transaction(async (tx) => {
          await tx.run(
            "UPDATE v2_users SET display_name='Concurrent' WHERE id='projection-001'",
          );
          await outbox.queueContact(tx, "projection-001");
          changed = true;
        }),
      );
      const before = await projection.reportCustomerProjection();
      const during = await projection.reportCustomerProjection({
        afterSourceRead: async () => {
          start();
          await new Promise((r) => setTimeout(r, 30));
          assert.equal(changed, false);
        },
      });
      assert.equal(before.hash, during.hash);
      assert.equal(before.highWater, during.highWater);
      await mutation;
      const after = await projection.reportCustomerProjection();
      assert.notEqual(after.hash, before.hash);
      assert.ok(BigInt(after.highWater) > BigInt(before.highWater));
    },
  );
  await db.run(
    "UPDATE ops_business_outbox SET status='delivered',result='{\"status\":\"applied\"}'",
  );
  await projection.reportCustomerProjection();
  await t.test(
    "support backlog metadata stays bound to the observed authority generation",
    async () => {
      const {
        SUPPORT_PENDING_SCHEMA,
        SUPPORT_ACCEPTANCE_SCHEMA,
      } = require("@rhule/ops-sdk");
      for (const statement of SUPPORT_PENDING_SCHEMA) await db.run(statement);
      await db.run(SUPPORT_ACCEPTANCE_SCHEMA);
      await db.run(
        "INSERT INTO ops_support_host_acceptance(business_id,generation,closed,origin) VALUES('lalia','3',0,'http://127.0.0.1:5396') ON CONFLICT(business_id) DO UPDATE SET generation='3'",
      );
      await db.run(
        "INSERT INTO ops_support_pending(receipt_id,business_id,scope,record_json,status) VALUES('report-pending','lalia','report-pending','{}','pending') ON CONFLICT DO NOTHING",
      );
      const report = await projection.reportCustomerProjection();
      assert.equal(report.supportObservation.generation, "3");
      assert.equal(report.supportObservation.backlog, 1);
      await db.run(
        "DELETE FROM ops_support_pending WHERE receipt_id='report-pending'",
      );
      await db.run(
        "DELETE FROM ops_support_host_acceptance WHERE business_id='lalia'",
      );
      assert.equal(
        (await projection.reportCustomerProjection()).supportObservation,
        null,
      );
    },
  );
  const envelopes = (
    await db.all("SELECT envelope FROM ops_business_outbox")
  ).map((r) => JSON.parse(r.envelope));
  require("node:fs").writeFileSync(
    "/private/tmp/phase3-task2-lalia-fixture-events.json",
    JSON.stringify({
      count: Number((await db.get("SELECT COUNT(*) AS n FROM v2_users")).n),
      envelopes,
    }),
  );
});
