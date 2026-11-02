"use strict";

// Interface oficial: abre no mapa de SP (mapa-estado.js) e mostra os resultados
// da cidade escolhida. Os detalhes de uma cidade só são pedidos à API quando
// ela é aberta, para não esbarrar no limite de chamadas do nginx (erro 429).
const CATEGORIES = {
  health: { name: "Saúde", place: "um serviço de saúde", examples: "Ex.: hospitais, clínicas e farmácias.", color: "#9a493e" },
  education: { name: "Educação", place: "um local de educação", examples: "Ex.: escolas e educação infantil.", color: "#37658a" },
  food: { name: "Alimentação", place: "um comércio de alimentos", examples: "Ex.: mercados, padarias e outros comércios.", color: "#39704c" },
  culture: { name: "Cultura", place: "um espaço de cultura", examples: "Ex.: bibliotecas, cinemas e museus.", color: "#87601e" },
};
// Endereço (#...) de cada tela.
const VIEW_NAMES = { mapa: "statemap", "visao-geral": "overview", comparar: "comparison", metodologia: "methodology" };
const DEFAULT_CITY = "Santos";           // cidade de "Resultados" se nenhuma for escolhida
const REFRESH_MS = 5 * 60 * 1000;        // confere novas análises a cada 5 minutos (1 chamada)

const state = {
  summary: [],          // resposta de /cities/summary (todas as cidades analisadas)
  cities: [],           // { id, name } em ordem alfabética
  details: new Map(),   // id da cidade -> { city, latest } (só as cidades já abertas)
  selectedId: null,
  view: "statemap",
  sort: { key: "overall", desc: true }, // ordenação da tabela "Comparar cidades"
};
const $ = (id) => document.getElementById(id);
const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const preciseFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" });
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function number(value) { return finite(value) ? integerFormat.format(value) : "—"; }
function decimal(value) { return finite(value) ? decimalFormat.format(value) : "—"; }
function percent(value, precise = false) { return finite(value) ? `${(precise ? preciseFormat : decimalFormat).format(value)}%` : "—"; }
function width(value) { return finite(value) ? Math.min(100, Math.max(0, value)) : 0; }
function date(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "Data indisponível" : dateFormat.format(parsed); }
function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function normalize(text) { return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function current() { return state.details.get(String(state.selectedId)); }
function cityById(id) { return state.cities.find((city) => city.id === String(id)); }
function category(code) { return CATEGORIES[code] || { name: code, place: `um local de ${code}`, examples: "Locais registrados nessa categoria.", color: "#37658a" }; }
function categoryCodes(report) { const codes = Object.keys(report?.categories || {}); return [...Object.keys(CATEGORIES).filter((code) => codes.includes(code)), ...codes.filter((code) => !CATEGORIES[code])]; }
function overallPeople(report) { return report && finite(report.total_weight) && finite(report.overall_coverage_percentage) ? Math.round(report.total_weight * report.overall_coverage_percentage / 100) : null; }

// Mensagem de carregamento/erro no topo da página.
function showStatus(message, error = false) {
  $("status-text").textContent = message;
  $("retry").hidden = !error;
  $("status").hidden = false;
}
function hideStatus() { $("status").hidden = true; }

function updateSourceNote() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(now);
  $("snapshot-note").textContent = `Resultados consultados pela API em ${date(now.toISOString())}, às ${time}: ${state.summary.length} cidades analisadas. Novas análises são conferidas a cada 5 minutos enquanto a página estiver aberta.`;
}

