const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { STT_PIPELINE_AGENTS, VALID_STT_PIPELINES } = require('../lib/livekitService');
const {
  computeParticipantMinutes,
  livekitMinuteRateUsd,
  isSelfHostedRoomEvents,
} = require('../routes/webhooks');

describe('selfhosted_xai agent routing and LiveKit billing rates', () => {
  it('registers selfhosted_xai -> translation-selfhosted-xai in STT_PIPELINE_AGENTS', () => {
    assert.equal(STT_PIPELINE_AGENTS.selfhosted_xai, 'translation-selfhosted-xai');
    assert.ok(VALID_STT_PIPELINES.includes('selfhosted_xai'));
  });

  it('prices LiveKit Cloud-hosted agents at $0.01/min and self-hosted agents at $0.0005/min', () => {
    assert.equal(livekitMinuteRateUsd('agent-AJ_123', { selfHostedAgent: false }), 0.01);
    assert.equal(livekitMinuteRateUsd('agent-AJ_123', { selfHostedAgent: true }), 0.0005);
    assert.equal(livekitMinuteRateUsd('agent-selfhosted-1'), 0.0005);
    assert.equal(livekitMinuteRateUsd('host-user-1', { selfHostedAgent: true }), 0.0005);
  });

  it('prices full-minute self-hosted agent sessions at WebRTC participant rate inside computeParticipantMinutes', () => {
    const t0 = 1_700_000_000_000;
    const { byParticipant } = computeParticipantMinutes(
      [{ participant_identity: 'agent-AJ_123', ts: t0 }],
      [{ participant_identity: 'agent-AJ_123', ts: t0 + 60_000 }],
      t0 + 60_000,
      () => false,
      { selfHostedAgent: true }
    );
    assert.equal(byParticipant['agent-AJ_123'].minutes, 1);
    assert.equal(byParticipant['agent-AJ_123'].cost, 0.0005);
  });

  it('detects self-hosted pipeline rooms from stored webhook metadata payloads', () => {
    assert.equal(
      isSelfHostedRoomEvents([
        {
          payload_json: JSON.stringify({
            event: 'room_finished',
            room: { metadata: JSON.stringify({ stt_pipeline: 'selfhosted_xai' }) },
          }),
        },
      ]),
      true
    );
    assert.equal(
      isSelfHostedRoomEvents([
        {
          payload_json: JSON.stringify({
            event: 'room_finished',
            room: { metadata: JSON.stringify({ stt_pipeline: 'deepgram_codeswitch' }) },
          }),
        },
      ]),
      false
    );
  });
});
