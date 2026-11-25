"use strict";

// Camada de mapa de calor para o Leaflet.
// Como funciona: a tela é dividida numa grade de quadradinhos. Cada quadradinho
// faz a MÉDIA dos pontos de rua próximos (os mais perto pesam mais). Essa média
// vira uma cor do degradê (cores.js). Onde não há pontos por perto, fica
// transparente. No fim a grade é ampliada com suavização, virando um degradê
// contínuo, e é recortada no contorno da cidade.
//
// Troca de cenário (antes x depois de novos locais): as cores mudam aos poucos.
// Como a média de cada quadradinho é uma soma com pesos, as somas do "antes" e do
// "depois" são feitas uma vez só; cada quadro da transição apenas mistura as duas.
(() => {
    const L = window.L;
    const CELULA = 5;      // tamanho de cada quadradinho, em pixels
    const OPACIDADE = 160; // 0 a 255: deixa as ruas aparecerem por baixo
    const SOBRA = 0.3;     // desenha 30% além de cada lado da tela (arrastar sem bordas vazias)
    const DURACAO = 900;   // milissegundos da transição entre "antes" e "depois"

    // 256 tons do degradê, calculados uma vez (cor de cada quadradinho sem refazer a conta).
    let tabela = null;
    function tons() {
        if (!tabela) {
            tabela = new Uint8Array(256 * 3);
            for (let i = 0; i < 256; i++) tabela.set(window.Cores.rgb(i / 255), i * 3);
        }
        return tabela;
    }
    const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2); // começa e termina devagar
    const reduzirMovimento = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const agora = () => (window.performance ?? Date).now();

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
            this._valores = new Float32Array(0); // posição no degradê de cada ponto (o destino)
            this._de = null;                     // valores de partida durante uma transição
            this._t = 1;                         // andamento da transição (1 = terminada)
            this._recorte = null;
            this._grade = null;                  // somas da tela atual, prontas para pintar
        },

        // pontos: [{lat, lon, ...}]
        // posicaoDe(ponto): de 0 (pior) a 1 (melhor), a posição no degradê
        // recorte: contorno da cidade (GeoJSON); o calor não passa dessa linha
        // animar: se os pontos são os mesmos do desenho anterior, as cores mudam aos poucos
        definir(pontos, posicaoDe, recorte = null, { animar = false } = {}) {
            const partida = animar && pontos === this._pontos && this._valores.length === pontos.length
                ? this._valoresVisiveis() : null;
            this._pararAnimacao();
            this._pontos = pontos;
            this._recorte = recorte;
            this._valores = Float32Array.from(pontos, (ponto) => {
                const valor = posicaoDe(ponto);
                return Number.isFinite(valor) ? valor : 0; // valor inválido = pior cor, nunca uma mancha preta
            });
            const mudou = partida && partida.some((valor, i) => Math.abs(valor - this._valores[i]) > 1e-4);
            this._de = mudou && !reduzirMovimento() ? partida : null;
            this._t = this._de ? 0 : 1;
            this._agendar();
        },

        // Desenha no próximo quadro (vários pedidos no mesmo quadro viram um desenho só).
        // Durante um zoom nada é desenhado: o fim do movimento (moveend) pede o desenho.
        _agendar() {
            if (this._escondido || this._pedido || !this._mapa) return;
            this._pedido = requestAnimationFrame(() => { this._pedido = null; this._desenhar(); });
        },
        _aoMover() {
            this._escondido = false;
            this._agendar();
        },

        // O que está na tela agora (no meio de uma transição, a mistura das duas).
        _valoresVisiveis() {
            if (!this._de || this._t >= 1) return this._valores.slice();
            const mistura = suave(this._t);
            return this._valores.map((valor, i) => this._de[i] + (valor - this._de[i]) * mistura);
        },

        onAdd(mapa) {
            this._mapa = mapa;
            this._canvas = L.DomUtil.create("canvas");
            mapa.getPane(this.options.pane || "overlayPane").appendChild(this._canvas);
            // Durante o zoom (inclusive a pinça no celular) o desenho antigo ficaria
            // na escala errada: escondemos e redesenhamos quando o movimento termina.
            mapa.on("zoomstart", this._esconder, this);
            mapa.on("moveend resize", this._aoMover, this);
            this._agendar();
        },

        onRemove(mapa) {
            mapa.off("zoomstart", this._esconder, this);
            mapa.off("moveend resize", this._aoMover, this);
            this._pararAnimacao();
            if (this._pedido) cancelAnimationFrame(this._pedido);
            this._pedido = null;
            this._mapa = null;
            L.DomUtil.remove(this._canvas);
            this._canvas = null;
        },

        // Escondido no zoom: a transição pausa e continua de onde parou no redesenho.
        _esconder() {
            this._escondido = true;
            if (this._pedido) cancelAnimationFrame(this._pedido);
            this._pedido = null;
            this._pararAnimacao();
            if (this._canvas) this._canvas.style.visibility = "hidden";
        },

        _pararAnimacao() {
            if (this._quadro) cancelAnimationFrame(this._quadro);
            clearTimeout(this._garantia);
            this._quadro = null;
            this._garantia = null;
        },

        _desenhar() {
            if (!this._mapa || !this._canvas) return;
            this._pararAnimacao();
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
            canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
            this._grade = null;
            if (!this._pontos.length) return;

            // Posição de um lugar (lat, lon) dentro da camada, já contando a sobra.
            const naCamada = (lat, lon) => {
                const p = mapa.latLngToContainerPoint([lat, lon]);
                return { x: p.x + sobraX, y: p.y + sobraY };
            };

            // 1) Posição de cada ponto e o raio de influência. O raio acompanha a
            // distância típica entre os pontos que estão na tela: assim as manchas
            // vizinhas se encontram e viram uma superfície, em qualquer zoom.
            const projetados = this._pontos.map((ponto, i) => ({ ...naCamada(ponto.lat, ponto.lon), i }));
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
            // Numa transição, soma também o valor de partida, com os mesmos pesos.
            const colunas = Math.ceil(largura / CELULA);
            const linhas = Math.ceil(altura / CELULA);
            const somaValores = new Float32Array(colunas * linhas);
            const somaPartida = this._de ? new Float32Array(colunas * linhas) : null;
            const somaPesos = new Float32Array(colunas * linhas);
            for (const ponto of projetados) {
                const coluna = Math.floor(ponto.x / CELULA);
                const linha = Math.floor(ponto.y / CELULA);
                // Ponto longe da camada não influencia nada: pula (deixa o desenho rápido).
                if (coluna < -alcance || linha < -alcance || coluna >= colunas + alcance || linha >= linhas + alcance) continue;
                const valor = this._valores[ponto.i];
                const partida = somaPartida ? this._de[ponto.i] : 0;
                for (let dy = -alcance; dy <= alcance; dy++) {
                    const l = linha + dy;
                    if (l < 0 || l >= linhas) continue;
                    for (let dx = -alcance; dx <= alcance; dx++) {
                        const c = coluna + dx;
                        if (c < 0 || c >= colunas) continue;
                        const peso = pesoVizinho[(dy + alcance) * lado + (dx + alcance)];
                        if (!peso) continue;
                        const k = l * colunas + c;
                        somaValores[k] += peso * valor;
                        if (somaPartida) somaPartida[k] += peso * partida;
                        somaPesos[k] += peso;
                    }
                }
            }

            // Contorno da cidade na posição da camada (usado para cortar cada quadro).
            let recorte = null;
            if (this._recorte) {
                recorte = new Path2D();
                for (const anel of aneis(this._recorte)) {
                    anel.forEach(([lon, lat], i) => {
                        const p = naCamada(lat, lon);
                        if (i === 0) recorte.moveTo(p.x, p.y);
                        else recorte.lineTo(p.x, p.y);
                    });
                    recorte.closePath();
                }
            }
            const grade = document.createElement("canvas");
            grade.width = colunas;
            grade.height = linhas;
            this._grade = { grade, imagem: grade.getContext("2d").createImageData(colunas, linhas), somaValores, somaPartida, somaPesos, colunas, linhas, recorte, escala };

            if (this._de) this._animar();
            else this._pintar(1);
        },

        // 3) e 4): média de cada quadradinho -> cor; amplia com suavização e corta no contorno.
        // t = andamento da transição (só importa quando há valores de partida).
        _pintar(t) {
            const g = this._grade;
            if (!g || !this._canvas) return;
            const cores = tons();
            const dados = g.imagem.data;
            const mistura = g.somaPartida && t < 1 ? suave(t) : 1;
            for (let i = 0; i < g.somaPesos.length; i++) {
                const peso = g.somaPesos[i];
                const j = i * 4;
                if (peso < 0.03) { dados[j + 3] = 0; continue; } // sem dados aqui: fica transparente
                const soma = mistura < 1 ? g.somaPartida[i] + (g.somaValores[i] - g.somaPartida[i]) * mistura : g.somaValores[i];
                const k = Math.round(Math.min(1, Math.max(0, soma / peso)) * 255) * 3;
                dados[j] = cores[k];
                dados[j + 1] = cores[k + 1];
                dados[j + 2] = cores[k + 2];
                dados[j + 3] = OPACIDADE * Math.min(1, peso / 0.25); // poucos pontos por perto = mais transparente
            }
            g.grade.getContext("2d").putImageData(g.imagem, 0, 0);
            const contexto = this._canvas.getContext("2d");
            contexto.setTransform(1, 0, 0, 1, 0, 0);
            contexto.clearRect(0, 0, this._canvas.width, this._canvas.height);
            contexto.setTransform(g.escala, 0, 0, g.escala, 0, 0);
            contexto.save();
            if (g.recorte) contexto.clip(g.recorte, "evenodd"); // "evenodd" respeita buracos no contorno
            contexto.imageSmoothingEnabled = true;
            contexto.imageSmoothingQuality = "high";
            contexto.drawImage(g.grade, 0, 0, g.colunas * CELULA, g.linhas * CELULA);
            contexto.restore();
        },

        // Quadro a quadro até o fim (continua de onde parou se foi interrompida pelo zoom).
        _animar() {
            const inicio = agora() - this._t * DURACAO;
            const terminar = () => {
                this._pararAnimacao();
                this._t = 1;
                this._de = null;
                this._pintar(1);
            };
            const passo = () => {
                this._t = Math.min(1, (agora() - inicio) / DURACAO);
                if (this._t >= 1) { terminar(); return; }
                this._pintar(this._t);
                this._quadro = requestAnimationFrame(passo);
            };
            passo();
            // Aba em segundo plano não desenha quadros: garante a cor final mesmo assim.
            if (this._de) this._garantia = setTimeout(terminar, (1 - this._t) * DURACAO + 400);
        },
    });

    window.CamadaCalor = { criar: (opcoes) => new CamadaCalor(opcoes) };
})();
