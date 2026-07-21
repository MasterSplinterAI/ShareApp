/**
 * Host-injected GitHub issue creator for bug/feature proposal approval.
 */
export interface GitHubIssueInput {
  title: string;
  body: string;
  labels?: string[];
  kind: "bug" | "feature";
  ticketPublicNumber: number;
}

export interface GitHubIssueResult {
  url: string;
  number?: number;
}

export type GitHubAdapter = {
  createIssue: (input: GitHubIssueInput) => Promise<GitHubIssueResult>;
};

export function parseBugFeatureBody(bodyJson: string): {
  draft_reply?: string;
  github_title?: string;
  github_body?: string;
  title?: string;
  summary?: string;
} {
  try {
    return JSON.parse(bodyJson) as {
      draft_reply?: string;
      github_title?: string;
      github_body?: string;
      title?: string;
      summary?: string;
    };
  } catch {
    return {};
  }
}

export async function executeGithubFromProposal(
  github: GitHubAdapter,
  opts: {
    proposalType: string;
    bodyJson: string;
    summary: string;
    ticketPublicNumber: number;
  },
): Promise<GitHubIssueResult> {
  const parsed = parseBugFeatureBody(opts.bodyJson);
  const kind = opts.proposalType === "feature" ? "feature" : "bug";
  const title =
    parsed.github_title?.trim() ||
    parsed.title?.trim() ||
    opts.summary ||
    `${kind} from support #${opts.ticketPublicNumber}`;
  const body =
    parsed.github_body?.trim() ||
    parsed.draft_reply?.trim() ||
    `${opts.summary}\n\n_From support ticket #${opts.ticketPublicNumber}_`;

  return github.createIssue({
    title,
    body,
    kind,
    ticketPublicNumber: opts.ticketPublicNumber,
    labels: kind === "bug" ? ["bug", "from-support"] : ["enhancement", "from-support"],
  });
}
