const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa o modulo real do mapa da cidade; Leaflet, calor e servico de mapas sao substituidos.
// 100 pontos de rua em linha (a cada ~102 m), todos a 40 min de saude: ninguem tem acesso hoje.
function cena() {
  const desenhos = [];
  const grupo = () => ({ clearLayers() {}, addTo() { return this; } });
  const mapa = {
    createPane: () => ({ style: {} }), on() {}, invalidateSize() {}, getSize: () => ({ x: 800 }), fitBounds() {}, getZoom: () => 13,
    getBounds: () => ({ pad() { return { contains: () => true }; } }),
  };
  const nos = Array.from({ length: 100 }, (_, i) => ({
    id: i, lat: -23.5, lon: -46.6 + i * 0.001, categories: { health: { reachable: true, minutes: 40 } },
  }));
  const fonte = {
    metadata: async () => ({ execution_id: 12, bounds: [[-24, -47], [-23, -46]], boundary: null }),
    points: async (id, categoria) => ({ execution_id: 12, category: categoria, nodes: nos, services: [] }),
  };
  const contexto = {
    window: {
      Cores: { css: () => "", degrade: () => "" },
      L: { layerGroup: grupo, canvas: () => ({}), svg: () => ({}), geoJSON: () => grupo(), circleMarker: () => ({ bindTooltip() { return this; }, addTo() { return this; } }) },
      CityMapData: { create: () => fonte },
      CamadaCalor: { criar: () => ({ addTo() { return this; }, definir(pontos, posicaoDe, recorte, opcoes = {}) { desenhos.push({ pontos, posicaoDe, opcoes }); } }) },
    },
    Intl, Number, Map, Set, Math, Object, Array, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../mapa-cidade.js"), "utf8"), contexto);
  const cidade = contexto.window.MapaCidade;
  cidade.iniciar(mapa, { carregando() {}, erro(e) { throw new Error(e); } });
  // Quantos pontos aparecem com acesso (posicao >= 0,5 = ate 15 min) no ultimo desenho.
  const comAcesso = () => { const d = desenhos.at(-1); return d.pontos.filter((p) => d.posicaoDe(p) >= 0.5).length; };
  return { cidade, comAcesso, desenhos };
}
// Resposta da rota /optimize (sugestão de locais): ganho em pontos percentuais da população.
const sugestao = (ganho, locais = [{ latitude: -23.5, longitude: -46.53 }]) => ({
  category: "health", k_requested: locais.length,
  locations: locais.map((local, i) => ({ rank: i + 1, node_id: i, marginal_population: 100, ...local })),
  baseline_coverage_percentage: 0, simulated_coverage_percentage: ganho, coverage_delta_percentage_points: ganho,
});
const simulacao = (ganhoNos) => ({
  added_services: [{ category: "health", name: "Novo local 1", latitude: -23.5, longitude: -46.55 }],
  results: { health: { nodes: { before: { coverage_percentage: 0 }, after: { coverage_percentage: ganhoNos } } } },
});

test("depois da simulacao o mapa de calor melhora perto do novo local na medida do resultado exato", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  assert.equal(c.comAcesso(), 0);
  c.cidade.definirCenario(simulacao(11));
  assert.equal(c.cidade.vendoDepois(), true);
  const depois = c.comAcesso();
  assert.ok(depois >= 9 && depois <= 13, `esperava ~11 pontos com acesso, veio ${depois}`);
  // O botao "Antes" volta as cores atuais; "Com os novos locais" mostra de novo.
  c.cidade.mostrarDepois(false);
  assert.equal(c.comAcesso(), 0);
  c.cidade.mostrarDepois(true);
  assert.equal(c.comAcesso(), depois);
});

test("ajuste segue o resultado: ganho maior pinta mais pontos; sem simulacao volta ao atual", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  c.cidade.definirCenario(simulacao(5));
  const pouco = c.comAcesso();
  c.cidade.definirCenario(simulacao(15));
  const muito = c.comAcesso();
  assert.ok(muito > pouco, `${muito} deveria ser maior que ${pouco}`);
  c.cidade.definirCenario(null);
  assert.equal(c.cidade.vendoDepois(), false);
  assert.equal(c.comAcesso(), 0);
});

test("a sugestão de locais muda o mapa de calor sozinha, na medida do ganho calculado", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  assert.equal(c.comAcesso(), 0);
  c.cidade.definirSugestao(sugestao(8));
  assert.equal(c.cidade.vendoDepois(), true);
  assert.equal(c.cidade.fonteDoCenario(), "sugestao");
  const depois = c.comAcesso();
  assert.ok(depois >= 6 && depois <= 10, `esperava ~8 pontos com acesso, veio ${depois}`);
  assert.match(c.cidade.legenda().titulo, /com os locais sugeridos \(estimativa\)/);
  assert.match(c.cidade.legenda().nota, /ganho calculado pela sugestão/);
  // Os pontos que melhoram são os mais perto do local sugerido (-46,53 = ponto 70).
  const ultimo = c.desenhos.at(-1);
  const melhoraram = ultimo.pontos.filter((p) => ultimo.posicaoDe(p) >= 0.5).map((p) => p.id);
  assert.ok(melhoraram.every((id) => Math.abs(id - 70) <= 6), `pontos longe do local: ${melhoraram}`);
  // Limpar a sugestão volta às cores atuais.
  c.cidade.definirSugestao(null);
  assert.equal(c.cidade.vendoDepois(), false);
  assert.equal(c.comAcesso(), 0);
});

