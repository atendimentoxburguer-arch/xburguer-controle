/* Compatibilidade com versões antigas do X-Burguer Consumo. */
(function(){
  if(!('serviceWorker' in navigator))return;

  window.addEventListener('load',async()=>{
    const expectedScope=new URL('/xburguer-controle/',location.origin).href;
    const expectedScriptPath='/xburguer-controle/service-worker.js';

    try{
      const registrations=await navigator.serviceWorker.getRegistrations();

      for(const old of registrations){
        if(old.scope!==expectedScope)continue;

        const scriptUrl=
          old.active?.scriptURL ||
          old.waiting?.scriptURL ||
          old.installing?.scriptURL ||
          '';

        if(scriptUrl && new URL(scriptUrl).pathname!==expectedScriptPath){
          await old.unregister();
        }
      }

      const reg=await navigator.serviceWorker.register(
        '/xburguer-controle/service-worker.js?v=4.5.1',
        {scope:'/xburguer-controle/',updateViaCache:'none'}
      );

      await reg.update().catch(()=>{});
      await navigator.serviceWorker.ready.catch(()=>{});
    }catch(err){
      console.warn('PWA Consumo:',err);
    }
  });
})();
