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
  let dadosPaises, bordasPaises, paisesExibidos;
  let caminhoAtual = [], aoEscolherRegiao;
  let positivas = [];          // notas >= 0,05 em ordem (refeitas só quando as notas mudam)
  let rankingPendente = null;  // ranking guardado para desenhar quando o menu abrir
  let pendente = null;         // vista pedida antes de os contornos chegarem
  let realce, areasContinentes; // contorno da região escolhida; áreas clicáveis dos continentes
  let textoResumo = "";
  const inteiro = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:0});
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
    // Busca binária na lista já ordenada (antes a lista era refeita para cada cidade:
    // ~28 milhões de contas a cada pintura do mapa).
    let baixo = 0, alto = positivas.length;
    while (baixo < alto) { const meio = (baixo + alto) >> 1; if (positivas[meio] < valor) baixo = meio + 1; else alto = meio; }
    const indice = baixo === positivas.length ? -1 : baixo;
    const posicao = positivas.length < 2 ? 1 : 0.12 + 0.88 * indice / (positivas.length - 1);
    return window.Cores.css(posicao);
  }
  function idDe(feature) { return String(feature.properties.city_id); }
  // Cidade dentro da região escolhida (continente, país ou estado)?
  function dentroDaRegiao(feature) {
    if (!caminhoAtual.length) return true;
    const destino = window.RegioesMapa?.caminhoCidade(idDe(feature)) ?? [];
    return caminhoAtual.every((nivel, i) => destino[i] === nivel);
  }
  function estilo(feature) {
    const valor = notas.get(idDe(feature));
    // Fora da região escolhida a cidade fica apagada, para a região se destacar.
    const dentro = dentroDaRegiao(feature);
    const preenchimento = cor(valor);
    // Com o mapa afastado, a borda usa a cor da própria cidade: as cidades pequenas
    // (menores que um pixel) aparecem coloridas em vez de deixar o mapa "lavado".
    return {className:"municipio-analisado", color:zoomLonge ? preenchimento : "#ffffff", weight:0.7, opacity:dentro ? 1 : 0.3,
      fillColor:preenchimento, fillOpacity:!dentro ? 0.15 : valor === undefined ? 0.35 : 0.88};
  }
  // Bordas mais finas com o mapa afastado (as classes ficam no style.css).
  let zoomLonge = false;
  function marcarZoom() {
    const zoom = mapa?.getZoom?.(), recipiente = mapa?.getContainer?.();
    if (!recipiente || !Number.isFinite(zoom)) return;
    recipiente.classList.toggle("zoom-longe", zoom < 5.5);
    recipiente.classList.toggle("zoom-medio", zoom >= 5.5 && zoom < 7.5);
    if (zoomLonge !== zoom < 5.5) { zoomLonge = zoom < 5.5; camada?.setStyle(estilo); }
  }

  // Contorno escuro da região escolhida; no mapa global, o contorno de cada continente com cidades.
  function desenharRealce() {
    realce?.clearLayers();
    if (!globalVisivel || !window.L.polyline) return;
    realce ??= window.L.layerGroup();
    if (!mapa.hasLayer(realce)) realce.addTo(mapa);
    const linha = (cor, peso, opacidade) => ({interactive:false, fill:false, color:cor, weight:peso, opacity:opacidade});
    const desenharLinhas = (linhas, leve = false) => {
      if (!linhas.length) return;
      window.L.polyline(linhas, linha("#ffffff", leve ? 3.5 : 6, 0.85)).addTo(realce);
      window.L.polyline(linhas, linha(leve ? "#2855a8" : "#0f1b33", leve ? 1.4 : 2.5, 0.95)).addTo(realce);
    };
    const id = caminhoAtual.at(-1);
    if (!id) {
      // Mapa global: contorno mais leve em cada continente com cidades analisadas.
      for (const continente of window.RegioesMapa?.filhas([]) ?? []) desenharLinhas(window.RegioesMapa.contorno(continente.id), true);
    } else if (id.startsWith("continente:")) {
      desenharLinhas(window.RegioesMapa?.contorno(id) ?? []);
    } else {
      const feature = window.RegioesMapa?.obter(id)?.feature;
      if (!feature) return;
      window.L.geoJSON(feature, {interactive:false, style:linha("#ffffff", 6, 0.85)}).addTo(realce);
      window.L.geoJSON(feature, {interactive:false, style:linha("#0f1b33", 2.5, 0.95)}).addTo(realce);
    }
  }
  // Mapa global: a área de cada continente com cidades fica clicável (leve tom azul ao passar o mouse).
  function desenharContinentes() {
    areasContinentes?.clearLayers();
    if (!globalVisivel || caminhoAtual.length || !window.L.featureGroup) return;
    const continentes = window.RegioesMapa?.filhas([]) ?? [];
    if (!continentes.length) return;
    areasContinentes ??= window.L.featureGroup();
    for (const continente of continentes) {
      window.L.geoJSON({type:"FeatureCollection", features:window.RegioesMapa.paisesDoContinente(continente.id)}, {
        style:{className:"continente-area", stroke:false, fill:true, fillColor:"#2f6fe4", fillOpacity:0.04},
        onEachFeature(feature, forma) { forma.on("click", () => aoEscolherRegiao(continente.caminho)); },
      }).addTo(areasContinentes);
    }
    if (!mapa.hasLayer(areasContinentes)) areasContinentes.addTo(mapa);
    areasContinentes.bringToBack(); // embaixo das cidades: clicar numa cidade continua abrindo a cidade
  }
  function escolher(feature) {
    const id = idDe(feature);
    if (!cidades.has(id)) {
      mensagem(`${feature.properties.name} ainda não foi analisada.`);
      return;
    }
    const destino = window.RegioesMapa?.caminhoCidade(id) ?? [];
    const dentroDaRegiao = caminhoAtual.every((nivel, i) => nivel === destino[i]);
    if (!dentroDaRegiao) {
      const nivelPais = destino.findIndex(nivel => nivel.startsWith("pais:"));
      if (nivelPais >= 0) aoEscolherRegiao(destino.slice(0, nivelPais + 1));
      return;
    }
    if (destino.length > caminhoAtual.length) {
      aoEscolherRegiao(destino.slice(0, caminhoAtual.length + 1));
    } else aoEscolher(id);
  }
  function preparar(feature, forma) {
    forma.on("click", () => escolher(feature));
  }
  const nomePais = nome => String(nome ?? "").normalize("NFD")
    .replace(/\p{M}/gu, "").trim().toLowerCase();

  function paisSelecionavel(feature) {
    const pais = window.RegioesMapa?.obter(`pais:${feature.properties.codigo}`);
    return pais && !caminhoAtual.includes(pais.id) ? pais : null;
  }

  async function mostrarBordasPaises() {
    if (!globalVisivel) return;
    try {
      // Base cartográfica local do Natural Earth. A API fornece a lista de países analisados.
      dadosPaises ??= (window.RegioesMapa?.carregarPaises() ?? fetch("dados/paises.geojson?v=hierarquia").then(resposta => {
        if (!resposta.ok) throw new Error("Contornos nacionais indisponíveis.");
        return resposta.json();
      })).catch(erro => {
        dadosPaises = null;
        throw erro;
      });
      const dados = await dadosPaises;
      if (!globalVisivel) return;
      const paises = new Set(resumoGeral.map(item => nomePais(item.country)));
      const chave = [...paises].sort().join("|");
      if (chave !== paisesExibidos) {
        if (bordasPaises) mapa.removeLayer(bordasPaises);
        bordasPaises = window.L.geoJSON(dados, {
          filter: feature => feature.properties.nomes.some(nome => paises.has(nomePais(nome))),
          style:{className:"contorno-pais", color:"#2855a8", weight:2, opacity:0.9,
            fill:true, fillColor:"#ffffff", fillOpacity:0},
          onEachFeature(feature, forma) {
            forma.on("click", () => {
              const pais = paisSelecionavel(feature);
              if (pais) aoEscolherRegiao(pais.caminho);
            });
          },
        });
        paisesExibidos = chave;
      }
      if (!mapa.hasLayer(bordasPaises)) {
        bordasPaises.addTo(mapa);
        bordasPaises.bringToBack();
      }
      bordasPaises.eachLayer(forma => {
        const elemento = forma.getElement();
        if (!elemento) return;
        elemento.setAttribute("data-pais", forma.feature.properties.codigo);
        elemento.classList.toggle("pais-selecionavel", Boolean(paisSelecionavel(forma.feature)));
      });
    } catch (erro) {
      // A camada opcional não impede o uso do mapa se o arquivo estiver indisponível.
    }
  }
  function desenharDestaques() {
    destaques?.clearLayers();
    if (!globalVisivel) return;
    const filhas = window.RegioesMapa?.filhas(caminhoAtual) ?? [];
    const marcadores = filhas.length || caminhoAtual.length ? filhas : regioes;
    if (!marcadores.length) return;
    if (!destaques) destaques = window.L.layerGroup();
    if (!mapa.hasLayer(destaques)) destaques.addTo(mapa);
    const vista = mapa.getBounds();
    const tamanho = mapa.getSize();
    for (const regiao of marcadores) {
      if (regiao.id?.startsWith("pais:")) continue;
      const sudoeste = regiao.bounds.getSouthWest(), nordeste = regiao.bounds.getNorthEast();
      const a = mapa.latLngToContainerPoint(sudoeste), b = mapa.latLngToContainerPoint(nordeste);
      // O tamanho na tela decide quando os contornos ja orientam a navegacao.
      if (!regiao.id && Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)) >= 110) continue;
      const centro = (regiao.cidades ?? regiao.bounds).getCenter();
      const inicio = Math.ceil((vista.getWest()-centro.lng)/360);
      const fim = Math.floor((vista.getEast()-centro.lng)/360);
      const pais = regiao.nome ?? PAISES[regiao.pais] ?? regiao.pais;
      const texto = regiao.quantidade === 1 ? "1 cidade analisada" : `${regiao.quantidade} cidades analisadas`;
      for (let copia=inicio; copia<=fim; copia++) {
        const deslocamento = copia*360;
        const bounds = window.L.latLngBounds([[sudoeste.lat,sudoeste.lng+deslocamento],[nordeste.lat,nordeste.lng+deslocamento]]);
        const posicao = [centro.lat, centro.lng + deslocamento];
        const ponto = mapa.latLngToContainerPoint(posicao);
        if (ponto.y < 0 || ponto.y > tamanho.y) continue;
        // Continentes ganham um rótulo com o nome e o total; as outras regiões, um ponto.
        const icon = regiao.id?.startsWith("continente:")
          ? window.L.divIcon({className:"rotulo-regiao", iconSize:null, iconAnchor:[0,0],
            html:`<span><b>${escapar(pais)}</b><small>${escapar(`${inteiro.format(regiao.quantidade)} ${regiao.quantidade === 1 ? "cidade analisada" : "cidades analisadas"}`)}</small></span>`})
          : window.L.divIcon({className:"regiao-analisada",iconSize:[36,36],iconAnchor:[18,18],
            html:'<span class="regiao-analisada-ponto" aria-hidden="true"></span>'});
        const rotulo = `${pais}: ${texto}. Clique para aproximar.`;
        window.L.marker(posicao,{icon,title:rotulo,alt:rotulo,keyboard:true})
          .on("click",()=>regiao.id ? aoEscolherRegiao(regiao.caminho) :
            mapa.fitBounds(bounds,{...margensAtuais(),maxZoom:12}))
          .addTo(destaques);
      }
    }
  }
  function aplicarNotas(lista) {
    notas = new Map(lista.filter(item => Number.isFinite(item.selected_coverage_percentage)).map(item => [String(item.city_id),item.selected_coverage_percentage]));
    ordenadas = [...notas.values()].sort((a,b)=>a-b);
    positivas = ordenadas.filter(nota => nota >= 0.05);
    camada?.setStyle(estilo);
    textoResumo = `${lista.length} cidades analisadas em ${new Set(lista.map(item=>item.country)).size} países.`;
    if (camada || !globalVisivel) mensagem(textoResumo);
    window.MapaMundo.aoMudarNotas();
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
    lista.innerHTML = cidadesOrdenadas.map(item => `
      <li><button type="button" data-cidade="${escapar(item.city_id)}">
        <span><strong>${escapar(item.name)}</strong><small>${escapar(PAISES[item.country] || item.country)}</small></span>
        <strong>${escapar(pct(item.selected_coverage_percentage))}</strong>
      </button></li>`).join("");
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
      const geometrias = [];
      camada = window.L.geoJSON({...dados,features:dados.features.filter(feature=>cidades.has(idDe(feature)))},{style:estilo,onEachFeature(feature,forma) {
        preparar(feature,forma);
        const bounds = forma.getBounds?.();
        if (!bounds?.isValid()) return;
        geometrias.push({feature, bounds});
        const pais = feature.properties.country;
        if (!grupos.has(pais)) grupos.set(pais,{pais,quantidade:0,bounds:window.L.latLngBounds([bounds.getSouthWest(),bounds.getNorthEast()])});
        const grupo = grupos.get(pais);
        grupo.quantidade++;
        grupo.bounds.extend(bounds);
      }});
      regioes = [...grupos.values()];
      if (visivel) camada.addTo(mapa);
      await window.RegioesMapa?.atualizar(geometrias, resumoGeral).catch(erro => console.warn(erro.message));
      if (caminhoAtual.length) camada.setStyle(estilo); // agora cada cidade sabe sua região
      mensagem(textoResumo);
      if (globalVisivel && pendente) {
        // Alguém pediu o mapa global (ou uma região) antes de os contornos chegarem.
        const vista = pendente; pendente = null;
        window.MapaMundo.mostrar(vista.margens, vista.vista, vista.caminho);
      } else {
        desenharDestaques();
        desenharRealce();
        desenharContinentes();
      }
      window.MapaMundo.aoMudarRegioes();
    })();
    try { await carregandoContornos; } finally { carregandoContornos=null; }
  }
  window.MapaMundo = {
    aoMudarNotas:()=>{},
    aoMudarRegioes:()=>{},
    async iniciar({mapaDaTela,resumo,aoEscolherCidade,aoAbrirRegiao}) {
      mapa = mapaDaTela; aoEscolher = aoEscolherCidade;
      aoEscolherRegiao = aoAbrirRegiao;
      // Países e estados começam a baixar junto com os contornos (antes esperavam por eles).
      window.RegioesMapa?.preparar?.()?.catch?.(() => {});
      el("ranking-cidades")?.addEventListener?.("click", evento => {
        const botao = evento.target.closest("button[data-cidade]");
        if (botao && cidades.has(botao.dataset.cidade)) aoEscolher(botao.dataset.cidade, "overall");
      });
      el("ranking-cidades")?.closest?.("details")?.addEventListener?.("toggle", evento => {
        if (evento.target.open && rankingPendente) atualizarRanking(rankingPendente);
      });
      mapa.on("moveend zoomend resize",desenharDestaques);
      mapa.on("zoomend", marcarZoom);
      marcarZoom();
      for (const caixa of document.querySelectorAll("#combinacao input")) caixa.addEventListener("change",trocarCombinacao);
      this.atualizar(resumo);
      await carregarContornos();
    },
    atualizar(resumo) {
      const revision = items => items.map(item=>`${item.city_id}:${item.execution_id}`).sort().join(",");
      const mudou = revision(resumo) !== revision(resumoGeral);
      resumoGeral = resumo;
      atualizarRanking(resumo);
      cidades = new Map(resumo.map(item=>[String(item.city_id),item]));
      if (mudou) { pedido++; combinacoes.clear(); }
      if (marcadas().length === 4) aplicarNotas(resumo);
      else if (mudou && mapa) trocarCombinacao({});
      if (contornos && mudou) carregarContornos().catch(erro=>mensagem(erro.message));
      if (mudou) mostrarBordasPaises();
    },
    capturarVista() {
      if (!globalVisivel || mapa.getZoom() <= mapa.getMinZoom()) return null;
      const {lat,lng} = mapa.getCenter();
      return {centro:[lat,lng], zoom:mapa.getZoom()};
    },
    mostrar(margens, vista = null, caminho = []) {
      const mudouRegiao = caminho.join("|") !== caminhoAtual.join("|");
      globalVisivel = true;
      caminhoAtual = caminho;
      margensAtuais = typeof margens === "function" ? margens : () => margens || {};
      if (!camada) {
        // Contornos ainda chegando: guarda o pedido e mostra assim que chegarem.
        pendente = {margens, vista, caminho};
        mensagem("Carregando o mapa das cidades… Enquanto isso, pesquise uma cidade ou abra o ranking no menu.");
        if (!carregandoContornos && resumoGeral.length) carregarContornos().catch(erro => mensagem(erro.message));
        return;
      }
      pendente = null;
      if (mudouRegiao) camada.setStyle(estilo);
      if (!mapa.hasLayer(camada)) camada.addTo(mapa);
      mapa.invalidateSize();
      if (!mapa.getSize().x) { mapa.once("resize",()=>this.mostrar(margens,vista,caminho)); return; }
      const regiao = window.RegioesMapa?.obter(caminho.at(-1));
      if (regiao) {
        window.CityMapViewport.resize(mapa);
        mapa.fitBounds(regiao.bounds, {...margensAtuais(), maxZoom:12, animate:false});
      } else if (vista) {
        window.CityMapViewport.resize(mapa);
        mapa.setView(vista.centro, vista.zoom, {animate:false});
      } else {
        // Mapa global: enquadra os continentes com cidades analisadas sem deixar o card
        // cobrir a América do Sul (antes o mundo era centralizado atrás do card).
        const continentes = (window.RegioesMapa?.filhas([]) ?? []).filter(continente => continente.cidades?.isValid?.());
        const caixas = continentes.map(continente => continente.cidades);
        let alvo = caixas.length
          ? caixas.slice(1).reduce((limites, caixa) => limites.extend(caixa), window.L.latLngBounds([caixas[0].getSouthWest(), caixas[0].getNorthEast()]))
          : null;
        if (alvo?.isValid()) {
          window.CityMapViewport.resize(mapa);
          const opcoes = margensAtuais();
          // Tela estreita (celular): se nem no menor zoom couberem todos os continentes,
          // mostra o continente com mais cidades (senão a América do Sul ficava cortada).
          if (window.L.point && mapa.project && continentes.length > 1) {
            const folga = window.L.point(opcoes.paddingTopLeft ?? [0, 0]).add(opcoes.paddingBottomRight ?? [0, 0]);
            const livre = mapa.getSize().subtract(folga);
            const a = mapa.project(alvo.getNorthWest(), mapa.getMinZoom()), b = mapa.project(alvo.getSouthEast(), mapa.getMinZoom());
            if (Math.abs(b.x - a.x) > livre.x * 1.15 || Math.abs(b.y - a.y) > livre.y * 1.15) {
              alvo = [...continentes].sort((x, y) => y.quantidade - x.quantidade)[0].cidades;
            }
          }
          mapa.fitBounds(alvo.pad(0.1), {...opcoes, maxZoom:4, animate:false});
        } else window.CityMapViewport.showWorld(mapa);
      }
      marcarZoom();
      mostrarBordasPaises();
      desenharContinentes();
      desenharRealce();
      desenharDestaques();
    },
    esconder() {
      globalVisivel = false;
      pendente = null;
      realce?.clearLayers();
      areasContinentes?.clearLayers();
      if (bordasPaises && mapa.hasLayer(bordasPaises)) mapa.removeLayer(bordasPaises);
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
