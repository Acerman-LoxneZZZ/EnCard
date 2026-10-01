const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'wordflow.session.v1';
const PREFS_KEY = 'wordflow.preferences.v1';
const CUSTOM_KEY = 'wordflow.custom-words.v1';
const COLLECTIONS_KEY = 'wordflow.collections.v1';
let collections = [], collectionSessions = Object.create(null), activeCollectionId = 'all', browsingCollectionId = 'all', editingCollectionId = null;
const pickerSelection = new Set();
const BUILTIN_COUNT = WORDS.length;
try {
  const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
  let repairedTranscriptions = false;
  if (Array.isArray(custom)) custom.slice(0, 500).forEach(item => {
    if (item && typeof item.en === 'string' && typeof item.ru === 'string' &&
        item.en.length <= 80 && item.ru.length <= 120 && item.en.trim() && item.ru.trim()) {
      const savedIpa = typeof item.ipa === 'string' ? item.ipa.trim() : '';
      const ipa = savedIpa || transcriptionFor(item.en);
      if (ipa && !savedIpa) repairedTranscriptions = true;
      WORDS.push({ id: WORDS.length, en: item.en.trim(), ru: item.ru.trim(), ipa,
        audioUrl: typeof item.audioUrl === 'string' ? item.audioUrl : '',
        audioCredit: typeof item.audioCredit === 'string' ? item.audioCredit : '',
        audioSource: typeof item.audioSource === 'string' ? item.audioSource : '' });
    }
  });
  if (repairedTranscriptions) saveCustomWords();
} catch { /* Встроенная колода работает и без локального хранилища. */ }
const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const fresh = (ids = collectionWordIds()) => ({ queue: [...ids], learned: [], difficult: [], hinted: [], attempts: 0, streak: 0, bestStreak: 0 });
let state = fresh(), previous = null, busy = false, flipped = false, drag = null;
let flipping = false, flipAnimation = null;
let suppressClickUntil = 0, toastTimer = 0, transitionTimer = 0, tiltFrame = 0, speechToken = 0, speechWatchdog = 0, activeAudio = null;
let storageAvailable = true, effectsEnabled = true, shortcutsEnabled = true, libraryOpen = false, filter = 'all';
const card = $('card'), tilt = $('card-tilt'), inner = $('card-inner');
const answers = [...document.querySelectorAll('[data-answer]')];

// Совместимо с сохранениями первой версии. Повреждённые данные не ломают очередь.
function validState(s) {
  if (!s || !Array.isArray(s.queue) || !Array.isArray(s.learned) || !Array.isArray(s.difficult)) return false;
  const all = [...s.queue, ...s.learned];
  return all.length === WORDS.length && new Set(all).size === WORDS.length &&
    [...all, ...s.difficult].every(n => Number.isInteger(n) && n >= 0 && n < WORDS.length) &&
    new Set(s.difficult).size === s.difficult.length && Number.isSafeInteger(s.attempts) && s.attempts >= s.learned.length &&
    (s.hinted === undefined || (Array.isArray(s.hinted) && new Set(s.hinted).size === s.hinted.length && s.hinted.every(id => s.queue.includes(id) && s.difficult.includes(id))));
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (validState(saved)) {
    state = saved;
    // Старые сохранения объединяли «Не знаю» и «Трудно»; не выдаём подсказку наугад.
    state.hinted = saved.hinted || [];
    state.streak = Number.isSafeInteger(saved.streak) && saved.streak >= 0 ? saved.streak : 0;
    state.bestStreak = Number.isSafeInteger(saved.bestStreak) && saved.bestStreak >= state.streak ? saved.bestStreak : state.streak;
  }
  const preferences = JSON.parse(localStorage.getItem(PREFS_KEY));
  if (preferences && typeof preferences.effects === 'boolean') effectsEnabled = preferences.effects;
  if (preferences && typeof preferences.shortcuts === 'boolean') shortcutsEnabled = preferences.shortcuts;
} catch { storageAvailable = false; }

