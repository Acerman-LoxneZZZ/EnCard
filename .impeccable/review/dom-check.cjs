const { JSDOM, VirtualConsole } = require('./runtime/node_modules/jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
let passed = 0;
function setup({saved=null,custom=null,storageFails=false,reduced=false,remote=false}={}) {
  const timers = new Map(), failures = [], media = [], utterances = [], recordings = [];
  let serial = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError',e=>failures.push(e.message));
  const dom = new JSDOM(html,{url:'https://wordflow.test',runScripts:'dangerously',virtualConsole,beforeParse(w){
    w.matchMedia = query => {const m={matches:query.includes('reduced')?reduced:true,addEventListener:(type,fn)=>m.listener=fn};media.push(m);return m;};
    w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
    w.HTMLElement.prototype.setPointerCapture=function(id){this.capture=id;};w.HTMLElement.prototype.hasPointerCapture=function(id){return this.capture===id;};w.HTMLElement.prototype.releasePointerCapture=function(){this.capture=null;};
    Object.defineProperty(w.HTMLElement.prototype,'offsetWidth',{get:()=>480});
    w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:480,height:330});
    w.requestAnimationFrame=fn=>{const id=++serial;timers.set(id,{fn,delay:16});return id;};w.cancelAnimationFrame=id=>timers.delete(id);
    w.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
    w.speechSynthesis={getVoices:()=>[{lang:'en-GB'}],cancel:()=>{},speak:u=>utterances.push(u)};
    w.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
    if(remote){
      w.fetch=async url=>({ok:true,json:async()=>String(url).includes('tatoeba.org')
        ? {data:[{id:12768916,text:'In stillness, we thrive.'}]}
        : {query:{pages:{'1':{title:'File:En-us-thrive.ogg',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/thrive.ogg',descriptionurl:'https://commons.wikimedia.org/wiki/File:En-us-thrive.ogg',extmetadata:{Artist:{value:'Dvortygirl'},LicenseShortName:{value:'CC BY-SA 3.0'}}}]}}}}});
      w.Audio=class{constructor(url){this.url=url;}play(){recordings.push(this.url);return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
    }
    if(saved)w.localStorage.setItem('wordflow.session.v1',JSON.stringify(saved));
    if(custom)w.localStorage.setItem('wordflow.custom-words.v1',JSON.stringify(custom));
    if(storageFails)Object.defineProperty(w,'localStorage',{get(){throw Error('Storage denied');}});
  }});
  const w=dom.window,d=w.document;
  const el=id=>d.getElementById(id),run=code=>w.eval(code),state=()=>JSON.parse(run('JSON.stringify(state)'));
  const flush=()=>{for(const [id,t] of [...timers])if(t.delay<=400){timers.delete(id);t.fn();}};
  const click=id=>el(id).click();
  const rate=kind=>{d.querySelector(`[data-answer="${kind}"]`).click();flush();};
  const key=(code,target=d.body)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{code,key:code==='Escape'?'Escape':code,bubbles:true}));
  const pointer=(type,x,y=100,id=1)=>{const event=new w.Event(type,{bubbles:true});Object.assign(event,{isPrimary:true,button:0,pointerId:id,clientX:x,clientY:y,pointerType:'mouse'});el('front-flip').dispatchEvent(event);};
  assert.deepEqual(failures,[],'no script/runtime exceptions');
  return {w,d,el,run,state,flush,click,rate,key,pointer,failures,utterances,recordings,media,close:()=>w.close()};
}
function test(name,fn){fn();passed++;console.log('PASS '+name);}

test('complete DOM and accessible references',()=>{
 const t=setup();const ids=[...t.d.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
 for(const el of t.d.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]'))for(const a of ['aria-labelledby','aria-describedby','aria-controls'])for(const id of (el.getAttribute(a)||'').split(' ').filter(Boolean))assert.ok(t.el(id),a+' '+id);
 assert.equal(t.state().queue.length,20);assert.equal(t.el('word').textContent,'discover');assert.equal(t.el('session').hidden,false);
 assert.equal(t.d.querySelectorAll('script[src],link[rel="stylesheet"],img[src^="http"]').length,0);
 assert.ok(html.includes('data:font/ttf;base64,'));t.close();
});
test('unknown moves to end; input lock; undo is lossless',()=>{
 const t=setup();t.d.querySelector('[data-answer="no"]').click();t.d.querySelector('[data-answer="yes"]').click();assert.equal(t.state().attempts,1);t.flush();assert.equal(t.state().queue.at(-1),0);assert.equal(t.state().learned.length,0);
 t.click('undo');assert.equal(t.state().queue[0],0);assert.equal(t.state().attempts,0);assert.deepEqual(t.state().difficult,[]);assert.equal(t.el('undo').disabled,true);t.close();
});
test('hard repeats after three other cards; completion stats and undo',()=>{
 const t=setup();t.rate('hard');assert.equal(t.state().queue[3],0);for(let i=0;i<3;i++)t.rate('yes');assert.equal(t.state().queue[0],0);
 while(t.state().queue.length)t.rate('yes');assert.equal(t.el('finish').hidden,false);assert.equal(t.el('hard-count').textContent,'1');assert.equal(t.el('easy-count').textContent,'19');assert.equal(t.el('review-words').children.length,1);assert.equal(t.state().attempts,21);
 t.key('KeyZ');assert.equal(t.state().queue.length,1);assert.equal(t.el('finish').hidden,true);t.rate('hard');assert.equal(t.state().queue.length,1);t.rate('no');assert.equal(t.state().queue.length,1);t.rate('yes');t.click('restart');assert.equal(t.state().queue.length,20);assert.equal(t.state().attempts,0);assert.equal(t.state().streak,0);t.close();
});
test('flip shows accessible translation and focuses correct side',()=>{
 const t=setup();t.click('front-flip');assert.equal(t.el('front').getAttribute('aria-hidden'),'true');assert.equal(t.el('back').getAttribute('aria-hidden'),'false');assert.equal(t.d.activeElement.id,'back-flip');assert.equal(t.el('back-flip').getAttribute('aria-labelledby'),'word transcription');assert.equal(t.el('front-flip').getAttribute('aria-labelledby'),'translation');assert.equal(t.el('letter-hint').hidden,true);assert.equal(t.el('letter-hint').textContent,'');assert.equal(t.el('translation').textContent,'открывать, узнавать');t.click('back-flip');assert.equal(t.d.activeElement.id,'front-flip');t.close();
});
test('library search, filters, empty state, shortcuts isolation and return',()=>{
 const t=setup();t.rate('hard');t.rate('yes');const before=t.state();t.click('open-library');assert.equal(t.el('library').hidden,false);assert.equal(t.el('session').hidden,true);assert.equal(t.el('word-list').children.length,20);
 t.key('ArrowRight');assert.deepEqual(t.state(),before);t.d.querySelector('[data-filter="review"]').click();assert.equal(t.el('word-list').children.length,1);assert.match(t.el('word-list').textContent,/discover/);
 t.el('word-search').value='НЕСУЩЕСТВУЮЩЕЕ';t.el('word-search').dispatchEvent(new t.w.Event('input'));assert.equal(t.el('library-empty').hidden,false);
 t.el('word-search').value='открывать';t.el('word-search').dispatchEvent(new t.w.Event('input'));assert.equal(t.el('word-list').children.length,1);
 t.key('Escape');assert.equal(t.el('library').hidden,true);assert.equal(t.el('session').hidden,false);assert.deepEqual(t.state(),before);t.close();
});
test('keyboard shortcuts isolate navigation',()=>{
 const t=setup();t.key('Digit3');t.flush();assert.equal(t.state().learned.length,1);t.key('KeyZ');assert.equal(t.state().learned.length,0);t.key('Space');assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 t.el('shortcuts-toggle').checked=false;t.el('shortcuts-toggle').dispatchEvent(new t.w.Event('change'));t.key('Digit3');t.flush();assert.equal(t.state().attempts,0);assert.equal(JSON.parse(t.w.localStorage.getItem('wordflow.preferences.v1')).shortcuts,false);
 assert.equal(t.el('close-library').getAttribute('aria-label'),'Вернуться к карточкам');t.close();
});
test('pointer threshold, right swipe, cancellation and left swipe',()=>{
 const t=setup();t.pointer('pointerdown',100);t.pointer('pointermove',108);t.pointer('pointerup',108);t.flush();assert.equal(t.state().attempts,0);
 t.pointer('pointerdown',100);t.pointer('pointermove',260);t.pointer('pointerup',260);t.flush();assert.equal(t.state().learned.length,1);
 t.pointer('pointerdown',250);t.pointer('pointermove',80);t.pointer('pointercancel',80);assert.equal(t.state().attempts,1);
 t.pointer('pointerdown',250);t.pointer('pointermove',80);t.pointer('pointerup',80);t.flush();assert.equal(t.state().queue.at(-1),1);assert.equal(t.state().attempts,2);t.close();
});
test('Russian-first recall, live next-card stack and downward hard swipe',()=>{
 const t=setup();
 assert.equal(t.el('front').getAttribute('aria-hidden'),'false');assert.equal(t.el('translation').closest('.face').id,'front');assert.equal(t.el('word').closest('.face').id,'back');
 assert.equal(t.el('queued-word').textContent,'путешествие');assert.equal(t.el('queued-card').getAttribute('aria-hidden'),'true');
 assert.ok(!t.el('announcement').textContent.includes('discover'));assert.equal(t.d.querySelector('.key-hints'),null);assert.equal(t.d.querySelector('.page-footer'),null);assert.equal(t.el('session-feedback'),null);
 t.pointer('pointerdown',100,100);t.pointer('pointermove',108,260);t.pointer('pointerup',108,260);
 assert.equal(t.state().queue[3],0);assert.equal(t.el('queued-word').textContent,'путешествие');assert.ok(t.el('deck').classList.contains('advancing'));assert.match(t.el('card').style.transform,/translate3d\(0,/);
 t.flush();assert.equal(t.el('translation').textContent,'путешествие');assert.equal(t.el('letter-hint').hidden,true);assert.equal(t.el('letter-hint').textContent,'');assert.equal(t.el('queued-word').textContent,'замечать');
 for(let i=0;i<3;i++)t.rate('yes');assert.equal(t.state().queue[0],0);assert.equal(t.el('translation').textContent,'открывать, узнавать');
 const attempts=t.state().attempts;
 t.pointer('pointerdown',100,100);t.pointer('pointermove',103,245);t.pointer('pointercancel',103,245);assert.equal(t.state().attempts,attempts);assert.equal(t.el('queued-card').style.transform,'');
 t.pointer('pointerdown',100,200);t.pointer('pointermove',100,50);t.pointer('pointerup',100,50);assert.equal(t.state().attempts,attempts);
 t.close();
});
test('hints belong only to hard reviews, survive reload, undo and completion',()=>{
 const t=setup();
 assert.equal(t.el('letter-hint').hidden,true);assert.equal(t.el('queued-hint').hidden,true);
 assert.ok(!t.el('announcement').textContent.includes('Первая буква'));
 assert.equal(t.w.getComputedStyle(t.d.querySelector('.app')).overflow,'clip');
 t.rate('no');assert.deepEqual(t.state().hinted,[]);t.click('undo');
 t.rate('hard');assert.deepEqual(t.state().hinted,[0]);assert.equal(t.el('letter-hint').hidden,true);
 t.rate('yes');t.rate('yes');
 assert.equal(t.el('queued-hint').textContent,'d…');assert.equal(t.el('queued-hint').hidden,false);
 const saved=JSON.parse(t.w.localStorage.getItem('wordflow.session.v1'));
 const restored=setup({saved});assert.equal(restored.el('letter-hint').hidden,true);
 restored.rate('yes');assert.equal(restored.state().queue[0],0);assert.equal(restored.el('letter-hint').hidden,false);assert.equal(restored.el('letter-hint').textContent,'d…');assert.equal(restored.el('front-flip').getAttribute('aria-labelledby'),'translation letter-hint');
 restored.rate('yes');assert.deepEqual(restored.state().hinted,[]);restored.click('undo');assert.deepEqual(restored.state().hinted,[0]);assert.equal(restored.el('letter-hint').hidden,false);restored.close();
 t.click('undo');t.click('open-library');t.click('close-library');t.close();
 const undoHard=setup();undoHard.rate('hard');undoHard.click('undo');assert.deepEqual(undoHard.state().hinted,[]);assert.equal(undoHard.el('letter-hint').hidden,true);undoHard.close();
 const unknown=setup();unknown.rate('no');for(let i=0;i<19;i++)unknown.rate('yes');assert.equal(unknown.state().queue[0],0);assert.equal(unknown.el('letter-hint').hidden,true);assert.equal(unknown.el('letter-hint').hasAttribute('aria-label'),false);unknown.close();
});
test('reduced motion, English speech text and fallback',()=>{
 const t=setup();assert.equal(t.el('effects-toggle'),null);assert.equal(t.el('help-toggle'),null);
 assert.equal(t.d.querySelectorAll('.sound').length,1);assert.equal(t.el('word-sound').hidden,true);
 t.click('front-flip');assert.equal(t.el('word-sound').hidden,false,'sound is available immediately without a timer');
 assert.equal(t.el('word-sound').closest('.face').id,'back','sound belongs to the English face and shares its animation');
 const icon=t.el('word-sound').querySelector('svg');
 for(const type of ['pointerdown','pointerup','click'])icon.dispatchEvent(new t.w.MouseEvent(type,{bubbles:true,button:0}));
 assert.equal(t.utterances.at(-1).text,'discover');assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 t.click('card');assert.equal(t.el('back').getAttribute('aria-hidden'),'false','blank card area cannot flip over the sound control');
 delete t.w.speechSynthesis;t.click('word-sound');assert.match(t.el('toast').textContent,/недоступна/);t.close();
 const reduced=setup({reduced:true});assert.ok(reduced.d.body.classList.contains('effects-off'));reduced.rate('yes');assert.equal(reduced.state().learned.length,1);assert.equal(reduced.el('card').style.opacity,'1');reduced.close();
});
test('custom word is saved, studied and spoken in English',()=>{
 const t=setup();t.click('open-library');t.el('custom-en').value='thrive';t.el('custom-ru').value='процветать';
 t.el('add-word-form').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(t.state().queue.length,21);assert.deepEqual(JSON.parse(t.w.localStorage.getItem('wordflow.custom-words.v1')),[{en:'thrive',ru:'процветать'}]);
 t.click('close-library');for(let i=0;i<20;i++)t.rate('yes');assert.equal(t.el('word').textContent,'thrive');
 t.click('front-flip');t.flush();t.click('word-sound');assert.equal(t.utterances.at(-1).text,'thrive');
 const saved=t.state();t.close();const restored=setup({saved,custom:[{en:'thrive',ru:'процветать'}]});assert.equal(restored.el('word').textContent,'thrive');restored.close();
});
test('old saves migrate; bad saves and storage denial stay usable',()=>{
 const saved={queue:Array.from({length:19},(_,i)=>i+1),learned:[0],difficult:[],attempts:1};
 const t=setup({saved});assert.equal(t.el('word').textContent,'journey');assert.equal(t.state().streak,0);t.rate('yes');assert.equal(t.state().learned.length,2);t.close();
 const bad=setup({saved:{queue:[0,0],learned:[],difficult:[],attempts:0}});assert.equal(bad.state().queue.length,20);bad.close();
 const denied=setup({storageFails:true});assert.match(denied.el('save-note').textContent,/вкладке/);denied.rate('yes');assert.equal(denied.state().learned.length,1);denied.close();
});
test('one pointer tap flips once, subsequent click does not flip again',()=>{
 const t=setup();
 t.pointer('pointerdown',100);t.pointer('pointermove',102);t.pointer('pointerup',102);
 assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 t.el('card').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true,detail:1}));
 assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 t.pointer('pointerdown',100);t.pointer('pointerup',100);
 t.el('front-flip').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true,detail:1}));
 assert.equal(t.el('front').getAttribute('aria-hidden'),'false');
 t.pointer('pointerdown',100);t.pointer('pointercancel',100);
 assert.equal(t.el('front').getAttribute('aria-hidden'),'false');t.close();
});
async function remoteIntegration() {
 const t=setup({remote:true});t.click('open-library');t.el('custom-en').value='thrive';t.el('custom-ru').value='процветать';
 t.el('add-word-form').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
 await new Promise(resolve=>setImmediate(resolve));
 const word=JSON.parse(t.run('JSON.stringify(WORDS.at(-1))'));
 assert.equal(word.example,'In stillness, we thrive.');assert.match(word.audioUrl,/upload\.wikimedia\.org/);
 assert.equal(JSON.parse(t.w.localStorage.getItem('wordflow.custom-words.v1'))[0].example,word.example);
 t.click('close-library');for(let i=0;i<20;i++)t.rate('yes');
 assert.equal(t.el('example').textContent,word.example);assert.equal(t.el('audio-credit').hidden,false);
 t.click('front-flip');t.flush();t.click('word-sound');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.recordings.at(-1),word.audioUrl);assert.equal(t.utterances.length,0);
 assert.deepEqual(t.failures,[]);t.close();passed++;console.log('PASS remote example, recording and persisted metadata');
 console.log(`\n${passed} integration groups passed. DOM/logic checks only; no browser rendering or real audio claimed.`);
}
remoteIntegration().catch(error=>{console.error(error);process.exitCode=1;});
