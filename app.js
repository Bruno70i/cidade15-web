"use strict";

// Interface oficial: consulta os resultados populacionais na API do projeto.
const CATEGORIES = {
  health: { name: "Saúde", place: "um serviço de saúde", examples: "Ex.: hospitais, clínicas e farmácias.", color: "#9a493e" },
  education: { name: "Educação", place: "um local de educação", examples: "Ex.: escolas e educação infantil.", color: "#37658a" },
  food: { name: "Alimentação", place: "um comércio de alimentos", examples: "Ex.: mercados, padarias e outros comércios.", color: "#39704c" },
  culture: { name: "Cultura", place: "um espaço de cultura", examples: "Ex.: bibliotecas, cinemas e museus.", color: "#87601e" },
};
const VIEW_NAMES = { "visao-geral": "overview", comparar: "comparison", metodologia: "methodology" };
const state = { cities: [], datasets: new Map(), selectedId: null, view: "overview" };
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
function current() { return state.datasets.get(String(state.selectedId)); }
function category(code) { return CATEGORIES[code] || { name: code, place: `um local de ${code}`, examples: "Locais registrados nessa categoria.", color: "#37658a" }; }
function categoryCodes(report) { const codes = Object.keys(report?.categories || {}); return [...Object.keys(CATEGORIES).filter((code) => codes.includes(code)), ...codes.filter((code) => !CATEGORIES[code])]; }
function overallPeople(report) { return report && finite(report.total_weight) && finite(report.overall_coverage_percentage) ? Math.round(report.total_weight * report.overall_coverage_percentage / 100) : null; }
function signature(data) { return data.cities.map(city => `${city.id}:${data.datasets.get(String(city.id))?.latest.execution.id}`).join("|"); }
function updateSourceNote(unavailable = []) {
  const now = new Date();
  const time = new Intl.DateTimeFormat("pt-BR", {hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}).format(now);
  $("snapshot-note").textContent = `Resultados consultados pela API em ${date(now.toISOString())}, às ${time}. Atualização automática a cada minuto enquanto a página estiver visível.${unavailable.length ? ` ${unavailable.length} cidade(s) sem resultado populacional disponível nesta consulta.` : ""}`;
}

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

function renderComparison() {
  const datasets = state.cities.map((city) => state.datasets.get(String(city.id))).filter(Boolean);
  $("cities-comparison").innerHTML = datasets.map((dataset) => {
    const report = dataset.latest.population_report;
    const execution = dataset.latest.execution;
    return `<article class="city-card"><h2>${escapeHTML(dataset.city.name)}</h2><div class="city-score">${percent(report?.overall_coverage_percentage, true)}</div>
      <p class="city-score-caption">da população com acesso aos quatro tipos de serviço</p><p class="city-people">Estimativa de <strong>${number(overallPeople(report))} pessoas</strong></p>
      <p class="city-card-params">Até ${decimal(execution.threshold_minutes)} min a pé · ${decimal(execution.speed_kmh)} km/h<br>População considerada: ${number(report?.total_weight)} pessoas</p>
      ${categoryCodes(report).map((code) => `<div class="city-category" style="--category-color:${category(code).color}"><div><span>${escapeHTML(category(code).name)}</span><strong>${percent(report.categories[code].coverage_percentage)}</strong></div><div class="service-bar"><span style="--bar-width:${width(report.categories[code].coverage_percentage)}%"></span></div></div>`).join("")}
      <button class="text-button" data-open-city="${escapeHTML(dataset.city.id)}">Ver os resultados de ${escapeHTML(dataset.city.name)}</button></article>`;
  }).join("");
  const codes = [...new Set(datasets.flatMap((dataset) => categoryCodes(dataset.latest.population_report)))];
  const row = (label, getValue) => `<tr><th scope="row">${escapeHTML(label)}</th>${datasets.map((dataset) => `<td>${getValue(dataset)}</td>`).join("")}</tr>`;
  $("cities-table").innerHTML = `<caption class="sr-only">Percentual de pessoas com acesso dentro do tempo de cada análise</caption><thead><tr><th scope="col">Tipo de acesso</th>${datasets.map((dataset) => `<th scope="col">${escapeHTML(dataset.city.name)}</th>`).join("")}</tr></thead><tbody>${row("Aos quatro tipos de serviço", (dataset) => percent(dataset.latest.population_report?.overall_coverage_percentage, true))}${codes.map((code) => row(category(code).name, (dataset) => percent(dataset.latest.population_report?.categories?.[code]?.coverage_percentage, true))).join("")}</tbody>`;
}

