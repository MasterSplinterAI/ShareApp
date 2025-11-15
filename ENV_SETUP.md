# Environment Variables Setup Guide

This document describes all environment variables needed for the application.

## 📁 File Structure

```
share-app/
├── backend/
│   └── .env              # Backend environment variables
├── frontend/
│   └── .env              # Frontend environment variables (optional)
└── translation-agent/
    └── .env              # Translation agent environment variables
```

## 🔧 Backend Environment Variables

**File:** `backend/.env`

```bash
# Daily.co Configuration
DAILY_API_KEY=your_daily_api_key_here

# Server Configuration
PORT=3000

# Frontend Configuration (for CORS)
FRONTEND_URL=http://localhost:5173
```

### Required Variables:

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `DAILY_API_KEY` | Your Daily.co API key | [Daily.co Dashboard](https://dashboard.daily.co/developers) → Developers section |
| `PORT` | Express server port | Default: `3000` |
| `FRONTEND_URL` | Frontend URL for CORS | Default: `http://localhost:5173` |

### Optional Variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DAILY_DOMAIN` | Your Daily.co subdomain | Not needed (room URLs come from API) |

---

## 🎨 Frontend Environment Variables

**File:** `frontend/.env` (Optional)

```bash
# API Configuration
VITE_API_URL=http://localhost:3000

# Optional: Daily.co Domain
# VITE_DAILY_DOMAIN=yourcompany.daily.co
```

### Required Variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3000` |

### Optional Variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_DAILY_DOMAIN` | Daily.co subdomain | Not needed (room URLs come from backend) |

**Note:** Frontend `.env` is optional. The app will use defaults if not provided.

---

## 🤖 Translation Agent Environment Variables

**File:** `translation-agent/.env`

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-proj-your-openai-api-key-here

# Daily.co Configuration (set dynamically by backend)
VIDEOSDK_AUTH_TOKEN=
MEETING_ID=

# Agent Configuration
AGENT_NAME=Translation Agent
OPENAI_MODEL=gpt-realtime-2025-08-28
OPENAI_VOICE=alloy
```

### Required Variables:

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `OPENAI_API_KEY` | Your OpenAI API key | [OpenAI Platform](https://platform.openai.com/api-keys) |

### Dynamic Variables (Set by Backend):

| Variable | Description | Notes |
|----------|-------------|-------|
| `VIDEOSDK_AUTH_TOKEN` | Daily.co meeting token | Set automatically when agent starts |
| `MEETING_ID` | Meeting/room ID | Set automatically when agent starts |

### Optional Variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_NAME` | Name shown in meeting | `Translation Agent` |
| `OPENAI_MODEL` | OpenAI Realtime API model | `gpt-realtime-2025-08-28` |
| `OPENAI_VOICE` | TTS voice (alloy, echo, fable, onyx, nova, shimmer) | `alloy` |

---

## 🚀 Quick Setup

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env and add your DAILY_API_KEY
```

### 2. Frontend Setup (Optional)

```bash
cd frontend
cp .env.example .env
# Edit .env if you need custom API URL
```

### 3. Translation Agent Setup

```bash
cd translation-agent
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

---

## 🔐 Security Notes

1. **Never commit `.env` files** - They contain sensitive API keys
2. **Use `.env.example` files** - These are safe to commit (no real keys)
3. **Production**: Use environment variables or secrets management (AWS Secrets Manager, etc.)
4. **API Keys**: Keep them secure and rotate regularly

---

## 📝 Example .env Files

### Backend `.env`
```bash
DAILY_API_KEY=abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
PORT=3000
FRONTEND_URL=http://localhost:5173
```

### Frontend `.env` (Optional)
```bash
VITE_API_URL=http://localhost:3000
```

### Translation Agent `.env`
```bash
OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
AGENT_NAME=Translation Agent
OPENAI_MODEL=gpt-realtime-2025-08-28
OPENAI_VOICE=alloy
```

---

## ✅ Verification

After setting up your `.env` files, verify they're loaded correctly:

### Backend
```bash
cd backend
node -e "require('dotenv').config(); console.log('DAILY_API_KEY:', process.env.DAILY_API_KEY ? 'Set ✓' : 'Missing ✗')"
```

### Frontend
The frontend will use defaults if `.env` is missing, so it's optional.

### Translation Agent
```bash
cd translation-agent
python3 -c "from dotenv import load_dotenv; import os; load_dotenv(); print('OPENAI_API_KEY:', 'Set ✓' if os.getenv('OPENAI_API_KEY') else 'Missing ✗')"
```

