import type { SupportUser } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";

/** Shape attached by ShareApp `optionalV2Auth` / `requireV2Auth`. */
export type V2Auth = {
  userId: string;
  email?: string;
  orgId?: string;
  role?: string;
};

export function mapV2AuthToSupportUser(
  auth: V2Auth | null | undefined,
): SupportUser | null {
  if (!auth?.userId) return null;
  const role =
    auth.role === "admin" || auth.role === "ops" || auth.role === "owner"
      ? auth.role === "owner"
        ? "admin"
        : auth.role
      : "user";
  return {
    id: auth.userId,
    role,
    ...(auth.email ? { email: auth.email } : {}),
    ...(auth.orgId ? { orgId: auth.orgId } : {}),
  };
}

export type HostSqliteHandle = {
  run: (sql: string, params?: unknown[]) => Promise<{ changes?: number; lastID?: unknown }>;
  get: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
};

/**
 * Wrap ShareApp's existing sqlite3 / v2Database handle as the kit DbAdapter.
 * Host keeps the pool; kit never opens its own connection.
 */
export function createHostSqliteDbAdapter(host: HostSqliteHandle): DbAdapter {
  return {
    async run(sql, params = []) {
      const result = await host.run(sql, params);
      return { changes: result.changes ?? 0 };
    },
    async get(sql, params = []) {
      return host.get(sql, params);
    },
    async all(sql, params = []) {
      return host.all(sql, params);
    },
  };
}

/**
 * Express-style resolveUser for ShareApp: read `req.v2Auth` after optionalV2Auth.
 */
export function resolveShareAppUser(req: unknown): SupportUser | null {
  const auth = (req as { v2Auth?: V2Auth } | null)?.v2Auth;
  return mapV2AuthToSupportUser(auth);
}
