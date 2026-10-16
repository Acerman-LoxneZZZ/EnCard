import {DATA_KEYS,cacheKey,canonical,valuesFromDocument,chooseSnapshot,acknowledge,alignPrunedSnapshot} from './profile-sync.js';
import {verifyTelegram} from './telegram-auth.js';

const element=id=>document.getElementById(id);
let cache=null,remote=null,initData='',userId='',ready=false,paused=false,inFlight=false,timer=0,storageOk=true;
const gate=document.createElement('section');
gate.className='telegram-gate'; gate.id='telegram-gate';
gate.innerHTML='<div class="brand">wordflow</div><h1 id="gate-title">Загружаем ваш профиль</h1><p id="gate-message" role="status">Проверяем вход через Telegram…</p><a class="profile-link" id="gate-open" href="https://t.me/WordsENRUbot" hidden>Открыть в Telegram</a><button class="profile-action" id="gate-retry" hidden>Попробовать снова</button>';
document.body.append(gate);
element('gate-retry').addEventListener('click',()=>location.reload());

function read(key) {try {return JSON.parse(localStorage.getItem(key));} catch {return null;}}
function write(key,value) {try {localStorage.setItem(key,JSON.stringify(value)); storageOk=true; return true;} catch {storageOk=false; return false;}}
function snapshot() {return JSON.parse(canonical(window.WordflowData.snapshot()));}
function persist(capture=true) {if(ready && capture) cache.document=snapshot(); write(cacheKey(userId),cache);}
function recover(label,value) {return write(`wordflow.recovery.${userId}.${label}.${Date.now()}`,value);}
function documentFromValues(values,base=cache.document) {
  return window.WordflowModel.normalizeDocument({format:'wordflow-backup',version:values[DATA_KEYS[4]]?2:1,
    builtinWords:base?.builtinWords || window.WordflowModel.BUILTIN_WORDS,
    customWords:JSON.parse(values[DATA_KEYS[0]] || '[]'),session:JSON.parse(values[DATA_KEYS[1]] || '{}'),
    collections:JSON.parse(values[DATA_KEYS[2]] || '{"items":[],"activeId":"all","sessions":{}}'),
    preferences:JSON.parse(values[DATA_KEYS[3]] || '{"effects":true,"shortcuts":true}'),
    ...(values[DATA_KEYS[4]]?{activity:JSON.parse(values[DATA_KEYS[4]])}:{})},Date.now());
}
function status(state,message) {
  const line=element('profile-sync-status'); if(!line) return;
  line.dataset.state=state; line.textContent=message;
  const trigger=element('open-profile'); trigger.dataset.state=state; trigger.title=message;
  trigger.setAttribute('aria-label',`Профиль: ${message}`);
  element('profile-status-caption').textContent=!storageOk?'Память устройства недоступна. Сохраните копию словарей перед закрытием.':cache.updatedAt?`Последнее сохранение: ${new Date(cache.updatedAt).toLocaleString('ru-RU')}`:'Изменения сохраняются в вашем Telegram-профиле.';
  element('profile-refresh').disabled=inFlight || paused;
}
function pendingStatus() {status(navigator.onLine?'pending':'offline',navigator.onLine?'Изменения сохранены на устройстве. Ожидают синхронизации.':'Без интернета. Изменения сохраняются на устройстве.');}
function schedule(capture=true,persistCache=true) {if(!ready) return; cache.dirty=true;if(persistCache) persist(capture); updateStats(); pendingStatus(); clearTimeout(timer); timer=setTimeout(sync,700);}
function legacy() {
  const values={}; try {DATA_KEYS.forEach(key=>{const value=localStorage.getItem(key); if(value!==null) values[key]=value;});} catch {}
  try {const custom=JSON.parse(values[DATA_KEYS[0]] || '[]'),session=JSON.parse(values[DATA_KEYS[1]] || '{}'),decks=JSON.parse(values[DATA_KEYS[2]] || '{}');
    return custom.length || session.attempts || decks.items?.length ? values : null;
  } catch {return null;}
}
const legacyValues=legacy();

