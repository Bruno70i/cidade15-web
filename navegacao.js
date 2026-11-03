"use strict";

// Historico do navegador: Global -> Cidade, sem uma entrada por categoria.
(() => {
  const CATEGORIAS = new Set(["overall", "health", "education", "food", "culture"]);
  const categoriaValida = codigo => CATEGORIAS.has(codigo) ? codigo : "overall";
  window.NavegacaoMapa = {
    criar({aoNavegar}) {
      let iniciada = false, voltando = false;
      function ler() {
        const parametros = new URLSearchParams(window.location.hash.slice(1));
        const id = parametros.get("cidade");
        return {cidade:/^[1-9]\d*$/.test(id || "") ? id : null,
          categoria:categoriaValida(parametros.get("categoria")), metodologia:window.location.hash === "#metodologia"};
      }
      function gravar(rota, nova = false) {
        const parametros = new URLSearchParams();
        if (rota.cidade) {
          parametros.set("cidade", rota.cidade);
          if (rota.categoria !== "overall") parametros.set("categoria", rota.categoria);
        }
        const hash = rota.cidade ? `#${parametros}` : rota.metodologia ? "#metodologia" : "";
        const anterior = window.history.state;
        const estado = {...(anterior && typeof anterior === "object" ? anterior : {}), cidade15Navigation:{version:1, cidade:rota.cidade}};
        window.history[nova ? "pushState" : "replaceState"](estado, "", `${window.location.pathname}${window.location.search}${hash}`);
      }
      const global = () => ({cidade:null, categoria:"overall", metodologia:false});
      return {
        ler,
        iniciar() {
          if (!iniciada) {
            iniciada = true;
            const rota = ler();
            if (window.history.state?.cidade15Navigation?.version !== 1) {
              // Um link direto tambem precisa ter o mapa global como destino de Voltar.
              if (rota.cidade) { gravar(global()); gravar(rota, true); }
              else gravar(rota);
            }
            window.addEventListener("popstate", () => { voltando = false; aoNavegar(ler()); });
          }
          return ler();
        },
        abrirCidade(id, categoria = "overall") {
          const rota = {cidade:String(id), categoria:categoriaValida(categoria), metodologia:false};
          const nova = !ler().cidade;
          if (nova) gravar(global());
          gravar(rota, nova);
          aoNavegar(rota);
        },
        atualizarCategoria(categoria) {
          const rota = ler();
          if (rota.cidade) gravar({...rota, categoria:categoriaValida(categoria)});
        },
        voltarGlobal() {
          if (voltando) return;
          if (ler().cidade && window.history.state?.cidade15Navigation?.version === 1) {
            voltando = true;
            window.history.back();
          } else {
            const rota = global();
            gravar(rota);
            aoNavegar(rota);
          }
        },
      };
    },
  };
})();
