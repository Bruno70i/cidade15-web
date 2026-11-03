const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Executa o modulo real; somente DOM, Leaflet e a chamada remota sao substituidos.
function iniciar(simulate, ajustar) {
  let nodeId=0;
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) {
      const texto = { textContent: "" };
      elementos.set(id, {
        textContent: "", hidden: false, disabled: false, eventos: {},
        setAttribute() {}, querySelector: () => texto,
        addEventListener(tipo, callback) { this.eventos[tipo] = callback; },
      });
    }
    return elementos.get(id);
  }
  const tipos = ["health", "education", "food", "culture"].map((tipo) => ({
    dataset: { tipo }, setAttribute() {}, addEventListener() {},
  }));
  const mapa = { eventos: {}, on(tipo, callback) { this.eventos[tipo] = callback; } };
  const camada = { addTo() { return this; }, clearLayers() {}, removeLayer() {} };
  const marcador = () => ({ bindTooltip() { return this; }, on() { return this; }, addTo() { return this; } });
  const contexto = {
    window: {
      L: { layerGroup: () => camada, marker: marcador, divIcon: (valor) => valor },
      Icones: { cor: () => "#2f6fe4", svg: () => "" },
      CityDataSource: { simulate },
      SimulacaoLocais: {criar:()=>({ajustar:ajustar || (async(ex,code,pos)=>({...pos,nodeId:String(++nodeId),distancia:0}))})},
    },
    document: {
      getElementById: elemento,
      querySelector: () => tipos[0], querySelectorAll: () => tipos,
      body: { classList: { toggle() {} } },
    },
    Intl,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../simulacao.js"), "utf8"), contexto);
  const simulacao = contexto.window.Simulacao;
  simulacao.iniciar(mapa, () => {});
  simulacao.reset({ id: 546, city_id: 2, threshold_minutes: 15, speed_kmh: 3 });
  return {
    simulacao, elemento,
    async adicionar() {
      elemento("sim-adicionar").eventos.click();
      return mapa.eventos.click({ latlng: { lat: -23.96, lng: -46.33 } });
    },
    entrar: () => elemento('sim-adicionar').eventos.click(),
    tocar: pos => mapa.eventos.click({latlng:pos}),
    calcular: () => elemento("sim-calcular").eventos.click(),
    limpar: () => elemento("sim-limpar").eventos.click(),
    cancelar: () => elemento("sim-mapa-cancelar").eventos.click(),
    concluir: () => elemento("sim-mapa-concluir").eventos.click(),
  };
}

test("sucesso atualiza o resultado sem exibir tempo de processamento no card", async () => {
  const metrics = (coverage) => ({
    coverage_percentage: coverage, unreachable_percentage: 0,
    mean_travel_time_minutes: 12, median_travel_time_minutes: 10,
  });
  const comparison = { before: metrics(30), after: metrics(35), coverage_delta_percentage_points: 5 };
  const overall = {
    before: { coverage_percentage: 20, unreachable_percentage: 0 },
    after: { coverage_percentage: 22, unreachable_percentage: 0 },
    coverage_delta_percentage_points: 2,
  };
  const resultado = {
    execution_id: 546,
    added_services: [{ category: "health", name: "Novo local 1", latitude: -23.96, longitude: -46.33, graph_node_index: 12, snap_distance_m: 5 }],
    results: { health: { population: comparison, nodes: comparison } },
    overall: { population: overall, nodes: overall }, processing_time_ms: 37,
  };
  const app = iniciar(async () => resultado);
  await app.adicionar();
  await app.calcular();
  assert.equal(app.simulacao.resultado(), resultado);
  assert.equal(app.elemento("sim-mensagem").textContent, "");
  assert.equal(app.elemento("sim-mensagem").hidden, true);
  assert.equal(app.elemento("sim-limpar").disabled, false);
});
test('cancelar a colocacao desfaz os locais da sessao',async()=>{
  const app=iniciar(async()=>{throw new Error('Nao deve calcular');});
  await app.adicionar();app.cancelar();
  assert.equal(app.elemento('sim-calcular').disabled,true);
  assert.equal(app.simulacao.resultado(),null);
});
test('limpar durante calculo impede que a resposta antiga reapareca',async()=>{
  let resolve;const app=iniciar(()=>new Promise(done=>{resolve=done;}));
  await app.adicionar();const pending=app.calcular();app.limpar();resolve({execution_id:546});await pending;
  assert.equal(app.simulacao.resultado(),null);assert.equal(app.elemento('sim-calcular').disabled,true);
});
test('cancelar uma nova sessao preserva os locais e o resultado anteriores',async()=>{
  const result={execution_id:546};const sizes=[];
  const app=iniciar(async(id,services)=>{sizes.push(services.length);return result;});
  await app.adicionar();app.concluir();await app.calcular();
  await app.adicionar();app.cancelar();
  assert.equal(app.simulacao.resultado(),result);
  await app.calcular();assert.deepEqual(sizes,[1,1]);
});

