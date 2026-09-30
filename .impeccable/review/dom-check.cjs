const { JSDOM, VirtualConsole } = require('./runtime/node_modules/jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
let passed = 0;
function setup({saved=null,custom=null,dictionaries=null,storageFails=false,reduced=false,remote=false}={}) {
  const timers = new Map(), failures = [], media = [], utterances = [], recordings = [], requests = [];
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
      w.fetch=async url=>{requests.push(String(url));return {ok:true,json:async()=>({query:{pages:{'1':{title:'File:En-us-thrive.ogg',imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/thrive.ogg',descriptionurl:'https://commons.wikimedia.org/wiki/File:En-us-thrive.ogg',extmetadata:{Artist:{value:'Dvortygirl'},LicenseShortName:{value:'CC BY-SA 3.0'}}}]}}}})};};
      w.Audio=class{constructor(url){this.url=url;}play(){recordings.push(this.url);return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
    }
    if(saved)w.localStorage.setItem('wordflow.session.v1',JSON.stringify(saved));
    if(custom)w.localStorage.setItem('wordflow.custom-words.v1',JSON.stringify(custom));
    if(dictionaries)w.localStorage.setItem('wordflow.collections.v1',JSON.stringify(dictionaries));
    if(storageFails)Object.defineProperty(w,'localStorage',{get(){throw Error('Storage denied');}});
  }});
  const w=dom.window,d=w.document;
  const el=id=>d.getElementById(id),run=code=>w.eval(code),state=()=>JSON.parse(run('JSON.stringify(state)'));
  const flush=()=>{for(const [id,t] of [...timers])if(t.delay<=650){timers.delete(id);t.fn();}};
  const click=id=>el(id).click();
  const rate=kind=>{d.querySelector(`[data-answer="${kind}"]`).click();flush();};
  const key=(code,target=d.body)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{code,key:code==='Escape'?'Escape':code,bubbles:true}));
  const pointer=(type,x,y=100,id=1)=>{const event=new w.Event(type,{bubbles:true});Object.assign(event,{isPrimary:true,button:0,pointerId:id,clientX:x,clientY:y,pointerType:'mouse'});el('front-flip').dispatchEvent(event);};
  assert.deepEqual(failures,[],'no script/runtime exceptions');
  return {w,d,el,run,state,flush,click,rate,key,pointer,failures,utterances,recordings,requests,media,close:()=>w.close()};
}
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function submit(t,id){t.el(id).dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));}
function createDictionary(t,name){t.click('new-collection');t.el('collection-name').value=name;submit(t,'collection-editor');return t.el('collection-select').value;}
function chooseDictionary(t,id){t.click('collection-select');const option=t.el('dictionary-menu').querySelector(`[data-collection-id="${id}"]`);assert.ok(option);option.click();}
function pickWord(t,id){const input=t.el('picker-list').querySelector(`input[value="${id}"]`);assert.ok(input,'word available in picker');input.checked=true;input.dispatchEvent(new t.w.Event('change',{bubbles:true}));}

test('dictionary menu stays selectable through browser scroll and viewport resize',()=>{
 const t=setup();t.click('open-library');createDictionary(t,'Мой словарь');t.click('open-word-picker');pickWord(t,0);t.click('add-picked');t.click('study-collection');
 let pageScrollCalls=0;t.w.HTMLElement.prototype.scrollIntoView=()=>{pageScrollCalls++;t.w.dispatchEvent(new t.w.Event('scroll'));};
 t.click('active-collection');
 for(const event of ['scroll','resize','scroll'])t.w.dispatchEvent(new t.w.Event(event));
 assert.equal(t.el('dictionary-menu').hidden,false);assert.equal(t.el('active-collection').getAttribute('aria-expanded'),'true');assert.equal(pageScrollCalls,0);
 const option=t.el('dictionary-menu').querySelector('[data-collection-id="all"]');
 option.dispatchEvent(new t.w.Event('pointerdown',{bubbles:true}));option.focus();option.dispatchEvent(new t.w.Event('pointerup',{bubbles:true}));option.click();
 assert.equal(t.el('active-collection-name').textContent,'Общий словарь');assert.equal(t.el('dictionary-menu').hidden,true);assert.equal(t.state().queue.length,20);t.close();
});

test('examples and sample placeholders are absent, including legacy custom-word content',()=>{
 const t=setup({custom:[{en:'thrive',ru:'процветать',example:'Legacy sentence.',exampleSource:'https://tatoeba.org/1'}]});
 assert.equal(t.d.querySelector('#example, #example-ru, #example-source'),null);
 for(const id of ['custom-en','custom-ru','collection-name'])assert.equal(t.el(id).hasAttribute('placeholder'),false);
 assert.equal(t.el('back-flip').getAttribute('aria-describedby'),'back-hint');
 assert.equal(t.run('typeof lookupExample'),'undefined');assert.equal(t.run('WORDS.some(word => Boolean(word.example))'),false);
 t.click('front-flip');t.click('word-sound');assert.equal(t.utterances.at(-1).text,'discover');t.close();
});

test('custom dictionary chooser supports keyboard, dismissal and narrow viewport bounds',()=>{
 const t=setup();t.click('open-library');const id=createDictionary(t,'Работа');
 assert.equal(t.el('collection-select').tagName,'BUTTON');
 t.click('collection-select');assert.equal(t.el('dictionary-menu').hidden,false);assert.equal(t.el('collection-select').getAttribute('aria-expanded'),'true');
 assert.equal(t.d.activeElement.dataset.collectionId,id);assert.equal(t.d.activeElement.getAttribute('aria-selected'),'true');
 const key=key=>t.d.activeElement.dispatchEvent(new t.w.KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true}));
 key('Home');assert.equal(t.d.activeElement.dataset.collectionId,'all');key('End');assert.equal(t.d.activeElement.dataset.collectionId,id);
 key('Escape');assert.equal(t.el('dictionary-menu').hidden,true);assert.equal(t.d.activeElement.id,'collection-select');assert.equal(t.el('library').hidden,false);
 key('ArrowDown');assert.equal(t.el('dictionary-menu').hidden,false);key('Tab');assert.equal(t.el('dictionary-menu').hidden,true);
 Object.defineProperty(t.w,'innerWidth',{value:320,configurable:true});t.click('collection-select');
 assert.ok(parseFloat(t.el('dictionary-menu').style.width)<=288);assert.ok(parseFloat(t.el('dictionary-menu').style.left)>=16);
 t.d.body.dispatchEvent(new t.w.Event('pointerdown',{bubbles:true}));assert.equal(t.el('dictionary-menu').hidden,true);t.close();
});

