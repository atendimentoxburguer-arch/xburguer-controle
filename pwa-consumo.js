(function(){
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',async()=>{
    try{
      const reg=await navigator.serviceWorker.register('/xburguer-controle/sw-consumo.js?v=1',{scope:'/xburguer-controle/',updateViaCache:'none'});
      reg.update().catch(()=>{});
    }catch(err){console.warn('PWA Consumo:',err)}
  });
})();
