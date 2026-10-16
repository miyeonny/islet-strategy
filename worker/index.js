import { SAMPLE_AGENT_HTML } from '../agent-demo.mjs';
import { HTML } from '../frontend.mjs';
import { fetchAPI } from '../api.mjs';
import { ENGINE_SOURCE, ART_B64, API_DOC, BOT_SOURCE, BOT_JS } from '../assets.mjs';
export default { async fetch(request, env) {
 const path=new URL(request.url).pathname;
 if(path==='/agent-demo')return new Response(SAMPLE_AGENT_HTML,{headers:{'content-type':'text/html; charset=utf-8'}});
 if(path==='/bot.mjs')return new Response(BOT_JS,{headers:{'content-type':'application/javascript'}});
 if(path==='/api')return new Response(API_DOC,{headers:{'content-type':'text/plain; charset=utf-8'}});
 if(path==='/bot.py')return new Response(BOT_SOURCE,{headers:{'content-type':'text/plain; charset=utf-8'}});
 if(path==='/engine.mjs')return new Response(ENGINE_SOURCE,{headers:{'content-type':'application/javascript','cache-control':'public, max-age=3600'}});
 if(path==='/art.png')return new Response(Uint8Array.from(atob(ART_B64),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png','cache-control':'public, max-age=86400'}});
 const response=await fetchAPI(request,env);if(response)return response;
 if(path==='/')return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
 return new Response('Not found',{status:404});
}};
