"use strict";

// Camada de mapa de calor para o Leaflet.
// Como funciona: a tela é dividida numa grade de quadradinhos. Cada quadradinho
// faz a MÉDIA dos pontos de rua próximos (os mais perto pesam mais). Essa média
// vira uma cor do degradê (cores.js). Onde não há pontos por perto, fica
// transparente. No fim a grade é ampliada com suavização, virando um degradê contínuo.
(() => {
    const L = window.L;
    const CELULA = 5;                       // tamanho de cada quadradinho, em pixels
    const OPACIDADE = 160;                  // 0 a 255: deixa as ruas aparecerem por baixo

    const CamadaCalor = L.Layer.extend({
        initialize(opcoes) {
            L.setOptions(this, opcoes);
            this._pontos = [];
            this._posicao = () => 0;
        },

        // pontos: [{lat, lon, ...}]
        // posicaoDe(ponto): de 0 (pior) a 1 (melhor), a posição no degradê
        definir(pontos, posicaoDe) {
            this._pontos = pontos;
            this._posicao = posicaoDe;
            this._desenhar();
        },

        onAdd(mapa) {
            this._mapa = mapa;
            // "leaflet-zoom-hide" esconde a camada durante a animação de zoom.
            this._canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide");
            mapa.getPane(this.options.pane || "overlayPane").appendChild(this._canvas);
            mapa.on("moveend zoomend resize", this._desenhar, this);
            this._desenhar();
        },

        onRemove(mapa) {
            mapa.off("moveend zoomend resize", this._desenhar, this);
            L.DomUtil.remove(this._canvas);
            this._canvas = null;
        },

        _desenhar() {
            if (!this._mapa || !this._canvas) return;
            const mapa = this._mapa;
            const { x: largura, y: altura } = mapa.getSize();
            const escala = window.devicePixelRatio || 1; // telas de alta resolução
            const canvas = this._canvas;
            L.DomUtil.setPosition(canvas, mapa.containerPointToLayerPoint([0, 0]));
            canvas.width = largura * escala;
            canvas.height = altura * escala;
            canvas.style.width = `${largura}px`;
            canvas.style.height = `${altura}px`;
            const contexto = canvas.getContext("2d");
            contexto.clearRect(0, 0, canvas.width, canvas.height);
            if (!this._pontos.length) return;

            // 1) Posição de cada ponto na tela e o raio de influência.
            // O raio acompanha a distância média entre os pontos visíveis: assim as
            // manchas vizinhas se encontram e viram uma superfície, em qualquer zoom.
            const projetados = this._pontos.map((ponto) => ({
                posicao: mapa.latLngToContainerPoint([ponto.lat, ponto.lon]),
                valor: this._posicao(ponto),
            }));
            // Para cada ponto visível, a distância até o vizinho mais próximo; usamos a
            // do meio da lista (mediana), que representa bem os bairros com dados.
            const visiveis = projetados
                .map((item) => item.posicao)
                .filter((p) => p.x >= 0 && p.y >= 0 && p.x <= largura && p.y <= altura);
            const vizinhoMaisPerto = visiveis.map((p, i) => {
                let menor = Infinity;
                visiveis.forEach((outro, j) => {
                    if (i !== j) menor = Math.min(menor, (p.x - outro.x) ** 2 + (p.y - outro.y) ** 2);
                });
                return Math.sqrt(menor);
            }).sort((a, b) => a - b);
            const distanciaTipica = vizinhoMaisPerto[Math.floor(vizinhoMaisPerto.length / 2)] || 20;
            const raio = Math.max(12, Math.min(80, distanciaTipica * 3.5));
            const alcance = Math.ceil(raio / CELULA);   // raio contado em quadradinhos
            const espalhamento = 2 * (raio / 2) ** 2;  // controla o quanto o peso cai com a distância

            // 2) Cada ponto soma seu valor (com peso) nos quadradinhos ao redor.
            const colunas = Math.ceil(largura / CELULA);
            const linhas = Math.ceil(altura / CELULA);
            const somaValores = new Float32Array(colunas * linhas);
            const somaPesos = new Float32Array(colunas * linhas);
            for (const { posicao, valor } of projetados) {
                const coluna = Math.floor(posicao.x / CELULA);
                const linha = Math.floor(posicao.y / CELULA);
                if (coluna < -alcance || linha < -alcance || coluna > colunas + alcance || linha > linhas + alcance) continue;
                for (let l = Math.max(0, linha - alcance); l <= Math.min(linhas - 1, linha + alcance); l++) {
                    for (let c = Math.max(0, coluna - alcance); c <= Math.min(colunas - 1, coluna + alcance); c++) {
                        const dx = (c + 0.5) * CELULA - posicao.x;
                        const dy = (l + 0.5) * CELULA - posicao.y;
                        const distancia2 = dx * dx + dy * dy;
                        if (distancia2 > raio * raio) continue;
                        const peso = Math.exp(-distancia2 / espalhamento); // perto pesa mais
                        somaValores[l * colunas + c] += peso * valor;
                        somaPesos[l * colunas + c] += peso;
                    }
                }
            }

            // 3) Média de cada quadradinho -> cor. Poucos pontos por perto = mais transparente.
            const grade = document.createElement("canvas");
            grade.width = colunas;
            grade.height = linhas;
            const imagem = grade.getContext("2d").createImageData(colunas, linhas);
            for (let i = 0; i < somaPesos.length; i++) {
                if (somaPesos[i] < 0.03) continue; // sem dados aqui: fica transparente
                const [vermelho, verde, azul] = window.Cores.rgb(somaValores[i] / somaPesos[i]);
                imagem.data.set([vermelho, verde, azul, OPACIDADE * Math.min(1, somaPesos[i] / 0.25)], i * 4);
            }
            grade.getContext("2d").putImageData(imagem, 0, 0);

            // 4) Amplia a grade para o tamanho da tela, com suavização (vira degradê).
            contexto.setTransform(escala, 0, 0, escala, 0, 0);
            contexto.imageSmoothingEnabled = true;
            contexto.imageSmoothingQuality = "high";
            contexto.drawImage(grade, 0, 0, colunas * CELULA, linhas * CELULA);
        },
    });

    window.CamadaCalor = { criar: (opcoes) => new CamadaCalor(opcoes) };
})();
