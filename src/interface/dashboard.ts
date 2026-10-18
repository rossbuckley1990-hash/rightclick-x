// The live dashboard: served by every RightClick X instance at "/".
// Self-contained (no CDN), streams graph events, animates growth.

export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RightClick X</title>
<style>
:root{--bg:#0b0d12;--panel:#12151d;--line:#232837;--text:#e7eaf2;--muted:#8a93a8;--accent:#7cf0c5;--warn:#ffb86b;--bad:#ff6b8a;
--c-builtin:#8a93a8;--c-openapi:#6ea8ff;--c-graphql:#e66bff;--c-mcp:#7cf0c5;--c-web:#ffd36b;--c-platform:#ff9a6b;--c-composite:#ffffff;--c-peer:#b48cff}
@media (prefers-color-scheme: light){:root{--bg:#f6f7fb;--panel:#fff;--line:#e3e6ef;--text:#141826;--muted:#5d667c;--accent:#0a8f63;--c-composite:#141826}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0;letter-spacing:.02em}h1 span{color:var(--accent)}
.meta{color:var(--muted);font-size:12px}
.stats{display:flex;gap:18px;flex-wrap:wrap}.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stat small{color:var(--muted)}
.stat.powers b{color:var(--muted)}.stat.unknown b{font-size:14px;color:var(--warn);padding-top:10px}.metric-note{margin:0;padding:9px 18px;color:var(--muted);border-bottom:1px solid var(--line);font-size:12px}
main{display:grid;grid-template-columns:1fr 380px;height:calc(100vh - 66px)}
@media (max-width:900px){main{grid-template-columns:1fr;height:auto}main>div:first-child{height:55vh}}
#graph{width:100%;height:100%;display:block}
aside{border-left:1px solid var(--line);overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:14px}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
section h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px}
input,select,textarea,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:6px 8px;width:100%}
button{background:var(--accent);color:#04120c;border:0;font-weight:600;cursor:pointer;width:auto}
.row{display:flex;gap:6px;margin-bottom:6px}.row>*{flex:1}.row>button{flex:0 0 auto}
#feed{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;font-size:12.5px}
#feed li{padding:5px 0;border-bottom:1px dashed var(--line)}#feed .plus{color:var(--accent);font-weight:600}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;margin:6px 0 0;max-height:260px;overflow:auto}
.legend{display:flex;flex-wrap:wrap;gap:8px;font-size:11.5px;color:var(--muted)}.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.cand{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line);font-size:12.5px}.cand button{padding:2px 8px}
#tip{position:fixed;pointer-events:none;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px 7px;font-size:12px;display:none}
</style>
</head>
<body>
<header>
  <div><h1>RightClick <span>X</span></h1><div class="meta" id="meta">connecting…</div></div>
  <div class="stats">
    <div class="stat"><b id="s-prov">NOT AVAILABLE</b><small>providers</small></div>
    <div class="stat"><b id="s-caps">NOT AVAILABLE</b><small>discovered operations</small></div>
    <div class="stat powers"><b id="s-paths">NOT AVAILABLE</b><small>potential typed paths</small></div>
    <div class="stat unknown"><b id="s-verified">NOT ASSESSED</b><small>independently verified capabilities</small></div>
    <div class="stat unknown"><b id="s-authorised">UNKNOWN</b><small>authorised capabilities</small></div>
    <div class="stat"><b id="s-reusable">NOT AVAILABLE</b><small>retained reusable contracts</small></div>
  </div>
</header>
<p class="metric-note">Graph scale measures potential connections. Discovery does not establish execution authority or verified outcomes. <button id="metrics-toggle" type="button" aria-expanded="false" aria-controls="metric-sources">Metric sources</button></p>
<section id="metric-sources" hidden aria-label="Metric sources and limitations"></section>
<main>
  <div style="position:relative;min-height:320px"><canvas id="graph" style="position:absolute;inset:0"></canvas>
    <div class="legend" style="position:absolute;left:12px;bottom:10px" id="legend"></div></div>
  <aside>
    <section><h2>Learn any URL</h2>
      <div class="row"><input id="learn-url" placeholder="https://… spec, GraphQL, MCP server, page or peer"><button id="learn-go">Learn</button></div>
      <pre id="learn-out"></pre></section>
    <section><h2>Compose</h2>
      <div class="row"><input id="c-have" value='{"place":"Lisbon","language":"es"}' title="have (JSON)"></div>
      <div class="row"><input id="c-want" value="text" title="want type"><input id="c-intent" value="weather" placeholder="intent"><button id="c-go">Compose + run</button></div>
      <pre id="c-out"></pre></section>
    <section><h2>Research the world</h2>
      <div class="row"><input id="r-topic" placeholder="topic, e.g. weather, translation"><button id="r-go">Research</button></div>
      <div id="r-out"></div></section>
    <section><h2>Live events</h2><ul id="feed"></ul></section>
  </aside>
</main>
<div id="tip"></div>
<script>
const $=s=>document.querySelector(s);const css=getComputedStyle(document.documentElement);
const color=src=>css.getPropertyValue('--c-'+src).trim()||'#888';
let token=null;try{token=sessionStorage.getItem('rcx-token')}catch{}
async function api(path,body){const h={'content-type':'application/json'};if(token)h.authorization='Bearer '+token;
  const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  if(r.status===401){token=prompt('RightClick X access token (RCX_TOKEN):');try{sessionStorage.setItem('rcx-token',token)}catch{};return api(path,body)}
  return r.json()}
const fmt=n=>Number(n).toLocaleString();
function metric(el,m){el.textContent=m.value===null?(m.status==='not-assessed'?'NOT ASSESSED':'UNKNOWN'):fmt(m.value);el.title=m.source+'. '+m.limitation}
function feed(html){const li=document.createElement('li');li.innerHTML=html;$('#feed').prepend(li);while($('#feed').children.length>80)$('#feed').lastChild.remove()}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// ---------- force graph
const cv=$('#graph'),ctx=cv.getContext('2d');let W,H,DPR=devicePixelRatio||1;
function size(){const r=cv.getBoundingClientRect();W=r.width;H=r.height;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0)}
addEventListener('resize',size);
let nodes=new Map(),links=[];
function sync(v){const keep=new Set();for(const n of v.nodes){keep.add(n.id);if(!nodes.has(n.id)){nodes.set(n.id,{...n,x:W/2+(Math.random()-.5)*80,y:H/2+(Math.random()-.5)*80,vx:0,vy:0,born:performance.now(),glow:0})}}
  for(const id of [...nodes.keys()])if(!keep.has(id))nodes.delete(id);temp=Math.max(temp,25);
  links=v.links.filter(([a,b])=>nodes.has(a)&&nodes.has(b));
  for(const [id,key] of Object.entries({'s-prov':'providers','s-caps':'discovered','s-paths':'potentialPaths','s-verified':'independentlyVerified','s-authorised':'authorised','s-reusable':'reusable'}))metric($('#'+id),v.metrics[key]);
  $('#metric-sources').replaceChildren();for(const m of Object.values(v.metrics)){const p=document.createElement('p');p.textContent=m.label+' — '+m.source+'. '+m.limitation;$('#metric-sources').append(p)}
  const rt=v.runtime.runtime;$('#meta').textContent=v.runtime.name+' · '+rt.name+(rt.version?' '+rt.version:'')+(rt.region?' · '+rt.region:'')+' · receipts '+v.runtime.receipts.count;
  const srcs=[...new Set(v.nodes.map(n=>n.source))];$('#legend').innerHTML=srcs.map(s=>'<span><i style="background:'+color(s)+'"></i>'+s+'</span>').join('')}
