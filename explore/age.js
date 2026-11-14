// Amostra a distribuição de idade das empresas no snapshot atual (sequencial, com retry).
const zlib = require('zlib');
const AUTH = 'Basic ' + Buffer.from('YggdBLfdninEJX9:').toString('base64');
const BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10';
const SAMPLE = 4 * 1024 * 1024;
const CUTOFF = '20231114';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseDate(s) {
  if (!s || s === '0' || s === '00000000' || s.length !== 8) return null;
  return s;
}

async function fetchRange(f, attempt = 1) {
  try {
    const r = await fetch(`${BASE}/${f}`, { headers: { Authorization: AUTH, Range: `bytes=0-${SAMPLE - 1}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (attempt >= 4) throw e;
    await sleep(1500 * attempt);
    return fetchRange(f, attempt + 1);
  }
}

(async () => {
  let total = 0, older3y = 0, active = 0, closed = 0;
  let minStart = '99999999', maxStart = '00000000';
  let minClose = '99999999';
  const decades = { '<=1989': 0, '1990-1999': 0, '2000-2009': 0, '2010-2019': 0, '2020-2022': 0, '2023+': 0, 'sem data': 0 };
  const situacoes = {};
  let closedPre2023 = 0;

  for (let i = 0; i < 10; i++) {
    const f = `Estabelecimentos${i}.zip`;
    const b = await fetchRange(f);
    const nl = b.readUInt16LE(26), el = b.readUInt16LE(28), st = 30 + nl + el;
    let inf;
    try { inf = zlib.inflateRawSync(b.subarray(st), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
    catch (e) { console.log(f, 'erro', e.message); continue; }

    for (const line of inf.toString('latin1').split('\n')) {
      if (!line) continue;
      const c = line.split(';').map(x => x.replace(/^"|"$/g, ''));
      if (c.length < 11) continue;
      const situacao = c[5];
      const dataSituacao = parseDate(c[6]);
      const dataInicio = parseDate(c[10]);
      total++;
      situacoes[situacao] = (situacoes[situacao] || 0) + 1;
      if (situacao === '02') active++;
      if (situacao === '08') {
        closed++;
        if (dataSituacao && dataSituacao < '20230101') closedPre2023++;
        if (dataSituacao && dataSituacao < minClose) minClose = dataSituacao;
      }
      if (dataInicio) {
        if (dataInicio < minStart) minStart = dataInicio;
        if (dataInicio > maxStart) maxStart = dataInicio;
        if (dataInicio < CUTOFF) older3y++;
        const y = +dataInicio.slice(0, 4);
        if (y <= 1989) decades['<=1989']++;
        else if (y <= 1999) decades['1990-1999']++;
        else if (y <= 2009) decades['2000-2009']++;
        else if (y <= 2019) decades['2010-2019']++;
        else if (y <= 2022) decades['2020-2022']++;
        else decades['2023+']++;
      } else {
        decades['sem data']++;
      }
    }
    await sleep(300);
  }

  console.log(JSON.stringify({
    amostra_linhas: total,
    pct_abertura_antes_2023_11: +(older3y / total * 100).toFixed(1),
    pct_ativos: +(active / total * 100).toFixed(1),
    pct_baixados: +(closed / total * 100).toFixed(1),
    baixados_antes_2023: closedPre2023,
    data_abertura_min: minStart,
    data_abertura_max: maxStart,
    data_baixa_mais_antiga: minClose,
    decadas: decades,
    situacoes,
  }, null, 2));
})();
