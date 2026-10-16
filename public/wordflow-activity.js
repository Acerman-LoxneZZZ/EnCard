(function (root) {
  'use strict';
  const M = root.WordflowModel;
  if (!M) throw new Error('Load wordflow-model.js before wordflow-activity.js.');
  function localDate(now) {
    const date = new Date(now);
    if (!Number.isFinite(date.getTime())) { const error = new Error('Некорректная дата устройства.'); error.code = 'invalid_document'; throw error; }
    return `${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function weekDates(now) {
    const date = new Date(now);
    // Calendar components remain correct through short/long DST days.
    date.setHours(12,0,0,0); date.setDate(date.getDate()-6);
    return Array.from({length:7},() => { const value = localDate(date.getTime()); date.setDate(date.getDate()+1); return value; });
  }
  function emptyActivity(now = Date.now()) { return M.validateActivity({startedAt:now,events:[],truncated:false},now); }
  const compare = (a,b) => a.at-b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function evicted(activity, reason) {
    activity.truncated = true;
    if (reason === 'size' || activity.truncationReason !== 'size') activity.truncationReason = reason;
  }
  function retained(input, now, protectedEventId) {
    const activity = M.validateActivity(input,now,{maxEvents:Infinity}),oldestDate = weekDates(now)[0];
    // A captured date can be tomorrow after westward travel. Keep it until the
    // local calendar catches up; only dates before the retention window expire.
    activity.events = activity.events.filter(event => event.date >= oldestDate).sort(compare);
    if (activity.events.length > M.MAX_EVENTS) {
      const protectedEvent = activity.events.find(event => event.id === protectedEventId);
      let events = activity.events.slice(-M.MAX_EVENTS);
      if (protectedEvent && !events.some(event => event.id === protectedEventId)) events = [protectedEvent,...events.slice(1)].sort(compare);
      activity.events = events; evicted(activity,'count');
    }
    return activity;
  }
  function recordAnswer(input, event, now = Date.now()) {
    const activity = M.validateActivity(input,now),answer = M.validateAnswerEvent(event,now);
    if (activity.events.some(value => value.id === answer.id)) { const error = new Error('Этот ответ уже сохранён.'); error.code = 'invalid_document'; throw error; }
    activity.events.push(answer); return retained(activity,now,answer.id);
  }
  function removeAnswer(input, eventId, now = Date.now()) {
    const activity = M.validateActivity(input,now);
    activity.events = activity.events.filter(event => event.id !== eventId);
    return retained(activity,now,null);
  }
  function fitDocument(input, now = Date.now(), protectedEventId = null) {
    // Validate non-history data separately so local capacity overflow can be repaired.
    // Unknown payload is still counted; it cannot be silently discarded to fit.
    const activity = retained(input.activity,now,protectedEventId);
    const shell = {...input,activity:{...activity,events:[]}};
    const document = M.normalizeDocument(shell,now);
    document.activity = activity;
    if (M.byteLength(document) <= M.MAX_DOCUMENT_BYTES) return document;
    evicted(activity,'size');
    const protectedEvent = activity.events.find(event => event.id === protectedEventId);
    const removable = activity.events.filter(event => event.id !== protectedEventId);
    // Find the smallest prefix to remove with logarithmic serialization work.
    let low = 0, high = removable.length;
    const keep = removed => {
      const events = removable.slice(removed);
      if (protectedEvent) events.push(protectedEvent);
      return events.sort(compare);
    };
    activity.events = keep(high);
    if (M.byteLength(document) > M.MAX_DOCUMENT_BYTES) { const error = new Error('Словари слишком большие. Сохраните копию и уменьшите количество словарей.'); error.code = 'too_large'; error.status = 413; throw error; }
    while (low < high) {
      const middle = Math.floor((low+high)/2); activity.events = keep(middle);
      if (M.byteLength(document) > M.MAX_DOCUMENT_BYTES) low = middle+1; else high = middle;
    }
    activity.events = keep(low); return document;
  }
  function summarizeWeek(input, now = Date.now()) {
    const activity = M.validateActivity(input,now),days = weekDates(now).map(date => ({date,answers:0}));
    const byDate = new Map(days.map(day => [day.date,day])),words = new Map();
    let answers = 0;
    for (const event of [...activity.events].sort(compare)) {
      const day = byDate.get(event.date);
      if (!day) continue;
      day.answers++; answers++;
      let word = words.get(event.wordKey);
      if (!word) { word = {wordKey:event.wordKey,en:event.en,ru:event.ru,count:0}; words.set(event.wordKey,word); }
      word.en = event.en; word.ru = event.ru;
      if (event.kind === 'no' || event.kind === 'hard') word.count++;
    }
    const difficultWords = [...words.values()].filter(word => word.count).sort((a,b) => b.count-a.count || a.en.localeCompare(b.en,'en') || a.wordKey.localeCompare(b.wordKey,'en')).slice(0,5);
    return {days,activeDays:days.filter(day => day.answers).length,uniqueWords:words.size,answers,difficultWords,
      truncated:activity.truncated,startedAt:activity.startedAt,...(activity.truncationReason ? {truncationReason:activity.truncationReason} : {})};
  }
  root.WordflowActivity = Object.freeze({emptyActivity,recordAnswer,removeAnswer,fitDocument,summarizeWeek,localDate});
})(globalThis);
