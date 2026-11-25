"use strict";

// Sugestão de locais (rota POST /api/v1/executions/{id}/optimize).
// A API testa os pontos da rede de ruas e devolve, em ordem, os que levariam um
// novo serviço da categoria escolhida a mais moradores que hoje estão sem acesso
// (algoritmo guloso feito pelo Guilherme). Nada é gravado no banco.
// Os pontos aparecem numerados no mapa; "Simular impacto completo" envia esses
// pontos para a simulação (simulacao.js), que recalcula todas as categorias.
(() => {
  const NOMES = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
  const el = (id) => document.getElementById(id);
  const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const duasCasas = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const pontosPercentuais = (valor) => `${duasCasas.format(valor)} ${Math.abs(valor) === 1 ? "ponto percentual" : "pontos percentuais"}`;

  let mapa = null;
  let camada = null;          // marcadores numerados dos locais sugeridos
  let execucao = null;        // análise da cidade aberta (o id vai no pedido)
  let tipo = "health";        // categoria escolhida nos botões
  let quantidade = 1;         // quantos locais pedir (a API aceita de 1 a 3)
  let resultado = null;       // última resposta da API (null = sem sugestão)
  let marcadores = [];        // um por local sugerido, na ordem do ranking
  let calculando = false;     // true enquanto a API procura os pontos
  let enviando = false;       // true enquanto os pontos vão para a simulação
  let pedido = 0;             // ignora respostas que chegam depois de trocar de cidade ou limpar
  let margens = () => ({});   // espaço que o card ocupa na tela (vem do app.js)
  let antesDeMostrar = () => {};
  let aoEscolherCategoria = () => {}; // o app.js troca o card e o mapa de calor
  let aoMudarResultado = () => {};    // o app.js leva os pontos sugeridos ao mapa de calor ("depois")
  let aoSimular = () => {};           // impacto completo pronto: o mapa mostra a simulação

  function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const nome = (codigo) => NOMES[codigo] ?? codigo;
  const pessoas = (valor) => `${inteiro.format(valor)} ${Math.round(valor) === 1 ? "pessoa" : "pessoas"}`;
  const pct = (valor) => window.SimulacaoVista.percentual(valor);

  function mensagem(texto) {
    el("otim-mensagem").textContent = texto;
    el("otim-mensagem").hidden = !texto;
  }

  // Marca um botão do grupo (só um fica com aria-pressed="true").
  function marcar(seletor, atributo, valor) {
    for (const botao of document.querySelectorAll(seletor)) {
      botao.setAttribute("aria-pressed", String(botao.dataset[atributo] === String(valor)));
    }
  }
  function escolherTipo(novo) {
    if (!NOMES[novo]) return;
    tipo = novo;
    marcar("#otim-tipos [data-tipo]", "tipo", novo);
  }
  function escolherQuantidade(k) {
    quantidade = k;
    marcar("#otim-quantidade [data-k]", "k", k);
  }

  function atualizarBotoes() {
    el("otim-sugerir").disabled = !execucao || calculando;
    el("otim-sugerir").querySelector("span").textContent = calculando ? "Procurando os melhores pontos…" : "Sugerir locais";
    el("otim-simular").disabled = !resultado?.locations?.length || calculando || enviando;
  }

  // ===== Desenho: pinos numerados no mapa e a lista no card =====
  function desenharMapa() {
    camada?.clearLayers();
    marcadores = [];
    if (!resultado) return;
    const cor = window.Icones.cor(resultado.category);
    for (const local of resultado.locations) {
      const texto = `${local.rank}º local sugerido: ${escapar(nome(resultado.category))}<br><small>+${pessoas(local.marginal_population)} passariam a ter acesso</small>`;
      marcadores.push(window.L.marker([local.latitude, local.longitude], {
        // Gota com o número; a ponta (embaixo) marca o ponto exato da rede de ruas.
        icon: window.L.divIcon({ className: "pino-sugestao", html: `<span style="--cor:${cor}"><b>${local.rank}</b></span>`, iconSize: [32, 32], iconAnchor: [16, 39], tooltipAnchor: [0, -36] }),
        title: `${local.rank}º local sugerido`,
        zIndexOffset: 1000,
      }).bindTooltip(texto, { direction: "top" }).addTo(camada));
    }
  }

  function desenharResultado() {
    el("otim-resultado").hidden = !resultado;
    if (!resultado) {
      el("otim-resumo").innerHTML = "";
      el("otim-lista").innerHTML = "";
      return;
    }
    const categoria = escapar(nome(resultado.category));
    const antes = resultado.baseline_coverage_percentage;
    const depois = resultado.simulated_coverage_percentage;
    const total = resultado.locations.length;
    if (!total) {
      el("otim-resumo").className = "otim-resumo neutro";
      el("otim-resumo").innerHTML = `<span class="otim-titulo">Nenhum ponto aumentaria o acesso a ${categoria}.</span><span class="otim-explica">Na rede de ruas desta análise, um novo local não alcançaria moradores que hoje estão sem acesso. O acesso continua em ${pct(antes)}.</span>`;
      el("otim-lista").innerHTML = "";
      return;
    }
    const variacao = Math.abs(depois - antes) < 1e-7 ? 0 : depois - antes;
    const faltaram = resultado.k_requested > total ? `Foram sugeridos ${total} de ${resultado.k_requested}: outros pontos não aumentariam o acesso.` : "";
    // Destaque: o ganho em letras grandes e verdes; o "de -> para" em negrito.
    el("otim-resumo").className = variacao > 0 ? "otim-resumo" : "otim-resumo neutro";
    el("otim-resumo").innerHTML = `
      <span class="otim-titulo">${total === 1 ? "1 local sugerido" : `${total} locais sugeridos`} para ${categoria}</span>
      <strong class="otim-ganho">${variacao > 0 ? `+${pontosPercentuais(variacao)}` : "Sem aumento de acesso"}</strong>
      <span class="otim-de-para">Acesso a ${categoria}: <b>${pct(antes)}</b> → <b>${pct(depois)}</b> da população</span>
      ${faltaram ? `<span class="otim-falta">${faltaram}</span>` : ""}`;
    const cor = window.Icones.cor(resultado.category);
    el("otim-lista").innerHTML = resultado.locations.map((local) => `
      <li><button type="button" data-rank="${local.rank}">
        <b class="otim-numero" style="--cor:${cor}">${local.rank}</b>
        <span><strong>+${pessoas(local.marginal_population)}</strong> passariam a ter acesso</span>
        <small>Ver no mapa</small>
      </button></li>`).join("");
  }

  function desenhar() {
    desenharMapa();
    desenharResultado();
    atualizarBotoes();
    // Sugestão nova, apagada ou trocada de cidade: o mapa de calor acompanha.
    try { aoMudarResultado(resultado); } catch { /* o mapa não impede a sugestão */ }
  }

  // Enquadra todos os pontos sugeridos, sem deixar o card cobrir nenhum.
  function mostrarTodos() {
    const pontos = (resultado?.locations ?? []).map((local) => [local.latitude, local.longitude]);
    if (!pontos.length) return;
    mapa.fitBounds(window.L.latLngBounds(pontos), { ...margens(), maxZoom: 15 });
  }
  // "Ver no mapa" de um item da lista.
  function mostrar(rank) {
    const indice = resultado ? resultado.locations.findIndex((local) => local.rank === rank) : -1;
    const marcador = marcadores[indice];
    if (!marcador) return;
    antesDeMostrar();
    mapa.setView(marcador.getLatLng(), Math.max(mapa.getZoom(), 16));
    marcador.openTooltip();
  }

  // ===== Conversa com a API =====
  const valido = (local) => Number.isFinite(local?.latitude) && Number.isFinite(local?.longitude)
    && Math.abs(local.latitude) <= 90 && Math.abs(local.longitude) <= 180
    && Number.isFinite(local.rank) && Number.isFinite(local.marginal_population);

  async function sugerir() {
    if (!execucao || calculando) return;
    const analise = execucao, meu = ++pedido, categoria = tipo, k = quantidade;
    calculando = true;
    resultado = null;
    desenhar();
    // Se trocar o card falhar (ex.: mapa ainda escondido), a sugestão segue mesmo assim.
    try { aoEscolherCategoria(categoria); } catch { /* nada a fazer */ }
    mensagem(`Procurando ${k === 1 ? "o melhor ponto" : `os ${k} melhores pontos`} para ${nome(categoria)}. Isso pode levar alguns segundos.`);
    try {
      const dados = await window.CityDataSource.optimize(analise.id, categoria, k);
      if (meu !== pedido) return;
      if (!Array.isArray(dados?.locations) || !Number.isFinite(dados.baseline_coverage_percentage) || !Number.isFinite(dados.simulated_coverage_percentage)) {
        throw new Error("A API respondeu num formato inesperado. Tente novamente.");
      }
      resultado = { ...dados, category: dados.category ?? categoria, k_requested: dados.k_requested ?? k, locations: dados.locations.filter(valido) };
      mensagem("");
      calculando = false;
      // Enquadra antes de desenhar: o mapa de calor espera o zoom terminar e é
      // calculado uma vez só, já na vista final (com a transição para o "depois").
      mostrarTodos();
      desenhar();
    } catch (erro) {
      if (meu === pedido) mensagem(textoDoErro(erro));
    } finally {
      if (meu === pedido) {
        calculando = false;
        atualizarBotoes();
      }
    }
  }

  // Coloca os pontos sugeridos na simulação, que calcula o impacto em todas as categorias.
  async function simular() {
    if (!resultado?.locations?.length || calculando || enviando) return;
    const meu = pedido;
    enviando = true;
    atualizarBotoes();
    mensagem("Calculando o impacto dos locais sugeridos em todas as categorias…");
    try {
      const resposta = await window.Simulacao.adicionarSugeridos(resultado.category, resultado.locations);
      if (meu !== pedido) return;
      if (resposta.ocupado) mensagem("A simulação ainda está calculando. Aguarde terminar e tente de novo.");
      else if (resposta.concluida) {
        try { aoSimular(); } catch { /* o mapa não impede a mensagem */ }
        mensagem("Impacto calculado: veja o resultado no topo do painel e no botão (i).");
        el("sim-resultado-acoes")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      } else mensagem(`Os locais foram para a simulação, mas o cálculo não terminou. ${el("sim-mensagem").textContent}`.trim());
    } finally {
      enviando = false;
      atualizarBotoes();
    }
  }

  function limpar() {
    pedido++;
    calculando = false;
    resultado = null;
    mensagem("");
    desenhar();
  }

  // Traduz o erro da API numa mensagem que qualquer pessoa entende.
  function textoDoErro(erro) {
    const detalhe = typeof erro?.detalhe === "string" ? erro.detalhe : "";
    // "Not Found" puro = a rota ainda não existe no servidor (API antiga no ar).
    if (erro?.status === 404 && detalhe === "Not Found") return "A sugestão de locais ainda não foi publicada no servidor da API. Tente novamente depois da atualização.";
    if (erro?.status === 404 || erro?.status === 405) return "A sugestão de locais ainda não está disponível para esta cidade.";
    if (erro?.status === 422) {
      if (detalhe.includes("not found in bundle")) return "Essa categoria não foi analisada nesta cidade. Escolha outra.";
      return "A API não aceitou o pedido. Confira a categoria e a quantidade (de 1 a 3 locais).";
    }
    if (erro?.status === 503) {
      const limite = detalhe.match(/limit of (\d+) nodes/);
      if (limite) return `Esta cidade é grande demais para a sugestão automática: a rede de ruas passa de ${inteiro.format(Number(limite[1]))} pontos, o limite atual do servidor.`;
      return "A sugestão de locais está indisponível no momento. Tente novamente mais tarde.";
    }
    if (erro?.status === 429) return "Muitos pedidos em pouco tempo. Aguarde alguns segundos e tente de novo.";
    if (erro?.status === 502 || erro?.status === 504) return "O servidor demorou demais para responder. Tente de novo com menos locais.";
    return erro?.message || "Não foi possível sugerir locais agora. Tente novamente.";
  }

  // ===== Ponte com o app.js =====
  window.Otimizacao = {
    iniciar(mapaDaTela, opcoes = {}) {
      mapa = mapaDaTela;
      margens = opcoes.margens ?? margens;
      antesDeMostrar = opcoes.antesDeMostrar ?? antesDeMostrar;
      aoEscolherCategoria = opcoes.aoEscolherCategoria ?? aoEscolherCategoria;
      aoMudarResultado = opcoes.aoMudarResultado ?? aoMudarResultado;
      aoSimular = opcoes.aoSimular ?? aoSimular;
      camada = window.L.layerGroup().addTo(mapa);
      for (const botao of document.querySelectorAll("#otim-tipos [data-tipo]")) {
        botao.addEventListener("click", () => escolherTipo(botao.dataset.tipo));
      }
      for (const botao of document.querySelectorAll("#otim-quantidade [data-k]")) {
        botao.addEventListener("click", () => escolherQuantidade(Number(botao.dataset.k)));
      }
      el("otim-sugerir").addEventListener("click", sugerir);
      el("otim-simular").addEventListener("click", simular);
      el("otim-limpar").addEventListener("click", limpar);
      el("otim-lista").addEventListener("click", (evento) => {
        const botao = evento.target.closest("[data-rank]");
        if (botao) mostrar(Number(botao.dataset.rank));
      });
      atualizarBotoes();
    },
    // A cidade mudou (ou voltou para o mapa global): começa do zero.
    reset(novaExecucao) {
      execucao = novaExecucao;
      if (novaExecucao) el("otim-limiar").textContent = decimal.format(novaExecucao.threshold_minutes ?? 15);
      limpar();
    },
    // O app.js usa ao trocar a categoria do card (já deixa o mesmo tipo marcado).
    escolherTipo,
    resultado: () => resultado,
    textoDoErro,
  };
})();
