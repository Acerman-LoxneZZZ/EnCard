export const TELEGRAM_PUBLIC_KEY = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
export const MAX_AUTH_AGE = 86400;

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}

export async function verifyTelegram(initData, botId, {now=Date.now(), publicKey=TELEGRAM_PUBLIC_KEY}={}) {
  if (!/^\d{1,20}$/.test(botId || '')) throw new ApiError(503,'not_configured','Вход временно недоступен. Попробуйте позже.');
  const fail=()=>{throw new ApiError(401,'invalid_login','Откройте приложение заново через Telegram.');};
  if (typeof initData!=='string' || !initData || initData.length>16384) fail();
  const params=new URLSearchParams(initData), seen=new Set();
  for(const [key] of params) {if(seen.has(key)) fail(); seen.add(key);}
  const signature=params.get('signature'), authDate=params.get('auth_date');
  if(!signature || !/^[\w-]+={0,2}$/.test(signature) || !/^\d{1,12}$/.test(authDate || '')) fail();
  const age=now/1000-Number(authDate);
  if(age < -30 || age > MAX_AUTH_AGE) throw new ApiError(401,'expired_login','Вход устарел. Откройте приложение заново через бота.');
  const pairs=[...params].filter(([key])=>key!=='hash' && key!=='signature').sort(([a],[b])=>a<b?-1:a>b?1:0);
  const check=`${botId}:WebAppData\n${pairs.map(([key,value])=>`${key}=${value}`).join('\n')}`;
  let bytes;
  try {bytes=Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));} catch {fail();}
  if(bytes.length!==64) fail();
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(publicKey.match(/../g),v=>parseInt(v,16)),{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,bytes,new TextEncoder().encode(check))) fail();
  let user; try {user=JSON.parse(params.get('user'));} catch {fail();}
  if(!user || !Number.isSafeInteger(user.id) || user.id<=0 || user.is_bot || typeof user.first_name!=='string') fail();
  const name=[user.first_name,user.last_name].filter(v=>typeof v==='string').join(' ').trim().slice(0,200) || 'Профиль';
  const avatar=typeof user.photo_url==='string' && /^https:\/\//.test(user.photo_url) && user.photo_url.length<=2048 ? user.photo_url : null;
  return {id:String(user.id),name,avatar};
}
