const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa regioes.js e mapa-mundo.js de verdade; o Leaflet, o DOM e a API são substituídos.
// Brasil com SP e MG (com cidades), Acre, DF e um RJ em forma de U (sem cidades) e França com 1 região.
const quadrado = (oeste, sul, leste, norte) => ({type:"Polygon", coordinates:[[[oeste,sul],[leste,sul],[leste,norte],[oeste,norte],[oeste,sul]]]});
const PAISES = {type:"FeatureCollection", features:[
  {type:"Feature", properties:{codigo:"BRA", nomes:["Brazil","BRA","Brasil"]}, geometry:quadrado(-74, -34, -34, 5)},
  {type:"Feature", properties:{codigo:"FRA", nomes:["France","FRA"]}, geometry:quadrado(-5, 42, 8, 51)},
]};
const ESTADOS = {type:"FeatureCollection", features:[
  {type:"Feature", properties:{pais:"BRA", id:"BRA-1311", nome:"São Paulo"}, geometry:quadrado(-53, -25, -44, -20)},
  {type:"Feature", properties:{pais:"BRA", id:"BRA-601", nome:"Minas Gerais"}, geometry:quadrado(-51, -20, -40, -14)},
  {type:"Feature", properties:{pais:"BRA", id:"BRA-576", nome:"Acre"}, geometry:quadrado(-74, -11, -66, -7)},
  {type:"Feature", properties:{pais:"BRA", id:"BRA-599", nome:"Federal"}, geometry:quadrado(-48.3, -16.1, -47.3, -15.4)},
  // U aberto para o norte: o centro geométrico (-43, -21,75) cai no vão, fora da forma.
  {type:"Feature", properties:{pais:"BRA", id:"BRA-RJ", nome:"Rio de Janeiro"}, geometry:{type:"Polygon", coordinates:[[
    [-45,-23],[-41,-23],[-41,-20],[-42,-20],[-42,-22],[-44,-22],[-44,-20],[-45,-20],[-45,-23]]]}},
  {type:"Feature", properties:{pais:"FRA", id:"FRA-1", nome:"Île-de-France"}, geometry:quadrado(1, 48, 3.5, 49.5)},
]};
const RESUMO = [
  {city_id:1, name:"Santos", country:"Brazil", execution_id:11, total_population:100, selected_population:50, selected_coverage_percentage:50},
  {city_id:2, name:"Campinas", country:"Brazil", execution_id:12, total_population:300, selected_population:30, selected_coverage_percentage:10},
  {city_id:3, name:"Belo Horizonte", country:"Brazil", execution_id:13, total_population:200, selected_population:20, selected_coverage_percentage:10},
  {city_id:4, name:"Paris", country:"France", execution_id:14, total_population:100, selected_population:80, selected_coverage_percentage:80},
];
const cidade = (id, nome, pais, geometria) => ({type:"Feature", properties:{city_id:id, name:nome, country:pais}, geometry:geometria});
const CONTORNOS = {type:"FeatureCollection", features:[
  cidade(1, "Santos", "Brazil", quadrado(-46.5, -24.1, -46.2, -23.8)),
  cidade(2, "Campinas", "Brazil", quadrado(-47.2, -23.0, -46.9, -22.7)),
  cidade(3, "Belo Horizonte", "Brazil", quadrado(-44.1, -20.0, -43.8, -19.7)),
  cidade(4, "Paris", "France", quadrado(2.2, 48.8, 2.5, 48.95)),
]};

function limites(pontos) {
  const b = {s:Infinity, w:Infinity, n:-Infinity, e:-Infinity};
  const caixa = {
    extend(outro) {
      if (outro?.getSouthWest) { this.extend([outro.s, outro.w]); this.extend([outro.n, outro.e]); return this; }
      const lat = outro.lat ?? outro[0], lng = outro.lng ?? outro[1];
      b.s = Math.min(b.s, lat); b.n = Math.max(b.n, lat); b.w = Math.min(b.w, lng); b.e = Math.max(b.e, lng);
      return this;
    },
    get s() { return b.s; }, get w() { return b.w; }, get n() { return b.n; }, get e() { return b.e; },
    isValid: () => Number.isFinite(b.s),
    getSouthWest: () => ({lat:b.s, lng:b.w}), getNorthEast: () => ({lat:b.n, lng:b.e}),
    getNorthWest: () => ({lat:b.n, lng:b.w}), getSouthEast: () => ({lat:b.s, lng:b.e}),
    getCenter: () => ({lat:(b.s + b.n) / 2, lng:(b.w + b.e) / 2}),
    contains: ([lat, lng]) => lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e,
    pad() { return this; },
  };
  for (const p of pontos) caixa.extend(p);
  return caixa;
}
function coordenadas(geometria) {
  return (geometria.type === "Polygon" ? [geometria.coordinates] : geometria.coordinates).flat(2);
}

