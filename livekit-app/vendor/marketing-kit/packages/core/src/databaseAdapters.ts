import type { MarketingDbAdapter } from './schema.js';
interface QueryExecutor {query(sql:string,params?:any[]):Promise<{rowCount:number|null;rows:any[]}>}
interface QueryPool extends QueryExecutor {connect():Promise<QueryExecutor&{release():void}>}
export function createPgMarketingAdapter(pool:QueryPool):MarketingDbAdapter {
 const bind=(executor:QueryExecutor):MarketingDbAdapter=>{
  const query=(sql:string,params:unknown[]=[])=>{let n=0;return executor.query(sql.replace(/\?/g,()=>`$${++n}`),params);};
  return {run:async(s,p)=>({changes:(await query(s,p)).rowCount||0}),get:async(s,p)=>(await query(s,p)).rows[0],all:async(s,p)=>(await query(s,p)).rows};
 };
 const transaction=async<T>(work:(db:MarketingDbAdapter)=>Promise<T>,snapshot=false)=>{
  const client=await pool.connect();try{await client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');const result=await work(bind(client));await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
 return {...bind(pool),transaction:work=>transaction(work),snapshot:work=>transaction(work,true)};
}
