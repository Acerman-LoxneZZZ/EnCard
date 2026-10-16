import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import '../public/wordflow-model.js';
import '../public/wordflow-activity.js';
import {verifyTelegram,MAX_AUTH_AGE} from '../server/telegram.mjs';
import {validateDocument,BUILTIN_WORDS} from '../server/document.mjs';
import {handleProfile} from '../server/profile.mjs';
import {chooseSnapshot,acknowledge,valuesFromDocument,valuesMatchDocument,alignPrunedSnapshot,cacheKey,DATA_KEYS} from '../public/profile-sync.js';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const botId='123456789', now=Date.now();
function login(id=123,age=0) {
  const auth_date=String(Math.floor(now/1000)-age), user=JSON.stringify({id,first_name:`User ${id}`});
  const message=`${botId}:WebAppData\nauth_date=${auth_date}\nuser=${user}`;
  return new URLSearchParams({auth_date,user,signature:sign(null,Buffer.from(message),privateKey).toString('base64url')}).toString();
}
const verify=(data,id)=>verifyTelegram(data,id,{now,publicKey:key});
function document() {return {format:'wordflow-backup',version:1,builtinWords:BUILTIN_WORDS,customWords:[],
  session:{queue:Array.from({length:20},(_,i)=>i),learned:[],difficult:[],hinted:[],attempts:0,streak:0,bestStreak:0},
  collections:{items:[],activeId:'all',sessions:{}},preferences:{effects:true,shortcuts:true}};}
function documentV2() {
  const data=document();data.customWords.push({en:'profile word',ru:'слово профиля',ipa:''});data.session.queue.push(20);
  const migrated=globalThis.WordflowModel.normalizeDocument(data,now);
  migrated.activity.events=[{id:'answer-profile-test',at:now,date:globalThis.WordflowActivity.localDate(now),wordKey:migrated.customWords[0].key,en:'profile word',ru:'слово профиля',kind:'hard'}];
  return migrated;
}
function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_giant_mad_thinker.sql',import.meta.url),'utf8'));
  return {prepare(sql) {const statement=sqlite.prepare(sql);return {bind(...args) {return {async run(){return statement.run(...args);},async first(){return statement.get(...args) ?? null;}};}};},close(){sqlite.close();}};
}
const request=(method,id=123,payload)=>new Request('https://example.test/api/profile',{method,headers:{authorization:`tma ${login(id)}`},...(payload?{body:JSON.stringify(payload)}:{})});

