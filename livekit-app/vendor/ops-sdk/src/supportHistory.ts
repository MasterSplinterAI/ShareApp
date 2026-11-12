import {supportPayloadHash} from './supportGateway.js';
/** Explicit data columns only. Credentials, sessions, guest tokens and provider settings are never exported. */
export const SUPPORT_HISTORY_COLUMNS = {
 tickets:'id tenant_id public_number kind topic category status subject severity priority user_id org_id guest_email context_json duplicate_of_ticket_id assigned_to github_issue_url created_at updated_at closed_at',
 messages:'id tenant_id ticket_id author_type author_id body attachments_json citation_json created_at',
 proposals:'id tenant_id ticket_id proposal_type status summary body_json confidence telegram_message_id telegram_chat_id claimed_by claimed_at reviewed_by reviewed_at execution_status execution_ref created_at',
 gaps:'id tenant_id ticket_id public_number user_question escalation_reason doc_query doc_hits_json proposal_id proposal_type summary status created_at resolved_at',
 kb:'id tenant_id title body status source_kind visibility provenance_json source_key created_at updated_at draft_revision_id published_revision_id revision_version removal_candidate retrieval_eligible',
 revisions:'id tenant_id article_id title body visibility provenance_json source_revision created_at',
 leads:'id tenant_id email name phone marketing_email_opt_in marketing_sms_opt_in source consent_text consent_at ip_hash user_agent created_at updated_at',
} as const;
export type HistoryEntity=keyof typeof SUPPORT_HISTORY_COLUMNS;
export type HistoryRow=Record<string,any> & {id:string};
export interface HistoryPage {entity:HistoryEntity;after:string;cursor:string;rows:HistoryRow[];checksum:string}
export interface SupportHistoryManifest {
 version:1;businessId:string;source:string;generation:string;revision:string;freezeId?:string;complete:true;
 pages:HistoryPage[];entities:Partial<Record<HistoryEntity,{count:number;checksum:string}>>;checksum:string;
}
const identity=/^[a-zA-Z0-9_-]{1,120}$/;
export async function supportHistoryId(business:string,source:string,entity:HistoryEntity,id:string){return 'hist_'+(await supportPayloadHash([business,source,entity,id])).slice(0,48);}
export function historyRow(entity:HistoryEntity,row:HistoryRow,businessId:string):HistoryRow {
 if(!row||typeof row.id!=='string'||!row.id||row.id.length>512)throw Error('Invalid source row identity');
 if(row.tenant_id&&row.tenant_id!==businessId)throw Error('Cross-business source row');
 const allowed=SUPPORT_HISTORY_COLUMNS[entity];if(!allowed)throw Error('Unknown history entity');
 return Object.fromEntries(allowed.split(' ').filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])) as HistoryRow;
}
/** Caller MUST hold a repeatable-read/read-only database snapshot for the entire call. No catches turn read failures into absence. */
export async function exportSupportHistory(options:{businessId:string;source:string;generation:string;revision:string;freezeId?:string;tables:Partial<Record<HistoryEntity,string>>;pageSize?:number;readPage:(table:string,after:string,limit:number)=>Promise<HistoryRow[]>;checkpoint?:(page:HistoryPage)=>Promise<void>}):Promise<SupportHistoryManifest>{
 if(!identity.test(options.businessId)||!identity.test(options.source)||!/^\d+$/.test(options.generation)||!options.revision)throw Error('Invalid snapshot identity');
 const pages:HistoryPage[]=[],entities:SupportHistoryManifest['entities']={};
 const size=Math.min(1000,Math.max(1,options.pageSize??250));
 for(const entity of Object.keys(options.tables).sort() as HistoryEntity[]){
  let after='',count=0;const checksums:string[]=[];
  for(;;){
   const input=await options.readPage(options.tables[entity]!,after,size);if(!input.length)break;
   if(input.length>size)throw Error('Invalid page size');
   const rows=input.map(row=>historyRow(entity,row,options.businessId));
   let cursor=after;for(const row of rows){if(row.id<=cursor)throw Error('Cursor did not advance');cursor=row.id;}
   const page={entity,after,cursor,rows,checksum:await supportPayloadHash(rows)};pages.push(page);checksums.push(page.checksum);count+=rows.length;
   await options.checkpoint?.(page);after=cursor;
  }
  entities[entity]={count,checksum:await supportPayloadHash(checksums)};
 }
 const artifact={version:1 as const,businessId:options.businessId,source:options.source,generation:options.generation,revision:options.revision,...(options.freezeId?{freezeId:options.freezeId}:{}),complete:true as const,pages,entities};
 return {...artifact,checksum:await supportPayloadHash(artifact)};
}
export async function verifySupportHistory(manifest:SupportHistoryManifest):Promise<Array<{entity:HistoryEntity;row:HistoryRow}>>{
 const {checksum,...body}=manifest;
 if(manifest.version!==1||manifest.complete!==true||!identity.test(manifest.businessId)||!identity.test(manifest.source)||!/^\d+$/.test(manifest.generation)||!manifest.revision||await supportPayloadHash(body)!==checksum)throw Error('Invalid or incomplete manifest checksum');
 const result:Array<{entity:HistoryEntity;row:HistoryRow}>=[];
 for(const entity of Object.keys(manifest.entities) as HistoryEntity[]){
  if(!SUPPORT_HISTORY_COLUMNS[entity])throw Error('Unknown entity');
  let cursor='',count=0;const checksums:string[]=[];
  for(const page of manifest.pages.filter(p=>p.entity===entity)){
   if(page.after!==cursor||!page.rows.length||await supportPayloadHash(page.rows)!==page.checksum)throw Error('Page checkpoint/checksum mismatch');
   for(const row of page.rows){if(row.id<=cursor||await supportPayloadHash(historyRow(entity,row,manifest.businessId))!==await supportPayloadHash(row))throw Error('Invalid page cursor or forbidden columns');cursor=row.id;result.push({entity,row});count++;}
   if(cursor!==page.cursor)throw Error('Page cursor mismatch');checksums.push(page.checksum);
  }
  if(count!==manifest.entities[entity]!.count||await supportPayloadHash(checksums)!==manifest.entities[entity]!.checksum)throw Error('Entity count/checksum mismatch');
 }
 if(manifest.pages.some(p=>!manifest.entities[p.entity]))throw Error('Undeclared entity');
 return result;
}
