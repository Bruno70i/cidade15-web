"use strict";

// Hierarquia do mapa global: país › estado (o continente saiu: com poucos países ele
// só acrescentava um clique). Países e estados vêm do Natural Earth (dados/*.geojson);
// cada cidade é ligada ao estado que contém o centro do seu contorno.
(() => {
  const nomes = {BRA:"Brasil", FRA:"França", ESP:"Espanha", BEL:"Bélgica", NLD:"Países Baixos", CHN:"China"};
  // Correções de nome do Natural Earth (o Distrito Federal vem como "Federal").
  const nomesEstados = {"BRA-599": "Distrito Federal"};
  // Siglas dos estados brasileiros (rótulos do mapa no nível do país).
  const siglas = {
    "Acre":"AC", "Alagoas":"AL", "Amapá":"AP", "Amazonas":"AM", "Bahia":"BA", "Ceará":"CE", "Distrito Federal":"DF",
    "Espírito Santo":"ES", "Goiás":"GO", "Maranhão":"MA", "Mato Grosso":"MT", "Mato Grosso do Sul":"MS",
    "Minas Gerais":"MG", "Pará":"PA", "Paraíba":"PB", "Paraná":"PR", "Pernambuco":"PE", "Piauí":"PI",
    "Rio de Janeiro":"RJ", "Rio Grande do Norte":"RN", "Rio Grande do Sul":"RS", "Rondônia":"RO", "Roraima":"RR",
    "Santa Catarina":"SC", "São Paulo":"SP", "Sergipe":"SE", "Tocantins":"TO",
  };
  // Xangai é um município de nível provincial. A divisa marítima pode
  // deslocar o centro da caixa para fora da unidade terrestre.
  const municipiosProvinciais = new Map([["CHN:shanghai", "CHN-1819"], ["CHN:xangai", "CHN-1819"]]);
  const normalizar = valor => String(valor ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  let regioes = new Map(), caminhos = new Map();
  const L = window.L;
  let bases, paisesCarregados, estadosPorPaisBase = new Map(), geracao = 0;
  // Ligar milhares de cidades aos estados leva mais de 1 s num celular lento: o trabalho
  // é feito em fatias curtas, devolvendo a vez à tela entre elas (os toques não travam).
  const agora = () => (globalThis.performance ?? Date).now();
  // scheduler.yield (Chrome) devolve a vez só ao que é urgente (toques) e volta logo.
  const pausa = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(continuar => setTimeout(continuar, 0));

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

  function registrar(destino, id, nome, pais, caminho, bounds, cidadeBounds, feature = null, sigla = null) {
    if (!destino.has(id)) {
      destino.set(id, {id, nome, pais, caminho, feature, sigla, bounds: L.latLngBounds([]), cidades:L.latLngBounds([]), quantidade:0});
    }
    const regiao = destino.get(id);
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
        const {pais, id} = feature.properties;
        const nome = nomesEstados[id] ?? feature.properties.nome;
        if (!estadosPorPais.has(pais)) estadosPorPais.set(pais, []);
        estadosPorPais.get(pais).push({feature, nome, sigla:pais === "BRA" ? siglas[nome] ?? null : null, bounds:L.geoJSON(feature).getBounds()});
      }
      estadosPorPaisBase = estadosPorPais;
      return {paisPorNome, estadosPorPais};
    }).catch(erro => { bases = null; throw erro; });
    return bases;
  }

  window.RegioesMapa = {
    carregarPaises,
    preparar,
    // Liga cada cidade ao país (pelo nome do país no resumo) e, se o contorno já
    // chegou, ao estado. Pode ser chamado sem contornos (só países) e de novo depois.
    // Monta tudo à parte e só troca no fim: quem consulta no meio vê a versão anterior inteira.
    async atualizar(cidades, resumo = []) {
      const minha = ++geracao;
      const {paisPorNome, estadosPorPais} = await preparar();
      const novasRegioes = new Map(), novosCaminhos = new Map();
      const comContorno = new Set(cidades.map(({feature}) => String(feature.properties.city_id)));
      const catalogo = [
        ...cidades.map(({feature,bounds}) => ({...feature.properties,bounds,geometry:feature.geometry})),
        ...resumo.filter(item => !comContorno.has(String(item.city_id))),
      ];
      let inicioFatia = agora();
      for (const {city_id, country, name, bounds, geometry} of catalogo) {
        if (agora() - inicioFatia > 40) {
          await pausa();
          if (minha !== geracao) return false; // outra atualização mais nova assumiu
          inicioFatia = agora();
        }
        const pais = paisPorNome.get(normalizar(country));
        const {codigo} = pais?.feature.properties ?? {};
        const referencia = bounds ?? pais?.bounds;
        if (!referencia) continue;
        const caminho = [`pais:${codigo ?? country}`];
        registrar(novasRegioes, caminho[0], nomes[codigo] ?? country, country, [...caminho], pais?.bounds ?? referencia, referencia, pais?.feature ?? null);
        if (!bounds) {
          novosCaminhos.set(String(city_id), caminho);
          continue;
        }
        const centro = bounds.getCenter();
        const candidatos = estadosPorPais.get(codigo) ?? [];
        const idAdministrativo = municipiosProvinciais.get(`${codigo}:${normalizar(name)}`);
        const unidade = candidatos.find(item => item.feature.properties.id === idAdministrativo)
          ?? candidatos.find(item => inclui(item, [centro.lng, centro.lat]))
          ?? candidatos.find(item => inclui(item, poligonos(geometry)[0][0][0]));
        if (unidade) {
          caminho.push(`estado:${unidade.feature.properties.id}`);
          registrar(novasRegioes, caminho.at(-1), unidade.nome, country, [...caminho], unidade.bounds, bounds, unidade.feature, unidade.sigla);
        }
        novosCaminhos.set(String(city_id), caminho);
      }
      if (minha !== geracao) return false;
      regioes = novasRegioes;
      caminhos = novosCaminhos;
      return true;
    },
    // Todos os estados de um país (também os sem cidades analisadas), para desenhar as divisas.
    estadosDoPais(paisId) {
      const codigo = String(paisId ?? "").replace(/^pais:/, "");
      return (estadosPorPaisBase.get(codigo) ?? []).map(estado => ({
        id:`estado:${estado.feature.properties.id}`, nome:estado.nome, sigla:estado.sigla,
        feature:estado.feature, bounds:estado.bounds, caminho:[`pais:${codigo}`, `estado:${estado.feature.properties.id}`],
      }));
    },
    caminhoCidade: id => caminhos.get(String(id)) ?? [],
    obter: id => regioes.get(id),
    filhas(caminho) {
      return [...regioes.values()].filter(regiao => regiao.caminho.length === caminho.length + 1 &&
        caminho.every((id, i) => id === regiao.caminho[i]));
    },
  };
})();
