#!/usr/bin/env python3
"""Disposable loopback PostgreSQL only; never opens a remote URL."""
from pathlib import Path
import argparse,json,subprocess,time,re
arg=argparse.ArgumentParser();arg.add_argument('--templates',required=True);arg.add_argument('--port',type=int,default=55286);arg.add_argument('--psql',default='/opt/homebrew/opt/postgresql@17/bin/psql');a=arg.parse_args()
root=Path(__file__).resolve().parents[1];states=json.loads(Path(a.templates).read_text())['state_templates'];db='postgres';cases=[]
def run(sql,user='postgres',ok=True):
 assert db=='postgres' or db.startswith('sc_person_group_test_')
 r=subprocess.run([a.psql,'-X','-Atq','-v','ON_ERROR_STOP=1','-h','/tmp','-p',str(a.port),'-U',user,'-d',db],input=sql,text=True,capture_output=True,timeout=30)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
lit=lambda x:"'"+str(x).replace("'","''")+"'"
def select(sql):return run(sql).stdout.strip()
def test(name,fn):fn();cases.append(name);print('PASS '+name,flush=True)
source=(root/'database/supabase-runtime-protocol-read-review.sql').read_text();seq=0
N='00000000-0000-4000-8000-000000001001';V='00000000-0000-4000-8000-000000001002'
def reader(protocol=1,uid=N,role='authenticated'):
 return json.loads(select('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL ROLE '+role+'; SET LOCAL request.jwt.claim.sub='+lit(uid)+';SELECT read_app_protocol('+str(protocol)+');COMMIT;'))
def clone(st):
 global db,seq
 db='postgres';seq+=1;name='sc_person_group_test_protocol_'+str(int(time.time()))+'_'+str(seq);assert states[st].startswith('sc_person_group_test_')
 run('CREATE DATABASE "'+name+'" OWNER postgres TEMPLATE "'+states[st]+'";',user='nikybebba');db=name
 version=select("SHOW server_version_num")
 adapted=source.replace("current_database()<>'postgres'","current_database()<>"+lit(db)).replace("'170006'",lit(version))
 run(adapted)
for st,mode,floor in [('S0','LEGACY',0),('S1','READ_ONLY',0),('S2','READ_ONLY',0),('S3','READ_ONLY',0),('S4','READ_ONLY',0),('S5','TARGET',1),('S6','READ_ONLY',1)]:
 clone(st)
 def valid():
  v=reader();assert v['mode']==mode,(st,v);assert v['minimum_client_protocol']==floor;assert len(v['authority_epoch'])==64
 test(st+' positive online protocol',valid)
 test(st+' compatibility audit allowlist',lambda:select('SELECT runtime_4a4_audit();'))
 test(st+' owner/OID retained and 46 functions',lambda:exec("assert select(\"SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace\")=='46'"))
clone('S0')
for protocol in [0,2,-1]:test('unsupported protocol '+str(protocol),lambda p=protocol:exec("assert reader(p)['outcome']=='ERROR'"))
test('unmapped authenticated identity',lambda:exec("assert reader(uid='00000000-0000-4000-8000-000000001003')['outcome']=='ERROR'"))
test('missing authenticated UID',lambda:exec("assert reader(uid='')['outcome']=='ERROR'"))
def anon():assert run('SET ROLE anon;SELECT read_app_protocol(1);',ok=False).returncode!=0
test('anon EXECUTE denied',anon)
old=reader()['authority_epoch'];run('REVOKE DELETE ON movies FROM authenticated;')
test('partial legacy grant refuses authority',lambda:exec("assert reader()['outcome']=='ERROR'"))
clone('S0');before=reader()['authority_epoch'];run('SELECT runtime_4a4_apply_fence();');after=reader()
test('first fence with empty config becomes read_only',lambda:exec("assert after['mode']=='READ_ONLY'\nassert select('SELECT count(*) FROM app_protocol_state')=='0'\nassert before!=after['authority_epoch']"))
test('new reader grant does not activate target',lambda:exec("assert select(\"SELECT has_function_privilege('authenticated','get_app_runtime_context(integer)','EXECUTE')\")=='f'\nassert select('SELECT runtime_4a4_target_used()')=='f'"))
# Recovery exactly matches B2 legacy mutation surfaces; only local fixture grants.
run('GRANT INSERT,UPDATE,DELETE ON movies TO authenticated;GRANT INSERT,DELETE ON vetoes TO authenticated;GRANT INSERT ON swipe_sessions,swipes TO authenticated;GRANT UPDATE(status,matched_movie_id,matched_at) ON swipe_sessions TO authenticated;GRANT EXECUTE ON FUNCTION manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) TO authenticated;')
test('legacy fence restore changes epoch even with same permissions',lambda:exec("assert reader()['mode']=='LEGACY'\nassert reader()['authority_epoch']!=before"))
clone('S2');run('DELETE FROM app_protocol_state;')
test('missing protocol after committed Foundation cannot restore legacy',lambda:exec("assert reader()['outcome']=='ERROR'"))
clone('S5');run('REVOKE EXECUTE ON FUNCTION execute_match_action(integer,text,jsonb) FROM authenticated;')
test('partial target facade grants fail closed',lambda:exec("assert reader()['outcome']=='ERROR'"))
clone('S6');run('UPDATE app_protocol_state SET minimum_client_protocol=2;')
test('unknown floor fails closed',lambda:exec("assert reader()['outcome']=='ERROR'"))
clone('S0');run('GRANT pg_write_all_data TO authenticated;',user='nikybebba')
try:test('inherited broad write path fails closed',lambda:exec("assert reader()['outcome']=='ERROR'"))
finally:run('REVOKE pg_write_all_data FROM authenticated;',user='nikybebba')
print('PROTOCOL READ DB '+json.dumps({'cases':len(cases),'postgres_version':select('SHOW server_version'),'production_access':False})+' PASS')
