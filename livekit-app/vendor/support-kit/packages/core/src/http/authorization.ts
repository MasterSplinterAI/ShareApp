import type { SupportUser } from '@quill/support-shared';
import type { AuthorizeSupport, DbAdapter, SupportAction } from '../adapters/types.js';
import { normalizeAction } from '../proposals/executor.js';

/** Every supported operator operation is explicit; unknown operations fail closed. */
export async function authorizeOperatorRoute(input: {
  actor: SupportUser | null; businessId: string; route: string; id?: string;
  body: Record<string, unknown>; db: DbAdapter; tablePrefix: string;
  authorizeSupport?: AuthorizeSupport; central: boolean;
}): Promise<200 | 403 | 404> {
  const {actor,businessId,route,body,db,tablePrefix,central}=input;
  if (!input.authorizeSupport) return central ? 403 : 200;
  if (!actor || (central && actor.principalType !== 'operator') || businessId === 'all') return 403;
  let actions: SupportAction[];
  let resource: {type:string;id:string}|undefined;
  const staticActions: Record<string, SupportAction[]> = {
    adminListTickets:['support.read'],adminGetTicket:['support.read'],adminListProposals:['support.read'],
    adminReplyTicket:['support.reply'],adminSetTicketStatus:['support.manage'],adminListLeads:['support.read'],
    adminKbRevisions:['knowledge.read'],adminListKb:['knowledge.read'],adminKbGet:['knowledge.read'],adminKbPatch:['knowledge.edit'],
    adminKbPromote:['knowledge.publish'],adminKbDeprecate:['knowledge.publish'],
    adminKbIngest:['knowledge.edit'],adminKbIngestWebsite:['knowledge.edit'],adminKbIngestUploads:['knowledge.edit'],
    adminListGaps:['support.read'],adminGapPatch:['support.manage'],adminGapResearch:['support.read','knowledge.edit'],
    adminPromoteKb:['support.read','knowledge.edit'],adminProposalAction:[],
  };
  const mapped=staticActions[route]; if (!mapped) return 403; actions=[...mapped];
  // Mutations can return existing resource data (including conflict payloads).
  // Require business read before loading that data, then repeat with the resolved resource.
  const prerequisites: SupportAction[] = route.startsWith('adminKb') ? ['knowledge.read']
    : ['adminPromoteKb','adminGapResearch'].includes(route) ? ['support.read','knowledge.read']
    : ['adminReplyTicket','adminSetTicketStatus','adminGapPatch','adminProposalAction'].includes(route) ? ['support.read'] : [];
  try {
    for(const action of prerequisites) if(!await input.authorizeSupport({actor,businessId,action})) return 403;
  } catch { return 403; }
  if (input.id) {
    const table = route === 'adminProposalAction' ? 'proposals' : route.startsWith('adminGap') ? 'knowledge_gaps'
      : ['adminKbRevisions','adminKbGet','adminKbPatch','adminKbPromote','adminKbDeprecate'].includes(route) ? 'kb_articles' : 'tickets';
    const numeric = table === 'tickets' && /^\d+$/.test(input.id);
    const row = await db.get<Record<string,any>>(`SELECT * FROM ${tablePrefix}${table} WHERE tenant_id = ? AND ${numeric?'public_number':'id'} = ?`,[businessId,numeric?Number(input.id):input.id]);
    if (!row) return 404;
    resource={type:table,id:String(row.id)};
    if (route === 'adminProposalAction') {
      const normalized=normalizeAction(String(body.action ?? ''));
      if (!normalized) return 403;
      if (['claim','steal','release','take_over'].includes(normalized)) actions=normalized === 'take_over'?['support.assign','support.manage']:['support.assign'];
      else if (normalized === 'reject') actions=['support.manage'];
      else if (normalized === 'need_info') actions=['support.reply'];
      else actions=['support.reply',...(['bug_fix','feature','github_issue'].includes(row.proposal_type)?['support.manage' as const]:[])];
    }
  }
  if (route === 'adminPromoteKb' && Boolean(body.activate)) actions.push('knowledge.publish');
  try {
    for (const action of new Set([...prerequisites,...actions])) if (!await input.authorizeSupport({actor,businessId,action,...(resource?{resource}:{})})) return 403;
    return 200;
  } catch { return 403; }
}
