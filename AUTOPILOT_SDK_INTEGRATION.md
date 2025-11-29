# Autopilot Translator SDK Integration Guide

This document explains the integration of the **Autopilot Translator SDK** into your live conference translation app.

## Overview

The Autopilot Translator SDK has been integrated to provide automatic DOM translation of your webapp interface. The SDK:
- ✅ Automatically scans and translates DOM content
- ✅ Uses Grok API (X.AI) for high-quality translations
- ✅ Caches translations in database (optional) and localStorage
- ✅ Excludes transcription box from translation
- ✅ Works seamlessly with your existing language selection

## What Was Changed

### Backend (`livekit-app/backend/`)

1. **Updated Translation Route** (`routes/translate.js`)
   - Now compatible with Autopilot SDK API format
   - Uses Grok API (X.AI) for translations
   - Supports both single (`/api/translate`) and batch (`/api/translate/batch`) endpoints
   - Optional SQLite database caching for cost savings

2. **Updated Dependencies** (`package.json`)
   - Added `sqlite3` for database caching (optional)

3. **Updated Environment Variables** (`env.example`)
   - Added Grok API configuration
   - Added database cache toggle

### Frontend (`livekit-app/frontend/`)

1. **Integrated Autopilot SDK**
   - Copied SDK files to `src/lib/`
   - Integrated into `MeetingRoom.jsx` component
   - Automatically initializes with user's selected language

2. **Updated TranscriptionDisplay**
   - Added `data-no-translate` and `notranslate` class
   - Ensures transcription box is excluded from translation

## Setup Instructions

### 1. Install Backend Dependencies

```bash
cd livekit-app/backend
npm install
```

This will install `sqlite3` for optional database caching.

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Grok API Configuration (REQUIRED)
TRANSLATION_API_PROVIDER=grok
TRANSLATION_API_KEY=your-grok-api-key-here
TRANSLATION_API_URL=https://api.x.ai/v1/chat/completions
TRANSLATION_MODEL=grok-4-1-fast-non-reasoning

# Database Caching (OPTIONAL but recommended)
# Set to 'true' to enable SQLite database caching
# This significantly reduces API costs for repeated translations
USE_DATABASE_CACHE=true
```

**To get your Grok API key:**
1. Go to https://console.x.ai
2. Navigate to API Keys section
3. Create a new API key
4. Copy and paste it into your `.env` file

### 3. Frontend Dependencies

The frontend already has `axios` installed, which is required by the SDK. No additional installation needed.

### 4. Start the Application

```bash
# Backend
cd livekit-app/backend
npm start

# Frontend (in another terminal)
cd livekit-app/frontend
npm run dev
```

## How It Works

1. **User Joins Meeting**
   - User selects language in `NameModal`
   - Language preference is stored in `participantInfo`

2. **Meeting Room Initializes**
   - Autopilot SDK initializes with selected language
   - SDK automatically scans DOM for text nodes
   - Translates content via backend API

3. **Translation Process**
   - Frontend SDK sends translation requests to `/api/translate/batch`
   - Backend checks database cache first
   - If not cached, calls Grok API
   - Saves translation to database cache
   - Returns translated text to frontend
   - Frontend updates DOM with translations

4. **Language Changes**
   - User changes language via `LanguageSelector`
   - SDK automatically retranslates page
   - Uses cached translations when available

## Database Caching (Optional)

When `USE_DATABASE_CACHE=true`:
- Translations are stored in `translations.db` (SQLite)
- Significantly reduces API costs for repeated translations
- Database file is created automatically in `backend/` directory
- Can be safely deleted to reset cache

**Database Schema:**
- `source_text`: Original English text
- `source_hash`: SHA256 hash for fast lookup
- `target_language`: Target language code (e.g., 'es-CO')
- `translated_text`: Translated text
- `usage_count`: How many times used
- `last_used_at`: Last usage timestamp

## Excluding Content from Translation

The transcription box is automatically excluded. To exclude other elements:

**Method 1: `data-no-translate` attribute**
```html
<div data-no-translate>
  This content will not be translated
</div>
```

**Method 2: `notranslate` class**
```html
<div class="notranslate">
  This content will not be translated
</div>
```

**Method 3: `data-i18n-skip` attribute**
```html
<div data-i18n-skip>
  This content will not be translated
</div>
```

## API Endpoints

### POST `/api/translate`

Single text translation (Autopilot SDK compatible):

**Request:**
```json
{
  "text": "Hello World",
  "target_language": "es-CO",
  "source_language": "en"
}
```

**Response:**
```json
{
  "original": "Hello World",
  "translated": "Hola Mundo",
  "target_language": "es-CO"
}
```

### POST `/api/translate/batch`

Batch translation (more efficient):

**Request:**
```json
{
  "texts": ["Hello", "World", "Welcome"],
  "target_language": "es-CO",
  "source_language": "en"
}
```

**Response:**
```json
{
  "translations": ["Hola", "Mundo", "Bienvenido"],
  "target_language": "es-CO"
}
```

## Troubleshooting

### Backend Issues

**Problem:** `Cannot find module 'sqlite3'`
- **Solution:** Run `npm install` in `backend/` directory

**Problem:** Translation API errors
- **Solution:** Check that `TRANSLATION_API_KEY` is set correctly in `.env`
- Verify your Grok API key is valid at https://console.x.ai

**Problem:** Database errors
- **Solution:** Set `USE_DATABASE_CACHE=false` to disable database caching
- Or check file permissions for `translations.db`

### Frontend Issues

**Problem:** TypeScript errors with SDK files
- **Solution:** Vite handles TypeScript automatically. If issues persist, ensure `axios` is installed

**Problem:** Translations not working
- **Solution:** 
  1. Check browser console for errors
  2. Verify backend is running and accessible
  3. Check that API endpoint matches frontend configuration
  4. Ensure language is not 'en' (English doesn't translate)

**Problem:** Transcription box is being translated
- **Solution:** Verify `data-no-translate` and `notranslate` attributes are present on TranscriptionDisplay component

## Cost Optimization

1. **Enable Database Caching**
   - Set `USE_DATABASE_CACHE=true`
   - Repeated translations are free (from cache)

2. **Batch Translation**
   - SDK automatically batches multiple texts
   - Reduces API calls significantly

3. **LocalStorage Caching**
   - Frontend SDK caches translations in browser
   - Persists across page reloads

## Files Modified

### Backend
- `routes/translate.js` - Updated to use Grok API and match SDK format
- `package.json` - Added sqlite3 dependency
- `env.example` - Added Grok API configuration

### Frontend
- `components/MeetingRoom.jsx` - Integrated Autopilot SDK
- `components/TranscriptionDisplay.jsx` - Added exclusion attributes
- `lib/autopilot-translator.ts` - SDK files (copied from repo)
- `lib/language-selector.ts` - SDK language selector utilities
- `lib/languages.ts` - Language definitions

## Next Steps

1. **Get Grok API Key**
   - Sign up at https://console.x.ai
   - Create API key
   - Add to `.env` file

2. **Test the Integration**
   - Start backend and frontend
   - Join a meeting with non-English language selected
   - Verify interface elements translate
   - Verify transcription box does NOT translate

3. **Enable Database Caching** (Recommended)
   - Set `USE_DATABASE_CACHE=true` in `.env`
   - Restart backend
   - Database will be created automatically

## Support

For issues with:
- **Autopilot SDK**: Check the SDK repository documentation
- **Integration**: Review this guide and check console logs
- **Grok API**: Visit https://console.x.ai for API documentation