// ===== Tela "Resultados" (uma cidade) =====
function renderOverview() {
  const dataset = current();
  if (!dataset) return;
  const execution = dataset.latest.execution;
  const report = dataset.latest.population_report;
  const codes = categoryCodes(report);
  const time = decimal(execution.threshold_minutes);
  $("context-location").textContent = dataset.city.name;
  $("hero-title").textContent = `Pessoas com acesso aos ${codes.length === 4 ? "quatro" : codes.length} tipos de serviço`;
  $("hero-value").innerHTML = report ? `${number(overallPeople(report))}<span>pessoas</span>` : "Relatório indisponível";
  $("hero-people").textContent = report ? `${percent(report.overall_coverage_percentage, true)} das ${number(report.total_weight)} pessoas consideradas nesta análise.` : "Esta análise não contém um relatório populacional.";
  $("hero-explanation").textContent = `Esse grupo consegue chegar a pelo menos um estabelecimento de cada tipo em até ${time} minutos. O tempo é contado para cada categoria, em percursos separados, a partir da região onde a pessoa mora.`;
  $("population-total").textContent = `${number(report?.total_weight)} pessoas`;
  $("threshold").textContent = `${time} minutos`;
  $("speed").textContent = `Velocidade usada: ${decimal(execution.speed_kmh)} km/h`;
  $("analysis-date").textContent = date(execution.processed_at);
  $("services-description").textContent = `Cada resultado estima quem consegue chegar a pelo menos um local desse tipo em até ${time} minutos a pé.`;
  $("service-cards").innerHTML = codes.map((code) => {
    const meta = category(code);
    const item = report.categories[code];
    return `<article class="service-card" style="--category-color:${meta.color}"><h3>${escapeHTML(meta.name)}</h3>
      <div class="service-value">${percent(item.coverage_percentage)}</div><p class="service-percentage-label">da população considerada</p>
      <div class="service-bar" role="img" aria-label="${escapeHTML(meta.name)}: ${percent(item.coverage_percentage)} da população"><span style="--bar-width:${width(item.coverage_percentage)}%"></span></div>
      <p class="service-people"><strong>${number(item.within_threshold_weight)} pessoas</strong> conseguem chegar a ${escapeHTML(meta.place)} em até ${time} min, segundo a estimativa.</p>
      <p class="service-examples">${escapeHTML(meta.examples)}</p></article>`;
  }).join("") || '<p class="empty-message">Os resultados por serviço não estão disponíveis.</p>';
  window.CityMapPreview?.update({ city: dataset.city, execution });
  renderMethodExample();
}

function renderMethodExample() {
  const dataset = current();
  if (!dataset) return;
  const report = dataset.latest.population_report;
  const health = report?.categories?.health;
  const time = decimal(dataset.latest.execution.threshold_minutes);
  $("example-title").textContent = `Um exemplo com os dados de ${dataset.city.name}`;
  if (!health) { $("method-example-text").textContent = "O exemplo de Saúde não está disponível nesta análise."; $("method-example-formula").textContent = ""; return; }
  $("method-example-text").innerHTML = `A análise considera <strong>${number(report.total_weight)} pessoas</strong>. O cálculo estima que <strong>${number(health.within_threshold_weight)} delas</strong> conseguem alcançar ao menos um serviço de Saúde em até <strong>${time} minutos a pé</strong>. Isso corresponde a <strong>${percent(health.coverage_percentage, true)}</strong>.`;
  $("method-example-formula").textContent = `${number(health.within_threshold_weight)} ÷ ${number(report.total_weight)} × 100 = ${percent(health.coverage_percentage, true)}`;
}

// Abre uma cidade: pede os detalhes à API só na primeira vez (depois usa o que guardou).
let loadingId = null; // cidade que está sendo carregada agora (evita pedir duas vezes)
async function openCity(id, { show = true } = {}) {
  const cityId = String(id);
  state.selectedId = cityId;
  $("cidade").value = cityId;
  const needsLoad = !state.details.has(cityId) && loadingId !== cityId;
  if (needsLoad) loadingId = cityId;
  if (show) { setView("overview"); window.scrollTo({ top: 0, behavior: "auto" }); }
  if (needsLoad) {
    showStatus("Carregando os resultados da cidade…");
    try {
      const latest = await window.CityDataSource.latest(cityId);
      state.details.set(cityId, { city: cityById(cityId), latest });
    } catch (error) {
      if (cityId === state.selectedId) showStatus(error.message, true);
      return;
    } finally {
      if (loadingId === cityId) loadingId = null;
    }
    if (cityId !== state.selectedId) return; // o usuário escolheu outra cidade enquanto carregava
    hideStatus();
  }
  if (!state.details.has(cityId)) return; // ainda carregando (o outro pedido vai desenhar)
  renderOverview();
  if (state.view === "overview") requestAnimationFrame(() => window.CityMapPreview?.refresh());
}

