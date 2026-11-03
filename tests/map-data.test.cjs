const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const execution = {id: 12, processed_at: '2026-11-02T12:00:00Z'};
const response = (value, status=200) => ({ok: status===200, status, headers:{get:name=>name==='Content-Type'?'application/json':null}, json:async()=>value});
const points = category => ({execution_id:12, category, nodes:[], services:[], limits:{nodes:1000, services:600}, totals:{nodes:0, services:0}});
function client(options) {
  const context = {window:{}, URLSearchParams, Number, Error, Map, Promise, Date, Math, AbortController, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../map-data.js'),'utf8'),context);
  return context.window.CityMapData.create(options);
}
function storage() {
  const rows=new Map();
  return {get:async key=>rows.get(key)??null, set:async(key,value)=>rows.set(key,value)};
}

test('consulta a amostra municipal inteira sem bbox', async()=>{
  let called;
  const api=client({fetchImpl:async url=>{called=url; return response(points('health'));},cache:storage()});
  await api.points(execution,'health');
  assert.equal(called,'/mapas/v1/executions/12/points?category=health');
});
test('areas fixas da cidade tem caches distintos e sao reutilizadas',async()=>{
  const calls=[];
  const api=client({cache:storage(),fetchImpl:async url=>{calls.push(url);return response(points('health'));}});
  await api.points(execution,'health');
  await api.points(execution,'health',[-47,-24,-46.5,-23.5]);
  await api.points(execution,'health',[-46.5,-24,-46,-23.5]);
  await api.points(execution,'health',[-47,-24,-46.5,-23.5]);
  assert.equal(calls.length,3);assert.equal(new URL('http://local'+calls[1]).searchParams.get('bbox'),'-47,-24,-46.5,-23.5');
});
test('deduplica consultas simultaneas e reutiliza o resultado',async()=>{
  let count=0;
  const api=client({fetchImpl:async()=>{count++;return response(points('health'));},cache:storage()});
  await Promise.all([api.points(execution,'health'),api.points(execution,'health')]);
  await api.points(execution,'health');
  assert.equal(count,1);
});
test('compartilha o cache entre clientes e invalida quando a execucao muda',async()=>{
  const cache=storage(); let count=0;
  const fetchImpl=async()=>{count++; return response(points('health'));};
  await client({fetchImpl,cache}).points(execution,'health');
  await client({fetchImpl,cache}).points(execution,'health');
  assert.equal(count,1);
  await client({fetchImpl,cache}).points({...execution,processed_at:'2026-11-03T12:00:00Z'},'health');
  assert.equal(count,2);
});
test('serializa categorias em vez de ocupar todas as vagas do servidor',async()=>{
  let active=0, peak=0;
  const api=client({cache:storage(),fetchImpl:async url=>{
    active++; peak=Math.max(active,peak);
    await new Promise(resolve=>setImmediate(resolve)); active--;
    return response(points(new URL('http://local'+url).searchParams.get('category')));
  }});
  await Promise.all(['health','education','food','culture'].map(code=>api.points(execution,code)));
  assert.equal(peak,1);
});
test('repete um servidor ocupado com espera limitada sem guardar o erro',async()=>{
  let calls=0; const waits=[];
  const api=client({cache:storage(),waitImpl:async ms=>waits.push(ms),fetchImpl:async()=>{
    calls++; return calls===1?response({detail:'Mapa ocupado'},503):response(points('health'));
  }});
  await api.points(execution,'health');
  await api.points(execution,'health');
  assert.equal(calls,2); assert.equal(waits.length,1); assert.ok(waits[0]>=500);
});
test('nao reutiliza resposta de outra execucao',async()=>{
  let calls=0;
  const api=client({cache:storage(),fetchImpl:async()=>{calls++;return response({...points('health'),execution_id:99});}});
  await assert.rejects(api.points(execution,'health'),/correspondem/);
  await assert.rejects(api.points(execution,'health'),/correspondem/);
  assert.equal(calls,2);
});
test('servidor ocupado tem numero limitado de tentativas e nao envenena o cache',async()=>{
  let calls=0, busy=true;
  const api=client({cache:storage(),waitImpl:async()=>{},fetchImpl:async()=>{calls++;return busy?response({detail:'Mapa ocupado'},503):response(points('health'));}});
  await assert.rejects(api.points(execution,'health'),/ocupado/);
  assert.equal(calls,3);
  busy=false;await api.points(execution,'health');assert.equal(calls,4);
});
test('falha de armazenamento nao impede consultar a amostra',async()=>{
  const api=client({cache:{get:async()=>{throw new Error('blocked');},set:async()=>{throw new Error('quota');}},fetchImpl:async()=>response(points('health'))});
  assert.equal((await api.points(execution,'health')).execution_id,12);
});
