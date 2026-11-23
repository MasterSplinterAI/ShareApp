const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const db = require('../db/v2Database');
const { putOrgObject, streamOrgObject, objectKey } = require('./objectStorage');
const { mintRecordingPlaybackToken } = require('./notetakerPipeline');
const { computeCost } = require('./costConstants');
const { queueCostEvent } = require('./opsOutbox');
const { translateText } = require('./textTranslate');

function resolveBinary(envVar, linuxDefault, fallbackName) {
  if (process.env[envVar]) return process.env[envVar];
  if (linuxDefault && fs.existsSync(linuxDefault)) return linuxDefault;
  return fallbackName;
}

function extFromMime(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return 'webm';
}

async function readOrgObjectBuffer(orgId, relativePath) {
  const result = await streamOrgObject(orgId, relativePath);
  if (!result) return null;
  const readable = result.stream || result.Body || result;
  if (!readable) return null;
  if (Buffer.isBuffer(readable)) return readable;
  if (typeof readable.transformToByteArray === 'function') {
    return Buffer.from(await readable.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function probeDurationSeconds(filePath, ffprobeBin) {
  const bin = resolveBinary('FFPROBE_PATH', '/usr/bin/ffprobe', ffprobeBin || 'ffprobe');
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15_000 }
    );
    const val = Number.parseFloat(String(stdout || '').trim());
    return Number.isFinite(val) && val > 0 ? Math.round(val) : null;
  } catch {
    return null;
  }
}