function setView(view, updateHash = true) {
  if (!["overview", "comparison", "methodology"].includes(view)) view = "overview";
  state.view = view;
  for (const element of document.querySelectorAll(".view")) element.hidden = element.id !== view;
  for (const link of document.querySelectorAll(".nav-item")) {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  const time = decimal(current()?.latest.execution.threshold_minutes);
  const copy = {
    overview: [`Serviços essenciais a até ${time} minutos a pé`, "Veja a estimativa de acesso da população a saúde, educação, alimentação e cultura."],
    comparison: ["Como o acesso varia entre as cidades", "Compare os resultados populacionais de cada análise."],
    methodology: ["Como os números são calculados", "Entenda de onde vêm os dados e o que cada resultado significa."],
  }[view];
  $("page-title").textContent = copy[0];
  $("page-description").textContent = copy[1];
  $("city-picker").hidden = view !== "overview";
  if (view === "overview") requestAnimationFrame(() => window.CityMapPreview?.refresh());
  if (updateHash) history.replaceState(null, "", `#${Object.keys(VIEW_NAMES).find((key) => VIEW_NAMES[key] === view)}`);
}

async function initialize() {
  $("status").hidden = false;
  $("status-text").textContent = "Carregando os resultados…";
  $("retry").hidden = true;
  $("application").hidden = true;
  $("cidade").disabled = true;
  try {
    const data = await window.CityDataSource.load();
    const { cities, datasets, unavailable } = data;
    state.cities = cities;
    state.datasets = datasets;
    state.selectedId = String(cities[0].id);
    $("cidade").replaceChildren(...cities.map((city) => { const option = document.createElement("option"); option.value = String(city.id); option.textContent = city.name; return option; }));
    $("cidade").value = state.selectedId;
    $("cidade").disabled = false;
    renderOverview();
    renderComparison();
    updateSourceNote(unavailable);
    setView(VIEW_NAMES[location.hash.slice(1)] || "overview", false);
    $("status").hidden = true;
    $("application").hidden = false;
  } catch (error) {
    $("status-text").textContent = error.message || "Não foi possível carregar os resultados.";
    $("retry").hidden = false;
  }
}
$("cidade").addEventListener("change", (event) => { state.selectedId = event.target.value; renderOverview(); setView("overview", false); });
document.addEventListener("click", (event) => {
  const navigation = event.target.closest("[data-view], [data-open-view]");
  if (navigation) { event.preventDefault(); setView(navigation.dataset.view || navigation.dataset.openView); window.scrollTo({ top: 0, behavior: "auto" }); }
  const city = event.target.closest("[data-open-city]");
  if (city) { state.selectedId = city.dataset.openCity; $("cidade").value = state.selectedId; renderOverview(); setView("overview"); window.scrollTo({ top: 0, behavior: "auto" }); }
});
window.addEventListener("hashchange", () => setView(VIEW_NAMES[location.hash.slice(1)] || "overview", false));
$("retry").addEventListener("click", initialize);
let synchronizing = false;
async function synchronize() {
  if (document.hidden || $("application").hidden || synchronizing) return;
  synchronizing = true;
  try {
    const data = await window.CityDataSource.load();
    // Uma falha temporária não deve retirar do painel uma cidade já exibida.
    if (data.unavailable.some(city => state.datasets.has(String(city.id)))) throw new Error("Consulta parcial.");
    if (signature(data) !== signature(state)) {
      state.cities = data.cities;
      state.datasets = data.datasets;
      if (!state.datasets.has(String(state.selectedId))) state.selectedId = String(data.cities[0].id);
      $("cidade").replaceChildren(...data.cities.map(city => {const option=document.createElement("option");option.value=String(city.id);option.textContent=city.name;return option;}));
      $("cidade").value = state.selectedId;
      renderOverview();renderComparison();setView(state.view,false);
    }
    updateSourceNote(data.unavailable);
  } catch {
    $("snapshot-note").textContent = "Não foi possível atualizar os resultados agora. Mantivemos a consulta anterior e tentaremos novamente em um minuto.";
  } finally { synchronizing = false; }
}
setInterval(synchronize, 60000);
window.addEventListener("focus", synchronize);
initialize();
