# Marketing runtime packaging

`deploy-staging.sh` builds marketing runtime artifacts from the pinned temporary checkout before synchronizing runtime marketing files. The frontend dependency preparation is performed in that temporary checkout, using the existing frontend install/lockfile flow. The live frontend does not need React, esbuild, or other build dependencies for backend marketing imports.

`prepare-marketing-runtime.mjs` verifies the snapshot's source hashes before executing its canonical build script, checks that the source pin did not change during the build, and stages the exact source files, consumer-owned package locks, manifest, and generated ESM/CJS output. `runtime-artifacts.json` records the canonical source commit/content hash and generated file hashes. The stage is import-tested without frontend peers.

The general vendor `rsync --delete` excludes marketing-kit. A separate publication step verifies the staged pin against the selected checkout, then copies only the explicit artifact file list, without deleting runtime configuration, media, installed dependencies, or other unlisted files. It verifies the copied source and artifact hashes immediately afterward. The backend's actual `@rhule/marketing-core` and `@rhule/marketing-shared` package imports are checked before PM2 restart. The existing complete frontend locale/build/prerender flow remains in place.

A source validation or kit build failure exits before marketing publication. A staged pin/hash mismatch also prevents publication. A transfer/import failure prevents restart; this is not an atomic rollback of the entire pre-existing deployment procedure. Error handling changes are limited to this packaging stage.

Offline regression (no deployment, network install, provider calls, or database fixtures):

```sh
node --test deploy/test/marketing-runtime.test.mjs
```

Set `MARKETING_TEST_NODE` to a Node 20 executable when it is not installed at the test's local default. The test runs the actual deployment packaging, rsync, verification and import blocks against temporary checkout/runtime directories with an isolated sudo shim. It uses existing installed frontend tools and proves runtime imports without live frontend dependencies, preservation of unrelated runtime files, and rejection of failed builds, source/artifact tampering, and pin mismatches before restart.
