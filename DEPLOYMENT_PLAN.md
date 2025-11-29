# Deployment Plan for Autopilot Translator SDK Integration

## Overview

This document outlines the deployment plan for integrating the Autopilot Translator SDK with the existing LiveKit application. The deployment script needs minor updates to ensure proper database initialization and environment variable configuration.

## Current Status

### ✅ Already Configured
- Backend server (`server.js`) already includes `/api/translate` route
- `sqlite3` dependency already in `package.json`
- Translation route (`routes/translate.js`) auto-creates database on first load
- Deployment script handles Node.js backend deployment correctly

### ⚠️ Needs Attention
- Database file (`translations.db`) will be created automatically on first API call
- Environment variables need to be added to server `.env` file
- Frontend build includes new autopilot translator SDK files

## Deployment Checklist

### 1. Environment Variables

The backend `.env` file on the server needs these new variables:

```bash
# Translation API Configuration (Autopilot Translator SDK)
TRANSLATION_API_PROVIDER=grok  # or 'openai'
TRANSLATION_API_KEY=your_grok_or_openai_api_key
TRANSLATION_API_URL=https://api.x.ai/v1/chat/completions  # Only if using Grok
TRANSLATION_MODEL=grok-4-1-fast-non-reasoning  # Only if using Grok
USE_DATABASE_CACHE=true  # Enable SQLite caching (recommended)
```

**Action Required:**
- SSH to server and edit `/var/www/share-app/livekit-app/backend/.env`
- Add the translation API variables above
- Restart backend: `pm2 restart livekit-backend`

### 2. Database Initialization

The SQLite database (`translations.db`) will be created automatically when:
- The backend server starts and loads `routes/translate.js`
- OR when the first translation API call is made

**No manual database setup required** - the code handles this automatically.

**Location:** `/var/www/share-app/livekit-app/backend/translations.db`

### 3. Deployment Script Analysis

#### Current Script (`deploy.sh`) - ✅ Compatible

The existing deployment script already handles everything needed:

1. **Backend Files**: ✅ Copies all backend files including `routes/translate.js`
2. **Dependencies**: ✅ Installs npm packages (including `sqlite3`)
3. **Database**: ✅ Database auto-creates on first use (no migration needed)
4. **Permissions**: ✅ Sets proper ownership for database file creation
5. **Restart**: ✅ Restarts backend with PM2

#### No Changes Needed to `deploy.sh`

The script is already compatible because:
- It copies all backend files (line 99)
- It installs npm dependencies (line 163)
- It restarts the backend (line 215)
- Database file permissions are handled by the code

### 4. Frontend Deployment

The frontend build includes:
- New autopilot translator SDK files (`src/lib/autopilot-translator.ts`, etc.)
- Updated components with translation support
- New "Slow Speaker" VAD option

**Action:** Standard frontend build/deploy process handles this automatically.

### 5. Server Structure Verification

After deployment, verify:

```bash
# Check backend routes
ls -la /var/www/share-app/livekit-app/backend/routes/
# Should show: auth.js, rooms.js, translate.js

# Check database (created after first API call)
ls -la /var/www/share-app/livekit-app/backend/translations.db
# Should exist after first translation request

# Check environment variables
cat /var/www/share-app/livekit-app/backend/.env | grep TRANSLATION
# Should show translation API configuration
```

## Deployment Steps

### Step 1: Deploy Code (Standard Process)

```bash
cd /Users/rhule/Documents/ShareApp/share-app
./deploy.sh
```

This will:
- Commit and push code to git
- SSH to server
- Pull latest code
- Build frontend
- Copy backend files (including new `translate.js`)
- Install dependencies (including `sqlite3`)
- Restart services

### Step 2: Configure Environment Variables

