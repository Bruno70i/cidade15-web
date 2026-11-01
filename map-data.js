"use strict";
(() => {
  function create({fetchImpl=(...args)=>fetch(...args)}={}) {
    async function request(path,signal) {
      const response=await fetchImpl(path,{cache:"no-store",signal});
      const value=await response.json();
      if(!response.ok) throw new Error(value.detail || "Não foi possível consultar o mapa.");
      return value;
    }
    return {
      async metadata(executionId,signal) {
        const value=await request(`/mapas/v1/executions/${encodeURIComponent(executionId)}`,signal);
        if(value.execution_id!==executionId || !Array.isArray(value.bounds) || !Array.isArray(value.center)) throw new Error("Os dados do mapa não correspondem à análise selecionada.");
        return value;
      },
      async points(executionId,category,bbox,signal) {
        const query=new URLSearchParams({category});
        if(bbox) query.set("bbox",bbox.join(","));
        const value=await request(`/mapas/v1/executions/${encodeURIComponent(executionId)}/points?${query}`,signal);
        if(value.execution_id!==executionId || value.category!==category || !Array.isArray(value.nodes) || !Array.isArray(value.services)) throw new Error("Os dados do mapa não correspondem à análise selecionada.");
        return value;
      }
    };
  }
  window.CityMapData={create};
})();
