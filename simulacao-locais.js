"use strict";

// Confere o clique na rede da mesma execucao, usando somente a API existente.
(() => {
  const RAIO = 250, TERRA = 6371008.8, RAD = Math.PI / 180;
  const longitude = valor => ((valor + 180) % 360 + 360) % 360 - 180;
  function distancia(a, b) {
    const dx = longitude(a.lng - b.lon) * RAD * Math.cos((a.lat + b.lat) * RAD / 2);
    return TERRA * Math.hypot(dx, (a.lat - b.lat) * RAD);
  }
  function areasDoClique(ponto) {
    const dy = (RAIO + 2) / TERRA / RAD;
    const dx = dy / Math.cos(ponto.lat * RAD);
    const sul = Math.max(-85, ponto.lat - dy), norte = Math.min(85, ponto.lat + dy);
    const oeste = ponto.lng - dx, leste = ponto.lng + dx;
    const areas = oeste < -180 ? [[oeste + 360,sul,180,norte],[-180,sul,leste,norte]]
      : leste > 180 ? [[oeste,sul,180,norte],[-180,sul,leste - 360,norte]] : [[oeste,sul,leste,norte]];
    return areas.map(area => area.map(valor => Number(valor.toFixed(6))));
  }
  function dividir([oeste,sul,leste,norte]) {
    const x = Number(((oeste + leste) / 2).toFixed(6)), y = Number(((sul + norte) / 2).toFixed(6));
    return [[oeste,sul,x,y],[x,sul,leste,y],[oeste,y,x,norte],[x,y,leste,norte]];
  }
  function falha(completa) {
    const erro = new Error(completa
      ? "Local não adicionado: não há um ponto da rede de caminhada desta análise a até 250 metros. Escolha outra posição mais próxima de uma via analisada."
      : "Local não adicionado: não foi possível confirmar a posição na rede desta análise. Tente outra posição ou aguarde e tente novamente.");
    erro.codigo = completa ? "fora-da-rede" : "verificacao-incompleta";
    return erro;
  }
  window.SimulacaoLocais = {
    criar({fonte = window.CityMapData.create()} = {}) {
      return {
        async ajustar(execucao, categoria, posicao) {
          if (!Number.isFinite(posicao.lat) || !Number.isFinite(posicao.lng) || Math.abs(posicao.lat) >= 85) throw falha(false);
          const ponto = {lat:posicao.lat, lng:longitude(posicao.lng)};
          async function consultar(area) {
            const dados = await fonte.points(execucao, categoria, area);
            let melhor = null, invalidos = false;
            for (const no of dados.nodes) {
              if (no.id == null || !Number.isFinite(no.lat) || !Number.isFinite(no.lon) || Math.abs(no.lat) > 85 || Math.abs(no.lon) > 180) { invalidos = true; continue; }
              const metros = distancia(ponto, no);
              if (metros <= RAIO && (!melhor || metros < melhor.distancia)) melhor = {lat:no.lat, lng:no.lon, nodeId:String(no.id), distancia:metros};
            }
            return {melhor, completa:!invalidos && Number.isFinite(dados.totals?.nodes) && dados.totals.nodes <= dados.nodes.length};
          }
          const areas = areasDoClique(ponto);
          let completa = true;
          for (const area of areas) {
            const resposta = await consultar(area);
            if (resposta.melhor) return resposta.melhor;
            completa = completa && resposta.completa;
          }
          if (completa) throw falha(true);
          // Nao concluir que a via inexiste quando o servidor devolveu uma amostra.
          completa = true;
          for (const area of areas.flatMap(dividir)) {
            const resposta = await consultar(area);
            if (resposta.melhor) return resposta.melhor;
            completa = completa && resposta.completa;
          }
          throw falha(completa);
        },
      };
    },
  };
})();