SSH to server and add translation API config:

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
cd /var/www/share-app/livekit-app/backend
nano .env
```

Add these lines:
```bash
TRANSLATION_API_PROVIDER=grok
TRANSLATION_API_KEY=your_actual_api_key_here
TRANSLATION_API_URL=https://api.x.ai/v1/chat/completions
TRANSLATION_MODEL=grok-4-1-fast-non-reasoning
USE_DATABASE_CACHE=true
```

Save and restart:
```bash
pm2 restart livekit-backend
pm2 logs livekit-backend  # Verify it starts correctly
```

### Step 3: Verify Database Creation

The database will be created automatically on first translation API call. To verify:

```bash
# Check if database exists (may not exist until first API call)
ls -la /var/www/share-app/livekit-app/backend/translations.db

# Or trigger a test API call from frontend
# Database will be created automatically
```

### Step 4: Test Translation API

Test the endpoint:

```bash
curl -X POST http://localhost:3001/api/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello World",
    "target_language": "es-CO",
    "source_language": "en"
  }'
```

Expected response:
```json
{
  "original": "Hello World",
  "translated": "Hola Mundo",
  "target_language": "es-CO"
}
```

## Database Management

### Database Location
- **Path**: `/var/www/share-app/livekit-app/backend/translations.db`
- **Type**: SQLite 3
- **Auto-created**: Yes, on first use
- **Permissions**: Owned by `ubuntu:ubuntu` (set by deployment script)

### Database Schema

The database is automatically created with this schema:

```sql
CREATE TABLE translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source TEXT DEFAULT 'grok',
  usage_count INTEGER DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_hash, target_language)
);

CREATE INDEX idx_source_hash ON translations(source_hash);
CREATE INDEX idx_target_language ON translations(target_language);
CREATE INDEX idx_last_used_at ON translations(last_used_at);
```

### Database Backup

To backup the database:

```bash
# On server
cp /var/www/share-app/livekit-app/backend/translations.db \
   /var/www/share-app/livekit-app/backend/translations.db.backup
```

### Database Size Management

The database will grow over time. To clean old/unused translations:

```bash
# Connect to SQLite
sqlite3 /var/www/share-app/livekit-app/backend/translations.db

# View stats
SELECT COUNT(*) as total_translations, 
       SUM(usage_count) as total_uses,
       COUNT(DISTINCT target_language) as languages
FROM translations;

# Delete translations not used in last 90 days
DELETE FROM translations 
WHERE last_used_at < datetime('now', '-90 days');

# Vacuum to reclaim space
VACUUM;
```

## Troubleshooting

### Issue: Database not created

**Symptoms:** Translation API returns errors, no database file exists

**Solution:**
1. Check file permissions: `ls -la /var/www/share-app/livekit-app/backend/`
2. Ensure `ubuntu` user owns directory: `sudo chown -R ubuntu:ubuntu /var/www/share-app/livekit-app/backend/`
3. Check backend logs: `pm2 logs livekit-backend`
4. Verify `sqlite3` is installed: `npm list sqlite3` in backend directory

### Issue: Translation API returns errors

**Symptoms:** API calls fail with authentication or provider errors

**Solution:**
1. Verify environment variables: `cat /var/www/share-app/livekit-app/backend/.env | grep TRANSLATION`
2. Check API key is valid
3. Verify provider setting matches your API key type
4. Check backend logs: `pm2 logs livekit-backend`

### Issue: CORS errors from frontend

**Symptoms:** Frontend can't call translation API

**Solution:**
1. Verify `FRONTEND_URL` in backend `.env` matches your frontend domain
2. Check CORS configuration in `server.js`
3. Restart backend: `pm2 restart livekit-backend`

## Summary

### ✅ What Works Automatically
- Database creation (auto-creates on first use)
- Route registration (already in server.js)
- Dependency installation (sqlite3 in package.json)
- File deployment (deploy.sh handles everything)

### ⚠️ Manual Steps Required
1. Add translation API environment variables to server `.env`
2. Restart backend service
3. Test translation API endpoint

### 📝 No Script Changes Needed
The existing `deploy.sh` script is fully compatible and requires no modifications.

## Next Steps

1. **Deploy code**: Run `./deploy.sh`
2. **Configure environment**: Add translation API variables to server `.env`
3. **Restart backend**: `pm2 restart livekit-backend`
4. **Test**: Verify translation API works
5. **Monitor**: Check logs and database growth

