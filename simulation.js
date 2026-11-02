"use strict";

// Simulação: o usuário adiciona estabelecimentos hipotéticos no mapa e a API
// (POST /api/v1/executions/{id}/simulate) recalcula o acesso. Nada é gravado.
(() => {
    const NOMES = { health: "Saúde", education: "Educação", food: "Alimentação", culture: "Cultura" };
    const CORES = { health: "#a76863", education: "#597f9f", food: "#5d886e", culture: "#89734e" };
    const LIMITE_PONTOS = 200; // máximo de pontos aceito pela API em uma simulação
    const el = (id) => document.getElementById(id);
    const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

    let mapa = null;          // o mapa (entregue pelo map.js no gancho "attach")
    let camada = null;        // grupo onde ficam os marcadores da simulação
    let execucao = null;      // análise da cidade escolhida (o id dela vai na simulação)
    let pontos = [];          // lista de pontos: { category, lat, lng, marker }
    let adicionando = false;  // true = clicar no mapa cria um ponto

    function mensagem(texto) {
        el("sim-message").textContent = texto;
    }

    // Liga/desliga os botões conforme a situação atual.
    function atualizarBotoes() {
        el("sim-add").disabled = !mapa || !execucao;
        el("sim-run").disabled = pontos.length === 0;
        el("sim-clear").disabled = pontos.length === 0;
        el("sim-add").setAttribute("aria-pressed", String(adicionando));
        el("sim-add").textContent = adicionando ? "Parar de adicionar" : "Adicionar pontos";
        el("city-map").classList.toggle("sim-adicionando", adicionando);
    }

    // Redesenha a lista numerada de pontos, cada um com o botão "Remover".
    function desenharLista() {
        const lista = el("sim-points");
        lista.replaceChildren();
        pontos.forEach((ponto, indice) => {
            const item = document.createElement("li");
            const texto = document.createElement("span");
            texto.textContent = `${NOMES[ponto.category]} (${ponto.lat.toFixed(5)}, ${ponto.lng.toFixed(5)})`;
            const remover = document.createElement("button");
            remover.type = "button";
            remover.className = "text-button";
            remover.textContent = "Remover";
            remover.addEventListener("click", () => removerPonto(indice));
            item.append(texto, remover);
            lista.append(item);
        });
    }

    // Chamado a cada clique no mapa. Só cria ponto se o modo estiver ligado.
    function adicionarPonto(evento) {
        if (!adicionando || !execucao) return;
        if (pontos.length >= LIMITE_PONTOS) {
            mensagem(`Limite de ${LIMITE_PONTOS} pontos por simulação.`);
            return;
        }
        const category = el("sim-category").value;
        const { lat, lng } = evento.latlng; // latitude e longitude do clique
        const marker = window.L.circleMarker([lat, lng], {
            radius: 9, color: "#ffffff", weight: 2, fillColor: CORES[category], fillOpacity: 1,
        }).bindTooltip(`Novo local: ${NOMES[category]}`).addTo(camada);
        pontos.push({ category, lat, lng, marker });
        el("sim-results").hidden = true; // o resultado antigo não vale mais
        desenharLista();
        atualizarBotoes();
        mensagem(`${pontos.length} ponto(s) adicionado(s). Clique em "Simular" quando terminar.`);
    }

    function removerPonto(indice) {
        camada.removeLayer(pontos[indice].marker);
        pontos.splice(indice, 1);
        el("sim-results").hidden = true;
        desenharLista();
        atualizarBotoes();
    }

    function limpar() {
        camada?.clearLayers();
        pontos = [];
        el("sim-results").hidden = true;
        el("sim-results-body").replaceChildren();
        desenharLista();
        mensagem("");
        atualizarBotoes();
    }

    // ===== PARTE 2 VAI AQUI =====
    // Envia os pontos para a API e espera o resultado.
    async function simular() {
        if (!execucao || pontos.length === 0) return;
        el("sim-run").disabled = true;
        mensagem("Calculando a simulação…");

        // O formato exato que a API espera (veja docs/SIMULATIONS.md do projeto do Pedro).
        const corpo = {
            services: pontos.map((ponto, indice) => ({
                category: ponto.category,
                name: `Novo local ${indice + 1}`,
                latitude: ponto.lat,
                longitude: ponto.lng,
            })),
        };
        const idEnviado = execucao.id;

        try {
            const resposta = await fetch(`/api/v1/executions/${encodeURIComponent(idEnviado)}/simulate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(corpo),
            });
            const dados = await resposta.json().catch(() => ({}));
            if (idEnviado !== execucao?.id) return; // a cidade mudou enquanto calculava: ignora
            if (!resposta.ok) {
                mensagem(textoDoErro(resposta.status));
                return;
            }
            mostrarResultado(dados);
            mensagem(`Simulação concluída em ${numero.format(dados.processing_time_ms)} ms.`);
        } catch {
            mensagem("Não foi possível falar com o servidor. Verifique a conexão e tente novamente.");
        } finally {
            atualizarBotoes();
        }
    }

    // Traduz o código de erro da API em uma mensagem que qualquer pessoa entende.
    function textoDoErro(status) {
        if (status === 404) return "A simulação ainda não está disponível para esta cidade.";
        if (status === 422) return "Algum ponto ficou longe das ruas (mais de 250 m). Remova-o e clique mais perto de uma rua.";
        if (status === 429) return "Muitas simulações em pouco tempo. Aguarde alguns segundos e tente de novo.";
        return `Não foi possível simular (erro ${status}). Tente novamente.`;
    }
    // ===== PARTE 3 VAI AQUI =====

    // Preenche a tabela: uma linha por categoria simulada.
    function mostrarResultado(dados) {
        const tabela = el("sim-results-body");
        tabela.replaceChildren();
        for (const [codigo, resultado] of Object.entries(dados.results || {})) {
            const pessoas = resultado.population; // contando pessoas (resultado principal)
            const esquinas = resultado.nodes;     // contando esquinas (comparação)
            const variacao = pessoas.coverage_delta_percentage_points;
            const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
            const celulas = [
                NOMES[codigo] || codigo,
                `${numero.format(pessoas.before.coverage_percentage)}%`,
                `${numero.format(pessoas.after.coverage_percentage)}%`,
                `${sinal}${numero.format(Math.abs(variacao))} p.p.`,
                `${numero.format(esquinas.before.coverage_percentage)}% → ${numero.format(esquinas.after.coverage_percentage)}%`,
            ];
            const linha = document.createElement("tr");
            for (const texto of celulas) {
                const celula = document.createElement("td");
                celula.textContent = texto;
                linha.append(celula);
            }
            if (variacao > 0) linha.children[3].classList.add("sim-melhora");
            tabela.append(linha);
        }
        el("sim-results").hidden = false;
    }

    // A "ponte" com o map.js: são as duas funções chamadas pelos ganchos do passo 3.
    window.CitySimulation = {
        attach(novoMapa) {                 // gancho 1: o mapa foi criado
            mapa = novoMapa;
            camada = window.L.layerGroup().addTo(mapa);
            mapa.on("click", adicionarPonto);
            atualizarBotoes();
        },
        reset(novaExecucao) {              // gancho 2: a cidade mudou
            execucao = novaExecucao;
            adicionando = false;
            limpar();
        },
    };

    // Os três botões da seção.
    el("sim-add").addEventListener("click", () => {
        adicionando = !adicionando;
        atualizarBotoes();
        mensagem(adicionando ? "Clique no mapa onde o novo local ficaria." : "");
    });
    el("sim-run").addEventListener("click", simular);
    el("sim-clear").addEventListener("click", limpar);
})();