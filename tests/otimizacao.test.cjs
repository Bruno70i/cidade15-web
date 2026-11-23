const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa o modulo real; somente DOM, Leaflet e as chamadas remotas sao substituidos.
function iniciar(optimize, adicionarSugeridos = async () => ({ adicionados: 0, concluida: true })) {
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) {
      const texto = { textContent: "" };
      elementos.set(id, {
        textContent: "", innerHTML: "", hidden: false, disabled: false, eventos: {},
        setAttribute() {}, querySelector: () => texto, rotulo: texto,
        addEventListener(tipo, callback) { this.eventos[tipo] = callback; },
      });
    }
    return elementos.get(id);
  }
  function botoes(atributo, valores) {
    return valores.map((valor) => ({
      dataset: { [atributo]: String(valor) }, pressionado: "false", eventos: {},
      setAttribute(nome, v) { if (nome === "aria-pressed") this.pressionado = v; },
      addEventListener(tipo, callback) { this.eventos[tipo] = callback; },
    }));
  }
  const tipos = botoes("tipo", ["health", "education", "food", "culture"]);
  const quantidades = botoes("k", [1, 2, 3]);
  const marcadores = [];
  const camada = { addTo() { return this; }, clearLayers() { marcadores.length = 0; } };
  const mapa = {
    vistas: [], enquadramentos: [], getZoom: () => 13,
    setView(centro, zoom) { this.vistas.push([centro, zoom]); },
    fitBounds(limites, opcoes) { this.enquadramentos.push([limites, opcoes]); },
  };
  const pedidos = [];
  const contexto = {
    window: {
      L: {
        layerGroup: () => camada,
        divIcon: (valor) => valor,
        latLngBounds: (pontos) => pontos,
        marker(posicao, opcoes) {
          return {
            posicao, opcoes, aberto: false,
            bindTooltip(texto) { this.dica = texto; return this; },
            addTo() { marcadores.push(this); return this; },
            getLatLng() { return posicao; },
            openTooltip() { this.aberto = true; },
          };
        },
      },
      Icones: { cor: () => "#d1495b" },
      SimulacaoVista: {
        percentual: (valor) => `${valor}%`,
        impacto: (dados) => ({ titulo: `Aumento de ${dados.variacao} pontos.`, detalhe: `De ${dados.antes}% para ${dados.depois}%.` }),
      },
      CityDataSource: { optimize: async (...args) => { pedidos.push(args); return optimize(...args); } },
      Simulacao: { adicionarSugeridos },
    },
    document: {
      getElementById: elemento,
      querySelectorAll: (seletor) => (seletor.includes("otim-tipos") ? tipos : quantidades),
    },
    Intl,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../otimizacao.js"), "utf8"), contexto);
  const otimizacao = contexto.window.Otimizacao;
  let minimizado = 0;
  const categoriasDoCard = [];
  otimizacao.iniciar(mapa, {
    margens: () => ({ padding: [1, 1] }),
    antesDeMostrar: () => { minimizado++; },
    aoEscolherCategoria: (categoria) => { categoriasDoCard.push(categoria); },
  });
  otimizacao.reset({ id: 5913, city_id: 2, threshold_minutes: 15 });
  return {
    otimizacao, elemento, mapa, marcadores, pedidos, tipos, quantidades, categoriasDoCard,
    minimizado: () => minimizado,
    sugerir: () => elemento("otim-sugerir").eventos.click(),
    simular: () => elemento("otim-simular").eventos.click(),
    limpar: () => elemento("otim-limpar").eventos.click(),
    verNoMapa: (rank) => elemento("otim-lista").eventos.click({ target: { closest: () => ({ dataset: { rank: String(rank) } }) } }),
  };
}

const RESPOSTA = {
  execution_id: 5913, algorithm: "greedy", category: "health", k_requested: 3, threshold_minutes: 15, min_distance_m: 0,
  locations: [
    { rank: 1, node_id: 4021, latitude: -23.95, longitude: -46.33, marginal_population: 15405.4 },
    { rank: 2, node_id: 77, latitude: -23.96, longitude: -46.31, marginal_population: 10783 },
    { rank: 3, node_id: 5, latitude: -23.97, longitude: -46.36, marginal_population: 10374 },
  ],
  baseline_coverage_percentage: 80.1, simulated_coverage_percentage: 88.84,
  coverage_delta_percentage_points: 8.74, execution_time_seconds: 7.8,
};

