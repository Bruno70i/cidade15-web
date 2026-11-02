"use strict";

// Organiza a tela: um mapa em tela cheia com painéis flutuando por cima.
// - Sem cidade aberta: mapa de SP pintado pela nota de cada cidade (mapa-estado.js).
// - Com cidade aberta: mapa de calor da cidade (mapa-cidade.js), card de métricas
//   e simulação (simulacao.js).
// Os detalhes de uma cidade só são pedidos à API quando ela é aberta.
(() => {
  const CATEGORIAS = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
  const LUGAR = { health: "a um serviço de saúde", education: "a um local de educação", food: "a um comércio de alimentos", culture: "a um espaço de cultura" };
  const GERAL = "overall"; // índice geral = quem chega aos 4 tipos de serviço
  const INICIO = { centro: [-22.4, -48.6], zoom: 7 }; // estado de São Paulo
  const ATUALIZAR_A_CADA = 5 * 60 * 1000; // confere novas análises a cada 5 minutos

  const $ = (id) => document.getElementById(id);
  const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const preciso = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const dataBR = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

  const estado = {
    resumo: [],             // resposta de /cities/summary (todas as cidades analisadas)
    cidade: null,           // cidade aberta: { id, nome } (null = mapa de SP)
    latest: null,           // detalhes da cidade aberta (/cities/{id}/latest)
    detalhes: new Map(),    // detalhes já baixados, por id da cidade
    categoria: GERAL,       // categoria escolhida no card da cidade
    ordem: { coluna: GERAL, decrescente: true }, // ordenação da tabela "Comparar"
  };
  let mapa = null;
  let pedidoCidade = 0;     // ignora respostas de uma cidade que já não está aberta
  let temporizadorAviso = null;

  // ===== Utilidades =====
  function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function normalizar(texto) {
    return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function finito(valor) { return typeof valor === "number" && Number.isFinite(valor); }
  function pct(valor) { return finito(valor) ? `${decimal.format(valor)}%` : "—"; }
  // Pontos percentuais; variações pequenas (menos de 1 ponto) aparecem com 2 casas.
  function pontos(valor) {
    const formato = Math.abs(valor) < 1 ? preciso : decimal;
    return `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${formato.format(Math.abs(valor))} p.p.`;
  }
  function limiar() { return estado.latest?.execution?.threshold_minutes ?? 15; }
  function celular() { return window.matchMedia("(max-width: 720px)").matches; }
  // Ícone colorido da categoria, para tabelas e listas.
  function iconeDaCategoria(codigo) {
    return `<span class="icone-tabela" style="color:${window.Icones.cor(codigo)}">${window.Icones.svg(codigo)}</span>`;
  }

  // Mensagem rápida no topo (some sozinha).
  function avisar(texto) {
    $("aviso").textContent = texto;
    $("aviso").hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { $("aviso").hidden = true; }, 6000);
  }
  function carregando(ativo, texto = "Carregando…") {
    $("carregando-texto").textContent = texto;
    $("carregando").hidden = !ativo;
  }

  // Espaço que o mapa deve deixar livre ao enquadrar (o card cobre um canto).
  function margens() {
    if (celular()) return { paddingTopLeft: [16, 130], paddingBottomRight: [16, $("cartao").offsetHeight + 16] };
    return { paddingTopLeft: [$("cartao").offsetWidth + 40, 90], paddingBottomRight: [90, 40] };
  }

  // ===== Números da cidade aberta =====
  // Valor de hoje (o que está no banco) para uma categoria ou para o índice geral.
  function valorOriginal(categoria) {
    const relatorio = estado.latest?.population_report;
    if (!relatorio) return null;
    if (categoria === GERAL) return { pct: relatorio.overall_coverage_percentage, total: relatorio.total_weight };
    const item = relatorio.categories?.[categoria];
    return item ? { pct: item.coverage_percentage, total: item.total_weight ?? relatorio.total_weight } : null;
  }
  // Antes e depois da simulação (null = nenhuma simulação calculada).
  function valorSimulado(categoria) {
    const resultado = window.Simulacao.resultado();
    if (!resultado) return null;
    const item = categoria === GERAL ? resultado.overall?.population : resultado.results?.[categoria]?.population;
    if (item) return { antes: item.before.coverage_percentage, depois: item.after.coverage_percentage };
    // Categoria que não recebeu novos locais: não muda.
    const original = valorOriginal(categoria);
    return original ? { antes: original.pct, depois: original.pct } : null;
  }

  // ===== Card de métricas =====
  function desenharCartao() {
    $("cartao-estado").hidden = Boolean(estado.cidade);
    $("cartao-cidade").hidden = !estado.cidade;
    if (!estado.cidade) return;
    $("cidade-nome").textContent = estado.cidade.nome;
    if (!estado.latest) { $("valor").textContent = "…"; $("valor-legenda").textContent = "Carregando os resultados…"; return; }

    const categoria = estado.categoria;
    const original = valorOriginal(categoria);
    const simulado = valorSimulado(categoria);
    const total = original?.total ?? 0;
    $("valor").textContent = pct(original?.pct);
    const pessoas = finito(original?.pct) ? Math.round((total * original.pct) / 100) : null;
    const alvo = categoria === GERAL ? "aos 4 tipos de serviço" : LUGAR[categoria];
    $("valor-legenda").textContent = pessoas === null
      ? "Resultado indisponível para esta categoria."
      : `${inteiro.format(pessoas)} de ${inteiro.format(total)} pessoas chegam ${alvo} em até ${decimal.format(limiar())} min a pé.`;

    $("impacto").hidden = !simulado;
    if (simulado) {
      $("impacto").innerHTML = `Impacto da simulação: <strong>${escapar(pontos(simulado.depois - simulado.antes))}</strong>`;
      $("impacto").classList.toggle("neutro", simulado.depois - simulado.antes <= 0); // sem ganho: cinza
    }

    // Barra: azul = acesso hoje, vermelho = ganho com a simulação, cinza = o resto.
    const hoje = simulado ? simulado.antes : (original?.pct ?? 0);
    const depois = simulado ? Math.max(hoje, simulado.depois) : hoje;
    const partes = {
      original: { largura: hoje, titulo: "Valor original" },
      impacto: { largura: depois - hoje, titulo: "Ganho com a simulação" },
      resto: { largura: Math.max(0, 100 - depois), titulo: "Sem acesso no tempo limite" },
    };
    for (const segmento of document.querySelectorAll("#barra .seg")) {
      const parte = partes[segmento.dataset.seg];
      const habitantes = Math.round((total * parte.largura) / 100);
      segmento.style.width = `${Math.max(0, parte.largura)}%`;
      segmento.hidden = parte.largura <= 0;
      segmento.dataset.dica = `${parte.titulo}: ${inteiro.format(habitantes)} habitantes (${pct(parte.largura)})`;
      segmento.setAttribute("aria-label", segmento.dataset.dica);
    }
  }

  // Dica que aparece em cima da barra ao passar o mouse (ou focar pelo teclado).
  function mostrarDica(evento) {
    const segmento = evento.target.closest(".seg");
    if (!segmento) return;
    $("dica").textContent = segmento.dataset.dica;
    $("dica").hidden = false;
    // Centraliza a dica no pedaço da barra, sem deixar que ela saia pelas bordas.
    const largura = $("barra").clientWidth;
    const metadeDaDica = $("dica").offsetWidth / 2;
    const centro = segmento.offsetLeft + segmento.offsetWidth / 2;
    $("dica").style.left = `${Math.min(Math.max(centro, metadeDaDica), largura - metadeDaDica)}px`;
  }

  // ===== Painel (i): informações e comparação =====
  function desenharInfo() {
    const corpo = $("info-corpo");
    if (!estado.cidade || !estado.latest) {
      // No mapa de SP: as 5 cidades com maior índice geral.
      const melhores = [...estado.resumo]
        .filter((item) => finito(item.selected_coverage_percentage))
        .sort((a, b) => b.selected_coverage_percentage - a.selected_coverage_percentage)
        .slice(0, 5);
      corpo.innerHTML = `
        <p class="suave">${estado.resumo.length} cidades analisadas. O índice geral é a parte da população que chega
        aos 4 tipos de serviço (saúde, educação, alimentação e cultura) em até 15 minutos a pé.</p>
        <table class="comparacao"><caption>Maiores índices gerais</caption>
          <tbody>${melhores.map((item) => `<tr><th scope="row"><button class="botao-texto" type="button" data-abrir-cidade="${escapar(item.city_id)}">${escapar(item.name)}</button></th><td>${pct(item.selected_coverage_percentage)}</td></tr>`).join("")}</tbody>
        </table>
        <button class="botao-texto" type="button" data-painel="comparar">Ver todas as cidades</button>`;
      return;
    }
    const execucao = estado.latest.execution;
    const atual = valorSimulado(estado.categoria);
    const linhas = [GERAL, ...Object.keys(CATEGORIAS)].map((codigo) => {
      const original = valorOriginal(codigo);
      const simulado = valorSimulado(codigo);
      const ganhou = simulado && simulado.depois - simulado.antes > 0;
      const nome = codigo === GERAL ? "Geral (4 tipos)" : CATEGORIAS[codigo];
      return `<tr${codigo === estado.categoria ? ' class="atual"' : ""}><th scope="row">${iconeDaCategoria(codigo)}${nome}</th><td>${pct(original?.pct)}</td><td${ganhou ? ' class="ganho"' : ""}>${simulado ? `${preciso.format(simulado.depois)}%` : "—"}</td></tr>`;
    }).join("");
    corpo.innerHTML = `
      <dl class="destaques">
        <div><dt>Valor original</dt><dd>${pct(valorOriginal(estado.categoria)?.pct)}</dd></div>
        <div><dt>Impacto simulado</dt><dd class="${atual && atual.depois - atual.antes > 0 ? "ganho" : ""}">${atual ? escapar(pontos(atual.depois - atual.antes)) : "sem simulação"}</dd></div>
      </dl>
      <table class="comparacao">
        <caption class="sr-only">Percentual da população com acesso, antes e depois da simulação</caption>
        <thead><tr><th scope="col">Categoria</th><th scope="col">Original</th><th scope="col">Simulado</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <ul class="fatos">
        <li>${window.Icones.svg("pessoas")}<span><b>${inteiro.format(estado.latest.population_report.total_weight)}</b> pessoas consideradas</span></li>
        <li>${window.Icones.svg("caminhar")}<span>Até <b>${decimal.format(execucao.threshold_minutes)} min</b> a pé, a ${decimal.format(execucao.speed_kmh)} km/h</span></li>
        <li>${window.Icones.svg("calendario")}<span>Análise de ${escapar(dataBR.format(new Date(execucao.processed_at)))}</span></li>
      </ul>
      <p class="suave">"p.p." são pontos percentuais: de 40% para 45% são +5 p.p.</p>
      <button class="botao-texto" type="button" data-painel="metodologia">Como funciona o cálculo</button>`;
  }

  // ===== Legenda do canto da tela =====
  // Cada mapa (estado ou cidade) devolve: título, degradê da régua, marcas
  // embaixo da régua, itens extras (ícones ou quadradinhos de cor) e uma nota.
  function desenharLegenda() {
    const legenda = estado.cidade ? window.MapaCidade.legenda() : window.MapaEstado.legenda();
    $("legenda-titulo").textContent = legenda.titulo;
    $("legenda-titulo-curto").textContent = legenda.tituloCurto; // usado no celular
    $("legenda-regua").style.background = legenda.degrade;
    // A régua fica em pé: "posicao" 0 = no topo, 1 = embaixo.
    // Cada marca leva o texto completo (computador) e o curto (celular); o CSS mostra um só.
    $("legenda-marcas").innerHTML = legenda.marcas
      .map((marca) => `<span style="top:${marca.posicao * 100}%"><span class="so-computador">${escapar(marca.texto)}</span><span class="so-celular">${escapar(marca.curto ?? marca.texto)}</span></span>`)
      .join("");
    $("legenda-itens").innerHTML = legenda.extras.map((item) => {
      const simbolo = item.icone
        ? `<span class="mini-pino" style="--cor:${window.Icones.cor(item.icone)}">${window.Icones.svg(item.icone)}</span>`
        : `<i style="background:${item.cor}"></i>`;
      return `<li>${simbolo}${escapar(item.texto)}</li>`;
    }).join("");
    $("legenda-nota").textContent = legenda.nota;
    $("legenda").hidden = false;
  }

  // ===== Abrir uma cidade / voltar para SP =====
  async function abrirCidade(id) {
    const cidadeId = String(id);
    const item = estado.resumo.find((cidade) => String(cidade.city_id) === cidadeId);
    if (!item) { avisar("Esta cidade ainda não foi analisada."); return; }
    const meu = ++pedidoCidade;
    estado.cidade = { id: cidadeId, nome: item.name };
    estado.latest = estado.detalhes.get(cidadeId) ?? null;
    window.Busca.mostrarNome(item.name);
    window.MapaEstado.esconder();
    fecharPaineis();
    desenharCartao();
    atualizarEndereco();
    carregando(true, `Carregando ${item.name}…`);
    try {
      if (!estado.latest) {
        const latest = await window.CityDataSource.latest(cidadeId);
        if (meu !== pedidoCidade) return;
        estado.detalhes.set(cidadeId, latest);
        estado.latest = latest;
      }
      window.Simulacao.reset(estado.latest.execution);
      desenharCartao();
      desenharInfo();
      desenharExemplo();
      await window.MapaCidade.abrir(estado.latest.execution, margens());
      if (meu !== pedidoCidade) return;
      window.MapaCidade.trocarCategoria(estado.categoria);
      desenharLegenda();
    } catch (erro) {
      if (meu !== pedidoCidade) return;
      avisar(erro.message || "Não foi possível abrir a cidade.");
      voltarParaSP();
    } finally {
      if (meu === pedidoCidade) carregando(false);
    }
  }

  function voltarParaSP() {
    pedidoCidade++;
    estado.cidade = null;
    estado.latest = null;
    window.Simulacao.reset(null);
    window.MapaCidade.fechar();
    window.MapaEstado.mostrar(margens());
    window.Busca.mostrarNome("");
    carregando(false);
    desenharCartao();
    desenharInfo();
    desenharLegenda();
    atualizarEndereco();
  }

  // ===== Endereço da página: #cidade=2&categoria=health =====
  function atualizarEndereco() {
    const parametros = new URLSearchParams();
    if (estado.cidade) parametros.set("cidade", estado.cidade.id);
    if (estado.cidade && estado.categoria !== GERAL) parametros.set("categoria", estado.categoria);
    const texto = parametros.toString();
    history.replaceState(null, "", `${location.pathname}${texto ? `#${texto}` : ""}`);
  }

  // ===== Painel "Comparar cidades": tabela com filtro e ordenação =====
  function notaDaColuna(item, coluna) {
    return coluna === GERAL ? item.selected_coverage_percentage : item.categories?.[coluna];
  }
  function desenharComparacao() {
    const filtro = normalizar($("filtro-cidades").value.trim());
    const { coluna, decrescente } = estado.ordem;
    const linhas = estado.resumo
      .filter((item) => normalizar(item.name).includes(filtro))
      .sort((a, b) => {
        const ordem = coluna === "nome" ? a.name.localeCompare(b.name, "pt-BR") : (notaDaColuna(a, coluna) ?? -1) - (notaDaColuna(b, coluna) ?? -1);
        return decrescente ? -ordem : ordem;
      });
    const colunas = [["nome", "Cidade"], [GERAL, "Aos 4 tipos"], ...Object.entries(CATEGORIAS)];
    // Cada título de coluna é um botão que ordena a tabela (com o ícone da categoria).
    const cabecalho = colunas.map(([chave, titulo]) => {
      const ativa = chave === coluna;
      const sentido = ativa ? (decrescente ? "descending" : "ascending") : "none";
      const icone = chave === "nome" ? "" : iconeDaCategoria(chave);
      return `<th scope="col" aria-sort="${sentido}"><button class="botao-ordenar" type="button" data-ordenar="${chave}">${icone}${titulo}${ativa ? (decrescente ? " ↓" : " ↑") : ""}</button></th>`;
    }).join("");
    const corpo = linhas.map((item) => `<tr><th scope="row"><button class="botao-texto" type="button" data-abrir-cidade="${escapar(item.city_id)}">${escapar(item.name)}</button></th>`
      + `<td>${pct(item.selected_coverage_percentage)}</td>`
      + Object.keys(CATEGORIAS).map((codigo) => `<td>${pct(item.categories?.[codigo])}</td>`).join("")
      + "</tr>").join("");
    $("tabela-cidades").innerHTML = `<thead><tr>${cabecalho}</tr></thead><tbody>${corpo || `<tr><td colspan="${colunas.length}">Nenhuma cidade encontrada.</td></tr>`}</tbody>`;
  }

  // ===== Painel "Como funciona": exemplo com os números da cidade aberta =====
  function desenharExemplo() {
    const saude = estado.latest?.population_report?.categories?.health;
    $("exemplo").hidden = !saude;
    if (!saude) return;
    const total = estado.latest.population_report.total_weight;
    $("exemplo-titulo").textContent = `Um exemplo com os dados de ${estado.cidade.nome}`;
    $("exemplo-texto").innerHTML = `A análise considera <strong>${inteiro.format(total)} pessoas</strong>. O cálculo estima que <strong>${inteiro.format(saude.within_threshold_weight)} delas</strong> conseguem alcançar ao menos um serviço de Saúde em até <strong>${decimal.format(limiar())} minutos a pé</strong>.`;
    $("exemplo-formula").textContent = `${inteiro.format(saude.within_threshold_weight)} ÷ ${inteiro.format(total)} × 100 = ${pct(saude.coverage_percentage)}`;
  }

  // Minimiza ou abre o card (no celular ele ocupa metade da tela).
  // Minimizado, o CSS esconde tudo menos o que tem a classe "sempre-visivel".
  function alternarCartao() {
    const recolhido = $("cartao").classList.toggle("recolhido");
    $("recolher-cartao").setAttribute("aria-expanded", String(!recolhido));
    $("recolher-cartao").setAttribute("aria-label", recolhido ? "Abrir o painel" : "Minimizar o painel");
  }

  // Marca o botão da categoria escolhida (só um fica marcado).
  function escolherCategoria(categoria) {
    estado.categoria = categoria;
    for (const botao of document.querySelectorAll("#categorias [data-categoria]")) {
      botao.setAttribute("aria-pressed", String(botao.dataset.categoria === categoria));
    }
  }

  // ===== Menu, painéis e janelas =====
  function alternar(botao, janela, abrir = janela.hidden) {
    janela.hidden = !abrir;
    botao?.setAttribute("aria-expanded", String(abrir));
  }
  function abrirPainel(nome) {
    fecharPaineis();
    alternar($("botao-menu"), $("menu"), false);
    alternar($("botao-info"), $("info"), false);
    $(`painel-${nome}`).hidden = false;
    $(`painel-${nome}`).querySelector(".botao-fechar").focus();
  }
  function fecharPaineis() {
    $("painel-comparar").hidden = true;
    $("painel-metodologia").hidden = true;
  }

  function ligarEventos() {
    // Card da cidade: botões de categoria
    for (const botao of document.querySelectorAll("#categorias [data-categoria]")) {
      botao.addEventListener("click", () => {
        escolherCategoria(botao.dataset.categoria);
        // Já deixa o mesmo tipo marcado na simulação.
        if (CATEGORIAS[estado.categoria]) window.Simulacao.escolherTipo(estado.categoria);
        window.MapaCidade.trocarCategoria(estado.categoria);
        desenharCartao();
        desenharInfo();
        desenharLegenda();
        atualizarEndereco();
      });
    }
    $("voltar").addEventListener("click", voltarParaSP);
    $("recolher-cartao").addEventListener("click", alternarCartao);
    // Guarda a altura do card numa variável do CSS (--altura-cartao). No celular,
    // o botão (i) e o "centralizar" usam essa medida para ficar logo acima do card,
    // subindo e descendo junto quando ele abre ou é minimizado.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty("--altura-cartao", `${$("cartao").offsetHeight}px`);
    }).observe($("cartao"));
    $("barra").addEventListener("pointerover", mostrarDica);
    $("barra").addEventListener("focusin", mostrarDica);
    $("barra").addEventListener("pointerleave", () => { $("dica").hidden = true; });
    $("barra").addEventListener("focusout", () => { $("dica").hidden = true; });

    // Menu
    $("botao-menu").addEventListener("click", () => alternar($("botao-menu"), $("menu")));
    for (const botao of document.querySelectorAll("[data-modo]")) {
      botao.addEventListener("click", () => {
        for (const outro of document.querySelectorAll("[data-modo]")) outro.setAttribute("aria-pressed", String(outro === botao));
        window.MapaCidade.trocarModo(botao.dataset.modo);
      });
    }
    $("mostrar-locais").addEventListener("change", (evento) => window.MapaCidade.trocarLocais(evento.target.checked));

    // Painel (i)
    $("botao-info").addEventListener("click", () => alternar($("botao-info"), $("info")));

    // Comparar
    $("filtro-cidades").addEventListener("input", desenharComparacao);

    // Controles do mapa
    $("zoom-mais").addEventListener("click", () => mapa.zoomIn());
    $("zoom-menos").addEventListener("click", () => mapa.zoomOut());
    $("centralizar").addEventListener("click", () => {
      if (estado.cidade) window.MapaCidade.centralizar(margens());
      else window.MapaEstado.mostrar(margens());
    });

    // Cliques em botões que aparecem em vários lugares (tabelas, painéis).
    document.addEventListener("click", (evento) => {
      const painel = evento.target.closest("[data-painel]");
      if (painel) abrirPainel(painel.dataset.painel);
      const fechar = evento.target.closest("[data-fechar]");
      if (fechar) {
        $(fechar.dataset.fechar).hidden = true;
        if (fechar.dataset.fechar === "info") $("botao-info").setAttribute("aria-expanded", "false");
      }
      const cidade = evento.target.closest("[data-abrir-cidade]");
      if (cidade) abrirCidade(cidade.dataset.abrirCidade);
      const ordenar = evento.target.closest("[data-ordenar]");
      if (ordenar) {
        const coluna = ordenar.dataset.ordenar;
        // Mesma coluna: inverte. Coluna nova: começa do maior (ou de A a Z, no nome).
        estado.ordem = estado.ordem.coluna === coluna ? { coluna, decrescente: !estado.ordem.decrescente } : { coluna, decrescente: coluna !== "nome" };
        desenharComparacao();
      }
    });

    // Esc fecha o que estiver aberto.
    document.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape") return;
      window.Simulacao.parar();
      fecharPaineis();
      alternar($("botao-menu"), $("menu"), false);
      alternar($("botao-info"), $("info"), false);
    });
  }

  // ===== Atualização automática (1 chamada a cada 5 minutos) =====
  let atualizando = false;
  async function atualizar() {
    if (document.hidden || atualizando || !estado.resumo.length) return;
    atualizando = true;
    try {
      const resumo = await window.CityDataSource.summary();
      // Esquece os detalhes de cidades que ganharam uma análise nova.
      for (const [id, latest] of estado.detalhes) {
        const novo = resumo.find((item) => String(item.city_id) === id);
        if (!novo || novo.execution_id !== latest.execution.id) estado.detalhes.delete(id);
      }
      aplicarResumo(resumo);
    } catch {
      // Falhou agora: mantém o que já está na tela e tenta de novo no próximo ciclo.
    } finally {
      atualizando = false;
    }
  }

  function aplicarResumo(resumo) {
    estado.resumo = resumo;
    window.MapaEstado.atualizar(resumo);
    window.Busca.atualizar(resumo);
    desenharComparacao();
    if (!estado.cidade) desenharInfo();
    const agora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date());
    $("nota-fonte").textContent = `Resultados consultados na API às ${agora}: ${resumo.length} cidades analisadas.`;
  }

  // ===== Início =====
  function criarMapa() {
    mapa = window.L.map("mapa", { zoomControl: false, minZoom: 5, maxZoom: 18, zoomSnap: 0.25 }).setView(INICIO.centro, INICIO.zoom);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "mapa-base",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Municípios: <a href="https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html" target="_blank" rel="noopener">IBGE</a>',
    }).addTo(mapa);
  }

  async function iniciar() {
    const enderecoInicial = location.hash; // lido antes, porque abrir/voltar reescreve o endereço
    $("erro-inicial").hidden = true;
    carregando(true, "Carregando os resultados…");
    try {
      const resumo = await window.CityDataSource.summary();
      if (!resumo.length) throw new Error("Ainda não há cidades com análise concluída. Tente novamente mais tarde.");
      aplicarResumo(resumo);
      await window.MapaEstado.iniciar({ mapaDaTela: mapa, resumo, aoEscolherCidade: abrirCidade });
      carregando(false);
      // Endereço com cidade (#cidade=2) abre direto nela; senão, mostra o mapa de SP.
      const parametros = new URLSearchParams(enderecoInicial.slice(1));
      if (CATEGORIAS[parametros.get("categoria")]) escolherCategoria(parametros.get("categoria"));
      if (parametros.get("cidade")) abrirCidade(parametros.get("cidade"));
      else voltarParaSP();
      // Links antigos do site (#metodologia e #comparar) abrem o painel certo.
      if (enderecoInicial === "#metodologia") abrirPainel("metodologia");
      if (enderecoInicial === "#comparar") abrirPainel("comparar");
    } catch (erro) {
      carregando(false);
      $("erro-inicial-texto").textContent = erro.message || "Não foi possível carregar os resultados.";
      $("erro-inicial").hidden = false;
    }
  }

  window.Icones.preencher(); // troca os <i data-icone="..."> pelos desenhos
  criarMapa();
  window.MapaEstado.aoMudarNotas = () => { if (!estado.cidade) desenharLegenda(); };
  window.MapaCidade.iniciar(mapa, { carregando, erro: avisar });
  window.Simulacao.iniciar(mapa, () => { desenharCartao(); desenharInfo(); });
  window.Busca.iniciar(abrirCidade);
  ligarEventos();
  $("tentar-de-novo").addEventListener("click", iniciar);
  setInterval(atualizar, ATUALIZAR_A_CADA);
  iniciar();
})();
