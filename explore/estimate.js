// Estima linhas e tamanho descomprimido de cada arquivo a partir de uma amostra de 8 MB.
const zlib = require('zlib');

const BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
const AUTH = 'Basic ' + Buffer.from('YggdBLfdninEJX9:').toString('base64');
const SAMPLE = 8 * 1024 * 1024;

async function stat(file) {
  const res = await fetch(`${BASE}/${file}`, {
    method: 'PROPFIND',
    headers: { Authorization: AUTH, Depth: '0' },
  });
  const xml = await res.text();
  const len = Number((xml.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/) || [])[1] || 0);
  const mod = (xml.match(/<d:getlastmodified>([^<]+)</) || [])[1] || '';
  const etag = (xml.match(/<d:getetag>([^<]+)</) || [])[1] || '';
  return { len, mod, etag };
}

async function estimate(file) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${file}`, {
    headers: { Authorization: AUTH, Range: `bytes=0-${SAMPLE - 1}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const elapsed = (Date.now() - t0) / 1000;
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  let inflated;
  try {
    inflated = zlib.inflateRawSync(buf.subarray(start), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  } catch (e) {
    return { file, error: e.message };
  }
  const dataBytes = buf.length - start;
  const lines = inflated.reduce((n, b) => n + (b === 10 ? 1 : 0), 0);
  const rowsPerCompByte = lines / dataBytes;
  const ratio = inflated.length / dataBytes;
  // tamanho comprimido real da 1a entrada
  let compSize = buf.readUInt32LE(18);
  if (compSize === 0xffffffff) compSize = Number((await stat(file)).len);
  // para entradas grandes (>4GB) o campo e 0xFFFFFFFF; usamos tamanho do zip como aproximacao
  const st = await stat(file);
  const zipSize = st.len;
  return {
    file,
    zipMB: +(zipSize / 1048576).toFixed(1),
    sampleInflatedMB: +(inflated.length / 1048576).toFixed(1),
    ratio: +ratio.toFixed(2),
    estUncompressedGB: +((zipSize * ratio) / 1073741824).toFixed(2),
    estRowsM: +((zipSize * rowsPerCompByte) / 1e6).toFixed(2),
    mbps: +(buf.length / 1048576 / elapsed).toFixed(1),
    modified: st.mod,
  };
}

(async () => {
  const files = [];
  for (let i = 0; i <= 9; i++) files.push(`Empresas${i}.zip`);
  for (let i = 0; i <= 9; i++) files.push(`Estabelecimentos${i}.zip`);
  for (let i = 0; i <= 9; i++) files.push(`Socios${i}.zip`);
  files.push('Simples.zip');

  const out = [];
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const f = files[i++];
      try { out.push(await estimate(f)); } catch (e) { out.push({ file: f, error: e.message }); }
    }
  }
  await Promise.all([worker(), worker()]);
  console.log(JSON.stringify(out, null, 2));

  const sum = (k) => out.reduce((a, b) => a + (b[k] || 0), 0);
  console.log('\nTOTAL estimado: GB descomprimidos=', sum('estUncompressedGB').toFixed(1),
    '| linhas=', sum('estRowsM').toFixed(1), 'M');
})();
