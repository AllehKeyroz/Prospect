const zlib=require('zlib');
const AUTH='Basic '+Buffer.from('YggdBLfdninEJX9:').toString('base64');
const BASE='https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
(async()=>{
 for (const f of ['Empresas1.zip','Estabelecimentos1.zip','Socios1.zip']) {
  const r=await fetch(`${BASE}/${f}`,{headers:{Authorization:AUTH,Range:'bytes=0-1048575'}});
  const b=Buffer.from(await r.arrayBuffer());
  const nl=b.readUInt16LE(26), el=b.readUInt16LE(28), st=30+nl+el;
  let inf; try{inf=zlib.inflateRawSync(b.subarray(st),{finishFlush:zlib.constants.Z_SYNC_FLUSH});}catch(e){console.log(f,'err',e.message);continue;}
  const lines=inf.toString('latin1').split('\n').filter(Boolean).slice(0,3);
  console.log(`\n### ${f}`); lines.forEach(l=>console.log(l.slice(0,180)));
 }
})().catch(e=>console.log('ERRO',e.message));
