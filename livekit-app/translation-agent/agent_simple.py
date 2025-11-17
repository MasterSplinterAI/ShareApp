#!/usr/bin/env python
"""
Simple translation service using OpenAI API
Note: This is a placeholder that demonstrates the translation capability
For production, you'll need the full LiveKit agents framework
"""
import os
import asyncio
from dotenv import load_dotenv
import openai
from aiohttp import web

# Load environment variables
load_dotenv()

# Configure OpenAI
client = openai.AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))

async def translate_text(text, target_language):
    """Translate text using OpenAI"""
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": f"Translate the following text to {target_language}. Only provide the translation, no explanations."
                },
                {
                    "role": "user",
                    "content": text
                }
            ],
            temperature=0.3,
            max_tokens=500
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Translation error: {e}")
        return text

async def handle_translate(request):
    """HTTP endpoint for translation requests"""
    try:
        data = await request.json()
        text = data.get('text', '')
        target_lang = data.get('target_language', 'en')
        
        translated = await translate_text(text, target_lang)
        
        return web.json_response({
            'original': text,
            'translated': translated,
            'target_language': target_lang
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

async def health_check(request):
    """Health check endpoint"""
    return web.json_response({'status': 'ok', 'service': 'translation-agent'})

def create_app():
    """Create the web application"""
    app = web.Application()
    app.router.add_post('/translate', handle_translate)
    app.router.add_get('/health', health_check)
    return app

if __name__ == '__main__':
    print("=" * 60)
    print("Simple Translation Service Starting...")
    print("=" * 60)
    print(f"OpenAI API Key: {'***' + os.getenv('OPENAI_API_KEY', 'NOT SET')[-10:] if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print("")
    print("Note: This is a simplified version for testing.")
    print("For production with live audio translation, you'll need")
    print("to install the full LiveKit agents framework.")
    print("")
    print("Service running on http://localhost:8080")
    print("Test endpoint: http://localhost:8080/health")
    print("=" * 60)
    
    app = create_app()
    web.run_app(app, host='0.0.0.0', port=8080)