let temp=60;
function tick(){const arr=[...nodes.values()],n=arr.length;if(!n){requestAnimationFrame(tick);return}
  const k=Math.max(18,Math.sqrt((W*H)/n)*0.55);
  for(const a of arr){a.dx=0;a.dy=0}
  for(let i=0;i<n;i++){const a=arr[i];for(let j=i+1;j<n;j++){const b=arr[j];let dx=a.x-b.x,dy=a.y-b.y;let d=Math.sqrt(dx*dx+dy*dy);
    if(d<0.01){dx=Math.random()-.5;dy=Math.random()-.5;d=0.5}if(d>k*4)continue;const f=k*k/d;a.dx+=dx/d*f;a.dy+=dy/d*f;b.dx-=dx/d*f;b.dy-=dy/d*f}}
  for(const [ai,bi] of links){const a=nodes.get(ai),b=nodes.get(bi);const dx=a.x-b.x,dy=a.y-b.y,d=Math.sqrt(dx*dx+dy*dy)+.01,f=d*d/k*0.6;
    a.dx-=dx/d*f;a.dy-=dy/d*f;b.dx+=dx/d*f;b.dy+=dy/d*f}
  for(const a of arr){a.dx+=(W/2-a.x)*0.08*k/20;a.dy+=(H/2-a.y)*0.08*k/20;const m=Math.sqrt(a.dx*a.dx+a.dy*a.dy)+.01,step=Math.min(m,temp);
    a.x=Math.max(10,Math.min(W-10,a.x+a.dx/m*step));a.y=Math.max(10,Math.min(H-10,a.y+a.dy/m*step));a.glow*=.96}
  temp=Math.max(0.6,temp*0.985);
  ctx.clearRect(0,0,W,H);ctx.globalAlpha=.22;ctx.strokeStyle=css.getPropertyValue('--muted');ctx.lineWidth=.7;ctx.beginPath();
  for(const [ai,bi] of links){const a=nodes.get(ai),b=nodes.get(bi);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y)}ctx.stroke();ctx.globalAlpha=1;
  const now=performance.now();for(const a of arr){const age=Math.min(1,(now-a.born)/900);const r=(a.source==='composite'?7:4.2)*(.4+.6*age)+a.glow*6;
    if(a.glow>.05){ctx.beginPath();ctx.fillStyle=color(a.source);ctx.globalAlpha=a.glow*.35;ctx.arc(a.x,a.y,r+7,0,7);ctx.fill();ctx.globalAlpha=1}
    ctx.beginPath();ctx.fillStyle=color(a.source);ctx.arc(a.x,a.y,r,0,7);ctx.fill();
    if(a.source==='composite'){ctx.strokeStyle=color('mcp');ctx.lineWidth=1.5;ctx.stroke()}}
  requestAnimationFrame(tick)}