test("sugestão sem pontos não muda o mapa", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  c.cidade.definirSugestao(sugestao(0, []));
  assert.equal(c.cidade.temCenario(), false);
  assert.equal(c.cidade.vendoDepois(), false);
  assert.equal(c.comAcesso(), 0);
});

test("vale o mais recente entre simulação e sugestão; cada botão traz o seu e limpar volta ao outro", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  c.cidade.definirCenario(simulacao(5));
  const daSimulacao = c.comAcesso();
  c.cidade.definirSugestao(sugestao(15));
  assert.equal(c.cidade.fonteDoCenario(), "sugestao");
  const daSugestao = c.comAcesso();
  assert.ok(daSugestao > daSimulacao, `${daSugestao} deveria ser maior que ${daSimulacao}`);
  c.cidade.mostrarDepois(true, "simulacao");
  assert.equal(c.cidade.fonteDoCenario(), "simulacao");
  assert.equal(c.comAcesso(), daSimulacao);
  c.cidade.mostrarDepois(false, "simulacao");
  assert.equal(c.comAcesso(), 0);
  c.cidade.mostrarDepois(true, "sugestao");
  assert.equal(c.comAcesso(), daSugestao);
  // Sugestão apagada: o mapa volta a mostrar a simulação que ainda existe.
  c.cidade.definirSugestao(null);
  assert.equal(c.cidade.fonteDoCenario(), "simulacao");
  assert.equal(c.cidade.vendoDepois(), true);
  assert.equal(c.comAcesso(), daSimulacao);
  // Uma simulação nova também passa a valer (ex.: "Simular impacto completo").
  c.cidade.definirSugestao(sugestao(15));
  c.cidade.definirCenario(simulacao(11));
  assert.equal(c.cidade.fonteDoCenario(), "simulacao");
});

test("trocar de cenário pede transição suave; abrir a cidade e trocar de categoria não", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  assert.equal(c.desenhos.at(-1).opcoes.animar, false, "primeiro desenho da cidade");
  c.cidade.definirSugestao(sugestao(8));
  assert.equal(c.desenhos.at(-1).opcoes.animar, true);
  c.cidade.mostrarDepois(false, "sugestao");
  assert.equal(c.desenhos.at(-1).opcoes.animar, true);
  await c.cidade.trocarCategoria("health");
  assert.equal(c.desenhos.at(-1).opcoes.animar, false);
});

test("abrir outra cidade apaga a sugestão e a simulação da anterior", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  c.cidade.definirCenario(simulacao(5));
  c.cidade.definirSugestao(sugestao(8));
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  assert.equal(c.cidade.temCenario(), false);
  assert.equal(c.cidade.fonteDoCenario(), null);
  assert.equal(c.comAcesso(), 0);
});

test("a mesma simulação que volta (ex.: Cancelar ao adicionar local) não toma o lugar da sugestão mais nova", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  const s = simulacao(5);
  c.cidade.definirCenario(s);
  c.cidade.definirSugestao(sugestao(8));
  c.cidade.mostrarDepois(false, "sugestao");
  c.cidade.definirCenario(null); // começou a adicionar um local: o resultado anterior deixa de valer
  c.cidade.definirCenario(s);    // cancelou: o mesmo resultado volta
  assert.equal(c.cidade.fonteDoCenario(), "sugestao");
  assert.equal(c.cidade.vendoDepois(), false);
  // Só com a simulação, ela volta a aparecer como antes.
  const d = cena();
  await d.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  const s2 = simulacao(5);
  d.cidade.definirCenario(s2);
  d.cidade.definirCenario(null);
  d.cidade.definirCenario(s2);
  assert.equal(d.cidade.fonteDoCenario(), "simulacao");
  assert.equal(d.cidade.vendoDepois(), true);
});

test("locais de saúde não mudam o mapa de educação: a legenda não diz que mudou", async () => {
  const c = cena();
  await c.cidade.abrir({ id: 12, threshold_minutes: 15, speed_kmh: 3 }, {}, "health");
  c.cidade.definirSugestao(sugestao(8));
  assert.equal(c.cidade.afetaCategoriaAtual(), true);
  await c.cidade.trocarCategoria("education");
  assert.equal(c.cidade.afetaCategoriaAtual(), false);
  assert.doesNotMatch(c.cidade.legenda().titulo, /locais sugeridos/);
  await c.cidade.trocarCategoria("overall");
  assert.equal(c.cidade.afetaCategoriaAtual(), true, "no índice geral a saúde conta");
});
