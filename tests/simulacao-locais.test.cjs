const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function validator(points){const ctx={window:{},Math,Number,Error};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../simulacao-locais.js'),'utf8'),ctx);return ctx.window.SimulacaoLocais.criar({fonte:{points}});}
const execution={id:214};
const node={id:7,lat:-23.96,lon:-46.33};
const sample=(nodes,total=nodes.length)=>({nodes,totals:{nodes:total}});
test('posiciona o local em um no real verificado dentro de 250 metros',async()=>{
  let bbox;const v=validator(async(ex,code,area)=>{assert.equal(ex,execution);assert.equal(code,'culture');bbox=area;return sample([node]);});
  const result=await v.ajustar(execution,'culture',{lat:-23.9601,lng:-46.3301});
  assert.equal(result.lat,-23.96);assert.equal(result.lng,-46.33);assert.equal(result.nodeId,'7');
  assert.ok(result.distancia>14&&result.distancia<16);assert.equal(bbox.length,4);
});
test('recusa local sem no da analise proximo e nao usa apenas o mapa de fundo',async()=>{
  const v=validator(async()=>sample([{...node,lat:-24.1}]));
  await assert.rejects(v.ajustar(execution,'culture',{lat:-23.96,lng:-46.33}),error=>error.codigo==='fora-da-rede');
});
test('amostra truncada e subdividida para nao rejeitar uma rua omitida',async()=>{
  let calls=0;const v=validator(async()=>++calls===1?sample([{...node,lat:-24.1}],2000):sample([node]));
  const result=await v.ajustar(execution,'culture',{lat:-23.96,lng:-46.33});
  assert.equal(result.nodeId,'7');assert.equal(calls,2);
});
test('verificacao incompleta tem consultas limitadas e nao e tratada como ausencia de rua',async()=>{
  let calls=0;const v=validator(async()=>{calls++;return sample([],2000);});
  await assert.rejects(v.ajustar(execution,'culture',{lat:-23.96,lng:-46.33}),error=>error.codigo==='verificacao-incompleta');
  assert.equal(calls,5);
});
test('falha de consulta nao libera posicionamento nem afirma que a via nao existe',async()=>{
  const error=new Error('Mapa temporariamente indisponivel');
  const v=validator(async()=>{throw error;});
  await assert.rejects(v.ajustar(execution,'culture',{lat:-23.96,lng:-46.33}),error);
});
test('copia horizontal do mapa usa a longitude geografica da rede',async()=>{
  const v=validator(async()=>sample([node]));
  const result=await v.ajustar(execution,'culture',{lat:-23.96,lng:313.67});
  assert.equal(result.lng,-46.33);assert.ok(result.distancia<0.001);
});
test('coordenadas invalidas na resposta nao sao aceitas como pontos de via',async()=>{
  const v=validator(async()=>sample([{...node,lon:313.67}]));
  await assert.rejects(v.ajustar(execution,'culture',{lat:-23.96,lng:-46.33}),error=>error.codigo==='verificacao-incompleta');
});