// ===== Tela "Comparar cidades": uma tabela com todas, com filtro e ordenação =====
function scoreFor(item, key) {
  return key === "overall" ? item.selected_coverage_percentage : item.categories?.[key];
}
function renderComparison() {
  const filter = normalize($("filtro-cidades").value.trim());
  const { key, desc } = state.sort;
  const rows = state.summary
    .filter((item) => normalize(item.name).includes(filter))
    .sort((a, b) => {
      const order = key === "name" ? a.name.localeCompare(b.name, "pt-BR") : (scoreFor(a, key) ?? -1) - (scoreFor(b, key) ?? -1);
      return desc ? -order : order;
    });
  const columns = [["name", "Cidade"], ["overall", "Aos 4 tipos"], ...Object.keys(CATEGORIES).map((code) => [code, CATEGORIES[code].name])];
  // Cada título de coluna é um botão que ordena a tabela.
  const header = columns.map(([columnKey, label]) => {
    const active = columnKey === key;
    const sort = active ? (desc ? "descending" : "ascending") : "none";
    return `<th scope="col" aria-sort="${sort}"><button class="sort-button" type="button" data-sort="${columnKey}">${escapeHTML(label)}${active ? (desc ? " ↓" : " ↑") : ""}</button></th>`;
  }).join("");
  const body = rows.map((item) => `<tr><th scope="row"><button class="text-button city-link" type="button" data-open-city="${escapeHTML(item.city_id)}">${escapeHTML(item.name)}</button></th>`
    + `<td>${percent(item.selected_coverage_percentage)}</td>`
    + Object.keys(CATEGORIES).map((code) => `<td>${percent(item.categories?.[code])}</td>`).join("")
    + "</tr>").join("");
  $("cities-table").innerHTML = `<caption class="sr-only">Percentual da população de cada cidade com acesso a pé em até 15 minutos</caption><thead><tr>${header}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">Nenhuma cidade encontrada.</td></tr>`}</tbody>`;
}

// ===== Troca de tela =====
function setView(view, updateHash = true) {
  if (!["statemap", "overview", "comparison", "methodology"].includes(view)) view = "statemap";
  state.view = view;
  for (const element of document.querySelectorAll(".view")) element.hidden = element.id !== view;
  for (const link of document.querySelectorAll(".nav-item")) {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  const copy = {
    statemap: ["Acesso a serviços em cada cidade de SP", "Cada cidade aparece pintada pela parcela da população que chega a pé, em até 15 minutos, aos serviços escolhidos. Clique numa cidade ou use a busca para ver os detalhes."],
    overview: ["Serviços essenciais a até 15 minutos a pé", "Veja a estimativa de acesso da população a saúde, educação, alimentação e cultura."],
    comparison: ["Como o acesso varia entre as cidades", "Compare os resultados populacionais de todas as cidades analisadas."],
    methodology: ["Como os números são calculados", "Entenda de onde vêm os dados e o que cada resultado significa."],
  }[view];
  $("page-title").textContent = copy[0];
  $("page-description").textContent = copy[1];
  $("city-picker").hidden = view !== "overview";
  if (view === "statemap") requestAnimationFrame(() => window.MapaEstado?.mostrar());
  // "Resultados" e "Como funciona" usam os dados de uma cidade: carrega se ainda não tiver.
  if ((view === "overview" || view === "methodology") && !current() && state.selectedId) openCity(state.selectedId, { show: false });
  if (view === "overview") requestAnimationFrame(() => window.CityMapPreview?.refresh());
  if (updateHash) history.replaceState(null, "", `#${Object.keys(VIEW_NAMES).find((key) => VIEW_NAMES[key] === view)}`);
}