test('study chip switches dictionaries directly and preserves finished and unfinished progress',()=>{
 const t=setup();t.click('open-library');const id=createDictionary(t,'Работа');t.click('open-word-picker');pickWord(t,0);pickWord(t,1);t.click('add-picked');t.click('study-collection');t.rate('yes');const progress=t.state();
 const quick=id=>{t.click('active-collection');t.el('dictionary-menu').querySelector(`[data-collection-id="${id}"]`).click();};
 quick('all');assert.equal(t.el('library').hidden,true);assert.equal(t.el('active-collection').hidden,false);assert.equal(t.state().queue.length,20);
 quick(id);assert.deepEqual(t.state(),progress);assert.equal(t.el('library').hidden,true);
 t.rate('yes');assert.equal(t.el('finish').hidden,false);quick('all');quick(id);
 assert.equal(t.el('finish').hidden,false,'quick selection never resets a completed dictionary');assert.deepEqual(t.state().learned,[0,1]);
 t.click('open-library');const empty=createDictionary(t,'Пустой');t.click('close-library');quick(empty);
 assert.equal(t.el('library').hidden,false);assert.equal(t.el('collection-select').value,empty);assert.equal(t.el('study-collection').disabled,true);t.close();
});

test('screen navigation settles once, supports interruption and respects reduced motion',()=>{
 const t=setup(), animations=[];
 t.el('screen-stage').animate=(frames,options)=>{const a={frames,options,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animations.push(a);return a;};
 t.click('open-library');assert.equal(t.el('screen-stage').inert,true);assert.equal(t.el('library').hidden,true);assert.equal(animations.length,1);
 t.key('ArrowRight');assert.equal(t.state().attempts,0);t.click('open-library');assert.equal(animations.length,1);
 animations[0].onfinish();assert.equal(t.el('screen-stage').inert,false);assert.equal(t.el('library').hidden,false);assert.equal(t.d.activeElement.id,'library-title');
 t.click('close-library');assert.equal(animations[1].cancelled,true);assert.equal(animations[1].onfinish,null);assert.equal(t.el('screen-stage').inert,true);
 t.media[0].matches=true;t.media[0].listener();assert.equal(animations[2].cancelled,true);assert.equal(t.el('screen-stage').inert,false);assert.equal(t.el('library').hidden,true);
 const count=animations.length;t.click('open-library');assert.equal(t.el('library').hidden,false);assert.equal(animations.length,count);
 assert.deepEqual(t.failures,[]);t.close();
});

test('named dictionaries persist separate progress and preserve the legacy general session',()=>{
 const t=setup();t.rate('yes');const general=t.state();t.click('open-library');
 const id=createDictionary(t,'Путешествия');assert.notEqual(id,'all');assert.equal(t.el('study-collection').disabled,true);assert.equal(t.el('word-list').children.length,0);
 t.click('open-word-picker');pickWord(t,0);pickWord(t,1);t.click('add-picked');
 assert.equal(t.el('word-list').children.length,2);assert.equal(t.el('study-collection').disabled,false);
 t.click('study-collection');assert.equal(t.el('library').hidden,true);assert.deepEqual(t.state().queue,[0,1]);assert.equal(t.el('learned-count').textContent,'0 из 2');
 t.rate('hard');t.rate('yes');assert.deepEqual(t.state().queue,[0]);assert.deepEqual(t.state().hinted,[0]);
 assert.deepEqual(JSON.parse(t.w.localStorage.getItem('wordflow.session.v1')),general);
 const persisted=JSON.parse(t.w.localStorage.getItem('wordflow.collections.v1'));
 const restored=setup({saved:general,dictionaries:persisted});
 assert.equal(restored.el('active-collection-name').textContent,'Путешествия');assert.deepEqual(restored.state(),t.state());assert.equal(restored.el('letter-hint').textContent,'d…');
 restored.click('open-library');chooseDictionary(restored,'all');restored.click('study-collection');assert.deepEqual(restored.state(),general);
 restored.click('open-library');chooseDictionary(restored,id);restored.click('study-collection');restored.rate('yes');
 assert.equal(restored.el('finish').hidden,false);assert.equal(restored.el('easy-count').textContent,'1');assert.equal(restored.el('hard-count').textContent,'1');
 restored.click('restart');assert.deepEqual(restored.state().queue,[0,1]);assert.equal(restored.state().attempts,0);
 t.close();restored.close();
});

test('new words live in general and selected dictionary; existing words are shared without duplicates',()=>{
 const t=setup();t.click('open-library');const first=createDictionary(t,'Работа');
 t.el('custom-en').value='thrive';t.el('custom-ru').value='процветать';submit(t,'add-word-form');
 assert.equal(t.el('word-list').children.length,1);assert.match(t.el('word-list').textContent,/thrive/);
 assert.equal(t.run('WORDS.length'),21);assert.deepEqual(JSON.parse(t.run('JSON.stringify(collectionWordIds("all"))')),Array.from({length:21},(_,i)=>i));
 const second=createDictionary(t,'Личное');t.el('custom-en').value='THRIVE';t.el('custom-ru').value='другой перевод';submit(t,'add-word-form');
 assert.equal(t.run('WORDS.length'),21);assert.match(t.el('word-list').textContent,/процветать/);
 t.click('study-collection');assert.deepEqual(t.state().queue,[20]);t.click('front-flip');t.click('word-sound');assert.equal(t.utterances.at(-1).text,'thrive');
 t.click('open-library');t.d.querySelector('.remove-membership').click();assert.equal(t.el('word-list').children.length,0);assert.equal(t.el('study-collection').disabled,true);
 t.click('close-library');assert.equal(t.el('library').hidden,false,'empty active deck stays editable');
 chooseDictionary(t,first);assert.equal(t.el('word-list').children.length,1);
 chooseDictionary(t,'all');assert.equal(t.el('word-list').children.length,21);
 const dictionaries=JSON.parse(t.w.localStorage.getItem('wordflow.collections.v1'));
 const saved=JSON.parse(t.w.localStorage.getItem('wordflow.session.v1')),custom=JSON.parse(t.w.localStorage.getItem('wordflow.custom-words.v1'));
 const restored=setup({dictionaries,saved,custom});assert.equal(restored.el('library').hidden,false);assert.equal(restored.el('collection-select').value,second);
 chooseDictionary(restored,first);assert.match(restored.el('word-list').textContent,/thrive/);assert.equal(restored.run('WORDS.length'),21);
 t.close();restored.close();
});

test('picker retains selections across search; rename is safe and does not reset progress',()=>{
 const t=setup();t.click('open-library');const id=createDictionary(t,'Тема');t.click('open-word-picker');pickWord(t,0);
 t.el('picker-search').value='journey';t.el('picker-search').dispatchEvent(new t.w.Event('input'));pickWord(t,1);
 assert.match(t.el('add-picked').textContent,/2/);t.click('add-picked');t.click('study-collection');t.rate('yes');const progress=t.state();
 t.click('open-library');t.click('rename-collection');t.el('collection-name').value='<img src=x onerror=alert(1)>';submit(t,'collection-editor');
 assert.equal(t.el('collection-select').value,id);assert.equal(t.el('collection-title').textContent,'<img src=x onerror=alert(1)>');assert.equal(t.el('collection-title').children.length,0);
 assert.deepEqual(t.state(),progress);t.click('new-collection');t.el('collection-name').value='<img src=x onerror=alert(1)>';submit(t,'collection-editor');
 assert.match(t.el('toast').textContent,/уже есть/);assert.equal(t.run('collections.length'),1);
 t.click('cancel-collection');t.click('open-word-picker');assert.equal(t.el('picker-list').querySelector('input[value="0"]'),null);assert.equal(t.el('picker-list').querySelector('input[value="1"]'),null);
 t.close();
});

test('dictionary corruption and denied storage leave general words and progress usable',()=>{
 const dictionaries={activeId:'deck-valid',items:[null,{id:'all',name:'Fake',wordIds:[]},{id:'deck-valid',name:'Saved',wordIds:[0,0,1,999,-1,'2']},{id:'deck-valid',name:'Duplicate',wordIds:[2]}],sessions:{'deck-valid':{queue:[0,0,999],learned:[1,999],difficult:[0,99],hinted:[0,999],attempts:3}}};
 const t=setup({dictionaries});assert.deepEqual(t.state().queue,[0]);assert.deepEqual(t.state().learned,[1]);assert.deepEqual(t.state().hinted,[0]);assert.equal(t.run('collections.length'),1);
 t.click('open-library');chooseDictionary(t,'all');assert.equal(t.el('word-list').children.length,20);t.close();
 const denied=setup({storageFails:true});denied.click('open-library');createDictionary(denied,'Не сохранится');assert.equal(denied.run('collections.length'),0);assert.match(denied.el('toast').textContent,/Не удалось сохранить/);assert.equal(denied.el('word-list').children.length,20);denied.close();
});

test('two-stage flip hides underlying text, keeps audio attached and cancels safely',()=>{
 const t=setup(), animations=[];
 t.el('card-inner').animate=(frames,options)=>{
   const animation={frames,options,onfinish:null,cancelled:false,cancel(){this.cancelled=true;}};
   animations.push(animation);return animation;
 };
 const style=element=>t.w.getComputedStyle(element);
 assert.equal(style(t.el('back')).display,'none');
 assert.equal(style(t.el('queued-word')).visibility,'hidden');
 assert.equal(style(t.d.querySelector('.deck-viewport')).overflow,'hidden');
 assert.equal(style(t.d.querySelector('.deck-viewport')).contain,'paint');
 assert.equal(style(t.el('card-inner')).height,'380px');
 t.pointer('pointerdown',100);t.pointer('pointerup',100);
 assert.equal(animations[0].options.duration,320);
 assert.equal(t.el('front').getAttribute('aria-hidden'),'false','outgoing face stays visible until edge-on');
 assert.equal(style(t.el('back')).display,'none');
 assert.ok(t.el('deck').classList.contains('turning'));
 t.pointer('pointerdown',100);t.pointer('pointerup',100);
 assert.equal(animations.length,1,'second tap cannot restart a running flip');
 animations[0].onfinish();
 assert.equal(animations[1].options.duration,480);
 assert.equal(style(t.el('front')).display,'none');
 assert.equal(t.el('word-sound').hidden,false);
 assert.equal(t.el('word-sound').closest('.face').id,'back');
 assert.equal(style(t.el('queued-word')).visibility,'hidden');
 animations[1].onfinish();
 assert.equal(t.el('deck').classList.contains('turning'),false);
 t.click('word-sound');assert.equal(t.utterances.at(-1).text,'discover');
 assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 t.click('back-flip');const interrupted=animations.at(-1);
 t.rate('hard');assert.ok(interrupted.cancelled);assert.equal(interrupted.onfinish,null);
 assert.equal(t.el('front').getAttribute('aria-hidden'),'false');
 assert.equal(t.el('deck').classList.contains('turning'),false);
 assert.equal(t.el('card').style.opacity,'1','card stays opaque over the next word');
 t.click('front-flip');
 t.media[0].matches=true;t.media[0].listener();
 assert.equal(t.run('flipping'),false,'reduced motion settles a running flip');
 assert.equal(t.el('back').getAttribute('aria-hidden'),'false');
 assert.deepEqual(t.failures,[]);t.close();
});

test('complete DOM and accessible references',()=>{
 const t=setup();const ids=[...t.d.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
 for(const el of t.d.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]'))for(const a of ['aria-labelledby','aria-describedby','aria-controls'])for(const id of (el.getAttribute(a)||'').split(' ').filter(Boolean))assert.ok(t.el(id),a+' '+id);
 assert.equal(t.state().queue.length,20);assert.equal(t.el('word').textContent,'discover');assert.equal(t.el('session').hidden,false);
 assert.equal(t.d.querySelectorAll('script[src],link[rel="stylesheet"],img[src^="http"]').length,0);
 assert.ok(html.includes('data:font/ttf;base64,'));t.close();
});
test('unknown moves to end; input lock; undo is lossless',()=>{
 const t=setup();t.d.querySelector('[data-answer="no"]').click();t.d.querySelector('[data-answer="yes"]').click();assert.equal(t.state().attempts,1);assert.match(t.el('card').style.transition,/510ms/);assert.equal(t.el('deck').style.getPropertyValue('--exit-duration'),'510ms');t.flush();assert.equal(t.state().queue.at(-1),0);assert.equal(t.state().learned.length,0);
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
 assert.match(t.el('card').style.transition,/600ms/);
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
 assert.equal(word.example,undefined);assert.match(word.audioUrl,/upload\.wikimedia\.org/);
 assert.equal(JSON.parse(t.w.localStorage.getItem('wordflow.custom-words.v1'))[0].audioUrl,word.audioUrl);
 assert.ok(t.requests.length>0);assert.ok(t.requests.every(url=>url.startsWith('https://commons.wikimedia.org/')),'only pronunciation metadata is requested');
 t.click('close-library');for(let i=0;i<20;i++)t.rate('yes');
 assert.equal(t.el('example'),null);assert.equal(t.el('audio-credit').hidden,false);
 t.click('front-flip');t.flush();t.click('word-sound');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.recordings.at(-1),word.audioUrl);assert.equal(t.utterances.length,0);
 assert.deepEqual(t.failures,[]);t.close();passed++;console.log('PASS remote recording and persisted metadata without sentence requests');
 console.log(`\n${passed} integration groups passed. DOM/logic checks only; no browser rendering or real audio claimed.`);
}
remoteIntegration().catch(error=>{console.error(error);process.exitCode=1;});
