"use strict";

// Ícones do site (desenhos SVG simples, feitos de linhas). Ficam todos aqui para
// serem usados em qualquer lugar:
// - no HTML: <i data-icone="health"></i> vira o desenho ao abrir a página;
// - no JavaScript: window.Icones.svg("health") devolve o desenho como texto.
(() => {
    const DESENHOS = {
        // Categorias de serviço
        health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
        education: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c4 3 8 3 12 0v-5"/><path d="M22 9v6"/>',
        food: '<path d="M4 9h16l-2 11H6Z"/><path d="m8 9 4-6 4 6"/><path d="M10 13v4M14 13v4"/>',
        culture: '<path d="M3 9 12 4l9 5Z"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9"/><path d="M3 21h18"/>',
        overall: '<path d="M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z"/>',
        // Outros
        mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14M15 6v14"/>',
        local: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
        pessoas: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.6.4 4.5 2.6 4.5 5.8"/>',
        relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        caminhar: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6 3 3v3"/><path d="m8 12 2-4h4l3 4h2"/><path d="m10 8-1 5 3 2"/>',
        calendario: '<path d="M4 6h16v14H4Z"/><path d="M4 10h16M8 3v4M16 3v4"/>',
        grafico: '<path d="M3 20h18"/><path d="M6 20v-8M11 20V5M16 20v-11M20 20v-5"/>',
        trofeu: '<path d="M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4M12 16v4m-4 0h8"/>',
        livro: '<path d="M4 5c3-1.5 5.5-1.5 8 0v15c-2.5-1.5-5-1.5-8 0Z"/><path d="M12 5c2.5-1.5 5-1.5 8 0v15c-3-1.5-5.5-1.5-8 0"/>',
        calor: '<path d="M12 3c1 3 4.5 4.5 4.5 9a4.5 4.5 0 0 1-9 0c0-2.2 1-3.4 1.8-4.4.4 1.8 1.4 2.6 2.4 2.6 0-2.7-.6-4.8.3-7.2Z"/>',
        pontos: '<circle cx="6" cy="7" r="1.6"/><circle cx="13" cy="5" r="1.6"/><circle cx="18" cy="11" r="1.6"/><circle cx="9" cy="13" r="1.6"/><circle cx="15" cy="18" r="1.6"/><circle cx="6" cy="19" r="1.6"/>',
        mais: '<path d="M12 5v14M5 12h14"/>',
        varinha: '<path d="m4 20 11-11"/><path d="M15 4v3M13.5 5.5h3M19 9v3M17.5 10.5h3"/>',
        voltar: '<path d="M15 18 9 12l6-6"/>',
        seta: '<path d="m6 9 6 6 6-6"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    };
    // Cor de cada categoria (ícones dos estabelecimentos e botões).
    const CORES = { health: "#d1495b", education: "#2f6fe4", food: "#de8a1c", culture: "#8a55d4", overall: "#0f1b33" };

    function svg(nome) {
        return `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[nome] || ""}</svg>`;
    }

    window.Icones = {
        svg,
        cor: (categoria) => CORES[categoria] || "#0f1b33",
        // Troca cada <i data-icone="..."> da página pelo desenho.
        preencher(raiz = document) {
            for (const elemento of raiz.querySelectorAll("[data-icone]")) {
                elemento.innerHTML = svg(elemento.dataset.icone);
                elemento.classList.add("icone-caixa");
                if (CORES[elemento.dataset.icone]) elemento.style.color = CORES[elemento.dataset.icone];
            }
        },
    };
})();
