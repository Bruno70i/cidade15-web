const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('a visao geral enquadra o mundo e usa IDs para cidades de paises diferentes',async()=>{
  let worldViews=0,boundaryCalls=0; const clicked=[], shapes=[];
  const checks=['health','education','food','culture'].map(value=>({value,addEventListener(){}}));
  const summary=[{city_id:1,name:'Santa Maria',country:'Brazil',selected_coverage_percentage:10},{city_id:2,name:'Santa Maria',country:'France',selected_coverage_percentage:90}];
  const contours={type:'FeatureCollection',features:[...summary,{city_id:99,name:'Sem analise',country:'Brazil'}].map(c=>({type:'Feature',properties:{city_id:c.city_id,name:c.name,country:c.country},geometry:{type:'Polygon',coordinates:[]}}))};
  const map={getSize:()=>({x:800,y:600}),invalidateSize(){},on(){},getZoom:()=>8,hasLayer:()=>false,fitWorld(){throw new Error('fitWorld encolhe o mapa e deixa faixas vazias');},fitBounds(){},removeLayer(){}};
  const context={window:{CityMapViewport:{showWorld(){worldViews++;}},CityDataSource:{boundaries:async()=>{boundaryCalls++;return contours;}},Cores:{css:value=>String(value),degrade:()=>''},L:{geoJSON:(geo,options)=>{
    for(const feature of geo.features){const handlers={};const shape={bindTooltip(){},on:(name,fn)=>{handlers[name]=fn;},setStyle(){}};options.onEachFeature?.(feature,shape);shapes.push({feature,handlers,color:options.style(feature).fillColor});}
    return {setStyle(){},resetStyle(){},addTo(){}};
  }}},document:{querySelectorAll:()=>checks,getElementById:()=>({textContent:''})},Intl,Map,Set,Number};
  const file=fs.existsSync(path.join(__dirname,'../mapa-mundo.js'))?'../mapa-mundo.js':'../mapa-estado.js';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
  const world=context.window.MapaMundo||context.window.MapaEstado;
  await world.iniciar({mapaDaTela:map,resumo:summary,aoEscolherCidade:id=>clicked.push(id)});
  world.mostrar({});
  assert.equal(boundaryCalls,1);assert.equal(worldViews,1);assert.equal(shapes.length,2,'somente cidades processadas');
  assert.notEqual(shapes[0].color,shapes[1].color);
  shapes[0].handlers.click();shapes[1].handlers.click();
  assert.deepEqual(clicked,['1','2']);
});

async function destaquesGlobais() {
  let boundaryCalls=0,scale=2,west=-180,east=180;
  const rotas=[];
  const markers=[],handlers={},layers=new Set(),enquadramentos=[];
  const summary=[{city_id:1,name:'Santos',country:'Brazil',selected_coverage_percentage:10},
    {city_id:2,name:'Guaruja',country:'Brazil',selected_coverage_percentage:20},
    {city_id:3,name:'Paris',country:'France',selected_coverage_percentage:90}];
  const features=[...summary,{city_id:99,name:'Sem analise',country:'Spain'}].map((item,i)=>({type:'Feature',properties:{city_id:item.city_id,name:item.name,country:item.country},
    geometry:{type:'Polygon',coordinates:[]},box:i<2?[[-24,-48],[-23,-46]]:i===2?[[48.8,2.2],[48.9,2.4]]:[[40,-4],[41,-3]]}));
  function bounds(points) {
    const b={south:points[0][0],west:points[0][1],north:points[1][0],east:points[1][1],isValid:()=>true,
      getSouthWest(){return {lat:this.south,lng:this.west};},getNorthEast(){return {lat:this.north,lng:this.east};},
      getCenter(){return {lat:(this.south+this.north)/2,lng:(this.west+this.east)/2};},
      extend(other){this.south=Math.min(this.south,other.south);this.north=Math.max(this.north,other.north);this.west=Math.min(this.west,other.west);this.east=Math.max(this.east,other.east);return this;}};
    return b;
  }
  const map={getSize:()=>({x:720,y:600}),invalidateSize(){},getZoom:()=>2,
    getBounds:()=>({getWest:()=>west,getEast:()=>east}),
    latLngToContainerPoint:position=>{const lat=position.lat??position[0],lng=position.lng??position[1];return {x:(lng-west)*scale,y:(90-lat)*Math.min(scale,2)};},
    on:(events,fn)=>{for(const event of events.split(' '))handlers[event]=fn;},hasLayer:layer=>layers.has(layer),
    removeLayer(layer){layers.delete(layer);},fitBounds(b,options){enquadramentos.push({bounds:b,options});}};
  const context={window:{CityMapViewport:{showWorld(){}},CityDataSource:{boundaries:async()=>{boundaryCalls++;return {features};}},
    Cores:{css:()=>'',degrade:()=>''},L:{latLngBounds:points=>bounds(points.map(p=>[p.lat??p[0],p.lng??p[1]])),
      layerGroup:()=>({clearLayers(){markers.length=0;},addTo(){layers.add(this);return this;}}),divIcon:options=>options,
      marker:(position,options)=>{const marker={position,options,bindTooltip(){return this;},on(event,fn){this[event]=fn;return this;},addTo(){markers.push(this);return this;}};return marker;},
      geoJSON:(geo,options)=>{for(const feature of geo.features)options.onEachFeature(feature,{bindTooltip(){},on(){},getBounds:()=>bounds(feature.box)});
        return {setStyle(){},addTo(){layers.add(this);return this;}};},
    }},document:{querySelectorAll:()=>['health','education','food','culture'].map(value=>({value,addEventListener(){}})),getElementById:()=>({textContent:''})},Intl,Map,Set,Number,Math};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../mapa-mundo.js'),'utf8'),context);
  const world=context.window.MapaMundo;
  await world.iniciar({mapaDaTela:map,resumo:summary,aoAbrirRegiao:rota=>rotas.push(rota),aoEscolherCidade:()=>{throw new Error('destaque deve aproximar, sem escolher uma cidade arbitraria');}});
  return {world,markers,handlers,enquadramentos,context,rotas,get calls(){return boundaryCalls;},view(s,w=-180,e=180){scale=s;west=w;east=e;handlers.moveend?.();handlers.zoomend?.();}};
}

