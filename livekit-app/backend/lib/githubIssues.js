const axios = require('axios');
const { adminTicketUrl } = require('./telegramSupport');

function githubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

function parseRepo() {
  const raw = (process.env.GITHUB_REPO || '').trim();
  const m = raw.match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function buildIssueBody(ticket, proposal) {
  const body = proposal.body || {};
  const adminUrl = adminTicketUrl(ticket.publicNumber);
  const lines = [
    '## Support ticket',
    `- Ticket: #${ticket.publicNumber}`,
    `- Category: ${ticket.category}`,
    `- Admin: ${adminUrl}`,
  ];
  if (ticket.severity) lines.push(`- Severity: ${ticket.severity}`);
  if (ticket.priority) lines.push(`- Priority: ${ticket.priority}`);
  if (ticket.context?.plan) {
    lines.push(`- Org: ${ticket.context.plan.orgName || '—'} (${ticket.context.plan.planId || 'plan n/a'})`);
  }
  lines.push('', '## AI proposal', proposal.summary || '—', '');

  if (proposal.proposalType === 'bug_fix') {
    if (body.root_cause_hypothesis) lines.push(`**Root cause hypothesis:** ${body.root_cause_hypothesis}`);
    if (body.suggested_fix) lines.push(`\n**Suggested fix:** ${body.suggested_fix}`);
    if (body.repro_steps?.length) {
      lines.push('\n**Repro steps:**');
      for (const step of body.repro_steps) lines.push(`- ${step}`);
    }
    if (body.test_plan?.length) {
      lines.push('\n**Test plan:**');
      for (const step of body.test_plan) lines.push(`- ${step}`);
    }
    if (body.affected_components?.length) {
      lines.push(`\n**Affected components:** ${body.affected_components.join(', ')}`);
    }
  } else if (proposal.proposalType === 'feature') {
    if (body.problem_statement) lines.push(`**Problem:** ${body.problem_statement}`);
    if (body.proposed_mvp) lines.push(`\n**Proposed MVP:** ${body.proposed_mvp}`);
    if (body.effort_estimate) lines.push(`\n**Effort:** ${body.effort_estimate}`);
  }

  if (body.github_issue_body) {
    lines.push('', '---', '', body.github_issue_body);
  }

  lines.push('', '_Created from Parley support platform (Option A — issue only, no auto-PR)._');
  return lines.join('\n');
}

async function createSupportIssue(ticket, proposal) {
  if (!githubConfigured()) {
    return { ok: false, error: 'GitHub not configured' };
  }
  const repo = parseRepo();
  if (!repo) return { ok: false, error: 'Invalid GITHUB_REPO' };

  const body = proposal.body || {};
  const isBug = proposal.proposalType === 'bug_fix';
  const title =
    body.github_issue_title ||
    (isBug ? `[Support #${ticket.publicNumber}] ${ticket.subject}` : `[Feature #${ticket.publicNumber}] ${ticket.subject}`);

  const labels = isBug ? ['bug', 'from-support'] : ['enhancement', 'from-support'];
  if (isBug && ticket.severity) labels.push(`severity-${ticket.severity}`);

  try {
    const res = await axios.post(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`,
      {
        title: String(title).slice(0, 256),
        body: buildIssueBody(ticket, proposal),
        labels,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 20000,
      }
    );
    const url = res.data?.html_url;
    return { ok: true, url, number: res.data?.number };
  } catch (e) {
    console.error('[githubIssues] create failed:', e.response?.data || e.message);
    return { ok: false, error: e.response?.data?.message || e.message };
  }
}

module.exports = {
  githubConfigured,
  createSupportIssue,
};
