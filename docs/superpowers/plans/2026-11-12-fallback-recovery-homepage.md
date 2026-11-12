# Fallback usage, agent recovery and free-signup homepage

Owner explicitly requested these changes. Existing approved operations/recovery design applies; this extends its qualified partial agent snapshots to verified deployable sources. Stripe remains TEST and autocharge OFF.

## Design and execution
- Homepage: remove interactive demo entry points from public homepage/shared marketing navigation and promote existing free signup. Preserve enterprise contact demos and existing unrelated routes.
- Stable telemetry: trace current CostReporter configuration and backend mapping, merge the verified backend URL/cost credential into the existing stable agent, then prove actual synthetic media emits accepted cost events and correct organization usage. No real customer billing or credential values in logs.
- Agent recovery: inventory deployed secret names and retained source candidates privately. Verify candidates with provider APIs when necessary, establish exact known deployed inputs using controlled merges (no provider-account key revocation), and retain encrypted snapshots before changes. Preserve module/provider choices and unknown settings until resolved. Run both profiles through media/telemetry checks using recovered inputs. Mark complete only when all required deployed inputs have qualified sources and retrieval equality is verified.
- Review: independent review of mutation boundaries and recovery completeness; root serializes cloud mutations, commits and web deployment. Keep rollback versions and backups. Existing LiveKit secrets cannot be read back; successful known-value injection plus provider/runtime validation is the source qualification.

## Checks
- [ ] Trace usage ingestion and prepare disposable fixture/aggregate verification.
- [ ] Remove homepage demo links and build frontend.
- [ ] Inventory and securely preserve complete agent inputs; review safe merge/recovery method.
- [ ] Fix stable configuration and verify usage from synthetic media.
- [ ] Verify both agent recovery manifests and actual restored configuration/media.
- [ ] Deploy homepage, inspect desktop/mobile and signup destination, save screenshot.
- [ ] Clean test fixtures/rooms/temp secrets, verify TEST/off/health, update evidence/PR.
