"use strict";

// Simplifica contornos (algoritmo de Douglas-Peucker): tira os pontos que quase não
// mudam o desenho. Os contornos das 5.297 cidades têm ~641 mil pontos; no celular,
// cada zoom recalculava todos eles e a tela travava. A tolerância é em graus
// (0,006° ≈ 650 m), pequena perto do tamanho de uma cidade no mapa global.
(() => {
  function anel(pontos, tolerancia) {
    if (pontos.length <= 4) return pontos;
    const manter = new Uint8Array(pontos.length);
    manter[0] = manter[pontos.length - 1] = 1;
    const limite = tolerancia * tolerancia;
    const pilha = [[0, pontos.length - 1]];
    while (pilha.length) {
      const [a, b] = pilha.pop();
      const [ax, ay] = pontos[a], [bx, by] = pontos[b];
      const dx = bx - ax, dy = by - ay, comprimento = dx * dx + dy * dy;
      let maior = 0, indice = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pontos[i];
        let t = comprimento ? ((px - ax) * dx + (py - ay) * dy) / comprimento : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - px, ey = ay + t * dy - py, distancia = ex * ex + ey * ey;
        if (distancia > maior) { maior = distancia; indice = i; }
      }
      if (maior > limite && indice > 0) {
        manter[indice] = 1;
        pilha.push([a, indice], [indice, b]);
      }
    }
    const saida = [];
    for (let i = 0; i < pontos.length; i++) {
      // 4 casas decimais (~11 m): o arquivo guardado no navegador fica menor.
      if (manter[i]) saida.push([Math.round(pontos[i][0] * 1e4) / 1e4, Math.round(pontos[i][1] * 1e4) / 1e4]);
    }
    return saida.length >= 4 ? saida : pontos; // um anel fechado precisa de 4 pontos
  }

  // Devolve uma cópia simplificada de uma Feature GeoJSON (Polygon ou MultiPolygon).
  function feature(original, tolerancia) {
    const geometria = original?.geometry;
    if (!geometria) return original ?? null;
    const poligono = aneis => aneis.map(pontos => anel(pontos, tolerancia));
    const coordenadas = geometria.type === "Polygon" ? poligono(geometria.coordinates)
      : geometria.type === "MultiPolygon" ? geometria.coordinates.map(poligono)
        : geometria.coordinates;
    return { ...original, geometry: { type: geometria.type, coordinates: coordenadas } };
  }

  window.Simplificar = { anel, feature };
})();
