# Vendored support-kit

Packages under `packages/{shared,core,react,channels}` are a snapshot of
`@rhule/support-*` for ShareApp (LegalAI uses the same kit).

**Upstream tip:** `bf9c368` (public help contact gate + auditable leads).

## ShareApp host notes

- Auth is Bearer JWT (`localStorage.v2_token`), not cookies. The vendored
  `@rhule/support-react` accepts `getAccessToken` on `SupportLauncher` and
  `SupportOpsConsole` (ShareApp patch until upstream lands it).
- Backend mounts the kit at `/api/v2/support` by default
  (`backend/lib/supportKit.js`). Set `SUPPORT_KIT_ENABLED=false` only together
  with a FE rollback to legacy HelpPanel/SupportTab.
- Tables use the kit default prefix `support_*` (fresh schema; not
  `v2_support_*`). Includes `support_leads` for public contact gate.
- After cloning, run `npm install` inside `packages/{shared,core,channels,react}`
  so nested `file:` deps resolve when Node loads via backend/frontend symlinks.
- Schema ensure is deferred until first request / post-`initDatabase`
  (`ensureReady` patch) so SQLite open does not race `CREATE TABLE`.

## Re-vendor

Copy from `~/Documents/support-kit`, keep `file:../shared` deps (not
`workspace:*`), rebuild package `dist/` folders, then re-apply:
1. `getAccessToken` on SupportLauncher + SupportOpsConsole
2. Lazy `ensureReady` in `createHttpRouter` (if upstream still starts
   `ensureSchema` at router construction)
