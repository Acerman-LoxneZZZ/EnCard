import {ApiError} from './telegram.mjs';
export const MAX_DOCUMENT_BYTES=1024*1024;
export const BUILTIN_WORDS=['discover','journey','notice','improve','gentle','borrow','effort','enough','wonder','thoughtful','achieve','curious','reliable','instead','breathe','opportunity','appreciate','thought','available','encourage'];

export function validateDocument(input) {
  const fail=()=>{throw new ApiError(400,'invalid_document','Не удалось сохранить данные. Сохраните копию словарей и попробуйте ещё раз.');};
  if(!input || input.format!=='wordflow-backup' || input.version!==1 || !Array.isArray(input.builtinWords) || input.builtinWords.length!==20) fail();
  if(input.builtinWords.some((word,i)=>word!==BUILTIN_WORDS[i])) fail();
  if(!Array.isArray(input.customWords) || input.customWords.length>500) fail();
  const customWords=input.customWords.map(w=>{
    if(!w || typeof w.en!=='string' || typeof w.ru!=='string' || !w.en.trim() || !w.ru.trim() || w.en.length>80 || w.ru.length>120 || typeof w.ipa!=='string' || w.ipa.length>250) fail();
    return {en:w.en.trim(),ru:w.ru.trim(),ipa:w.ipa};
  });
  const names=[...input.builtinWords,...customWords.map(w=>w.en)].map(w=>w.toLowerCase());
  if(new Set(names).size!==names.length) fail();
  const ids=Array.from({length:names.length},(_,i)=>i);
  const list=(value,allowed)=>Array.isArray(value) && value.length<=allowed.length && new Set(value).size===value.length && value.every(v=>Number.isInteger(v) && allowed.includes(v));
  function session(s,allowed) {
    if(!s || !list(s.queue,allowed) || !list(s.learned,allowed) || !list(s.difficult,allowed) || !list(s.hinted || [],s.queue || [])) fail();
    const all=[...s.queue,...s.learned];
    if(all.length!==allowed.length || new Set(all).size!==all.length || (s.hinted || []).some(id=>!s.difficult.includes(id))) fail();
    if(!Number.isSafeInteger(s.attempts) || s.attempts<s.learned.length || s.attempts>1e9 || !Number.isSafeInteger(s.streak) || s.streak<0 || s.streak>s.attempts || !Number.isSafeInteger(s.bestStreak) || s.bestStreak<s.streak || s.bestStreak>s.attempts) fail();
    return {queue:s.queue,learned:s.learned,difficult:s.difficult,hinted:s.hinted || [],attempts:s.attempts,streak:s.streak,bestStreak:s.bestStreak};
  }
  const decks=input.collections;
  if(!decks || !Array.isArray(decks.items) || decks.items.length>1000 || !decks.sessions || typeof decks.sessions!=='object') fail();
  const seen=new Set(), sessions=Object.create(null);
  const items=decks.items.map(d=>{
    if(!d || typeof d.id!=='string' || !/^deck-[a-z0-9-]{1,100}$/.test(d.id) || seen.has(d.id) || typeof d.name!=='string' || !d.name.trim() || d.name.length>50 || !list(d.wordIds,ids)) fail();
    seen.add(d.id); sessions[d.id]=session(decks.sessions[d.id],d.wordIds);
    return {id:d.id,name:d.name.trim(),wordIds:d.wordIds};
  });
  if(decks.activeId!=='all' && !seen.has(decks.activeId)) fail();
  if(typeof input.preferences?.effects!=='boolean' || typeof input.preferences?.shortcuts!=='boolean') fail();
  const document={format:'wordflow-backup',version:1,builtinWords:input.builtinWords,customWords,
    session:session(input.session,ids),collections:{items,activeId:decks.activeId,sessions},preferences:{effects:input.preferences.effects,shortcuts:input.preferences.shortcuts}};
  if(new TextEncoder().encode(JSON.stringify(document)).length>MAX_DOCUMENT_BYTES) throw new ApiError(413,'too_large','Словари слишком большие. Сохраните копию и уменьшите количество словарей.');
  return document;
}
