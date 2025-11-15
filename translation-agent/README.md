# Translation Agent

Python agent that joins VideoSDK meetings and provides real-time bi-directional translation using OpenAI Realtime API.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Create `.env` file:
```
OPENAI_API_KEY=your_openai_api_key
VIDEOSDK_AUTH_TOKEN=your_videosdk_token
MEETING_ID=meeting_id_to_join
```

## Usage

Run the agent:
```bash
python agent.py
```

The agent will:
1. Join the specified meeting as "Translation Agent"
2. Capture audio from participants
3. Send audio to OpenAI for translation
4. Inject translated audio back into the meeting

## Configuration

Edit `config.py` to customize:
- OpenAI model and voice
- Translation languages
- Audio processing parameters