cv.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bd=100;
  for(const a of nodes.values()){const d=(a.x-x)**2+(a.y-y)**2;if(d<bd){bd=d;best=a}}const t=$('#tip');
  if(best){t.style.display='block';t.style.left=e.clientX+12+'px';t.style.top=e.clientY+12+'px';t.textContent=best.title+' — '+best.provider}else t.style.display='none'});

async function refresh(){sync(await api('/api/viz'))}
async function stream(){const h={};if(token)h.authorization='Bearer '+token;
  try{const r=await fetch('/events',{headers:h});const rd=r.body.getReader(),dec=new TextDecoder();let buf='';
    for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
      while((i=buf.indexOf('\\n\\n'))>=0){const blk=buf.slice(0,i);buf=buf.slice(i+2);const line=blk.split('\\n').find(l=>l.startsWith('data:'));if(line)onEvent(JSON.parse(line.slice(5)))}}}catch{}
  setTimeout(stream,2000)}
function onEvent(e){const d=e.data;
  if(e.kind==='provider.learned'){feed('<b>'+esc(d.title)+'</b> contract read ('+esc(d.source)+'): '+d.capabilitiesAdded+' operations reflected');refresh()}
  else if(e.kind==='capability.crystallized'){feed('Retained composite: <b>'+esc(d.title)+'</b>. Inspect its outcome checks before relying on it.');refresh()}
  else if(e.kind==='provider.forgotten'){feed('Forgot '+esc(d.provider));refresh()}
  else if(e.kind==='run.completed'){const n=nodes.get(d.capability);if(n)n.glow=1;feed((d.ok?'✓':'✗')+' '+esc(d.title)+' <span class="meta">'+d.durationMs+'ms · '+d.verification+'</span>')}
  else if(e.kind==='research'){feed('Researched “'+esc(d.topic||'environment')+'”: '+d.candidates+' candidates')}}

$('#learn-go').onclick=async()=>{const u=$('#learn-url').value.trim();if(!u)return;$('#learn-out').textContent='learning…';
  const r=await api('/api/learn',{source:u,deep:true});$('#learn-out').textContent=r.error||('Operations reflected: '+r.totalNewCapabilities+' (execution and authority assessed separately)\\n'+r.results.flatMap(x=>x.probes).map(p=>(p.ok?'✓ ':'· ')+p.kind+' '+p.url+(p.detail?' — '+p.detail:'')).join('\\n'))};
$('#c-go').onclick=async()=>{$('#c-out').textContent='planning…';let have;try{have=JSON.parse($('#c-have').value)}catch{$('#c-out').textContent='have must be JSON';return}
  const r=await api('/api/compose',{have,want:$('#c-want').value,intent:$('#c-intent').value||undefined,run:true});
  if(r.error){$('#c-out').textContent=r.error;return}
  const ex=r.executed;$('#c-out').textContent=(ex?(typeof ex.output==='string'?ex.output:JSON.stringify(ex.output,null,2))+'\\n\\n▶ '+ex.titles.join(' → ')+'  ('+ex.durationMs+'ms, '+ex.verification.status+')'+(ex.attempts.length?'\\n  healed after: '+ex.attempts.map(a=>a.failed).join(', '):''):'no plan found')+(r.crystallized?'\\n✦ crystallized: '+r.crystallized.title:'')+(r.plans.length>1?'\\n\\nalternatives:\\n'+r.plans.slice(1,4).map(p=>'  '+p.titles.join(' → ')).join('\\n'):'')};
$('#r-go').onclick=async()=>{const t=$('#r-topic').value.trim();$('#r-out').textContent='searching directories…';const r=await api('/api/research',{topic:t,limit:5});
  $('#r-out').innerHTML=r.directories.map(d=>'<div class="meta">'+esc(d.title)+(d.reachable?'':' — unreachable: '+esc(d.error))+'</div>'+d.candidates.map(c=>'<div class="cand"><span>'+esc(c.title)+' <span class="meta">'+c.kind+'</span></span><button data-src="'+esc(c.source)+'">learn</button></div>').join('')).join('');
  for(const b of $('#r-out').querySelectorAll('button'))b.onclick=async()=>{b.textContent='…';const x=await api('/api/learn',{source:b.dataset.src});b.textContent=x.totalNewCapabilities?'+'+x.totalNewCapabilities:'✗'}};
$('#metrics-toggle').onclick=()=>{const panel=$('#metric-sources');panel.hidden=!panel.hidden;$('#metrics-toggle').setAttribute('aria-expanded',String(!panel.hidden))};
size();refresh().then(()=>{tick();stream()});setInterval(refresh,15000);
</script>
</body>
</html>`;