async function transcodeAudioBufferToMp3({
  buffer,
  mimeType = 'audio/webm',
  durationSeconds = null,
  ffmpegBin,
  ffprobeBin,
} = {}) {
  if (!buffer || !buffer.length) {
    throw new Error('Recording audio buffer is empty');
  }
  const bin = ffmpegBin || resolveBinary('FFMPEG_PATH', '/usr/bin/ffmpeg', 'ffmpeg');
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lalia-mp3-'));
  const ext = extFromMime(mimeType);
  const inputPath = path.join(tmpDir, `input.${ext}`);
  const outputPath = path.join(tmpDir, 'recording.mp3');

  try {
    await fs.promises.writeFile(inputPath, buffer);
    await execFileAsync(
      bin,
      ['-y', '-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', '-ar', '24000', outputPath],
      { timeout: 180_000, maxBuffer: 1024 * 1024 }
    );
    const mp3Buffer = await fs.promises.readFile(outputPath);
    if (!mp3Buffer || !mp3Buffer.length) {
      throw new Error('FFmpeg produced an empty MP3 file');
    }
    const probed = await probeDurationSeconds(outputPath, ffprobeBin);
    const parsedClient = Number(durationSeconds);
    const finalDuration =
      probed || (Number.isFinite(parsedClient) && parsedClient > 0 ? Math.round(parsedClient) : null);
    return {
      mp3Buffer,
      durationSeconds: finalDuration,
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getXaiApiKey() {
  const key = process.env.XAI_API_KEY || process.env.TRANSLATION_API_KEY || '';
  return String(key).trim();
}

async function transcribeAudioWithXaiBatch({
  mp3Buffer,
  languageHint = null,
  fetchImpl = global.fetch,
} = {}) {
  const apiKey = getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI_API_KEY / TRANSLATION_API_KEY is not configured');
  }
  if (!mp3Buffer || !mp3Buffer.length) {
    throw new Error('MP3 audio buffer is empty');
  }

  const form = new FormData();
  form.append('model', process.env.XAI_STT_MODEL || 'grok-voice-transcribe-2.0');
  form.append('diarize', 'true');
  if (languageHint && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(languageHint).trim())) {
    form.append('language', String(languageHint).trim().split('-')[0].toLowerCase());
  }
  form.append('file', new Blob([mp3Buffer], { type: 'audio/mpeg' }), 'recording.mp3');

  const sttUrl = process.env.XAI_STT_URL || 'https://api.x.ai/v1/stt';
  const res = await fetchImpl(sttUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`xAI STT failed (${res.status}): ${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  return {
    text: String(data?.text || '').trim(),
    language: data?.language ? String(data.language).trim() : null,
    duration: Number.isFinite(Number(data?.duration)) ? Number(data.duration) : null,
    words: Array.isArray(data?.words) ? data.words : [],
  };
}

function formatSpeakerName(rawSpeaker, zeroIndexed = false) {
  if (rawSpeaker == null || rawSpeaker === '') return 'Speaker 1';
  const s = String(rawSpeaker).trim();
  const numMatch = s.match(/^(?:speaker[_\s-]*)?(\d+)$/i);
  if (numMatch) {
    const idx = Number.parseInt(numMatch[1], 10);
    return `Speaker ${zeroIndexed ? idx + 1 : Math.max(1, idx)}`;
  }
  return s.slice(0, 100);
}

function joinTokens(tokens) {
  let out = '';
  for (const raw of tokens) {
    const tok = String(raw || '').trim();
    if (!tok) continue;
    if (!out) {
      out = tok;
    } else if (/^[,.;:!?%)\]]/.test(tok)) {
      out += tok;
    } else {
      out += ` ${tok}`;
    }
  }
  return out.trim();
}

function groupDiarizedWordsToLines(sttResult, { baseRecordedAtIso } = {}) {
  const baseMs = baseRecordedAtIso ? Date.parse(baseRecordedAtIso) : Date.now();
  const originMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  const words = Array.isArray(sttResult?.words) ? sttResult.words : [];
  const defaultLang = sttResult?.language ? String(sttResult.language).slice(0, 32) : null;
  const hasZeroSpeaker = words.some((w) => {
    const raw = w?.speaker ?? w?.speaker_id;
    const m = raw != null ? String(raw).trim().match(/^(?:speaker[_\s-]*)?(\d+)$/i) : null;
    return Boolean(m && Number.parseInt(m[1], 10) === 0);
  });

  if (!words.length) {
    const rawText = String(sttResult?.text || '').trim();
    if (!rawText) return [];
    const sentences = rawText.split(/(?<=[.!?])\s+/).filter(Boolean);
    const chunks = [];
    let buf = '';
    for (const sent of sentences) {
      if (buf && buf.length + sent.length + 1 > 420) {
        chunks.push(buf.trim());
        buf = sent;
      } else {
        buf = buf ? `${buf} ${sent}` : sent;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks.map((text, idx) => ({
      speaker: 'Speaker 1',
      text,
      language: defaultLang,
      recorded_at: new Date(originMs + idx * 1000).toISOString(),
    }));
  }

  const lines = [];
  let curSpeaker = null;
  let curTokens = [];
  let curStartSec = 0;
  let lastEndSec = 0;

  const flush = () => {
    const text = joinTokens(curTokens);
    if (!text) return;
    lines.push({
      speaker: curSpeaker || 'Speaker 1',
      text,
      language: defaultLang,
      recorded_at: new Date(originMs + Math.max(0, Math.round(curStartSec * 1000))).toISOString(),
    });
    curTokens = [];
  };

  for (const w of words) {
    const token = String(w?.word ?? w?.text ?? '').trim();
    if (!token) continue;
    const speaker = formatSpeakerName(w?.speaker ?? w?.speaker_id, hasZeroSpeaker);
    const startSec = Number(w?.start ?? w?.start_time ?? lastEndSec) || 0;
    const endSec = Number(w?.end ?? w?.end_time ?? startSec) || startSec;
    const currentLen = curTokens.reduce((acc, t) => acc + t.length + 1, 0);

    const speakerChanged = curSpeaker !== null && speaker !== curSpeaker;
    const longPause = curTokens.length > 0 && startSec - lastEndSec > 1.6;
    const tooLong = curTokens.length > 0 && currentLen + token.length > 420;

    if (speakerChanged || longPause || tooLong) {
      flush();
      curStartSec = startSec;
    } else if (curTokens.length === 0) {
      curStartSec = startSec;
    }

    curSpeaker = speaker;
    curTokens.push(token);
    lastEndSec = Math.max(lastEndSec, endSec);
  }
  flush();
  return lines;
}

function parseJsonObjectSafe(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function alignAndCleanExistingLinesWithLlm({
  existingLines,
  sttText,
  meetingTitle = '',
  fetchImpl = global.fetch,
} = {}) {
  const apiKey = String(process.env.TRANSLATION_API_KEY || process.env.XAI_API_KEY || '').trim();
  if (!apiKey || !sttText || !Array.isArray(existingLines) || !existingLines.length) {
    return [];
  }

  const chatUrl = process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = process.env.TRANSLATION_MODEL || 'grok-4.20-non-reasoning';
  const BATCH_SIZE = 75;
  const allUpdates = [];

  for (let offset = 0; offset < existingLines.length; offset += BATCH_SIZE) {
    const slice = existingLines.slice(offset, offset + BATCH_SIZE);
    const payloadLines = slice.map((l, idx) => ({
      index: offset + idx,
      speaker: l.participant_identity || 'Participant',
      text: l.original_text,
    }));

    const messages = [
      {
        role: 'system',
        content: [
          'You clean up live speech-to-text meeting transcript lines by cross-referencing a higher-accuracy post-call MP3 transcript.',
          'Rules:',
          '- Preserve every line index and speaker attribution.',
          '- Fix misheard words, names, technical terms, punctuation, and capitalization only where the MP3 transcript clearly resolves an error.',
          '- Keep original language of each line; do NOT translate or invent new content.',
          '- Only include lines in "updates" whose text actually improved.',
          '- Respond strictly with JSON: {"updates":[{"index":0,"text":"corrected text"}]}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          meetingTitle: meetingTitle || 'Lalia Meeting',
          mp3Transcript: String(sttText).slice(0, 60_000),
          liveLines: payloadLines,
        }),
      },
    ];

    const res = await fetchImpl(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Transcript cleanup LLM failed (${res.status}): ${errBody.slice(0, 200)}`);
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObjectSafe(content);
    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
    for (const u of updates) {
      const idx = Number(u?.index);
      const nextText = typeof u?.text === 'string' ? u.text.trim() : '';
      if (!Number.isInteger(idx) || idx < 0 || idx >= existingLines.length || !nextText) continue;
      allUpdates.push({ index: idx, text: nextText.slice(0, 20000) });
    }
  }

  return allUpdates;
}

