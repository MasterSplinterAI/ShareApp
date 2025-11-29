# DOM Translator Integration Guide

This document explains the integration of the DOM webapp translator into the live conference translation app.

## Overview

The DOM translator has been integrated to translate text content on the webapp interface while excluding the transcription box. Users can select their preferred language when joining a meeting, and this language is used for both:
1. Live audio translation (via LiveKit agent)
2. DOM/webapp interface translation

## Features Implemented

### 1. Language Selection in Name Modal
- **Updated**: `NameModal.jsx`
- Users can now select their preferred translation language when entering their name
- Language dropdown includes all supported languages (English, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Tiv)
- Language selection is available both when:
  - Hosting a new meeting (`HomeScreen.jsx`)
  - Joining via shared link (`JoinMeeting.jsx`)

### 2. DOM Translator Service
- **Created**: `frontend/src/services/domTranslator.js`
- Scans the DOM for text nodes and translates them
- Automatically excludes elements with `data-no-translate` attribute
- Excludes transcription box and related elements
- Caches translations in sessionStorage for performance
- Observes DOM changes to translate dynamically added content

### 3. Transcription Box Exclusion
- **Updated**: `TranscriptionDisplay.jsx`
- Added `data-no-translate="true"` attribute to the transcription container
- Transcription content will not be translated by the DOM translator
- This ensures users can read transcriptions in their original language

### 4. Backend Translation Endpoint
- **Created**: `backend/routes/translate.js`
- **Endpoint**: `POST /api/translate`
- Supports multiple translation providers:
  - **MyMemory** (default, free tier available)
  - **Google Translate API** (requires API key)
  - **LibreTranslate** (free, open-source, can be self-hosted)
- Configure via environment variables (see Configuration section)

### 5. Integration with Meeting Room
- **Updated**: `MeetingRoom.jsx`
- DOM translator initializes when user enters the meeting room
- Uses the language selected during name entry
- Updates automatically when user changes language via LanguageSelector
- Cleans up on component unmount

## Configuration

### Backend Environment Variables

Add to your `.env` file:

```bash
# Translation API Configuration
# Options: 'google', 'libretranslate', 'mymemory' (default: 'mymemory')
TRANSLATE_API_PROVIDER=mymemory

# Google Translate API (if using 'google' provider)
# GOOGLE_TRANSLATE_API_KEY=your-google-translate-api-key

# LibreTranslate URL (if using 'libretranslate' provider)
# Default: https://libretranslate.com
# LIBRETRANSLATE_URL=https://libretranslate.com
```

### Translation Providers

#### MyMemory (Default - No Setup Required)
- Free tier: 10,000 characters/day
- No API key required
- Good for development and small deployments

#### Google Translate API
- Requires API key from Google Cloud Console
- More accurate translations
- Pay-as-you-go pricing
- Set `TRANSLATE_API_PROVIDER=google` and `GOOGLE_TRANSLATE_API_KEY=your-key`

#### LibreTranslate
- Free and open-source
- Can be self-hosted
- Set `TRANSLATE_API_PROVIDER=libretranslate`
- Optionally set `LIBRETRANSLATE_URL` if using self-hosted instance

## How It Works

1. **User Joins Meeting**:
   - User enters name and selects preferred language in `NameModal`
   - Language preference is stored in `participantInfo` and `sessionStorage`

2. **Meeting Room Initialization**:
   - `MeetingRoom` component reads language preference from `participantInfo`
   - Initializes DOM translator with selected language
   - If language is English, DOM translator is not activated

3. **DOM Translation**:
   - DOM translator scans the page for text nodes
   - Excludes elements with `data-no-translate` attribute
   - Excludes transcription box and related elements
   - Translates text nodes via backend API
   - Caches translations for performance
   - Observes DOM changes for dynamic content

4. **Language Changes**:
   - User can change language via `LanguageSelector` component
   - DOM translator updates automatically
   - Both live audio translation and DOM translation use the same language

## Excluding Elements from Translation

To exclude any element from DOM translation, add the `data-no-translate` attribute:

```html
<div data-no-translate>
  This content will not be translated
</div>
```

The transcription box is automatically excluded. Other excluded elements include:
- Script tags
- Style tags
- Code blocks
- Elements with class/id containing "transcription"

## API Endpoint

### POST /api/translate

**Request Body**:
```json
{
  "text": "Hello, world!",
  "targetLanguage": "es"
}
```

**Response**:
```json
{
  "translatedText": "¡Hola, mundo!"
}
```

## Files Modified/Created

### Frontend
- `frontend/src/components/NameModal.jsx` - Added language selector
- `frontend/src/components/JoinMeeting.jsx` - Pass language to participantInfo
- `frontend/src/components/HomeScreen.jsx` - Pass language to participantInfo
- `frontend/src/components/MeetingRoom.jsx` - Initialize DOM translator
- `frontend/src/components/TranscriptionDisplay.jsx` - Added data-no-translate attribute
- `frontend/src/services/domTranslator.js` - New DOM translator service

### Backend
- `backend/routes/translate.js` - New translation endpoint
- `backend/server.js` - Added translate route
- `backend/env.example` - Added translation API configuration

## Testing

1. **Start the backend server**:
   ```bash
   cd livekit-app/backend
   npm start
   ```

2. **Start the frontend**:
   ```bash
   cd livekit-app/frontend
   npm run dev
   ```

3. **Test the integration**:
   - Create a new meeting or join via shared link
   - Select a non-English language in the name modal
   - Verify that interface elements are translated
   - Verify that transcription box is NOT translated
   - Change language via LanguageSelector and verify DOM updates

## Notes

- The DOM translator uses sessionStorage to cache translations for performance
- Translations are performed client-side via backend API calls
- No database is required - translations are handled via external APIs
- The transcription box is automatically excluded from translation
- If translation API fails, original text is returned (graceful degradation)

## Future Enhancements

- Add support for more translation providers
- Implement batch translation for better performance
- Add translation quality indicators
- Allow users to toggle DOM translation on/off independently
- Add support for right-to-left languages (RTL)

