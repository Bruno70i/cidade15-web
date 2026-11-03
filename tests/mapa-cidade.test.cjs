const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function scene() {
  const calls=[], drawn=[], circles=[], events={}; const timers=new Map(); let nextTimer=0, offset=0;
  const group=()=>({clearLayers(){},addTo(){return this;}});
  const map={createPane:()=>({style:{}}),on:(name,fn)=>{events[name]=fn;},invalidateSize(){},getSize:()=>({x:800}),fitBounds(){},getZoom:()=>13,getBounds:()=>({getWest:()=>-47+offset,getSouth:()=>-24,getEast:()=>-46,getNorth:()=>-23,pad(){return {contains:()=>true};}})};
  const source={metadata:async id=>{calls.push(['metadata',id]); return {execution_id:12,bounds:[[-24,-47],[-23,-46]],center:[-23.5,-46.5],boundary:null};},points:async(id,category,bbox)=>{
    calls.push(['points',id,category,bbox]);
    return {execution_id:12,category,nodes:[{id:1,lat:-23.5,lon:-46.5,categories:{[category]:{reachable:true,minutes:category==='culture'?20:5}}}],services:[]};
  }};
  const context={window:{Cores:{css:()=>''},L:{layerGroup:group,canvas:()=>({}),svg:()=>({}),geoJSON:()=>group(),circleMarker:position=>({bindTooltip(){return this;},addTo(){circles.push(position);return this;}})},CityMapData:{create:()=>source},CamadaCalor:{criar:()=>({addTo(){return this;},definir(points){drawn.push(points);}})}},Intl,Number,Map,Set,AbortController,
    setTimeout:fn=>{const id=++nextTimer; timers.set(id,fn); return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../mapa-cidade.js'),'utf8'),context);
  const city=context.window.MapaCidade;
  city.iniciar(map,{carregando(){},erro(error){throw new Error(error);}});
  async function flush(){for(let i=0;i<10;i++){const pending=[...timers.values()];timers.clear();for(const fn of pending) await fn();await new Promise(resolve=>setImmediate(resolve));}}
  return {city,source,calls,drawn,circles,events,flush,mover(){offset+=0.005;events.moveend();}};
}
test('20 movimentos e mudancas de categoria nao voltam a consultar a API',async()=>{
  const s=scene(); await s.city.abrir({id:12,threshold_minutes:15},{}); await s.flush();
  const initial=s.calls.length;
  for(let i=0;i<20;i++){s.mover();await s.flush();}
  await s.city.trocarCategoria('health');await s.flush();
  await s.city.trocarCategoria('overall');await s.flush();
  assert.equal(s.calls.length,initial);
  assert.equal(initial,5);
  assert.ok(s.calls.filter(c=>c[0]==='points').every(c=>c[3]===undefined||c[3]===null));
});
test('modo pontos amplia a amostra por areas fixas e nao baixa de novo ao mover',async()=>{
  const s=scene();const original=s.source.points;const areas=[];
  s.source.points=async(ex,code,bbox)=>{
    const data=await original(ex,code,bbox);
    if(bbox){areas.push(bbox);data.nodes[0].id=String(bbox);data.nodes.push({...data.nodes[0]});}
    return data;
  };
  await s.city.abrir({id:12,threshold_minutes:15},{},'health');
  await s.city.trocarModo('pontos');
  assert.equal(areas.length,4);assert.equal(s.circles.length,4,'deduplica pontos nas divisas das areas');
  const initial=s.calls.length;
  for(let i=0;i<20;i++)s.mover();
  await s.city.trocarModo('calor');await s.city.trocarModo('pontos');
  assert.equal(s.calls.length,initial);
});
test('resposta atrasada de uma categoria nao substitui a categoria atual',async()=>{
  const s=scene();let finish;
  const original=s.source.points;
  s.source.points=(ex,code)=>code==='health'?new Promise(resolve=>{finish=()=>original(ex,code).then(resolve);}):original(ex,code);
  const opening=s.city.abrir({id:12,threshold_minutes:15},{},'health');
  await new Promise(resolve=>setImmediate(resolve));
  await s.city.trocarCategoria('culture');
  await finish();await opening;
  assert.equal(s.drawn.at(-1)[0].min,20);
});
test('fechar cidade durante download nao volta a desenhar dados antigos',async()=>{
  const s=scene();let finish;
  s.source.metadata=()=>new Promise(resolve=>{finish=()=>resolve({bounds:[[-24,-47],[-23,-46]],center:[-23.5,-46.5]});});
  const opening=s.city.abrir({id:12},{});
  s.city.fechar();finish();await opening;
  assert.equal(s.calls.filter(c=>c[0]==='points').length,0);
  assert.equal(s.drawn.at(-1).length,0);
});
