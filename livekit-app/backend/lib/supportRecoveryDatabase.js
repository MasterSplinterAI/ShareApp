const {createPostgresRecoveryDatabase,createSqliteRecoveryDatabase,createSupportAcceptanceStore}=require('@rhule/ops-sdk');
const source=require('../db/v2Database');
let database,pool;
function getRawDatabase(){
 if(database)return database;
 if(source.isPostgres()){const {Pool}=require('pg');pool=new Pool({connectionString:source.DATABASE_URL,max:2,connectionTimeoutMillis:5000});database=createPostgresRecoveryDatabase(pool);}
 else database=createSqliteRecoveryDatabase(async()=>{const sqlite=require('sqlite3');const db=await new Promise((resolve,reject)=>{const c=new sqlite.Database(source.DB_PATH,sqlite.OPEN_READWRITE,error=>error?reject(error):resolve(c));});db.configure('busyTimeout',10000);return {all:(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows))),close:()=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()))};});
 return database;
}
async function closeSupportRecoveryDatabase(){if(pool)await pool.end();database=undefined;pool=undefined;}
const {AsyncLocalStorage}=require('node:async_hooks');
const acceptance=createSupportAcceptanceStore({transaction:work=>getRawDatabase().transaction(work)},new AsyncLocalStorage());
function getSupportAcceptanceStore(){return acceptance;}
function getSupportRecoveryDatabase(){return acceptance.database;}
module.exports={getSupportRecoveryDatabase,getSupportAcceptanceStore,closeSupportRecoveryDatabase};
