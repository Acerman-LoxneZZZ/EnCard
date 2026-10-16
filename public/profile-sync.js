import './wordflow-model.js';
import './wordflow-activity.js';

export const DATA_KEYS=['wordflow.custom-words.v1','wordflow.session.v1','wordflow.collections.v1','wordflow.preferences.v1','wordflow.activity.v1'];
export const cacheKey=id=>`wordflow.profile.${id}.v1`;
const stable=value=>JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const canonical=document=>stable({...document,exportedAt:undefined});
const legacyKey=en=>`legacy:${encodeURIComponent(en.trim().toLowerCase())}`;

export function valuesMatchDocument(values,document) {
  try {
    const project=values=>{
      const custom=JSON.parse(values[DATA_KEYS[0]] || '[]');
      const session=s=>({queue:s.queue,learned:s.learned,difficult:s.difficult,hinted:s.hinted || [],attempts:s.attempts,streak:s.streak || 0,bestStreak:s.bestStreak || 0});
      const decks=JSON.parse(values[DATA_KEYS[2]] || '{"items":[],"activeId":"all","sessions":{}}');
      const prefs=JSON.parse(values[DATA_KEYS[3]] || '{"effects":true,"shortcuts":true}');
      const activity=values[DATA_KEYS[4]] ? JSON.parse(values[DATA_KEYS[4]]) : null;
      return {custom:custom.map(w=>({key:w.key || legacyKey(w.en),en:w.en,ru:w.ru,ipa:w.ipa || ''})),session:session(JSON.parse(values[DATA_KEYS[1]] || '{}')),
        collections:{items:decks.items,activeId:decks.activeId,sessions:Object.fromEntries(Object.entries(decks.sessions).map(([id,s])=>[id,session(s)]))},
        preferences:{effects:prefs.effects,shortcuts:prefs.shortcuts},activity:activity || {events:[],truncated:false}};
    };
    const local=project(values),other=project(valuesFromDocument(document));
    // A v1 device has no collection start time. Compare its empty history with
    // the deterministic migrated form without inventing a conflicting date.
    if(!values[DATA_KEYS[4]] || !document.activity) {delete local.activity.startedAt;delete other.activity.startedAt;}
    return stable(local)===stable(other);
  } catch {return false;}
}

export function valuesFromDocument(document) {
  return {
    [DATA_KEYS[0]]:JSON.stringify(document.customWords),
    [DATA_KEYS[1]]:JSON.stringify(document.session),
    [DATA_KEYS[2]]:JSON.stringify(document.collections),
    [DATA_KEYS[3]]:JSON.stringify(document.preferences),
    ...(document.version===2?{[DATA_KEYS[4]]:JSON.stringify(document.activity)}:{}),
  };
}

export function chooseSnapshot(cache,remote) {
  if(cache?.dirty) {
    if(cache.revision===remote.revision) return {cache:{...cache,profile:remote.profile},conflict:false};
    if(remote.document && valuesMatchDocument(cache.values,remote.document))
      return {cache:{...cache,profile:remote.profile,revision:remote.revision,updatedAt:remote.updatedAt,
        document:remote.document,values:valuesFromDocument(remote.document),dirty:false},conflict:false};
    return {cache:{...cache,profile:remote.profile},conflict:true};
  }
  return {cache:{profile:remote.profile,revision:remote.revision,updatedAt:remote.updatedAt,
    values:remote.document?valuesFromDocument(remote.document):{},document:remote.document,dirty:false},conflict:false};
}

export function acknowledge(cache,sent,response,current) {
  return {...cache,revision:response.revision,updatedAt:response.updatedAt,
    dirty:canonical(sent)!==canonical(current) || !valuesMatchDocument(cache.values,current),document:current};
}

export function alignPrunedSnapshot(cache,current,now=Date.now()) {
  try {
    // A pending import may already have replaced stored values while the old
    // page is still alive. Only align when the difference is our own pruning.
    if(valuesMatchDocument(cache.values,current) || !cache.document || !valuesMatchDocument(cache.values,cache.document)) return cache;
    const fitted=globalThis.WordflowActivity.fitDocument(cache.document,now);
    if(canonical(fitted)!==canonical(current)) return cache;
    return {...cache,document:current,values:valuesFromDocument(current)};
  } catch {return cache;}
}
