const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  pageSize: 25,
  totalPages: 0,
  options: null,
  loading: false,
};

const form = $('filters');
const resultsBody = $('results-body');

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtNumber(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR').format(Number.isFinite(number) ? number : 0);
}

function fmtMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(number);
}

function fmtDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return escapeHtml(value);
  return `${day}/${month}/${year}`;
}

function fmtPhone(ddd, phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  const prefix = ddd ? `(${String(ddd).padStart(2, '0')}) ` : '';
  if (digits.length === 9) return `${prefix}${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length === 8) return `${prefix}${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${prefix}${digits}`;
}

function situacaoChip(codigo, descricao) {
  const cls = {
    '02': 'chip-ativa',
    '08': 'chip-baixada',
    '04': 'chip-inapta',
    '03': 'chip-suspensa',
  }[codigo] || 'chip-outra';
  return `<span class="chip ${cls}">${escapeHtml(descricao || codigo || '—')}</span>`;
}

function buildFilterParams() {
  const data = new FormData(form);
  const params = new URLSearchParams();

  for (const [key, value] of data.entries()) {
    const text = String(value).trim();
    if (text === '') continue;
    params.set(key, text);
  }

  // Checkboxes só entram quando marcados; os booleanos da API aceitam "true".
  for (const id of ['simples', 'mei', 'com_email', 'com_telefone', 'matriz']) {
    if ($(id).checked) params.set(id, 'true');
  }

  return params;
}

function buildSearchParams() {
  const params = buildFilterParams();
  params.set('page', String(state.page));
  params.set('page_size', String(state.pageSize));
  params.set('sort', 'razao_social');
  params.set('order', 'asc');
  return params;
}

function updateUrl(params) {
  const url = new URL(window.location.href);
  url.search = params.toString();
  window.history.replaceState(null, '', url);
}

async function loadOptions() {
  const response = await fetch('/api/opcoes');
  if (!response.ok) throw new Error('Falha ao carregar opções');
  const options = await response.json();
  state.options = options;

  const uf = $('uf');
  for (const value of options.ufs ?? []) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    uf.appendChild(option);
  }

  const cnae = $('cnae');
  for (const item of options.cnaes ?? []) {
    const option = document.createElement('option');
    option.value = item.codigo;
    const description = String(item.descricao ?? '').slice(0, 90);
    option.textContent = `${item.codigo} — ${description}`;
    cnae.appendChild(option);
  }
}

async function loadMeta() {
  const response = await fetch('/api/meta');
  if (!response.ok) throw new Error('Falha ao carregar metadados');
  const meta = await response.json();
  $('snapshot-badge').textContent = `Snapshot ${meta.snapshot ?? '—'}`;
  $('rows-badge').textContent = `${fmtNumber(meta.estabelecimentos)} estabelecimentos`;
  $('note-snapshot').textContent = meta.snapshot ?? '2026-10';
}

function renderSummary(resumo) {
  $('sum-total').textContent = fmtNumber(resumo.total);
  $('sum-ativas').textContent = fmtNumber(resumo.ativas);
  $('sum-mais3').textContent = fmtNumber(resumo.mais_3_anos);
  $('sum-email').textContent = fmtNumber(resumo.com_email);
}

function renderTable(rows) {
  if (!rows.length) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty">
          Nenhuma empresa encontrada com esses filtros.<br />
          <span class="small">Tente remover a idade mínima, ampliar a UF ou limpar a busca.</span>
        </td>
      </tr>`;
    return;
  }

  resultsBody.innerHTML = rows
    .map((row) => {
      const situacao = situacaoChip(row.situacao, row.situacao_descricao);
      const company = row.razao_social
        ? escapeHtml(row.razao_social)
        : '<span class="muted">(sem razão social na amostra)</span>';
      const fantasy = row.nome_fantasia
        ? `<div class="fantasy">${escapeHtml(row.nome_fantasia)}</div>`
        : '';
      const cnae = row.cnae_principal
        ? `<div class="cnae">${escapeHtml(row.cnae_principal)}</div>
           <div class="cnae-desc">${escapeHtml(String(row.cnae_descricao ?? '').slice(0, 82))}</div>`
        : '<span class="muted">—</span>';
      const local = [row.uf, row.municipio_nome].filter(Boolean).map(escapeHtml).join(' · ') || '—';
      const abertura = row.data_inicio
        ? `${fmtDate(row.data_inicio)}${
            row.idade_anos !== null && row.idade_anos !== undefined
              ? `<div class="small muted">${escapeHtml(row.idade_anos)} anos</div>`
              : ''
          }`
        : '—';
      const contato = row.email
        ? `<div class="small" title="${escapeHtml(row.email)}">${escapeHtml(String(row.email).slice(0, 34))}</div>`
        : row.telefone1
          ? `<div class="small">${escapeHtml(fmtPhone(row.ddd1, row.telefone1))}</div>`
          : '<span class="muted">—</span>';

      return `
        <tr data-cnpj="${escapeHtml(row.cnpj)}">
          <td><span class="cnpj">${escapeHtml(row.cnpj_formatado || row.cnpj)}</span></td>
          <td><div class="company">${company}</div>${fantasy}</td>
          <td>${cnae}</td>
          <td>${local}</td>
          <td>${situacao}</td>
          <td>${abertura}</td>
          <td>${row.capital_social !== null && row.capital_social !== undefined ? fmtMoney(row.capital_social) : '—'}</td>
          <td>${contato}</td>
        </tr>`;
    })
    .join('');
}

