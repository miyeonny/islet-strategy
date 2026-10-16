export const SAMPLE_AGENT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ISLET · Sample agent</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f8f5ee;color:#102b48;font:16px/1.6 Georgia,'Liberation Serif',serif}main{max-width:760px;margin:64px auto;padding:0 24px}a{color:#102b48}h1{font-size:42px;line-height:1.1;margin:24px 0 16px}button{font:inherit;border:0;border-radius:7px;padding:13px 22px;background:#102b48;color:white;cursor:pointer}button:disabled{opacity:.55;cursor:wait}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e9e6de;border-radius:5px;padding:22px;min-height:180px;font:14px/1.6 ui-monospace,monospace}.subtle{font-size:14px;color:#405365}</style></head>
<body><main><a href="/">← Back to ISLET</a><h1>Let an agent claim the coast.</h1><p>This sample creates a two-player game, reads its legal moves, and plays one seat through the same HTTP JSON API used by humans. The server controls the opponent.</p><button id="run">Run sample agent</button><p id="status" role="status">Ready. One click runs one complete match.</p><pre id="output" aria-label="Agent activity">No match started.</pre><p class="subtle">The deterministic agent uses standard browser fetch. Its seat token stays in memory. Each run is bounded to 50 requests, with a 10-second timeout per request.</p><p><a href="/bot.mjs">View JavaScript agent source</a> · <a href="/api">API reference</a></p></main>
<script type="module">
import { runBot } from '/bot.mjs';
const button=document.getElementById('run'), output=document.getElementById('output'), status=document.getElementById('status');
button.addEventListener('click',async()=>{
  button.disabled=true;output.textContent='';status.textContent='Agent is playing…';
  try{
    const game=await runBot({onUpdate(event){
      if(event.type==='ready')output.textContent+='Game '+event.code+' created.\\n';
      if(event.type==='move')output.textContent+='Turn '+event.state.turn+': '+JSON.stringify(event.move)+'\\n';
      if(event.type==='waiting')status.textContent='Waiting for the next agent turn…';
    }});
    output.textContent+='\\nFinal scores: '+JSON.stringify(game.state.scores,null,2)+'\\nWinners: '+game.state.winners.map(id=>game.state.players[id].name).join(', ');
    status.textContent='Match '+game.code+' complete in '+game.state.turn+' turns.';
  }catch(error){status.textContent='Agent stopped.';output.textContent+='\\n'+error.message;}
  finally{button.disabled=false;}
});
</script></body></html>`;
