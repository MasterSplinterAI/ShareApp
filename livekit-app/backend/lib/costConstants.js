/**
 * Cost rates for all inference and infrastructure providers.
 * Single source of truth — used by costEvents route and rollup logic.
 */

const COSTS = {
  // LiveKit infrastructure
  livekit_agent_minute:        { provider: 'livekit',   unit_cost_usd: 0.0100  },
  livekit_participant_minute:  { provider: 'livekit',   unit_cost_usd: 0.0040  },
  livekit_bandwidth_gb:        { provider: 'livekit',   unit_cost_usd: 0.1200  },

  // xAI Grok STT (grok-stt)
  xai_stt_minute:              { provider: 'xai',       unit_cost_usd: 0.00333 },

  // xAI Grok 4.20 LLM
  xai_llm_input_mtok:          { provider: 'xai',       unit_cost_usd: 1.25    },
  xai_llm_output_mtok:         { provider: 'xai',       unit_cost_usd: 2.50    },

  // OpenAI gpt-4o-mini
  openai_llm_input_mtok:       { provider: 'openai',    unit_cost_usd: 0.15    },
  openai_llm_output_mtok:      { provider: 'openai',    unit_cost_usd: 0.60    },

  // Deepgram Nova-3
  deepgram_stt_minute:         { provider: 'deepgram',  unit_cost_usd: 0.0043  },
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
