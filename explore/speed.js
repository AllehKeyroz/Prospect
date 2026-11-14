const AUTH='Basic '+Buffer.from('YggdBLfdninEJX9:').toString('base64');
const BASE='https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
(async()=>{
  const files=[]; for(let i=0;i<10;i++) files.push(`Estabelecimentos${i}.zip`);
  const t0=Date.now(); let total=0;
  await Promise.all(files.map(async f=>{
    const r=await fetch(`${BASE}/${f}`,{headers:{Authorization:AUTH,Range:'bytes=0-16777215'}});
    const b=Buffer.from(await r.arrayBuffer()); total+=b.length;
  }));
  const s=(Date.now()-t0)/1000;
  console.log(`10 conex?es | ${(total/1048576).toFixed(0)} MB em ${s.toFixed(1)}s | agregado ${(total/1048576/s).toFixed(1)} MB/s | por conex?o ${(total/1048576/s/10).toFixed(1)} MB/s`);
})();
