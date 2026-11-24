#!/usr/bin/env python3
"""Isolated Lalia canary RTC smoke. Parent must dispatch the canary agent first.

Prepare only (offline):
  python scripts/verify_rtc_smoke.py --room lalia-canary-PREP --prepare-only
Explicit live run (not performed by preparation):
  python scripts/verify_rtc_smoke.py --room lalia-canary-UNIQUE

Uses macOS say, never a physical microphone. No audio/token files are retained.
Requires livekit==1.2.0, LiveKit CLI 2.19.4 or newer, and installed macOS say voices.
Checks transport/content presence, not linguistic accuracy. Supply --lk for a specific CLI binary.
"""
import argparse
import asyncio
import json
import logging
import math
import re
import subprocess
import sys
import tempfile
import time
import wave
from array import array
from pathlib import Path

from livekit import rtc

RATE = 24000
FRAME_SAMPLES = 480
PHRASES = {
    'en': ('Samantha (English (US))', 'Hello. This is a synthetic test of translated meetings. The meeting starts tomorrow at ten in the morning. Please bring the blue notebook. Thank you.'),
    'es': ('Paulina', 'Hola. Esta es una prueba sintética de reuniones traducidas. La reunión empieza mañana a las diez de la mañana. Por favor, trae el cuaderno azul. Muchas gracias.'),
}


class SmokeError(Exception):
    pass


def report(event, **fields):
    print(json.dumps({'event': event, **fields}, sort_keys=True), flush=True)


def synthesize(directory):
    clips = {}
    for language, (voice, text) in PHRASES.items():
        path = Path(directory) / f'{language}.wav'
        result = subprocess.run(['say', '-v', voice, '-r', '145', '-o', str(path), '--file-format=WAVE',
                                 f'--data-format=LEI16@{RATE}', text], capture_output=True, timeout=30)
        if result.returncode:
            raise SmokeError(f'Offline speech synthesis failed for {language}; verify installed macOS voice and permissions')
        with wave.open(str(path), 'rb') as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, RATE):
                raise SmokeError(f'Unexpected synthetic PCM format for {language}')
            clips[language] = audio.readframes(audio.getnframes())
        if len(clips[language]) < RATE * 2:
            raise SmokeError(f'Synthetic speech for {language} is empty or too short')
    return clips


async def token_for(args, identity, language):
    metadata = json.dumps({'displayName': f'Synthetic {language.upper()} Canary', 'role': 'guest'})
    process = await asyncio.create_subprocess_exec(
        args.lk, '--subdomain', args.subdomain, 'token', 'create', '--join', '--room', args.room,
        '--identity', identity, '--name', f'Synthetic {language.upper()} Canary', '--valid-for', '5m',
        '--allow-source', 'microphone', '--metadata', metadata, '--token-only',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=20)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise SmokeError('Token creation timed out; verify local CLI configuration') from None
    if process.returncode:
        raise SmokeError('Token creation failed; verify configured CLI project access')
    token = stdout.decode().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
        raise SmokeError('CLI did not return a token-only JWT; no output was disclosed')
    return token


