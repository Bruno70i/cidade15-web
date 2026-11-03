const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function navegador(initial='http://localhost:8080/') {
  const entries=[{url:'https://anterior.example/',state:null},{url:initial,state:null}];
  let index=1;const events={},views=[];
  const current=()=>new URL(entries[index].url);
  const location={};
  for(const name of ['href','pathname','search','hash']) Object.defineProperty(location,name,{get:()=>current()[name]});
  function traverse(step) {
    const next=index+step;
    if(next<0||next>=entries.length)return;
    index=next;
    if(current().origin==='http://localhost:8080') queueMicrotask(()=>events.popstate?.({state:entries[index].state}));
  }
  const history={
    get state(){return entries[index].state;},
    replaceState(state,title,url){entries[index]={url:new URL(url,current()).href,state};},
    pushState(state,title,url){const target=new URL(url,current()).href;entries.splice(++index,entries.length,{url:target,state});},
    back:()=>traverse(-1),forward:()=>traverse(1),
  };
  const context={window:{history,location,addEventListener:(name,fn)=>{events[name]=fn;}},URLSearchParams,Set};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../navegacao.js'),'utf8'),context);
  const nav=context.window.NavegacaoMapa.criar({aoNavegar:route=>views.push(route)});
  return {nav,history,location,entries,views,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('voltar do navegador sai da cidade para o mapa global e avancar restaura a categoria',async()=>{
  const n=navegador();n.nav.iniciar();n.nav.abrirCidade('2','health');
  n.history.back();await n.flush();
  assert.equal(n.location.href,'http://localhost:8080/');assert.equal(n.views.at(-1).cidade,null);
  n.history.forward();await n.flush();
  assert.equal(n.views.at(-1).cidade,'2');assert.equal(n.views.at(-1).categoria,'health');
});
test('categorias e troca entre cidades nao exigem varios toques para voltar ao global',async()=>{
  const n=navegador();n.nav.iniciar();n.nav.abrirCidade('2');
  n.nav.atualizarCategoria('food');n.nav.atualizarCategoria('culture');n.nav.abrirCidade('5','education');
  assert.equal(n.entries.length,3);
  n.history.back();await n.flush();
  assert.equal(n.views.at(-1).cidade,null);assert.equal(n.location.hash,'');
});
test('link direto de cidade tem o mapa global abaixo e preserva parametros da pagina',async()=>{
  const n=navegador('http://localhost:8080/?origem=teste#cidade=5&categoria=culture');
  const initial=n.nav.iniciar();assert.equal(initial.cidade,'5');assert.equal(initial.categoria,'culture');
  n.history.back();await n.flush();
  assert.equal(n.location.href,'http://localhost:8080/?origem=teste');assert.equal(n.views.at(-1).cidade,null);
});
test('inicializar duas vezes e voltar pelo botao do site nao acumula entradas',async()=>{
  const n=navegador('http://localhost:8080/#cidade=5');
  n.nav.iniciar();n.nav.iniciar();assert.equal(n.entries.length,3);
  n.nav.voltarGlobal();n.nav.voltarGlobal();await n.flush();
  assert.equal(n.location.href,'http://localhost:8080/');assert.equal(n.entries.length,3);
  n.history.back();await n.flush();assert.equal(n.location.href,'https://anterior.example/');
});
test('no mapa global o usuario consegue sair normalmente com o proximo voltar',async()=>{
  const n=navegador();n.nav.iniciar();
  assert.equal(n.entries.length,2);n.history.back();await n.flush();
  assert.equal(n.location.href,'https://anterior.example/');assert.equal(n.views.length,0);
});
test('link da metodologia continua reconhecido e categorias invalidas usam Geral',()=>{
  const n=navegador('http://localhost:8080/#metodologia');
  assert.equal(n.nav.iniciar().metodologia,true);
  n.nav.abrirCidade('2','invalida');assert.equal(n.nav.ler().categoria,'overall');
  assert.equal(n.location.hash,'#cidade=2');
});
