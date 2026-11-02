"use strict";

// Consultas à API do projeto. Não contém credenciais: o nginx (ou o servidor.py,
// no PC) acrescenta a chave. Regra importante: NUNCA fazer 1 chamada por cidade,
// porque o nginx bloqueia muitas chamadas seguidas (erro 429).
(() => {
  // Faz o pedido e devolve o JSON. Em erros como 429/502 o nginx responde uma
  // página HTML, então só lemos JSON quando a resposta é JSON de verdade.
  // O erro lançado leva o código HTTP em "status" (a simulação usa o 422).
  async function pedir(caminho, opcoes = {}) {
    const resposta = await fetch(caminho, { cache: "no-store", ...opcoes });
    const ehJson = (resposta.headers.get("Content-Type") || "").includes("application/json");
    const dados = ehJson ? await resposta.json().catch(() => null) : null;
    if (!resposta.ok) {
      let texto = "Não foi possível consultar os resultados na API. Tente novamente.";
      if (resposta.status === 429) texto = "Muitas consultas em pouco tempo. Aguarde alguns segundos e tente novamente.";
      if (resposta.status === 404) texto = "Esta cidade ainda não tem uma análise concluída.";
      const erro = new Error(texto);
      erro.status = resposta.status;
      throw erro;
    }
    if (dados === null) throw new Error("A API respondeu num formato inesperado. Tente novamente.");
    return dados;
  }

  window.CityDataSource = {
    // Resumo de TODAS as cidades analisadas numa chamada só (rota /cities/summary).
    // Sem categorias: índice geral (quem chega aos 4 tipos de serviço).
    // Com categorias (ex.: ["health", "culture"]): quem chega a todas as escolhidas.
    async summary(categorias = []) {
      const filtro = categorias.length ? `?categories=${encodeURIComponent(categorias.join(","))}` : "";
      const lista = await pedir(`/api/v1/cities/summary${filtro}`);
      if (!Array.isArray(lista)) throw new Error("A API respondeu num formato inesperado. Tente novamente.");
      return lista;
    },

    // Resultado detalhado de UMA cidade (só é chamado para a cidade aberta).
    async latest(cidadeId) {
      const latest = await pedir(`/api/v1/cities/${encodeURIComponent(cidadeId)}/latest`);
      const report = latest?.population_report;
      if (!latest?.execution || !report || !Number.isFinite(report.total_weight) || !report.categories) {
        throw new Error("Esta cidade ainda não tem resultado populacional.");
      }
      return latest;
    },

    // Simulação: recalcula o acesso com estabelecimentos hipotéticos. Nada é gravado.
    simulate(execucaoId, servicos) {
      return pedir(`/api/v1/executions/${encodeURIComponent(execucaoId)}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: servicos }),
      });
    },
  };
})();
