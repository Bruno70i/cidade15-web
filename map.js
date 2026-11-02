"use strict";

// Coordenadas e tempos persistidos, exibidos somente para a execução correspondente.
(() => {
  const COLORS = { inside: "#208f85", outside: "#657889", unreachable: "#ce9853", service: "#284e6b" };
  const NAMES = { health: "saúde", education: "educação", food: "alimentação", culture: "cultura" };
  const SYMBOLS = {
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
    cinema: '<path d="M3 9h18v11H3V9Zm0 0-1-5 18-3 1 5L3 9Zm3-6 4 5m3-6 4 5M10 13l5 2-5 3v-5Z"/>',
    museum: '<path d="m2 8 10-5 10 5H2Zm3 3v7m5-7v7m4-7v7m5-7v7M3 21h18M2 18h20"/>',
    building: '<path d="M4 21V7l8-4 8 4v14H4Zm5 0v-6h6v6M8 9h1m6 0h1m-8 3h1m6 0h1"/>',
    health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
    education: '<path d="m2 8 10-5 10 5-10 5L2 8Zm4 2v7c4 3 8 3 12 0v-7m4-2v8"/>',
    food: '<path d="m4 8 2 13h12l2-13H4Zm4 0 4-6 4 6M9 12v5m6-5v5"/>',
  };
  const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat("pt-BR");
  const el = (id) => document.getElementById(id);
  let context = null;
  let renderedExecution = null;
  let map = null;
  let nodeGroup = null;
  let serviceGroup = null;
  let boundaryGroup = null;
  let nodes = [];
  let currentTime = 15;
  let hasTileError = false;
  const source = window.CityMapData.create();
  let requestGeneration = 0;
  let pointVersion = 0;
  let metadataController = null;
  let pointsController = null;
  let metadataLoading = false;
  let refreshTimer = null;
  let displayedServices = 0;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function selectedCategory() { return el("map-service").value; }
  function placeType(service) {
    if (service.category === "health") return { key: "health", label: "Saúde", symbol: "health", color: "#a76863" };
    if (service.category === "education") return { key: "education", label: "Educação", symbol: "education", color: "#597f9f" };
    if (service.category === "food") return { key: "food", label: "Alimentação", symbol: "food", color: "#5d886e" };
    const name = String(service.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/\bbiblioteca\b|\bgibiteca\b/.test(name)) return { key: "library", label: "Biblioteca / leitura", symbol: "book", color: "#566e99" };
    if (/\bcine/.test(name)) return { key: "cinema", label: "Cinema", symbol: "cinema", color: "#a66e57" };
    if (/\bmuseu\b/.test(name)) return { key: "museum", label: "Museu", symbol: "museum", color: "#547f7c" };
    return { key: "culture", label: "Espaço cultural", symbol: "building", color: "#89734e" };
  }
  function placeSymbol(type) {
    return `<svg class="place-symbol" viewBox="0 0 24 24" aria-hidden="true">${SYMBOLS[type.symbol]}</svg>`;
  }
  function placeName(service) {
    return !service.name || service.name === service.category ? "Estabelecimento sem nome cadastrado" : service.name;
  }
  function metric(node) { return node.categories?.[selectedCategory()]; }
  function classification(node, time) {
    const value = metric(node);
    if (!value?.reachable || !Number.isFinite(value.minutes)) return "unreachable";
    return value.minutes <= time ? "inside" : "outside";
  }
  function popup(node) {
    const value = metric(node);
    const travel = value?.reachable && Number.isFinite(value.minutes)
      ? `${format.format(value.minutes)} min até ${NAMES[selectedCategory()]}`
      : `Sem rota até ${NAMES[selectedCategory()]} no grafo`;
    return `<div class="node-popup"><span>EXEMPLO DE PONTO DE PARTIDA</span><strong>${escape(travel)}</strong><p>Tempo calculado a partir desta posição na rua até o serviço mais próximo.</p><small>Este ponto não representa uma casa ou um morador.<br>Velocidade usada: ${escape(context.execution.speed_kmh)} km/h.</small></div>`;
  }
  function styleFor(status) {
    return { radius: 3.5, color: "#ffffff", weight: 1, fillColor: COLORS[status], fillOpacity: .9 };
  }
  function updateStatus() {
    const inside = nodes.filter((item) => item.status === "inside").length;
    const visible = nodes.filter((item) => map.getBounds().contains(item.marker.getLatLng())).length;
    el("map-count").textContent = `${count.format(visible)} pontos exibidos`;
    const total = context.sample?.totals?.nodes ?? nodes.length;
    el("map-status").textContent = nodes.length
      ? `${count.format(inside)} dos ${count.format(nodes.length)} pontos exibidos alcançam ${NAMES[selectedCategory()]} em até ${format.format(currentTime)} min. A área consultada contém ${count.format(total)} pontos com tempos registrados. Esses pontos não representam pessoas.`
      : "Não há pontos com tempos de caminhada registrados nesta área e categoria.";
    const services = displayedServices;
    const totalServices = context.sample?.totals?.services ?? services;
    el("map-service-count").textContent = totalServices > services
      ? `Exibindo ${count.format(services)} de ${count.format(totalServices)} estabelecimentos desta categoria na área consultada. Aproxime o mapa para ver mais locais da região.`
      : `${count.format(services)} estabelecimento(s) desta categoria na área consultada. Clique nos ícones para consultar os locais.`;
  }
  function applyThreshold() {
    if (!context?.sample) return;
    currentTime = context.execution.threshold_minutes;
    el("map-analysis-params").textContent = `Limite: ${format.format(currentTime)} min · Caminhada: ${format.format(context.execution.speed_kmh)} km/h`;
    el("map-within-label").textContent = `Até ${format.format(currentTime)} min`;
    el("map-outside-label").textContent = `Mais de ${format.format(currentTime)} min`;
    for (const item of nodes) {
      const next = classification(item.node, currentTime);
      if (next !== item.status) {
        item.marker.setStyle(styleFor(next));
        item.status = next;
      }
    }
    if (map) updateStatus();
  }
  function showServices() {
    serviceGroup.clearLayers();
    const category = selectedCategory();
    const types = new Map();
    const occupied = new Set();
    displayedServices = 0;
    for (const service of context.sample.services.filter((item) => item.category === category)) {
      if (!Number.isFinite(service.lat) || !Number.isFinite(service.lon)) continue;
      const position = map.latLngToContainerPoint([service.lat,service.lon]);
      const cell = `${Math.floor(position.x/36)}:${Math.floor(position.y/36)}`;
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      displayedServices++;
      const type = placeType(service);
      const name = placeName(service);
      types.set(type.key, type);
      const icon = window.L.divIcon({
        className: `service-marker place-type-${type.key}`,
        html: `<span class="place-pin" style="--place-color:${type.color}">${placeSymbol(type)}</span>`,
        iconSize: [28, 32], iconAnchor: [14, 32], popupAnchor: [0, -28], tooltipAnchor: [0, -28],
      });
      const marker = window.L.marker([service.lat, service.lon], {
        icon, title: name, keyboard: true, riseOnHover: true, zIndexOffset: 600,
      }).bindPopup(`<div class="place-popup"><div class="place-popup-heading"><span class="place-legend-icon" style="--place-color:${type.color}">${placeSymbol(type)}</span><span>ESTABELECIMENTO DE ${escape(NAMES[category].toLocaleUpperCase("pt-BR"))}</span></div><strong>${escape(name)}</strong><p>Este ícone marca a localização do estabelecimento.</p><small>Nome e posição registrados na execução #${escape(context.execution.id)}.</small></div>`)
        .bindTooltip(escape(name), { direction: "top", className: "place-tooltip" }).addTo(serviceGroup);
      marker.getElement()?.setAttribute("aria-label", `Estabelecimento: ${name}`);
    }
    el("map-services-legend").innerHTML = '<span class="place-legend-title">Legenda dos locais</span>' + [...types.values()].map((type) =>
      `<span class="place-legend-item"><span class="place-legend-icon" style="--place-color:${type.color}">${placeSymbol(type)}</span>${escape(type.label)}</span>`
    ).join("");
  }
  function refreshCategory() {
    if (!map || !context?.sample) return;
    map.closePopup();
    nodeGroup.clearLayers();
    serviceGroup.clearLayers();
    nodes = [];
    el("map-services-legend").textContent = "";
    el("map-service-count").textContent = "";
    schedulePoints();
  }
  function createMap() {
    map = window.L.map("city-map", { scrollWheelZoom: false, minZoom: 4, maxZoom: 18, preferCanvas: true });
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).on("tileerror", () => {
      if (hasTileError) return;
      hasTileError = true;
      el("map-scope").textContent += " As imagens do mapa-base dependem de conexão com a internet.";
    }).addTo(map);
    boundaryGroup = window.L.layerGroup().addTo(map);
    nodeGroup = window.L.layerGroup().addTo(map);
    serviceGroup = window.L.layerGroup().addTo(map);
    map.on("moveend", schedulePoints);
    window.CitySimulation?.attach(map);
  }

  function notice(message, error = false) {
    el("map-message").textContent = message;
    el("map-retry").hidden = !error;
    el("map-notice").hidden = false;
  }

  function schedulePoints() {
    if (!map || !context?.sample || renderedExecution !== context.execution.id) return;
    const version = ++pointVersion;
    const generation = requestGeneration;
    pointsController?.abort();
    clearTimeout(refreshTimer);
    el("map-status").textContent = "Carregando os pontos e estabelecimentos desta área…";
    refreshTimer = setTimeout(() => loadPoints(generation, version), 280);
  }

  async function loadPoints(generation, version) {
    if (generation !== requestGeneration || version !== pointVersion || !map) return;
    pointsController = new AbortController();
    const controller = pointsController;
    const category = selectedCategory();
    const bounds = map.getBounds();
    const bbox = [Math.max(-180,bounds.getWest()), Math.max(-85,bounds.getSouth()), Math.min(180,bounds.getEast()), Math.min(85,bounds.getNorth())];
    el("map-notice").hidden = true;
    try {
      const data = await source.points(context.execution.id, category, bbox, controller.signal);
      if (generation !== requestGeneration || version !== pointVersion || category !== selectedCategory()) return;
      context.sample = {...context.sample, ...data};
      nodeGroup.clearLayers();
      serviceGroup.clearLayers();
      nodes = [];
      for (const node of data.nodes) {
        if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
        const marker = window.L.circleMarker([node.lat,node.lon], styleFor("outside"))
          .bindPopup(() => popup(node)).addTo(nodeGroup);
        nodes.push({node,marker,status:null});
      }
      showServices();
      applyThreshold();
      el("map-scope").textContent = "O mapa consulta os pontos e estabelecimentos salvos para esta mesma análise. Em áreas com muitos dados, exibe uma amostra; aproxime ou mova o mapa para consultar a região desejada. Os indicadores populacionais não são calculados contando esses marcadores.";
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration || version !== pointVersion) return;
      el("map-status").textContent = "Não foi possível atualizar os dados desta área.";
      notice(error.message || "Não foi possível consultar o mapa. Tente novamente.", true);
    }
  }

  async function render() {
    const container = el("city-map");
    if (!context || !container || !container.offsetWidth) return;
    if (!window.L) {
      notice("Não foi possível carregar o mapa. Os indicadores permanecem disponíveis abaixo.");
      return;
    }
    if (renderedExecution === context.execution.id) {
      map.invalidateSize({pan:false});
      schedulePoints();
      return;
    }
    if (metadataLoading) return;
    metadataLoading = true;
    const generation = requestGeneration;
    metadataController = new AbortController();
    const controller = metadataController;
    container.parentElement.classList.add("map-unavailable");
    el("map-network-info").hidden = true;
    el("map-services-legend").hidden = true;
    el("map-service-count").textContent = "";
    el("map-reset").disabled = true;
    notice("Carregando o mapa desta análise…");
    try {
      const sample = await source.metadata(context.execution.id, controller.signal);
      if (generation !== requestGeneration) return;
      if (String(sample.city_id) !== String(context.city.id)) throw new Error("O mapa recebido não corresponde à cidade selecionada.");
      context.sample = {...sample,nodes:[],services:[]};
      container.parentElement.classList.remove("map-unavailable");
      el("map-network-info").hidden = false;
      el("map-services-legend").hidden = false;
      el("map-notice").hidden = true;
      if (!map) createMap();
      map.invalidateSize({pan:false});
      nodeGroup.clearLayers();serviceGroup.clearLayers();boundaryGroup.clearLayers();nodes=[];
      if (sample.boundary) window.L.geoJSON(sample.boundary, {
        style:{color:"#547f91",weight:1.5,dashArray:"5 6",fill:false},interactive:false
      }).addTo(boundaryGroup);
      renderedExecution = context.execution.id;
      el("map-reset").disabled = false;
      container.setAttribute("aria-label",`Mapa dos estabelecimentos de ${context.city.name}, com pontos de partida nas ruas`);
      map.setView(sample.center,sample.total_nodes>50000?12:13,{animate:false});
      applyThreshold();
      schedulePoints();
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration) return;
      notice(error.message || "Não foi possível carregar o mapa.",true);
      el("map-scope").textContent = "Os indicadores acima e abaixo continuam disponíveis. O mapa exige pontos e tempos persistidos para a mesma execução concluída.";
    } finally {
      if (generation === requestGeneration) metadataLoading = false;
    }
  }
  window.CityMapPreview = {
    update(next) {
      const changed = !context || context.execution.id !== next.execution.id || String(context.city.id)!==String(next.city.id);
      if (changed) {
        requestGeneration++;pointVersion++;
        metadataController?.abort();pointsController?.abort();clearTimeout(refreshTimer);
        metadataLoading=false;renderedExecution=null;
        nodeGroup?.clearLayers();serviceGroup?.clearLayers();boundaryGroup?.clearLayers();nodes=[];
        context = {...next,sample:null};
        window.CitySimulation?.reset(next.execution);
      } else {
        context.city=next.city;context.execution=next.execution;
      }
      requestAnimationFrame(render);
    },
    refresh() { requestAnimationFrame(render); },
  };
  el("map-service").addEventListener("change", refreshCategory);
  el("map-retry").addEventListener("click", () => {
    if (renderedExecution === context?.execution.id) schedulePoints();
    else requestAnimationFrame(render);
  });
  el("map-reset").addEventListener("click", () => {
    if (map && context?.sample) map.fitBounds(context.sample.bounds, { padding: [24, 24], maxZoom: 14,animate:false });
  });
})();