test('valid independently signed Telegram data identifies its owner',async()=>{
  assert.deepEqual(await verify(login(),botId),{id:'123',name:'User 123',avatar:null});
});
test('changed user, wrong bot and duplicate fields are rejected',async()=>{
  await assert.rejects(()=>verify(login().replace('123%2C','999%2C'),botId),{status:401});
  await assert.rejects(()=>verify(login(),'987654321'),{status:401});
  await assert.rejects(()=>verify(login()+'&user=%7B%7D',botId),{status:401});
});
test('expired and future logins are rejected; missing bot config fails closed',async()=>{
  await assert.rejects(()=>verify(login(123,MAX_AUTH_AGE+1),botId),{code:'expired_login'});
  await assert.rejects(()=>verify(login(123,-60),botId),{code:'expired_login'});
  await assert.rejects(()=>verify(login(),''),{status:503});
});
test('document validation rejects foreign ids, duplicates and corrupt sessions',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(validateDocument(document()))),document());
  for(const change of [d=>d.session.queue.push(20),d=>d.session.queue[0]=1,d=>d.session.attempts=-1,d=>d.builtinWords=['wrong',...BUILTIN_WORDS.slice(1)],d=>d.collections.items.push({id:'__proto__',name:'x',wordIds:[]})]) {
    const d=structuredClone(document());change(d);assert.throws(()=>validateDocument(d),{status:400});
  }
});
test('unauthenticated requests cannot read or create profiles',async()=>{
  let accessed=false;
  const response=await handleProfile(new Request('https://example.test/api/profile'),{TELEGRAM_BOT_ID:botId,DB:{prepare(){accessed=true;}}},{verify});
  assert.equal(response.status,401);assert.equal(accessed,false);
});
test('each account reads its own document; stale writes return conflict',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId};
  try {
    const initial=await (await handleProfile(request('GET'),env,{verify})).json();
    assert.equal(initial.profile.id,'123');assert.equal(initial.revision,0);assert.equal(initial.document,null);
    const saved=await handleProfile(request('PUT',123,{revision:0,document:document()}),env,{verify});assert.equal(saved.status,200);
    const stale=await handleProfile(request('PUT',123,{revision:0,document:document()}),env,{verify});assert.equal(stale.status,409);
    const other=await (await handleProfile(request('GET',456),env,{verify})).json();assert.equal(other.document,null);assert.equal(other.revision,0);
    const own=await (await handleProfile(request('GET'),env,{verify})).json();assert.equal(own.revision,1);assert.deepEqual(own.document,document());
  } finally {DB.close();}
});
test('concurrent writes advance a revision once',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId};
  try {
    const statuses=await Promise.all([1,2].map(async()=> (await handleProfile(request('PUT',123,{revision:0,document:document()}),env,{verify})).status));
    assert.deepEqual(statuses.sort(),[200,409]);
  } finally {DB.close();}
});
test('malformed and oversized bodies never overwrite a saved document',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId};
  try {
    const corrupt=new Request('https://example.test/api/profile',{method:'PUT',headers:{authorization:`tma ${login()}`},body:'{'});
    assert.equal((await handleProfile(corrupt,env,{verify})).status,400);
    const huge=new Request('https://example.test/api/profile',{method:'PUT',headers:{authorization:`tma ${login()}`},body:'x'.repeat(1024*1024+4097)});
    assert.equal((await handleProfile(huge,env,{verify})).status,413);
    const own=await (await handleProfile(request('GET'),env,{verify})).json();assert.equal(own.document,null);assert.equal(own.revision,0);
  } finally {DB.close();}
});
test('dirty local data survives reconnect; divergent cloud data is a conflict',()=>{
  const data=document(),cache={profile:{id:'123'},revision:1,dirty:true,document:data,values:valuesFromDocument(data)};
  assert.equal(chooseSnapshot(cache,{profile:{id:'123'},revision:1,document:null}).cache.dirty,true);
  const changed=structuredClone(data);changed.preferences.effects=false;
  assert.equal(chooseSnapshot(cache,{profile:{id:'123'},revision:2,document:changed}).conflict,true);
  const recovered=chooseSnapshot(cache,{profile:{id:'123'},revision:2,document:data});assert.equal(recovered.conflict,false);assert.equal(recovered.cache.dirty,false);
  assert.notEqual(cacheKey('123'),cacheKey('456'));
});
test('editing during save remains dirty after acknowledgement',()=>{
  const sent=document(),current=structuredClone(sent);current.preferences.effects=false;
  const result=acknowledge({},sent,{revision:2,updatedAt:100},current);
  assert.equal(result.revision,2);assert.equal(result.dirty,true);assert.equal(result.document.preferences.effects,false);
});

test('imported values are not acknowledged as an older in-flight document',()=>{
  const old=document(),imported=structuredClone(old);imported.preferences.effects=false;
  const cache={profile:{id:'123'},revision:1,dirty:true,document:old,values:valuesFromDocument(imported)};
  const acknowledged=acknowledge(cache,old,{revision:2,updatedAt:100},old);
  assert.equal(acknowledged.dirty,true,'storage changes remain dirty even when the live app snapshot is stale');
  const boot=chooseSnapshot(cache,{profile:{id:'123'},revision:2,document:old});
  assert.equal(boot.conflict,true);assert.equal(boot.cache.dirty,true);
  assert.equal(JSON.parse(boot.cache.values['wordflow.preferences.v1']).effects,false);
});

test('v1 reads preserve the original schema and migration keeps numeric progress',()=>{
  const legacy=document();legacy.session.queue.shift();legacy.session.learned.push(0);legacy.session.attempts=1;legacy.session.streak=1;legacy.session.bestStreak=1;
  const validated=validateDocument(legacy,now);assert.equal(validated.version,1);
  const migrated=globalThis.WordflowModel.normalizeDocument(validated,now);
  assert.equal(migrated.version,2);assert.deepEqual(migrated.session,legacy.session);assert.deepEqual(migrated.activity.events,[]);
});

test('v2 profile round trip retains identities and activity, isolated from another account',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId},data=documentV2();
  try {
    assert.equal((await handleProfile(request('PUT',123,{revision:0,document:data}),env,{verify})).status,200);
    const own=await (await handleProfile(request('GET',123),env,{verify})).json();
    assert.deepEqual(own.document,data);assert.equal(own.revision,1);
    const other=await (await handleProfile(request('GET',456),env,{verify})).json();assert.equal(other.document,null);
    assert.equal(DATA_KEYS[4],'wordflow.activity.v1');
    assert.deepEqual(JSON.parse(valuesFromDocument(data)[DATA_KEYS[4]]),data.activity);
  } finally {DB.close();}
});

