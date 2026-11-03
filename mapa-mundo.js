"use strict";

// Visão mundial: os contornos e os indicadores são unidos pelo ID da cidade.
(() => {
  const NOMES = {health:"saúde", education:"educação", food:"alimentação", culture:"cultura"};
  const SEM_ANALISE = "#cfd5de";
  const PAISES = {Brazil:"Brasil", France:"França"};
  const numero = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:1});
  const el = id => document.getElementById(id);
  const escapar = text => String(text ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pct = value => `${numero.format(value)}%`;
  let mapa, camada, contornos, aoEscolher = () => {};
  let resumoGeral = [], cidades = new Map(), notas = new Map(), ordenadas = [];
  let pedido = 0, carregandoContornos = null;
  let destaques, regioes = [], globalVisivel = false, margensAtuais = () => ({});
  const combinacoes = new Map();
  const marcadas = () => [...document.querySelectorAll("#combinacao input:checked")].map(caixa => caixa.value);
  const mensagem = text => { el("estado-status").textContent = text; };

  function textoCombinacao() {
    const nomes = marcadas().map(codigo => NOMES[codigo]);
    if (nomes.length === 4) return "aos 4 tipos de serviço";
    if (nomes.length === 1) return `a ${nomes[0]}`;
    return `a ${nomes.slice(0,-1).join(", ")} e ${nomes.at(-1)}`;
  }
  function cor(valor) {
    if (!Number.isFinite(valor)) return SEM_ANALISE;
    if (valor < 0.05) return window.Cores.css(0);
    const positivas = ordenadas.filter(nota => nota >= 0.05);
    const posicao = positivas.length < 2 ? 1 : 0.12 + 0.88 * positivas.findIndex(nota => nota >= valor) / (positivas.length - 1);
    return window.Cores.css(posicao);
  }
  function idDe(feature) { return String(feature.properties.city_id); }
  function estilo(feature) {
    const valor = notas.get(idDe(feature));
    return {color:"#ffffff", weight:0.7, fillColor:cor(valor), fillOpacity:valor === undefined ? 0.35 : 0.85};
  }
  function dica(feature) {
    const valor = notas.get(idDe(feature));
    const {name,country} = feature.properties;
    return `<strong>${escapar(name)}</strong> · ${escapar(country)}<br>${escapar(valor === undefined ? "Ainda sem análise" : `${pct(valor)} da população tem acesso ${textoCombinacao()}`)}`;
  }
  function escolher(feature) {
    const id = idDe(feature);
    if (cidades.has(id)) aoEscolher(id);
    else mensagem(`${feature.properties.name} ainda não foi analisada.`);
  }
  function preparar(feature, forma) {
    forma.bindTooltip(() => dica(feature), {sticky:true,direction:"top",offset:[0,-8]});
    forma.on("mouseover", () => forma.setStyle({weight:2.5,color:"#0f1b33"}));
    forma.on("mouseout", () => camada.resetStyle(forma));
    forma.on("click", () => escolher(feature));
  }
  function desenharDestaques() {
    destaques?.clearLayers();
    if (!globalVisivel || !regioes.length) return;
    if (!destaques) destaques = window.L.layerGroup();
    if (!mapa.hasLayer(destaques)) destaques.addTo(mapa);
    const vista = mapa.getBounds();
    for (const regiao of regioes) {
      const sudoeste = regiao.bounds.getSouthWest(), nordeste = regiao.bounds.getNorthEast();
      const a = mapa.latLngToContainerPoint(sudoeste), b = mapa.latLngToContainerPoint(nordeste);
      // O tamanho na tela decide quando os contornos ja orientam a navegacao.
      if (Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)) >= 110) continue;
      const centro = regiao.bounds.getCenter();
      const inicio = Math.ceil((vista.getWest()-centro.lng)/360);
      const fim = Math.floor((vista.getEast()-centro.lng)/360);
      const pais = PAISES[regiao.pais] || regiao.pais;
      const texto = regiao.quantidade === 1 ? "1 cidade analisada" : `${regiao.quantidade} cidades analisadas`;
      for (let copia=inicio; copia<=fim; copia++) {
        const deslocamento = copia*360;
        const bounds = window.L.latLngBounds([[sudoeste.lat,sudoeste.lng+deslocamento],[nordeste.lat,nordeste.lng+deslocamento]]);
        const icon = window.L.divIcon({className:"regiao-analisada",iconSize:[110,44],iconAnchor:[12,22],
          html:`<span class="regiao-analisada-card"><span class="regiao-analisada-ponto" aria-hidden="true"></span><span><strong>${escapar(pais)}</strong><small>${escapar(texto)}</small></span></span>`});
        window.L.marker([centro.lat,centro.lng+deslocamento],{icon,title:`${pais}: ${texto}. Clique para aproximar.`,alt:`Aproximar região analisada em ${pais}`,keyboard:true})
          .on("click",()=>mapa.fitBounds(bounds,{...margensAtuais(),maxZoom:12}))
          .addTo(destaques);
      }
    }
  }
  function aplicarNotas(lista) {
    notas = new Map(lista.filter(item => Number.isFinite(item.selected_coverage_percentage)).map(item => [String(item.city_id),item.selected_coverage_percentage]));
    ordenadas = [...notas.values()].sort((a,b)=>a-b);
    camada?.setStyle(estilo);
    mensagem(`${lista.length} cidades analisadas em ${new Set(lista.map(item=>item.country)).size} países.`);
    window.MapaMundo.aoMudarNotas();
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
  async function carregarContornos() {
    if (carregandoContornos) return carregandoContornos;
    carregandoContornos = (async()=>{
      const dados = await window.CityDataSource.boundaries(resumoGeral);
      const visivel = camada && mapa.hasLayer(camada);
      if (visivel) mapa.removeLayer(camada);
      contornos = dados;
      const grupos = new Map();
      camada = window.L.geoJSON({...dados,features:dados.features.filter(feature=>cidades.has(idDe(feature)))},{style:estilo,onEachFeature(feature,forma) {
        preparar(feature,forma);
        const bounds = forma.getBounds?.();
        if (!bounds?.isValid()) return;
        const pais = feature.properties.country;
        if (!grupos.has(pais)) grupos.set(pais,{pais,quantidade:0,bounds:window.L.latLngBounds([bounds.getSouthWest(),bounds.getNorthEast()])});
        const grupo = grupos.get(pais);
        grupo.quantidade++;
        grupo.bounds.extend(bounds);
      }});
      regioes = [...grupos.values()];
      if (visivel) camada.addTo(mapa);
      desenharDestaques();
    })();
    try { await carregandoContornos; } finally { carregandoContornos=null; }
  }
  window.MapaMundo = {
    aoMudarNotas:()=>{},
    async iniciar({mapaDaTela,resumo,aoEscolherCidade}) {
      mapa = mapaDaTela; aoEscolher = aoEscolherCidade;
      mapa.on("moveend zoomend resize",desenharDestaques);
      for (const caixa of document.querySelectorAll("#combinacao input")) caixa.addEventListener("change",trocarCombinacao);
      this.atualizar(resumo);
      await carregarContornos();
    },
    atualizar(resumo) {
      const revision = items => items.map(item=>`${item.city_id}:${item.execution_id}`).sort().join(",");
      const mudou = revision(resumo) !== revision(resumoGeral);
      resumoGeral = resumo;
      cidades = new Map(resumo.map(item=>[String(item.city_id),item]));
      if (mudou) { pedido++; combinacoes.clear(); }
      if (marcadas().length === 4) aplicarNotas(resumo);
      else if (mudou && mapa) trocarCombinacao({});
      if (contornos && mudou) carregarContornos().catch(erro=>mensagem(erro.message));
    },
    mostrar(margens) {
      if (!camada) return;
      globalVisivel = true;
      margensAtuais = typeof margens === "function" ? margens : () => margens || {};
      if (!mapa.hasLayer(camada)) camada.addTo(mapa);
      mapa.invalidateSize();
      if (!mapa.getSize().x) { mapa.once("resize",()=>this.mostrar(margens)); return; }
      window.CityMapViewport.showWorld(mapa);
      desenharDestaques();
    },
    esconder() {
      globalVisivel = false;
      destaques?.clearLayers();
      if (destaques && mapa.hasLayer(destaques)) mapa.removeLayer(destaques);
      if (camada && mapa.hasLayer(camada)) mapa.removeLayer(camada);
    },
    notaECor(id) {
      const valor = notas.get(String(id));
      return valor === undefined ? null : {texto:pct(valor),cor:cor(valor)};
    },
    legenda() {
      return {
        titulo:`População com acesso ${textoCombinacao()} em até 15 min`,
        degrade:window.Cores.degrade(true,"180deg"),
        marcas:[{posicao:0,texto:`${pct(ordenadas.at(-1) ?? 0)} melhor`},{posicao:1,texto:`${pct(ordenadas[0] ?? 0)} pior`}],
        extras:[],
      };
    },
  };
})();