// Guarda uma resposta nova de /cities/summary e atualiza a lista de cidades.
function applySummary(summary) {
  state.summary = summary;
  state.cities = summary.map((item) => ({ id: String(item.city_id), name: item.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  $("cidade").replaceChildren(...state.cities.map((city) => {
    const option = document.createElement("option");
    option.value = city.id;
    option.textContent = city.name;
    return option;
  }));
  if (state.selectedId) $("cidade").value = state.selectedId;
  renderComparison();
  updateSourceNote();
}

async function initialize() {
  showStatus("Carregando os resultados…");
  $("application").hidden = true;
  $("cidade").disabled = true;
  try {
    const summary = await window.CityDataSource.summary();
    if (!summary.length) throw new Error("Ainda não há cidades com análise concluída. Tente novamente mais tarde.");
    applySummary(summary);
    const preferred = state.cities.find((city) => city.name === DEFAULT_CITY) || state.cities[0];
    state.selectedId = preferred.id;
    $("cidade").value = state.selectedId;
    $("cidade").disabled = false;
    hideStatus();
    $("application").hidden = false;
    setView(VIEW_NAMES[location.hash.slice(1)] || "statemap", false);
    await window.MapaEstado.iniciar({ resumo: summary, aoEscolherCidade: (id) => openCity(id) });
  } catch (error) {
    showStatus(error.message || "Não foi possível carregar os resultados.", true);
  }
}

// A cada 5 minutos pede o resumo de novo (1 chamada só). Se alguma cidade já aberta
// ganhou uma análise nova, esquece os detalhes antigos dela para pedir de novo.
let synchronizing = false;
async function synchronize() {
  if (document.hidden || $("application").hidden || synchronizing) return;
  synchronizing = true;
  try {
    const summary = await window.CityDataSource.summary();
    for (const [id, dataset] of state.details) {
      const fresh = summary.find((item) => String(item.city_id) === id);
      if (!fresh || fresh.execution_id !== dataset.latest.execution.id) state.details.delete(id);
    }
    applySummary(summary);
    window.MapaEstado.atualizar(summary);
    if (!current() && state.view === "overview") openCity(state.selectedId, { show: false });
  } catch {
    $("snapshot-note").textContent = "Não foi possível atualizar os resultados agora. Mantivemos a consulta anterior e tentaremos de novo em 5 minutos.";
  } finally {
    synchronizing = false;
  }
}

// ===== Eventos =====
$("cidade").addEventListener("change", (event) => openCity(event.target.value, { show: false }));
$("filtro-cidades").addEventListener("input", renderComparison);
document.addEventListener("click", (event) => {
  const navigation = event.target.closest("[data-view], [data-open-view]");
  if (navigation) { event.preventDefault(); setView(navigation.dataset.view || navigation.dataset.openView); window.scrollTo({ top: 0, behavior: "auto" }); }
  const city = event.target.closest("[data-open-city]");
  if (city) openCity(city.dataset.openCity);
  const sort = event.target.closest("[data-sort]");
  if (sort) {
    const key = sort.dataset.sort;
    // Clicar na mesma coluna inverte a ordem; numa coluna nova, começa do maior (ou de A a Z).
    state.sort = state.sort.key === key ? { key, desc: !state.sort.desc } : { key, desc: key !== "name" };
    renderComparison();
  }
});
window.addEventListener("hashchange", () => setView(VIEW_NAMES[location.hash.slice(1)] || "statemap", false));
$("retry").addEventListener("click", () => ($("application").hidden ? initialize() : openCity(state.selectedId, { show: false })));
setInterval(synchronize, REFRESH_MS);
initialize();
