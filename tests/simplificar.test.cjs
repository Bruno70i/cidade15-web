const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contexto = { window: {}, Math, Uint8Array };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../simplificar.js"), "utf8"), contexto);
const { anel, feature } = contexto.window.Simplificar;

test("tira pontos quase em linha reta e mantem os cantos e o fechamento do anel", () => {
  // Quadrado de 1 grau com 9 pontos extras quase na borda de baixo.
  const pontos = [[0, 0], ...Array.from({ length: 9 }, (_, i) => [(i + 1) / 10, 0.0001 * (i % 2)]), [1, 0], [1, 1], [0, 1], [0, 0]];
  const saida = anel(pontos, 0.01);
  assert.equal(saida.length, 5);
  assert.deepEqual(saida[0], saida.at(-1));
  assert.ok(saida.some(([x, y]) => x === 1 && y === 1));
});

test("anel pequeno demais continua com pelo menos 4 pontos", () => {
  const triangulo = [[0, 0], [0.0001, 0], [0, 0.0001], [0, 0]];
  assert.equal(anel(triangulo, 1).length, 4);
});

test("feature mantem o tipo, as propriedades e simplifica todos os poligonos", () => {
  const quadrado = [[0, 0], [0.5, 0.00001], [1, 0], [1, 1], [0, 1], [0, 0]];
  const original = { type: "Feature", properties: { city_id: 7 }, geometry: { type: "MultiPolygon", coordinates: [[quadrado], [quadrado]] } };
  const saida = feature(original, 0.01);
  assert.equal(saida.geometry.type, "MultiPolygon");
  assert.equal(saida.properties.city_id, 7);
  assert.equal(saida.geometry.coordinates[1][0].length, 5);
  assert.equal(original.geometry.coordinates[0][0].length, 6, "nao altera o original");
});
