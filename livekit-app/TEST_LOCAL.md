# Local Translation Test

## Stack is running

- **Frontend**: http://localhost:5174
- **Backend**: http://localhost:3001
- **Agent**: transcription_only_agent (translation-bot-dev)

## Test flow (two browsers/tabs)

### 1. Host (Spanish)

1. Open **Chrome** → http://localhost:5174?debug=1
2. Click **Start Meeting**
3. Name: `Host`, Language: **Spanish** → Continue
4. You're in the room. Click **Share meeting** and copy the join link.

### 2. Guest (English)

1. Open **Firefox** (or Safari / Chrome incognito) → paste the join link + `?debug=1`
   - Example: `http://localhost:5174/join/dev-room-xxx?debug=1`
2. Name: `Guest`, Language: **English** (default) → Continue
3. Both Host and Guest are now in the same room.

### 3. Voice test

- **Host tab**: Speak in Spanish (e.g. "Hola, ¿cómo estás?")
- **Guest tab**: Should see English translation: "Hello, how are you?"
- **Guest tab**: Speak in English (e.g. "I'm doing great, thanks!")
- **Host tab**: Should see Spanish translation: "Estoy muy bien, gracias!"

### 4. Watch logs

```bash
cd livekit-app
tail -f agent.log
```

Look for:
- `📨 Data received: type=language_update, from=Host` and `from=Guest`
- `📥 Language update: Host → es` and `Guest → en`
- `📊 update_assistants: speakers=['Host','Guest'], targets={'es','en'}`
- Transcription/translation lines when you speak

### 5. Debug panel

With `?debug=1`, click **Depurar** in the room to see:
- Your language and translation status
- Last language sent
- Agent presence

## Restart stack

```bash
cd livekit-app
./start_local.sh
```

## Troubleshooting

- **No translation**: Ensure both Host and Guest have translation enabled (toggle in room).
- **Guest language not received**: RoomControls now resends on `connected` and when agent joins.
- **Agent not joining**: Check `agent.log` for "received job request" and "📋 Room:".
