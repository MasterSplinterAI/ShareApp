/**
 * Invoice unit rates for cost rollups.
 *
 * These are pay-as-you-go and plan-overage rates. Minutes inside a vendor's
 * included allowance still cost that much on the rate card once the allowance
 * is used, so the ledger does not price them at $0. A later committed plan
 * (LiveKit Scale, Deepgram Growth) is a bit cheaper; the figures below are the
 * card we pay until that switch.
 *
 * Checked against livekit.com/pricing and deepgram.com/pricing on 9 Nov 2026.
 * LiveKit WebRTC sessions and agent sessions both have a 10-second minimum,
 * applied when the webhook rollup prices a connection.
 */

const COSTS = {
  // LiveKit Cloud Ship overage. Scale WebRTC is $0.0004/min; agent session stays $0.01.
  // WebRTC is per participant-minute. The $0.004 figure is third-party SIP, not WebRTC.
  livekit_agent_minute:        { provider: 'livekit',   unit_cost_usd: 0.0100  },
  livekit_participant_minute:  { provider: 'livekit',   unit_cost_usd: 0.0005  },
  // Downstream data after the included gigabytes. Scale is $0.10/GB. Unused until we meter bytes.
  livekit_bandwidth_gb:        { provider: 'livekit',   unit_cost_usd: 0.1200  },

  // xAI grok-voice-transcribe-2.0, $0.20 per audio hour
  xai_stt_minute:              { provider: 'xai',       unit_cost_usd: 0.003333 },

  // xAI Grok 4.20 LLM
  xai_llm_input_mtok:          { provider: 'xai',       unit_cost_usd: 1.25    },
  xai_llm_output_mtok:         { provider: 'xai',       unit_cost_usd: 2.50    },

  // OpenAI gpt-4.1-mini ($0.40 input / $1.60 output per 1M tokens)
  openai_llm_input_mtok:       { provider: 'openai',    unit_cost_usd: 0.40    },
  openai_llm_output_mtok:      { provider: 'openai',    unit_cost_usd: 1.60    },
  // OpenAI gpt-4o-transcribe (fallback STT), $0.006/min audio
  openai_stt_minute:           { provider: 'openai',    unit_cost_usd: 0.0060  },
  // OpenAI gpt-4o-mini-tts / tts-1 ($0.015/1k chars)
  openai_tts_char:             { provider: 'openai',    unit_cost_usd: 0.000015 },
  // xAI Grok TTS ($15 per 1M characters)
  xai_tts_char:                { provider: 'xai',       unit_cost_usd: 0.000015 },

  // Deepgram Nova-3 Multilingual streaming ($0.0092) plus Keyterm Prompting ($0.0013).
  // The agent streams nova-3 with language=multi and sends keyterms. $0.0043 is
  // pre-recorded Nova-3 monolingual, which is not this path. Growth is $0.0078 + $0.0012.
  // Billed per second of audio streamed, including silence on an open mic.
  deepgram_stt_minute:         { provider: 'deepgram',  unit_cost_usd: 0.0105  },
  // Deepgram Aura-2 TTS, $0.030 per 1,000 characters. Aura-1 is $0.015; production voices are Aura-2.
  // Growth is $0.027 per 1,000 characters.
  deepgram_tts_char:           { provider: 'deepgram',  unit_cost_usd: 0.000030 },
  // ElevenLabs Flash v2.5 TTS (per character, $0.05/1k chars API rate)
  elevenlabs_tts_char:         { provider: 'elevenlabs', unit_cost_usd: 0.00005 },
  gladia_stt_minute:           { provider: 'gladia',    unit_cost_usd: 0.0125 },
};

/**
 * @param {string} eventType - key from COSTS
 * @param {number} units - quantity (minutes, GB, Mtok, etc.)
 * @returns {{ provider: string, unit_cost_usd: number, total_cost_usd: number }}
 */
function computeCost(eventType, units) {
  const c = COSTS[eventType];
  if (!c) {
    throw new Error(`Unknown cost event type: ${eventType}`);
  }
  return {
    provider: c.provider,
    unit_cost_usd: c.unit_cost_usd,
    total_cost_usd: c.unit_cost_usd * units,
  };
}

module.exports = { COSTS, computeCost };
