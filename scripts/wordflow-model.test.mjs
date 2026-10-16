import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/wordflow-model.js';

const M=globalThis.WordflowModel;
const now=Date.parse('2026-10-16T12:00:00Z');
function document() {
  return {format:'wordflow-backup',version:1,builtinWords:[...M.BUILTIN_WORDS],
    customWords:[{en:'Example',ru:'Пример',ipa:'/test/'}],
    session:{queue:Array.from({length:21},(_,i)=>i),learned:[],difficult:[],hinted:[],attempts:0,streak:0,bestStreak:0},
    collections:{items:[{id:'deck-test',name:'Тест',wordIds:[20]}],activeId:'deck-test',sessions:{'deck-test':{queue:[20],learned:[],difficult:[],hinted:[],attempts:0,streak:0,bestStreak:0}}},preferences:{effects:true,shortcuts:true}};
}
test('v1 normalization migrates deterministic identities without changing numeric progress',()=>{
  const old=document(),original=structuredClone(old),a=M.normalizeDocument(old,now),b=M.normalizeDocument(old,now+1);
  assert.equal(a.version,2);assert.equal(a.customWords[0].key,'legacy:example');
  assert.equal(a.customWords[0].key,b.customWords[0].key);assert.deepEqual(a.session,old.session);
  assert.deepEqual(a.collections,old.collections);assert.deepEqual(old,original);
  assert.deepEqual(a.activity,{startedAt:now,events:[],truncated:false});
  assert.equal(M.validateDocument(old,now).version,1);
});
test('v2 roundtrip preserves stable key and activity after spelling changes',()=>{
  const d=M.normalizeDocument(document(),now);d.customWords[0].en='Different';
  assert.deepEqual(M.normalizeDocument(d,now),d);assert.equal(M.wordKey(d,20),'legacy:example');
  assert.equal(M.wordKey(d,0),'builtin:discover');
});
test('invalid keys, duplicate spelling, foreign IDs and corrupt counters are rejected',()=>{
  const changes=[d=>d.customWords[0].key='builtin:discover',d=>d.customWords[0].key='',d=>d.customWords[0].key='x'.repeat(751),
    d=>d.customWords.push({...d.customWords[0],en:'Other'}),d=>d.customWords[0].en='Discover',d=>d.session.queue.push(99),
    d=>d.session.queue[0]=1,d=>d.session.attempts=-1,d=>d.session.bestStreak=2,d=>d.collections.sessions=[]];
  for(const change of changes){const d=M.normalizeDocument(document(),now);change(d);assert.throws(()=>M.normalizeDocument(d,now),{code:'invalid_document'});}
});
test('prototype-like user strings remain inert data',()=>{
  const d=document();d.customWords[0].en='__proto__';d.collections.items[0].name='constructor';
  const normalized=M.normalizeDocument(d,now);
  assert.equal(normalized.customWords[0].key,'legacy:__proto__');
  assert.equal(Object.prototype.polluted,undefined);
  assert.throws(()=>M.normalizeDocument({...d,collections:{...d.collections,items:[{id:'__proto__',name:'x',wordIds:[]}]}},now),{code:'invalid_document'});
});
test('received documents reject oversized payloads instead of pruning',()=>{
  const d=M.normalizeDocument(document(),now);d.extra='x'.repeat(M.MAX_DOCUMENT_BYTES);
  assert.throws(()=>M.validateDocument(d,now),{code:'too_large'});
});
test('event dates, identifiers, timestamps and answer kinds are validated',()=>{
  const event={id:'event-1',at:now,date:'2026-10-16',wordKey:'legacy:example',en:'Example',ru:'Пример',kind:'hard'};
  for(const change of [e=>e.date='2026-02-30',e=>e.date='2026-10-14',e=>e.kind='maybe',e=>e.at=now+86400001,e=>e.at=1.5,e=>e.id='x'.repeat(101),e=>e.wordKey='__proto__']) {
    const d=M.normalizeDocument(document(),now),e={...event};change(e);d.activity.events=[e];
    assert.throws(()=>M.normalizeDocument(d,now),{code:'invalid_document'});
  }
  const d=M.normalizeDocument(document(),now);d.activity.events=[event,{...event}];
  assert.throws(()=>M.normalizeDocument(d,now),{code:'invalid_document'});
});
test('storage values include v2 identity and history without moving old keys',()=>{
  const d=M.normalizeDocument(document(),now),values=M.valuesFromDocument(d);
  assert.deepEqual(Object.keys(values),['wordflow.custom-words.v1','wordflow.session.v1','wordflow.collections.v1','wordflow.preferences.v1','wordflow.activity.v1']);
  assert.equal(JSON.parse(values['wordflow.custom-words.v1'])[0].key,'legacy:example');
  assert.deepEqual(JSON.parse(values['wordflow.activity.v1']),d.activity);
});
