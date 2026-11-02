"use strict";

// Camada de mapa de calor para o Leaflet.
// Como funciona: a tela é dividida numa grade de quadradinhos. Cada quadradinho
// faz a MÉDIA dos pontos de rua próximos (os mais perto pesam mais). Essa média
// vira uma cor do degradê (cores.js). Onde não há pontos por perto, fica
// transparente. No fim a grade é ampliada com suavização, virando um degradê
// contínuo, e é recortada no contorno da cidade.
(() => {
    const L = window.L;
    const CELULA = 5;      // tamanho de cada quadradinho, em pixels
    const OPACIDADE = 160; // 0 a 255: deixa as ruas aparecerem por baixo
    const SOBRA = 0.3;     // desenha 30% além de cada lado da tela (arrastar sem bordas vazias)

    // Linhas (anéis) de um contorno GeoJSON, seja um polígono ou vários.
    function aneis(geometria) {
        if (!geometria) return [];
        if (geometria.type === "Feature") return aneis(geometria.geometry);
        if (geometria.type === "FeatureCollection") return geometria.features.flatMap(aneis);
        if (geometria.type === "Polygon") return geometria.coordinates;
        if (geometria.type === "MultiPolygon") return geometria.coordinates.flat();
        return [];
    }

    // Distância típica entre um ponto e o vizinho mais próximo (mediana).
    // Para ser rápida, mede só uma amostra de até 300 pontos.
    function distanciaTipica(posicoes) {
        if (posicoes.length < 2) return 20;
        const passo = Math.ceil(posicoes.length / 300);
        const distancias = [];
        for (let i = 0; i < posicoes.length; i += passo) {
            let menor = Infinity;
            for (let j = 0; j < posicoes.length; j++) {
                if (i === j) continue;
                const dx = posicoes[i].x - posicoes[j].x;
                const dy = posicoes[i].y - posicoes[j].y;
                menor = Math.min(menor, dx * dx + dy * dy);
            }
            distancias.push(Math.sqrt(menor));
        }
        distancias.sort((a, b) => a - b);
        return distancias[Math.floor(distancias.length / 2)] || 20;
    }

    const CamadaCalor = L.Layer.extend({
        initialize(opcoes) {
            L.setOptions(this, opcoes);
            this._pontos = [];
            this._posicao = () => 0;
            this._recorte = null;
        },

        // pontos: [{lat, lon, ...}]
        // posicaoDe(ponto): de 0 (pior) a 1 (melhor), a posição no degradê
        // recorte: contorno da cidade (GeoJSON); o calor não passa dessa linha
        definir(pontos, posicaoDe, recorte = null) {
            this._pontos = pontos;
            this._posicao = posicaoDe;
            this._recorte = recorte;
            this._desenhar();
        },

        onAdd(mapa) {
            this._mapa = mapa;
            this._canvas = L.DomUtil.create("canvas");
            mapa.getPane(this.options.pane || "overlayPane").appendChild(this._canvas);
            // Durante o zoom (inclusive a pinça no celular) o desenho antigo ficaria
            // na escala errada: escondemos e redesenhamos quando o movimento termina.
            mapa.on("zoomstart", this._esconder, this);
            mapa.on("moveend resize", this._desenhar, this);
            this._desenhar();
        },

        onRemove(mapa) {
            mapa.off("zoomstart", this._esconder, this);
            mapa.off("moveend resize", this._desenhar, this);
            L.DomUtil.remove(this._canvas);
            this._canvas = null;
        },

        _esconder() {
            if (this._canvas) this._canvas.style.visibility = "hidden";
        },

        _desenhar() {
            if (!this._mapa || !this._canvas) return;
            const mapa = this._mapa;
            const tela = mapa.getSize();
            // A camada é maior que a tela: sobra de 30% em cada lado.
            const sobraX = Math.round(tela.x * SOBRA);
            const sobraY = Math.round(tela.y * SOBRA);
            const largura = tela.x + 2 * sobraX;
            const altura = tela.y + 2 * sobraY;
            const escala = Math.min(2, window.devicePixelRatio || 1); // telas de alta resolução
            const canvas = this._canvas;
            L.DomUtil.setPosition(canvas, mapa.containerPointToLayerPoint([-sobraX, -sobraY]));
            canvas.width = largura * escala;
            canvas.height = altura * escala;
            canvas.style.width = `${largura}px`;
            canvas.style.height = `${altura}px`;
            canvas.style.visibility = "";
            const contexto = canvas.getContext("2d");
            contexto.clearRect(0, 0, canvas.width, canvas.height);
            if (!this._pontos.length) return;

            // Posição de um lugar (lat, lon) dentro da camada, já contando a sobra.
            const naCamada = (lat, lon) => {
                const p = mapa.latLngToContainerPoint([lat, lon]);
                return { x: p.x + sobraX, y: p.y + sobraY };
            };

            // 1) Posição de cada ponto e o raio de influência. O raio acompanha a
            // distância típica entre os pontos que estão na tela: assim as manchas
            // vizinhas se encontram e viram uma superfície, em qualquer zoom.
            const projetados = this._pontos.map((ponto) => ({ ...naCamada(ponto.lat, ponto.lon), valor: this._posicao(ponto) }));
            const naTela = projetados.filter((p) => p.x >= sobraX && p.x <= sobraX + tela.x && p.y >= sobraY && p.y <= sobraY + tela.y);
            const raio = Math.max(14, Math.min(120, distanciaTipica(naTela) * 5));
            const alcance = Math.ceil(raio / CELULA); // raio contado em quadradinhos

            // Peso de cada quadradinho vizinho (perto pesa mais), calculado uma vez só.
            const lado = 2 * alcance + 1;
            const pesoVizinho = new Float32Array(lado * lado);
            for (let dy = -alcance; dy <= alcance; dy++) {
                for (let dx = -alcance; dx <= alcance; dx++) {
                    const distancia2 = (dx * CELULA) ** 2 + (dy * CELULA) ** 2;
                    pesoVizinho[(dy + alcance) * lado + (dx + alcance)] =
                        distancia2 > raio * raio ? 0 : Math.exp(-distancia2 / (2 * (raio / 2) ** 2));
                }
            }

            // 2) Cada ponto soma seu valor (com peso) nos quadradinhos ao redor.
            const colunas = Math.ceil(largura / CELULA);
            const linhas = Math.ceil(altura / CELULA);
            const somaValores = new Float32Array(colunas * linhas);
            const somaPesos = new Float32Array(colunas * linhas);
            for (const ponto of projetados) {
                const coluna = Math.floor(ponto.x / CELULA);
                const linha = Math.floor(ponto.y / CELULA);
                // Ponto longe da camada não influencia nada: pula (deixa o desenho rápido).
                if (coluna < -alcance || linha < -alcance || coluna >= colunas + alcance || linha >= linhas + alcance) continue;
                for (let dy = -alcance; dy <= alcance; dy++) {
                    const l = linha + dy;
                    if (l < 0 || l >= linhas) continue;
                    for (let dx = -alcance; dx <= alcance; dx++) {
                        const c = coluna + dx;
                        if (c < 0 || c >= colunas) continue;
                        const peso = pesoVizinho[(dy + alcance) * lado + (dx + alcance)];
                        if (!peso) continue;
                        somaValores[l * colunas + c] += peso * ponto.valor;
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

            // 4) Amplia a grade com suavização (vira degradê), pintando só DENTRO
            // do contorno da cidade (o resto é cortado).
            contexto.setTransform(escala, 0, 0, escala, 0, 0);
            if (this._recorte) {
                contexto.beginPath();
                for (const anel of aneis(this._recorte)) {
                    anel.forEach(([lon, lat], i) => {
                        const p = naCamada(lat, lon);
                        if (i === 0) contexto.moveTo(p.x, p.y);
                        else contexto.lineTo(p.x, p.y);
                    });
                    contexto.closePath();
                }
                contexto.clip("evenodd"); // "evenodd" respeita buracos dentro do contorno
            }
            contexto.imageSmoothingEnabled = true;
            contexto.imageSmoothingQuality = "high";
            contexto.drawImage(grade, 0, 0, colunas * CELULA, linhas * CELULA);
        },
    });

    window.CamadaCalor = { criar: (opcoes) => new CamadaCalor(opcoes) };
})();
