"use strict";

// A mesma precisao e a mesma base para o card, a barra e a comparacao.
(() => {
  const numero = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:2});
  const DESTINO = {overall:"aos 4 tipos de serviço",health:"a um serviço de saúde",education:"a um local de educação",food:"a um comércio de alimentos",culture:"a um espaço de cultura"};
  function comparar(relatorio, resultado, categoria) {
    if (!relatorio) return null;
    const original = categoria === "overall" ? relatorio.overall_coverage_percentage : relatorio.categories?.[categoria]?.coverage_percentage;
    if (!Number.isFinite(original)) return null;
    const total = relatorio.categories?.[categoria]?.total_weight ?? relatorio.total_weight;
    const item = categoria === "overall" ? resultado?.overall?.population : resultado?.results?.[categoria]?.population;
    const antes = Number.isFinite(item?.before?.coverage_percentage) ? item.before.coverage_percentage : original;
    const depois = Number.isFinite(item?.after?.coverage_percentage) ? item.after.coverage_percentage : antes;
    const variacao = Math.abs(depois - antes) < 1e-7 ? 0 : depois - antes;
    return {antes, depois, total, variacao, simulado:Boolean(resultado)};
  }
  function percentual(valor) { return Number.isFinite(valor) ? `${numero.format(valor)}%` : "—"; }
  function pontos(valor) {
    const absoluto = Math.abs(valor);
    if (absoluto > 0 && absoluto < 0.005) return "menos de 0,01 ponto percentual";
    return `${numero.format(absoluto)} ${Number(numero.format(absoluto).replace(",", ".")) === 1 ? "ponto percentual" : "pontos percentuais"}`;
  }
  function impacto(dados) {
    if (!dados.variacao) return {tipo:"neutro", titulo:"Sem aumento de acesso nesta categoria.", detalhe:`O percentual permanece em ${percentual(dados.depois)}.`};
    const ganho = dados.variacao > 0;
    return {tipo:ganho ? "ganho" : "perda", titulo:`${ganho ? "Aumento" : "Redução"} de ${pontos(dados.variacao)}.`, detalhe:`O acesso passaria de ${percentual(dados.antes)} para ${percentual(dados.depois)}.`};
  }
  function semAcesso(dados, categoria, minutos) {
    return `${percentual(Math.max(0, 100 - dados.depois))} da população não ${dados.simulado ? "conseguiria" : "consegue"} chegar ${DESTINO[categoria]} em até ${numero.format(minutos)} minutos a pé${dados.simulado ? ", mesmo com os novos locais simulados" : ""}.`;
  }
  window.SimulacaoVista = {comparar, percentual, impacto, semAcesso};
})();