test("mantem orientacao ao adicionar um novo local", async () => {
  const app = iniciar(async () => { throw new Error("Nao deveria consultar a API"); });
  await app.adicionar();
  assert.match(app.elemento("sim-mensagem").textContent, /Calcular impacto/);
  assert.equal(app.elemento("sim-mensagem").hidden, false);
  assert.equal(app.elemento("sim-calcular").disabled, false);
});

test("erro da simulacao continua visivel e permite tentar novamente", async () => {
  const app = iniciar(async () => { const erro = new Error("Invalid location"); erro.status = 422; throw erro; });
  await app.adicionar();
  await app.calcular();
  assert.equal(app.simulacao.resultado(), null);
  assert.match(app.elemento("sim-mensagem").textContent, /250 m/);
  assert.equal(app.elemento("sim-mensagem").hidden, false);
  assert.equal(app.elemento("sim-calcular").disabled, false);
});

test('local nao confirmado nao entra no cenario nem e enviado para calcular',async()=>{
  let posted=0;
  const app=iniciar(async()=>{posted++;},async()=>{throw new Error('Local não adicionado: não há rede a até 250 metros.');});
  await app.adicionar();await app.calcular();
  assert.equal(posted,0);assert.equal(app.elemento('sim-calcular').disabled,true);
  assert.match(app.elemento('sim-mensagem').textContent,/não adicionado/);
});
test('um toque invalido nao impede simular os outros locais e usa as posicoes ajustadas',async()=>{
  let posted;
  const app=iniciar(async(id,services)=>{posted=services;return {execution_id:id};},async(ex,code,pos)=>{
    if(pos.lng===2)throw new Error('Local não adicionado: fora da rede.');
    return {lat:pos.lat+.001,lng:pos.lng+.001,nodeId:String(pos.lng),distancia:10};
  });
  app.entrar();await Promise.all([app.tocar({lat:1,lng:1}),app.tocar({lat:2,lng:2}),app.tocar({lat:3,lng:3})]);
  await app.calcular();
  assert.equal(posted.length,2);assert.equal(posted[0].latitude,1.001);assert.equal(posted[1].longitude,3.001);
});
test('cancelar durante a verificacao impede que um marcador apareca depois',async()=>{
  let finish;const app=iniciar(async()=>({}),()=>new Promise(resolve=>{finish=resolve;}));
  const pending=app.adicionar();await new Promise(resolve=>setImmediate(resolve));app.cancelar();
  finish({lat:-23.96,lng:-46.33,nodeId:'1',distancia:0});await pending;
  assert.equal(app.elemento('sim-calcular').disabled,true);
});
test('calculo aguarda a verificacao e varios toques sao processados em sequencia',async()=>{
  let posted=0,peak=0,active=0;
  const app=iniciar(async(id,services)=>{posted=services.length;return {execution_id:id};},async(ex,code,pos)=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
    return {...pos,nodeId:String(pos.lng),distancia:0};
  });
  app.entrar();const pending=Array.from({length:20},(_,i)=>app.tocar({lat:-23.96,lng:-46.33+i/10000}));
  assert.equal(app.elemento('sim-calcular').disabled,true);await app.calcular();assert.equal(posted,0);
  await Promise.all(pending);await app.calcular();
  assert.equal(posted,20);assert.equal(peak,1);
});
test('dois cliques ajustados ao mesmo no e categoria nao criam locais duplicados',async()=>{
  let count;
  const app=iniciar(async(id,services)=>{count=services.length;return {execution_id:id};},async()=>({lat:-23.96,lng:-46.33,nodeId:'7',distancia:0}));
  app.entrar();await app.tocar({lat:-23.96,lng:-46.33});await app.tocar({lat:-23.9601,lng:-46.3301});
  assert.match(app.elemento('sim-mensagem').textContent,/Já existe/);await app.calcular();assert.equal(count,1);
});