function renderPagination(totalPages) {
  state.totalPages = totalPages;
  const html = `
    <button type="button" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>←</button>
    <span>Página ${state.page} de ${totalPages || 1}</span>
    <button type="button" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>→</button>
  `;
  $('pagination-top').innerHTML = html;
  $('pagination-bottom').innerHTML = html;

  for (const container of [$('pagination-top'), $('pagination-bottom')]) {
    container.querySelectorAll('button[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.page === 'prev' && state.page > 1) state.page--;
        if (button.dataset.page === 'next' && state.page < state.totalPages) state.page++;
        search({ resetPage: false });
      });
    });
  }
}

function renderStats(containerId, items, type) {
  const container = $(containerId);
  if (!items.length) {
    container.innerHTML = '<p class="muted small">Sem dados para os filtros atuais.</p>';
    return;
  }

  const max = Math.max(...items.map((item) => item.total), 1);
  container.innerHTML = items
    .map((item) => {
      const label = type === 'cnae'
        ? `${item.chave} — ${String(item.rotulo ?? '').slice(0, 38)}`
        : `${item.chave} — ${String(item.rotulo ?? '')}`;
      const width = Math.max(2, Math.round((item.total / max) * 100));
      return `
        <div class="stat" title="${escapeHtml(label)}">
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-value">${fmtNumber(item.total)}</div>
          <div class="stat-bar"><i style="width:${width}%"></i></div>
        </div>`;
    })
    .join('');
}

async function loadStats(type) {
  const params = buildFilterParams();
  params.set('group_by', type);
  params.set('limit', '8');
  const response = await fetch(`/api/estatisticas?${params.toString()}`);
  if (!response.ok) throw new Error('Falha ao carregar estatísticas');
  const data = await response.json();
  renderStats(type === 'cnae' ? 'stats-cnae' : 'stats-uf', data.data ?? [], type);
}

async function search({ resetPage = true } = {}) {
  if (state.loading) return;
  if (resetPage) state.page = 1;
  state.loading = true;

  const params = buildSearchParams();
  updateUrl(params);
  resultsBody.innerHTML = '<tr><td colspan="8" class="empty">Consultando a base…</td></tr>';
  $('result-info').textContent = 'Consultando…';

  try {
    const response = await fetch(`/api/empresas?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      resultsBody.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(payload.error ?? 'Erro na consulta')}</td></tr>`;
      $('result-info').textContent = 'Erro na consulta.';
      return;
    }

    renderSummary(payload.resumo ?? {});
    renderTable(payload.data ?? []);
    renderPagination(payload.total_pages ?? 0);

    const info = [
      `${fmtNumber(payload.total)} estabelecimentos`,
      payload.total > 0
        ? `exibindo ${fmtNumber((payload.page - 1) * payload.page_size + 1)}–${fmtNumber(
            Math.min(payload.page * payload.page_size, payload.total),
          )}`
        : null,
      `ordenado por razão social`,
    ].filter(Boolean);
    $('result-info').textContent = info.join(' · ');

    void Promise.allSettled([loadStats('cnae'), loadStats('uf')]);
  } catch (error) {
    console.error(error);
    resultsBody.innerHTML = '<tr><td colspan="8" class="empty">Erro ao consultar a base.</td></tr>';
    $('result-info').textContent = 'Erro ao consultar a base.';
  } finally {
    state.loading = false;
  }
}

