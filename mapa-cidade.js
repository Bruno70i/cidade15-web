"use strict";

// Camadas da cidade aberta: contorno, mapa de calor (ou pontos) e estabelecimentos.
// A amostra municipal vem do serviço de mapas (/mapas/v1) uma vez por categoria.
// Cada ponto é um trecho de rua com o tempo a pé até o serviço mais próximo.
(() => {
    const L = window.L;
    const CATEGORIAS = ["health", "education", "food", "culture"];
    const NOMES = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
    const fonte = window.CityMapData.create(); // consultas ao /mapas/v1 (map-data.js)
    const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

    let mapa = null;
    let camadaCalor, camadaPontos, camadaLocais, camadaContorno, desenho;
    let execucao = null;        // análise da cidade aberta (id, limite em minutos...)
    let info = null;            // contorno e limites da cidade (/mapas/v1/executions/{id})
    let categoria = "overall";  // "overall" = índice geral (os 4 tipos)
    let modo = "calor";         // "calor" ou "pontos"
    let mostrarLocais = true;
    let pontos = [];                   // amostra fixa usada no desenho
    let locais = [];
    let geracao = 0;            // muda a cada cidade aberta: respostas antigas são ignoradas
    let pedido = 0;             // descarta desenhos de categorias antigas
    let avisos = { carregando: () => {}, erro: () => {} }; // funções do app.js
    const guardados = new Map(); // promessas das categorias da cidade atual

    function escapar(texto) {
        return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    // ===== Tempo e cores =====
    // A régua vai de 0 min até o DOBRO do limite (15 min -> régua até 30 min).
    // O meio da régua (cor areia) é exatamente o limite de 15 minutos.
    function limiar() {
        return execucao?.threshold_minutes ?? 15;
    }
    function tempo(valor) {
        return valor?.reachable && Number.isFinite(valor.minutes) ? valor.minutes : null;
    }
    // Posição no degradê: 1 = 0 minutos (melhor), 0 = 30 min ou mais / sem caminho (pior).
    function posicaoDoTempo(minutos) {
        if (minutos === null) return 0;
        return 1 - Math.min(minutos, 2 * limiar()) / (2 * limiar());
    }
    function textoDoTempo(minutos) {
        if (minutos === null) return "Sem caminho a pé registrado";
        const alvo = categoria === "overall" ? "chegar aos 4 tipos de serviço" : `chegar a ${NOMES[categoria].toLowerCase()}`;
        return `${numero.format(minutos)} min para ${alvo}`;
    }

    // ===== Contorno da cidade =====
    function desenharContorno() {
        camadaContorno.clearLayers();
        if (!info?.boundary) return;
        L.geoJSON(info.boundary, {
            renderer: L.svg(),
            interactive: false,
            className: "contorno-cidade",
            style: { color: "#2f6fe4", weight: 3, fillColor: "#2f6fe4", fillOpacity: modo === "calor" ? 0 : 0.06 },
        }).addTo(camadaContorno);
    }

    // ===== Amostra municipal em cache; pan/zoom não consultam a API =====
    function areasFixas() {
        if (info.total_nodes && info.total_nodes <= 1000) return [null];
        const [[sul, oeste], [norte, leste]] = info.bounds;
        const arredondar = valor => Number(valor.toFixed(6));
        const x = [oeste, (oeste + leste) / 2, leste].map(arredondar);
        const y = [sul, (sul + norte) / 2, norte].map(arredondar);
        if (x[0] >= x[1] || x[1] >= x[2] || y[0] >= y[1] || y[1] >= y[2]) return [null];
        return [[x[0],y[0],x[1],y[1]], [x[1],y[0],x[2],y[1]], [x[0],y[1],x[1],y[2]], [x[1],y[1],x[2],y[2]]];
    }
    function pedirPontos(analise, codigo, detalhado) {
        const chave = `${analise.id}|${analise.processed_at || ""}|${codigo}|${detalhado ? "detalhe" : "base"}`;
        if (!guardados.has(chave)) {
            const areas = detalhado ? areasFixas() : [null];
            const resposta = (async () => {
                const respostas = [];
                for (const area of areas) respostas.push(await fonte.points(analise, codigo, area));
                return {
                    nodes:[...new Map(respostas.flatMap(item => item.nodes).map(no => [no.id,no])).values()],
                    services:[...new Map(respostas.flatMap(item => item.services).map(local => [local.id,local])).values()],
                };
            })();
            guardados.set(chave, resposta);
            resposta.catch(() => { if (guardados.get(chave) === resposta) guardados.delete(chave); });
        }
        return guardados.get(chave);
    }

    async function carregarPontos() {
        if (!info) return;
        const minha = geracao;
        const meu = ++pedido;
        const analise = execucao;
        const pedida = categoria;
        const detalhado = modo === "pontos";
        // No índice geral precisamos das 4 categorias (o tempo é o do serviço mais distante).
        const codigos = pedida === "overall" ? CATEGORIAS : [pedida];
        avisos.carregando(true, "Carregando o mapa da cidade…");
        try {
            const respostas = [];
            for (const codigo of codigos) {
                respostas.push(await pedirPontos(analise, codigo, detalhado));
                if (minha !== geracao || meu !== pedido) return;
            }
            pontos = juntarPontos(respostas, codigos);
            locais = [...new Map(respostas.flatMap(resposta => resposta.services).map(local => [local.id, local])).values()];
            desenhar();
        } catch (erro) {
            if (minha !== geracao || meu !== pedido) return;
            avisos.erro(erro.message || "Não foi possível carregar o mapa da cidade.");
        } finally {
            if (minha === geracao && meu === pedido) avisos.carregando(false);
        }
    }

    // Junta as respostas num ponto só. A amostra de pontos é a mesma em todas as
    // categorias; no índice geral o tempo é o MAIOR dos 4 (o último serviço a ser
    // alcançado), e "sem caminho" em qualquer categoria vira "sem caminho".
    function juntarPontos(respostas, codigos) {
        const porId = new Map();
        respostas.forEach((resposta, i) => {
            for (const no of resposta.nodes) {
                if (!Number.isFinite(no.lat) || !Number.isFinite(no.lon)) continue;
                const minutos = tempo(no.categories?.[codigos[i]]);
                const ponto = porId.get(no.id) ?? { id: no.id, lat: no.lat, lon: no.lon, min: 0, vistos: 0 };
                ponto.min = ponto.min === null || minutos === null ? null : Math.max(ponto.min, minutos);
                ponto.vistos++;
                porId.set(no.id, ponto);
            }
        });
        return [...porId.values()].filter((ponto) => ponto.vistos === codigos.length);
    }

    // ===== Desenho =====
    function desenhar() {
        camadaPontos.clearLayers();
        if (modo === "calor") {
            // O contorno da cidade corta o calor: nada é pintado fora da divisa.
            camadaCalor.definir(pontos, (ponto) => posicaoDoTempo(ponto.min), info?.boundary);
        } else {
            camadaCalor.definir([], () => 0);
            for (const ponto of pontos) {
                L.circleMarker([ponto.lat, ponto.lon], {
                    renderer: desenho, radius: 4.5, weight: 1, color: "#ffffff",
                    fillColor: window.Cores.css(posicaoDoTempo(ponto.min)), fillOpacity: 0.95,
                }).bindTooltip(escapar(textoDoTempo(ponto.min))).addTo(camadaPontos);
            }
        }
        desenharLocais();
    }

    // Estabelecimentos: um ícone por categoria (cruz, chapéu de formatura, cesta, museu).
    function desenharLocais() {
        camadaLocais.clearLayers();
        if (!mostrarLocais) return;
        // Um ícone por quadradinho da tela (maior com o mapa afastado), para não amontoar.
        const lado = mapa.getZoom() < 14 ? 40 : 28;
        const ocupados = new Set();
        const tela = mapa.getBounds().pad(0.2); // só o que está na tela (com uma folga)
        for (const local of locais) {
            if (!Number.isFinite(local.lat) || !Number.isFinite(local.lon)) continue;
            if (!tela.contains([local.lat, local.lon])) continue;
            const posicao = mapa.latLngToContainerPoint([local.lat, local.lon]);
            const quadradinho = `${Math.floor(posicao.x / lado)}:${Math.floor(posicao.y / lado)}`;
            if (ocupados.has(quadradinho)) continue;
            ocupados.add(quadradinho);
            const nome = !local.name || local.name === local.category ? "Estabelecimento sem nome cadastrado" : local.name;
            const icone = L.divIcon({
                className: "pino-local",
                html: `<span style="--cor:${window.Icones.cor(local.category)}">${window.Icones.svg(local.category)}</span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            });
            L.marker([local.lat, local.lon], { icon: icone, keyboard: false })
                .bindTooltip(`<strong>${escapar(nome)}</strong><br>${escapar(NOMES[local.category] ?? local.category)}`, { direction: "top", offset: [0, -12] })
                .addTo(camadaLocais);
        }
    }

    // Limpa apenas o desenho; os dados das categorias continuam em cache.
    function esquecerRecebidos() {
        pontos = [];
        locais = [];
    }

    function limpar() {
        pedido++;
        esquecerRecebidos();
        camadaContorno.clearLayers();
        camadaPontos.clearLayers();
        camadaLocais.clearLayers();
        camadaCalor.definir([], () => 0);
    }

    // ===== Ponte com o app.js =====
    window.MapaCidade = {
        iniciar(mapaDaTela, funcoesDeAviso) {
            mapa = mapaDaTela;
            avisos = funcoesDeAviso;
            mapa.createPane("calor").style.zIndex = 350; // o calor fica embaixo do contorno
            desenho = L.canvas({ padding: 0.3 });
            camadaCalor = window.CamadaCalor.criar({ pane: "calor" }).addTo(mapa);
            camadaContorno = L.layerGroup().addTo(mapa);
            camadaPontos = L.layerGroup().addTo(mapa);
            camadaLocais = L.layerGroup().addTo(mapa);
            mapa.on("moveend", desenharLocais); // apenas reposiciona ícones; o calor se redesenha localmente
        },

        // Abre a cidade: busca o contorno, enquadra e começa a carregar os pontos.
        async abrir(novaExecucao, margens, novaCategoria = "overall") {
            const minha = ++geracao;
            limpar();
            guardados.clear();
            execucao = novaExecucao;
            categoria = novaCategoria;
            info = null;
            const dados = await fonte.metadata(novaExecucao);
            if (minha !== geracao) return;
            info = dados;
            desenharContorno();
            this.centralizar(margens);
            await carregarPontos();
        },

        fechar() {
            geracao++;
            limpar();
            guardados.clear();
            execucao = null;
            info = null;
        },

        centralizar(margens) {
            if (!info) return;
            mapa.invalidateSize(); // mede a tela de novo antes de enquadrar
            // Se a página abriu escondida (tela com tamanho zero), espera ela aparecer.
            if (!mapa.getSize().x) { mapa.once("resize", () => this.centralizar(margens)); return; }
            mapa.fitBounds(info.bounds, { ...margens, maxZoom: 15 });
        },

        trocarCategoria(novaCategoria) {
            categoria = novaCategoria;
            esquecerRecebidos();
            desenhar();
            return carregarPontos();
        },

        trocarModo(novoModo) {
            if (modo === novoModo) return;
            modo = novoModo;
            desenharContorno();
            return info ? carregarPontos() : undefined;
        },

        trocarLocais(mostrar) {
            mostrarLocais = mostrar;
            desenharLocais();
        },

        // Dados da legenda do canto da tela: régua de 0 a 30+ minutos.
        legenda() {
            const t = limiar();
            return {
                titulo: categoria === "overall" ? "Tempo a pé até os 4 tipos de serviço" : `Tempo a pé até ${NOMES[categoria].toLowerCase()}`,
                tituloCurto: "Minutos a pé",
                degrade: window.Cores.degrade(true, "180deg"), // em cima a cor boa (perto)
                // "curto" é o texto usado no celular, onde a legenda é estreita.
                marcas: [
                    { posicao: 0, texto: "0 min", curto: "0" },
                    { posicao: 0.5, texto: `${numero.format(t)} min`, curto: numero.format(t) },
                    { posicao: 1, texto: `${numero.format(2 * t)}+ min`, curto: `${numero.format(2 * t)}+` },
                ],
                extras: CATEGORIAS.map((codigo) => ({ icone: codigo, texto: NOMES[codigo] })),
                nota: `O meio da régua é o limite de ${numero.format(t)} minutos. Áreas sem cor não têm pontos de rua na amostra.`,
            };
        },
    };
})();
