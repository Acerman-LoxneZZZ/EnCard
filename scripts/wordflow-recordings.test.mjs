import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const audioLookups = new Map();'),html.indexOf('function stopSpeech()'));
function fixture() {
  let release;
  const word={id:20,key:'custom:old',en:'banana',ru:'банан'};
  const words=[...Array.from({length:20},(_,id)=>({id,key:'builtin:'+id,en:'builtin'})),word];
  const context={WORDS:words,BUILTIN_COUNT:20,window:{fetch(){}},URLSearchParams,
    fetchJson:()=>new Promise(resolve=>{release=resolve;}),saveCustomWords(){}};
  vm.runInNewContext(source,context);
  const finish=()=>release({query:{pages:{1:{title:'File:En-us-banana.ogg',imageinfo:[{url:'https://upload.wikimedia.org/banana.ogg',descriptionurl:'https://commons.wikimedia.org/banana',extmetadata:{}}]}}}});
  return {word,words,lookup:context.lookupRecording,finish};
}
test('pending recording follows a stable word after an unrelated immutable commit',async()=>{
  const f=fixture(),pending=f.lookup(f.word);
  f.words[20]={...f.word,ru:'изменённый перевод'};f.finish();
  await pending;
  assert.equal(f.words[20].audioUrl,'https://upload.wikimedia.org/banana.ogg');
});
test('an old recording never overwrites a renamed word',async()=>{
  const f=fixture(),pending=f.lookup(f.word);
  f.words[20]={...f.word,en:'pear'};f.finish();await pending;
  assert.equal(f.words[20].audioUrl,undefined);
});
test('a recreated word can reuse pronunciation without reusing the deleted identity',async()=>{
  const f=fixture(),pending=f.lookup(f.word);
  f.words[20]={...f.word,key:'custom:new'};f.finish();await pending;
  assert.equal(f.words[20].audioUrl,undefined);
  await f.lookup(f.words[20]);
  assert.equal(f.words[20].audioUrl,'https://upload.wikimedia.org/banana.ogg');
});
