const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(width, height) {
  let size = {x:width, y:height}, zoom, center, bounds;
  const map = {
    getSize:()=>size,
    getZoom:()=>zoom,
    setMinZoom(value) { this.minZoom=value; if (zoom < value) zoom=value; },
    setMaxBounds(value) { bounds=value; },
    setView(value, level) { center=value; zoom=level; },
  };
  const context={window:{},Math,Number};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../map-viewport.js'),'utf8'),context);
  return {map,viewport:context.window.CityMapViewport,resize:(w,h)=>{size={x:w,y:h};},get bounds(){return bounds;},get center(){return center;}};
}

test('o mapa cobre a altura de telas largas, celulares e tablets sem faixas vazias',()=>{
  for (const [width,height] of [[1900,900],[1440,900],[390,844],[844,390],[768,1024],[320,568]]) {
    const state=setup(width,height);
    state.viewport.showWorld(state.map);
    const worldSize=256*2**state.map.getZoom();
    assert.ok(worldSize >= height+2, `${width}x${height}: a imagem precisa cobrir a tela`);
    assert.ok(worldSize < (height+2)*2**0.25, 'sem aproximar mais do que o necessario');
    assert.ok(state.bounds[1][1]*worldSize/360 > width+worldSize, 'limite lateral permite atravessar o mundo');
    assert.equal(state.bounds[0][0],-85.05112878);
    assert.equal(state.bounds[1][0],85.05112878);
  }
});

test('redimensionar preserva a cidade e o zoom escolhidos',()=>{
  const state=setup(1440,900);
  state.viewport.showWorld(state.map);
  state.map.setView([-23.96,-46.33],13);
  state.resize(390,844);
  state.viewport.resize(state.map);
  assert.deepEqual(state.center,[-23.96,-46.33]);
  assert.equal(state.map.getZoom(),13);
  state.resize(1440,1200);
  state.viewport.resize(state.map);
  assert.equal(state.map.getZoom(),13);
});

test('uma tela inicialmente oculta aguarda dimensoes validas',()=>{
  const state=setup(0,0);
  state.viewport.showWorld(state.map);
  assert.equal(state.map.getZoom(),undefined);
  state.resize(390,844);
  state.viewport.resize(state.map);
  assert.ok(256*2**state.map.getZoom() >= 846);
});
