/** Private memory only, owned by one mounted actor/business client. */
export class PendingIntents {
  private pending = new Map<string, Map<string, {body:string;key:string;receiptId?:string;guestToken?:string|undefined}>>();
  retained(scope:string,body:string) { return this.pending.get(scope)?.get(body); }
  key(scope:string,body:string,guestToken?:string):string {
    const old=this.retained(scope,body);if(old)return old.key;
    const key=globalThis.crypto.randomUUID();
    let entries=this.pending.get(scope);if(!entries){entries=new Map();this.pending.set(scope,entries);}
    entries.set(body,{body,key,guestToken});return key;
  }
  settle(scope:string,key:string,status:number,data:unknown):void {
    const retained=[...this.pending.get(scope)?.values()??[]].find(value=>value.key===key);
    if(status===202&&(data as any)?.status==='pending') {
      if(retained)retained.receiptId=(data as any).receiptId;
      throw Object.assign(new Error('Submission is pending. Your draft is retained.'),{code:'support_pending',receiptId:(data as any).receiptId,retryPaused:(data as any).retryPaused});
    }
    this.complete(scope,key);
  }
  has(scope:string,body:string){return Boolean(this.retained(scope,body));}
  ownsReceipt(id:string){return [...this.pending.values()].some(entries=>[...entries.values()].some(value=>value.receiptId===id));}
  receiptProof(id:string){for(const entries of this.pending.values())for(const value of entries.values())if(value.receiptId===id)return value.guestToken;}
  complete(scope:string,key:string){const entries=this.pending.get(scope);for(const [body,value] of entries??[])if(value.key===key)entries!.delete(body);if(entries?.size===0)this.pending.delete(scope);}
}
