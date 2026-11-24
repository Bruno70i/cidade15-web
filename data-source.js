"use strict";

// Consultas à API do projeto. Não contém credenciais: o nginx (ou o servidor.py,
// no PC) acrescenta a chave. Regra importante: NUNCA fazer 1 chamada por cidade,
// porque o nginx bloqueia muitas chamadas seguidas (erro 429).
(() => {
  const mapasCache = window.CityCache?.create();
  // Contornos: ~14 MB de texto. Ficam num banco próprio por até 7 dias; a chave muda
  // sozinha quando entram cidades novas (o desenho de uma cidade não muda).
  const contornosCache = window.CityCache?.create({ banco: "cidade15-contornos", maxEntries: 2, maxBytes: 80 * 1024 * 1024 });
  const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
  const contornosPendentes = new Map();
  // Assinatura curta da lista de cidades (para a chave do cache não ter milhares de IDs).
  function assinatura(texto) {
    let hash = 2166136261;
    for (let i = 0; i < texto.length; i++) { hash ^= texto.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  // Como pedir(), mas devolve o texto e deixa o navegador usar o próprio cache HTTP.
  async function pedirTexto(caminho) {
    const resposta = await fetch(caminho);
    if (!resposta.ok) {
      const ehJson = (resposta.headers.get("Content-Type") || "").includes("application/json");
      const dados = ehJson ? await resposta.json().catch(() => null) : null;
      const erro = new Error(resposta.status === 429
        ? "Muitas consultas em pouco tempo. Aguarde alguns segundos e tente novamente."
        : "Não foi possível carregar os contornos das cidades. Tente novamente.");
      erro.status = resposta.status;
      erro.detalhe = dados?.detail ?? null;
      throw erro;
    }
    return resposta.text();
  }
  const contornosValidos = valor => valor?.type === "FeatureCollection" && Array.isArray(valor.features);
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
      erro.detalhe = dados?.detail ?? null;
      throw erro;
    }
    if (dados === null) throw new Error("A API respondeu num formato inesperado. Tente novamente.");
    return dados;
  }

  window.CityDataSource = {
    // Um GeoJSON para todas as cidades, inclusive as de outros países.
    boundaries(resumo = []) {
      const ids = resumo.map(item => String(item.city_id)).sort().join(",");
      const key = `boundaries-v2:${resumo.length}:${assinatura(ids)}`;
      if (!contornosPendentes.has(key)) {
        const request = (async () => {
          // Antes os contornos nunca entravam no cache (passavam do limite de 12 MB)
          // e toda visita baixava tudo de novo.
          const guardado = await contornosCache?.get(key, SETE_DIAS).catch(() => null);
          if (typeof guardado === "string") {
            try { const valor = JSON.parse(guardado); if (contornosValidos(valor)) return valor; } catch { /* guardado inválido: baixa de novo */ }
          }
          const texto = await pedirTexto("/api/v1/cities/boundaries");
          let value = null;
          try { value = JSON.parse(texto); } catch { /* tratado abaixo */ }
          if (!contornosValidos(value)) throw new Error("Não foi possível carregar os contornos das cidades.");
          contornosCache?.set(key, texto, texto.length * 2).catch(() => {}); // grava sem atrasar o mapa
          return value;
        })();
        contornosPendentes.set(key, request);
        request.finally(() => contornosPendentes.delete(key)).catch(() => {});
      }
      return contornosPendentes.get(key);
    },
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

    // Sugestão de locais (rota /optimize, algoritmo guloso do Guilherme): a API
    // procura na rede de ruas os pontos onde um novo serviço da categoria
    // alcançaria mais moradores que hoje estão sem acesso. Nada é gravado.
    // "quantidade" vai de 1 a 3; o tempo limite (15 min) vem da própria análise.
    optimize(execucaoId, categoria, quantidade) {
      return pedir(`/api/v1/executions/${encodeURIComponent(execucaoId)}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: categoria, k: quantidade, algorithm: "greedy" }),
      });
    },
  };
})();
