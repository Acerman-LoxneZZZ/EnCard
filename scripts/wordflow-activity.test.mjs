import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import '../public/wordflow-model.js';
import '../public/wordflow-activity.js';
const A=globalThis.WordflowActivity,M=globalThis.WordflowModel;
const now=Date.parse('2026-10-16T12:00:00Z');
const event=(id,kind='yes',wordKey='builtin:discover',at=now)=>({id,at,date:A.localDate(at),wordKey,en:'discover',ru:'Открывать',kind});
function document(activity=A.emptyActivity(now)) {return {format:'wordflow-backup',version:2,builtinWords:[...M.BUILTIN_WORDS],customWords:[],session:{queue:Array.from({length:20},(_,i)=>i),learned:[],difficult:[],hinted:[],attempts:0,streak:0,bestStreak:0},collections:{items:[],activeId:'all',sessions:{}},preferences:{effects:true,shortcuts:true},activity};}
test('empty activity has seven zero bars and no manufactured active day',()=>{
  const activity=A.emptyActivity(now),stats=A.summarizeWeek(activity,now);
  assert.equal(stats.days.length,7);assert.equal(stats.activeDays,0);assert.equal(stats.answers,0);assert.equal(stats.uniqueWords,0);
  assert.deepEqual(stats.days.map(d=>d.answers),[0,0,0,0,0,0,0]);assert.equal(stats.startedAt,now);
});
test('record and undo are immutable, count repeated keys once and reject reused event IDs',()=>{
  const initial=A.emptyActivity(now),one=A.recordAnswer(initial,event('one','no'),now),two=A.recordAnswer(one,event('two','hard'),now);
  assert.equal(initial.events.length,0);assert.equal(one.events.length,1);assert.equal(A.summarizeWeek(two,now).uniqueWords,1);
  assert.equal(A.summarizeWeek(two,now).answers,2);assert.throws(()=>A.recordAnswer(two,event('one'),now),{code:'invalid_document'});
  const undone=A.removeAnswer(two,'two',now);assert.equal(A.summarizeWeek(undone,now).answers,1);
  assert.deepEqual(A.removeAnswer(undone,'missing',now),undone);
});
test('difficulty ranks only no/hard, uses latest historical labels and breaks ties alphabetically',()=>{
  const activity={startedAt:now,events:[event('1','yes','legacy:c'),{...event('2','no','legacy:a'),en:'apple'},
    {...event('3','hard','legacy:b'),en:'banana'},{...event('4','yes','legacy:a',now+1),en:'apricot'}],truncated:false};
  const stats=A.summarizeWeek(activity,now+1);
  assert.deepEqual(stats.difficultWords.map(w=>[w.wordKey,w.en,w.count]),[['legacy:a','apricot',1],['legacy:b','banana',1]]);
});
test('calendar window keeps captured dates across midnight and pruned undo stays harmless',()=>{
  const before=new Date(2026,9,16,23,59,59).getTime(),after=new Date(2026,9,17,0,0,1).getTime();
  const activity=A.recordAnswer(A.emptyActivity(before),event('midnight','hard','legacy:a',before),before);
  assert.equal(A.summarizeWeek(activity,after).days.at(-2).answers,1);
  assert.equal(A.summarizeWeek(A.removeAnswer(activity,'midnight',after),after).answers,0);
  const future=new Date(2026,9,24,12).getTime(),fitted=A.fitDocument(document(activity),future,'midnight');
  assert.equal(fitted.activity.events.length,0);assert.equal(A.removeAnswer(fitted.activity,'midnight',future).events.length,0);
});
test('calendar arithmetic handles DST and timezone changes without rewriting captured dates',()=>{
  const script=`import './public/wordflow-model.js';import './public/wordflow-activity.js';const A=globalThis.WordflowActivity;const now=new Date(2026,2,30,12).getTime();const at=new Date(2026,2,29,12).getTime();const activity=A.recordAnswer(A.emptyActivity(at),{id:'dst',at,date:'2026-03-29',wordKey:'legacy:a',en:'a',ru:'а',kind:'yes'},now);process.stdout.write(JSON.stringify(A.summarizeWeek(activity,now)));`;
  const summary=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,TZ:'Europe/Berlin'},encoding:'utf8'}));
  assert.deepEqual(summary.days.map(d=>d.date),['2026-03-24','2026-03-25','2026-03-26','2026-03-27','2026-03-28','2026-03-29','2026-03-30']);
  assert.equal(summary.days.at(-2).answers,1);
  const travel={startedAt:now,events:[{...event('travel'),date:'2026-10-15'}],truncated:false};
  assert.equal(A.summarizeWeek(travel,now).days.find(d=>d.date==='2026-10-15').answers,1);
  assert.equal(travel.events[0].date,'2026-10-15');
});
test('westward timezone travel retains tomorrow-captured events until their local date catches up',()=>{
  const at=Date.parse('2026-10-16T12:30:00Z');
  const capture=`import './public/wordflow-model.js';import './public/wordflow-activity.js';const A=globalThis.WordflowActivity;process.stdout.write(JSON.stringify(A.recordAnswer(A.emptyActivity(${at}),{id:'travel-east-west',at:${at},date:A.localDate(${at}),wordKey:'builtin:discover',en:'discover',ru:'Открывать',kind:'hard'},${at})));`;
  const activity=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',capture],{cwd:process.cwd(),env:{...process.env,TZ:'Pacific/Kiritimati'},encoding:'utf8'}));
  assert.equal(activity.events[0].date,'2026-10-17');
  const original=document(activity);
  const travel=`import './public/wordflow-model.js';import './public/wordflow-activity.js';const A=globalThis.WordflowActivity;const fitted=A.fitDocument(${JSON.stringify(original)},${at},'travel-east-west');process.stdout.write(JSON.stringify({date:A.localDate(${at}),fitted,today:A.summarizeWeek(fitted.activity,${at}),tomorrow:A.summarizeWeek(fitted.activity,${at+86400000})}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',travel],{cwd:process.cwd(),env:{...process.env,TZ:'Pacific/Honolulu'},encoding:'utf8'}));
  assert.equal(result.date,'2026-10-16');assert.deepEqual(result.fitted.activity.events,activity.events);
  assert.equal(result.today.answers,0);assert.equal(result.today.activeDays,0);
  assert.equal(result.tomorrow.answers,1);assert.equal(result.tomorrow.days.at(-1).answers,1);
  assert.equal(result.fitted.activity.truncated,false);
});
test('5001 answers evict oldest deterministically while retaining the newest protected answer',()=>{
  const events=Array.from({length:5001},(_,i)=>event(String(i).padStart(5,'0'),'yes','legacy:a',now+i));
  const fitted=A.fitDocument(document({startedAt:now,events,truncated:false}),now+5001,'05000');
  assert.equal(fitted.activity.events.length,5000);assert.equal(fitted.activity.events[0].id,'00001');assert.equal(fitted.activity.events.at(-1).id,'05000');
  assert.equal(fitted.activity.truncated,true);assert.equal(fitted.activity.truncationReason,'count');
});
test('byte budget evicts history, preserves latest undo, and never clips non-history data',()=>{
  const events=Array.from({length:5000},(_,i)=>({...event(String(i),'hard','legacy:a',now+i),en:'w'.repeat(80),ru:'я'.repeat(120)}));
  const d=document({startedAt:now,events,truncated:false}),original=structuredClone(d);
  const fitted=A.fitDocument(d,now+5000,'4999');
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length<=M.MAX_DOCUMENT_BYTES);
  assert.ok(fitted.activity.events.length<5000);assert.equal(fitted.activity.events.at(-1).id,'4999');assert.equal(fitted.activity.truncationReason,'size');
  assert.deepEqual(d,original);
  const huge=document();huge.extra='x'.repeat(M.MAX_DOCUMENT_BYTES);
  assert.throws(()=>A.fitDocument(huge,now),{code:'too_large'});
});
test('deletion and recreation keep historical entities separate',()=>{
  const activity={startedAt:now,events:[event('old','hard','custom:11111111-1111-4111-8111-111111111111'),event('new','yes','custom:22222222-2222-4222-8222-222222222222')],truncated:false};
  assert.equal(A.summarizeWeek(activity,now).uniqueWords,2);
});
