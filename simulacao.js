"use strict";

// Simulação: o usuário adiciona estabelecimentos hipotéticos no mapa e a API
// (POST /api/v1/executions/{id}/simulate) recalcula o acesso. Nada é gravado.
// O resultado aparece no card de métricas (quem desenha é o app.js).
(() => {
    const NOMES = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
    const LIMITE = 200; // máximo de locais aceito pela API numa simulação
    const el = (id) => document.getElementById(id);
    const validador = window.SimulacaoLocais.criar();

    let mapa = null;
    let camada = null;          // onde ficam os marcadores "+" dos novos locais
    let execucao = null;        // análise da cidade aberta (o id vai na simulação)
    let locais = [];            // { categoria, lat, lng, marcador }
    let adicionando = false;    // true = clicar no mapa cria um novo local
    let resultado = null;       // última resposta da API (null = sem simulação)
    let aoMudar = () => {};     // avisa o app.js para redesenhar o card
    let rascunho = null;
    let revisao = 0, calculando = false;
    let sessaoAdicao = 0, verificando = 0, recusados = 0;
    let filaAdicao = Promise.resolve();

    function mensagem(texto) {
        el("sim-mensagem").textContent = texto;
        el("sim-mensagem").hidden = !texto;
        el("sim-mapa-feedback").textContent = texto;
        el("sim-mapa-feedback").hidden = !texto;
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
    const resumoLocais = () => `${locais.length} ${locais.length === 1 ? "local adicionado" : "locais adicionados"}.${recusados ? ` ${recusados} ${recusados === 1 ? "posição não foi adicionada" : "posições não foram adicionadas"}.` : ""}`;

    // Liga/desliga os botões conforme a situação.
    function atualizarBotoes() {
        el("sim-adicionar").disabled = !execucao || calculando || verificando > 0;
        el("sim-adicionar").setAttribute("aria-pressed", String(adicionando));
        el("sim-adicionar").querySelector("span").textContent = adicionando ? "Parar" : "Adicionar local";
        el("sim-calcular").disabled = locais.length === 0 || calculando || verificando > 0;
        el("sim-limpar").disabled = locais.length === 0 && !resultado && !verificando;
        el("sim-mapa-concluir").disabled = verificando > 0;
        document.body.classList.toggle("adicionando", adicionando); // cursor em cruz no mapa
        el("sim-mapa-status").textContent = `Toque no mapa para adicionar: ${NOMES[tipoEscolhido()]}. ${locais.length} ${locais.length === 1 ? "local adicionado" : "locais adicionados"}.${verificando ? ` Verificando ${verificando} ${verificando === 1 ? "posição" : "posições"}…` : ""}${recusados ? ` ${recusados} ${recusados === 1 ? "posição não adicionada" : "posições não adicionadas"}.` : ""}`;
    }

    // Chamado a cada clique no mapa. Só cria o local se o modo "Adicionar" estiver ligado.
    function adicionar(evento) {
        if (!adicionando || !execucao) return;
        if (locais.length + verificando >= LIMITE) { mensagem(`É possível adicionar até ${LIMITE} locais por simulação. Aguarde a verificação das posições.`); return; }
        const categoria = tipoEscolhido();
        const analise = execucao, sessao = sessaoAdicao;
        verificando++;
        mensagem("Verificando a posição na rede de caminhada…");
        atualizarBotoes();
        const tarefa = filaAdicao.then(async () => {
            if (sessao !== sessaoAdicao || execucao?.id !== analise.id) return;
            try {
                const posicao = await validador.ajustar(analise, categoria, evento.latlng);
                if (sessao !== sessaoAdicao || execucao?.id !== analise.id) return;
                if (locais.some(local => local.categoria === categoria && local.nodeId === posicao.nodeId)) {
                    recusados++;
                    mensagem(`Já existe um local de ${NOMES[categoria]} nesse ponto da rede. Escolha outra posição.`);
                    return;
                }
                registrar(categoria, posicao);
            } catch (erro) {
                if (sessao === sessaoAdicao && execucao?.id === analise.id) {
                    recusados++;
                    mensagem(erro.message || "Local não adicionado: não foi possível confirmar a posição. Tente novamente.");
                }
            } finally {
                if (sessao === sessaoAdicao && execucao?.id === analise.id) {
                    verificando--;
                    atualizarBotoes();
                    aoMudar();
                }
            }
        });
        filaAdicao = tarefa;
        return tarefa;
    }

    function registrar(categoria, posicao) {
        const {lat, lng, nodeId, distancia} = posicao;
        const local = { categoria, lat, lng, nodeId };
        // Marcador do novo local: o ícone da categoria com um "+" vermelho no canto.
        const desenho = `<span style="--cor:${window.Icones.cor(categoria)}">${window.Icones.svg(categoria)}<b>+</b></span>`;
        local.marcador = window.L.marker([lat, lng], {
            icon: window.L.divIcon({ className: "pino-novo", html: desenho, iconSize: [34, 34], iconAnchor: [17, 17] }),
            title: `Novo local: ${NOMES[categoria]}`,
        }).bindTooltip(`Novo local: ${NOMES[categoria]}<br><small>Clique para remover</small>`)
            .on("click", () => remover(local))
            .addTo(camada);
        locais.push(local);
        revisao++;
        resultado = null; // o resultado anterior não vale mais
        mensagem(`${distancia >= 1 ? `Local ajustado à rede de caminhada, a ${Math.round(distancia)} m do toque. ` : "Local confirmado na rede de caminhada. "}${resumoLocais()} Clique em "Calcular impacto" quando terminar.`);
    }

    function remover(local) {
        revisao++;
        calculando = false;
        camada.removeLayer(local.marcador);
        locais = locais.filter((item) => item !== local);
        resultado = null;
        mensagem(locais.length ? resumoLocais() : "");
        atualizarBotoes();
        aoMudar();
    }

    function limpar() {
        sessaoAdicao++;
        verificando = 0;
        recusados = 0;
        filaAdicao = Promise.resolve();
        revisao++;
        calculando = false;
        rascunho = null;
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
        if (!execucao || !locais.length || calculando || verificando > 0) return;
        const idEnviado = execucao.id;
        const minha = ++revisao;
        let concluida = false;
        adicionando = false;
        rascunho = null;
        calculando = true;
        atualizarBotoes();
        aoMudar();
        mensagem("Calculando o impacto…");
        // O formato que a API espera (veja docs/SIMULATIONS.md do projeto do Pedro).
        const servicos = locais.map((local, i) => ({
            category: local.categoria, name: `Novo local ${i + 1}`, latitude: local.lat, longitude: local.lng,
        }));
        try {
            const dados = await window.CityDataSource.simulate(idEnviado, servicos);
            if (idEnviado !== execucao?.id || minha !== revisao) return;
            resultado = dados;
            concluida = true;
            mensagem("");
        } catch (erro) {
            if (idEnviado === execucao?.id && minha === revisao) mensagem(textoDoErro(erro));
        } finally {
            if (minha === revisao && idEnviado === execucao?.id) {
                calculando = false;
                atualizarBotoes();
                aoMudar({concluida});
            }
        }
    }

    function parar() {
        sessaoAdicao++;
        verificando = 0;
        filaAdicao = Promise.resolve();
        adicionando = false;
        rascunho = null;
        mensagem(locais.length ? `${resumoLocais()} Clique em "Calcular impacto" quando terminar.` : "");
        atualizarBotoes();
        aoMudar();
    }
    function cancelar() {
        if (rascunho) {
            revisao++;
            camada.clearLayers();
            locais = rascunho.locais;
            resultado = rascunho.resultado;
            for (const local of locais) local.marcador.addTo(camada);
        }
        parar();
    }

    // Traduz o erro da API numa mensagem que qualquer pessoa entende.
    function textoDoErro(erro) {
        if (erro.status === 404) return "A simulação ainda não está disponível para esta cidade.";
        if (erro.status === 422) {
            if (typeof erro.detalhe === "string" && erro.detalhe.includes("Category not analyzed")) return "Essa categoria não está disponível na análise desta cidade. Seus locais foram preservados.";
            if (typeof erro.detalhe === "string" && erro.detalhe.includes("too far from walking network")) return "O servidor não conseguiu associar um dos locais à rede de caminhada desta análise (até 250 m). Seus locais foram preservados; remova e reposicione o local antes de tentar novamente.";
            return "A API não aceitou alguma posição ou categoria. Seus locais foram preservados; revise-os antes de tentar novamente (a rede aceita posições a até 250 m de um nó).";
        }
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
                if (adicionando) { parar(); return; }
                rascunho = {locais:[...locais], resultado};
                sessaoAdicao++;
                recusados = 0;
                adicionando = true;
                mensagem(adicionando ? "Clique no mapa onde o novo local ficaria. Esc para parar." : "");
                atualizarBotoes();
                aoMudar();
            });
            el("sim-mapa-cancelar").addEventListener("click", cancelar);
            el("sim-mapa-concluir").addEventListener("click", parar);
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
        parar,
        emAdicao: () => adicionando,
        centralizar(margens) {
            if (locais.length) mapa.fitBounds(window.L.latLngBounds(locais.map(local=>[local.lat, local.lng])), {...margens,maxZoom:16});
        },
        resultado: () => resultado,
    };
})();
