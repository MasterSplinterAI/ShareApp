import { useCallback, useEffect, useState } from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';
import { v2Auth } from '../services/apiV2';

const TTS_PROVIDERS = [
  { id: 'auto', label: 'Auto' },
  { id: 'xai', label: 'xAI Grok ($15/1M)' },
  { id: 'deepgram', label: 'Deepgram Aura-2 ($30/1M)' },
  { id: 'openai', label: 'OpenAI gpt-4o-mini-tts ($15/1M)' },
  { id: 'elevenlabs', label: 'ElevenLabs Flash ($50/1M)' },
];

const STT_PROVIDERS = [
  { id: 'auto', label: 'Auto (env default)' },
  { id: 'deepgram', label: 'Deepgram Nova-3 ($0.0105/m)' },
  { id: 'xai', label: 'xAI Grok STT ($0.0033/m)' },
  { id: 'gladia', label: 'Gladia ($0.0125/m)' },
  { id: 'openai', label: 'OpenAI gpt-4o-transcribe ($0.006/m)' },
];

const XAI_VOICES = [
  'eve',
  'rex',
  'ara',
  'leo',
  'luna',
  'orion',
  'iris',
  'sal',
  'carina',
  'celeste',
  'atlas',
  'aurora',
  'liora',
];
const SHARED_TEXT_DECODER = new TextDecoder();
const TRANSCRIPTION_PROVIDER_SAMPLE_MS = 2500;

function isTtsAdminAccount(me) {
  return Boolean(me && me.isSuperadmin);
}

/**
 * In-room TTS provider switch for platform superadmins when ?debug=1 is set.
 * The agent applies the choice on the next spoken utterance and confirms it
 * with a provider_status packet.
 */
export default function AdminTtsProviderSwitch() {
  const room = useRoomContext();
  const local = useLocalParticipant();
  const showDebug =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('xai');
  const [sttProvider, setSttProvider] = useState('xai');
  const [voice, setVoice] = useState('eve');
  const [activeTts, setActiveTts] = useState('');
  const [activeStt, setActiveStt] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!showDebug || !localStorage.getItem('v2_token')) return undefined;
    let cancelled = false;
    v2Auth
      .me({ skipSessionRedirect: true })
      .then((me) => {
        if (!cancelled) setAllowed(isTtsAdminAccount(me));
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showDebug]);

  useEffect(() => {
    if (!room || !showDebug || !allowed) return undefined;
    let lastTranscriptionSampleAt = 0;
    const onData = (payload, _participant, _kind, topic) => {
      if (topic && topic !== 'tts_config' && topic !== 'transcription') return;
      if (topic === 'transcription') {
        const now = Date.now();
        if (now - lastTranscriptionSampleAt < TRANSCRIPTION_PROVIDER_SAMPLE_MS) return;
        lastTranscriptionSampleAt = now;
      }
      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;
        const msg = JSON.parse(SHARED_TEXT_DECODER.decode(raw));
        if (msg?.type === 'provider_status' || msg?.type === 'tts_provider_status') {
          const tts = msg.activeTtsProvider || msg.activeProvider;
          if (tts) setActiveTts((prev) => (prev === String(tts) ? prev : String(tts)));
          if (msg.ttsProvider) setProvider(String(msg.ttsProvider));
          const stt = msg.activeSttProvider || msg.sttProvider;
          if (stt) setActiveStt((prev) => (prev === String(stt) ? prev : String(stt)));
          if (msg.sttProvider) setSttProvider(String(msg.sttProvider));
          if (msg.voiceId && XAI_VOICES.includes(String(msg.voiceId).toLowerCase())) {
            setVoice(String(msg.voiceId).toLowerCase());
          }
          return;
        }
        if (msg?.type === 'transcription' && msg.sttProvider) {
          const nextStt = String(msg.sttProvider);
          setActiveStt((prev) => (prev === nextStt ? prev : nextStt));
        }
      } catch {
        /* non-JSON room traffic */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => room.off(RoomEvent.DataReceived, onData);
  }, [room, allowed]);

  const publish = useCallback(
    async ({ tts, stt, voice: nextVoice }) => {
      const lp = local?.localParticipant;
      if (!room || !lp || room.state !== 'connected') return;
      setSending(true);
      try {
        const body = { type: 'tts_config' };
        if (tts) {
          body.ttsProvider = tts;
          body.tts_provider = tts;
          if (tts === 'xai') body.voiceId = nextVoice;
        }
        if (stt) {
          body.sttProvider = stt;
          body.stt_provider = stt;
        }
        const encoded = new TextEncoder().encode(JSON.stringify(body));
        await lp.publishData(encoded, DataPacket_Kind.RELIABLE, { topic: 'tts_config' });
      } catch (err) {
        console.error('Provider switch failed', err);
      } finally {
        setSending(false);
      }
    },
    [local, room]
  );

  if (!showDebug || !allowed) return null;

  return (
    <div className="absolute left-3 top-3 z-20 max-w-[18rem] text-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-white/15 bg-slate-950/85 px-3 py-1 text-[11px] font-medium shadow-lg backdrop-blur-md"
      >
        STT {activeStt || '…'} · TTS {activeTts || '…'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-slate-950/95 p-3 text-xs shadow-xl backdrop-blur-md">
          <label className="block space-y-1">
            <span className="text-white/70">STT provider</span>
            <select
              aria-label="STT provider"
              className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-white"
              value={sttProvider}
              disabled={sending}
              onChange={(event) => {
                const next = event.target.value;
                setSttProvider(next);
                publish({ stt: next, tts: provider, voice });
              }}
            >
              {STT_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-white/70">TTS provider</span>
            <select
              aria-label="TTS provider"
              className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-white"
              value={provider}
              disabled={sending}
              onChange={(event) => {
                const next = event.target.value;
                setProvider(next);
                publish({ tts: next, stt: sttProvider, voice });
              }}
            >
              {TTS_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {provider === 'xai' && (
            <label className="block space-y-1">
              <span className="text-white/70">xAI voice</span>
              <select
                aria-label="xAI voice"
                className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-white"
                value={voice}
                disabled={sending}
                onChange={(event) => {
                  const next = event.target.value;
                  setVoice(next);
                  publish({ tts: 'xai', stt: sttProvider, voice: next });
                }}
              >
                {XAI_VOICES.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-[11px] text-white/60">
            {activeStt || activeTts
              ? `Live STT ${activeStt || '…'} · TTS ${activeTts || '…'}`
              : 'STT restarts the caption pipelines. TTS applies on the next spoken line.'}
          </p>
        </div>
      )}
    </div>
  );
}
