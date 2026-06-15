import { Bug, Lightbulb, MessageCircle, AlertTriangle, Sparkles, Clock, CheckCircle2 } from 'lucide-react';

export const CATEGORY_META = {
  customer_support: {
    label: 'Customer support',
    short: 'CS',
    icon: MessageCircle,
    badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  },
  bug_report: {
    label: 'Bug report',
    short: 'Bug',
    icon: Bug,
    badgeClass: 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200',
  },
  feature_request: {
    label: 'Feature request',
    short: 'Feature',
    icon: Lightbulb,
    badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
  },
};

export const STATUS_META = {
  open: { label: 'Open', tone: 'secondary', sort: 4 },
  ai_reviewing: { label: 'AI reviewing', tone: 'default', sort: 3, pulse: true },
  pending_review: { label: 'Needs approval', tone: 'warning', sort: 0 },
  waiting_user: { label: 'Waiting on user', tone: 'secondary', sort: 5 },
  escalated: { label: 'Escalated', tone: 'destructive', sort: 1 },
  resolved: { label: 'Resolved', tone: 'outline', sort: 6 },
  closed: { label: 'Closed', tone: 'outline', sort: 7 },
};

export function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.customer_support;
}

export function statusMeta(status) {
  return STATUS_META[status] || { label: status?.replace(/_/g, ' ') || status, tone: 'secondary', sort: 9 };
}

export function pendingProposal(proposals = []) {
  return proposals.find((p) => p.status === 'pending_review') || null;
}

/** Lower = more urgent in inbox sort */
export function ticketUrgency(ticket) {
  const s = statusMeta(ticket.status);
  let score = s.sort ?? 9;
  if (ticket.category === 'bug_report' && ticket.severity === 'critical') score -= 0.5;
  if (ticket.category === 'bug_report' && ticket.severity === 'high') score -= 0.2;
  return score;
}

export function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    const ua = ticketUrgency(a);
    const ub = ticketUrgency(b);
    if (ua !== ub) return ua - ub;
    return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
  });
}

export function countByStatus(tickets) {
  const counts = { needsAction: 0, aiWorking: 0, waitingUser: 0, done: 0 };
  for (const t of tickets) {
    if (t.status === 'pending_review' || t.status === 'escalated') counts.needsAction += 1;
    else if (t.status === 'ai_reviewing') counts.aiWorking += 1;
    else if (t.status === 'waiting_user' || t.status === 'open') counts.waitingUser += 1;
    else if (t.status === 'resolved' || t.status === 'closed') counts.done += 1;
  }
  return counts;
}

export function proposalActions(proposal) {
  if (!proposal || proposal.status !== 'pending_review') return [];
  if (proposal.proposalType === 'bug_fix' || proposal.proposalType === 'feature') {
    const needInfoLabel =
      proposal.proposalType === 'feature'
        ? 'Ask clarifying questions'
        : 'Ask for repro details';
    const approveLabel =
      proposal.proposalType === 'feature'
        ? 'Approve → add to GitHub backlog'
        : 'Approve → create GitHub issue';
    return [
      { action: 'approve', label: approveLabel, variant: 'default' },
      { action: 'need_info', label: needInfoLabel, variant: 'outline' },
      { action: 'reject', label: 'Reject proposal', variant: 'outline' },
    ];
  }
  if (proposal.proposalType === 'support_reply') {
    return [
      { action: 'send_reply', label: 'Approve & send reply to user', variant: 'default' },
      { action: 'take_over', label: 'Take over (assign to me)', variant: 'outline' },
      { action: 'reject', label: 'Reject draft', variant: 'outline' },
    ];
  }
  if (proposal.proposalType === 'escalation') {
    return [
      { action: 'take_over', label: 'Take over ticket', variant: 'default' },
      { action: 'send_reply', label: 'Send AI draft to user', variant: 'outline' },
      { action: 'reject', label: 'Dismiss escalation', variant: 'outline' },
    ];
  }
  return [{ action: 'take_over', label: 'Assign to me', variant: 'default' }];
}

