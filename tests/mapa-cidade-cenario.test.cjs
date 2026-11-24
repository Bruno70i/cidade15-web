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
      Cores: { css: () => "" },
      L: { layerGroup: grupo, canvas: () => ({}), svg: () => ({}), geoJSON: () => grupo(), circleMarker: () => ({ bindTooltip() { return this; }, addTo() { return this; } }) },
      CityMapData: { create: () => fonte },
      CamadaCalor: { criar: () => ({ addTo() { return this; }, definir(pontos, posicaoDe) { desenhos.push({ pontos, posicaoDe }); } }) },
    },
    Intl, Number, Map, Set, Math, Object, Array, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../mapa-cidade.js"), "utf8"), contexto);
  const cidade = contexto.window.MapaCidade;
  cidade.iniciar(mapa, { carregando() {}, erro(e) { throw new Error(e); } });
  // Quantos pontos aparecem com acesso (posicao >= 0,5 = ate 15 min) no ultimo desenho.
  const comAcesso = () => { const d = desenhos.at(-1); return d.pontos.filter((p) => d.posicaoDe(p) >= 0.5).length; };
  return { cidade, comAcesso };
}
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
