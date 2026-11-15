const token = new URLSearchParams(location.search).get('token') ?? localStorage.getItem('prospect-admin-token') ?? '';
if (token) localStorage.setItem('prospect-admin-token', token);

const headers = token ? { 'x-admin-token': token } : {};

const el = (id) => document.getElementById(id);

function num(value) {
  return Number(value ?? 0).toLocaleString('pt-BR');
}

function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Number(value ?? 0);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

let logCursor = 0;
let currentJobId = null;

async function loadOverview() {
  try {
    const response = await fetch('/api/admin/overview', { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    el('db').textContent = 'sem resposta';
    el('db').className = 'pill bad';
    el('log').textContent = `Falha ao consultar /api/admin/overview: ${error.message}`;
  }
}

function render(data) {
  const db = el('db');
  db.textContent = data.db_ready ? 'Postgres conectado' : 'Postgres sem conexão';
  db.className = `pill ${data.db_ready ? 'ok' : 'bad'}`;

  const labels = {
    empresas: 'empresas',
    estabelecimentos: 'estabelecimentos',
    socios: 'sócios',
    simples: 'Simples/MEI',
    estabelecimentos_busca: 'busca',
    rede_contatos: 'contatos',
  };
  el('counts').innerHTML = Object.entries(labels)
    .map(([key, label]) => `<div class="stat"><b>${num(data.counts?.[key])}</b><span>${label}</span></div>`)
    .join('');

  const meta = data.meta ?? {};
  el('meta').textContent = data.db_ready
    ? `snapshot ${meta.snapshot ?? data.snapshot} · gerado ${meta.generated_at ?? '—'}`
    : 'O app não conseguiu conectar no Postgres. Confira a DATABASE_URL do serviço.';

  const files = data.files ?? [];
  const ready = files.filter((file) => file.ready).length;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  el('files-label').textContent = `${ready} de ${data.files_expected ?? 37} arquivos prontos`;
  el('files-size').textContent = bytes(total);
  el('files-bar').style.width = `${Math.min(100, (ready / (data.files_expected ?? 37)) * 100)}%`;

  const job = data.job;
  const running = Boolean(data.running);
  document.querySelectorAll('button[data-kind]').forEach((button) => {
    button.disabled = running;
  });

  if (job) {
    el('jobst').textContent = job.status === 'running' ? 'carga em andamento' : `última: ${job.status}`;
    el('jobst').className = `pill ${job.status === 'running' ? '' : job.status === 'success' ? 'ok' : 'bad'}`;
    el('job-label').textContent = `${job.kind} · ${job.status}${job.message ? ` · ${job.message}` : ''}`;
    el('job-time').textContent = job.started_at ? new Date(job.started_at).toLocaleString('pt-BR') : '';

    if (job.id !== currentJobId) {
      currentJobId = job.id;
      logCursor = 0;
      el('log').textContent = '';
    }
    void loadLogs(job.id);
  } else {
    el('jobst').textContent = 'sem carga';
    el('jobst').className = 'pill';
  }
}

async function loadLogs(jobId) {
  try {
    const response = await fetch(`/api/admin/jobs/${jobId}/logs?after=${logCursor}`, { headers });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.logs?.length) return;

    const box = el('log');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    const text = data.logs.map((entry) => entry.line).join('\n');
    box.textContent += `${box.textContent ? '\n' : ''}${text}`;
    logCursor = Number(data.logs[data.logs.length - 1].id);
    if (atBottom) box.scrollTop = box.scrollHeight;
  } catch {
    // silencioso: o polling tenta de novo
  }
}

async function startJob(kind) {
  const response = await fetch('/api/admin/jobs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(data.error ?? `Falha ao iniciar (${response.status})`);
    return;
  }
  currentJobId = data.id;
  logCursor = 0;
  el('log').textContent = '';
  void loadOverview();
}

document.querySelectorAll('button[data-kind]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.kind;
    const labels = {
      migrate: 'aplicar as migrações',
      download: 'baixar e extrair o snapshot',
      load: 'carregar no Postgres',
      all: 'baixar, extrair e carregar',
    };
    if (confirm(`Confirmar: ${labels[kind]}?`)) void startJob(kind);
  });
});

void loadOverview();
setInterval(loadOverview, 4000);