test('an old v1 save cannot downgrade a v2 profile or advance its revision',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId},data=documentV2();
  try {
    assert.equal((await handleProfile(request('PUT',123,{revision:0,document:data}),env,{verify})).status,200);
    const downgrade=await handleProfile(request('PUT',123,{revision:1,document:document()}),env,{verify});
    assert.equal(downgrade.status,409);assert.equal((await downgrade.json()).error,'update_required');
    const own=await (await handleProfile(request('GET'),env,{verify})).json();assert.equal(own.revision,1);assert.deepEqual(own.document,data);
  } finally {DB.close();}
});

test('identity and activity-only edits stay dirty through conflicts and old acknowledgements',()=>{
  const sent=documentV2(),current=structuredClone(sent);current.activity.events=[];
  assert.equal(valuesMatchDocument(valuesFromDocument(current),sent),false);
  const cache={profile:{id:'123'},revision:1,dirty:true,document:sent,values:valuesFromDocument(current)};
  assert.equal(chooseSnapshot(cache,{profile:{id:'123'},revision:2,document:sent}).conflict,true);
  assert.equal(acknowledge(cache,sent,{revision:2,updatedAt:now},current).dirty,true);
  const changedKey=structuredClone(sent);changedKey.customWords[0].key='custom:replacement-key';
  assert.equal(valuesMatchDocument(valuesFromDocument(changedKey),sent),false);
});

test('deterministic legacy identities do not manufacture a conflict during migration',()=>{
  const old=document();old.customWords=[{en:'Legacy Phrase',ru:'старая фраза',ipa:''}];old.session.queue.push(20);
  const migrated=globalThis.WordflowModel.normalizeDocument(old,now);
  assert.equal(valuesMatchDocument(valuesFromDocument(old),migrated),true);
  const cache={profile:{id:'123'},revision:1,dirty:true,document:old,values:valuesFromDocument(old)};
  const chosen=chooseSnapshot(cache,{profile:{id:'123'},revision:2,document:migrated});
  assert.equal(chosen.conflict,false);
  assert.equal(chosen.cache.document.version,2,'equal old cache adopts the authoritative migrated cloud document');
  assert.equal(chosen.cache.document.activity.startedAt,now);
  assert.deepEqual(chosen.cache.values,valuesFromDocument(migrated));
  const later=structuredClone(migrated);later.activity.startedAt=now+1;
  assert.equal(valuesMatchDocument(valuesFromDocument(migrated),later),false,'explicit collection start is part of v2 data');
});

test('malformed v2 history does not replace a saved profile',async()=>{
  const DB=database(),env={DB,TELEGRAM_BOT_ID:botId},data=documentV2();
  try {
    assert.equal((await handleProfile(request('PUT',123,{revision:0,document:data}),env,{verify})).status,200);
    const broken=structuredClone(data);broken.activity.events.push({...broken.activity.events[0]});
    assert.equal((await handleProfile(request('PUT',123,{revision:1,document:broken}),env,{verify})).status,400);
    const own=await (await handleProfile(request('GET'),env,{verify})).json();assert.equal(own.revision,1);assert.deepEqual(own.document,data);
  } finally {DB.close();}
});

test('history expiry aligns persisted values before acknowledgement without replacing a pending import',()=>{
  const before=documentV2(),later=now+8*86400000;
  const current=globalThis.WordflowActivity.fitDocument(before,later);
  assert.equal(current.activity.events.length,0);
  const cache={revision:1,dirty:true,document:before,values:valuesFromDocument(before)};
  const aligned=alignPrunedSnapshot(cache,current,later);
  assert.notEqual(aligned,cache);assert.equal(valuesMatchDocument(aligned.values,current),true);
  assert.equal(acknowledge(aligned,current,{revision:2,updatedAt:later},current).dirty,false);
  const imported=documentV2();imported.activity.events[0].kind='yes';
  const pending={...cache,document:imported,values:valuesFromDocument(imported)};
  assert.equal(alignPrunedSnapshot(pending,before,now),pending,'a live snapshot from before an import cannot replace the imported history');
});
