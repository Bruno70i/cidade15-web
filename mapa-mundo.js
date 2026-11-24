"use strict";

// Mapa global em 3 níveis, como um mapa político:
// - Mundo: só os países com cidades analisadas, pintados pela média de cada país.
// - País: os estados, cada um pintado pela parte da população com acesso (soma das
//   cidades dele), com divisas brancas e a sigla (no Brasil).
// - Estado: as cidades daquele estado, pintadas uma a uma; os estados vizinhos ficam
//   apagados, mas continuam clicáveis.
// As 5 mil cidades nunca são desenhadas de uma vez (antes, de longe, só se viam
// cidades soltas, sem estados, e o celular travava).
(() => {
  const NOMES = {health:"saúde", education:"educação", food:"alimentação", culture:"cultura"};
  const SEM_DADOS = "#cfd5de";
  const PAISES = {Brazil:"Brasil", France:"França"};
  const numero = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:1});
  const inteiro = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:0});
  const el = id => document.getElementById(id);
  const escapar = text => String(text ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pct = value => `${numero.format(value)}%`;
  // Cópia com menos pontos (simplificar.js); sem o módulo, usa a forma original.
  const simplificada = (feature, tolerancia) => window.Simplificar?.feature(feature, tolerancia) ?? feature ?? null;
  // Dicas só com mouse: no celular o toque já abre (e a dica ficava presa na tela).
  const temMouse = () => window.matchMedia?.("(hover: hover)")?.matches ?? true;
  const marcadas = () => [...document.querySelectorAll("#combinacao input:checked")].map(caixa => caixa.value);
  const mensagem = text => { el("estado-status").textContent = text; };
  const agora = () => (globalThis.performance ?? Date).now();
  // scheduler.yield (Chrome) devolve a vez só ao que é urgente (toques) e volta logo.
  const pausa = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(continuar => setTimeout(continuar, 0));

  let mapa, aoEscolher = () => {}, aoEscolherRegiao = () => {};
  let resumoGeral = [], cidades = new Map(), listaAtual = [], notas = new Map(), escalaCidades = null;
  let contornos = null, carregandoContornos = null, regioesProntas = false;
  let caminhoAtual = [], globalVisivel = false, margensAtuais = () => ({}), pendente = null;
  let camadas = null, rotulos = null;  // o que o nível atual desenha; nomes e siglas
  let candidatosRotulo = [];           // rótulos possíveis (só aparecem se couberem na tela)
  let agregados = null;                // por região: cidades, população e população com acesso
  let legendaAtual = null;
  let pedido = 0;
  const combinacoes = new Map();
  let limiteRanking = 100, rankingAtual = [], rankingPendente = null; // ranking: 100 cidades por vez
  let textoResumo = "";

  function textoCombinacao() {
    const nomes = marcadas().map(codigo => NOMES[codigo]);
    if (nomes.length === 4) return "aos 4 tipos de serviço";
    if (nomes.length === 1) return `a ${nomes[0]}`;
    return `a ${nomes.slice(0,-1).join(", ")} e ${nomes.at(-1)}`;
  }
  // Escala de cores pela posição no ranking (os valores são muito concentrados perto de
  // zero; a posição separa melhor). 0 = vermelho, melhor = verde-azulado.
  function escala(valores) {
    const ordenados = valores.filter(Number.isFinite).sort((a, b) => a - b);
    const positivos = ordenados.filter(valor => valor >= 0.05);
    return {
      melhor: ordenados.at(-1), pior: ordenados[0],
      cor(valor) {
        if (!Number.isFinite(valor)) return SEM_DADOS;
        if (valor < 0.05) return window.Cores.css(0);
        let baixo = 0, alto = positivos.length;
        while (baixo < alto) { const meio = (baixo + alto) >> 1; if (positivos[meio] < valor) baixo = meio + 1; else alto = meio; }
        const indice = Math.min(baixo, positivos.length - 1);
        return window.Cores.css(positivos.length < 2 ? 1 : 0.12 + 0.88 * indice / (positivos.length - 1));
      },
    };
  }
  function idDe(feature) { return String(feature.properties.city_id); }
  // Caixa de um contorno direto das coordenadas (sem criar camadas do Leaflet).
  function limitesDe(feature) {
    const g = feature?.geometry;
    if (!g) return null;
    let sul = 90, norte = -90, oeste = 180, leste = -180;
    for (const poligono of g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) {
      for (const [lon, lat] of poligono[0] ?? []) {
        if (lat < sul) sul = lat; if (lat > norte) norte = lat;
        if (lon < oeste) oeste = lon; if (lon > leste) leste = lon;
      }
    }
    return sul <= norte ? window.L.latLngBounds([[sul, oeste], [norte, leste]]) : null;
  }

  // ===== Somas por região (combinação de categorias marcada) =====
  function agregar() {
    agregados = new Map();
    for (const item of listaAtual) {
      for (const nivel of window.RegioesMapa?.caminhoCidade(item.city_id) ?? []) {
        const soma = agregados.get(nivel) ?? {cidades:0, populacao:0, comAcesso:0};
        soma.cidades++;
        if (Number.isFinite(item.total_population)) soma.populacao += item.total_population;
        if (Number.isFinite(item.selected_population)) soma.comAcesso += item.selected_population;
        agregados.set(nivel, soma);
      }
    }
  }
  function estatisticaDe(id) {
    if (!agregados) agregar();
    const soma = agregados.get(id);
    return soma ? {...soma, percentual: soma.populacao ? 100 * soma.comAcesso / soma.populacao : null, texto: textoCombinacao()} : null;
  }
  const textoCidades = n => `${inteiro.format(n)} ${n === 1 ? "cidade analisada" : "cidades analisadas"}`;

  // ===== Dicas (mouse) =====
  function dicaRegiao(regiao) {
    const soma = estatisticaDe(regiao.id);
    if (!soma) return `<strong>${escapar(regiao.nome)}</strong><span>Sem cidades analisadas</span>`;
    return `<strong>${escapar(regiao.nome)}</strong><span>${escapar(textoCidades(soma.cidades))}</span>`
      + (Number.isFinite(soma.percentual) ? `<span><b>${escapar(pct(soma.percentual))}</b> da população com acesso ${escapar(textoCombinacao())}</span>` : "")
      + "<small>Clique para abrir</small>";
  }
  function dicaCidade(feature) {
    const valor = notas.get(idDe(feature));
    return `<strong>${escapar(feature.properties.name)}</strong>`
      + (Number.isFinite(valor) ? `<span><b>${escapar(pct(valor))}</b> da população com acesso ${escapar(textoCombinacao())}</span>` : "")
      + "<small>Clique para abrir a cidade</small>";
  }
  // Passar o mouse destaca; clicar (ou tocar) abre. O contorno de destaque é uma camada
  // à parte, por cima e sem clique: trazer a própria forma para a frente movia o
  // elemento na página no meio do clique, e o navegador descartava o clique.
  let destaque = null;
  function destacar(feature) {
    destaque?.clearLayers();
    if (!feature || !window.L.layerGroup) return;
    destaque ??= window.L.layerGroup();
    if (!mapa.hasLayer(destaque)) destaque.addTo(mapa);
    window.L.geoJSON(feature, {interactive:false, style:{color:"#0f1b33", weight:3, opacity:1, fill:false}}).addTo(destaque);
  }
  function tornarClicavel(forma, normal, aoClicar, dica) {
    if (temMouse() && dica) forma.bindTooltip?.(dica, {sticky:true, direction:"top", offset:[0, -8], className:"dica-regiao"});
    forma.on("mouseover", () => destacar(forma.feature));
    forma.on("mouseout", () => destaque?.clearLayers());
    forma.on("click", () => { forma.closeTooltip?.(); destaque?.clearLayers(); aoClicar(); });
  }

  // Ponto do rótulo: o lugar mais "de dentro" da forma, longe das bordas (a mesma ideia do
  // "polylabel" da Mapbox). O centro geométrico de formas curvas, como o RJ, cai fora delas
  // e o rótulo ficava no mar. Calculado uma vez por forma, num contorno simplificado.
  const pontosRotulo = new WeakMap();
  function distanciaDaBorda(x, y, poligono) { // positiva dentro, negativa fora
    let dentro = false, menor = Infinity;
    for (const anel of poligono) {
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [ax, ay] = anel[i], [bx, by] = anel[j];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) dentro = !dentro;
        const dx = bx - ax, dy = by - ay;
        const k = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
        const px = ax + k * dx - x, py = ay + k * dy - y;
        menor = Math.min(menor, px * px + py * py);
      }
    }
    return (dentro ? 1 : -1) * Math.sqrt(menor);
  }
  function pontoInterno(poligono) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poligono[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const lado = Math.min(x1 - x0, y1 - y0);
    if (!(lado > 0)) return [y0, x0];
    const celula = (x, y, meio) => { const d = distanciaDaBorda(x, y, poligono); return {x, y, meio, d, teto:d + meio * Math.SQRT2}; };
    const fila = [];
    for (let x = x0; x < x1; x += lado) for (let y = y0; y < y1; y += lado) fila.push(celula(x + lado / 2, y + lado / 2, lado / 2));
    let melhor = celula((x0 + x1) / 2, (y0 + y1) / 2, 0);
    const precisao = Math.max(x1 - x0, y1 - y0) / 60;
    for (let passos = 0; fila.length && passos < 800; passos++) {
      let k = 0;
      for (let i = 1; i < fila.length; i++) if (fila[i].teto > fila[k].teto) k = i;
      const c = fila.splice(k, 1)[0];
      if (c.d > melhor.d) melhor = c;
      if (c.teto - melhor.d <= precisao) continue;
      const m = c.meio / 2;
      fila.push(celula(c.x - m, c.y - m, m), celula(c.x + m, c.y - m, m), celula(c.x - m, c.y + m, m), celula(c.x + m, c.y + m, m));
    }
    return [melhor.y, melhor.x];
  }
  function areaDoAnel(anel) {
    let area = 0;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) area += anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    return Math.abs(area / 2);
  }
  function centroDe(feature) {
    if (pontosRotulo.has(feature)) return pontosRotulo.get(feature);
    const g = simplificada(feature, 0.02)?.geometry ?? feature.geometry;
    const poligonos = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).filter(p => p[0]?.length > 2);
    let maior = null, maiorArea = 0;
    for (const p of poligonos) { const area = areaDoAnel(p[0]); if (area > maiorArea) { maiorArea = area; maior = p; } }
    const ponto = maior ? pontoInterno(maior) : null;
    pontosRotulo.set(feature, ponto);
    return ponto;
  }

  // ===== Desenho de cada nível =====
  const nivelAtual = () => !caminhoAtual.length ? "mundo" : caminhoAtual.at(-1).startsWith("estado:") ? "estado" : "pais";
  // Rótulo com aoClicar: tocar no nome também abre a região (ajuda nos estados pequenos).
  const rotuloDe = (regiao, texto, classe, larguraMinima, aoClicar = null) => {
    const centro = regiao.feature ? centroDe(regiao.feature) : null;
    if (centro) candidatosRotulo.push({centro, texto, classe, limites:regiao.bounds, larguraMinima, aoClicar, feature:regiao.feature});
  };

  // Extremos da legenda; sem dados ainda (estados carregando), não mostra "0% melhor / 0% pior".
  const marcasDe = esc => esc.melhor === undefined || esc.melhor === null ? []
    : [{posicao:0, texto:`${pct(esc.melhor)} melhor`}, {posicao:1, texto:`${pct(esc.pior)} pior`}];

  function desenharMundo() {
    const paises = (window.RegioesMapa?.filhas([]) ?? []).filter(regiao => regiao.feature);
    const esc = escala(paises.map(regiao => estatisticaDe(regiao.id)?.percentual));
    for (const regiao of paises) {
      const normal = {className:"unidade-mapa", color:"#ffffff", weight:1, opacity:1, fillColor:esc.cor(estatisticaDe(regiao.id)?.percentual), fillOpacity:0.85};
      window.L.geoJSON(simplificada(regiao.feature, 0.02), {style:normal, onEachFeature:(feature, forma) =>
        tornarClicavel(forma, normal, () => aoEscolherRegiao(regiao.caminho), () => dicaRegiao(regiao))}).addTo(camadas);
      rotuloDe(regiao, regiao.nome, "nome-pais", 36, () => aoEscolherRegiao(regiao.caminho));
    }
    legendaAtual = {
      titulo:`População com acesso ${textoCombinacao()}: média de cada país`,
      marcas:marcasDe(esc),
    };
  }

  function desenharPais(paisId) {
    const estados = window.RegioesMapa?.estadosDoPais(paisId) ?? [];
    const esc = escala(estados.map(estado => estatisticaDe(estado.id)?.percentual));
    let semDados = false;
    for (const estado of estados) {
      const soma = estatisticaDe(estado.id);
      semDados ||= !soma;
      const normal = {className:"unidade-mapa", color:"#ffffff", weight:1.2, opacity:1,
        fillColor:soma ? esc.cor(soma.percentual) : SEM_DADOS, fillOpacity:soma ? 0.9 : 0.5};
      window.L.geoJSON(simplificada(estado.feature, 0.01), {style:normal, onEachFeature:(feature, forma) => {
        if (soma) tornarClicavel(forma, normal, () => aoEscolherRegiao(estado.caminho), () => dicaRegiao(estado));
        else if (temMouse()) forma.bindTooltip?.(() => dicaRegiao(estado), {sticky:true, direction:"top", offset:[0, -8], className:"dica-regiao"});
      }}).addTo(camadas);
      // Brasil: sigla de todos os estados; outros países: nome dos estados com cidades.
      const abrir = soma ? () => aoEscolherRegiao(estado.caminho) : null;
      if (estado.sigla) rotuloDe(estado, estado.sigla, "sigla", 16, abrir);
      else if (soma) rotuloDe(estado, estado.nome, "nome-estado", 60, abrir);
    }
    if (!contornos) mensagem("Carregando os dados dos estados…");
    legendaAtual = {
      titulo:`População com acesso ${textoCombinacao()}: média de cada estado`,
      marcas:marcasDe(esc),
      extras: semDados ? [{cor:SEM_DADOS, texto:"Sem cidades analisadas"}] : [],
    };
  }

  function desenharEstado(estadoId) {
    const estados = window.RegioesMapa?.estadosDoPais(caminhoAtual[0]) ?? [];
    // Vizinhos apagados (dão contexto e continuam clicáveis).
    const escVizinhos = escala(estados.map(estado => estatisticaDe(estado.id)?.percentual));
    for (const estado of estados) {
      if (estado.id === estadoId) continue;
      const soma = estatisticaDe(estado.id);
      const normal = {className:"unidade-mapa", color:"#ffffff", weight:1, opacity:1, fillColor:soma ? escVizinhos.cor(soma.percentual) : SEM_DADOS, fillOpacity:0.25};
      window.L.geoJSON(simplificada(estado.feature, 0.01), {style:normal, onEachFeature:(feature, forma) => {
        if (soma) tornarClicavel(forma, normal, () => aoEscolherRegiao(estado.caminho), () => dicaRegiao(estado));
      }}).addTo(camadas);
    }
    if (!contornos) {
      const atual = estados.find(estado => estado.id === estadoId);
      if (atual) window.L.geoJSON(simplificada(atual.feature, 0.01), {interactive:false, style:{color:"#ffffff", weight:1, fillColor:SEM_DADOS, fillOpacity:0.6}}).addTo(camadas);
      mensagem("Carregando as cidades…");
      legendaAtual = null;
      return;
    }
    // As cidades do estado, cada uma com a sua cor (escala do próprio estado).
    const features = contornos.features.filter(feature => cidades.has(idDe(feature))
      && window.RegioesMapa?.caminhoCidade(idDe(feature)).at(-1) === estadoId);
    const esc = escala(features.map(feature => notas.get(idDe(feature))));
    const estiloCidade = feature => {
      const valor = notas.get(idDe(feature));
      return {className:"municipio-analisado", color:"#ffffff", weight:0.6, opacity:1, fillColor:esc.cor(valor), fillOpacity:valor === undefined ? 0.35 : 0.9};
    };
    window.L.geoJSON({type:"FeatureCollection", features}, {style:estiloCidade, onEachFeature:(feature, forma) =>
      tornarClicavel(forma, estiloCidade(feature), () => aoEscolher(idDe(feature)), () => dicaCidade(feature))}).addTo(camadas);
    legendaAtual = {
      titulo:`População com acesso ${textoCombinacao()}: cada cidade do estado`,
      marcas:marcasDe(esc),
    };
  }

  function desenharNivel() {
    camadas?.clearLayers();
    destaque?.clearLayers();
    candidatosRotulo = [];
    if (!globalVisivel || !mapa || !window.L.geoJSON) return;
    // Mapa ainda sem posição (página aberta escondida): desenha quando ele aparecer.
    if (mapa.getZoom && !Number.isFinite(mapa.getZoom())) return;
    camadas ??= window.L.layerGroup();
    if (!mapa.hasLayer(camadas)) camadas.addTo(mapa);
    const nivel = nivelAtual();
    if (nivel === "mundo") desenharMundo();
    else if (nivel === "pais") desenharPais(caminhoAtual.at(-1));
    else desenharEstado(caminhoAtual.at(-1));
    desenharRotulos();
    window.MapaMundo.aoMudarNotas();
  }
  // Rótulos só quando a região tem tamanho na tela para o texto (refeito a cada zoom).
  function desenharRotulos() {
    rotulos?.clearLayers();
    if (!globalVisivel || !candidatosRotulo.length || !window.L.divIcon) return;
    rotulos ??= window.L.layerGroup();
    if (!mapa.hasLayer(rotulos)) rotulos.addTo(mapa);
    for (const rotulo of candidatosRotulo) {
      const a = mapa.latLngToContainerPoint(rotulo.limites.getSouthWest()), b = mapa.latLngToContainerPoint(rotulo.limites.getNorthEast());
      if (Math.abs(b.x - a.x) < rotulo.larguraMinima) continue;
      const marcador = window.L.marker(rotulo.centro, {interactive:Boolean(rotulo.aoClicar), keyboard:false, icon:window.L.divIcon({
        className:`rotulo-mapa ${rotulo.classe}${rotulo.aoClicar ? " clicavel" : ""}`, iconSize:null, iconAnchor:[0, 0], html:`<span>${escapar(rotulo.texto)}</span>`})});
      if (rotulo.aoClicar) {
        marcador.on?.("mouseover", () => destacar(rotulo.feature));
        marcador.on?.("mouseout", () => destaque?.clearLayers());
        marcador.on?.("click", () => { destaque?.clearLayers(); rotulo.aoClicar(); });
      }
      marcador.addTo(rotulos);
    }
  }

  // ===== Dados =====
  function aplicarNotas(lista) {
    listaAtual = lista;
    notas = new Map(lista.filter(item => Number.isFinite(item.selected_coverage_percentage)).map(item => [String(item.city_id),item.selected_coverage_percentage]));
    escalaCidades = escala([...notas.values()]);
    agregados = null;
    textoResumo = `${lista.length} cidades analisadas em ${new Set(lista.map(item=>item.country)).size} países.`;
    if (regioesProntas || !globalVisivel) mensagem(textoResumo);
    if (globalVisivel && regioesProntas) desenharNivel();
    else window.MapaMundo.aoMudarNotas();
  }
  function atualizarRanking(resumo) {
    const lista = el("ranking-cidades");
    if (!lista) return;
    // Desenha só com o ranking aberto (com 5 mil cidades eram ~32 mil elementos na página).
    const detalhes = lista.closest?.("details");
    if (detalhes && !detalhes.open) { rankingPendente = resumo; return; }
    rankingPendente = null;
    const cidadesOrdenadas = resumo.filter(item => Number.isFinite(item.selected_coverage_percentage))
      .sort((a,b) => b.selected_coverage_percentage - a.selected_coverage_percentage
        || a.name.localeCompare(b.name, "pt-BR") || String(a.city_id).localeCompare(String(b.city_id)));
    const mostradas = cidadesOrdenadas.slice(0, limiteRanking);
    const restantes = cidadesOrdenadas.length - mostradas.length;
    lista.innerHTML = mostradas.map(item => `
      <li><button type="button" data-cidade="${escapar(item.city_id)}">
        <span><strong>${escapar(item.name)}</strong><small>${escapar(PAISES[item.country] || item.country)}</small></span>
        <strong>${escapar(pct(item.selected_coverage_percentage))}</strong>
      </button></li>`).join("") + (restantes > 0
      ? `<li class="ranking-mais"><button type="button" data-mais>Mostrar mais ${inteiro.format(Math.min(200, restantes))} cidades (${inteiro.format(restantes)} restantes)</button></li>`
      : "");
    rankingAtual = resumo;
  }
  async function trocarCombinacao(evento) {
    const categorias = marcadas();
    if (!categorias.length) { evento.target.checked = true; mensagem("Marque pelo menos uma categoria."); return; }
    const meu = ++pedido;
    if (categorias.length === 4) { aplicarNotas(resumoGeral); return; }
    const key = [...categorias].sort().join(",");
    mensagem("Carregando os resultados…");
    try {
      if (!combinacoes.has(key)) {
        const promise = window.CityDataSource.summary(categorias);
        combinacoes.set(key,promise);
        promise.catch(()=>{if(combinacoes.get(key)===promise) combinacoes.delete(key);});
      }
      const lista = await combinacoes.get(key);
      if (meu === pedido) aplicarNotas(lista);
    } catch (erro) { if (meu === pedido) mensagem(erro.message); }
  }
  // Contornos das cidades: ligam cada cidade ao seu estado e desenham o nível de estado.
  async function carregarContornos() {
    if (carregandoContornos) return carregandoContornos;
    carregandoContornos = (async () => {
      const dados = await window.CityDataSource.boundaries(resumoGeral);
      contornos = dados;
      const geometrias = [];
      let inicioFatia = agora();
      for (const feature of dados.features) {
        if (agora() - inicioFatia > 40) { await pausa(); inicioFatia = agora(); } // celular não trava
        if (!cidades.has(idDe(feature))) continue;
        const bounds = limitesDe(feature);
        if (bounds) geometrias.push({feature, bounds});
      }
      await window.RegioesMapa?.atualizar(geometrias, resumoGeral).catch(erro => console.warn(erro.message));
      agregados = null;
      mensagem(textoResumo);
      window.MapaMundo.aoMudarRegioes();
      if (globalVisivel) desenharNivel();
    })();
    try { await carregandoContornos; } finally { carregandoContornos = null; }
  }
  // Limites de uma região (o estado pode ainda não ter cidades ligadas a ele).
  function limitesDaRegiao(id) {
    const regiao = window.RegioesMapa?.obter(id);
    if (regiao) return regiao.bounds;
    if (!String(id).startsWith("estado:")) return null;
    return (window.RegioesMapa?.estadosDoPais(caminhoAtual[0]) ?? []).find(estado => estado.id === id)?.bounds ?? null;
  }

  // Mapa ainda sem tamanho (aba aberta em segundo plano, por exemplo): tenta de novo
  // assim que a área do mapa ganhar largura e altura.
  let cancelarEspera = null;
  function esperarTamanho(tentar) {
    cancelarEspera?.();
    const area = mapa.getContainer?.();
    const pronto = () => { cancelarEspera?.(); cancelarEspera = null; tentar(); };
    if (window.ResizeObserver && area) {
      const observador = new window.ResizeObserver(() => { if (area.clientWidth && area.clientHeight) pronto(); });
      observador.observe(area);
      cancelarEspera = () => observador.disconnect();
    } else {
      mapa.once("resize", pronto);
      cancelarEspera = () => mapa.off?.("resize", pronto);
    }
  }

  window.MapaMundo = {
    aoMudarNotas:()=>{},
    aoMudarRegioes:()=>{},
    async iniciar({mapaDaTela,resumo,aoEscolherCidade,aoAbrirRegiao}) {
      mapa = mapaDaTela; aoEscolher = aoEscolherCidade;
      aoEscolherRegiao = aoAbrirRegiao;
      el("ranking-cidades")?.addEventListener?.("click", evento => {
        if (evento.target.closest("button[data-mais]")) { limiteRanking += 200; atualizarRanking(rankingAtual); return; }
        const botao = evento.target.closest("button[data-cidade]");
        if (botao && cidades.has(botao.dataset.cidade)) aoEscolher(botao.dataset.cidade, "overall");
      });
      el("ranking-cidades")?.closest?.("details")?.addEventListener?.("toggle", evento => {
        if (evento.target.open && rankingPendente) atualizarRanking(rankingPendente);
      });
      mapa.on("zoomend", desenharRotulos);
      for (const caixa of document.querySelectorAll("#combinacao input")) caixa.addEventListener("change",trocarCombinacao);
      this.atualizar(resumo);
      // Países primeiro (só precisam do resumo); estados e cidades quando os contornos chegarem.
      try { await window.RegioesMapa?.atualizar([], resumoGeral); } catch (erro) { console.warn(erro.message); }
      regioesProntas = true;
      agregados = null;
      mensagem(textoResumo);
      window.MapaMundo.aoMudarRegioes();
      if (globalVisivel && pendente) {
        const vista = pendente; pendente = null;
        this.mostrar(vista.margens, vista.vista, vista.caminho);
      }
      await carregarContornos();
    },
    atualizar(resumo) {
      const revision = items => items.map(item=>`${item.city_id}:${item.execution_id}`).sort().join(",");
      const mudou = revision(resumo) !== revision(resumoGeral);
      resumoGeral = resumo;
      atualizarRanking(resumo);
      cidades = new Map(resumo.map(item=>[String(item.city_id),item]));
      if (mudou) { pedido++; combinacoes.clear(); agregados = null; }
      if (marcadas().length === 4) aplicarNotas(resumo);
      else if (mudou && mapa) trocarCombinacao({});
      if (contornos && mudou) carregarContornos().catch(erro=>mensagem(erro.message));
    },
    capturarVista() {
      if (!globalVisivel || !Number.isFinite(mapa.getZoom()) || mapa.getZoom() <= mapa.getMinZoom()) return null;
      const {lat,lng} = mapa.getCenter();
      return {centro:[lat,lng], zoom:mapa.getZoom()};
    },
    mostrar(margens, vista = null, caminho = []) {
      caminho = caminho.filter(id => !String(id).startsWith("continente:")); // links antigos
      // Já estava no mapa global: a troca de nível é um voo suave, não um pulo.
      // (só voa se o mapa já tem posição: sem ela, o voo não tem de onde partir)
      const animar = globalVisivel && regioesProntas && Boolean(mapa.flyToBounds)
        && Number.isFinite(mapa.getZoom?.())
        && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      globalVisivel = true;
      caminhoAtual = caminho;
      margensAtuais = typeof margens === "function" ? margens : () => margens || {};
      if (!regioesProntas) {
        pendente = {margens, vista, caminho};
        mensagem("Carregando o mapa…");
        return;
      }
      pendente = null;
      // Página aberta escondida: o Leaflet guardou tamanho zero e só volta a medir depois
      // de ter uma posição. Se a tela já tem tamanho, dá uma posição inicial e mede de novo.
      if (!Number.isFinite(mapa.getZoom?.()) && mapa.getContainer?.().clientWidth) mapa.setView([10, 0], 2, {animate:false});
      mapa.invalidateSize();
      if (!mapa.getSize().x) { esperarTamanho(() => this.mostrar(margens, vista, caminho)); return; }
      const enquadrar = (limites, opcoes) => animar
        ? mapa.flyToBounds(limites, {...opcoes, duration:0.8})
        : mapa.fitBounds(limites, {...opcoes, animate:false});
      const limites = caminho.length ? limitesDaRegiao(caminho.at(-1)) : null;
      if (limites) {
        window.CityMapViewport.resize(mapa);
        enquadrar(limites, {...margensAtuais(), maxZoom:caminho.at(-1).startsWith("estado:") ? 10 : 7});
      } else if (vista) {
        window.CityMapViewport.resize(mapa);
        mapa.setView(vista.centro, vista.zoom, {animate:false});
      } else {
        // Mundo: enquadra os países com cidades. Tela estreita (celular): se não couberem
        // todos, mostra o país com mais cidades (senão o Brasil ficava cortado).
        const paises = (window.RegioesMapa?.filhas([]) ?? []).filter(regiao => regiao.bounds?.isValid?.());
        let alvo = paises.length
          ? paises.slice(1).reduce((total, regiao) => total.extend(regiao.bounds), window.L.latLngBounds([paises[0].bounds.getSouthWest(), paises[0].bounds.getNorthEast()]))
          : null;
        if (alvo?.isValid()) {
          window.CityMapViewport.resize(mapa);
          const opcoes = margensAtuais();
          if (window.L.point && mapa.project && paises.length > 1) {
            const folga = window.L.point(opcoes.paddingTopLeft ?? [0, 0]).add(opcoes.paddingBottomRight ?? [0, 0]);
            const livre = mapa.getSize().subtract(folga);
            const a = mapa.project(alvo.getNorthWest(), mapa.getMinZoom()), b = mapa.project(alvo.getSouthEast(), mapa.getMinZoom());
            if (Math.abs(b.x - a.x) > livre.x * 1.15 || Math.abs(b.y - a.y) > livre.y * 1.15) {
              alvo = [...paises].sort((x, y) => y.quantidade - x.quantidade)[0].bounds;
            }
          }
          enquadrar(alvo.pad(0.05), {...opcoes, maxZoom:4});
        } else window.CityMapViewport.showWorld(mapa);
      }
      desenharNivel();
    },
    esconder() {
      globalVisivel = false;
      pendente = null;
      cancelarEspera?.(); cancelarEspera = null;
      camadas?.clearLayers();
      destaque?.clearLayers();
      rotulos?.clearLayers();
    },
    // Totais de uma região (cidades, população e % com acesso na combinação marcada) para o card.
    estatistica: id => estatisticaDe(id),
    notaECor(id) {
      const valor = notas.get(String(id));
      return valor === undefined ? null : {texto:pct(valor), cor:(escalaCidades ?? escala([])).cor(valor)};
    },
    legenda() {
      const legenda = legendaAtual ?? {titulo:`População com acesso ${textoCombinacao()} em até 15 min`, marcas:[]};
      return {degrade:window.Cores.degrade(true,"180deg"), extras:[], ...legenda};
    },
  };
})();
