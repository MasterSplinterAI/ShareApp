import {createSupportGateway,createSupportReplayPump,type SupportGatewayOptions,type SupportAuthority} from './supportGateway.js';
import {runRestoredSupportRequest,resolveRestoredSupportGuest,type RecoveryDatabase,type RecoveryActor} from './supportRestore.js';
import type {SupportForwardedUser} from './index.js';
/** Local transport uses the same pending/auth/key rules as central mode, but never calls a provider or legacy router. */
export function createSupportRecoveryGateway(options:Omit<SupportGatewayOptions,'getConfig'|'fetchImpl'|'resolveAuthority'> & {businessId:string;db:RecoveryDatabase;state:()=>Promise<{state:string;generation:string;expiresAt:number;restoreId?:string}>}){
 const authority=async():Promise<SupportAuthority|null>=>{const state=await options.state();return state.state==='recovery'?{businessId:options.businessId,generation:state.generation,expiresAt:state.expiresAt}:null;};
 const transport:typeof fetch=async(url,init)=>{
  const parsed=new URL(String(url)),path=parsed.pathname.replace('/api/v1/support',''),headers=new Headers(init?.headers),method=init?.method??'GET',payload=init?.body?JSON.parse(String(init.body)):{};
  if(path==='/health')return Response.json({ok:true,recovery:true});
  if(path==='/config')return Response.json({guestSessionRequired:true,guestBootstrapRequired:true,recovery:true,deliveryAvailable:false});
  if(path==='/help/articles')return Response.json({ok:true,articles:[]});
  const encoded=headers.get('X-Support-User-Json');let actor:RecoveryActor|null=null;let hostActor:SupportForwardedUser|null=null;
  if(encoded){hostActor=JSON.parse(Buffer.from(encoded,'base64url').toString());actor={...hostActor!,role:'user',principalType:'customer'};}
  const token=headers.get('x-support-guest-token')??'';const e=headers.get('x-support-accepted-intent');const accepted=e?JSON.parse(Buffer.from(e,'base64url').toString()):undefined;
  if(!actor)actor=await resolveRestoredSupportGuest(options.db,options.businessId,token,accepted);
  if(path==='/guest-session/validate')return Response.json(actor?{valid:true}:{error:'Invalid proof'},{status:actor?200:401});
  if(!actor)return Response.json({error:'Existing verified identity required during limited recovery'},{status:401});
  try{const state=await options.state();const execute=()=>runRestoredSupportRequest(options.db,{businessId:options.businessId,generation:state.generation,method,path:path+parsed.search,key:headers.get('idempotency-key')??undefined,payload,actor,authority:options.state,authorize:async()=>actor!.principalType==='guest'?true:Boolean(hostActor&&await options.customerActive?.(options.businessId,hostActor))});const result=options.withAcceptance&&method==='POST'?await options.withAcceptance(options.businessId,state.generation,execute):await execute();return Response.json(result.body,{status:result.statusCode});}
  catch{return Response.json({error:'Limited recovery is unavailable; retain the same submission key',retryable:true},{status:503});}
 };
 const configured={...options,getConfig:()=>({mode:'central' as const,tenantSlug:options.businessId,baseUrl:'https://recovery.invalid',secretKey:'local-only-no-network'}),resolveAuthority:authority,fetchImpl:transport};
 const pump=createSupportReplayPump(configured);return {...createSupportGateway(configured),startReplay:pump.start,stopReplay:pump.stop};
}
