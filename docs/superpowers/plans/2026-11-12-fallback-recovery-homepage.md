# Fallback usage, agent recovery and free-signup homepage

Owner explicitly requested these changes. Existing approved operations/recovery design applies; this extends its qualified partial agent snapshots to verified deployable sources. Stripe remains TEST and autocharge OFF.

## Design and execution
- Homepage: remove interactive demo entry points from public homepage/shared marketing navigation and promote existing free signup. Preserve enterprise contact demos and existing unrelated routes.
- Stable telemetry: trace current CostReporter configuration and backend mapping, merge the verified backend URL/cost credential into the existing stable agent, then prove actual synthetic media emits accepted cost events and correct organization usage. No real customer billing or credential values in logs.
- Agent recovery: inventory deployed secret names and retained source candidates privately. Verify candidates with provider APIs when necessary, establish exact known deployed inputs using controlled merges (no provider-account key revocation), and retain encrypted snapshots before changes. Preserve verified module/provider choices. Known retained timing/logging values (caption delay3.0seconds, primary endpointing600ms and INFO logging) are re-established and runtime-validated; historical cloud values are not exported or asserted unchanged. Run both profiles through media/telemetry checks using recovered inputs. Mark complete only when all required deployed inputs have qualified sources and retrieval equality is verified.
- Review: independent review of mutation boundaries and recovery completeness; root serializes cloud mutations, commits and web deployment. Keep rollback versions and backups. Existing LiveKit secrets cannot be read back; successful known-value injection plus provider/runtime validation is the source qualification.

## Checks
- [x] Trace usage ingestion and prepare disposable fixture/aggregate verification.
- [x] Remove homepage demo links and build frontend.
- [x] Inventory and securely preserve complete agent inputs; review safe merge/recovery method.
- [x] Fix stable configuration and verify usage from synthetic media.
- [x] Verify both agent recovery manifests and actual restored configuration/media.
- [x] Deploy homepage, inspect desktop/mobile and signup destination, save screenshot.
- [x] Clean test fixtures/rooms/temp secrets, verify TEST/off/health, update evidence/PR.

## Runtime findings and gates
- Initial stable configuration repair enabled LLM cost events but real media exposed a second-cancellation race before the final STT report. Source `a82930ad4449d2c55b79a94be2c2e7c7e1a37884` queues accepted-PCM reporting into protected tasks before cleanup yields, in both profiles. The repeated-cancellation regression failed before the fix; all 237 tests passed with the real SDK outside local process restrictions.
- Each exact named candidate requires a fresh zero-cost fixture and positive provider costs, exact STT-to-usage mirrors, and correct remaining free minutes. Previously recorded costs cannot satisfy a later attempt.
- Secret-update completion additionally requires actual new-worker registration and previous-worker shutdown before media dispatch. Image version alone does not establish fresh configuration. Old pending recovery versions are superseded and cannot be finalized under the new source/image pins.

## Outcome
Published homepage5f21ea6 and tested agent sourcea82930a. Both exact images were promoted, complete known configurations reapplied, fresh production workers tested, and encrypted recovery snapshots finalized with verified readback. All four post-fix media/accounting runs passed. See docs/launch/2026-11-12-fallback-recovery.md for durable evidence and intentional remaining launch limits.