test('zoom distante indica cada regiao analisada uma vez e clicar aproxima os contornos',async()=>{
  const t=await destaquesGlobais();t.world.mostrar({});
  assert.equal(t.markers.length,2,'duas regioes, sem um marcador por cidade ou em pais sem analise');
  assert.deepEqual(Array.from(t.markers[0].position),[-23.5,-47]);
  assert.ok(Math.abs(t.markers[1].position[0]-48.85)<1e-10);
  assert.equal(t.markers[1].position[1],2.3);
  t.markers[0].click();
  assert.equal(t.enquadramentos.length,1);
  assert.equal(t.enquadramentos[0].bounds.west,-48);
  assert.equal(t.enquadramentos[0].bounds.east,-46);
});

test('destaques somem quando a regiao fica legivel e reaparecem ao afastar sem novas consultas',async()=>{
  const t=await destaquesGlobais();t.world.mostrar({});
  t.view(80);assert.equal(t.markers.length,1,'estado ja legivel; Paris ainda precisa de destaque');
  t.view(1200);assert.equal(t.markers.length,0,'nenhum destaque cobre contornos proximos');
  t.view(2);assert.equal(t.markers.length,2);
  for(let i=0;i<20;i++)t.handlers.moveend?.();
  assert.equal(t.calls,1);
  t.world.esconder();t.handlers.moveend?.();assert.equal(t.markers.length,0,'nenhum destaque no modo cidade');
});

test('copias horizontais do mundo mantem indicacao e aproximam a copia clicada',async()=>{
  const t=await destaquesGlobais();t.world.mostrar({});t.view(2,180,540);
  assert.equal(t.markers.length,2);
  assert.equal(t.markers[0].position[1],313);
  t.markers[0].click();assert.equal(t.enquadramentos[0].bounds.west,312);
});

test('aproximar usa as margens atuais apos mudar a largura ou recolher o painel',async()=>{
  const t=await destaquesGlobais();let esquerda=460;
  t.world.mostrar(()=>({paddingTopLeft:[esquerda,90]}));
  t.markers[0].click();assert.equal(t.enquadramentos[0].options.paddingTopLeft?.[0],460);
  esquerda=16;
  t.markers[0].click();assert.equal(t.enquadramentos[1].options.paddingTopLeft?.[0],16);
});

test('paises ficam selecionaveis sem sobrepor cartoes ao mapa',async()=>{
  const t=await destaquesGlobais();
  t.context.window.RegioesMapa={obter:()=>null,filhas:()=>[{id:"pais:FRA"},{id:"pais:BEL"}]};
  t.world.mostrar({});
  assert.equal(t.markers.length,0);
});

test('tocar na China a partir da Europa abre o caminho Asia > China',async()=>{
  const t=await destaquesGlobais();
  const europa={id:'continente:Europe',bounds:{},caminho:['continente:Europe']};
  const china={id:'pais:CHN',caminho:['continente:Asia','pais:CHN']};
  const feature={properties:{codigo:'CHN',nomes:['China']}};
  t.context.window.CityMapViewport.resize=()=>{};
  t.context.window.RegioesMapa={
    obter:id=>id===europa.id?europa:id===china.id?china:null,
    filhas:()=>[],
    carregarPaises:async()=>({features:[feature]}),
  };
  let tocar;
  t.context.window.L.geoJSON=(geo,options)=>{
    const classes={toggle(){}};
    const forma={feature,on:(_,fn)=>{tocar=fn;},getElement:()=>({classList:classes,setAttribute(){}})};
    options.onEachFeature(feature,forma);
    return {addTo(){},bringToBack(){},eachLayer(fn){fn(forma);}};
  };
  t.world.mostrar({},null,europa.caminho);
  await new Promise(resolve=>setImmediate(resolve));
  tocar();
  assert.deepEqual(t.rotas,[china.caminho]);
});
