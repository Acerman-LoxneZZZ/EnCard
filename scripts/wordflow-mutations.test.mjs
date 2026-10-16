import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/wordflow-model.js';
const M=globalThis.WordflowModel,now=Date.now();
const session=(queue,learned=[],difficult=[],hinted=[])=>({queue,learned,difficult,hinted,attempts:7,streak:2,bestStreak:4});
function document(){return M.normalizeDocument({format:'wordflow-backup',version:1,builtinWords:[...M.BUILTIN_WORDS],customWords:['alpha','bravo','charlie'].map(en=>({en,ru:en,ipa:`/${en}/`})),session:session([...Array.from({length:20},(_,i)=>i),22],[20,21],[21,22],[22]),collections:{items:[{id:'deck-a',name:'A',wordIds:[20,21,22]},{id:'deck-b',name:'B',wordIds:[21]},{id:'deck-c',name:'C',wordIds:[22]}],activeId:'deck-a',sessions:{'deck-a':session([22],[20,21],[21,22],[22]),'deck-b':session([],[21],[21]),'deck-c':session([22])}},preferences:{effects:true,shortcuts:true}},now);}
test('deleting the middle word remaps every numeric reference and preserves counters, keys and empty decks',()=>{
  const d=document(),original=structuredClone(d),next=M.deleteWord(d,21);
  assert.deepEqual(d,original);assert.deepEqual(next.customWords.map(w=>w.key),['legacy:alpha','legacy:charlie']);
  assert.deepEqual(next.session.learned,[20]);assert.deepEqual(next.session.difficult,[21]);assert.deepEqual(next.session.hinted,[21]);
  assert.deepEqual(next.collections.items.map(c=>c.wordIds),[[20,21],[],[21]]);
  assert.deepEqual(next.collections.sessions['deck-a'].queue,[21]);assert.deepEqual(next.collections.sessions['deck-a'].learned,[20]);
  assert.deepEqual(next.collections.sessions['deck-b'].queue,[]);assert.deepEqual(next.collections.sessions['deck-b'].learned,[]);
  for(const s of [next.session,...Object.values(next.collections.sessions)])assert.deepEqual([s.attempts,s.streak,s.bestStreak],[7,2,4]);
  assert.deepEqual(next.activity,d.activity);assert.doesNotThrow(()=>M.normalizeDocument(next,now));
});
test('translation and case-only edits preserve progress and stable key',()=>{
  const d=document(),result=M.editWord(d,21,{en:'BRAVO',ru:'Исправлено'},()=>'/new/');
  assert.equal(result.resetProgress,false);assert.deepEqual(result.document.session,d.session);
  assert.deepEqual(result.document.collections,d.collections);assert.equal(result.document.customWords[1].key,'legacy:bravo');assert.equal(result.document.customWords[1].ipa,'/bravo/');
});
test('changing English resets only that word in every containing deck and clears recording',()=>{
  const d=document();Object.assign(d.customWords[1],{audioUrl:'https://example.test/audio',audioCredit:'credit',audioSource:'https://example.test/source'});
  const original=structuredClone(d),result=M.editWord(d,21,{en:'delta',ru:'Дельта'},text=>`/${text}/`),next=result.document;
  assert.equal(result.resetProgress,true);assert.deepEqual(d,original);assert.equal(next.customWords[1].key,'legacy:bravo');
  assert.equal(next.customWords[1].ipa,'/delta/');assert.equal(next.customWords[1].audioUrl,undefined);
  assert.deepEqual(next.session.learned,[20]);assert.deepEqual(next.session.queue.at(-1),21);assert.deepEqual(next.session.difficult,[22]);assert.deepEqual(next.session.hinted,[22]);
  assert.deepEqual(next.collections.sessions['deck-b'].queue,[21]);assert.deepEqual(next.collections.sessions['deck-c'],d.collections.sessions['deck-c']);
  for(const s of [next.session,...Object.values(next.collections.sessions)])assert.deepEqual([s.attempts,s.streak,s.bestStreak],[7,2,4]);
  assert.deepEqual(next.activity,d.activity);
});
test('mutations reject builtin edits, invalid ids and case-insensitive duplicate words',()=>{
  for(const id of [0,-1,23]) assert.throws(()=>M.editWord(document(),id,{en:'x',ru:'x'},()=>''),{code:'invalid_document'});
  for(const id of [-1,23]) assert.throws(()=>M.deleteWord(document(),id),{code:'invalid_document'});
  for(const patch of [{en:'',ru:'x'},{en:'x',ru:' '},{en:'x'.repeat(81),ru:'x'},{en:'x',ru:'x'.repeat(121)},{en:'ALPHA',ru:'x'},{en:'DISCOVER',ru:'x'}])assert.throws(()=>M.editWord(document(),21,patch,()=>''),{code:'invalid_document'});
});
test('deleting starters keeps numeric slots, other progress, history and backup round trips',()=>{
  const d=document();d.collections.items[0].wordIds.push(0);d.collections.sessions['deck-a'].queue.push(0);
  d.activity.events=[{id:'starter-answer',at:now,date:new Date(now).toISOString().slice(0,10),wordKey:'builtin:discover',en:'discover',ru:'открывать',kind:'hard'}];
  const original=structuredClone(d),next=M.deleteWord(d,0);
  assert.deepEqual(d,original);assert.deepEqual(next.collections.deletedBuiltinIds,[0]);
  assert.deepEqual(next.customWords,d.customWords);assert.deepEqual(next.session.learned,[20,21]);
  assert.deepEqual(next.session.queue,d.session.queue.filter(id=>id!==0));
  assert.deepEqual(next.collections.items[0].wordIds,[20,21,22]);assert.deepEqual(next.collections.sessions['deck-a'].queue,[22]);
  assert.deepEqual(next.activity,d.activity);assert.deepEqual(M.normalizeDocument(JSON.parse(JSON.stringify(next)),now),next);
  assert.deepEqual(JSON.parse(M.valuesFromDocument(next)[M.DATA_KEYS[2]]).deletedBuiltinIds,[0]);
  for(const action of [()=>M.deleteWord(next,0),()=>M.repeatWord(next,0,'all'),()=>M.addWordsToCollections(next,[0],['deck-a'])])assert.throws(action,{code:'invalid_document'});
  const replaced=M.editWord(next,21,{en:'DISCOVER',ru:'заново'},()=>'/new/').document;
  assert.equal(replaced.customWords[1].key,'legacy:bravo');assert.doesNotThrow(()=>M.validateDocument(replaced,now));
  const afterCustom=M.deleteWord(next,21);assert.deepEqual(afterCustom.collections.deletedBuiltinIds,[0]);assert.equal(afterCustom.customWords[1].en,'charlie');assert.doesNotThrow(()=>M.validateDocument(afterCustom,now));
});
test('all starters may be deleted, while corrupt flags or resurrected queues are rejected',()=>{
  let d=document();for(let id=0;id<20;id++)d=M.deleteWord(d,id);
  assert.deepEqual(d.session.queue,[22]);assert.deepEqual(d.session.learned,[20,21]);assert.doesNotThrow(()=>M.validateDocument(d,now));
  for(const flags of [[0,0],[-1],[20],['0'],null]){const broken=document();broken.collections.deletedBuiltinIds=flags;assert.throws(()=>M.validateDocument(broken,now),{code:'invalid_document'});}
  const broken=M.deleteWord(document(),0);broken.session.queue.push(0);assert.throws(()=>M.validateDocument(broken,now),{code:'invalid_document'});
});
test('bulk addition is additive and idempotent and queues only newly added members',()=>{
  const d=document(),next=M.addWordsToCollections(d,[20,20,22],['deck-b','deck-b']);
  assert.deepEqual(next.collections.items[1].wordIds,[21,20,22]);assert.deepEqual(next.collections.sessions['deck-b'].queue,[20,22]);
  assert.deepEqual(next.collections.sessions['deck-b'].learned,[21]);assert.deepEqual(M.addWordsToCollections(next,[20,22],['deck-b']),next);
  assert.deepEqual(next.session,d.session);assert.deepEqual(next.activity,d.activity);
  assert.throws(()=>M.addWordsToCollections(d,[999],['deck-b']),{code:'invalid_document'});
});
test('repeat targets a single deck, removes learned state, moves existing queue once, and records no answer',()=>{
  const d=document(),next=M.repeatWord(d,21,'deck-a');
  assert.deepEqual(next.collections.sessions['deck-a'].queue,[21,22]);assert.deepEqual(next.collections.sessions['deck-a'].learned,[20]);
  assert.deepEqual(next.collections.sessions['deck-b'],d.collections.sessions['deck-b']);assert.deepEqual(next.session,d.session);
  assert.deepEqual(next.activity,d.activity);assert.deepEqual(M.repeatWord(next,21,'deck-a'),next);
  assert.throws(()=>M.repeatWord(d,20,'deck-c'),{code:'invalid_document'});
});
test('recreated spelling gets a new UUID identity',()=>{
  const d=M.deleteWord(document(),21),one=M.createWordKey(),two=M.createWordKey();
  assert.match(one,/^custom:[0-9a-f-]{36}$/);assert.notEqual(one,two);assert.notEqual(one,'legacy:bravo');
  assert.equal(d.customWords.some(w=>w.key==='legacy:bravo'),false);
});
function memoryStorage(entries,failWrite=()=>false){
  const data=new Map(Object.entries(entries));let writes=0;
  return {data,getItem:key=>data.get(key)??null,setItem(key,value){if(failWrite(key,++writes,value))throw new Error('quota');data.set(key,value);},removeItem(key){if(failWrite(key,++writes,null))throw new Error('quota');data.delete(key);}};
}
test('second data-key write failure rolls back all storage and never changes live state',()=>{
  const old=M.valuesFromDocument(document()),next={...old,[M.DATA_KEYS[0]]:'[]',[M.DATA_KEYS[1]]:'{}'};
  const storage=memoryStorage(old,(_key,number)=>number===3);let applied=false;
  assert.throws(()=>M.commitValues(storage,next,()=>{applied=true;}),{code:'storage_failed'});
  assert.equal(applied,false);
  for(const key of M.DATA_KEYS)assert.equal(storage.getItem(key),old[key]);
  const recovery=JSON.parse(storage.getItem(M.RECOVERY_KEY));assert.deepEqual(recovery.values,old);
});
test('failed rollback retains a recovery copy and an actionable error',()=>{
  const old=M.valuesFromDocument(document()),storage=memoryStorage(old,(_key,number)=>number>=3);let applied=false;
  assert.throws(()=>M.commitValues(storage,{...old,[M.DATA_KEYS[0]]:'[]'},()=>{applied=true;}),error=>error.code==='rollback_failed'&&/Резервная копия/.test(error.message));
  assert.equal(applied,false);assert.deepEqual(JSON.parse(storage.getItem(M.RECOVERY_KEY)).values,old);
});
test('recovery failure makes no data writes; successful transaction applies after all values persist',()=>{
  const old=M.valuesFromDocument(document()),broken=memoryStorage(old,(_key,number)=>number===1);let applied=false;
  assert.throws(()=>M.commitValues(broken,old,()=>{applied=true;}),{code:'storage_failed'});assert.equal(applied,false);
  assert.equal(broken.data.size,5);
  const storage=memoryStorage(old),next={...old,[M.DATA_KEYS[0]]:'[]'};
  assert.equal(M.commitValues(storage,next,()=>{for(const key of M.DATA_KEYS)assert.equal(storage.getItem(key),next[key]);applied=true;}),true);
  assert.equal(applied,true);
});