async function api(method='GET',payload) {
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('/api/profile',{method,signal:controller.signal,cache:'no-store',headers:{Authorization:`tma ${initData}`,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    const data=await response.json(); if(!response.ok) throw Object.assign(new Error(data.message || 'Не удалось синхронизировать данные.'),{status:response.status,code:data.error});
    return data;
  } finally {clearTimeout(timeout);}
}
async function loadTelegram() {
  if(!window.Telegram?.WebApp) await new Promise(resolve=>{
    const sdk=document.createElement('script'); sdk.src='https://telegram.org/js/telegram-web-app.js';
    const timeout=setTimeout(resolve,4000); sdk.onload=sdk.onerror=()=>{clearTimeout(timeout);resolve();}; document.head.append(sdk);
  });
  initData=window.Telegram?.WebApp?.initData || new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || '';
  try {const user=JSON.parse(new URLSearchParams(initData).get('user')); if(Number.isSafeInteger(user.id) && user.id>0) userId=String(user.id);} catch {}
}
function gateMessage(title,message,{open=false,retry=false}={}) {
  element('gate-title').textContent=title; element('gate-message').textContent=message;
  element('gate-open').hidden=!open; element('gate-retry').hidden=!retry;
}
function updateStats() {
  if(!ready) return; const data=snapshot();
  element('profile-custom-count').textContent=data.customWords.length;
  element('profile-learned-count').textContent=data.session.learned.length;
  element('profile-deck-count').textContent=data.collections.items.length;
  updateWeeklyStats(data);
}
function updateWeeklyStats(data) {
  const weekly=element('profile-weekly');if(!weekly || !window.WordflowData.getWeeklyStats) return;
  const stats=window.WordflowData.getWeeklyStats();
  element('profile-weekly-empty').hidden=stats.answers>0;
  element('profile-weekly-content').hidden=stats.answers===0;
  element('profile-active-days').textContent=stats.activeDays;
  element('profile-unique-words').textContent=stats.uniqueWords;
  element('profile-answer-count').textContent=stats.answers;
  const dateLabel=date=>{const [y,m,d]=date.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});};
  const max=Math.max(1,...stats.days.map(day=>day.answers));
  const chart=element('profile-week-chart');chart.replaceChildren();
  stats.days.forEach(day=>{
    const column=document.createElement('div');column.className='profile-week-day';
    const amount=document.createElement('span');amount.className='profile-week-amount';amount.textContent=day.answers;
    const track=document.createElement('span');track.className='profile-week-track';track.setAttribute('aria-hidden','true');
    const bar=document.createElement('span');bar.className='profile-week-bar';bar.style.height=`${day.answers/max*100}%`;track.append(bar);
    const label=document.createElement('span');label.className='profile-week-date';label.textContent=dateLabel(day.date);
    column.append(amount,track,label);chart.append(column);
  });
  chart.setAttribute('aria-label',stats.days.map(day=>`${dateLabel(day.date)}: ${day.answers} ответов`).join('; '));
  element('profile-weekly-period').textContent=`${dateLabel(stats.days[0].date)} — ${dateLabel(stats.days[6].date)}`;
  const started=new Date(stats.startedAt).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  element('profile-history-start').textContent=`История занятий собирается с ${started}.`;
  const limit=element('profile-history-limit');limit.hidden=!stats.truncated;
  limit.textContent=stats.truncationReason==='count'?'Показана часть истории: учтены последние 5000 ответов.':'Показана часть истории: достигнут лимит хранения.';
  const list=element('profile-difficult-words');list.replaceChildren();
  element('profile-difficult-heading').hidden=stats.difficultWords.length===0;
  const existing=new Set(data.builtinWords.flatMap((en,id)=>data.collections.deletedBuiltinIds?.includes(id)?[]:[window.WordflowModel.wordKey(data,id)]));
  data.customWords.forEach((word,index)=>existing.add(window.WordflowModel.wordKey(data,data.builtinWords.length+index)));
  stats.difficultWords.forEach(word=>{
    const item=document.createElement('li'),body=document.createElement(existing.has(word.wordKey)?'button':'div');body.className='profile-difficult-word';
    if(body.tagName==='BUTTON') {body.type='button';body.setAttribute('aria-label',`Открыть слово ${word.en}`);body.addEventListener('click',()=>window.WordflowData.openWordByKey(word.wordKey));}
    const labels=document.createElement('span'),en=document.createElement('strong'),ru=document.createElement('span'),count=document.createElement('span');
    en.textContent=word.en;ru.textContent=word.ru;ru.className='profile-difficult-translation';labels.append(en,ru);
    count.className='profile-difficult-count';count.textContent=word.count;count.setAttribute('aria-label',`${word.count} ответов «Не знаю» и «Трудно»`);
    body.append(labels,count);item.append(body);list.append(item);
  });
}
function showProfile(open=true) {
  if(open) {window.WordflowData.closeOverlays?.();window.WordflowData.closeViews();}
  element('profile-panel').hidden=!open; element('screen-stage').hidden=open;
  document.body.classList.toggle('profile-open',open);
  element('open-profile').setAttribute('aria-expanded',String(open));
  const back=window.Telegram?.WebApp?.BackButton;
  if(open) {updateStats(); back?.show(); element('profile-heading').focus();}
  else {back?.hide(); element('open-profile').focus();}
  window.scrollTo({top:0,behavior:'instant'});
}
function showConflict() {
  paused=true; clearTimeout(timer);
  element('profile-conflict').hidden=false;
  const local=snapshot(),cloud=remote?.document;
  element('profile-conflict-detail').textContent=`На этом устройстве: ${local.customWords.length} собственных слов. В облаке: ${cloud?.customWords.length || 0}. Выберите копию; предыдущую сохраним на устройстве.`;
  status('conflict','На другом устройстве появились изменения. Выберите копию.'); showProfile();
}
async function sync() {
  clearTimeout(timer);
  if(!ready || paused || inFlight) return;
  if(!navigator.onLine) {pendingStatus();return;}
  inFlight=true; status('pending','Сохраняем изменения…');
  try {
    if(cache.dirty) {
      const sent=snapshot();
      const aligned=alignPrunedSnapshot(cache,sent);
      if(aligned!==cache) {
        if(!write(cacheKey(userId),aligned)) {status('error','Не удалось сохранить изменения. Освободите память устройства и повторите синхронизацию.');return;}
        cache=aligned;
      }
      const response=await api('PUT',{revision:cache.revision,document:sent});
      cache=acknowledge(cache,sent,response,snapshot()); persist();
      if(cache.dirty) {timer=setTimeout(sync,700);pendingStatus();}
      else status('saved','Слова и прогресс сохранены в профиле.');
    } else {
      remote=await api();
      // Editing may start while a background read is in progress.
      if(cache.dirty) {
        if(remote.revision!==cache.revision) showConflict();
        else {timer=setTimeout(sync,700);pendingStatus();}
      } else if(remote.revision!==cache.revision) {
        if(!recover('before-cloud-refresh',cache)) {paused=true;status('error','Не удалось сохранить резервную копию. Освободите память устройства.');return;}
        cache=chooseSnapshot(null,remote).cache; persist(false); location.reload();
      } else status('saved','Слова и прогресс сохранены в профиле.');
    }
  } catch(error) {
    if(error.code==='update_required') {paused=true;status('error',error.message);}
    else if(error.status===409) {try {remote=await api();showConflict();} catch {pendingStatus();timer=setTimeout(sync,10000);}}
    else if(error.status===401) {paused=true;status('error','Вход устарел. Закройте приложение и откройте его через бота.');}
    else if(error.status===400 || error.status===413) {paused=true;status('error',error.message);}
    else {pendingStatus();timer=setTimeout(sync,10000);}
  } finally {inFlight=false; const button=element('profile-refresh');if(button) button.disabled=paused;}
}
function mountProfile() {
  const nav=document.querySelector('.header-actions');
  nav.insertAdjacentHTML('beforeend','<button type="button" class="profile-button" id="open-profile" aria-label="Профиль" aria-controls="profile-panel" aria-expanded="false"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></button>');
  element('screen-stage').insertAdjacentHTML('beforebegin',`<section class="profile-panel" id="profile-panel" hidden aria-labelledby="profile-heading">
    <div class="profile-title"><button type="button" class="profile-back" id="profile-back" aria-label="Вернуться к карточкам"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg></button><h1 id="profile-heading" tabindex="-1">Профиль</h1></div>
    <div class="profile-person"><span class="profile-avatar" id="profile-avatar" aria-hidden="true"></span><div><h2 id="profile-name"></h2><p>Ваш аккаунт Telegram</p></div></div>
    <dl class="profile-stats"><div><dt>Своих слов</dt><dd id="profile-custom-count">0</dd></div><div><dt>Выучено</dt><dd id="profile-learned-count">0</dd></div><div><dt>Словарей</dt><dd id="profile-deck-count">0</dd></div></dl>
    <section class="profile-weekly" id="profile-weekly" aria-labelledby="profile-weekly-heading">
      <h2 id="profile-weekly-heading">За последние 7 дней</h2><p class="profile-weekly-period" id="profile-weekly-period"></p>
      <p class="profile-weekly-empty" id="profile-weekly-empty">Статистика появится после первого занятия</p>
      <div id="profile-weekly-content" hidden>
        <div class="profile-week-chart" id="profile-week-chart" role="img"></div>
        <dl class="profile-week-totals"><div><dt>Дней занятий</dt><dd id="profile-active-days">0</dd></div><div><dt>Повторено слов</dt><dd id="profile-unique-words">0</dd></div><div><dt>Ответов</dt><dd id="profile-answer-count">0</dd></div></dl>
        <h3 id="profile-difficult-heading">Самые трудные слова</h3><ol class="profile-difficult-list" id="profile-difficult-words"></ol>
      </div>
      <p class="profile-history-note" id="profile-history-start"></p><p class="profile-history-limit" id="profile-history-limit" hidden></p>
    </section>
    <p class="profile-sync" id="profile-sync-status" role="status"></p><p class="profile-status-line" id="profile-status-caption"></p>
    <button type="button" class="profile-action" id="profile-refresh" style="margin-top:20px">Синхронизировать</button>
    <div class="profile-note" id="profile-conflict" hidden><h3>Две разные копии</h3><p id="profile-conflict-detail"></p><button type="button" class="profile-action" id="profile-keep-local">Сохранить эту копию</button><button type="button" class="profile-action" id="profile-use-cloud">Загрузить облачную</button></div>
    <div class="profile-note" id="profile-legacy" hidden><h3>Прежние данные на устройстве</h3><p>Можно перенести их в профиль. Это заменит его текущие словари и прогресс; перед заменой сохраним обе копии на устройстве.</p><button type="button" class="profile-action" id="profile-import-legacy">Перенести в профиль</button><button type="button" class="profile-action" id="profile-dismiss-legacy">Оставить как есть</button></div>
    <p class="profile-status-line">Копию слов и прогресса можно сохранить в разделе «Словари» → «Перенести словари».</p>
    <button type="button" class="profile-action" id="profile-download-recovery" style="margin-top:16px" hidden>Скачать предыдущую копию</button>
  </section>`);
  element('profile-name').textContent=cache.profile.name;
  element('profile-avatar').textContent=cache.profile.name.slice(0,1).toUpperCase();
  if(cache.profile.avatar && /^https:\/\//.test(cache.profile.avatar)) {
    const image=new Image();image.alt='';image.src=cache.profile.avatar;image.className='profile-avatar';image.referrerPolicy='no-referrer';
    image.onload=()=>element('profile-avatar').replaceChildren(image);
    const small=image.cloneNode();small.className='';small.onerror=()=>small.remove();element('open-profile').append(small);
    small.onload=()=>{const icon=element('open-profile').querySelector('svg');if(icon)icon.remove();};
  }
  element('open-profile').addEventListener('click',()=>showProfile(element('profile-panel').hidden));
  const handleBack=()=>{if(element('profile-panel').hidden) return false;if(window.WordflowData.closeOverlays?.()) return true;showProfile(false);return true;};
  window.WordflowProfile={isOpen:()=>!element('profile-panel').hidden,open:()=>showProfile(true),close:()=>showProfile(false),handleBack};
  element('profile-back').addEventListener('click',handleBack);
  element('open-library').addEventListener('click',()=>{if(!element('profile-panel').hidden) showProfile(false);},true);
  window.addEventListener('keydown',event=>{if(!element('profile-panel').hidden && !document.querySelector('dialog[open]')) {event.stopImmediatePropagation();if(event.key==='Escape') {event.preventDefault();handleBack();}}},true);
  element('profile-refresh').addEventListener('click',sync);
  let recovery;
  try {
    const key=Object.keys(localStorage).filter(key=>key.startsWith(`wordflow.recovery.${userId}.`)).sort((a,b)=>Number(b.split('.').at(-1))-Number(a.split('.').at(-1)))[0];
    if(key) recovery=read(key);
  } catch {}
  if(recovery) element('profile-download-recovery').hidden=false;
  element('profile-download-recovery').addEventListener('click',()=>{
    const values=recovery.values || recovery;
    const data=recovery.document || {format:'wordflow-backup',version:values[DATA_KEYS[4]]?2:1,builtinWords:snapshot().builtinWords,
      customWords:JSON.parse(values[DATA_KEYS[0]] || '[]'),session:JSON.parse(values[DATA_KEYS[1]] || '{}'),
      collections:JSON.parse(values[DATA_KEYS[2]] || '{}'),preferences:JSON.parse(values[DATA_KEYS[3]] || '{"effects":true,"shortcuts":true}'),
      ...(values[DATA_KEYS[4]]?{activity:JSON.parse(values[DATA_KEYS[4]])}:{})};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='wordflow-previous.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  element('profile-keep-local').addEventListener('click',async()=>{
    const button=element('profile-keep-local');button.disabled=true;
    try {remote=await api();if(!recover('cloud-conflict',remote)) {status('error','Не удалось сохранить резервную копию. Освободите память устройства.');return;}cache.revision=remote.revision;cache.dirty=true;persist();paused=false;element('profile-conflict').hidden=true;sync();}
    catch {status('conflict','Не удалось проверить облачную копию. Попробуйте при подключении к сети.');}
    finally {button.disabled=false;}
  });
  element('profile-use-cloud').addEventListener('click',async()=>{
    const button=element('profile-use-cloud');button.disabled=true;
    try {remote=await api();if(!recover('local-conflict',cache)) {status('error','Не удалось сохранить резервную копию. Освободите память устройства.');button.disabled=false;return;}cache=chooseSnapshot(null,remote).cache;persist(false);location.reload();}
    catch {status('conflict','Не удалось загрузить облачную копию. Попробуйте ещё раз.');button.disabled=false;}
  });
  if(legacyValues && !read('wordflow.legacy.assigned.v1')) element('profile-legacy').hidden=false;
  element('profile-dismiss-legacy').addEventListener('click',()=>{write('wordflow.legacy.assigned.v1',{userId,imported:false});element('profile-legacy').hidden=true;});
  element('profile-import-legacy').addEventListener('click',()=>{
    if(paused) {status('conflict','Сначала выберите копию для синхронизации.');return;}
    if(!recover('before-legacy-import',cache) || !recover('legacy-import',legacyValues)) {status('error','Не удалось сохранить резервную копию. Освободите память устройства.');return;}
    let migrated;
    try {migrated=documentFromValues(legacyValues);} catch {status('error','Прежние данные повреждены. Сохраните копию и проверьте файл перед переносом.');return;}
    const replacement={...cache,values:valuesFromDocument(migrated),document:migrated,dirty:true};
    if(!write(cacheKey(userId),replacement)) {status('error','Не удалось сохранить данные. Освободите память устройства и повторите перенос.');return;}
    cache=replacement;
    write('wordflow.legacy.assigned.v1',{userId,imported:true});location.reload();
  });
  updateStats();
}

