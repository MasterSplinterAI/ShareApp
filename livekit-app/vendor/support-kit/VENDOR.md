# Vendored support-kit

Packages under `packages/{shared,core,react,channels}` are a snapshot of
`@rhule/support-*` for ShareApp (LegalAI uses the same kit).

## ShareApp host notes

- Auth is Bearer JWT (`localStorage.v2_token`), not cookies. The vendored
  `@rhule/support-react` accepts `getAccessToken` on `SupportLauncher` and
  `SupportOpsConsole`.
- Backend mounts the kit at `/api/v2/support` by default
  (`backend/lib/supportKit.js`). Set `SUPPORT_KIT_ENABLED=false` only together
  with a FE rollback to legacy HelpPanel/SupportTab.
- Tables use the kit default prefix `support_*` (fresh schema; not
  `v2_support_*`).
- After cloning, run `npm install` inside `packages/{shared,core,channels,react}`
  so nested `file:` deps resolve when Node loads via backend/frontend symlinks.

## Re-vendor

Copy from the support-kit monorepo, keep `file:../shared` deps (not
`workspace:*`), rebuild package `dist/` folders, then re-apply the
`getAccessToken` patch in `packages/react` if upstream has not landed it yet.
