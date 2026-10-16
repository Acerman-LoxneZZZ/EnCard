import source from '../index.html?raw';
import {env} from 'cloudflare:workers';
export const dynamic = 'force-dynamic';

export function GET() {
  // Preserve the established HTML app; initialize it after selecting the
  // authenticated user's cache. The shell contains no personal server data.
  const html=source.replaceAll('./public/', '/').replace(/<script>([\s\S]*?)<\/script>/g, (_match,script:string)=>
    `<script type="text/wordflow-script">${script.replace(/\blocalStorage\b/g,'window.WordflowStorage')}</script>`)
    .replace('</head>', '<link rel="stylesheet" href="/profile.css"></head>')
    .replace('<body>', '<body class="profile-loading">')
    .replace('</body>', `<script type="application/json" id="telegram-profile-config">${JSON.stringify({botId:env.TELEGRAM_BOT_ID || ''}).replace(/</g,'\\u003c')}</script><script type="module" src="/profile-client.js"></script></body>`);
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});
}