function renderDetail(data) {
  const empresa = data.empresa ?? {};
  const primeiro = data.estabelecimentos?.[0] ?? {};
  const simples = data.simples ?? {};
  const title = empresa.razao_social || primeiro.razao_social || 'Empresa sem razão social na amostra';
  const cnpj = data.cnpj_formatado || data.cnpj_base || '';

  $('detail-title').textContent = title;
  $('detail-subtitle').innerHTML = `${escapeHtml(cnpj)} · ${escapeHtml(primeiro.municipio_nome ?? '')} ${
    primeiro.uf ? `/${escapeHtml(primeiro.uf)}` : ''
  }`;

  const tags = [];
  if (primeiro.matriz_filial_descricao) tags.push(primeiro.matriz_filial_descricao);
  if (primeiro.situacao_descricao) tags.push(primeiro.situacao_descricao);
  if (simples.opcao_simples === 'S') tags.push('Simples');
  if (simples.opcao_mei === 'S') tags.push('MEI');

  const boxes = [
    ['Natureza jurídica', empresa.natureza_descricao || empresa.natureza_juridica || '—'],
    ['Porte', empresa.porte_descricao || '—'],
    ['Capital social', fmtMoney(empresa.capital_social)],
    ['Abertura', fmtDate(primeiro.data_inicio)],
    ['Idade', primeiro.idade_anos !== null && primeiro.idade_anos !== undefined ? `${primeiro.idade_anos} anos` : '—'],
    ['CNAE principal', primeiro.cnae_principal ? `${primeiro.cnae_principal} — ${primeiro.cnae_descricao ?? ''}` : '—'],
    ['Endereço', [primeiro.tipo_logradouro, primeiro.logradouro, primeiro.numero, primeiro.complemento].filter(Boolean).join(' ') || '—'],
    ['Bairro / CEP', [primeiro.bairro, primeiro.cep].filter(Boolean).join(' · ') || '—'],
    ['Contato', [primeiro.email, fmtPhone(primeiro.ddd1, primeiro.telefone1)].filter(Boolean).join(' · ') || '—'],
  ];

  const detailGrid = boxes
    .map(
      ([label, value]) => `
        <div class="detail-box">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>`,
    )
    .join('');

  const estabelecimentos = (data.estabelecimentos ?? [])
    .map(
      (row) => `
        <tr>
          <td class="cnpj">${escapeHtml(row.cnpj_formatado || row.cnpj)}</td>
          <td>${escapeHtml(row.matriz_filial_descricao ?? '')}</td>
          <td>${situacaoChip(row.situacao, row.situacao_descricao)}</td>
          <td>${fmtDate(row.data_inicio)}</td>
          <td>${escapeHtml(row.cnae_principal ?? '')}<div class="small muted">${escapeHtml(row.cnae_descricao ?? '')}</div></td>
          <td>${escapeHtml([row.tipo_logradouro, row.logradouro, row.numero].filter(Boolean).join(' '))}<div class="small muted">${escapeHtml([row.bairro, row.municipio_nome, row.uf, row.cep].filter(Boolean).join(' · '))}</div></td>
          <td>${escapeHtml(row.email ?? '')}${row.telefone1 ? `<div class="small muted">${escapeHtml(fmtPhone(row.ddd1, row.telefone1))}</div>` : ''}</td>
        </tr>`,
    )
    .join('');

  const socios = (data.socios ?? [])
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.nome_socio ?? '')}</td>
          <td>${escapeHtml(row.qualificacao_socio_descricao ?? row.qualificacao_socio ?? '')}</td>
          <td>${fmtDate(row.data_entrada)}</td>
          <td class="cnpj">${escapeHtml(row.cpf_cnpj_socio ?? '')}</td>
          <td>${escapeHtml(row.faixa_etaria ?? '')}</td>
        </tr>`,
    )
    .join('');

  $('detail-content').innerHTML = `
    <div class="detail-grid">${detailGrid}</div>

    <div class="detail-section">
      <h3>Estabelecimentos (${(data.estabelecimentos ?? []).length})</h3>
      <table class="detail-table">
        <thead><tr><th>CNPJ</th><th>Tipo</th><th>Situação</th><th>Abertura</th><th>CNAE</th><th>Endereço</th><th>Contato</th></tr></thead>
        <tbody>${estabelecimentos || '<tr><td colspan="7" class="muted">Nenhum estabelecimento.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="detail-section">
      <h3>Sócios (${(data.socios ?? []).length})</h3>
      <table class="detail-table">
        <thead><tr><th>Nome</th><th>Qualificação</th><th>Entrada</th><th>CPF/CNPJ (mascarado)</th><th>Faixa etária</th></tr></thead>
        <tbody>${socios || '<tr><td colspan="5" class="muted">Nenhum sócio informado.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="detail-section">
      <h3>Simples / MEI</h3>
      <div class="detail-grid">
        <div class="detail-box"><div class="label">Simples</div><div class="value">${escapeHtml(simples.opcao_simples ?? 'Não informado')}</div></div>
        <div class="detail-box"><div class="label">Opção Simples</div><div class="value">${fmtDate(simples.data_opcao_simples)}</div></div>
        <div class="detail-box"><div class="label">MEI</div><div class="value">${escapeHtml(simples.opcao_mei ?? 'Não informado')}</div></div>
        <div class="detail-box"><div class="label">Opção MEI</div><div class="value">${fmtDate(simples.data_opcao_mei)}</div></div>
      </div>
    </div>
  `;

  const tagsHtml = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  $('detail-subtitle').innerHTML = `${escapeHtml(cnpj)} ${tagsHtml}`;
}

async function openDetail(cnpj) {
  const dialog = $('detail');
  $('detail-title').textContent = 'Carregando…';
  $('detail-subtitle').textContent = '';
  $('detail-content').innerHTML = '<p class="muted">Consultando ficha cadastral…</p>';
  dialog.showModal();

  try {
    const response = await fetch(`/api/cnpj/${encodeURIComponent(cnpj)}`);
    const data = await response.json();
    if (!response.ok) {
      $('detail-title').textContent = 'Erro';
      $('detail-content').innerHTML = `<div class="error-box">${escapeHtml(data.error ?? 'CNPJ não encontrado')}</div>`;
      return;
    }
    renderDetail(data);
  } catch (error) {
    console.error(error);
    $('detail-title').textContent = 'Erro';
    $('detail-content').innerHTML = '<div class="error-box">Falha ao consultar a ficha.</div>';
  }
}

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  state.page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  state.pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') ?? 25) || 25));

  const textFields = ['q', 'uf', 'cnae', 'situacao', 'porte', 'idade_min', 'capital_min'];
  for (const field of textFields) {
    if (params.has(field)) $(field).value = params.get(field);
  }
  if (!params.has('situacao')) $('situacao').value = '02';
  if (!params.has('idade_min')) $('idade_min').value = '3';

  for (const id of ['simples', 'mei', 'com_email', 'com_telefone', 'matriz']) {
    $(id).checked = params.get(id) === 'true';
  }
}

function wireEvents() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });

  $('clear').addEventListener('click', () => {
    form.reset();
    $('situacao').value = '02';
    $('idade_min').value = '3';
    search();
  });

  $('export').addEventListener('click', () => {
    const params = buildFilterParams();
    window.location.href = `/api/export.csv?${params.toString()}`;
  });

  resultsBody.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-cnpj]');
    if (row) openDetail(row.dataset.cnpj);
  });

  $('close-detail').addEventListener('click', () => $('detail').close());
  $('detail').addEventListener('click', (event) => {
    if (event.target === $('detail')) $('detail').close();
  });
}

async function init() {
  wireEvents();
  try {
    await loadOptions();
    await loadMeta();
    readUrlParams();
    await search({ resetPage: false });
  } catch (error) {
    console.error(error);
    $('result-info').textContent = 'Falha ao inicializar a aplicação.';
    resultsBody.innerHTML = '<tr><td colspan="8" class="empty">Verifique se a API e o banco estão disponíveis.</td></tr>';
  }
}

void init();
