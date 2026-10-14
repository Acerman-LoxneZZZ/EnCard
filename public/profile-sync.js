export const DATA_KEYS=['wordflow.custom-words.v1','wordflow.session.v1','wordflow.collections.v1','wordflow.preferences.v1'];
export const cacheKey=id=>`wordflow.profile.${id}.v1`;
export const canonical=document=>JSON.stringify({...document,exportedAt:undefined});

const stable=value=>JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function valuesMatchDocument(values,document) {
  try {
    const project=values=>{
      const custom=JSON.parse(values[DATA_KEYS[0]] || '[]');
      const session=s=>({queue:s.queue,learned:s.learned,difficult:s.difficult,hinted:s.hinted || [],attempts:s.attempts,streak:s.streak || 0,bestStreak:s.bestStreak || 0});
      const decks=JSON.parse(values[DATA_KEYS[2]] || '{"items":[],"activeId":"all","sessions":{}}');
      const prefs=JSON.parse(values[DATA_KEYS[3]] || '{"effects":true,"shortcuts":true}');
      return {custom:custom.map(w=>({en:w.en,ru:w.ru,ipa:w.ipa || ''})),session:session(JSON.parse(values[DATA_KEYS[1]] || '{}')),
        collections:{items:decks.items,activeId:decks.activeId,sessions:Object.fromEntries(Object.entries(decks.sessions).map(([id,s])=>[id,session(s)]))},
        preferences:{effects:prefs.effects,shortcuts:prefs.shortcuts}};
    };
    return stable(project(values))===stable(project(valuesFromDocument(document)));
  } catch {return false;}
}

export function valuesFromDocument(document) {
  return {
    [DATA_KEYS[0]]:JSON.stringify(document.customWords),
    [DATA_KEYS[1]]:JSON.stringify(document.session),
    [DATA_KEYS[2]]:JSON.stringify(document.collections),
    [DATA_KEYS[3]]:JSON.stringify(document.preferences),
  };
}

export function chooseSnapshot(cache,remote) {
  if(cache?.dirty) {
    if(cache.revision===remote.revision) return {cache:{...cache,profile:remote.profile},conflict:false};
    if(remote.document && valuesMatchDocument(cache.values,remote.document))
      return {cache:{...cache,profile:remote.profile,revision:remote.revision,updatedAt:remote.updatedAt,dirty:false},conflict:false};
    return {cache:{...cache,profile:remote.profile},conflict:true};
  }
  return {cache:{profile:remote.profile,revision:remote.revision,updatedAt:remote.updatedAt,
    values:remote.document?valuesFromDocument(remote.document):{},document:remote.document,dirty:false},conflict:false};
}

export function acknowledge(cache,sent,response,current) {
  return {...cache,revision:response.revision,updatedAt:response.updatedAt,
    dirty:canonical(sent)!==canonical(current) || !valuesMatchDocument(cache.values,current),document:current};
}