async function cena({contornosDepois = false} = {}) {
  const mapa = {camadas:new Set(), enquadramentos:[], voos:0, eventos:{},
    on(nome, fn) { this.eventos[nome] = fn; }, once() {}, hasLayer(c) { return this.camadas.has(c); },
    invalidateSize() {}, getSize: () => ({x:800, y:600}),
    fitBounds(b) { this.enquadramentos.push(b); }, flyToBounds(b) { this.enquadramentos.push(b); this.voos++; },
    latLngToContainerPoint: p => ({x:(p.lng ?? p[1]) * 10, y:-(p.lat ?? p[0]) * 10}),
    getZoom: () => 4, getMinZoom: () => 1, getCenter: () => ({lat:0, lng:0})};
  const L = {
    latLngBounds: pontos => limites(pontos),
    layerGroup: () => ({itens:[], clearLayers() { this.itens.length = 0; }, addTo(m) { m.camadas.add(this); return this; }}),
    divIcon: opcoes => opcoes,
    marker: (posicao, opcoes) => ({posicao, opcoes, eventos:{}, on(nome, fn) { this.eventos[nome] = fn; return this; }, addTo(g) { g.itens.push(this); return this; }}),
    geoJSON(dados, opcoes = {}) {
      const features = dados.type === "FeatureCollection" ? dados.features : [dados];
      const camada = {features, formas:[], addTo(g) { g.itens.push(this); return this; },
        getBounds: () => limites(features.flatMap(f => coordenadas(f.geometry).map(([lng, lat]) => [lat, lng])))};
      for (const feature of features) {
        const forma = {feature, eventos:{}, estilo:typeof opcoes.style === "function" ? opcoes.style(feature) : opcoes.style,
          on(nome, fn) { this.eventos[nome] = fn; return this; }, bindTooltip() { return this; },
          setStyle(s) { this.estiloAtual = s; }, bringToFront() {}, closeTooltip() {}};
        opcoes.onEachFeature?.(feature, forma);
        camada.formas.push(forma);
      }
      return camada;
    },
  };
  let liberarContornos;
  const contornosProntos = new Promise(ok => { liberarContornos = ok; });
  const rotas = [], cidadesAbertas = [];
  const elementos = new Map();
  const contexto = {
    window: {L, Cores:{css:v => `cor${v}`, degrade:() => ""}, CityMapViewport:{resize() {}, showWorld() {}},
      CityDataSource:{boundaries: async () => { if (contornosDepois) await contornosProntos; return CONTORNOS; }}},
    document: {
      querySelectorAll: () => ["health", "education", "food", "culture"].map(value => ({value, addEventListener() {}})),
      getElementById: id => { if (!elementos.has(id)) elementos.set(id, {textContent:""}); return elementos.get(id); },
    },
    fetch: async url => ({ok:true, json: async () => (String(url).includes("paises") ? PAISES : ESTADOS)}),
    console, Intl, Map, Set, Number, Math, String, Array, Object, Promise, Boolean, JSON,
  };
  contexto.window.window = contexto.window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../regioes.js"), "utf8"), contexto);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../mapa-mundo.js"), "utf8"), contexto);
  const mundo = contexto.window.MapaMundo;
  const iniciando = mundo.iniciar({mapaDaTela:mapa, resumo:RESUMO, aoAbrirRegiao:c => rotas.push(c), aoEscolherCidade:id => cidadesAbertas.push(id)});
  if (!contornosDepois) await iniciando;
  const grupos = () => [...mapa.camadas];
  // Todas as formas desenhadas agora (países, estados ou cidades).
  const formas = () => grupos().flatMap(g => g.itens).filter(c => c.formas).flatMap(c => c.formas);
  const marcadores = () => grupos().flatMap(g => g.itens).filter(c => c.opcoes?.icon);
  const rotulos = () => marcadores().map(c => c.opcoes.icon.html);
  const rotulo = texto => marcadores().find(c => c.opcoes.icon.html.includes(`>${texto}<`));
  return {mundo, mapa, rotas, cidadesAbertas, formas, rotulos, rotulo, regioes:contexto.window.RegioesMapa, liberarContornos, iniciando};
}
const nomeDa = forma => forma.feature.properties.nomes?.[0] ?? forma.feature.properties.nome ?? forma.feature.properties.name;

test("mundo mostra só os países com cidades, sem cidades soltas, e clicar abre o país", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, []);
  const desenhadas = c.formas();
  assert.deepEqual(desenhadas.map(nomeDa).sort(), ["Brazil", "France"]);
  desenhadas.find(f => nomeDa(f) === "Brazil").eventos.click();
  assert.equal(JSON.stringify(c.rotas.at(-1)), JSON.stringify(["pais:BRA"]));
});

