const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeCost, COSTS } = require('../lib/costConstants');
const { computeParticipantMinutes } = require('../routes/webhooks');

const SESSION_MINIMUM_MINUTES = 10 / 60;

describe('invoice unit rates', () => {
  it('prices a WebRTC participant minute at the Ship overage rate', () => {
    assert.equal(COSTS.livekit_participant_minute.unit_cost_usd, 0.0005);
    assert.equal(computeCost('livekit_participant_minute', 2).total_cost_usd, 0.001);
  });

  it('prices a LiveKit Cloud agent session minute at $0.01', () => {
    assert.equal(computeCost('livekit_agent_minute', 1).total_cost_usd, 0.01);
  });

  it('prices Nova-3 multilingual streaming plus keyterm prompting', () => {
    assert.equal(COSTS.deepgram_stt_minute.unit_cost_usd, 0.0105);
    assert.equal(computeCost('deepgram_stt_minute', 1).total_cost_usd, 0.0105);
  });

  it('prices Aura-2 at $0.030 per 1,000 characters', () => {
    const cost = computeCost('deepgram_tts_char', 1000);
    assert.ok(Math.abs(cost.total_cost_usd - 0.03) < 1e-9);
  });
});

describe('computeParticipantMinutes invoice pricing', () => {
  const t0 = 1_700_000_000_000;

  it('bills a human at $0.0005 per minute', () => {
    const { byParticipant } = computeParticipantMinutes(
      [{ participant_identity: 'host', ts: t0 }],
      [{ participant_identity: 'host', ts: t0 + 120_000 }],
      t0 + 120_000,
      () => false
    );
    assert.equal(byParticipant.host.minutes, 2);
    assert.equal(byParticipant.host.cost, 0.001);
  });

  it('rounds a short human connection up to 10 seconds', () => {
    const { byParticipant } = computeParticipantMinutes(
      [{ participant_identity: 'host', ts: t0 }],
      [{ participant_identity: 'host', ts: t0 + 3_000 }],
      t0 + 3_000,
      () => false
    );
    assert.equal(byParticipant.host.minutes, SESSION_MINIMUM_MINUTES);
    assert.ok(Math.abs(byParticipant.host.cost - SESSION_MINIMUM_MINUTES * 0.0005) < 1e-12);
  });

  it('bills a cloud agent at $0.01 per session minute', () => {
    const { byParticipant } = computeParticipantMinutes(
      [{ participant_identity: 'agent-AJ_123', ts: t0 }],
      [{ participant_identity: 'agent-AJ_123', ts: t0 + 60_000 }],
      t0 + 60_000,
      () => false
    );
    assert.equal(byParticipant['agent-AJ_123'].minutes, 1);
    assert.equal(byParticipant['agent-AJ_123'].cost, 0.01);
  });

  it('applies the 10-second minimum to a short agent session', () => {
    const { byParticipant } = computeParticipantMinutes(
      [{ participant_identity: 'agent-AJ_123', ts: t0 }],
      [{ participant_identity: 'agent-AJ_123', ts: t0 + 2_000 }],
      t0 + 2_000,
      () => false
    );
    assert.equal(byParticipant['agent-AJ_123'].minutes, SESSION_MINIMUM_MINUTES);
    assert.ok(Math.abs(byParticipant['agent-AJ_123'].cost - SESSION_MINIMUM_MINUTES * 0.01) < 1e-12);
  });
});