async function recordXaiSttCostEvent({ orgId, meetingId, durationSeconds, meta = {} }) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
  try {
    const units = Math.max(0.05, Number((durationSeconds / 60).toFixed(4)));
    const costInfo = computeCost('xai_stt_minute', units);
    const ts = Date.now();
    await db.transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO meeting_cost_events (meeting_id, org_id, event_type, provider, units, unit_cost_usd, total_cost_usd, ts, meta_json)
         VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
        [
          meetingId,
          orgId || null,
          'xai_stt_minute',
          costInfo.provider,
          units,
          costInfo.unit_cost_usd,
          costInfo.total_cost_usd,
          ts,
          JSON.stringify(meta),
        ]
      );
      if (inserted?.lastID) {
        await queueCostEvent(tx, {
          id: inserted.lastID,
          meeting_id: meetingId,
          event_type: 'xai_stt_minute',
          provider: costInfo.provider,
          total_cost_usd: costInfo.total_cost_usd,
          ts,
        });
      }
    });
  } catch (err) {
    console.warn('[nativeRoomRecording] xai_stt cost log skipped:', err.message);
  }
}

async function refineMeetingTranscriptFromAudio({
  meetingId,
  orgId,
  recordingId = null,
  sttOverride = null,
  alignOverride = null,
  fetchImpl = global.fetch,
} = {}) {
  const meeting = await db.get(
    `SELECT m.id, m.org_id, m.title, m.started_at, COALESCE(p.store_transcripts, 1) AS store_transcripts
     FROM v2_meetings m
     LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
     WHERE m.id = ?`,
    [meetingId]
  );
  if (!meeting) {
    return { ok: false, status: 404, error: 'Meeting not found' };
  }
  if (Number(meeting.store_transcripts) === 0) {
    return { ok: true, mode: 'skipped', skipped: 'transcripts_disabled', updatedCount: 0, insertedCount: 0 };
  }

  const rec = recordingId
    ? await db.get(
        `SELECT * FROM v2_meeting_recordings WHERE id = ? AND meeting_id = ?`,
        [recordingId, meetingId]
      )
    : await db.get(
        `SELECT * FROM v2_meeting_recordings WHERE meeting_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
        [meetingId]
      );

  if (!rec) {
    return { ok: false, status: 404, error: 'No recording saved for this meeting' };
  }

  const targetOrgId = orgId || rec.org_id || meeting.org_id;
  const audioBuffer = await readOrgObjectBuffer(targetOrgId, rec.relative_path);
  if (!audioBuffer || !audioBuffer.length) {
    return { ok: false, status: 404, error: 'Recording file is missing from storage' };
  }

  const sttResult = sttOverride
    ? await sttOverride({ mp3Buffer: audioBuffer, recording: rec, meeting })
    : await transcribeAudioWithXaiBatch({ mp3Buffer: audioBuffer, fetchImpl });

  const billableDuration = sttResult?.duration || rec.duration_seconds || 0;
  await recordXaiSttCostEvent({
    orgId: targetOrgId,
    meetingId,
    durationSeconds: billableDuration,
    meta: { recordingId: rec.id, source: 'native_room_mp3_stt' },
  });

  const existingLines = await db.all(
    `SELECT id, recorded_at, participant_identity, language, source_language, original_text, translated_text, transcription_id
     FROM v2_meeting_transcript_lines
     WHERE meeting_id = ?
     ORDER BY datetime(recorded_at) ASC`,
    [meetingId]
  );

  if (!sttResult?.text && (!sttResult?.words || !sttResult.words.length)) {
    return {
      ok: true,
      mode: existingLines.length ? 'cleaned' : 'populated',
      updatedCount: 0,
      insertedCount: 0,
      totalLines: existingLines.length,
      durationSeconds: sttResult?.duration || rec.duration_seconds || null,
    };
  }

  if (existingLines.length > 0) {
    const updates = alignOverride
      ? await alignOverride({ existingLines, sttResult, meeting })
      : await alignAndCleanExistingLinesWithLlm({
          existingLines,
          sttText: sttResult.text,
          meetingTitle: meeting.title,
          fetchImpl,
        });

    let updatedCount = 0;
    for (const u of updates) {
      const target = existingLines[u.index];
      if (!target || u.text === target.original_text) continue;
      let nextTranslated = target.translated_text;
      if (
        target.translated_text &&
        target.language &&
        target.source_language &&
        target.language !== target.source_language
      ) {
        nextTranslated = await translateText(u.text, target.source_language, target.language);
      }
      await db.run(
        `UPDATE v2_meeting_transcript_lines SET original_text = ?, translated_text = ? WHERE id = ?`,
        [u.text, nextTranslated || null, target.id]
      );
      updatedCount += 1;
    }

    return {
      ok: true,
      mode: 'cleaned',
      updatedCount,
      insertedCount: 0,
      totalLines: existingLines.length,
      durationSeconds: sttResult?.duration || rec.duration_seconds || null,
    };
  }

  const generated = groupDiarizedWordsToLines(sttResult, {
    baseRecordedAtIso: meeting.started_at || rec.created_at,
  });

  let insertedCount = 0;
  for (let i = 0; i < generated.length; i += 1) {
    const line = generated[i];
    const tid = `xai-stt-${rec.id}-${i}`;
    const lang = line.language || 'en';
    const dedupe = crypto
      .createHash('sha256')
      .update(`${meetingId}|${tid}|${lang}|${line.text}`)
      .digest('hex')
      .slice(0, 40);

    const res = await db.run(
      `INSERT OR IGNORE INTO v2_meeting_transcript_lines
       (id, meeting_id, recorded_at, participant_identity, language, source_language, original_text, translated_text, transcription_id, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        db.uuid(),
        meetingId,
        line.recorded_at,
        String(line.speaker || 'Speaker 1').slice(0, 200),
        lang,
        lang,
        String(line.text).slice(0, 20000),
        null,
        tid,
        dedupe,
      ]
    );
    if (res?.changes) insertedCount += 1;
  }

  return {
    ok: true,
    mode: 'populated',
    updatedCount: 0,
    insertedCount,
    totalLines: insertedCount,
    durationSeconds: sttResult?.duration || rec.duration_seconds || null,
  };
}

