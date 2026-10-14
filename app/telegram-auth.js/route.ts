import source from '../../server/telegram.mjs?raw';
// Public-key verification only; this module contains no server credentials.
export function GET() {return new Response(source,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});}
