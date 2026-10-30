const { formatUserContextForPrompt, buildUserContextSnapshot } = require('../supportUserContext');
const { formatUserFacingReply } = require('../supportReplyFormat');
const { aiEnabled, callSupportLlm } = require('./llm');

const COACH_SYSTEM = `You help users refine Lalia feature requests before formal submission.
Output ONLY valid JSON:
{
  "reply": "friendly chat message to the user (1-3 short paragraphs max)",
  "ready_to_submit": false,
  "draft": {
    "problem": "clear problem statement",
    "solution": "proposed solution or empty string",
    "priority": "nice_to_have|important|critical",
    "subject": "short title"
  }
}

Ask clarifying questions: who is affected, current workaround, expected outcome, priority.
Set ready_to_submit true only when problem is specific enough for engineering review.
Keep draft fields updated as the conversation progresses.`;

function formatCoachThread(messages) {
  return (messages || [])
    .map((m) => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.body}`)
    .join('\n\n');
}

async function coachFeatureRequest(messages, { userContext: auth } = {}) {
  let userBlock = '';
  if (auth?.userId) {
    const snapshot = await buildUserContextSnapshot({
      userId: auth.userId,
      orgId: auth.orgId,
      email: auth.email,
    });
    userBlock = `\n\n${formatUserContextForPrompt(snapshot)}`;
  }

  if (!aiEnabled()) {
    return {
      ok: false,
      error: 'AI coach unavailable',
      reply:
        'Describe the problem you want solved and any ideas you have — when you are ready, tap Submit feature request.',
      readyToSubmit: (messages || []).filter((m) => m.role === 'user').length >= 1,
      draft: {
        problem: messages?.filter((m) => m.role === 'user').map((m) => m.body).join('\n') || '',
        solution: '',
        priority: 'nice_to_have',
        subject: '',
      },
    };
  }

  const parsed = await callSupportLlm(
    COACH_SYSTEM + userBlock,
    `Conversation so far:\n${formatCoachThread(messages)}\n\nRespond as JSON.`
  );

  const draft = parsed.draft && typeof parsed.draft === 'object' ? parsed.draft : {};
  return {
    ok: true,
    reply: formatUserFacingReply(String(parsed.reply || 'Tell me more about the problem you want to solve.').slice(0, 4000)),
    readyToSubmit: Boolean(parsed.ready_to_submit),
    draft: {
      problem: String(draft.problem || '').slice(0, 4000),
      solution: String(draft.solution || '').slice(0, 4000),
      priority: ['nice_to_have', 'important', 'critical'].includes(draft.priority)
        ? draft.priority
        : 'nice_to_have',
      subject: String(draft.subject || draft.problem || '').slice(0, 200),
    },
  };
}

module.exports = {
  coachFeatureRequest,
};
