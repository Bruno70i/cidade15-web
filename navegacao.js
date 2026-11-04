"use strict";

// Guarda a vista de origem da cidade, sem uma entrada por categoria.
(() => {
  const CATEGORIAS = new Set(["overall", "health", "education", "food", "culture"]);
  const categoriaValida = codigo => CATEGORIAS.has(codigo) ? codigo : "overall";
  window.NavegacaoMapa = {
    criar({aoNavegar}) {
      let iniciada = false, voltando = false, proximoCaminho;
      function ler() {
        const parametros = new URLSearchParams(window.location.hash.slice(1));
        const id = parametros.get("cidade");
        const contexto = window.history.state?.cidade15Navigation;
        const cidade = /^[1-9]\d*$/.test(id || "") ? id : null;
        const regioes = parametros.getAll("regiao");
        return {cidade, caminho: cidade ? contexto?.caminho ?? [] : regioes,
          vista: contexto?.cidade === cidade ? contexto.vista ?? null : null,
          categoria:categoriaValida(parametros.get("categoria")), metodologia:window.location.hash === "#metodologia"};
      }
      function gravar(rota, nova = false) {
        const parametros = new URLSearchParams();
        if (rota.cidade) {
          parametros.set("cidade", rota.cidade);
          if (rota.categoria !== "overall") parametros.set("categoria", rota.categoria);
        }
        if (!rota.cidade) for (const id of rota.caminho ?? []) parametros.append("regiao", id);
        const hash = parametros.size ? `#${parametros}` : rota.metodologia ? "#metodologia" : "";
        const anterior = window.history.state;
        const estado = {...(anterior && typeof anterior === "object" ? anterior : {}), cidade15Navigation:{
          version:1, cidade:rota.cidade, vista:rota.vista ?? null, caminho:rota.caminho ?? [],
        }};
        window.history[nova ? "pushState" : "replaceState"](estado, "", `${window.location.pathname}${window.location.search}${hash}`);
      }
      const global = () => ({cidade:null, categoria:"overall", metodologia:false});
      const regional = caminho => ({...global(), caminho});

      function abrirHierarquia(caminho, cidade = null, categoria = "overall") {
        if (voltando) return;
        const atual = ler();
        let comum = 0;
        while (comum < atual.caminho.length && atual.caminho[comum] === caminho[comum]) comum++;
        const mesmaRegiao = comum === caminho.length && comum === atual.caminho.length;
        if (atual.cidade && cidade && mesmaRegiao) {
          const rota = {cidade:String(cidade), categoria:categoriaValida(categoria), caminho};
          gravar(rota);
          aoNavegar(rota);
          return;
        }
        const recuar = atual.caminho.length - comum + Number(Boolean(atual.cidade));
        if (recuar) {
          proximoCaminho = () => abrirHierarquia(caminho, cidade, categoria);
          voltando = true;
          window.history.go(-recuar);
          return;
        }
        for (let i = comum + 1; i <= caminho.length; i++) gravar(regional(caminho.slice(0, i)), true);
        const rota = cidade ? {cidade:String(cidade), categoria:categoriaValida(categoria), caminho} : regional(caminho);
        if (cidade) gravar(rota, true);
        aoNavegar(rota);
      }
      return {
        ler,
        abrirHierarquia,
        iniciar(caminhoCidade) {
          if (!iniciada) {
            iniciada = true;
            const rota = ler();
            if (window.history.state?.cidade15Navigation?.version !== 1) {
              // Um link direto tambem precisa ter o mapa global como destino de Voltar.
              const caminho = rota.cidade ? caminhoCidade?.(rota.cidade) ?? [] : rota.caminho;
              if (rota.cidade || caminho.length) {
                gravar(global());
                for (let i = 1; i <= caminho.length; i++) gravar(regional(caminho.slice(0, i)), true);
                if (rota.cidade) gravar({...rota, caminho}, true);
              } else gravar(rota);
            }
            window.addEventListener("popstate", () => {
              voltando = false;
              const continuar = proximoCaminho;
              proximoCaminho = null;
              if (continuar) continuar();
              else aoNavegar(ler());
            });
          }
          return ler();
        },
        abrirCidade(id, categoria = "overall", vista = null) {
          const anterior = ler();
          const nova = !anterior.cidade;
          const origem = nova ? vista : anterior.vista;
          const rota = {cidade:String(id), categoria:categoriaValida(categoria), metodologia:false, vista:origem};
          if (nova) gravar({...global(), vista:origem});
          gravar(rota, nova);
          aoNavegar(rota);
        },
        atualizarCategoria(categoria) {
          const rota = ler();
          if (rota.cidade) gravar({...rota, categoria:categoriaValida(categoria)});
        },
        voltarGlobal() {
          if (voltando) return;
          const rotaAtual = ler();
          if ((rotaAtual.cidade || rotaAtual.caminho.length) && window.history.state?.cidade15Navigation?.version === 1) {
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
