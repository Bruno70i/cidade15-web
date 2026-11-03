const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function create(options, indexedDB) {
  const context={window:{indexedDB},Map,Promise,Date,JSON};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../browser-cache.js'),'utf8'),context);
  return context.window.CityCache.create(options);
}
test('cache funciona em memoria se o navegador bloquear IndexedDB',async()=>{
  const cache=create({}, {open(){throw new Error('Armazenamento bloqueado');}});
  await cache.set('test',{id:1});
  assert.equal((await cache.get('test')).id,1);
});
test('respostas expiradas nao sao apresentadas como atuais',async()=>{
  let now=1000;const cache=create({now:()=>now});
  await cache.set('test',{id:1});now+=100;
  assert.equal(await cache.get('test',100),null);
});
test('cache descarta o item menos recente ao atingir o limite',async()=>{
  const cache=create({maxEntries:2});
  await cache.set('old',{id:1});await cache.set('recent',{id:2});
  await cache.get('old');await cache.set('new',{id:3});
  assert.equal(await cache.get('recent'),null);
  assert.equal((await cache.get('old')).id,1);
});
test('cache respeita o limite em bytes e ignora respostas grandes demais',async()=>{
  const cache=create({maxBytes:50});
  await cache.set('first',{text:'1234567890'});
  await cache.set('second',{text:'abcdefghij'});
  assert.equal(await cache.get('first'),null);
  await cache.set('oversized',{text:'a'.repeat(100)});
  assert.equal(await cache.get('oversized'),null);
  assert.equal((await cache.get('second')).text,'abcdefghij');
});
