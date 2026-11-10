'use strict';
// Compatibility interface for the existing synthetic fixture: every SQL statement
// executes on native PostgreSQL through one persistent session, never PGlite.
const assert=require('node:assert/strict'),path=require('node:path');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const connection=arg('connection');
if(!connection)throw Error('Explicit disposable loopback PostgreSQL --connection required');
const url=new URL(connection);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.password||url.search)throw Error('Disposable loopback database only');
const pg=require(arg('pg')||'pg');
pg.types.setTypeParser(20,v=>Number.isSafeInteger(Number(v))?Number(v):v);
pg.types.setTypeParser(1082,v=>new Date(v+'T00:00:00Z'));
class LocalPostgres {
 constructor(){this.client=new pg.Client({connectionString:connection,ssl:false});this.waitReady=this.start().catch(async error=>{await this.client.end();throw error;});}
 async start(){await this.client.connect();const identity=(await this.client.query("SELECT version() v,current_database() d,host(inet_server_addr()) a")).rows[0];assert(identity.v.startsWith('PostgreSQL'));assert.equal(identity.a,'127.0.0.1');
  const count=(await this.client.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m')")).rows[0].n;assert.equal(count,0,'Test database must be EMPTY');console.log('NATIVE_POSTGRES '+identity.v.split(',')[0]+'; empty synthetic database');}
 async exec(sql){await this.waitReady;const r=await this.client.query(sql);return Array.isArray(r)?r:[r];}
 async query(sql,params=[]){await this.waitReady;return this.client.query(sql,params);}
 async close(){await this.client.end();}
}
// The exported name is the fixture's historical constructor contract only.
module.exports={PGlite:LocalPostgres};