class Participant:
    def __init__(self, language, identity, allowed_identities):
        self.language = language
        self.identity = identity
        self.allowed_identities = allowed_identities
        self.room = rtc.Room()
        self.source = None
        self.track = None
        self.ready = asyncio.Event()
        self.captions = []
        self.tts_audio_samples = 0
        self.tts_events = set()
        self.streams = []
        self.tasks = set()
        self.failure = None
        self.room.on('data_received', self.on_data)
        self.room.on('track_subscribed', self.on_track)
        self.room.on('participant_connected', self.check_participant)

    def check_participant(self, participant):
        if participant.identity not in self.allowed_identities and participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            self.failure = 'Unexpected non-agent participant in canary room; refusing to publish synthetic speech'

    def on_data(self, packet):
        if not packet.participant or packet.participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return
        try:
            data = json.loads(packet.data)
        except (ValueError, UnicodeDecodeError):
            return
        if data.get('type') == 'agent_ready':
            self.ready.set()
        if packet.topic == 'transcription':
            if data.get('type') == 'transcription' and data.get('participant_id') in self.allowed_identities:
                self.captions.append(data)
            if data.get('language') == self.language and data.get('type') in ('tts_start', 'tts_end', 'tts_error'):
                self.tts_events.add(data['type'])

    def on_track(self, track, publication, participant):
        self.check_participant(participant)
        # Count only the agent's translated output lane, never the other test mic.
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT or publication.name != f'tts-{self.language}':
            return
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        self.streams.append(stream)

        async def consume():
            async for event in stream:
                samples = array('h', event.frame.data)
                rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))
                if rms > 30:
                    self.tts_audio_samples += len(samples)
        task = asyncio.create_task(consume())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def connect(self, args):
        token = await token_for(args, self.identity, self.language)
        await asyncio.wait_for(self.room.connect(args.url, token), timeout=25)
        del token
        for participant in self.room.remote_participants.values():
            self.check_participant(participant)
        self.source = rtc.AudioSource(RATE, 1)
        self.track = rtc.LocalAudioTrack.create_audio_track(f'synthetic-mic-{self.language}', self.source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self.room.local_participant.publish_track(self.track, options)

    async def preferences(self):
        payload = {'type': 'language_update', 'language': self.language, 'readLanguage': self.language,
                   'enabled': True, 'voiceEnabled': True}
        await self.room.local_participant.publish_data(json.dumps(payload), reliable=True, topic='language_preference')

    async def publish(self, pcm):
        # Pace 20ms mono int16 frames in real time and include silence for endpointing.
        pcm = bytes(RATE * 2) + pcm + bytes(RATE * 2 * 3)
        start = time.monotonic()
        for offset in range(0, len(pcm), FRAME_SAMPLES * 2):
            if self.failure:
                raise SmokeError(self.failure)
            frame = pcm[offset:offset + FRAME_SAMPLES * 2].ljust(FRAME_SAMPLES * 2, b'\0')
            await self.source.capture_frame(rtc.AudioFrame(frame, RATE, 1, FRAME_SAMPLES))
            await asyncio.sleep(max(0, start + (offset // 2 + FRAME_SAMPLES) / RATE - time.monotonic()))
        await self.source.wait_for_playout()

    def translated_final_from(self, speaker):
        return any(packet.get('participant_id') == speaker.identity
                   and packet.get('language', '').split('-')[0] == self.language
                   and packet.get('final') is True and packet.get('hasTranslation') is True
                   and str(packet.get('originalText', '')).strip()
                   and str(packet.get('text', '')).strip()
                   and str(packet.get('text', '')).casefold().strip() != str(packet.get('originalText', '')).casefold().strip()
                   for packet in self.captions)

    async def close(self):
        for task in tuple(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for stream in self.streams:
            await stream.aclose()
        if self.source:
            await self.source.aclose()
        await self.room.disconnect()


async def run(args, clips):
    suffix = str(time.time_ns())
    identities = {f'canary-synthetic-{lang}-{suffix}' for lang in PHRASES}
    participants = [Participant(lang, f'canary-synthetic-{lang}-{suffix}', identities) for lang in PHRASES]
    pulse = None
    try:
        for participant in participants:
            await participant.connect(args)
        report('connected', room=args.room, participants=2)

        async def send_preferences():
            while True:
                for participant in participants:
                    if participant.failure:
                        raise SmokeError(participant.failure)
                    await participant.preferences()
                await asyncio.sleep(2)
        pulse = asyncio.create_task(send_preferences())
        await asyncio.wait_for(asyncio.gather(*(p.ready.wait() for p in participants)), timeout=args.timeout)
        await asyncio.sleep(4)
        for speaker in participants:
            if pulse.done():
                await pulse
            for participant in participants:
                if participant.failure:
                    raise SmokeError(participant.failure)
            listener = next(p for p in participants if p is not speaker)
            await speaker.publish(clips[speaker.language])
            deadline = time.monotonic() + args.timeout
            while time.monotonic() < deadline:
                if pulse.done():
                    await pulse
                captions_ok = listener.translated_final_from(speaker)
                audio_ok = listener.tts_audio_samples >= RATE // 10
                if captions_ok and (audio_ok or args.captions_only):
                    break
                await asyncio.sleep(.25)
            else:
                raise SmokeError(f'{speaker.language}->{listener.language} failed: translated_final={captions_ok}, audible_tts={audio_ok}, tts_error={"tts_error" in listener.tts_events}')
            report('direction_pass', source=speaker.language, target=listener.language,
                   translated_final=True, tts_audio_ms=round(listener.tts_audio_samples * 1000 / RATE))
    finally:
        if pulse:
            pulse.cancel()
            await asyncio.gather(pulse, return_exceptions=True)
        results = await asyncio.gather(*(asyncio.wait_for(p.close(), timeout=10) for p in participants), return_exceptions=True)
        if any(isinstance(result, BaseException) for result in results):
            raise SmokeError('A disconnect/stream cleanup failed or exceeded its deadline')
    report('PASS', room=args.room, tts_required=not args.captions_only)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--room', required=True, help='Explicit isolated room name containing canary; never an existing customer room')
    parser.add_argument('--lk', default='lk')
    parser.add_argument('--subdomain', default='production-uiycx4ku')
    parser.add_argument('--url', default='wss://production-uiycx4ku.livekit.cloud')
    parser.add_argument('--timeout', type=int, default=45, help='Agent-ready / per-direction result deadline seconds (max 60)')
    parser.add_argument('--prepare-only', action='store_true', help='Generate/check speech locally; no CLI tokens or network connection')
    parser.add_argument('--captions-only', action='store_true', help='Explicitly skip audible TTS gate; output records that limitation')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', args.room) or 'canary' not in args.room.lower():
        parser.error('--room must be a safe explicit canary name containing canary')
    if not 1 <= args.timeout <= 60:
        parser.error('--timeout must be between 1 and 60 seconds')
    logging.disable(logging.CRITICAL)  # Keep SDK/network exceptions and tokens out of output.
    try:
        with tempfile.TemporaryDirectory(prefix='lalia-synthetic-smoke-') as directory:
            clips = synthesize(directory)
            report('synthetic_ready', durations_seconds={lang: round(len(pcm) / RATE / 2, 2) for lang, pcm in clips.items()})
            if args.prepare_only:
                report('PREPARED_ONLY', network_connections=0, tokens_created=0)
                return 0
            asyncio.run(run(args, clips))
        return 0
    except SmokeError as error:
        report('FAIL', reason=str(error))
    except (asyncio.TimeoutError, subprocess.TimeoutExpired):
        report('FAIL', reason='Timed out during canary setup or agent-ready wait')
    except KeyboardInterrupt:
        report('FAIL', reason='Interrupted; disconnect cleanup requested')
    except Exception as error:
        report('FAIL', reason=f'{type(error).__name__}; raw SDK/CLI error withheld to avoid credential disclosure')
    return 1


if __name__ == '__main__':
    sys.exit(main())
