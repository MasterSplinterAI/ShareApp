# Repository Cleanup Plan

## Current State Analysis

**What's Actually Used:**
- `livekit-app/` - Main application (backend, frontend, translation-agent)
- `deploy.sh`, `deploy-fast.sh` - Deployment scripts
- `.gitignore` - Git configuration
- Root `README.md` - Main documentation

**What Can Be Safely Removed:**

### 1. Old Duplicate Folders (Root Level)
- `backend/` - Old backend, replaced by `livekit-app/backend/`
- `frontend/` - Old frontend, replaced by `livekit-app/frontend/`
- `translation-agent/` - Old agent, replaced by `livekit-app/translation-agent/`
- `backup/` - Old app backup (already in .gitignore)

### 2. Log Files (43+ files)
- All `.log` files throughout the repository:
  - Root: `agent.log`, `backend.log`, `frontend.log`
  - `livekit-app/agent.log`, `livekit-app/backend.log`, `livekit-app/frontend.log`
  - `livekit-app/backend/backend.log`
  - `livekit-app/frontend/frontend.log`
  - `livekit-app/translation-agent/` - 30+ log files (agent_*.log, agent.log, etc.)
- `agent.pid` files
- `nohup.out` files

### 3. Old Root Config Files
- `package.json`, `package-lock.json` - Old screenshare app config
- `tailwind.config.js`, `postcss.config.js` - Old Tailwind configs
- `node_modules/` at root (if exists)

### 4. Outdated Documentation
Keep essential docs, remove redundant ones:
- **Keep:** `README.md`, `livekit-app/README.md`
- **Remove:** Root level docs that duplicate `livekit-app/` docs:
  - `BUILD_PLAN.md`, `DAILY_MIGRATION.md`, `DEPLOYMENT.md`, `ENV_SETUP.md`
  - `LOCAL_TESTING.md`, `MULTI_PARTICIPANT_TRANSLATION.md`
  - `TESTING_GUIDE.md`, `TRANSLATION_IMPLEMENTATION.md`
  - `TRANSLATION_STATUS.md`, `TRANSLATION_TESTING.md`, `TROUBLESHOOTING.md`

### 5. Test/Debug Scripts
- `test-local.sh` - Old test script
- `cleanup-unused.sh`, `cleanup-server.sh` - Old cleanup scripts
- `aws-ports.sh` - Check if still needed for deployment

### 6. Other Temporary Files
- `images/` - Check if used by frontend (may contain assets)
- `~/` folder - Temporary folder

## Cleanup Steps

1. **Backup current state** (git commit before cleanup)
2. **Remove old duplicate folders** at root level
3. **Remove all log files** (already in .gitignore, safe to delete)
4. **Remove old root config files** (package.json, tailwind.config.js, etc.)
5. **Remove outdated root-level documentation** (keep only README.md)
6. **Remove test/debug scripts** (unless still needed)
7. **Update .gitignore** to ensure logs stay ignored
8. **Verify deployment scripts still work** (they reference `livekit-app/`)
9. **User will verify and commit manually** after confirming everything works

## Safety Measures

- All changes will be committed to git BEFORE cleanup (can restore from GitHub)
- Log files are already in .gitignore (won't affect git history)
- Only removing unused duplicates, keeping all active code
- Deployment scripts reference `livekit-app/` paths (will continue working)
- **No final commit** - user will verify and commit manually when ready

## Verification

After cleanup:
- `livekit-app/` directory intact
- `deploy.sh` and `deploy-fast.sh` still functional
- No broken references in code
- Repository structure cleaner and easier to navigate
- User can test and verify before committing changes

## Implementation Todos

1. ✅ Commit current state to git as backup before cleanup
2. ✅ Remove old duplicate folders: backend/, frontend/, translation-agent/, backup/
3. ✅ Remove all .log files, .pid files, and nohup.out files throughout repository
4. ✅ Remove old root config files: package.json, package-lock.json, tailwind.config.js, postcss.config.js, root node_modules/
5. ✅ Remove outdated root-level .md files, keep only README.md
6. ✅ Remove old test/debug scripts: test-local.sh, cleanup-unused.sh, cleanup-server.sh
7. ✅ Verify deploy.sh and deploy-fast.sh still reference correct paths (livekit-app/)
8. ✅ User will verify everything works, then commit manually when ready

