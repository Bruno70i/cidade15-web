"use strict";
(() => {
  function create({fetchImpl=(...args)=>fetch(...args), cache=window.CityCache?.create(), waitImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    const pending = new Map();
    let queue = Promise.resolve();
    const identity = execution => typeof execution === "object" ? execution : {id:execution};
    async function request(path) {
      for (let attempt=0; ; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(()=>controller.abort(),25000);
        try {
          const response=await fetchImpl(path,{cache:"no-store",signal:controller.signal});
          const isJson=(response.headers.get("Content-Type") || "").includes("application/json");
          const value=isJson ? await response.json().catch(()=>null) : null;
          if(!response.ok) {
            if ([429,502,503,504].includes(response.status) && attempt<2) {
              const retryAfter=Number(response.headers.get("Retry-After"))*1000;
              await waitImpl(Math.min(15000,Math.max(500,retryAfter || 1000*2**attempt+Math.random()*300)));
              continue;
            }
            throw new Error(value?.detail || "Não foi possível consultar o mapa. Tente novamente em instantes.");
          }
          if(value===null) throw new Error("Não foi possível consultar o mapa.");
          return value;
        } finally { clearTimeout(timeout); }
      }
    }
    function cached(key,path,valid) {
      if (!pending.has(key)) {
        const task=queue.then(async()=>{
          const stored=await cache?.get(key).catch(()=>null);
          if (stored && valid(stored)) return stored;
          const value=await request(path);
          if (!valid(value)) throw new Error("Os dados do mapa não correspondem à análise selecionada.");
          await cache?.set(key,value).catch(()=>{});
          return value;
        });
        pending.set(key,task);
        queue=task.catch(()=>{});
        task.finally(()=>pending.delete(key)).catch(()=>{});
      }
      return pending.get(key);
    }
    return {
      metadata(execution) {
        const ex=identity(execution);
        return cached(`map-v2:${ex.id}:${ex.processed_at || ""}:metadata`, `/mapas/v1/executions/${encodeURIComponent(ex.id)}`,
          value=>value.execution_id===ex.id && Array.isArray(value.bounds) && Array.isArray(value.center));
      },
      points(execution,category,bbox=null) {
        const ex=identity(execution);
        const query=new URLSearchParams({category});
        if (bbox) query.set("bbox",bbox.join(","));
        return cached(`map-v2:${ex.id}:${ex.processed_at || ""}:${category}${bbox ? `:area:${bbox.join(",")}` : ""}`, `/mapas/v1/executions/${encodeURIComponent(ex.id)}/points?${query}`,
          value=>value.execution_id===ex.id && value.category===category && Array.isArray(value.nodes) && Array.isArray(value.services));
      }
    };
  }
  window.CityMapData={create};
})();
