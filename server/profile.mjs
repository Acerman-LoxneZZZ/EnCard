import {ApiError,verifyTelegram} from './telegram.mjs';
import {MAX_DOCUMENT_BYTES,validateDocument} from './document.mjs';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(request) {
  const reader=request.body?.getReader(); if(!reader) throw new ApiError(400,'invalid_body','Нет данных для сохранения.');
  const chunks=[]; let size=0;
  while(true) {const {done,value}=await reader.read(); if(done) break; size+=value.length;
    if(size>MAX_DOCUMENT_BYTES+4096) {await reader.cancel(); throw new ApiError(413,'too_large','Данные слишком большие.');} chunks.push(value);}
  const bytes=new Uint8Array(size); let offset=0; for(const part of chunks) {bytes.set(part,offset); offset+=part.length;}
  try {return JSON.parse(new TextDecoder().decode(bytes));} catch {throw new ApiError(400,'invalid_body','Данные повреждены.');}
}
export async function handleProfile(request,env,{verify=verifyTelegram}={}) {
  try {
    if(!['GET','PUT'].includes(request.method)) return json({error:'method_not_allowed'},405);
    const authorization=request.headers.get('authorization') || '';
    if(!authorization.startsWith('tma ')) throw new ApiError(401,'telegram_required','Откройте приложение через Telegram.');
    const user=await verify(authorization.slice(4),env.TELEGRAM_BOT_ID);
    if(!env.DB) throw new ApiError(503,'storage_unavailable','Сохранение временно недоступно. Ваши изменения остаются на устройстве.');
    const now=Date.now();
    await env.DB.prepare('INSERT INTO profiles (telegram_id, name, avatar, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar').bind(user.id,user.name,user.avatar,now).run();
    if(request.method==='PUT') {
      const input=await body(request);
      if(!Number.isSafeInteger(input.revision) || input.revision<0) throw new ApiError(400,'invalid_revision','Не удалось определить версию данных.');
      const document=validateDocument(input.document,now);
      // A client with the old schema must never acknowledge a save that drops
      // stable word identities and answer history from an upgraded profile.
      const current=await env.DB.prepare('SELECT document, revision FROM profiles WHERE telegram_id = ?').bind(user.id).first();
      if(document.version===1 && current?.document && JSON.parse(current.document).version===2)
        throw new ApiError(409,'update_required','Обновите приложение, чтобы сохранить слова и историю занятий. Сначала сохраните локальную копию.');
      const saved=await env.DB.prepare('UPDATE profiles SET document = ?, revision = revision + 1, updated_at = ? WHERE telegram_id = ? AND revision = ? RETURNING revision, updated_at').bind(JSON.stringify(document),now,user.id,input.revision).first();
      if(!saved) return json({error:'conflict',message:'На другом устройстве появились изменения.'},409);
      return json({revision:saved.revision,updatedAt:saved.updated_at});
    }
    const row=await env.DB.prepare('SELECT document, revision, created_at, updated_at FROM profiles WHERE telegram_id = ?').bind(user.id).first();
    return json({profile:{...user,createdAt:row.created_at},document:row.document?JSON.parse(row.document):null,revision:row.revision,updatedAt:row.updated_at});
  } catch(error) {
    if(error instanceof ApiError) return json({error:error.code,message:error.message},error.status);
    // Do not log initData or private document contents.
    console.error('Profile request failed:',error?.name || 'Error');
    return json({error:'temporary_error',message:'Не удалось связаться с хранилищем. Попробуйте позже.'},503);
  }
}
