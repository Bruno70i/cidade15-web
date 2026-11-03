const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function vista(){const context={window:{},Intl,Number,Math};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../simulacao-vista.js'),'utf8'),context);return context.window.SimulacaoVista;}
const report={total_weight:287478,overall_coverage_percentage:1.346886,categories:{food:{coverage_percentage:62.681318},culture:{coverage_percentage:2.046417}}};
const population=(before,after)=>({population:{before:{coverage_percentage:before},after:{coverage_percentage:after}}});

test('alimentacao sem mudanca usa a mesma precisao antes e depois',()=>{
  const v=vista();const data=v.comparar(report,{results:{food:population(62.681318,62.681318)}},'food');
  assert.equal(v.percentual(data.antes),'62,68%');assert.equal(v.percentual(data.depois),'62,68%');
  assert.equal(data.pessoasAdicionais,undefined);assert.equal(data.variacao,0);
  assert.match(v.impacto(data).titulo,/Sem aumento/);
});
test('ganho apresenta somente a variacao percentual sem estimar pessoas',()=>{
  const v=vista();const data=v.comparar(report,{results:{culture:population(2.046417,3.386417)}},'culture');
  assert.equal(data.pessoasAntes,undefined);assert.equal(data.pessoasDepois,undefined);assert.equal(data.pessoasAdicionais,undefined);
  assert.equal(v.percentual(data.depois),'3,39%');
  assert.match(v.impacto(data).titulo,/1,34 pontos percentuais/);
  assert.doesNotMatch(v.impacto(data).titulo+v.impacto(data).detalhe,/pessoa|3\.852/);
  assert.equal(v.impacto(data).tipo,'ganho');
});
test('categorias ausentes no retorno preservam o acesso e perdas reais nao sao ocultadas',()=>{
  const v=vista();const unchanged=v.comparar(report,{results:{culture:population(2,3)}},'food');
  assert.equal(unchanged.antes,62.681318);assert.equal(unchanged.depois,62.681318);
  const loss=v.comparar({total_weight:1000,overall_coverage_percentage:50},{overall:population(50,49)},'overall');
  assert.equal(loss.pessoasAdicionais,undefined);assert.equal(loss.depois,49);
  assert.match(v.impacto(loss).titulo,/1 ponto percentual/);assert.equal(v.impacto(loss).tipo,'perda');
});
test('sem acesso explica categoria, minutos e cenario usando somente percentual',()=>{
  const v=vista();
  assert.equal(v.semAcesso({depois:3.62,simulado:true},'culture',15),'96,38% da população não conseguiria chegar a um espaço de cultura em até 15 minutos a pé, mesmo com os novos locais simulados.');
  assert.match(v.semAcesso({depois:25,simulado:false},'overall',20),/75%.*aos 4 tipos de serviço.*20 minutos/);
});
