"use strict";

// Uma única instância do mapa: as imagens se repetem no eixo horizontal.
(() => {
  const LATITUDE_LIMITE = 85.05112878;

  function ajustar(mapa) {
    const tamanho = mapa.getSize();
    if (!tamanho.x || !tamanho.y) return null;
    // O mundo precisa cobrir a altura da tela, inclusive no menor zoom.
    const minimo = Math.max(0, Math.ceil(Math.log2((tamanho.y + 2) / 256) * 4) / 4);
    const larguraMundo = 256 * 2 ** minimo;
    const longitudeLimite = 360 * (Math.ceil(tamanho.x / larguraMundo) + 2);
    mapa.setMinZoom(minimo);
    // Limita os polos sem impedir a passagem entre cópias horizontais.
    // worldCopyJump recentraliza as coordenadas ao atravessar o mundo.
    mapa.setMaxBounds([[-LATITUDE_LIMITE, -longitudeLimite], [LATITUDE_LIMITE, longitudeLimite]]);
    return minimo;
  }

  window.CityMapViewport = {
    showWorld(mapa) {
      const minimo = ajustar(mapa);
      if (minimo !== null) mapa.setView([10, 0], minimo, {animate:false});
    },
    resize(mapa) {
      const minimo = ajustar(mapa);
      if (minimo !== null && !Number.isFinite(mapa.getZoom())) mapa.setView([10, 0], minimo, {animate:false});
    },
  };
})();
