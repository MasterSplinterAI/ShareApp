const {createSqlSupportIntentStore,SUPPORT_PENDING_SCHEMA}=require('@rhule/ops-sdk');
const {encryptSecret,decryptSecret}=require('./secretCrypto');
/** Server-owned JWT verification + current account and membership; never trust orgId by itself. */
function createShareAppPending({businessId:canonicalBusinessId='lalia',db,verifyToken,describeUser,resolveAuthority}) {
 const current=async(id,orgId)=>{
  const user=await db.get('SELECT id,email,display_name,disabled_at FROM v2_users WHERE id=?',[id]);
  if(!user||user.disabled_at)return null;
  const membership=orgId ? await db.get('SELECT org_id FROM v2_org_members WHERE user_id=? AND org_id=?',[id,orgId]) : await db.get('SELECT org_id FROM v2_org_members WHERE user_id=? ORDER BY org_id LIMIT 1',[id]);
  if(orgId&&!membership)return null;
  return {user,orgId:membership?.org_id};
 };
 const keyReady=()=>{if(!(process.env.SETTINGS_ENCRYPTION_KEY||process.env.JWT_SECRET_V2||process.env.JWT_SECRET||'').trim())throw Error('Explicit proof encryption key required');};
 return {
  store:createSqlSupportIntentStore(db),
  resolveAuthority:resolveAuthority|| (async()=>null),
  async resolveUser(req){
   const header=String(req?.headers?.authorization||'');if(!header)return null;
   const match=header.match(/^Bearer\s+(.+)$/i);if(!match)return null;
   let payload;try{payload=verifyToken(match[1]);}catch{return null;}
   if(!payload?.sub)return null;
   const account=await current(payload.sub,payload.orgId);if(!account)throw Error('Account or membership unavailable');
   const {user,orgId}=account;
   return {id:user.id,role:'user',...(user.email?{email:user.email}:{}),...(user.display_name?{name:user.display_name}:{}),...(orgId?{orgId}:{}),...await describeUser(user,orgId)};
  },
  async customerActive(businessId,actor){return businessId===canonicalBusinessId&&Boolean(await current(actor.id,actor.orgId));},
  sealSecret(value){keyReady();const encrypted=encryptSecret(value);if(!encrypted?.startsWith('enc:v1:'))throw Error('Encrypted guest proof required');return encrypted;},
  openSecret(value){keyReady();if(!value.startsWith('enc:v1:'))throw Error('Encrypted guest proof required');const plain=decryptSecret(value);if(!plain)throw Error('Guest proof decryption failed');return plain;},
  async ensureSchema(){for(const sql of SUPPORT_PENDING_SCHEMA)await db.run(sql);},
 };
}
module.exports={createShareAppPending};
