import {AsyncLocalStorage} from 'node:async_hooks';
import type {DbAdapter} from '../adapters/types.js';

type Connection={exec(sql:string):unknown;prepare(sql:string):{run(...params:unknown[]):{changes:number};get(...params:unknown[]):unknown;all(...params:unknown[]):unknown[]}};
/** A single SQLite connection cannot accept unrelated async work inside an open transaction. */
export function serializeSqlite(db:Connection):DbAdapter {
 let pending:Promise<unknown>=Promise.resolve();
 const context=new AsyncLocalStorage<boolean>();
 const bound:DbAdapter={transactional:true,
  async run(sql,params=[]){return {changes:db.prepare(sql).run(...params).changes};},
  async get(sql,params=[]){return db.prepare(sql).get(...params) as never;},
  async all(sql,params=[]){return db.prepare(sql).all(...params) as never;},
 };
 const queue=<T>(work:()=>Promise<T>):Promise<T>=>{
  if(context.getStore())return Promise.reject(Error('Use the bound transaction adapter inside a transaction'));
  const result=pending.then(work,work);pending=result.catch(()=>{});return result;
 };
 return {
  run:(sql,params)=>queue(()=>bound.run(sql,params)),
  get:(sql,params)=>queue(()=>bound.get(sql,params)),
  all:(sql,params)=>queue(()=>bound.all(sql,params)),
  transaction:work=>queue(()=>context.run(true,async()=>{
   db.exec('BEGIN IMMEDIATE');try{const result=await work(bound);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  })),
 };
}
