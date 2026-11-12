const { createHash } = require("node:crypto");
const db = require("../db/v2Database");
const {
  queueContact,
  customerMutation,
  lockCustomerDataset,
} = require("./opsOutbox");
const { nextSourceRevision, enqueueBusinessEvent } = require("@rhule/ops-sdk");
const expectedInterval = () =>
  Math.min(
    86400000,
    Math.max(1000, Number(process.env.OPS_REPORT_INTERVAL_MS) || 60000),
  );
async function backfillCustomerProjection(pageSize = 100) {
  const high = (await db.get("SELECT MAX(id) AS id FROM v2_users"))?.id;
  if (!high) return 0;
  let cursor = "",
    count = 0;
  const size = Math.min(500, Math.max(1, pageSize));
  for (;;) {
    const rows = await db.all(
      "SELECT id FROM v2_users WHERE id>? AND id<=? ORDER BY id LIMIT ?",
      [cursor, high, size],
    );
    if (!rows.length) break;
    for (const row of rows)
      await customerMutation(async (tx) => {
        const current = await tx.get(
          `SELECT id FROM v2_users WHERE id=?${db.isPostgres() ? " FOR UPDATE" : ""}`,
          [row.id],
        );
        if (current) {
          await queueContact(tx, row.id);
          count++;
        }
      });
    cursor = rows.at(-1).id;
  }
  return count;
}
async function reportCustomerProjection(options = {}) {
  return db.transaction(async (tx) => {
    // Hold the same mutation fence used by source snapshots through all report reads.
    const fence = await lockCustomerDataset(tx);
    const asOf = new Date().toISOString(),
      revision = await nextSourceRevision(tx, "customer-report");
    const rows = await tx.all(
      "SELECT source_id,revision,deleted FROM ops_customer_source",
    );
    await options.afterSourceRead?.();
    const tuples = rows
      .map((r) => [r.source_id, String(r.revision), !!Number(r.deleted)])
      .sort((a, b) =>
        String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
      );
    const acknowledgments = await tx.all(
      "SELECT status,result FROM ops_business_outbox WHERE event_type='contact.changed'",
    );
    const backlog = acknowledgments.filter((r) => {
      try {
        return (
          r.status !== "delivered" ||
          !["applied", "stale"].includes(JSON.parse(r.result || "null")?.status)
        );
      } catch {
        return true;
      }
    }).length;
    const current = await tx.get("SELECT COUNT(*) AS n FROM v2_users");
    let supportObservation = null;
    const supportTables = db.isPostgres()
      ? await tx.get(
          "SELECT to_regclass('ops_support_host_acceptance') IS NOT NULL AND to_regclass('ops_support_pending') IS NOT NULL AS ready",
        )
      : await tx.get(
          "SELECT COUNT(*)=2 AS ready FROM sqlite_master WHERE type='table' AND name IN ('ops_support_host_acceptance','ops_support_pending')",
        );
    if (supportTables?.ready) {
      const supportAsOf = new Date().toISOString();
      const support = await tx.get(
        "SELECT a.generation,(SELECT COUNT(*) FROM ops_support_pending p WHERE p.business_id=a.business_id AND p.status='pending') AS backlog FROM ops_support_host_acceptance a WHERE a.business_id=?",
        [String(process.env.OPS_HUB_BUSINESS_ID || "lalia")],
      );
      if (support)
        supportObservation = {
          generation: String(support.generation),
          backlog: Number(support.backlog),
          asOf: supportAsOf,
        };
    }
    const payload = {
      sourceId: "customer-accounts-v1",
      supportObservation,
      asOf,
      expectedIntervalMs: expectedInterval(),
      backlog,
      highWater: String(fence.revision),
      count: Number(current.n),
      hash: createHash("sha256").update(JSON.stringify(tuples)).digest("hex"),
    };
    await enqueueBusinessEvent(tx, {
      schemaVersion: 1,
      businessId: String(process.env.OPS_HUB_BUSINESS_ID || "lalia"),
      environment: "live",
      type: "metrics.snapshot",
      eventId: `customer-report:${revision}`,
      sourceRevision: revision,
      occurredAt: payload.asOf,
      payload,
    });
    return payload;
  });
}
function startCustomerReporting(options = {}) {
  let stopped = false,
    running = false,
    initialized = false,
    active;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    let timeout;
    try {
      if (!initialized) {
        await (options.backfill || backfillCustomerProjection)();
        initialized = true;
      }
      await (options.report || reportCustomerProjection)();
      if (stopped) return;
      const controller = new AbortController();
      active = controller;
      const deadline = new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(Error("Heartbeat deadline reached")),
          { once: true },
        );
        timeout = setTimeout(
          () => controller.abort(),
          options.heartbeatTimeoutMs ?? 10000,
        );
      });
      const heartbeat =
        options.heartbeat ||
        ((signal) =>
          require("./opsHubClient").opsHubRequest("/api/v1/ingest/heartbeat", {
            body: { status: "up" },
            signal,
          }));
      await Promise.race([heartbeat(controller.signal), deadline]);
    } catch (e) {
      if (!stopped)
        (
          options.onError ||
          ((error) =>
            console.warn("[OpsHub] Customer reporting pending:", error.message))
        )(e);
    } finally {
      if (timeout) clearTimeout(timeout);
      active = undefined;
      running = false;
    }
  };
  const timer = setInterval(
    () => void tick(),
    options.intervalMs ?? expectedInterval(),
  );
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    active?.abort();
  };
}
module.exports = {
  backfillCustomerProjection,
  reportCustomerProjection,
  startCustomerReporting,
};
