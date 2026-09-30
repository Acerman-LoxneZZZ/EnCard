// Words have one canonical record; dictionaries store only their IDs.
function collectionWordIds(id = activeCollectionId) {
  return id === 'all' ? WORDS.map(word => word.id) : (collections.find(item => item.id === id)?.wordIds || []);
}
function collectionName(id) {
  return id === 'all' ? 'Общий словарь' : (collections.find(item => item.id === id)?.name || 'Словарь');
}
function reconcileSession(saved, ids) {
  if (!saved || !Array.isArray(saved.queue) || !Array.isArray(saved.learned)) return fresh(ids);
  const keep = list => [...new Set((Array.isArray(list) ? list : []).filter(id => ids.includes(id)))];
  const learned = keep(saved.learned), queue = keep(saved.queue).filter(id => !learned.includes(id));
  queue.push(...ids.filter(id => !learned.includes(id) && !queue.includes(id)));
  const difficult = keep(saved.difficult);
  return {queue, learned, difficult, hinted: keep(saved.hinted).filter(id => queue.includes(id) && difficult.includes(id)),
    attempts: Math.max(learned.length, Number.isSafeInteger(saved.attempts) ? saved.attempts : 0),
    streak: Number.isSafeInteger(saved.streak) && saved.streak >= 0 ? saved.streak : 0,
    bestStreak: Math.max(0, Number.isSafeInteger(saved.bestStreak) ? saved.bestStreak : 0, Number.isSafeInteger(saved.streak) ? saved.streak : 0)};
}
function writeCollections(items = collections, sessions = collectionSessions, active = activeCollectionId) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify({items, activeId: active,
    sessions: Object.fromEntries(items.map(item => [item.id, sessions[item.id]]))}));
}
function commitCollections(next) {
  collectionSessions[activeCollectionId] = state;
  const sessions = Object.create(null);
  sessions.all = collectionSessions.all;
  next.forEach(item => sessions[item.id] = reconcileSession(collectionSessions[item.id], item.wordIds));
  try { writeCollections(next, sessions); }
  catch { toast('Не удалось сохранить словарь. Изменения не применены.'); return false; }
  collections = next; collectionSessions = sessions; state = sessions[activeCollectionId]; previous = null;
  render(); return true;
}
function selectCollection(id) {
  if (id !== 'all' && !collections.some(item => item.id === id)) return;
  browsingCollectionId = id; filter = 'all';
  $('word-search').value = ''; $('collection-editor').hidden = true; $('word-picker').hidden = true;
  renderLibrary();
}
function editCollection(rename = false) {
  editingCollectionId = rename ? browsingCollectionId : null;
  $('collection-editor').hidden = false;
  $('collection-name').value = rename ? collectionName(browsingCollectionId) : '';
  $('collection-name-label').textContent = rename ? 'Новое название' : 'Название словаря';
  $('save-collection').textContent = rename ? 'Сохранить' : 'Создать';
  $('collection-name').focus();
}
function submitCollection(event) {
  event.preventDefault();
  const name = $('collection-name').value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 50) { toast('Введите название до 50 символов.'); return; }
  const key = name.toLocaleLowerCase('ru');
  if (key === 'общий словарь' || collections.some(item => item.id !== editingCollectionId && item.name.toLocaleLowerCase('ru') === key)) {
    toast('Словарь с таким названием уже есть.'); return;
  }
  const id = editingCollectionId || `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const next = editingCollectionId ? collections.map(item => item.id === id ? {...item, name} : item) : [...collections, {id, name, wordIds: []}];
  if (!commitCollections(next)) return;
  selectCollection(id); $('collection-select').focus();
  toast(editingCollectionId ? 'Название сохранено.' : `Словарь «${name}» создан.`);
}
function attachWords(ids) {
  const chosen = collections.find(item => item.id === browsingCollectionId);
  if (!chosen) return false;
  const wordIds = [...new Set([...chosen.wordIds, ...ids.filter(id => Number.isInteger(id) && WORDS[id])])];
  return commitCollections(collections.map(item => item.id === chosen.id ? {...item, wordIds} : item));
}
function removeMembership(wordId) {
  const chosen = collections.find(item => item.id === browsingCollectionId);
  if (!chosen || !commitCollections(collections.map(item => item.id === chosen.id ? {...item, wordIds: item.wordIds.filter(id => id !== wordId)} : item))) return;
  renderLibrary(); $('collection-select').focus({preventScroll: true});
  toast('Убрано из этого словаря. В общем словаре слово осталось.');
}
function openWordPicker() {
  pickerSelection.clear(); $('picker-search').value = ''; $('word-picker').hidden = false;
  renderWordPicker(); $('picker-search').focus();
}
function renderWordPicker() {
  const query = $('picker-search').value.trim().toLocaleLowerCase('ru'), members = collectionWordIds(browsingCollectionId);
  const available = WORDS.filter(word => !members.includes(word.id) && `${word.en} ${word.ru}`.toLocaleLowerCase('ru').includes(query));
  $('picker-list').replaceChildren(...available.map(word => {
    const li = document.createElement('li'), label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = word.id; input.checked = pickerSelection.has(word.id);
    const text = document.createElement('span'), en = document.createElement('strong'), ru = document.createElement('span');
    en.textContent = word.en; en.lang = 'en'; ru.textContent = word.ru; text.append(en, ru);
    input.addEventListener('change', () => { input.checked ? pickerSelection.add(word.id) : pickerSelection.delete(word.id); updatePickerCount(); });
    label.append(input, text); li.append(label); return li;
  }));
  $('picker-empty').hidden = !!available.length;
  $('picker-empty').textContent = query ? 'По этому запросу слов нет.' : 'Все слова уже добавлены в этот словарь.';
  updatePickerCount();
}
function updatePickerCount() {
  $('add-picked').disabled = !pickerSelection.size;
  $('add-picked').textContent = pickerSelection.size ? `Добавить выбранные (${pickerSelection.size})` : 'Добавить выбранные';
}
function renderCollectionControls() {
  const select = $('collection-select');
  select.value = browsingCollectionId;
  $('collection-select-name').textContent = collectionName(browsingCollectionId);
  $('collection-select-count').textContent = String(collectionWordIds(browsingCollectionId).length);
  const ids = collectionWordIds(browsingCollectionId), session = collectionSessions[browsingCollectionId];
  $('collection-title').textContent = collectionName(browsingCollectionId);
  $('collection-info').textContent = `Слов: ${ids.length} · Выучено: ${session.learned.length}`;
  $('rename-collection').hidden = browsingCollectionId === 'all';
  $('open-word-picker').hidden = browsingCollectionId === 'all';
  $('study-collection').disabled = !ids.length;
  $('study-collection').textContent = session.learned.length === ids.length && ids.length ? 'Пройти заново' : 'Учить словарь';
  $('add-word-note').textContent = browsingCollectionId === 'all'
    ? 'Слово сохранится в общем словаре.'
    : `Слово попадёт в «${collectionName(browsingCollectionId)}» и в общий словарь.`;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
}
function studyCollection(id = browsingCollectionId, restartCompleted = true) {
  if (busy || navigationPending || !collectionWordIds(id).length) return;
  stopSpeech();
  navigateScreen(() => {
    save(); activeCollectionId = id; browsingCollectionId = id;
    state = collectionSessions[activeCollectionId];
    if (!state.queue.length && restartCompleted) state = fresh();
    previous = null; libraryOpen = false; save(); render();
    $(state.queue.length ? 'front-flip' : 'finish-title').focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'instant'});
  }, -1);
}
function initCollections() {
  collectionSessions.all = state;
  try {
    const saved = JSON.parse(localStorage.getItem(COLLECTIONS_KEY));
    const seen = new Set();
    if (Array.isArray(saved?.items)) collections = saved.items.filter(item => {
      if (!item || typeof item.id !== 'string' || !/^deck-[a-z0-9-]+$/.test(item.id) || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 50 || !Array.isArray(item.wordIds)) return false;
      seen.add(item.id); return true;
    }).map(item => ({id: item.id, name: item.name.trim(), wordIds: [...new Set(item.wordIds.filter(id => Number.isInteger(id) && !!WORDS[id]))]}));
    collections.forEach(item => collectionSessions[item.id] = reconcileSession(saved?.sessions?.[item.id], item.wordIds));
    if (collections.some(item => item.id === saved?.activeId)) activeCollectionId = saved.activeId;
  } catch { /* Старые слова и общий прогресс доступны без новых сохранений. */ }
  state = collectionSessions[activeCollectionId]; browsingCollectionId = activeCollectionId;
  if (!collectionWordIds().length) libraryOpen = true;
  initNavigation();
  $('new-collection').addEventListener('click', () => editCollection());
  $('rename-collection').addEventListener('click', () => editCollection(true));
  $('collection-editor').addEventListener('submit', submitCollection);
  $('cancel-collection').addEventListener('click', () => { $('collection-editor').hidden = true; $('collection-select').focus(); });
  $('study-collection').addEventListener('click', () => studyCollection());
  $('open-word-picker').addEventListener('click', openWordPicker);
  $('picker-search').addEventListener('input', renderWordPicker);
  $('close-word-picker').addEventListener('click', () => { $('word-picker').hidden = true; $('open-word-picker').focus(); });
  $('add-picked').addEventListener('click', () => {
    if (!pickerSelection.size || !attachWords([...pickerSelection])) return;
    $('word-picker').hidden = true; renderLibrary(); $('open-word-picker').focus(); toast('Выбранные слова добавлены.');
  });
  if (libraryOpen) renderLibrary();
}
