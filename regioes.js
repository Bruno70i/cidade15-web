"use strict";

(() => {
  const continentes = {
    "Africa":"África", "Asia":"Ásia", "Europe":"Europa", "Oceania":"Oceania",
    "North America":"América do Norte", "South America":"América do Sul",
  };
  // Enquadramentos geográficos independentes dos países que têm análises.
  const limitesContinentes = {
    "Africa": [[-35, -26], [38, 58]],
    "Asia": [[-12, 25], [82, 191]],
    "Europe": [[34, -25], [82, 69]],
    "Oceania": [[-55, 110], [30, 235]],
    "North America": [[5, -180], [84, -10]],
    "South America": [[-57, -93], [14, -34]],
  };
  const nomes = {BRA:"Brasil", FRA:"França", ESP:"Espanha", BEL:"Bélgica", NLD:"Países Baixos", CHN:"China"};
  // Xangai é um município de nível provincial. A divisa marítima pode
  // deslocar o centro da caixa para fora da unidade terrestre.
  const municipiosProvinciais = new Map([["CHN:shanghai", "CHN-1819"], ["CHN:xangai", "CHN-1819"]]);
  const normalizar = valor => String(valor ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const regioes = new Map(), caminhos = new Map();
  const L = window.L;
  let bases, paisesCarregados, paisesBase = null;

  async function lerBase(url) {
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error("Não foi possível carregar os limites geográficos.");
    return resposta.json();
  }

  function carregarPaises() {
    paisesCarregados ??= lerBase("dados/paises.geojson?v=hierarquia").catch(erro => {
      paisesCarregados = null;
      throw erro;
    });
    return paisesCarregados;
  }

  function dentroDoAnel([x, y], anel) {
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i], [xj, yj] = anel[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  function poligonos(geometria) {
    return geometria.type === "Polygon" ? [geometria.coordinates] : geometria.coordinates;
  }

  function inclui(unidade, ponto) {
    return unidade.bounds.contains([ponto[1], ponto[0]]) &&
      poligonos(unidade.feature.geometry).some(([anel, ...furos]) =>
        dentroDoAnel(ponto, anel) && !furos.some(furo => dentroDoAnel(ponto, furo)));
  }

  // Contorno de um continente: junta os países dele e apaga as fronteiras internas.
  // No Natural Earth, países vizinhos usam exatamente os mesmos pontos na fronteira:
  // um trecho que aparece em dois países é fronteira interna; o que aparece uma vez
  // só é a borda do continente. Devolve linhas [[lat, lon], ...] para o Leaflet.
  const contornosContinentes = new Map();
  function contornoContinente(continente, paises) {
    if (contornosContinentes.has(continente)) return contornosContinentes.get(continente);
    const aneisDoContinente = paises.features.filter(f => f.properties.continente === continente)
      .flatMap(f => poligonos(f.geometry).flat());
    const chave = (a, b) => { const p = `${a[0]},${a[1]}`, q = `${b[0]},${b[1]}`; return p < q ? `${p}|${q}` : `${q}|${p}`; };
    const usos = new Map();
    for (const anel of aneisDoContinente) {
      for (let i = 1; i < anel.length; i++) { const k = chave(anel[i - 1], anel[i]); usos.set(k, (usos.get(k) ?? 0) + 1); }
    }
    const linhas = [];
    for (const anel of aneisDoContinente) {
      let atual = [];
      for (let i = 1; i < anel.length; i++) {
        if (usos.get(chave(anel[i - 1], anel[i])) === 1) {
          if (!atual.length) atual.push([anel[i - 1][1], anel[i - 1][0]]);
          atual.push([anel[i][1], anel[i][0]]);
        } else if (atual.length) { linhas.push(atual); atual = []; }
      }
      if (atual.length) linhas.push(atual);
    }
    contornosContinentes.set(continente, linhas);
    return linhas;
  }

  function registrar(id, nome, pais, caminho, bounds, cidadeBounds, feature = null) {
    if (!regioes.has(id)) {
      regioes.set(id, {id, nome, pais, caminho, feature, bounds: L.latLngBounds([]), cidades:L.latLngBounds([]), quantidade:0});
    }
    const regiao = regioes.get(id);
    regiao.bounds.extend(bounds);
    regiao.cidades.extend(cidadeBounds);
    regiao.quantidade++;
  }

  // Começa a baixar países e estados (pode ser chamado cedo, junto com os contornos das cidades).
  function preparar() {
    bases ??= Promise.all([
      carregarPaises(),
      lerBase("dados/estados.geojson?v=20261124-estados"),
    ]).then(([paises, estados]) => {
        const paisPorNome = new Map(), estadosPorPais = new Map();
        for (const feature of paises.features) {
          const pais = {feature, bounds:L.geoJSON(feature).getBounds()};
          for (const nome of feature.properties.nomes) paisPorNome.set(normalizar(nome), pais);
        }
        for (const feature of estados.features) {
          const {pais} = feature.properties;
          if (!estadosPorPais.has(pais)) estadosPorPais.set(pais, []);
          estadosPorPais.get(pais).push({feature, bounds:L.geoJSON(feature).getBounds()});
        }
        return {paisPorNome, estadosPorPais, paises};
      }).catch(erro => { bases = null; throw erro; });
    return bases;
  }

  window.RegioesMapa = {
    carregarPaises,
    preparar,
    async atualizar(cidades, resumo = []) {
      const {paisPorNome, estadosPorPais, paises} = await preparar();
      paisesBase = paises;
      regioes.clear();
      caminhos.clear();
      const comContorno = new Set(cidades.map(({feature}) => String(feature.properties.city_id)));
      const catalogo = [
        ...cidades.map(({feature,bounds}) => ({...feature.properties,bounds,geometry:feature.geometry})),
        ...resumo.filter(item => !comContorno.has(String(item.city_id))),
      ];
      for (const {city_id, country, name, bounds, geometry} of catalogo) {
        const pais = paisPorNome.get(normalizar(country));
        const {codigo, continente} = pais?.feature.properties ?? {};
        const referencia = bounds ?? pais?.bounds;
        if (!referencia) continue;
        const caminho = [];
        if (continentes[continente]) {
          caminho.push(`continente:${continente}`);
          registrar(caminho.at(-1), continentes[continente], null, [...caminho], limitesContinentes[continente], referencia);
        }
        caminho.push(`pais:${codigo ?? country}`);
        registrar(caminho.at(-1), nomes[codigo] ?? country, country, [...caminho], pais?.bounds ?? referencia, referencia, pais?.feature ?? null);
        if (!bounds) {
          caminhos.set(String(city_id), caminho);
          continue;
        }
        const centro = bounds.getCenter();
        const candidatos = estadosPorPais.get(codigo) ?? [];
        const idAdministrativo = municipiosProvinciais.get(`${codigo}:${normalizar(name)}`);
        const unidade = candidatos.find(item => item.feature.properties.id === idAdministrativo)
          ?? candidatos.find(item => inclui(item, [centro.lng, centro.lat]))
          ?? candidatos.find(item => inclui(item, poligonos(geometry)[0][0][0]));
        if (unidade) {
          const {id, nome} = unidade.feature.properties;
          caminho.push(`estado:${id}`);
          registrar(caminho.at(-1), nome, country, [...caminho], unidade.bounds, bounds, unidade.feature);
        }
        caminhos.set(String(city_id), caminho);
      }
    },
    // Linhas do contorno de um continente (ex.: "continente:South America").
    contorno(id) {
      const continente = String(id ?? "").replace(/^continente:/, "");
      return paisesBase && continentes[continente] ? contornoContinente(continente, paisesBase) : [];
    },
    // Países do continente (para a área clicável no mapa global).
    paisesDoContinente(id) {
      const continente = String(id ?? "").replace(/^continente:/, "");
      return paisesBase ? paisesBase.features.filter(f => f.properties.continente === continente) : [];
    },
    caminhoCidade: id => caminhos.get(String(id)) ?? [],
    obter: id => regioes.get(id),
    filhas(caminho) {
      return [...regioes.values()].filter(regiao => regiao.caminho.length === caminho.length + 1 &&
        caminho.every((id, i) => id === regiao.caminho[i]));
    },
  };
})();