export function getActionGuide(ticket, proposals = []) {
  const pending = pendingProposal(proposals);
  const cat = categoryMeta(ticket.category);

  if (pending) {
    if (pending.proposalType === 'bug_fix') {
      return {
        icon: Bug,
        tone: 'bug',
        title: 'Bug report — review AI triage',
        summary: 'Verify the hypothesis and GitHub issue draft, then approve or ask for more info.',
        steps: [
          'Read the user thread and AI root-cause hypothesis below',
          'Check suggested components and repro steps',
          'Approve to create a GitHub issue, or reject / request more info',
        ],
      };
    }
    if (pending.proposalType === 'feature') {
      return {
        icon: Lightbulb,
        tone: 'feature',
        title: 'Feature request — review AI proposal',
        summary: 'Confirm the problem statement and MVP scope before opening a GitHub issue.',
        steps: [
          'Review problem statement and proposed MVP',
          'Approve to add to GitHub backlog, or ask the user clarifying questions',
        ],
      };
    }
    if (pending.proposalType === 'support_reply') {
      return {
        icon: MessageCircle,
        tone: 'cs',
        title: 'Customer support — approve reply',
        summary: 'AI drafted a reply that needs your OK before the user sees it in Help chat.',
        steps: [
          'Read the draft reply below',
          'Approve & send, take over manually, or reject the draft',
        ],
      };
    }
    if (pending.proposalType === 'escalation') {
      return {
        icon: AlertTriangle,
        tone: 'escalation',
        title: 'Escalation — human required',
        summary: 'Sensitive or high-risk issue. Send the AI draft to keep the chat moving, or take over manually.',
        steps: [
          'Review escalation reason and user context',
          'Send AI draft to user, take over the ticket, or dismiss the escalation',
        ],
      };
    }
  }

  if (ticket.status === 'ai_reviewing') {
    return {
      icon: Sparkles,
      tone: 'ai',
      title: `${cat.short} — AI is working`,
      summary: 'Parley Support is reading the thread. This page refreshes automatically.',
      steps: ['Wait for AI to reply in-app or queue a proposal', 'You will be notified via Telegram for approvals'],
    };
  }

  if (ticket.status === 'escalated') {
    return {
      icon: AlertTriangle,
      tone: 'escalation',
      title: 'Escalated — you own this',
      summary: 'Respond in the Help thread or send a staff reply below.',
      steps: ['Reply to the user in Help chat', 'Mark resolved when done'],
    };
  }

  if (ticket.status === 'waiting_user') {
    return {
      icon: Clock,
      tone: 'wait',
      title: 'Waiting on the user',
      summary: 'Last message went to the user. No action unless they reply or you want to follow up.',
      steps: ['Monitor for new user messages', 'Send a staff reply if you need to nudge them'],
    };
  }

  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return {
      icon: CheckCircle2,
      tone: 'done',
      title: 'Closed out',
      summary: 'No action needed unless the user reopens the conversation.',
      steps: [],
    };
  }

  if (ticket.category === 'bug_report') {
    return {
      icon: Bug,
      tone: 'bug',
      title: 'Bug report — in progress',
      summary: 'Track AI proposals or reply manually if the user is waiting.',
      steps: ['Watch for pending AI proposal', 'Use staff reply for manual updates'],
    };
  }

  if (ticket.category === 'feature_request') {
    return {
      icon: Lightbulb,
      tone: 'feature',
      title: 'Feature request — in progress',
      summary: 'Approve GitHub backlog item when AI proposal is ready.',
      steps: ['Watch for pending AI proposal', 'Comms tab can broadcast updates later'],
    };
  }

  return {
    icon: MessageCircle,
    tone: 'cs',
    title: 'Customer support',
    summary: 'AI handles first line in Help chat. You step in on escalation or approval.',
    steps: ['Monitor thread below', 'Staff reply emails the user and posts in chat'],
  };
}

const TONE_STYLES = {
  bug: 'border-red-500/40 bg-red-500/5',
  feature: 'border-amber-500/40 bg-amber-500/5',
  cs: 'border-sky-500/40 bg-sky-500/5',
  escalation: 'border-orange-500/40 bg-orange-500/5',
  ai: 'border-violet-500/40 bg-violet-500/5',
  wait: 'border-border/60 bg-muted/30',
  done: 'border-emerald-500/30 bg-emerald-500/5',
};

export function actionGuideClass(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.cs;
}

export function formatUserContext(context) {
  const u = context?.user;
  if (!u) return null;
  const parts = [];
  if (u.email) parts.push(u.email);
  if (u.orgName) parts.push(u.orgName);
  if (u.orgRole) parts.push(u.orgRole);
  if (u.plan?.name) parts.push(`${u.plan.name} plan`);
  return parts.length ? parts.join(' · ') : null;
}

export function proposalDetailFields(proposal) {
  const b = proposal?.body || {};
  const fields = [];
  if (b.user_intent) fields.push({ label: 'User intent', value: b.user_intent });
  if (b.root_cause_hypothesis) fields.push({ label: 'Root cause hypothesis', value: b.root_cause_hypothesis });
  if (b.problem_statement) fields.push({ label: 'Problem', value: b.problem_statement });
  if (b.proposed_mvp) fields.push({ label: 'Proposed MVP', value: b.proposed_mvp });
  if (b.github_issue_title) fields.push({ label: 'GitHub title', value: b.github_issue_title });
  if (b.escalation_reason || b.reason) {
    fields.push({ label: 'Escalation reason', value: b.escalation_reason || b.reason });
  }
  if (Array.isArray(b.repro_steps) && b.repro_steps.length) {
    fields.push({ label: 'Repro steps', value: b.repro_steps.join('\n') });
  }
  if (Array.isArray(b.affected_components) && b.affected_components.length) {
    fields.push({ label: 'Components', value: b.affected_components.join(', ') });
  }
  return fields;
}

export function refreshIntervalMs(tickets, selectedTicket) {
  const active =
    tickets.some((t) => t.status === 'ai_reviewing' || t.status === 'pending_review') ||
    selectedTicket?.status === 'ai_reviewing' ||
    selectedTicket?.status === 'pending_review';
  return active ? 4000 : 12000;
}
