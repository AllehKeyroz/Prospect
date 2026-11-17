const token = new URLSearchParams(location.search).get('token') ?? localStorage.getItem('prospect-admin-token') ?? '';
if (token) localStorage.setItem('prospect-admin-token', token);

const headers = token ? { 'x-admin-token': token } : {};

const el = (id) => document.getElementById(id);

const LABELS = {
  empresas: 'empresas',
  estabelecimentos: 'estabelecimentos',
  socios: 'sócios',
  simples: 'Simples/MEI',
  estabelecimentos_busca: 'busca',
  rede_contatos: 'contatos',
};

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
let logSource = null;
let currentJobId = null;

async function loadOverview() {
  try {
    const response = await fetch('/api/admin/overview', { headers });
    if (response.status === 401) {
      el('db').textContent = 'token necessário';
      el('db').className = 'pill bad';
      el('log').textContent =
        'ADMIN_TOKEN está definido. Abra /admin?token=SEU_TOKEN (o valor fica salvo no navegador).';
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    el('db').textContent = 'sem resposta';
    el('db').className = 'pill bad';
    el('log').textContent = `Falha ao consultar /api/admin/overview: ${error.message}`;
  }
}

function renderCounts(container, counts) {
  container.innerHTML = Object.entries(LABELS)
    .map(([key, label]) => `<div class="stat"><b>${num(counts?.[key])}</b><span>${label}</span></div>`)
    .join('');
}

function render(data) {
  const duck = data.duckdb ?? {};
  const pg = data.postgres ?? {};
  const ready = Boolean(duck.ready);

  const db = el('db');
  db.textContent = ready
    ? `App pronto${duck.counts?.estabelecimentos ? ` · ${num(duck.counts.estabelecimentos)} estab.` : ''}`
    : 'App sem base';
  db.className = `pill ${ready ? 'ok' : 'bad'}`;

  const pgPill = el('pg');
  pgPill.textContent = pg.ready ? 'Postgres ok' : pg.configured ? 'Postgres sem conexão' : 'Postgres opcional';
  pgPill.className = `pill ${pg.ready ? 'ok' : ''}`;

  renderCounts(el('counts'), ready ? duck.counts : {});
  renderCounts(el('pg-counts'), pg.ready ? pg.counts : {});

  if (ready) {
    const meta = duck.meta ?? {};
    el('meta').textContent = `snapshot ${meta.snapshot ?? data.snapshot} · gerado ${meta.generated_at ?? '—'} · ${bytes(duck.bytes)}`;
  } else {
    el('meta').textContent = `Sem base utilizável: ${duck.reason ?? 'arquivo ausente'}. Carregue a amostra abaixo.`;
  }
  el('paths').textContent = `DuckDB: ${duck.path ?? '—'}`;

  if (pg.ready) {
    const meta = pg.meta ?? {};
    el('pg-meta').textContent = `Conectado · snapshot ${meta.snapshot ?? '—'} · gerado ${meta.generated_at ?? '—'}`;
  } else if (pg.configured) {
    el('pg-meta').textContent = 'DATABASE_URL configurada, mas o Postgres não respondeu. O app continua funcionando com o DuckDB.';
  } else {
    el('pg-meta').textContent = 'Sem DATABASE_URL. O app não precisa do Postgres para funcionar.';
  }

  const files = data.files ?? [];
  const readyFiles = files.filter((file) => file.ready).length;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  el('files-label').textContent = `${readyFiles} de ${data.files_expected ?? 37} arquivos prontos`;
  el('files-size').textContent = bytes(total);
  el('files-bar').style.width = `${Math.min(100, (readyFiles / (data.files_expected ?? 37)) * 100)}%`;

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
      logSource = null;
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

    if (data.source !== logSource) {
      logSource = data.source;
      logCursor = 0;
    }
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
  logSource = null;
  el('log').textContent = '';
  void loadOverview();
}

document.querySelectorAll('button[data-kind]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.kind;
    const labels = {
      sample: 'carregar a amostra no DuckDB (a base que o app usa)',
      snapshot: 'baixar ~7 GB, extrair ~26 GB e carregar o snapshot no DuckDB',
      migrate: 'aplicar as migrações no Postgres',
      download: 'baixar e extrair o snapshot (sem carregar)',
      load: 'carregar os CSVs extraídos no Postgres',
    };
    if (confirm(`Confirmar: ${labels[kind]}?`)) void startJob(kind);
  });
});

el('reload-base').addEventListener('click', async () => {
  const response = await fetch('/api/admin/reload', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{}',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(data.error ?? `Falha ao recarregar (${response.status})`);
    return;
  }
  alert(data.ready ? 'Base recarregada; o app já está respondendo.' : `Ainda sem base: ${data.reason ?? 'motivo desconhecido'}`);
  void loadOverview();
});

void loadOverview();
setInterval(loadOverview, 4000);