function save() {
  collectionSessions[activeCollectionId] = state;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectionSessions.all)); writeCollections(); storageAvailable = true; }
  catch { storageAvailable = false; }
  $('save-note').textContent = storageAvailable ? 'Прогресс сохранён' : 'Сохранено только в этой вкладке';
  $('save-note').parentElement.hidden = storageAvailable;
}
function savePreferences() {
  try {localStorage.setItem(PREFS_KEY,JSON.stringify({effects:effectsEnabled,shortcuts:shortcutsEnabled}));}
  catch { /* Настройки остаются активными для текущей вкладки. */ }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
}
function announce(message) { $('announcement').textContent = message; }
function moving() { return effectsEnabled && !motionReduced.matches; }
function applyEffects() {
  document.body.classList.toggle('effects-off', !moving());
  if (!moving()) { settleScreenTransition(); closeDictionaryMenu(); setFlipped(flipped, false, false); resetTilt(); $('celebration').replaceChildren(); }
}
function resetTilt() {
  cancelAnimationFrame(tiltFrame); tiltFrame = 0;
  tilt.style.setProperty('--rx', '0deg'); tilt.style.setProperty('--ry', '0deg');
  tilt.style.setProperty('--light-x', '50%'); tilt.style.setProperty('--light-y', '0%');
}
function resetTint() {
  document.body.style.setProperty('--intensity', '0');
  ['yes','no','hard'].forEach(kind => $('stamp-' + kind).style.opacity = '0');
}
function tint(kind, amount) {
  const colors = { yes: '145,217,186', no: '242,163,176', hard: '237,196,140' };
  document.body.style.setProperty('--tint', colors[kind]);
  document.body.style.setProperty('--intensity', String(Math.min(1, amount)));
  ['yes','no','hard'].forEach(k => $('stamp-' + k).style.opacity = k === kind ? String(Math.min(1,amount)) : '0');
}
function setFlipped(value, moveFocus = false, animate = true) {
  if (flipping && animate) return;
  const changed = flipped !== value;
  if (flipAnimation) { flipAnimation.onfinish = null; flipAnimation.cancel(); flipAnimation = null; }
  flipping = false;
  $('deck').classList.remove('turning');
  flipped = value;
  const reveal = () => {
    card.classList.toggle('flipped', value);
    $('word-sound').hidden = !value || busy || libraryOpen;
    const visible = $(value ? 'back' : 'front'), hidden = $(value ? 'front' : 'back');
    visible.inert = false; visible.setAttribute('aria-hidden', 'false');
    if (moveFocus || hidden.contains(document.activeElement)) $(value ? 'back-flip' : 'front-flip').focus({preventScroll: true});
    hidden.inert = true; hidden.setAttribute('aria-hidden', 'true');
  };
  if (!changed || !animate || !moving() || !inner.animate) { reveal(); return; }
  resetTilt();
  flipping = true;
  $('deck').classList.add('turning');
  const direction = value ? 1 : -1;
  // Меняем единственную видимую поверхность строго в положении ребром.
  // Динамик остаётся внутри неё и поворачивается вместе с карточкой.
  flipAnimation = inner.animate([
    {transform: 'rotateY(0deg) scale(1)'},
    {transform: `rotateY(${direction * 90}deg) scale(.97)`}
  ], {duration: 320, easing: 'cubic-bezier(.45,0,.7,1)', fill: 'forwards'});
  flipAnimation.onfinish = () => {
    flipAnimation.cancel();
    reveal();
    flipAnimation = inner.animate([
      {transform: `rotateY(${-direction * 90}deg) scale(.97)`},
      {transform: 'rotateY(0deg) scale(1)'}
    ], {duration: 480, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'forwards'});
    flipAnimation.onfinish = () => {
      flipAnimation.cancel(); flipAnimation = null; flipping = false;
      $('deck').classList.remove('turning');
    };
  };
}
function updateControls() {
  answers.forEach(b => b.disabled = busy || !state.queue.length || libraryOpen);
  document.querySelectorAll('.undo').forEach(b => b.disabled = busy || !previous);
  document.querySelectorAll('.flip-target, .sound').forEach(b => b.disabled = busy);
  $('word-sound').hidden = !flipped || busy || libraryOpen || !state.queue.length;
  $('open-library').disabled = busy || navigationPending;
  $('active-collection').disabled = busy || navigationPending;
}
function queuePreview(id) {
  const next = WORDS[id];
  $('queued-card').hidden = !next;
  if (next) {
    $('queued-word').textContent = next.ru;
    const hint = state.hinted.includes(id);
    $('queued-hint').hidden = !hint;
    $('queued-hint').textContent = hint ? next.en[0] + '…' : '';
  }
}
function resetQueuePreview() {
  const next = $('queued-card');
  next.style.transition = 'none';
  next.style.transform = '';
  $('deck').classList.remove('advancing', 'pulling');
  $('deck').style.removeProperty('--exit-duration');
  queuePreview(state.queue[1]);
  void next.offsetWidth;
  next.style.transition = '';
}
function showCurrentScreen() {
  $('session').hidden = libraryOpen || !state.queue.length;
  $('finish').hidden = libraryOpen || !!state.queue.length;
  $('library').hidden = !libraryOpen;
  $('active-collection').hidden = libraryOpen || !collections.length;
  $('open-library').setAttribute('aria-expanded', String(libraryOpen));
}
function render(initial = false) {
  const total = collectionWordIds().length;
  $('active-collection-name').textContent = collectionName(activeCollectionId);
  const count = state.learned.length;
  $('learned-count').textContent = `${count} из ${total}`;
  $('remaining-count').textContent = `Осталось ${state.queue.length}`;
  $('progress-fill').style.transform = `scaleX(${total ? count / total : 0})`;
  $('progress').setAttribute('aria-valuemax', String(total || 1));
  $('progress').setAttribute('aria-valuenow', String(count));
  $('progress').setAttribute('aria-valuetext', `${collectionName(activeCollectionId)}: ${count} из ${total} слов выучено`);
  inner.style.transition = 'none';
  setFlipped(false, false, false);
  card.style.transition = 'none'; card.style.transform = ''; card.style.opacity = '1';
  resetTilt(); resetTint();
  resetQueuePreview();
  // Фиксируем начальное положение, чтобы новая карточка не переворачивалась назад.
  void inner.offsetWidth;
  inner.style.transition = ''; card.style.transition = '';
  $('deck').classList.toggle('last-card', state.queue.length === 1);
  showCurrentScreen(); updateControls();
  if (!state.queue.length) {
    $('easy-count').textContent = total - state.difficult.length;
    $('hard-count').textContent = state.difficult.length;
    $('finish-extra').textContent = `Выучено ${total} слов. Всего ответов: ${state.attempts}.`;
    $('finish-review').hidden = state.difficult.length === 0;
    $('review-words').replaceChildren(...state.difficult.map(id => {
      const li = document.createElement('li'); li.textContent = `${WORDS[id].en} — ${WORDS[id].ru}`; return li;
    }));
    if (!initial && !libraryOpen) $('finish-title').focus({preventScroll: true});
    announce(`Колода пройдена. Выучено ${total} слов.`);
    return;
  }
  const word = WORDS[state.queue[0]];
  $('word').textContent = word.en; $('transcription').textContent = word.ipa;
  $('transcription').hidden = !word.ipa;
  $('translation').textContent = word.ru;
  updateAudioCredit(word);
  $('back-flip').setAttribute('aria-labelledby', word.ipa ? 'word transcription' : 'word');
  $('back-flip').setAttribute('aria-describedby', 'back-hint');
  const hint = state.hinted.includes(word.id);
  $('letter-hint').hidden = !hint;
  $('letter-hint').textContent = hint ? word.en[0] + '…' : '';
  if (hint) $('letter-hint').setAttribute('aria-label', `Первая буква английского слова: ${word.en[0]}`);
  else $('letter-hint').removeAttribute('aria-label');
  $('front-flip').setAttribute('aria-labelledby', hint ? 'translation letter-hint' : 'translation');
  card.setAttribute('aria-label', `Переведите: ${word.ru}`);
  announce(`${word.ru}.${hint ? ` Первая буква: ${word.en[0]}.` : ''} Осталось ${state.queue.length} слов.`);
  void lookupRecording(word);
}
function saveCustomWords() {
  const entries = WORDS.slice(BUILTIN_COUNT).map(({en,ru,ipa,audioUrl,audioCredit,audioSource}) =>
    ({en,ru,ipa,audioUrl,audioCredit,audioSource}));
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(entries));
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
const audioLookups = new Map();
function updateAudioCredit(word) {
  const link = $('audio-credit');
  link.hidden = !word.audioUrl;
  if (word.audioUrl) {
    link.href = word.audioSource || 'https://commons.wikimedia.org/';
    link.textContent = word.audioCredit ? `Запись: ${word.audioCredit}` : 'Запись: Wikimedia Commons';
  }
}
async function lookupRecording(word) {
  if (word.audioUrl || !('fetch' in window) || !/^[a-z][a-z '\-]*$/i.test(word.en)) return word.audioUrl || '';
  const key = word.en.toLowerCase();
  if (audioLookups.has(key)) return audioLookups.get(key);
  const pending = (async () => {
    const name = word.en.toLowerCase().replace(/ /g, '_');
    const titles = ['En-us-', 'En-uk-', 'En-au-', 'En-'].map(prefix => `File:${prefix}${name}.ogg`);
    const params = new URLSearchParams({action:'query',titles:titles.join('|'),prop:'imageinfo',iiprop:'url|extmetadata',format:'json',origin:'*'});
    try {
      const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`);
      const pages = Object.values(data.query?.pages || {});
      const page = titles.map(title => pages.find(item => item.title.toLowerCase() === title.toLowerCase() && item.imageinfo?.[0]?.url)).find(Boolean);
      if (!page) return '';
      const info = page.imageinfo[0];
      if (!/^https:\/\/upload\.wikimedia\.org\//.test(info.url)) return '';
      const meta = info.extmetadata || {};
      const artist = (meta.Artist?.value || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
      const license = (meta.LicenseShortName?.value || '').trim();
      word.audioUrl = info.url;
      word.audioSource = info.descriptionurl || '';
      word.audioCredit = [artist, license].filter(Boolean).join(' · ').slice(0, 120);
      if (word.id >= BUILTIN_COUNT) try { saveCustomWords(); } catch { /* В памяти запись работает. */ }
      if (state.queue[0] === word.id && !libraryOpen) updateAudioCredit(word);
      return word.audioUrl;
    } catch { return ''; }
  })();
  audioLookups.set(key, pending);
  return pending;
}
function stopSpeech() {
  speechToken++; clearTimeout(speechWatchdog);
  if (activeAudio) { activeAudio.pause(); activeAudio.removeAttribute('src'); activeAudio.load(); activeAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  document.querySelectorAll('.sound').forEach(b => {b.classList.remove('speaking');b.removeAttribute('aria-busy');});
}
function speakWithBrowser(word, button, token) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    button.classList.remove('speaking'); button.removeAttribute('aria-busy');
    toast('Запись недоступна, а браузер не поддерживает озвучку. Откройте приложение в Chrome или Edge.'); return;
  }
  const utterance = new SpeechSynthesisUtterance(word.en);
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => /^en[-_]GB$/i.test(v.lang)) || voices.find(v => /^en[-_]/i.test(v.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = voice ? voice.lang : 'en-US'; utterance.rate = .88;
  const clean = () => { if (token !== speechToken) return; clearTimeout(speechWatchdog); button.classList.remove('speaking'); button.removeAttribute('aria-busy'); };
  utterance.onend = clean;
  utterance.onerror = event => { clean(); if (token === speechToken && !['interrupted','canceled'].includes(event.error)) toast('Нет записи и системный голос не ответил. Проверьте звук браузера.'); };
  speechWatchdog = setTimeout(() => { if (token === speechToken) { clean(); toast('Системный голос не ответил. Проверьте звук браузера или попробуйте другое слово.'); } }, 12000);
  try {
    speechSynthesis.speak(utterance);
    if (speechSynthesis.paused) speechSynthesis.resume();
  } catch { clean(); toast('Браузер не смог запустить озвучку.'); }
}
function speak(button) {
  if (busy || !state.queue.length || libraryOpen || !flipped || button.hidden) return;
  stopSpeech();
  const word = WORDS[state.queue[0]], token = speechToken;
  button.classList.add('speaking'); button.setAttribute('aria-busy','true');
  if (!word.audioUrl && !('fetch' in window)) { speakWithBrowser(word,button,token); return; }
  const play = async () => {
    const url = word.audioUrl || await lookupRecording(word);
    if (token !== speechToken) return;
    if (url && 'Audio' in window) {
      const player = new Audio(url);
      activeAudio = player;
      player.onended = () => { if (token === speechToken) { button.classList.remove('speaking'); button.removeAttribute('aria-busy'); activeAudio = null; } };
      player.onerror = () => { if (token === speechToken) { activeAudio = null; speakWithBrowser(word,button,token); } };
      speechWatchdog = setTimeout(() => { if (token === speechToken && activeAudio === player) { player.pause(); activeAudio = null; speakWithBrowser(word,button,token); } }, 8000);
      try { await player.play(); clearTimeout(speechWatchdog); return; }
      catch { activeAudio = null; }
    }
    if (token === speechToken) speakWithBrowser(word,button,token);
  };
  void play();
}
function celebrate() {
  if (!moving()) return;
  const pieces = Array.from({length:28}, (_, i) => {
    const piece = document.createElement('i'); piece.className = 'confetti';
    const angle = (i / 28) * Math.PI * 2, distance = 120 + Math.random()*190;
    piece.style.setProperty('--x', `${Math.cos(angle)*distance}px`);
    piece.style.setProperty('--y', `${Math.sin(angle)*distance-80}px`);
    piece.style.setProperty('--turn', `${Math.random()*420}deg`);
    piece.style.setProperty('--delay', `${Math.random()*.14}s`);
    piece.style.setProperty('--color', ['#c4b6f5','#91d9ba','#edc48c'][i%3]); return piece;
  });
  $('celebration').replaceChildren(...pieces);
  setTimeout(() => $('celebration').replaceChildren(),2000);
}
// Очередь изменяется атомарно до анимации: быстрые двойные клики не теряют слова.
function rate(kind) {
  if (busy || navigationPending || dictionaryTrigger || libraryOpen || !state.queue.length || !['yes','no','hard'].includes(kind)) return;
  const refocusCard = card.contains(document.activeElement);
  const refocusAnswer = answers.includes(document.activeElement) ? document.activeElement : null;
  busy = true; drag = null;
  setFlipped(flipped, false, false);
  card.classList.remove('dragging');
  card.getAnimations?.().forEach(animation => animation.cancel());
  resetTilt(); stopSpeech();
  previous = JSON.parse(JSON.stringify(state));
  updateControls(); tint(kind,1);
  const id = state.queue.shift(); state.attempts++;
  if (kind === 'yes') {
    state.learned.push(id); state.streak++; state.bestStreak = Math.max(state.bestStreak,state.streak);
    state.hinted = state.hinted.filter(wordId => wordId !== id);
  } else {
    state.streak = 0;
    if (!state.difficult.includes(id)) state.difficult.push(id);
    if (kind === 'hard') {
      if (!state.hinted.includes(id)) state.hinted.push(id);
      state.queue.splice(Math.min(3,state.queue.length),0,id);
    }
    else state.queue.push(id);
  }
  save();
  // Под уходящей карточкой уже находится следующее слово, а не пустая подложка.
  queuePreview(state.queue[0]);
  const delay = moving() ? (kind === 'hard' ? 600 : 510) : 0;
  $('deck').style.setProperty('--exit-duration', `${delay}ms`);
  $('deck').classList.remove('pulling');
  void $('queued-card').offsetWidth;
  $('queued-card').style.transform = 'translateY(0) scale(1) rotate(0deg)';
  $('deck').classList.add('advancing');
  card.style.transition = delay ? `transform ${delay}ms cubic-bezier(.3,.15,.3,1)` : 'none';
  if (delay) {
    const distance = Math.max(card.offsetWidth + 140, 450);
    const downDistance = Math.max(card.offsetHeight + 140, 450);
    card.style.transform = kind === 'hard' ? `translate3d(0,${downDistance}px,0) rotate(5deg)` : `translate3d(${kind==='yes'?distance:-distance}px,-24px,0) rotate(${kind==='yes'?16:-16}deg)`;
  }
  transitionTimer = setTimeout(() => {
    busy = false; render();
    if (refocusCard && state.queue.length) $('front-flip').focus({preventScroll:true});
    else if (refocusAnswer && state.queue.length) refocusAnswer.focus({preventScroll:true});
    if (!state.queue.length) celebrate();
  },delay);
}
function undo() {
  if (busy || !previous || libraryOpen) return;
  stopSpeech(); $('celebration').replaceChildren();
  state = previous; previous = null; save(); render();
  $('front-flip').focus({preventScroll:true}); toast('Последний ответ отменён.');
}
function restart() {
  if (busy) return;
  stopSpeech(); $('celebration').replaceChildren();
  state = fresh(); previous = null; save(); render();
  $('front-flip').focus({preventScroll:true});
}

// Статусы библиотеки не подменяют прогресс: «на повторении» — только активные слова.
function wordStatus(id) { const session = collectionSessions[browsingCollectionId]; return session.learned.includes(id) ? 'learned' : session.difficult.includes(id) ? 'review' : 'new'; }
function renderLibrary() {
  collectionSessions[activeCollectionId] = state;
  renderCollectionControls();
  const ids = collectionWordIds(browsingCollectionId), session = collectionSessions[browsingCollectionId];
  const query = $('word-search').value.trim().toLocaleLowerCase('ru');
  const results = ids.map(id => WORDS[id]).filter(w => (filter === 'all' || wordStatus(w.id) === filter) && `${w.en} ${w.ru}`.toLocaleLowerCase('ru').includes(query));
  $('filter-learned-count').textContent = session.learned.length;
  $('filter-all-count').textContent = ids.length;
  $('filter-review-count').textContent = session.queue.filter(id => session.difficult.includes(id)).length;
  $('word-list').replaceChildren(...results.map(word => {
    const li = document.createElement('li'); li.className = 'word-row';
    const name = document.createElement('div'), strong = document.createElement('strong'), ipa = document.createElement('small');
    strong.lang = 'en'; strong.textContent = word.en; ipa.textContent = word.ipa; name.append(strong,ipa);
    const translation = document.createElement('span'); translation.className = 'row-translation'; translation.textContent = word.ru;
    const status = document.createElement('span'), type = wordStatus(word.id); status.className = 'word-status '+type; status.textContent = {learned:'Выучено',review:'Повторение',new:'Впереди'}[type];
    li.append(name,translation,status);
    if (browsingCollectionId !== 'all') {
      li.classList.add('has-membership');
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-membership';
      remove.textContent = 'Убрать'; remove.setAttribute('aria-label', `Убрать ${word.en} из этого словаря`);
      remove.addEventListener('click', () => removeMembership(word.id)); li.append(remove);
    }
    return li;
  }));
  $('library-empty').hidden = !!results.length;
  $('library-empty').textContent = ids.length ? 'Таких слов нет. Попробуйте другой запрос или фильтр.' : 'Словарь пока пуст. Добавьте новое слово или выберите слова из общего.';
  $('library-count').textContent = `Показано ${results.length} из ${ids.length}`;
}
function addWord(event) {
  event.preventDefault();
  const en = $('custom-en').value.trim().replace(/\s+/g, ' ');
  const ru = $('custom-ru').value.trim().replace(/\s+/g, ' ');
  if (!en || !ru || en.length > 80 || ru.length > 120) return;
  const existing = WORDS.find(word => word.en.toLocaleLowerCase('en') === en.toLocaleLowerCase('en'));
  if (existing) {
    if (browsingCollectionId !== 'all' && !collectionWordIds(browsingCollectionId).includes(existing.id)) {
      if (attachWords([existing.id])) { renderLibrary(); $('add-word-form').reset(); toast('Существующее слово добавлено в этот словарь.'); }
    } else toast('Такое английское слово уже есть в словаре.');
    return;
  }
  if (WORDS.length - BUILTIN_COUNT >= 500) { toast('Можно сохранить до 500 собственных слов.'); return; }
  const word = {id: WORDS.length, en, ru, ipa: transcriptionFor(en), audioUrl: '', audioCredit: '', audioSource: ''};
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([...WORDS.slice(BUILTIN_COUNT).map(({en,ru,ipa,audioUrl,audioCredit,audioSource}) => ({en,ru,ipa,audioUrl,audioCredit,audioSource})), {en,ru,ipa:word.ipa}]));
  } catch {
    toast('Не удалось сохранить слово. Проверьте доступ к хранилищу браузера.'); return;
  }
  WORDS.push(word);
  collectionSessions[activeCollectionId] = state;
  collectionSessions.all.queue.push(word.id);
  const targetCollection = browsingCollectionId;
  const attached = targetCollection === 'all' || attachWords([word.id]);
  previous = null;
  save(); render(); renderLibrary();
  $('add-word-form').reset();
  $('custom-en').focus();
  toast(attached ? `Добавлено: ${en}.` : `«${en}» сохранено только в общем словаре. Не удалось сохранить подборку.`);
  void lookupRecording(word);
}
function toggleLibrary(open, collectionId = activeCollectionId) {
  if (busy || navigationPending || libraryOpen === open) return;
  if (!open && !collectionWordIds().length) { toast('Этот словарь пуст. Добавьте слова или выберите другой.'); return; }
  stopSpeech(); resetTilt();
  navigateScreen(() => {
    libraryOpen = open; showCurrentScreen(); updateControls();
    if (open) { setFlipped(false, false, false); selectCollection(collectionId); setHelp(false,false); renderLibrary(); $('library-title').focus({preventScroll:true}); }
    else $('open-library').focus({preventScroll:true});
    window.scrollTo({top:0,behavior:'instant'});
  }, open ? 1 : -1);
}
function setHelp(open,focus = true) {
  $('help').hidden = !open;
  if (focus) {
    if (open) $('help-title').focus({preventScroll:false});
    if (open) $('help').scrollIntoView({behavior:moving()?'smooth':'instant',block:'nearest'});
  }
}

answers.forEach(button => button.addEventListener('click', () => rate(button.dataset.answer)));
document.querySelectorAll('.undo').forEach(button => button.addEventListener('click',undo));
$('restart').addEventListener('click',restart);
document.querySelectorAll('.flip-target').forEach(button => button.addEventListener('click',event => {
  event.stopPropagation();
  // Pointer taps are handled once in endDrag; click handles keyboard/AT activation.
  if (event.detail === 0 && !busy && performance.now() >= suppressClickUntil) setFlipped(!flipped,true);
}));
$('word-sound').addEventListener('pointerdown', event => event.stopPropagation());
$('word-sound').addEventListener('pointerup', event => event.stopPropagation());
$('word-sound').addEventListener('pointermove', event => event.stopPropagation());
$('word-sound').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); speak(event.currentTarget); });
$('open-library').addEventListener('click', () => toggleLibrary(!libraryOpen));
$('close-library').addEventListener('click', () => toggleLibrary(false));
$('word-search').addEventListener('input',renderLibrary);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed',String(b===button)));
  renderLibrary();
}));
$('close-help').addEventListener('click', () => setHelp(false));
$('add-word-form').addEventListener('submit', addWord);
$('shortcuts-toggle').checked = shortcutsEnabled;
$('shortcuts-toggle').addEventListener('change',()=>{shortcutsEnabled=$('shortcuts-toggle').checked;savePreferences();});
motionReduced.addEventListener?.('change',applyEffects);

// Один Pointer Events-поток обслуживает мышь, перо и сенсорный экран.
card.addEventListener('pointerdown', event => {
  if (busy || flipping || !event.isPrimary || event.button !== 0 || event.target.closest('.sound, a')) return;
  card.getAnimations?.().forEach(animation => animation.cancel()); resetTilt();
  drag = {id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,lastT:performance.now(),vx:0,vy:0,dx:0,dy:0,axis:null,active:false};
});
card.addEventListener('pointermove',event => {
  if (busy || flipping) return;
  if (!drag) {
    if (!moving() || !precisePointer.matches || event.pointerType === 'touch') return;
    cancelAnimationFrame(tiltFrame);
    tiltFrame = requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();
      const x = Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
      const y = Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
      tilt.style.setProperty('--rx',`${(0.5-y)*8}deg`); tilt.style.setProperty('--ry',`${(x-.5)*10}deg`);
      tilt.style.setProperty('--light-x',`${x*100}%`); tilt.style.setProperty('--light-y',`${y*100}%`);
    }); return;
  }
  if (event.pointerId !== drag.id) return;
  const now = performance.now(); drag.dx = event.clientX-drag.x; drag.dy = event.clientY-drag.y;
  if (!drag.active) {
    if (Math.max(Math.abs(drag.dx),Math.abs(drag.dy))<8) return;
    if (Math.abs(drag.dy)>Math.abs(drag.dx)) {
      if (drag.dy<0) {drag=null;suppressClickUntil=performance.now()+400;return;}
      drag.axis='y';
    } else drag.axis='x';
    drag.active=true; card.setPointerCapture(event.pointerId); card.classList.add('dragging');
    $('deck').classList.add('pulling');
  }
  const dt=Math.max(now-drag.lastT,1);
  drag.vx=(event.clientX-drag.lastX)/dt; drag.vy=(event.clientY-drag.lastY)/dt;
  drag.lastX=event.clientX; drag.lastY=event.clientY; drag.lastT=now;
  const down=drag.axis==='y';
  card.style.transform = down ? `translate3d(${drag.dx*.15}px,${Math.max(0,drag.dy)}px,0) rotate(${moving()?drag.dx/45:0}deg)` : `translate3d(${drag.dx}px,${drag.dy*.18}px,0) rotate(${moving()?drag.dx/24:0}deg)`;
  tint(down?'hard':drag.dx>=0?'yes':'no',(down?Math.max(0,drag.dy):Math.abs(drag.dx))/125);
  if (moving()) {
    const pull=Math.min(1,(down?Math.max(0,drag.dy):Math.abs(drag.dx))/180);
    $('queued-card').style.transform=`translateY(${16*(1-pull)}px) scale(${.94+.06*pull}) rotate(${-2*(1-pull)}deg)`;
  }
});
function endDrag(event,cancelled=false) {
  if (!drag || event.pointerId !== drag.id) return;
  const last=drag; drag=null; card.classList.remove('dragging');
  if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
  if (!last.active) {
    if (!cancelled) setFlipped(!flipped);
    return;
  }
  suppressClickUntil=performance.now()+400;
  const down=last.axis==='y', distance=down?Math.max(0,last.dy):Math.abs(last.dx);
  const velocity=performance.now()-last.lastT<100?(down?last.vy:last.vx):0;
  const threshold=down?100:Math.min(110,card.offsetWidth*.25);
  const flick=down?velocity>.55:Math.abs(velocity)>.55&&Math.sign(velocity)===Math.sign(last.dx);
  if (!cancelled && (distance>threshold || (flick&&distance>35))) rate(down?'hard':last.dx>0?'yes':'no');
  else {card.style.transform='';$('queued-card').style.transform='';$('deck').classList.remove('pulling');resetTint();}
}
card.addEventListener('pointerup',event=>endDrag(event));
card.addEventListener('pointercancel',event=>endDrag(event,true));
card.addEventListener('lostpointercapture',event=>endDrag(event,true));
card.addEventListener('pointerleave',()=>{if(!drag)resetTilt();});
window.addEventListener('pointerup',event=>endDrag(event));
window.addEventListener('blur',()=>{if(drag)endDrag({pointerId:drag.id},true);resetTilt();});
window.addEventListener('keydown',event=>{
  if (navigationPending || dictionaryTrigger) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || busy) return;
  if (event.key==='Escape') { if (!$('help').hidden) setHelp(false); else if(libraryOpen)toggleLibrary(false); return; }
  if (!shortcutsEnabled) return;
  if (libraryOpen || !$('help').hidden || event.target.matches('input,textarea,select') || event.target.isContentEditable) return;
  if (event.code==='KeyZ') {event.preventDefault();undo();return;}
  if (!state.queue.length || event.target.closest('header')) return;
  const ratings={ArrowLeft:'no',ArrowDown:'hard',ArrowRight:'yes',Digit1:'no',Digit2:'hard',Digit3:'yes',Numpad1:'no',Numpad2:'hard',Numpad3:'yes'};
  if (ratings[event.code]) {event.preventDefault();rate(ratings[event.code]);}
  else if (event.code==='Space'&&!event.target.closest('button')) {event.preventDefault();setFlipped(!flipped,true);}
  else if (event.code==='KeyS' && flipped) {event.preventDefault();speak($('word-sound'));}
});
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('page-hidden',document.hidden);if(document.hidden){stopSpeech();resetTilt();}});
window.addEventListener('pagehide',stopSpeech);
initCollections();
document.body.classList.toggle('page-hidden',document.hidden);
applyEffects(); save(); render(true);
