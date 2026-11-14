// Compara schema (nº de colunas e 1ª linha) entre meses.
const zlib = require('zlib');
const AUTH = 'Basic ' + Buffer.from('YggdBLfdninEJX9:').toString('base64');
const SAMPLE = 4 * 1024 * 1024;

async function peek(folder, file) {
  const res = await fetch(`https://arquivos.receitafederal.gov.br/public.php/webdav/${folder}/${file}`, {
    headers: { Authorization: AUTH, Range: `bytes=0-${SAMPLE - 1}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`\n===== ${folder}/${file} (HTTP ${res.status}) =====`);
  if (buf.readUInt32LE(0) !== 0x04034b50) return console.log('não é zip');
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.toString('latin1', 30, 30 + nameLen);
  const start = 30 + nameLen + extraLen;
  const inf = zlib.inflateRawSync(buf.subarray(start), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const lines = inf.toString('latin1').split('\n').filter(Boolean).slice(0, 3);
  console.log('entrada:', name);
  lines.forEach((l, i) => {
    const cols = l.split(';').length;
    console.log(`linha ${i + 1} | colunas=${cols} | ${l.slice(0, 220)}`);
  });
}

(async () => {
  const jobs = [
    ['2023-05', 'Empresas0.zip'],
    ['2023-05', 'Estabelecimentos0.zip'],
    ['2023-05', 'Socios0.zip'],
    ['2023-05', 'Simples.zip'],
    ['2024-07', 'Empresas0.zip'],
    ['2024-07', 'Estabelecimentos0.zip'],
  ];
  for (const j of jobs) { try { await peek(...j); } catch (e) { console.log(j.join('/'), 'ERRO', e.message); } }
})();