async function boot() {
  await loadTelegram();
  if(!initData || !userId) {gateMessage('Откройте Wordflow в Telegram','Личные словари и прогресс доступны через нашего бота.',{open:true});return;}
  // Offline cache access requires the same signature and freshness checks as
  // cloud access. Never select an account solely from initDataUnsafe/user.id.
  try {
    const config=JSON.parse(element('telegram-profile-config').textContent);
    const verified=await verifyTelegram(initData,config.botId);
    userId=verified.id;
  } catch(error) {gateMessage('Не удалось проверить вход',error.status?error.message:'Обновите Telegram и попробуйте открыть приложение снова.',{open:true});return;}
  const saved=read(cacheKey(userId));
  cache=saved && saved.profile?.id===userId && Number.isSafeInteger(saved.revision) && saved.revision>=0 && saved.values ? saved : null;
  let conflict=false,offline=false;
  try {remote=await api();if(remote.profile.id!==userId) throw new Error('Account mismatch');({cache,conflict}=chooseSnapshot(cache,remote));}
  catch(error) {
    if(error.status===401) {gateMessage('Откройте приложение заново',error.message,{open:true});return;}
    if(!cache) {gateMessage('Не удалось загрузить профиль',error.message || 'Для первого запуска нужно подключение к интернету.',{retry:true});return;}
    offline=true;
  }
  // Persist stable keys and the collection start before app initialization can
  // write any data. Keep the exact old copy until this first migration succeeds.
  if(cache.document || cache.values[DATA_KEYS[1]]) {
    const migrated=documentFromValues(cache.values);
    if(!cache.values[DATA_KEYS[4]] || cache.document?.version===1) {
      if(!recover('before-v2-migration',cache)) throw new Error('Не удалось сохранить прежнюю копию. Освободите память устройства и откройте приложение снова.');
      const replacement={...cache,values:valuesFromDocument(migrated),document:migrated,dirty:true};
      if(!write(cacheKey(userId),replacement)) throw new Error('Не удалось обновить локальную копию. Освободите память устройства и откройте приложение снова.');
      cache=replacement;
    }
  }
  if(!write(cacheKey(userId),cache)) throw new Error('Память устройства недоступна. Освободите место и откройте приложение снова.');
  window.WordflowStorage={
    getItem(key) {return cache.values[key] ?? null;},
    setItem(key,value) {
      value=String(value);if(cache.values[key]===value) return true;
      const replacement={...cache,values:{...cache.values,[key]:value},dirty:true};
      if(!write(cacheKey(userId),replacement)) return false;
      cache=replacement;if(ready) schedule();return true;
    },
    removeItem(key) {
      const values={...cache.values};delete values[key];const replacement={...cache,values,dirty:true};
      if(!write(cacheKey(userId),replacement)) return false;
      cache=replacement;if(ready) schedule();return true;
    },
    transaction(values,apply) {
      let nextDocument;
      try {nextDocument=documentFromValues(values);} catch(error) {if(ready) status('error',error.code==='too_large'?'Данные слишком большие. Сохраните копию и уменьшите количество словарей.':'Не удалось сохранить изменения. Сохраните копию словарей.');return false;}
      const previous=cache,replacement={...cache,values:valuesFromDocument(nextDocument),document:nextDocument,dirty:true};
      if(!write(cacheKey(userId),replacement)) {if(ready) status('error','Не удалось сохранить изменения. Освободите память устройства и повторите попытку.');return false;}
      cache=replacement;
      try {apply();} catch {
        cache=previous;
        if(!write(cacheKey(userId),previous)) recover('failed-transaction',previous);
        if(ready) status('error','Не удалось применить изменения. Сохраните копию и откройте приложение снова.');
        return false;
      }
      if(ready) schedule(false,false);return true;
    },
  };
  for(const original of document.querySelectorAll('script[type="text/wordflow-script"]')) {
    const script=document.createElement('script');script.textContent=original.textContent;document.body.append(script);
  }
  if(!window.WordflowData) throw new Error('App initialization failed');
  if(cache.document) {
    try {window.WordflowData.validateBackup(cache.document);} catch {recover('invalid-cache',cache); throw new Error('Сохранённая копия повреждена. Сохраните её перед повторным запуском.');}
  }
  ready=true;mountProfile();gate.hidden=true;document.body.classList.remove('profile-loading');
  const initial=snapshot();
  if(cache.document && canonical(cache.document)!==canonical(initial)) cache.dirty=true;
  if(!conflict && remote?.document?.version===1 && initial.version===2) cache.dirty=true;
  cache.document=initial;persist(false);
  if(conflict) showConflict();
  else if(offline) {pendingStatus();}
  else if(!remote.document || cache.dirty) {schedule();}
  else status('saved','Слова и прогресс сохранены в профиле.');
  if(!offline && element('profile-legacy').hidden===false && !conflict) showProfile();
  window.addEventListener('online',sync);
  window.addEventListener('offline',pendingStatus);
  window.addEventListener('wordflow:datachange',()=>updateStats());
  let statsDate=new Date().toDateString();
  setInterval(()=>{const day=new Date().toDateString();if(day!==statsDate) {statsDate=day;updateStats();}},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) updateStats();});
  window.Telegram?.WebApp?.onEvent?.('activated',()=>{updateStats();sync();});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot().catch(error=>{gateMessage('Не удалось открыть приложение',error.message || 'Попробуйте снова.',{retry:true});});
