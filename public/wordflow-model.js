(function (root) {
  'use strict';

  const MAX_DOCUMENT_BYTES = 1024 * 1024;
  const MAX_EVENTS = 5000;
  const MAX_TIME = 8640000000000000;
  const BUILTIN_WORDS = Object.freeze(['discover','journey','notice','improve','gentle','borrow','effort','enough','wonder','thoughtful','achieve','curious','reliable','instead','breathe','opportunity','appreciate','thought','available','encourage']);
  const BUILTIN_COUNT = BUILTIN_WORDS.length;
  const DATA_KEYS = Object.freeze(['wordflow.custom-words.v1','wordflow.session.v1','wordflow.collections.v1','wordflow.preferences.v1','wordflow.activity.v1']);
  const RECOVERY_KEY = 'wordflow.backup.previous.v2';
  const encoder = new TextEncoder();
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function error(code = 'invalid_document', message = 'Не удалось прочитать данные. Сохраните копию словарей и попробуйте ещё раз.') {
    const result = new Error(message); result.code = code;
    result.status = code === 'too_large' ? 413 : 400;
    return result;
  }
  function fail(message) { throw error('invalid_document', message); }
  function byteLength(value) {
    let json;
    try { json = JSON.stringify(value); } catch { fail(); }
    if (typeof json !== 'string') fail();
    return encoder.encode(json).length;
  }
  function checkSize(value) {
    if (byteLength(value) > MAX_DOCUMENT_BYTES) throw error('too_large', 'Словари слишком большие. Сохраните копию и уменьшите количество словарей.');
  }
  function timestamp(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME; }
  function clock(now) { if (!timestamp(now)) fail('Некорректная дата устройства.'); return now; }
  function dateOrdinal(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const at = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== date) return null;
    return Math.floor(at / 86400000);
  }
  function validKey(key, allowBuiltin = true) {
    if (typeof key !== 'string' || !key.length || key.length > 750) return false;
    if (key.startsWith('builtin:')) return allowBuiltin && BUILTIN_WORDS.includes(key.slice(8));
    return /^legacy:[^\s\u0000-\u001f]+$/.test(key) || /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
  }
  function validateAnswerEvent(input, now = Date.now()) {
    clock(now);
    if (!object(input) || typeof input.id !== 'string' || !input.id.length || input.id.length > 100 ||
        !timestamp(input.at) || input.at - now > 86400000 || !validKey(input.wordKey) ||
        typeof input.en !== 'string' || !input.en.trim() || input.en.length > 80 ||
        typeof input.ru !== 'string' || !input.ru.trim() || input.ru.length > 120 || !['yes','no','hard'].includes(input.kind)) fail();
    const ordinal = dateOrdinal(input.date);
    if (ordinal === null || Math.abs(ordinal - Math.floor(input.at / 86400000)) > 1) fail();
    return {id:input.id, at:input.at, date:input.date, wordKey:input.wordKey, en:input.en, ru:input.ru, kind:input.kind};
  }
  function validateActivity(input, now = Date.now(), {maxEvents = MAX_EVENTS} = {}) {
    clock(now);
    if (!object(input) || !timestamp(input.startedAt) || !Array.isArray(input.events) || input.events.length > maxEvents || typeof input.truncated !== 'boolean') fail();
    if (input.truncationReason !== undefined && !['count','size'].includes(input.truncationReason)) fail();
    const seen = new Set();
    const events = input.events.map(event => {
      const valid = validateAnswerEvent(event, now);
      if (seen.has(valid.id)) fail();
      seen.add(valid.id); return valid;
    });
    return {startedAt:input.startedAt, events, truncated:input.truncated,
      ...(input.truncationReason === undefined ? {} : {truncationReason:input.truncationReason})};
  }
  function idList(value, allowed) {
    return Array.isArray(value) && value.length <= allowed.size && new Set(value).size === value.length && value.every(id => Number.isInteger(id) && allowed.has(id));
  }
  function validateSession(input, ids) {
    const allowed = new Set(ids);
    if (!object(input) || !idList(input.queue, allowed) || !idList(input.learned, allowed) || !idList(input.difficult, allowed) || !idList(input.hinted || [], new Set(input.queue))) fail();
    const all = [...input.queue, ...input.learned];
    if (all.length !== allowed.size || new Set(all).size !== all.length || (input.hinted || []).some(id => !input.difficult.includes(id))) fail();
    if (!Number.isSafeInteger(input.attempts) || input.attempts < input.learned.length || input.attempts > 1e9 ||
        !Number.isSafeInteger(input.streak) || input.streak < 0 || input.streak > input.attempts ||
        !Number.isSafeInteger(input.bestStreak) || input.bestStreak < input.streak || input.bestStreak > input.attempts) fail();
    return {queue:[...input.queue], learned:[...input.learned], difficult:[...input.difficult], hinted:[...(input.hinted || [])], attempts:input.attempts, streak:input.streak, bestStreak:input.bestStreak};
  }
  function validateDocument(input, now = Date.now()) {
    clock(now); checkSize(input);
    if (!object(input) || input.format !== 'wordflow-backup' || ![1,2].includes(input.version) || !Array.isArray(input.builtinWords) ||
        input.builtinWords.length !== BUILTIN_COUNT || input.builtinWords.some((word, index) => word !== BUILTIN_WORDS[index]) ||
        !Array.isArray(input.customWords) || input.customWords.length > 500) fail();
    const keys = new Set();
    const customWords = input.customWords.map(word => {
      if (!object(word) || typeof word.en !== 'string' || !word.en.trim() || word.en.length > 80 || typeof word.ru !== 'string' || !word.ru.trim() || word.ru.length > 120 || typeof word.ipa !== 'string' || word.ipa.length > 250) fail();
      const result = {en:word.en.trim(), ru:word.ru.trim(), ipa:word.ipa};
      if (input.version === 2) {
        if (!validKey(word.key, false) || keys.has(word.key)) fail();
        keys.add(word.key); result.key = word.key;
      }
      for (const field of ['audioUrl','audioCredit','audioSource']) {
        if (word[field] === undefined) continue;
        if (typeof word[field] !== 'string' || word[field].length > (field === 'audioCredit' ? 250 : 2048) ||
            (field !== 'audioCredit' && word[field] && !/^https:\/\//i.test(word[field]))) fail();
        result[field] = word[field];
      }
      return result;
    });
    const names = [...BUILTIN_WORDS, ...customWords.map(word => word.en)].map(word => word.toLowerCase());
    if (new Set(names).size !== names.length) fail();
    const ids = names.map((_word, index) => index), allowed = new Set(ids), decks = input.collections;
    if (!object(decks) || !Array.isArray(decks.items) || decks.items.length > 1000 || !object(decks.sessions)) fail();
    const seen = new Set(), entries = [];
    const items = decks.items.map(item => {
      if (!object(item) || typeof item.id !== 'string' || !/^deck-[a-z0-9-]{1,100}$/.test(item.id) || seen.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 50 || !idList(item.wordIds, allowed) || !own(decks.sessions,item.id)) fail();
      seen.add(item.id); entries.push([item.id,validateSession(decks.sessions[item.id],item.wordIds)]);
      return {id:item.id,name:item.name.trim(),wordIds:[...item.wordIds]};
    });
    if ((decks.activeId !== 'all' && !seen.has(decks.activeId)) || !object(input.preferences) ||
        typeof input.preferences.effects !== 'boolean' || typeof input.preferences.shortcuts !== 'boolean') fail();
    const result = {format:'wordflow-backup',version:input.version,builtinWords:[...BUILTIN_WORDS],customWords,
      session:validateSession(input.session,ids),collections:{items,activeId:decks.activeId,sessions:Object.fromEntries(entries)},
      preferences:{effects:input.preferences.effects,shortcuts:input.preferences.shortcuts}};
    if (input.version === 2) result.activity = validateActivity(input.activity,now);
    checkSize(result); return result;
  }
  function normalizeDocument(input, now = Date.now()) {
    const result = validateDocument(input,now);
    if (result.version === 1) {
      result.version = 2;
      result.customWords = result.customWords.map(word => {
        let key;
        try { key = `legacy:${encodeURIComponent(word.en.toLowerCase())}`; } catch { fail(); }
        return {...word,key};
      });
      result.activity = {startedAt:now,events:[],truncated:false};
    }
    checkSize(result); return result;
  }
  function valuesFromDocument(document) {
    return Object.fromEntries([document.customWords,document.session,document.collections,document.preferences,
      ...(document.version === 2 ? [document.activity] : [])].map((value,index) => [DATA_KEYS[index],JSON.stringify(value)]));
  }
  function wordKey(document, id) {
    if (!Number.isInteger(id) || id < 0 || id >= BUILTIN_COUNT + document.customWords.length) fail();
    return id < BUILTIN_COUNT ? `builtin:${BUILTIN_WORDS[id]}` : document.customWords[id-BUILTIN_COUNT].key;
  }
  function createWordKey() {
    if (typeof root.crypto?.randomUUID !== 'function') throw error('invalid_document','Не удалось создать идентификатор слова. Обновите приложение.');
    return `custom:${root.crypto.randomUUID()}`;
  }
  function customIndex(document, wordId) {
    if (!Number.isInteger(wordId) || wordId < BUILTIN_COUNT || wordId >= BUILTIN_COUNT + document.customWords.length) fail('Можно изменить только собственное слово.');
    return wordId - BUILTIN_COUNT;
  }
  function editWord(input, wordId, patch, transcriptionFor = () => '') {
    const document = normalizeDocument(input), index = customIndex(document,wordId), old = document.customWords[index];
    if (!object(patch) || typeof patch.en !== 'string' || !patch.en.trim() || patch.en.length > 80 || typeof patch.ru !== 'string' || !patch.ru.trim() || patch.ru.length > 120) fail('Введите слово до 80 символов и перевод до 120 символов.');
    const en = patch.en.trim(), ru = patch.ru.trim(), normalized = en.toLowerCase();
    if (BUILTIN_WORDS.includes(normalized) || document.customWords.some((word,i) => i !== index && word.en.toLowerCase() === normalized)) fail('Такое английское слово уже есть в общем словаре.');
    const resetProgress = normalized !== old.en.toLowerCase();
    const word = {...old,en,ru};
    if (resetProgress) {
      delete word.audioUrl; delete word.audioCredit; delete word.audioSource;
      word.ipa = transcriptionFor(en) || '';
      if (typeof word.ipa !== 'string' || word.ipa.length > 250) fail();
      const reset = session => ({...session,queue:[...session.queue.filter(id => id !== wordId),wordId],
        learned:session.learned.filter(id => id !== wordId),difficult:session.difficult.filter(id => id !== wordId),hinted:session.hinted.filter(id => id !== wordId)});
      document.session = reset(document.session);
      for (const item of document.collections.items) if (item.wordIds.includes(wordId)) document.collections.sessions[item.id] = reset(document.collections.sessions[item.id]);
    }
    // The transaction fits local history after applying the immutable change.
    document.customWords[index] = word;
    return {document,resetProgress};
  }
  function deleteWord(input, wordId) {
    const document = normalizeDocument(input), index = customIndex(document,wordId);
    const remap = list => list.filter(id => id !== wordId).map(id => id > wordId ? id - 1 : id);
    const session = value => ({...value,queue:remap(value.queue),learned:remap(value.learned),difficult:remap(value.difficult),hinted:remap(value.hinted)});
    document.customWords.splice(index,1); document.session = session(document.session);
    for (const item of document.collections.items) {
      item.wordIds = remap(item.wordIds); document.collections.sessions[item.id] = session(document.collections.sessions[item.id]);
    }
    return document;
  }
  function addWordsToCollections(input, wordIds, collectionIds) {
    const document = normalizeDocument(input), count = BUILTIN_COUNT + document.customWords.length;
    if (!Array.isArray(wordIds) || wordIds.some(id => !Number.isInteger(id) || id < 0 || id >= count) || !Array.isArray(collectionIds)) fail();
    const targets = new Set(collectionIds), words = [...new Set(wordIds)];
    if ([...targets].some(id => !document.collections.items.some(item => item.id === id))) fail();
    for (const item of document.collections.items) if (targets.has(item.id)) {
      const added = words.filter(id => !item.wordIds.includes(id));
      item.wordIds.push(...added); document.collections.sessions[item.id].queue.push(...added);
    }
    return document;
  }
  function repeatWord(input, wordId, collectionId) {
    const document = normalizeDocument(input); wordKey(document,wordId);
    const item = collectionId === 'all' ? null : document.collections.items.find(value => value.id === collectionId);
    if (collectionId !== 'all' && (!item || !item.wordIds.includes(wordId))) fail();
    const session = collectionId === 'all' ? document.session : document.collections.sessions[collectionId];
    session.queue = [wordId,...session.queue.filter(id => id !== wordId)]; session.learned = session.learned.filter(id => id !== wordId);
    return document;
  }
  // Dependency injection keeps both the server import and all model operations storage-free.
  function commitValues(storage, values, apply) {
    if (!object(values) || typeof apply !== 'function') fail();
    const keys = DATA_KEYS.filter(key => own(values,key));
    if (Object.keys(values).some(key => !DATA_KEYS.includes(key)) || !keys.length || keys.some(key => values[key] !== null && typeof values[key] !== 'string')) fail();
    const previous = Object.fromEntries(keys.map(key => [key,storage.getItem(key)]));
    try { storage.setItem(RECOVERY_KEY,JSON.stringify({format:'wordflow-storage-recovery',version:2,values:previous})); }
    catch (cause) { const failure = error('storage_failed','Не удалось сохранить резервную копию. Скачайте локальную копию и освободите место.'); failure.cause = cause; throw failure; }
    try {
      for (const key of keys) {
        if (values[key] === null) storage.removeItem(key); else storage.setItem(key,values[key]);
      }
    } catch (cause) {
      let rollbackFailure = false;
      for (const key of keys) try {
        if (previous[key] === null) storage.removeItem(key); else storage.setItem(key,previous[key]);
      } catch { rollbackFailure = true; }
      const failure = error(rollbackFailure ? 'rollback_failed' : 'storage_failed',rollbackFailure ? 'Не удалось восстановить сохранение. Резервная копия сохранена; скачайте её перед перезагрузкой.' : 'Не удалось сохранить изменения. Скачайте локальную копию и освободите место.');
      failure.cause = cause; throw failure;
    }
    apply(); return true;
  }
  root.WordflowModel = Object.freeze({MAX_DOCUMENT_BYTES,MAX_EVENTS,BUILTIN_WORDS,BUILTIN_COUNT,DATA_KEYS,RECOVERY_KEY,
    validateDocument,normalizeDocument,validateActivity,validateAnswerEvent,valuesFromDocument,wordKey,createWordKey,
    editWord,deleteWord,addWordsToCollections,repeatWord,commitValues,byteLength});
})(globalThis);
