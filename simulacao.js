"use strict";

// Simulação: o usuário adiciona estabelecimentos hipotéticos no mapa e a API
// (POST /api/v1/executions/{id}/simulate) recalcula o acesso. Nada é gravado.
// O resultado aparece no card de métricas (quem desenha é o app.js).
(() => {
    const NOMES = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
    const LIMITE = 200; // máximo de locais aceito pela API numa simulação
    const el = (id) => document.getElementById(id);
    const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

    let mapa = null;
    let camada = null;          // onde ficam os marcadores "+" dos novos locais
    let execucao = null;        // análise da cidade aberta (o id vai na simulação)
    let locais = [];            // { categoria, lat, lng, marcador }
    let adicionando = false;    // true = clicar no mapa cria um novo local
    let resultado = null;       // última resposta da API (null = sem simulação)
    let aoMudar = () => {};     // avisa o app.js para redesenhar o card

    function mensagem(texto) {
        el("sim-mensagem").textContent = texto;
    }

    // Tipo marcado nos botões com ícone (Saúde, Educação...).
    function tipoEscolhido() {
        return document.querySelector("#sim-tipos [aria-pressed='true']").dataset.tipo;
    }
    function escolherTipo(tipo) {
        for (const botao of document.querySelectorAll("#sim-tipos [data-tipo]")) {
            botao.setAttribute("aria-pressed", String(botao.dataset.tipo === tipo));
        }
    }

    // Liga/desliga os botões conforme a situação.
    function atualizarBotoes() {
        el("sim-adicionar").disabled = !execucao;
        el("sim-adicionar").setAttribute("aria-pressed", String(adicionando));
        el("sim-adicionar").querySelector("span").textContent = adicionando ? "Parar" : "Adicionar";
        el("sim-calcular").disabled = locais.length === 0;
        el("sim-limpar").disabled = locais.length === 0 && !resultado;
        document.body.classList.toggle("adicionando", adicionando); // cursor em cruz no mapa
    }

    // Chamado a cada clique no mapa. Só cria o local se o modo "Adicionar" estiver ligado.
    function adicionar(evento) {
        if (!adicionando || !execucao) return;
        if (locais.length >= LIMITE) { mensagem(`Limite de ${LIMITE} locais por simulação.`); return; }
        const categoria = tipoEscolhido();
        const { lat, lng } = evento.latlng; // latitude e longitude do clique
        const local = { categoria, lat, lng };
        // Marcador do novo local: o ícone da categoria com um "+" vermelho no canto.
        const desenho = `<span style="--cor:${window.Icones.cor(categoria)}">${window.Icones.svg(categoria)}<b>+</b></span>`;
        local.marcador = window.L.marker([lat, lng], {
            icon: window.L.divIcon({ className: "pino-novo", html: desenho, iconSize: [34, 34], iconAnchor: [17, 17] }),
            title: `Novo local: ${NOMES[categoria]}`,
        }).bindTooltip(`Novo local: ${NOMES[categoria]}<br><small>Clique para remover</small>`)
            .on("click", () => remover(local))
            .addTo(camada);
        locais.push(local);
        resultado = null; // o resultado anterior não vale mais
        mensagem(`${locais.length} novo(s) local(is). Clique em "Calcular impacto" quando terminar.`);
        atualizarBotoes();
        aoMudar();
    }

    function remover(local) {
        camada.removeLayer(local.marcador);
        locais = locais.filter((item) => item !== local);
        resultado = null;
        mensagem(locais.length ? `${locais.length} novo(s) local(is).` : "");
        atualizarBotoes();
        aoMudar();
    }

    function limpar() {
        camada?.clearLayers();
        locais = [];
        resultado = null;
        adicionando = false;
        mensagem("");
        atualizarBotoes();
        aoMudar();
    }

    // Envia os locais para a API e guarda o resultado.
    async function calcular() {
        if (!execucao || !locais.length) return;
        const idEnviado = execucao.id;
        adicionando = false;
        el("sim-calcular").disabled = true;
        mensagem("Calculando o impacto…");
        // O formato que a API espera (veja docs/SIMULATIONS.md do projeto do Pedro).
        const servicos = locais.map((local, i) => ({
            category: local.categoria, name: `Novo local ${i + 1}`, latitude: local.lat, longitude: local.lng,
        }));
        try {
            const dados = await window.CityDataSource.simulate(idEnviado, servicos);
            if (idEnviado !== execucao?.id) return; // a cidade mudou enquanto calculava
            resultado = dados;
            mensagem(`Pronto: calculado em ${numero.format(dados.processing_time_ms)} ms. Nada foi gravado.`);
        } catch (erro) {
            mensagem(textoDoErro(erro));
        } finally {
            atualizarBotoes();
            aoMudar();
        }
    }

    // Traduz o erro da API numa mensagem que qualquer pessoa entende.
    function textoDoErro(erro) {
        if (erro.status === 404) return "A simulação ainda não está disponível para esta cidade.";
        if (erro.status === 422) return "Algum local ficou longe das ruas (mais de 250 m). Remova-o e clique mais perto de uma rua.";
        if (erro.status === 429) return "Muitas simulações em pouco tempo. Aguarde alguns segundos e tente de novo.";
        return erro.message || "Não foi possível simular agora. Tente novamente.";
    }

    // ===== Ponte com o app.js =====
    window.Simulacao = {
        iniciar(mapaDaTela, funcaoAoMudar) {
            mapa = mapaDaTela;
            aoMudar = funcaoAoMudar;
            camada = window.L.layerGroup().addTo(mapa);
            mapa.on("click", adicionar);
            el("sim-adicionar").addEventListener("click", () => {
                adicionando = !adicionando;
                mensagem(adicionando ? "Clique no mapa onde o novo local ficaria. Esc para parar." : "");
                atualizarBotoes();
            });
            el("sim-calcular").addEventListener("click", calcular);
            el("sim-limpar").addEventListener("click", limpar);
            for (const botao of document.querySelectorAll("#sim-tipos [data-tipo]")) {
                botao.addEventListener("click", () => escolherTipo(botao.dataset.tipo));
            }
            atualizarBotoes();
        },
        // O app.js usa ao trocar a categoria do card (já deixa o mesmo tipo marcado).
        escolherTipo,
        // A cidade mudou (ou voltou para o mapa de SP): começa do zero.
        reset(novaExecucao) {
            execucao = novaExecucao;
            limpar();
        },
        parar() {
            adicionando = false;
            mensagem("");
            atualizarBotoes();
        },
        resultado: () => resultado,
    };
})();
