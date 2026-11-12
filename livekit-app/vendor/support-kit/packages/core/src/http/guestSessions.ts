import { ensureGuestSessionsSchema } from "../db/guestSessionsSchema.js";
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupportUser } from '@quill/support-shared';
import type { DbAdapter } from '../adapters/types.js';

/** Proofs expire after 24 hours. The random owner survives contact collisions, never email-derived. */
export class GuestSessions {
  constructor(private db: DbAdapter, private prefix: string) {}
  async ensureSchema(): Promise<void> {
    await ensureGuestSessionsSchema(this.db, this.prefix);
  }
  async create(tenantId:string,email:string,name?:string) {
    const token=randomBytes(32).toString('base64url');
    const ownerId=`guest:${randomUUID()}`;
    const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
    await this.db.run(`INSERT INTO ${this.prefix}guest_sessions (token_hash,tenant_id,owner_id,email,name,expires_at) VALUES (?,?,?,?,?,?)`,[this.hash(token),tenantId,ownerId,email,name??null,expiresAt]);
    return {token,ownerId,expiresAt};
  }
  async resolve(tenantId:string,token:string|undefined):Promise<SupportUser|null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row=await this.db.get<{owner_id:string;email:string;name:string|null}>(`SELECT owner_id,email,name FROM ${this.prefix}guest_sessions WHERE tenant_id = ? AND token_hash = ? AND expires_at > ?`,[tenantId,this.hash(token),new Date().toISOString()]);
    return row?{id:row.owner_id,email:row.email,...(row.name?{name:row.name}:{}),role:'user',principalType:'guest'}:null;
  }
  private hash(token:string) {return createHash('sha256').update(token).digest('hex');}
}
