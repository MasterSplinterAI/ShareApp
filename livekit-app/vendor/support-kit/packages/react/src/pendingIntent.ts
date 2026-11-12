/** Memory only: scoped to a mounted actor/business client; no private draft persisted. */
export class PendingIntents {
 private pending=new Map<string,{body:string;key:string;receiptId?:string}>();
 key(scope:string,body:string):string {
  const old=this.pending.get(scope);if(old?.body===body)return old.key;
  const key=globalThis.crypto.randomUUID();this.pending.set(scope,{body,key});return key;
 }
 settle(scope:string,key:string,status:number,data:unknown):void {
  if(status===202 && (data as any)?.status==='pending') {const retained=this.pending.get(scope);if(retained?.key===key)retained.receiptId=(data as any).receiptId;}
  if(status===202 && (data as any)?.status==='pending')throw Object.assign(new Error('Submission is pending. Your draft is retained.'),{code:'support_pending',receiptId:(data as any).receiptId});
  this.complete(scope,key);
 }
 has(scope:string,body:string){return this.pending.get(scope)?.body===body;}
 ownsReceipt(id:string){return [...this.pending.values()].some(value=>value.receiptId===id);}
 complete(scope:string,key:string){if(this.pending.get(scope)?.key===key)this.pending.delete(scope);}
}
