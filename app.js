// app.js: busca os dados na API (via servidor.py) e preenche a página.
// Rotas usadas: /cities, /cities/{id}/latest, /cities/{id}/executions

const CATEGORIAS = {
  health: "Saúde",
  education: "Educação",
  food: "Alimentação",
  culture: "Cultura",
};

const seletor = document.getElementById("cidade");
const mensagem = document.getElementById("mensagem");
const resultado = document.getElementById("resultado");

// ---------- Formatação ----------

// 33.850159 -> "33,9%"
function porcento(valor) {
  if (valor === null || valor === undefined) return "–";
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
}

// 118439 -> "118 mil"; 1910 -> "1.910"
function numero(valor) {
  if (valor === null || valor === undefined) return "–";
  if (valor >= 10000) return `${Math.round(valor / 1000).toLocaleString("pt-BR")} mil`;
  return Math.round(valor).toLocaleString("pt-BR");
}

// 26.73 -> "27 min"
function minutos(valor) {
  if (valor === null || valor === undefined) return "–";
  return `${Math.round(valor)} min`;
}

// Cria uma linha de tabela com os textos dados.
function linha(textos) {
  const tr = document.createElement("tr");
  for (const texto of textos) {
    const td = document.createElement("td");
    td.textContent = texto;
    tr.appendChild(td);
  }
  return tr;
}

function escrever(id, texto) {
  document.getElementById(id).textContent = texto;
}

// ---------- API ----------

async function buscarApi(caminho) {
  const resposta = await fetch(caminho);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401) throw new Error("Chave da API inválida (.env).");
    if (resposta.status === 502) throw new Error("API fora do ar.");
    throw new Error(dados.detail || `Erro ${resposta.status}.`);
  }
  return dados;
}

async function carregarCidades() {
  try {
    const cidades = await buscarApi("/api/v1/cities");
    seletor.innerHTML = "";
    if (cidades.length === 0) {
      mensagem.textContent = "Nenhuma cidade analisada.";
      return;
    }
    for (const cidade of cidades) {
      const opcao = document.createElement("option");
      opcao.value = cidade.id;
      opcao.textContent = cidade.name;
      seletor.appendChild(opcao);
    }
    seletor.disabled = false;
    carregarResultado(seletor.value);
  } catch (erro) {
    seletor.innerHTML = "<option>–</option>";
    mensagem.textContent = erro.message;
  }
}

async function carregarResultado(cidadeId) {
  mensagem.textContent = "Carregando...";
  resultado.hidden = true;
  try {
    // As duas consultas saem ao mesmo tempo.
    const [dados, analises] = await Promise.all([
      buscarApi(`/api/v1/cities/${cidadeId}/latest`),
      buscarApi(`/api/v1/cities/${cidadeId}/executions`),
    ]);
    mostrar(dados, analises);
    mensagem.textContent = "";
    resultado.hidden = false;
  } catch (erro) {
    mensagem.textContent = erro.message;
  }
}

// ---------- Página ----------

function mostrar(dados, analises) {
  const pop = dados.population_report;   // contando pessoas
  const esq = dados.node_report;         // contando esquinas
  const total = pop.total_weight;        // total de moradores

  // Resumo
  escrever("geral", porcento(pop.overall_coverage_percentage));
  escrever("geral-pessoas", `${numero((pop.overall_coverage_percentage / 100) * total)} pessoas`);
  escrever("sem-caminho", porcento(pop.overall_unreachable_percentage));
  escrever("sem-caminho-pessoas", `${numero((pop.overall_unreachable_percentage / 100) * total)} pessoas`);
  escrever("moradores", numero(total));
  escrever("esquinas", numero(esq?.total_weight));

  // Por serviço
  const tabela = document.getElementById("tabela");
  tabela.innerHTML = "";
  for (const [codigo, nome] of Object.entries(CATEGORIAS)) {
    const cat = pop.categories[codigo];
    if (!cat) continue;
    tabela.appendChild(linha([
      nome,
      porcento(cat.coverage_percentage),
      numero(cat.within_threshold_weight),
      minutos(cat.mean_travel_time_minutes),
      minutos(cat.median_travel_time_minutes),
      numero(cat.unreachable_weight),
      porcento(esq?.categories[codigo]?.coverage_percentage),
    ]));
  }

  // Histórico de análises
  const historico = document.getElementById("historico");
  historico.innerHTML = "";
  for (const ex of analises) {
    historico.appendChild(linha([
      ex.id,
      new Date(ex.processed_at).toLocaleString("pt-BR"),
      `${ex.speed_kmh} km/h`,
      `${ex.threshold_minutes} min`,
      ex.execution_time_seconds ? `${Math.round(ex.execution_time_seconds)} s` : "–",
    ]));
  }
}

seletor.addEventListener("change", () => carregarResultado(seletor.value));
carregarCidades();
