"use strict";

// Organiza a tela: um mapa em tela cheia com painéis flutuando por cima.
// - Sem cidade aberta: mapa-múndi com as cidades analisadas (mapa-mundo.js).
// - Com cidade aberta: mapa de calor da cidade (mapa-cidade.js), card de métricas
//   e simulação (simulacao.js).
// Os detalhes de uma cidade só são pedidos à API quando ela é aberta.
(() => {
  const CATEGORIAS = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
  const LUGAR = { health: "a um serviço de saúde", education: "a um local de educação", food: "a um comércio de alimentos", culture: "a um espaço de cultura" };
  const GERAL = "overall"; // índice geral = quem chega aos 4 tipos de serviço
  const ATUALIZAR_A_CADA = 5 * 60 * 1000; // confere novas análises a cada 5 minutos

  const $ = (id) => document.getElementById(id);
  const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const dataBR = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });

  const estado = {
    resumo: [],             // resposta de /cities/summary (todas as cidades analisadas)
    cidade: null,           // cidade aberta: { id, nome } (null = mapa-múndi)
    latest: null,           // detalhes da cidade aberta (/cities/{id}/latest)
    detalhes: new Map(),    // detalhes já baixados, por id da cidade
    categoria: GERAL,       // categoria escolhida no card da cidade
  };
  let mapa = null;
  let pedidoCidade = 0;     // ignora respostas de uma cidade que já não está aberta
  let temporizadorAviso = null;
  let navegacao = null, dadosProntos = false;

  // ===== Utilidades =====
  function escapar(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const pct = valor => window.SimulacaoVista.percentual(valor);
  const medida = categoria => window.SimulacaoVista.comparar(estado.latest?.population_report, window.Simulacao.resultado(), categoria);
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
  // Antes e depois da simulação (null = nenhuma simulação calculada).
  function valorSimulado(categoria) {
    const resultado = window.Simulacao.resultado();
    if (!resultado) return null;
    return medida(categoria);
  }

  // ===== Card de métricas =====
  function desenharCartao() {
    $("cartao-estado").hidden = Boolean(estado.cidade);
    $("cartao-cidade").hidden = !estado.cidade;
    $("sim-resultado-acoes").hidden = !estado.cidade || !window.Simulacao.resultado();
    if (!estado.cidade) return;
    $("cidade-nome").textContent = estado.cidade.nome;
    if (!estado.latest) { $("valor").textContent = "…"; $("valor-legenda").textContent = "Carregando os resultados…"; return; }

    const categoria = estado.categoria;
    const simulado = valorSimulado(categoria);
    const dados = medida(categoria);
    $("valor-contexto").textContent = simulado ? "Com os novos locais" : "População com acesso";
    $("valor").textContent = pct(dados?.depois);
    const alvo = categoria === GERAL ? "aos 4 tipos de serviço" : LUGAR[categoria];
    $("valor-legenda").textContent = !dados
      ? "Resultado indisponível para esta categoria."
      : `Parcela da população ${simulado ? "que teria acesso" : "com acesso"} ${alvo} em até ${decimal.format(limiar())} minutos a pé.`;

    $("impacto").hidden = !simulado;
    if (simulado) {
      const texto = window.SimulacaoVista.impacto(simulado);
      $("impacto").innerHTML = `<strong>${escapar(texto.titulo)}</strong><span>${escapar(texto.detalhe)}</span>`;
      $("impacto").className = `impacto ${texto.tipo}`;
    }

    // Azul: acesso atual; verde: ganho percentual; vermelho: sem acesso em ate 15 min.
    const hoje = dados?.antes ?? 0;
    const depois = dados?.depois ?? hoje;
    const partes = {
      original: { largura: Math.min(hoje, depois), titulo: depois < hoje ? "Continuariam com acesso" : "Já têm acesso" },
      impacto: { largura: Math.max(0, depois - hoje), titulo: "Passariam a ter acesso" },
      resto: { largura: Math.max(0, 100 - depois) },
    };
    $("barra-original-rotulo").textContent = partes.original.titulo;
    $("barra-resto-rotulo").textContent = `Sem acesso em até ${decimal.format(limiar())} min`;
    for (const segmento of document.querySelectorAll("#barra .seg")) {
      const parte = partes[segmento.dataset.seg];
      segmento.style.width = `${Math.max(0, parte.largura)}%`;
      segmento.hidden = parte.largura <= 0;
      segmento.dataset.dica = segmento.dataset.seg === "resto" && dados
        ? window.SimulacaoVista.semAcesso(dados, categoria, limiar())
        : segmento.dataset.seg === "impacto" && simulado
          ? `${window.SimulacaoVista.impacto(simulado).titulo} ${window.SimulacaoVista.impacto(simulado).detalhe}`
          : `${parte.titulo}: ${pct(parte.largura)} da população.`;
      segmento.setAttribute("aria-label", segmento.dataset.dica);
    }
  }

  // Dica que aparece em cima da barra ao passar o mouse (ou focar pelo teclado).
  function mostrarDica(evento) {
    if (evento.type === "pointerover" && (celular() || evento.pointerType === "touch")) return;
    const segmento = evento.target.closest(".seg");
    if (!segmento) return;
    $("dica").textContent = segmento.dataset.dica;
    $("dica").hidden = false;
  }

  // ===== Painel (i): informações da análise =====
  function desenharInfo() {
    const corpo = $("info-corpo");
    if (!estado.cidade || !estado.latest) {
      corpo.innerHTML = `
        <p class="suave">O índice geral é a parte da população que chega
        aos 4 tipos de serviço (saúde, educação, alimentação e cultura) em até 15 minutos a pé.</p>
        <p class="suave">Pesquise uma cidade ou selecione-a no mapa para consultar os resultados da análise.</p>
        <button class="botao-texto" type="button" data-painel="metodologia">${window.Icones.svg("livro")}Como funciona o cálculo</button>`;
      return;
    }
    const execucao = estado.latest.execution;
    const atual = medida(estado.categoria);
    const temSimulacao = Boolean(window.Simulacao.resultado());
    const linhas = [GERAL, ...Object.keys(CATEGORIAS)].map((codigo) => {
      const dados = medida(codigo);
      const ganhou = temSimulacao && dados?.variacao > 0;
      const nome = codigo === GERAL ? "Geral (4 tipos)" : CATEGORIAS[codigo];
      return `<tr${codigo === estado.categoria ? ' class="atual"' : ""}><th scope="row">${iconeDaCategoria(codigo)}${nome}</th><td>${pct(dados?.antes)}</td><td class="${ganhou ? "ganho" : temSimulacao && dados?.variacao < 0 ? "perda" : ""}">${temSimulacao ? pct(dados?.depois) : "—"}</td></tr>`;
    }).join("");
    corpo.innerHTML = `
      <dl class="destaques">
        <div><dt>Situação atual</dt><dd>${pct(atual?.antes)}</dd></div>
        <div><dt>Com novos locais</dt><dd class="${temSimulacao && atual?.variacao > 0 ? "ganho" : ""}">${temSimulacao ? pct(atual?.depois) : "—"}</dd></div>
      </dl>
      ${temSimulacao && atual ? `<p class="resumo-simulacao ${window.SimulacaoVista.impacto(atual).tipo}"><strong>${escapar(window.SimulacaoVista.impacto(atual).titulo)}</strong><br>${escapar(window.SimulacaoVista.impacto(atual).detalhe)}</p>` : ""}
      <table class="comparacao">
        <caption class="sr-only">Percentual da população com acesso, antes e depois da simulação</caption>
        <thead><tr><th scope="col">Categoria</th><th scope="col">Antes</th><th scope="col">Com novos locais</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <ul class="fatos">
        <li>${window.Icones.svg("pessoas")}<span><b>${inteiro.format(estado.latest.population_report.total_weight)}</b> pessoas consideradas</span></li>
        <li>${window.Icones.svg("caminhar")}<span>Até <b>${decimal.format(execucao.threshold_minutes)} min</b> a pé, a ${decimal.format(execucao.speed_kmh)} km/h</span></li>
        <li>${window.Icones.svg("calendario")}<span>Análise de ${escapar(dataBR.format(new Date(execucao.processed_at)))}</span></li>
      </ul>
      <p class="suave">A simulação compara percentuais de acesso. As cores do mapa representam a situação atual.</p>
      <button class="botao-texto" type="button" data-painel="metodologia">${window.Icones.svg("livro")}Como funciona o cálculo</button>`;
  }

  // ===== Legenda do canto da tela =====
  // Cada mapa (estado ou cidade) devolve: título, degradê da régua, marcas
  // ao lado da régua e itens extras (ícones ou quadradinhos de cor).
  function desenharLegenda() {
    const legenda = estado.cidade ? window.MapaCidade.legenda() : window.MapaMundo.legenda();
    $("legenda-titulo").textContent = legenda.titulo;
    $("legenda-regua").style.background = legenda.degrade;
    // A régua fica em pé: "posicao" 0 = no topo, 1 = embaixo.
    $("legenda-marcas").innerHTML = legenda.marcas
      .map((marca) => `<span style="top:${marca.posicao * 100}%">${escapar(marca.texto)}</span>`)
      .join("");
    $("legenda-itens").innerHTML = legenda.extras.map((item) => {
      const simbolo = item.icone
        ? `<span class="mini-pino" style="--cor:${window.Icones.cor(item.icone)}">${window.Icones.svg(item.icone)}</span>`
        : `<i style="background:${item.cor}"></i>`;
      return `<li>${simbolo}${escapar(item.texto)}</li>`;
    }).join("");
    $("legenda").hidden = false;
  }

  // ===== Abrir uma cidade / voltar para o mundo =====
  async function abrirCidade(id) {
    const cidadeId = String(id);
    const item = estado.resumo.find((cidade) => String(cidade.city_id) === cidadeId);
    if (!item) { avisar("Esta cidade ainda não foi analisada."); navegacao.voltarGlobal(); return; }
    const meu = ++pedidoCidade;
    estado.cidade = { id: cidadeId, nome: item.name };
    estado.latest = estado.detalhes.get(cidadeId) ?? null;
    window.Busca.mostrarNome(item.name);
    window.MapaMundo.esconder();
    fecharPaineis();
    desenharCartao();
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
      await window.MapaCidade.abrir(estado.latest.execution, margens(), estado.categoria);
      if (meu !== pedidoCidade) return;
      desenharLegenda();
    } catch (erro) {
      if (meu !== pedidoCidade) return;
      avisar(erro.message || "Não foi possível abrir a cidade.");
      navegacao.voltarGlobal();
    } finally {
      if (meu === pedidoCidade) carregando(false);
    }
  }

  function voltarParaMundo(vista, caminho) {
    pedidoCidade++;
    fecharPaineis();
    alternar($("botao-menu"), $("menu"), false);
    alternar($("botao-info"), $("info"), false);
    $("legenda").open = false;
    $("dica").hidden = true;
    estado.cidade = null;
    estado.latest = null;
    window.Simulacao.reset(null);
    window.MapaCidade.fechar();
    window.Busca.mostrarNome("");
    carregando(false);
    desenharCartao();
    desenharNavegacaoRegional(caminho);
    window.MapaMundo.mostrar(margens, vista, caminho);
    desenharInfo();
    desenharLegenda();
  }

  function navegarParaCidade(id, categoria = estado.categoria) {
    const caminho = window.RegioesMapa.caminhoCidade(id);
    if (caminho.length) navegacao.abrirHierarquia(caminho, id, categoria);
    else navegacao.abrirCidade(id, categoria, window.MapaMundo.capturarVista());
  }

  function desenharNavegacaoRegional(caminho) {
    const regioes = window.RegioesMapa;
    const regiao = regioes.obter(caminho.at(-1));
    const pai = regioes.obter(caminho.at(-2));
    $("regiao-titulo").textContent = regiao?.nome ?? "Mapa global";
    $("voltar-regiao").hidden = !caminho.length;
    $("voltar-regiao").textContent = `‹ ${pai?.nome ?? "Mapa global"}`;
    const filhas = regioes.filhas(caminho);
    const proximo = filhas[0]?.id.split(":")[0];
    const seletor = $("seletor-regiao");
    const rotulo = {continente:"Escolher continente", pais:"Escolher país", estado:"Escolher estado ou província"};
    seletor.setAttribute("aria-label", rotulo[proximo] ?? "Escolher região");
    seletor.replaceChildren(new Option(rotulo[proximo] ?? "Escolher região", ""));
    for (const filha of [...filhas].sort((a,b) => a.nome.localeCompare(b.nome,"pt-BR"))) {
      seletor.add(new Option(filha.nome, filha.id));
    }
    seletor.hidden = !filhas.length;
    $("regiao-orientacao").textContent = filhas.length
      ? "Escolha uma região no seletor ou explore o mapa."
      : "Clique em uma cidade no mapa ou pesquise pelo nome.";
    ajustarZoomRegional(true);
  }

  function ajustarZoomRegional(livre) {
    $("grupo-zoom").hidden = !livre;
    for (const controle of ["scrollWheelZoom", "doubleClickZoom", "touchZoom", "keyboard"]) {
      mapa[controle]?.[livre ? "enable" : "disable"]();
    }
  }

  // Voltar/Avancar restauram a tela sem escrever outra entrada de historico.
  function mostrarRota(rota) {
    if (!dadosProntos) return;
    if (rota.cidade) {
      ajustarZoomRegional(true);
      const regiao = window.RegioesMapa.obter(rota.caminho.at(-1));
      $("voltar-rotulo").textContent = regiao?.nome ?? (rota.vista ? "Voltar à região" : "Mapa global");
      escolherCategoria(rota.categoria);
      abrirCidade(rota.cidade);
    } else voltarParaMundo(rota.vista, rota.caminho);
    if (rota.metodologia) abrirPainel("metodologia");
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
    if (CATEGORIAS[categoria]) window.Simulacao.escolherTipo(categoria);
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
    $("painel-metodologia").hidden = true;
  }

  function ligarEventos() {
    // Card da cidade: botões de categoria
    for (const botao of document.querySelectorAll("#categorias [data-categoria]")) {
      botao.addEventListener("click", () => {
        const categoria = botao.dataset.categoria;
        escolherCategoria(categoria === estado.categoria ? GERAL : categoria);
        window.MapaCidade.trocarCategoria(estado.categoria);
        desenharCartao();
        desenharInfo();
        desenharLegenda();
        navegacao.atualizarCategoria(estado.categoria);
      });
    }
    $("voltar").addEventListener("click", () => navegacao.voltarGlobal());
    $("voltar-regiao").addEventListener("click", () => navegacao.voltarGlobal());
    $("seletor-regiao").addEventListener("change", evento => {
      const seletor = evento.currentTarget;
      const destino = window.RegioesMapa.obter(seletor.value);
      seletor.value = "";
      if (destino) navegacao.abrirHierarquia(destino.caminho);
    });
    $("recolher-cartao").addEventListener("click", alternarCartao);
    // Guarda a altura do card numa variável do CSS (--altura-cartao). No celular,
    // o botão (i) e o "centralizar" usam essa medida para ficar logo acima do card,
    // subindo e descendo junto quando ele abre ou é minimizado.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty("--altura-cartao", `${$("cartao").offsetHeight}px`);
    }).observe($("cartao"));
    $("barra").addEventListener("pointerover", mostrarDica);
    $("barra").addEventListener("focusin", mostrarDica);
    $("barra").addEventListener("click", mostrarDica);
    $("barra").addEventListener("pointerleave", () => { if (!celular()) $("dica").hidden = true; });
    document.addEventListener("pointerdown", evento => { if (!evento.target.closest("#barra, #dica")) $("dica").hidden = true; });
    $("sim-ver-resultado").addEventListener("click", () => {
      alternar($("botao-menu"), $("menu"), false);
      alternar($("botao-info"), $("info"), true);
      $("info").scrollTop = 0;
      $("info").querySelector(".botao-fechar").focus();
    });
    $("sim-ir-locais").addEventListener("click", () => {
      if (celular() && !$("cartao").classList.contains("recolhido")) alternarCartao();
      window.Simulacao.centralizar(margens());
    });

    // Menu
    $("botao-menu").addEventListener("click", () => alternar($("botao-menu"), $("menu")));
    $("ranking-cidades").addEventListener("click", evento => {
      if (evento.target.closest("button[data-cidade]")) alternar($("botao-menu"), $("menu"), false);
    });
    for (const botao of document.querySelectorAll("[data-modo]")) {
      botao.addEventListener("click", () => {
        for (const outro of document.querySelectorAll("[data-modo]")) outro.setAttribute("aria-pressed", String(outro === botao));
        window.MapaCidade.trocarModo(botao.dataset.modo);
      });
    }
    $("mostrar-locais").addEventListener("change", (evento) => window.MapaCidade.trocarLocais(evento.target.checked));

    // Painel (i)
    $("botao-info").addEventListener("click", () => alternar($("botao-info"), $("info")));

    // Controles do mapa
    $("zoom-mais").addEventListener("click", () => {
      if (!$("grupo-zoom").hidden) mapa.zoomIn();
    });
    $("zoom-menos").addEventListener("click", () => {
      if (!$("grupo-zoom").hidden) mapa.zoomOut();
    });
    $("centralizar").addEventListener("click", () => {
      if (estado.cidade) window.MapaCidade.centralizar(margens());
      else window.MapaMundo.mostrar(margens, null, navegacao.ler().caminho);
    });

    // Cliques nos botões de abertura e fechamento dos painéis.
    document.addEventListener("click", (evento) => {
      const painel = evento.target.closest("[data-painel]");
      if (painel) abrirPainel(painel.dataset.painel);
      const fechar = evento.target.closest("[data-fechar]");
      if (fechar) {
        $(fechar.dataset.fechar).hidden = true;
        if (fechar.dataset.fechar === "info") $("botao-info").setAttribute("aria-expanded", "false");
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
    window.MapaMundo.atualizar(resumo);
    window.Busca.atualizar(resumo);
    if (!estado.cidade) desenharInfo();
    const agora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date());
    $("nota-fonte").textContent = `Resultados consultados na API às ${agora}: ${resumo.length} cidades analisadas.`;
  }

  // ===== Início =====
  function criarMapa() {
    mapa = window.L.map("mapa", {
      zoomControl: false, boxZoom: false, minZoom: 0, maxZoom: 18, zoomSnap: 0.25,
      worldCopyJump: true, maxBoundsViscosity: 1,
    });
    ajustarZoomRegional(false);
    mapa.on("resize", () => window.CityMapViewport.resize(mapa));
    window.CityMapViewport.showWorld(mapa);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: false,
      keepBuffer: 1,
      updateWhenIdle: true,
      updateWhenZooming: false,
      className: "mapa-base",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Resultados: Cidade15',
    }).addTo(mapa);
  }

  async function iniciar() {
    dadosProntos = false;
    $("erro-inicial").hidden = true;
    carregando(true, "Carregando os resultados…");
    try {
      const resumo = await window.CityDataSource.summary();
      if (!resumo.length) throw new Error("Ainda não há cidades com análise concluída. Tente novamente mais tarde.");
      aplicarResumo(resumo);
      await window.MapaMundo.iniciar({
        mapaDaTela: mapa, resumo, aoEscolherCidade: navegarParaCidade,
        aoAbrirRegiao: caminho => navegacao.abrirHierarquia(caminho),
      });
      navegacao.iniciar(window.RegioesMapa.caminhoCidade);
      carregando(false);
      dadosProntos = true;
      // Le o endereco atual: o usuario pode ter voltado durante o carregamento.
      mostrarRota(navegacao.ler());
    } catch (erro) {
      carregando(false);
      $("erro-inicial-texto").textContent = erro.message || "Não foi possível carregar os resultados.";
      $("erro-inicial").hidden = false;
    }
  }

  window.Icones.preencher(); // troca os <i data-icone="..."> pelos desenhos
  criarMapa();
  window.MapaMundo.aoMudarRegioes = () => {
    if (dadosProntos && !estado.cidade) desenharNavegacaoRegional(navegacao.ler().caminho);
  };
  window.MapaMundo.aoMudarNotas = () => { if (!estado.cidade) desenharLegenda(); };
  window.MapaCidade.iniciar(mapa, { carregando, erro: avisar });
  window.Simulacao.iniciar(mapa, ({concluida = false} = {}) => {
    desenharCartao(); desenharInfo();
    if (window.Simulacao.emAdicao() && celular()) {
      $("legenda").open = false;
      alternar($("botao-menu"), $("menu"), false);
      alternar($("botao-info"), $("info"), false);
    }
    if (concluida && celular()) $("sim-resultado-acoes").scrollIntoView({block:"nearest"});
  });
  window.Busca.iniciar(navegarParaCidade);
  ligarEventos();
  navegacao = window.NavegacaoMapa.criar({aoNavegar:mostrarRota});
  $("tentar-de-novo").addEventListener("click", iniciar);
  setInterval(atualizar, ATUALIZAR_A_CADA);
  iniciar();
})();
