const zlib=require('zlib');
const AUTH='Basic '+Buffer.from('YggdBLfdninEJX9:').toString('base64');
const BASE='https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
(async()=>{
 for(let i=0;i<10;i++){
  const f=`Estabelecimentos${i}.zip`;
  const r=await fetch(`${BASE}/${f}`,{headers:{Authorization:AUTH,Range:'bytes=0-2097151'}});
  const b=Buffer.from(await r.arrayBuffer());
  const nl=b.readUInt16LE(26), el=b.readUInt16LE(28), st=30+nl+el;
  let inf; try{inf=zlib.inflateRawSync(b.subarray(st),{finishFlush:zlib.constants.Z_SYNC_FLUSH});}catch(e){console.log(f,'err',e.message);continue;}
  const lines=inf.toString('latin1').split('\n').slice(0,2000).filter(Boolean);
  const nonNumeric=lines.filter(l=>{const m=l.match(/^"([^"]*)";"([^"]*)";"([^"]*)"/);return m && (!/^\d+$/.test(m[1])||!/^\d+$/.test(m[2]));});
  console.log(f,'| 1a base:',lines[0]?.slice(0,30),'| linhas amostra:',lines.length,'| base/ordem n?o num?rica:',nonNumeric.length, nonNumeric[0]?.slice(0,80)||'');
 }
})().catch(e=>console.log('ERRO',e.message));
