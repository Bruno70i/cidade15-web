"use strict";

// Mapa do estado de SP (o que aparece ao abrir o site).
// - Os contornos dos 645 municípios vêm do IBGE (arquivo dados/municipios-sp.json).
// - A nota de cada cidade vem da API, numa chamada só (/api/v1/cities/summary).
// - As caixinhas do card escolhem as categorias: com as 4 marcadas é o índice
//   geral; com algumas, é a % de pessoas que chegam a TODAS as marcadas.
// - Clicar numa cidade analisada abre a cidade (quem decide o que fazer é o app.js).
(() => {
    const NOMES = { health: "saúde", education: "educação", food: "alimentação", culture: "cultura" };
    const COR_SEM_ANALISE = "#cfd5de";
    const el = (id) => document.getElementById(id);
    const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

    let mapa = null;            // o mapa da tela (criado pelo app.js)
    let camada = null;          // os municípios desenhados
    let contornos = null;       // o arquivo do IBGE já carregado
    let aoEscolher = () => {};  // função do app.js chamada ao clicar numa cidade
    let cidades = [];           // cidades analisadas: { id, nome, chave }
    let resumoGeral = [];       // resposta da API com as 4 categorias (reaproveitada)
    let notas = new Map();      // nome normalizado -> % da combinação escolhida
    let ordenadas = [];         // todas as notas, da menor para a maior (para o ranking)
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

    // ===== Cores (degradê pelo ranking) =====
    // A cor mostra a POSIÇÃO da cidade comparada às outras: a pior fica no começo
    // do degradê (vermelho) e a melhor no fim (verde-azulado). Usamos o ranking
    // porque muitas cidades pequenas têm quase 0%: com uma régua fixa de 0% a 100%,
    // o mapa ficaria quase todo da mesma cor.
    // Cidades com 0% ficam no vermelho mais escuro; as outras são comparadas entre
    // si e ocupam o resto do degradê.
    const ZERO = 0.05; // abaixo disso a nota é mostrada como 0%
    function posicaoNoRanking(valor) {
        if (valor < ZERO) return 0;
        const positivas = ordenadas.filter((nota) => nota >= ZERO);
        if (positivas.length < 2) return 1;
        // Quantas cidades têm nota menor que esta (a lista está em ordem crescente).
        const menores = positivas.findIndex((outra) => outra >= valor);
        return 0.12 + 0.88 * (menores / (positivas.length - 1));
    }
    function corDaNota(valor) {
        if (valor === undefined) return COR_SEM_ANALISE;
        return window.Cores.css(posicaoNoRanking(valor));
    }

    // ===== Desenho dos municípios =====
    function notaDe(nomeDoMunicipio) {
        return notas.get(normalizar(nomeDoMunicipio));
    }
    function estilo(municipio) {
        const valor = notaDe(municipio.properties.nome);
        return { color: "#ffffff", weight: 0.7, fillColor: corDaNota(valor), fillOpacity: valor === undefined ? 0.55 : 0.85 };
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
        forma.bindTooltip(() => dica(municipio), { sticky: true, direction: "top", offset: [0, -8] });
        forma.on("mouseover", () => forma.setStyle({ weight: 2.5, color: "#0f1b33" }));
        forma.on("mouseout", () => camada.resetStyle(forma));
        forma.on("click", () => {
            const cidade = cidades.find((item) => item.chave === normalizar(municipio.properties.nome));
            if (cidade) aoEscolher(cidade.id);
            else mensagem(`${municipio.properties.nome} ainda não foi analisada.`);
        });
    }

    // ===== Notas e resumo =====
    // lista = resposta da API (/cities/summary) para as categorias marcadas.
    function aplicarNotas(lista) {
        notas = new Map();
        for (const item of lista) {
            if (Number.isFinite(item.selected_coverage_percentage)) notas.set(normalizar(item.name), item.selected_coverage_percentage);
        }
        ordenadas = [...notas.values()].sort((a, b) => a - b);
        camada?.setStyle(estilo); // repinta os municípios
        escreverResumo(lista);
        window.MapaEstado.aoMudarNotas(); // o app.js redesenha a legenda
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

    // ===== Ponte com o app.js =====
    window.MapaEstado = {
        aoMudarNotas: () => {}, // o app.js troca por uma função que redesenha a legenda

        // Chamado uma vez ao abrir o site.
        async iniciar({ mapaDaTela, resumo, aoEscolherCidade }) {
            mapa = mapaDaTela;
            aoEscolher = aoEscolherCidade;
            for (const caixa of document.querySelectorAll("#combinacao input")) {
                caixa.addEventListener("change", trocarCombinacao);
            }
            this.atualizar(resumo);
            try {
                const resposta = await fetch("dados/municipios-sp.json?v=20261102-layout-01");
                if (!resposta.ok) throw new Error();
                contornos = await resposta.json();
            } catch {
                mensagem("Não foi possível carregar o mapa dos municípios. Recarregue a página para tentar de novo.");
                return;
            }
            camada = window.L.geoJSON(contornos, { style: estilo, onEachFeature: prepararMunicipio });
            escreverResumo(resumoGeral);
        },

        // Chamado com uma resposta nova da API (ao abrir e a cada atualização).
        atualizar(resumo) {
            resumoGeral = resumo;
            cidades = resumo.map((item) => ({ id: String(item.city_id), nome: item.name, chave: normalizar(item.name) }));
            if (categoriasMarcadas().length === 4) aplicarNotas(resumo);
        },

        // Coloca o mapa de SP na tela (ou tira, quando uma cidade é aberta).
        mostrar(margens) {
            if (!camada) return;
            if (!mapa.hasLayer(camada)) camada.addTo(mapa);
            mapa.invalidateSize(); // mede a tela de novo antes de enquadrar
            // Se a página abriu escondida (tela com tamanho zero), espera ela aparecer.
            if (!mapa.getSize().x) { mapa.once("resize", () => this.mostrar(margens)); return; }
            mapa.fitBounds(camada.getBounds(), margens);
        },
        esconder() {
            if (camada && mapa.hasLayer(camada)) mapa.removeLayer(camada);
        },

        // Nota (e cor) de uma cidade, para a busca mostrar ao lado do nome.
        notaECor(nome) {
            const valor = notaDe(nome);
            return valor === undefined ? null : { texto: porcentagem(valor), cor: corDaNota(valor) };
        },

        // Dados da legenda do canto da tela: régua do pior ao melhor ranking.
        legenda() {
            const menor = ordenadas[0] ?? 0;
            const maior = ordenadas[ordenadas.length - 1] ?? 0;
            const zeradas = ordenadas.filter((nota) => nota < ZERO).length;
            const sobreZeradas = zeradas
                ? `${zeradas} de ${ordenadas.length} cidades têm 0% e ficam no vermelho mais escuro. `
                : "";
            return {
                titulo: `População com acesso ${textoCombinacao()} em até 15 min`,
                tituloCurto: "Acesso",
                degrade: window.Cores.degrade(true, "180deg"), // em cima a melhor cidade
                // "curto" é o texto usado no celular, onde a legenda é estreita.
                marcas: [
                    { posicao: 0, texto: `${porcentagem(maior)} melhor`, curto: porcentagem(maior) },
                    { posicao: 1, texto: `${porcentagem(menor)} pior`, curto: porcentagem(menor) },
                ],
                extras: [{ cor: COR_SEM_ANALISE, texto: "ainda sem análise" }],
                nota: `${sobreZeradas}A cor compara as cidades entre si. Contornos: IBGE.`,
            };
        },
    };
})();
