"use strict";

// Somente consultas à API existente. Não contém credenciais ou resultados fixos.
(() => {
  async function load({ fetchImpl = (...args) => fetch(...args) } = {}) {
    async function request(path) {
      const response = await fetchImpl(path, { cache: "no-store" });
      if (!response.ok) {
        const message = response.status === 429
          ? "Muitas consultas à API. Aguarde alguns instantes e tente novamente."
          : "Não foi possível consultar os resultados na API. Tente novamente.";
        throw new Error(message);
      }
      return response.json();
    }
    const cities = await request("/api/v1/cities");
    if (!Array.isArray(cities) || !cities.length) throw new Error("Ainda não há cidades disponíveis para consulta.");
    const datasets = new Map();
    const available = [];
    const unavailable = [];
    // Consultas sequenciais evitam rajadas ao abrir o site, respeitando o limite do servidor.
    for (const city of cities) {
      try {
        const latest = await request(`/api/v1/cities/${encodeURIComponent(city.id)}/latest`);
        const report = latest?.population_report;
        if (!latest?.execution || !report || !Number.isFinite(report.total_weight) || !Number.isFinite(report.overall_coverage_percentage) || !report.categories || !Object.keys(report.categories).length) {
          throw new Error("Relatório populacional indisponível.");
        }
        datasets.set(String(city.id), { city, latest });
        available.push(city);
      } catch {
        unavailable.push(city);
      }
    }
    if (!available.length) throw new Error("Não há resultados populacionais disponíveis no momento. Aguarde a conclusão da análise ou tente novamente.");
    return { cities: available, datasets, unavailable };
  }
  window.CityDataSource = { load };
})();
