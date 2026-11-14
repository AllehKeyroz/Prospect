const fs = require('fs');
const AUTH = 'Basic ' + Buffer.from('YggdBLfdninEJX9:').toString('base64');
const BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav';

async function propfind(path, depth = '1') {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PROPFIND',
    headers: { Authorization: AUTH, Depth: depth, 'Cache-Control': 'no-cache' },
  });
  const xml = await res.text();
  const entries = [];
  const re = /<d:response>([\s\S]*?)<\/d:response>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const href = (block.match(/<d:href>([^<]+)<\/d:href>/) || [])[1] || '';
    const size = Number((block.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/) || [])[1] || 0);
    const modified = (block.match(/<d:getlastmodified>([^<]+)<\/d:getlastmodified>/) || [])[1] || '';
    const etag = (block.match(/<d:getetag>([^<]+)<\/d:getetag>/) || [])[1] || '';
    const type = (block.match(/<d:getcontenttype>([^<]+)<\/d:getcontenttype>/) || [])[1] || '';
    const isDir = /<d:collection\/>/.test(block);
    entries.push({ href, name: decodeURIComponent(href.split('/').filter(Boolean).pop() || ''), isDir, size, modified, etag, type });
  }
  return entries;
}

(async () => {
  const root = await propfind('');
  const months = root.filter(e => e.isDir && /^\d{4}-\d{2}$/.test(e.name)).map(e => e.name).sort();
  const latest = months[months.length - 1];
  const files = await propfind(`${latest}/`);
  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9',
    webdav: BASE,
    latest_snapshot: latest,
    months_available: months,
    months_count: months.length,
    latest_folder_modified: root.find(e => e.name === latest)?.modified,
    files: files.filter(f => !f.isDir && f.name).map(f => ({
      name: f.name, size_bytes: f.size, size_mb: +(f.size / 1048576).toFixed(2),
      modified: f.modified, etag: f.etag.replace(/&quot;/g, ''),
    })),
    total_size_bytes: files.filter(f => !f.isDir && f.name).reduce((a, b) => a + b.size, 0),
  };
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/source_manifest.json', JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    latest, months_count: months.length, first: months[0],
    folder_modified: manifest.latest_folder_modified,
    files: manifest.files.length,
    total_gb: +(manifest.total_size_bytes / 1073741824).toFixed(2),
    has_november: months.includes('2026-11'),
  }, null, 2));
  console.log('Arquivos:', manifest.files.map(f => `${f.name} (${f.size_mb} MB)`).join(', '));
})();
