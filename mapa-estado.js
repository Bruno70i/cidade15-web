"use strict";

// Mapa do estado de SP (primeira tela do site).
// - Os contornos dos 645 municípios vêm do IBGE (arquivo dados/municipios-sp.json).
// - A nota de cada cidade vem da API, numa chamada só (/api/v1/cities/summary).
// - As caixinhas escolhem as categorias: com as 4 marcadas é o índice geral;
//   com algumas, é a % de pessoas que chegam a TODAS as marcadas.
// - Clicar numa cidade (ou escolher na busca) abre os resultados dela.
(() => {
    const NOMES = { health: "saúde", education: "educação", food: "alimentação", culture: "cultura" };
    // Cores da nota mais baixa (clara) para a mais alta (escura).
    const CORES = ["#f3e9b9", "#cfe3a8", "#8cc8a0", "#3f9e8c", "#176c63"];
    const COR_SEM_ANALISE = "#e3e7ea";
    const el = (id) => document.getElementById(id);
    const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

    let mapa = null;            // o mapa do Leaflet (criado quando a tela aparece)
    let camada = null;          // os municípios desenhados no mapa
    let contornos = null;       // o arquivo do IBGE já carregado
    let aoEscolher = () => {};  // função do app.js chamada ao escolher uma cidade
    let cidades = [];           // cidades analisadas: { id, nome, chave }
    let resumoGeral = [];       // resposta da API com as 4 categorias (reaproveitada)
    let notas = new Map();      // nome normalizado -> % da combinação escolhida
    let limites = [];           // onde termina cada faixa de cor (em %)
    let sugestoes = [];         // cidades listadas embaixo da busca
    let ativa = -1;             // sugestão destacada pelas setas do teclado
    let pedido = 0;             // conta os pedidos para ignorar respostas atrasadas

    // "Santa Bárbara d'Oeste" -> "santa barbara doeste": assim o nome da API e o
    // do IBGE ficam iguais mesmo com acentos, hífens ou apóstrofos diferentes.
    function normalizar(texto) {
        return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
            .replace(/['’]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
    }
    function porcentagem(valor) {
        return `${numero.format(valor)}%`;
    }
    function escapar(texto) {
        return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    function mensagem(texto) {
        el("estado-status").textContent = texto;
    }

    // ===== Categorias marcadas =====
    function categoriasMarcadas() {
        return [...document.querySelectorAll("#combinacao input:checked")].map((caixa) => caixa.value);
    }
    // Texto usado na dica e na legenda: "aos 4 tipos de serviço", "a saúde e cultura"...
    function textoCombinacao() {
        const nomes = categoriasMarcadas().map((codigo) => NOMES[codigo]);
        if (nomes.length === 4) return "aos 4 tipos de serviço";
        if (nomes.length === 1) return `a ${nomes[0]}`;
        return `a ${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
    }

    // ===== Cores =====
    // "Menos de 0,5%" é uma faixa própria, porque muitas cidades pequenas têm quase
    // 0% no índice geral. As outras cidades são divididas em 4 grupos com a mesma
    // quantidade de cidades (quartis), para o mapa não ficar todo de uma cor só.
    function calcularLimites(valores) {
        const acima = valores.filter((valor) => valor >= 0.5).sort((a, b) => a - b);
        if (acima.length < 4) return [];
        const quartil = (fracao) => acima[Math.floor(fracao * acima.length)];
        return [quartil(0.25), quartil(0.5), quartil(0.75)];
    }
    function corDaNota(valor) {
        if (valor === undefined) return COR_SEM_ANALISE;
        if (valor < 0.5) return CORES[0];
        let faixa = 1;
        for (const limite of limites) {
            if (valor > limite) faixa++;
        }
        return CORES[faixa];
    }

    // ===== Desenho dos municípios =====
    function notaDe(nomeDoMunicipio) {
        return notas.get(normalizar(nomeDoMunicipio));
    }
    function estilo(municipio) {
        const valor = notaDe(municipio.properties.nome);
        return { color: "#ffffff", weight: 0.7, fillColor: corDaNota(valor), fillOpacity: valor === undefined ? 0.65 : 0.9 };
    }
    function dica(municipio) {
        const valor = notaDe(municipio.properties.nome);
        const linha = valor === undefined
            ? "Ainda sem análise"
            : `${porcentagem(valor)} da população tem acesso ${textoCombinacao()}`;
        return `<strong>${escapar(municipio.properties.nome)}</strong><br>${escapar(linha)}`;
    }
    // Liga a dica, o destaque ao passar o mouse e o clique de cada município.
    function prepararMunicipio(municipio, forma) {
        forma.bindTooltip(() => dica(municipio), { sticky: true, direction: "top", offset: [0, -8], className: "state-tooltip" });
        forma.on("mouseover", () => forma.setStyle({ weight: 2.5, color: "#243746" }));
        forma.on("mouseout", () => camada.resetStyle(forma));
        forma.on("click", () => escolherPorNome(municipio.properties.nome));
    }
    function escolherPorNome(nome) {
        const cidade = cidades.find((item) => item.chave === normalizar(nome));
        if (cidade) aoEscolher(cidade.id);
        else mensagem(`${nome} ainda não foi analisada.`);
    }

    function criarMapa() {
        mapa = window.L.map("mapa-estado", { scrollWheelZoom: false, minZoom: 5, maxZoom: 12, zoomSnap: 0.25 });
        window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Municípios: <a href="https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html" target="_blank" rel="noopener">IBGE</a>',
        }).addTo(mapa);
        camada = window.L.geoJSON(contornos, { style: estilo, onEachFeature: prepararMunicipio }).addTo(mapa);
        mapa.fitBounds(camada.getBounds(), { padding: [8, 8] });
    }

    // ===== Notas, legenda e resumo =====
    // lista = resposta da API (/cities/summary) para as categorias marcadas.
    function aplicarNotas(lista) {
        notas = new Map();
        for (const item of lista) {
            if (Number.isFinite(item.selected_coverage_percentage)) notas.set(normalizar(item.name), item.selected_coverage_percentage);
        }
        limites = calcularLimites([...notas.values()]);
        camada?.setStyle(estilo); // repinta os municípios
        desenharLegenda();
        escreverResumo(lista);
    }

    function desenharLegenda() {
        const faixas = [{ cor: CORES[0], texto: "menos de 0,5%" }];
        let inicio = 0.5;
        limites.forEach((limite, i) => {
            faixas.push({ cor: CORES[i + 1], texto: `${numero.format(inicio)}% a ${numero.format(limite)}%` });
            inicio = limite;
        });
        faixas.push({ cor: CORES[limites.length + 1], texto: limites.length ? `mais de ${numero.format(inicio)}%` : "0,5% ou mais" });
        faixas.push({ cor: COR_SEM_ANALISE, texto: "ainda sem análise" });
        el("legenda-estado-titulo").textContent = `Pessoas com acesso ${textoCombinacao()} em até 15 minutos a pé`;
        el("legenda-estado").innerHTML = faixas
            .map((faixa) => `<li><i style="background:${faixa.cor}"></i>${escapar(faixa.texto)}</li>`)
            .join("");
    }

    function escreverResumo(lista) {
        const comNota = lista.filter((item) => Number.isFinite(item.selected_coverage_percentage));
        if (!comNota.length) { mensagem(""); return; }
        const melhor = comNota.reduce((a, b) => (b.selected_coverage_percentage > a.selected_coverage_percentage ? b : a));
        const total = contornos ? contornos.features.length : comNota.length;
        mensagem(`${comNota.length} de ${total} municípios já analisados. Maior acesso: ${melhor.name} (${porcentagem(melhor.selected_coverage_percentage)}).`);
    }

    // Chamado quando o usuário marca ou desmarca uma categoria.
    async function trocarCombinacao(evento) {
        const marcadas = categoriasMarcadas();
        if (!marcadas.length) {
            evento.target.checked = true; // pelo menos uma precisa ficar marcada
            mensagem("Marque pelo menos uma categoria.");
            return;
        }
        const meu = ++pedido;
        if (marcadas.length === 4) {
            aplicarNotas(resumoGeral); // já temos essa resposta: não precisa chamar a API
            return;
        }
        mensagem("Calculando as notas…");
        try {
            const lista = await window.CityDataSource.summary(marcadas);
            if (meu === pedido) aplicarNotas(lista);
        } catch (erro) {
            if (meu === pedido) mensagem(erro.message || "Não foi possível calcular as notas agora.");
        }
    }

    // ===== Busca com sugestões =====
    function buscar(texto) {
        const termo = normalizar(texto);
        if (!termo) return [];
        const comecam = cidades.filter((cidade) => cidade.chave.startsWith(termo));
        const contem = cidades.filter((cidade) => !cidade.chave.startsWith(termo) && cidade.chave.includes(termo));
        return [...comecam, ...contem].slice(0, 8);
    }

    function desenharSugestoes() {
        const campo = el("busca-cidade");
        const lista = el("sugestoes");
        const aberta = campo.value.trim() !== "" && document.activeElement === campo;
        lista.hidden = !aberta;
        campo.setAttribute("aria-expanded", String(aberta));
        if (!aberta) return;
        if (!sugestoes.length) {
            lista.innerHTML = '<li class="suggestion-empty">Nenhuma cidade analisada com esse nome</li>';
            return;
        }
        lista.innerHTML = sugestoes.map((cidade, i) => {
            const valor = notas.get(cidade.chave);
            // Bolinha com a cor do mapa + a nota, para a pessoa já ver como a cidade está.
            const nota = valor === undefined ? "" : `<span class="suggestion-score"><i style="background:${corDaNota(valor)}"></i>${porcentagem(valor)}</span>`;
            return `<li id="sugestao-${i}" role="option" aria-selected="${i === ativa}" data-indice="${i}"><span>${escapar(cidade.nome)}</span>${nota}</li>`;
        }).join("");
        if (ativa >= 0) campo.setAttribute("aria-activedescendant", `sugestao-${ativa}`);
    }

    function escolherSugestao(indice) {
        const cidade = sugestoes[indice];
        if (!cidade) return;
        el("busca-cidade").value = "";
        sugestoes = [];
        el("busca-cidade").blur();
        aoEscolher(cidade.id);
    }

    function ligarEventos() {
        const campo = el("busca-cidade");
        campo.addEventListener("input", () => {
            sugestoes = buscar(campo.value);
            ativa = sugestoes.length ? 0 : -1;
            desenharSugestoes();
        });
        campo.addEventListener("blur", () => setTimeout(desenharSugestoes, 0));
        campo.addEventListener("keydown", (evento) => {
            if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
                if (!sugestoes.length) return;
                evento.preventDefault();
                const passo = evento.key === "ArrowDown" ? 1 : -1;
                ativa = (ativa + passo + sugestoes.length) % sugestoes.length;
                desenharSugestoes();
            } else if (evento.key === "Enter") {
                evento.preventDefault();
                escolherSugestao(Math.max(0, ativa));
            } else if (evento.key === "Escape") {
                campo.blur();
            }
        });
        // "mousedown" (e não "click") para escolher antes de o campo perder o foco.
        el("sugestoes").addEventListener("mousedown", (evento) => {
            const item = evento.target.closest("[data-indice]");
            if (!item) return;
            evento.preventDefault();
            escolherSugestao(Number(item.dataset.indice));
        });
        for (const caixa of document.querySelectorAll("#combinacao input")) {
            caixa.addEventListener("change", trocarCombinacao);
        }
    }

    // ===== Ponte com o app.js =====
    window.MapaEstado = {
        // Chamado uma vez ao abrir o site.
        async iniciar({ resumo, aoEscolherCidade }) {
            aoEscolher = aoEscolherCidade;
            ligarEventos();
            this.atualizar(resumo);
            try {
                const resposta = await fetch("dados/municipios-sp.json?v=20261101-mapa-sp-01");
                if (!resposta.ok) throw new Error();
                contornos = await resposta.json();
                escreverResumo(resumoGeral);
                this.mostrar();
            } catch {
                mensagem("Não foi possível carregar o mapa dos municípios. Recarregue a página para tentar de novo.");
            }
        },
        // Chamado com uma resposta nova da API (ao abrir e a cada atualização).
        atualizar(resumo) {
            resumoGeral = resumo;
            cidades = resumo.map((item) => ({ id: String(item.city_id), nome: item.name, chave: normalizar(item.name) }))
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
            if (categoriasMarcadas().length === 4) aplicarNotas(resumo);
        },
        // Chamado quando a tela do mapa aparece (o Leaflet precisa da tela visível).
        mostrar() {
            if (!contornos || !el("mapa-estado").offsetWidth) return;
            if (!mapa) criarMapa();
            else mapa.invalidateSize();
        },
    };
})();
