const {syncBuiltinESMExports}=require('node:module');
function prepareSupportTest(){
 const target=process.env.TEST_SUPPORT_DATABASE_URL;const sqlite=process.env.TEST_SUPPORT_SQLITE_PATH;
 if(target!=='postgresql://rhule@127.0.0.1:5432/lalia_opshub_test_20261111' && !(target===undefined&&sqlite==='/private/tmp/lalia-opshub-gateway-test.sqlite'))throw Error('Explicit isolated Lalia support database required');
 for(const k of Object.keys(process.env))if(!['PATH','HOME','TMPDIR','SHELL','LANG','NODE_TEST_CONTEXT'].includes(k))delete process.env[k];
 Object.assign(process.env,{NODE_ENV:'test',DOTENV_CONFIG_PATH:'/dev/null',JWT_SECRET_V2:'isolated-lalia-support-jwt-fixture-20261111',SETTINGS_ENCRYPTION_KEY:'isolated-lalia-proof-encryption'});
 if(target)process.env.DATABASE_URL=target;else process.env.V2_DB_PATH=sqlite;
 const dotenv=require('dotenv');dotenv.config=dotenv.configDotenv=()=>({parsed:{}});dotenv.populate=()=>({});
 const allow=args=>{const a=Array.isArray(args[0])?args[0][0]:args[0];const o=typeof a==='object'?a:{port:a,host:args[1]};if(o.path||!['127.0.0.1','localhost'].includes(o.host||'localhost')||![5432,5395,5396,5397].includes(Number(o.port)))throw Error('External network blocked');};
 const net=require('node:net'),connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){allow(args);return connect.apply(this,args);};const tls=require('node:tls'),tc=tls.connect;tls.connect=(...args)=>{allow(args);return tc(...args);};syncBuiltinESMExports();
 const fetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(String(input));if(u.hostname!=='127.0.0.1'||![5395,5396,5397].includes(Number(u.port)))throw Error('External fetch blocked');return fetch(input,{...init,redirect:'error'});};
}
module.exports={prepareSupportTest};
