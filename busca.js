"use strict";

// Busca de cidade no topo da tela, com sugestões enquanto a pessoa digita.
// Só lista cidades já analisadas. Setas escolhem, Enter abre, Esc fecha.
(() => {
    const el = (id) => document.getElementById(id);
    let cidades = [];           // { id, nome, chave }
    let sugestoes = [];         // cidades mostradas embaixo da busca
    let ativa = -1;             // sugestão destacada pelas setas
    let aoEscolher = () => {};  // função do app.js que abre a cidade

    // Sem acentos e em minúsculas: "sao" encontra "São Paulo".
    function normalizar(texto) {
        return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    }
    function escapar(texto) {
        return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    // Primeiro as cidades que COMEÇAM com o texto, depois as que o CONTÊM.
    function buscar(texto) {
        const termo = normalizar(texto);
        if (!termo) return [];
        const comecam = cidades.filter((cidade) => cidade.chave.startsWith(termo));
        const contem = cidades.filter((cidade) => !cidade.chave.startsWith(termo) && cidade.chave.includes(termo));
        return [...comecam, ...contem].slice(0, 8);
    }

    function desenhar() {
        const campo = el("busca");
        const lista = el("sugestoes");
        const aberta = campo.value.trim() !== "" && document.activeElement === campo;
        lista.hidden = !aberta;
        campo.setAttribute("aria-expanded", String(aberta));
        if (!aberta) { campo.removeAttribute("aria-activedescendant"); return; }
        if (!sugestoes.length) {
            lista.innerHTML = '<li class="sem-resultado">Nenhuma cidade analisada com esse nome</li>';
            return;
        }
        lista.innerHTML = sugestoes.map((cidade, i) => {
            // Bolinha com a cor do mapa de SP + a nota, quando a cidade tem nota.
            const nota = window.MapaEstado.notaECor(cidade.nome);
            const selo = nota ? `<span class="nota"><i style="background:${nota.cor}"></i>${nota.texto}</span>` : "";
            return `<li id="sugestao-${i}" role="option" aria-selected="${i === ativa}" data-indice="${i}"><span>${escapar(cidade.nome)}</span>${selo}</li>`;
        }).join("");
        if (ativa >= 0) campo.setAttribute("aria-activedescendant", `sugestao-${ativa}`);
    }

    function escolher(indice) {
        const cidade = sugestoes[indice];
        if (!cidade) return;
        el("busca").value = cidade.nome;
        sugestoes = [];
        el("busca").blur();
        aoEscolher(cidade.id);
    }

    window.Busca = {
        iniciar(funcaoAoEscolher) {
            aoEscolher = funcaoAoEscolher;
            const campo = el("busca");
            campo.addEventListener("input", () => {
                sugestoes = buscar(campo.value);
                ativa = sugestoes.length ? 0 : -1;
                desenhar();
            });
            campo.addEventListener("focus", () => { campo.select(); sugestoes = buscar(campo.value); desenhar(); });
            campo.addEventListener("blur", () => setTimeout(desenhar, 0));
            campo.addEventListener("keydown", (evento) => {
                if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
                    if (!sugestoes.length) return;
                    evento.preventDefault();
                    const passo = evento.key === "ArrowDown" ? 1 : -1;
                    ativa = (ativa + passo + sugestoes.length) % sugestoes.length;
                    desenhar();
                } else if (evento.key === "Enter") {
                    evento.preventDefault();
                    escolher(Math.max(0, ativa));
                } else if (evento.key === "Escape") {
                    campo.blur();
                }
            });
            // "mousedown" (e não "click") para escolher antes de o campo perder o foco.
            el("sugestoes").addEventListener("mousedown", (evento) => {
                const item = evento.target.closest("[data-indice]");
                if (!item) return;
                evento.preventDefault();
                escolher(Number(item.dataset.indice));
            });
        },
        // Lista de cidades analisadas (vem do resumo da API).
        atualizar(resumo) {
            cidades = resumo
                .map((item) => ({ id: String(item.city_id), nome: item.name, chave: normalizar(item.name) }))
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        },
        // Mostra o nome da cidade aberta (ou limpa, ao voltar para SP).
        mostrarNome(nome) {
            el("busca").value = nome ?? "";
        },
    };
})();
