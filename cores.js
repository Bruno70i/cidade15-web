"use strict";

// Uma escala de cores só, em degradê, usada nos dois mapas:
// vermelho = pior, areia = meio, verde-azulado = melhor.
// Ela recebe uma posição de 0 (pior) a 1 (melhor) e devolve a cor daquele ponto.
(() => {
    // Cores de "parada" do degradê; entre elas, a cor é misturada aos poucos.
    const PARADAS = [
        [0.00, [168, 32, 58]],   // vermelho escuro
        [0.25, [230, 106, 69]],  // coral
        [0.50, [242, 198, 109]], // areia
        [0.75, [109, 187, 156]], // verde-água
        [1.00, [19, 112, 107]],  // verde-azulado escuro
    ];

    // Devolve [vermelho, verde, azul] para uma posição de 0 a 1.
    function rgb(posicao) {
        const p = Math.min(1, Math.max(0, posicao));
        for (let i = 1; i < PARADAS.length; i++) {
            const [fim, corFim] = PARADAS[i];
            if (p <= fim) {
                const [inicio, corInicio] = PARADAS[i - 1];
                const mistura = (p - inicio) / (fim - inicio); // 0 = cor do início, 1 = cor do fim
                return corInicio.map((canal, j) => Math.round(canal + (corFim[j] - canal) * mistura));
            }
        }
        return PARADAS[PARADAS.length - 1][1];
    }

    window.Cores = {
        rgb,
        css: (posicao) => `rgb(${rgb(posicao).join(",")})`,
        // Degradê para a régua da legenda. "doMelhor" = começa pela cor boa.
        // "direcao": "90deg" = da esquerda para a direita; "180deg" = de cima para baixo.
        degrade(doMelhor = false, direcao = "90deg") {
            const paradas = PARADAS.map(([posicao, cor]) => `rgb(${cor.join(",")}) ${(doMelhor ? 1 - posicao : posicao) * 100}%`);
            return `linear-gradient(${direcao}, ${(doMelhor ? paradas.reverse() : paradas).join(", ")})`;
        },
    };
})();