test("país mostra todos os estados pintados pela média das cidades; sem cidades fica cinza e sem clique", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, ["pais:BRA"]);
  const estados = c.formas();
  assert.deepEqual(estados.map(nomeDa).sort(), ["Acre", "Federal", "Minas Gerais", "Rio de Janeiro", "São Paulo"]);
  // São Paulo: (50 + 30) / (100 + 300) = 20% da população com acesso
  const sp = c.mundo.estatistica("estado:BRA-1311");
  assert.equal(sp.cidades, 2);
  assert.equal(sp.percentual, 20);
  const acre = estados.find(f => nomeDa(f) === "Acre");
  assert.equal(acre.estilo.fillColor, "#cfd5de");
  assert.equal(acre.eventos.click, undefined, "estado sem cidades não abre");
  estados.find(f => nomeDa(f) === "São Paulo").eventos.click();
  assert.equal(JSON.stringify(c.rotas.at(-1)), JSON.stringify(["pais:BRA", "estado:BRA-1311"]));
  assert.ok(c.rotulos().some(html => html.includes(">SP<")), "sigla do estado no mapa");
  assert.equal(c.regioes.estadosDoPais("pais:BRA").find(e => e.id === "estado:BRA-599").nome, "Distrito Federal");
});

test("estado mostra só as cidades dele (as outras não aparecem) e os vizinhos apagados e clicáveis", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, ["pais:BRA", "estado:BRA-1311"]);
  const cidades = c.formas().filter(f => f.feature.properties.city_id);
  assert.deepEqual(cidades.map(nomeDa).sort(), ["Campinas", "Santos"]);
  cidades.find(f => nomeDa(f) === "Santos").eventos.click();
  assert.deepEqual(c.cidadesAbertas, ["1"]);
  const minas = c.formas().find(f => nomeDa(f) === "Minas Gerais");
  assert.equal(minas.estilo.fillOpacity, 0.25);
  minas.eventos.click();
  assert.equal(JSON.stringify(c.rotas.at(-1)), JSON.stringify(["pais:BRA", "estado:BRA-601"]));
});

test("a troca de nível é um voo suave e links antigos com continente continuam abrindo o país", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, []);
  assert.equal(c.mapa.voos, 0, "a primeira vista não voa");
  c.mundo.mostrar({}, null, ["continente:South America", "pais:BRA"]);
  assert.equal(c.mapa.voos, 1);
  assert.ok(c.formas().some(f => nomeDa(f) === "São Paulo"));
});

test("antes de os contornos chegarem o país já aparece; os estados ganham cor quando eles chegam", async () => {
  const c = await cena({contornosDepois:true});
  await new Promise(ok => setImmediate(ok));
  c.mundo.mostrar({}, null, ["pais:BRA"]);
  const antes = c.formas().find(f => nomeDa(f) === "São Paulo");
  assert.equal(antes.estilo.fillColor, "#cfd5de", "sem contornos ainda não se sabe o estado de cada cidade");
  c.liberarContornos();
  await c.iniciando;
  const depois = c.formas().find(f => nomeDa(f) === "São Paulo");
  assert.notEqual(depois.estilo.fillColor, "#cfd5de");
});

test("tocar no nome do estado também abre o estado; nome de estado sem cidades não abre", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, ["pais:BRA"]);
  const sp = c.rotulo("SP");
  assert.equal(sp.opcoes.interactive, true);
  sp.eventos.click();
  assert.equal(JSON.stringify(c.rotas.at(-1)), JSON.stringify(["pais:BRA", "estado:BRA-1311"]));
  const acre = c.rotulo("AC");
  assert.equal(acre.opcoes.interactive, false);
  assert.equal(acre.eventos.click, undefined);
  // No mapa-múndi, o nome do país também abre o país.
  c.mundo.mostrar({}, null, []);
  c.rotulo("Brasil").eventos.click();
  assert.equal(JSON.stringify(c.rotas.at(-1)), JSON.stringify(["pais:BRA"]));
});

test("o nome fica dentro do estado mesmo quando o centro geométrico cai fora (estado curvo)", async () => {
  const c = await cena();
  c.mundo.mostrar({}, null, ["pais:BRA"]);
  const [lat, lng] = c.rotulo("RJ").posicao;
  const dentroDoU = lng > -45 && lng < -41 && lat > -23 && lat < -20 && !(lng > -44 && lng < -42 && lat > -22);
  assert.ok(dentroDoU, `rótulo do RJ em ${lat}, ${lng} caiu fora da forma`);
});
