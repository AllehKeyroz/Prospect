// Lê apenas os primeiros bytes de um ZIP remoto (range request) e infla a 1ª entrada.
const zlib = require('zlib');

const BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
const AUTH = 'Basic ' + Buffer.from('YggdBLfdninEJX9:').toString('base64');

async function peek(file) {
  const url = `${BASE}/${file}`;
  const res = await fetch(url, {
    headers: { Authorization: AUTH, Range: 'bytes=0-8388607' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`\n===== ${file} (HTTP ${res.status}, ${buf.length} bytes) =====`);

  if (buf.readUInt32LE(0) !== 0x04034b50) {
    console.log('Sem assinatura de ZIP local header');
    return;
  }
  const flags = buf.readUInt16LE(6);
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.toString('latin1', 30, 30 + nameLen);
  const dataStart = 30 + nameLen + extraLen;
  console.log({ name, method, flags, compSize, dataStart });

  try {
    const inflated = zlib.inflateRawSync(buf.subarray(dataStart), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    });
    const text = inflated.toString('latin1');
    console.log(text.split('\n').slice(0, 6).join('\n'));
  } catch (e) {
    console.log('inflate error:', e.message);
  }
}

(async () => {
  for (const f of ['Empresas0.zip', 'Estabelecimentos0.zip', 'Socios0.zip', 'Simples.zip']) {
    try { await peek(f); } catch (e) { console.log(f, 'ERRO', e.message); }
  }
})();