test("envia categoria e quantidade escolhidas e desenha os pontos numerados", async () => {
  const app = iniciar(async () => RESPOSTA);
  app.otimizacao.escolherTipo("food");
  app.quantidades[2].eventos.click();
  await app.sugerir();
  assert.deepEqual(app.pedidos[0], [5913, "food", 3]);
  assert.deepEqual(app.categoriasDoCard, ["food"]); // card e mapa de calor acompanham a categoria
  assert.equal(app.quantidades[2].pressionado, "true");
  assert.equal(app.tipos[2].pressionado, "true");
  assert.equal(app.marcadores.length, 3);
  assert.match(app.marcadores[0].opcoes.icon.html, /<b>1<\/b>/);
  assert.match(app.marcadores[0].dica, /15\.405 pessoas/);
  assert.equal(app.elemento("otim-resultado").hidden, false);
  assert.match(app.elemento("otim-resumo").innerHTML, /3 locais sugeridos para Saúde/);
  assert.match(app.elemento("otim-lista").innerHTML, /\+10\.783 pessoas/);
  assert.equal(app.mapa.enquadramentos.length, 1);
  assert.equal(app.elemento("otim-simular").disabled, false);
  assert.equal(app.elemento("otim-mensagem").hidden, true);
});

test("ver no mapa centraliza o ponto e abre a dica", async () => {
  const app = iniciar(async () => RESPOSTA);
  await app.sugerir();
  app.verNoMapa(2);
  assert.equal(app.minimizado(), 1);
  assert.equal(JSON.stringify(app.mapa.vistas[0]), JSON.stringify([[-23.96, -46.31], 16]));
  assert.equal(app.marcadores[1].aberto, true);
});

test("menos pontos que o pedido explica o motivo", async () => {
  const app = iniciar(async () => ({ ...RESPOSTA, locations: RESPOSTA.locations.slice(0, 1) }));
  await app.sugerir();
  assert.match(app.elemento("otim-resumo").innerHTML, /1 local sugerido/);
  assert.match(app.elemento("otim-resumo").innerHTML, /Foram sugeridos 1 de 3/);
});

test("nenhum ganho mostra aviso e nao permite simular", async () => {
  const app = iniciar(async () => ({ ...RESPOSTA, locations: [], simulated_coverage_percentage: 80.1 }));
  await app.sugerir();
  assert.match(app.elemento("otim-resumo").innerHTML, /Nenhum ponto aumentaria o acesso a Saúde/);
  assert.equal(app.marcadores.length, 0);
  assert.equal(app.elemento("otim-simular").disabled, true);
});

test("cidade grande demais (503) mostra o limite em linguagem simples", async () => {
  const app = iniciar(async () => {
    const erro = new Error("x"); erro.status = 503;
    erro.detalhe = "Optimization exceeds the synchronous limit of 10000 nodes"; throw erro;
  });
  await app.sugerir();
  assert.match(app.elemento("otim-mensagem").textContent, /grande demais.*10\.000 pontos/);
  assert.equal(app.elemento("otim-resultado").hidden, true);
  assert.equal(app.elemento("otim-sugerir").disabled, false);
});

test("API antiga sem a rota avisa que ainda nao foi publicada", async () => {
  const app = iniciar(async () => { const erro = new Error("x"); erro.status = 404; erro.detalhe = "Not Found"; throw erro; });
  await app.sugerir();
  assert.match(app.elemento("otim-mensagem").textContent, /ainda não foi publicada/);
  assert.match(app.otimizacao.textoDoErro({ status: 404, detalhe: "Simulation data not prepared for this execution" }), /não está disponível para esta cidade/);
  assert.match(app.otimizacao.textoDoErro({ status: 422, detalhe: "Category 'x' not found in bundle. Available: []" }), /não foi analisada/);
});

test("trocar de cidade durante o calculo descarta a resposta antiga", async () => {
  let responder;
  const app = iniciar(() => new Promise((ok) => { responder = ok; }));
  const pendente = app.sugerir();
  assert.equal(app.elemento("otim-sugerir").disabled, true);
  app.otimizacao.reset({ id: 99, threshold_minutes: 15 });
  responder(RESPOSTA);
  await pendente;
  assert.equal(app.otimizacao.resultado(), null);
  assert.equal(app.marcadores.length, 0);
  assert.equal(app.elemento("otim-sugerir").disabled, false);
});

test("limpar remove os pinos e o resultado", async () => {
  const app = iniciar(async () => RESPOSTA);
  await app.sugerir();
  app.limpar();
  assert.equal(app.marcadores.length, 0);
  assert.equal(app.elemento("otim-resultado").hidden, true);
  assert.equal(app.otimizacao.resultado(), null);
});

test("simular impacto completo envia os pontos para a simulacao", async () => {
  const recebidos = [];
  const app = iniciar(async () => RESPOSTA, async (categoria, pontos) => { recebidos.push([categoria, pontos.length]); return { adicionados: 3, concluida: true }; });
  await app.sugerir();
  await app.simular();
  assert.deepEqual(recebidos, [["health", 3]]);
  assert.match(app.elemento("otim-mensagem").textContent, /Impacto calculado/);
  assert.equal(app.elemento("otim-simular").disabled, false);
});

test("sem cidade aberta o botao fica desligado", () => {
  const app = iniciar(async () => RESPOSTA);
  app.otimizacao.reset(null);
  assert.equal(app.elemento("otim-sugerir").disabled, true);
});