function buildRecordingPlaybackPayload({ recordingId, meetingId, orgId, sizeBytes, durationSeconds, createdAt }) {
  const rt = mintRecordingPlaybackToken({
    meetingId,
    orgId,
    recordingId,
  });
  const streamPath = `/api/v2/meetings/${encodeURIComponent(meetingId)}/recording/stream?rt=${encodeURIComponent(rt)}`;
  return {
    id: recordingId,
    org_id: orgId,
    meeting_id: meetingId,
    mime_type: 'audio/mpeg',
    size_bytes: Number(sizeBytes || 0),
    duration_seconds: durationSeconds ?? null,
    created_at: createdAt,
    streamUrl: streamPath,
    downloadUrl: `${streamPath}&download=1`,
  };
}

async function saveNativeMeetingRecording({
  meetingId,
  orgId,
  buffer,
  mimeType = 'audio/webm',
  durationSeconds = null,
  autoRefine = true,
  transcodeOverride = null,
  sttOverride = null,
  alignOverride = null,
  fetchImpl = global.fetch,
} = {}) {
  if (!meetingId || !orgId) {
    throw new Error('meetingId and orgId are required');
  }
  const transcoded = transcodeOverride
    ? await transcodeOverride({ buffer, mimeType, durationSeconds })
    : await module.exports.transcodeAudioBufferToMp3({ buffer, mimeType, durationSeconds });

  const recordingId = db.uuid();
  const relativePath = `recordings/${meetingId}/${recordingId}.mp3`;
  const storageKey = objectKey(orgId, relativePath);
  const createdAt = new Date().toISOString();

  await putOrgObject(orgId, relativePath, transcoded.mp3Buffer, {
    contentType: 'audio/mpeg',
  });

  await db.run(
    `INSERT INTO v2_meeting_recordings
     (id, org_id, meeting_id, bot_session_id, storage_key, relative_path, mime_type, size_bytes, duration_seconds, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      recordingId,
      orgId,
      meetingId,
      null,
      storageKey,
      relativePath,
      'audio/mpeg',
      transcoded.mp3Buffer.length,
      transcoded.durationSeconds || null,
      createdAt,
    ]
  );

  const recording = buildRecordingPlaybackPayload({
    recordingId,
    meetingId,
    orgId,
    sizeBytes: transcoded.mp3Buffer.length,
    durationSeconds: transcoded.durationSeconds || null,
    createdAt,
  });

  let transcriptRefinement = null;
  if (autoRefine) {
    try {
      transcriptRefinement = await refineMeetingTranscriptFromAudio({
        meetingId,
        orgId,
        recordingId,
        sttOverride,
        alignOverride,
        fetchImpl,
      });
    } catch (err) {
      console.warn('[saveNativeMeetingRecording] post-call STT cleanup failed:', err.message);
      transcriptRefinement = { ok: false, error: err.message };
    }
  }

  return { recording, transcriptRefinement };
}

module.exports = {
  readOrgObjectBuffer,
  transcodeAudioBufferToMp3,
  transcribeAudioWithXaiBatch,
  groupDiarizedWordsToLines,
  alignAndCleanExistingLinesWithLlm,
  refineMeetingTranscriptFromAudio,
  saveNativeMeetingRecording,
  buildRecordingPlaybackPayload,
};
