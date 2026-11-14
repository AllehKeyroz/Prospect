const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  pageSize: 25,
  totalPages: 0,
  options: null,
  loading: false,
  dashboardLoading: false,
  view: 'search',
};

const form = $('filters');
const dashboardForm = $('dashboard-filters');
const resultsBody = $('results-body');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
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

function firstPhone(row) {
  return fmtPhone(row.ddd1, row.telefone1) || fmtPhone(row.ddd2, row.telefone2);
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

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = `toast ${type}`;
  }, 4200);
}

async function fetchJson(url) {
  const response = await fetch(url);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Erro HTTP ${response.status}`);
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Select customizado                                                  */
/* ------------------------------------------------------------------ */

function closeAllSelects() {
  document.querySelectorAll('.select-menu.open').forEach((menu) => {
    menu.classList.remove('open');
    const trigger = menu.parentElement?.querySelector('.select-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
  });
}

function enhanceSelect(select) {
  if (!select || select.dataset.enhanced === 'true') return;
  select.dataset.enhanced = 'true';

  const wrap = document.createElement('div');
  wrap.className = 'select-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'select-label';
  const arrow = document.createElement('span');
  arrow.className = 'select-arrow';
  arrow.textContent = '▾';
  trigger.append(label, arrow);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.setAttribute('role', 'listbox');

  const searchWrap = document.createElement('div');
  searchWrap.className = 'select-search-wrap';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'select-search';
  search.placeholder = select.dataset.searchPlaceholder || 'Pesquisar…';
  search.setAttribute('aria-label', search.placeholder);
  searchWrap.appendChild(search);

  const optionsBox = document.createElement('div');
  optionsBox.className = 'select-options';
  menu.append(searchWrap, optionsBox);

  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  select.classList.add('native-select');

  const triggerId = select.id ? `${select.id}-trigger` : '';
  if (triggerId) trigger.id = triggerId;
  const selectLabel = select.id
    ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`)
    : null;
  if (selectLabel && triggerId) selectLabel.setAttribute('for', triggerId);

  let focused = -1;

  function searchable() {
    return select.dataset.searchable === 'true' || select.options.length > 8;
  }

  function sync() {
    const selected = select.options[select.selectedIndex];
    label.textContent = selected?.textContent ?? 'Selecione';
    trigger.title = selected?.textContent ?? '';
    trigger.classList.toggle('placeholder', !select.value);
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-expanded', menu.classList.contains('open') ? 'true' : 'false');
    searchWrap.hidden = !searchable();
  }

  function filteredOptions() {
    const term = normalize(search.value);
    return Array.from(select.options).filter((option) => {
      if (!term) return true;
      return normalize(`${option.value} ${option.textContent}`).includes(term);
    });
  }

  function selectOption(option) {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    sync();
    trigger.focus();
  }

  function renderOptions() {
    const options = filteredOptions();
    optionsBox.innerHTML = '';

    if (options.length === 0) {
      optionsBox.innerHTML = '<div class="select-empty">Nenhum resultado</div>';
      focused = -1;
      sync();
      return;
    }

    if (focused < 0) {
      const selectedIndex = options.findIndex((option) => option.value === select.value);
      focused = selectedIndex >= 0 ? selectedIndex : 0;
    }
    focused = Math.min(focused, options.length - 1);

    options.forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.textContent = option.textContent;
      item.dataset.value = option.value;
      if (option.value === select.value) item.classList.add('active');
      if (index === focused) item.classList.add('focused');
      item.addEventListener('click', () => selectOption(option));
      optionsBox.appendChild(item);
    });

    optionsBox.querySelector('.select-option.focused')?.scrollIntoView({ block: 'nearest' });
    sync();
  }

  function open() {
    if (select.disabled) return;
    closeAllSelects();
    search.value = '';
    focused = -1;
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    renderOptions();
    if (!searchWrap.hidden) search.focus();
    else optionsBox.querySelector('.select-option.focused')?.focus();
  }

  function close() {
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('open')) close();
    else open();
  });

  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    }
    if (event.key === 'Escape') close();
  });

  search.addEventListener('input', () => {
    focused = -1;
    renderOptions();
  });

  search.addEventListener('keydown', (event) => {
    const items = Array.from(optionsBox.querySelectorAll('.select-option'));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focused = Math.min(items.length - 1, focused + 1);
      renderOptions();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focused = Math.max(0, focused - 1);
      renderOptions();
    } else if (event.key === 'Enter' && focused >= 0 && items[focused]) {
      event.preventDefault();
      items[focused].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });

  menu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target)) close();
  });

  select.addEventListener('change', sync);
  wrap.refresh = () => {
    searchWrap.hidden = !searchable();
    renderOptions();
  };
  select._customWrap = wrap;
  sync();
  renderOptions();
}

function enhanceAllSelects() {
  document.querySelectorAll('select').forEach(enhanceSelect);
}

function refreshSelect(select) {
  select?._customWrap?.refresh();
}

/* Cidades por UF                                                      */
/* ------------------------------------------------------------------ */

async function loadCities(ufSelect, citySelect) {
  if (!ufSelect || !citySelect) return;
  const uf = ufSelect.value;
  const previous = citySelect.value;
  citySelect.innerHTML = '<option value="">Selecione a UF</option>';
  citySelect.disabled = true;

  if (uf) {
    try {
      const data = await fetchJson(`/api/municipios?uf=${encodeURIComponent(uf)}`);
      citySelect.innerHTML = '<option value="">Todas</option>';
      for (const item of data.data ?? []) {
        const option = document.createElement('option');
        option.value = item.codigo;
        option.textContent = item.nome;
        citySelect.appendChild(option);
      }
      citySelect.disabled = false;
      if (previous && Array.from(citySelect.options).some((option) => option.value === previous)) {
        citySelect.value = previous;
      }
    } catch (error) {
      citySelect.innerHTML = '<option value="">Erro ao carregar cidades</option>';
      showToast(error.message, 'error');
    }
  }

  refreshSelect(citySelect);
}

/* ------------------------------------------------------------------ */
/* Filtros e URLs                                                      */
/* ------------------------------------------------------------------ */

function buildFilterParams() {
  const data = new FormData(form);
  const params = new URLSearchParams();

  for (const [key, value] of data.entries()) {
    const text = String(value).trim();
    if (text === '') continue;
    if (['simples', 'mei', 'com_email', 'com_telefone', 'matriz'].includes(key)) continue;
    params.set(key, text);
  }

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

function updateSearchUrl(params) {
  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = 'busca';
  window.history.replaceState(null, '', url);
}

function setView(view, updateHash = true) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  $('view-search').hidden = view !== 'search';
  $('view-dashboard').hidden = view !== 'dashboard';
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = view;
    window.history.replaceState(null, '', url);
  }
  closeAllSelects();
  if (view === 'dashboard') void loadDashboard();
}

/* ------------------------------------------------------------------ */
/* Metadados e opções                                                  */
/* ------------------------------------------------------------------ */

async function loadOptions() {
  const options = await fetchJson('/api/opcoes');
  state.options = options;

  for (const selectId of ['uf', 'dash-uf']) {
    const select = $(selectId);
    for (const value of options.ufs ?? []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  }

  for (const selectId of ['cnae', 'dash-cnae']) {
    const select = $(selectId);
    for (const item of options.cnaes ?? []) {
      const option = document.createElement('option');
      option.value = item.codigo;
      option.textContent = `${item.codigo} — ${item.descricao}`;
      select.appendChild(option);
    }
  }
}

async function loadMeta() {
  const meta = await fetchJson('/api/meta');
  $('snapshot-badge').textContent = `Snapshot ${meta.snapshot ?? '—'}`;
  $('rows-badge').textContent = `${fmtNumber(meta.estabelecimentos)} estabelecimentos`;
  $('note-snapshot').textContent = meta.snapshot ?? '2026-10';
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

function renderSummary(resumo) {
  $('sum-total').textContent = fmtNumber(resumo.total);
  $('sum-ativas').textContent = fmtNumber(resumo.ativas);
  $('sum-mais3').textContent = fmtNumber(resumo.mais_3_anos);
  $('sum-email').textContent = fmtNumber(resumo.com_email);
  $('sum-socios').textContent = fmtNumber(resumo.com_socios);
}

function renderTable(rows) {
  if (!rows.length) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="10" class="empty">
          Nenhuma empresa encontrada com esses filtros.<br />
          <span class="small">Tente remover a idade mínima, ampliar a UF ou limpar a busca.</span>
        </td>
      </tr>`;
    return;
  }

  resultsBody.innerHTML = rows
    .map((row) => {
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
      const local =
        [row.uf, row.municipio_nome].filter(Boolean).map(escapeHtml).join(' · ') || '—';
      const abertura = row.data_inicio
        ? `${fmtDate(row.data_inicio)}${
            row.idade_anos !== null && row.idade_anos !== undefined
              ? `<div class="small muted">${escapeHtml(row.idade_anos)} anos</div>`
              : ''
          }`
        : '—';
      const email = row.email
        ? `<div class="small" title="${escapeHtml(row.email)}">${escapeHtml(String(row.email).slice(0, 30))}</div>`
        : '<span class="muted">—</span>';
      const phone = firstPhone(row);

      return `
        <tr data-cnpj="${escapeHtml(row.cnpj)}">
          <td><span class="cnpj">${escapeHtml(row.cnpj_formatado || row.cnpj)}</span></td>
          <td><div class="company">${company}</div>${fantasy}</td>
          <td>${cnae}</td>
          <td>${local}</td>
          <td>${situacaoChip(row.situacao, row.situacao_descricao)}</td>
          <td>${abertura}</td>
          <td>${row.capital_social !== null && row.capital_social !== undefined ? fmtMoney(row.capital_social) : '—'}</td>
          <td>${fmtNumber(row.socios_count ?? 0)}</td>
          <td>${email}</td>
          <td>${phone ? escapeHtml(phone) : '<span class="muted">—</span>'}</td>
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
      const label =
        type === 'cnae'
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
  const data = await fetchJson(`/api/estatisticas?${params.toString()}`);
  renderStats(type === 'cnae' ? 'stats-cnae' : 'stats-uf', data.data ?? [], type);
}

async function search({ resetPage = true } = {}) {
  if (state.loading) return;
  if (resetPage) state.page = 1;
  state.loading = true;

  const params = buildSearchParams();
  updateSearchUrl(params);
  resultsBody.innerHTML = '<tr><td colspan="10" class="empty">Consultando a base…</td></tr>';
  $('result-info').textContent = 'Consultando…';

  try {
    const payload = await fetchJson(`/api/empresas?${params.toString()}`);
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
      'ordenado por razão social',
    ].filter(Boolean);
    $('result-info').textContent = info.join(' · ');

    void Promise.allSettled([loadStats('cnae'), loadStats('uf')]);
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    resultsBody.innerHTML = '<tr><td colspan="10" class="empty">Erro ao consultar a base.</td></tr>';
    $('result-info').textContent = 'Erro ao consultar a base.';
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------------------ */
/* Ficha cadastral                                                     */
/* ------------------------------------------------------------------ */

function renderDetail(data) {
  const empresa = data.empresa ?? {};
  const primeiro = data.estabelecimentos?.[0] ?? {};
  const simples = data.simples ?? {};
  const sociosCount = data.socios_count ?? data.socios?.length ?? 0;
  const title =
    empresa.razao_social || primeiro.razao_social || 'Empresa sem razão social na amostra';
  const cnpj = data.cnpj_formatado || data.cnpj_base || '';
  const phone = firstPhone(primeiro);

  $('detail-title').textContent = title;

  const tags = [];
  if (primeiro.matriz_filial_descricao) tags.push(primeiro.matriz_filial_descricao);
  if (primeiro.situacao_descricao) tags.push(primeiro.situacao_descricao);
  if (simples.opcao_simples === 'S') tags.push('Simples');
  if (simples.opcao_mei === 'S') tags.push('MEI');
  tags.push(`${sociosCount} sócio${sociosCount === 1 ? '' : 's'}`);
  $('detail-subtitle').innerHTML = `${escapeHtml(cnpj)} ${tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('')}`;

  const boxes = [
    ['Natureza jurídica', empresa.natureza_descricao || empresa.natureza_juridica || '—'],
    ['Porte', empresa.porte_descricao || '—'],
    ['Capital social', fmtMoney(empresa.capital_social)],
    ['Abertura', fmtDate(primeiro.data_inicio)],
    ['Idade', primeiro.idade_anos !== null && primeiro.idade_anos !== undefined ? `${primeiro.idade_anos} anos` : '—'],
    ['CNAE principal', primeiro.cnae_principal ? `${primeiro.cnae_principal} — ${primeiro.cnae_descricao ?? ''}` : '—'],
    ['Nº de sócios', fmtNumber(sociosCount)],
    ['Endereço', [primeiro.tipo_logradouro, primeiro.logradouro, primeiro.numero, primeiro.complemento].filter(Boolean).join(' ') || '—'],
    ['Bairro / CEP', [primeiro.bairro, primeiro.cep].filter(Boolean).join(' · ') || '—'],
    ['E-mail', primeiro.email || '—'],
    ['Telefone', phone || '—'],
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
          <td>${escapeHtml(row.email ?? '') || '—'}</td>
          <td>${escapeHtml(fmtPhone(row.ddd1, row.telefone1)) || '—'}</td>
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
        <thead><tr><th>CNPJ</th><th>Tipo</th><th>Situação</th><th>Abertura</th><th>CNAE</th><th>Endereço</th><th>E-mail</th><th>Telefone</th></tr></thead>
        <tbody>${estabelecimentos || '<tr><td colspan="8" class="muted">Nenhum estabelecimento.</td></tr>'}</tbody>
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
}

async function openDetail(cnpj) {
  const dialog = $('detail');
  $('detail-title').textContent = 'Carregando…';
  $('detail-subtitle').textContent = '';
  $('detail-content').innerHTML = '<p class="muted">Consultando ficha cadastral…</p>';
  dialog.showModal();

  try {
    const data = await fetchJson(`/api/cnpj/${encodeURIComponent(cnpj)}`);
    renderDetail(data);
  } catch (error) {
    console.error(error);
    $('detail-title').textContent = 'Erro';
    $('detail-content').innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    showToast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function buildDashboardParams() {
  const data = new FormData(dashboardForm);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    const text = String(value).trim();
    if (text === '') continue;
    if (['simples', 'mei'].includes(key)) continue;
    params.set(key, text);
  }
  if ($('dash-simples').checked) params.set('simples', 'true');
  if ($('dash-mei').checked) params.set('mei', 'true');
  return params;
}

function renderBars(containerId, items, options = {}) {
  const container = $(containerId);
  if (!items?.length) {
    container.innerHTML = '<p class="chart-empty">Sem dados para os filtros atuais.</p>';
    return;
  }
  const max = Math.max(...items.map((item) => Number(item.total) || 0), 1);
  const labelFor = options.label ?? ((item) => item.rotulo || item.chave);
  container.innerHTML = `
    <div class="bar-list">
      ${items
        .map((item) => {
          const label = labelFor(item);
          const width = Math.max(2, Math.round(((Number(item.total) || 0) / max) * 100));
          return `
            <div class="bar-row" title="${escapeHtml(label)}">
              <div class="bar-label">${escapeHtml(label)}</div>
              <div class="bar-value">${fmtNumber(item.total)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
            </div>`;
        })
        .join('')}
    </div>`;
}

function renderDonut(containerId, items) {
  const container = $(containerId);
  if (!items?.length) {
    container.innerHTML = '<p class="chart-empty">Sem dados para os filtros atuais.</p>';
    return;
  }
  const colors = ['#147d86', '#1f7a4d', '#e8a33d', '#b33a3a', '#68737d', '#0d5c63'];
  const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  let cursor = 0;
  const segments = items
    .map((item, index) => {
      const start = total ? (cursor / total) * 360 : 0;
      cursor += Number(item.total) || 0;
      const end = total ? (cursor / total) * 360 : 0;
      return `${colors[index % colors.length]} ${start}deg ${end}deg`;
    })
    .join(', ');

  container.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background: conic-gradient(${segments})">
        <div class="donut-center"><strong>${fmtNumber(total)}</strong><span>total</span></div>
      </div>
      <div class="donut-legend">
        ${items
          .map(
            (item, index) => `
              <div class="legend-item">
                <span class="legend-dot" style="background:${colors[index % colors.length]}"></span>
                <span>${escapeHtml(item.rotulo || item.chave)}</span>
                <span class="legend-value">${fmtNumber(item.total)}</span>
              </div>`,
          )
          .join('')}
      </div>
    </div>`;
}

function renderLineChart(containerId, items) {
  const numeric = (items ?? [])
    .filter((item) => /^\d{4}$/.test(String(item.chave)))
    .sort((a, b) => Number(a.ordem ?? a.chave) - Number(b.ordem ?? b.chave));

  if (numeric.length < 2) {
    renderBars(containerId, items, { label: (item) => item.chave });
    return;
  }

  const container = $(containerId);
  const width = 820;
  const height = 230;
  const pad = { left: 44, right: 16, top: 18, bottom: 34 };
  const max = Math.max(...numeric.map((item) => Number(item.total) || 0), 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const points = numeric.map((item, index) => {
    const x = pad.left + (index / (numeric.length - 1)) * plotWidth;
    const y = pad.top + plotHeight - ((Number(item.total) || 0) / max) * plotHeight;
    return { x, y, item };
  });

  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = [
    `M ${points[0].x.toFixed(1)},${(pad.top + plotHeight).toFixed(1)}`,
    ...points.map((point) => `L ${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `L ${points[points.length - 1].x.toFixed(1)},${(pad.top + plotHeight).toFixed(1)}`,
    'Z',
  ].join(' ');

  const gridLines = [0, 0.5, 1].map((ratio) => {
    const y = pad.top + plotHeight * ratio;
    const value = Math.round(max * (1 - ratio));
    return `
      <line class="axis" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
      <text class="label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${fmtNumber(value)}</text>`;
  });

  const labels = points
    .map((point, index) => {
      if (points.length > 9 && index % 2 !== 0 && index !== points.length - 1) return '';
      return `<text class="label" x="${point.x}" y="${height - 10}" text-anchor="middle">${escapeHtml(point.item.chave)}</text>`;
    })
    .join('');

  const dots = points
    .map((point) => `<circle class="dot" cx="${point.x}" cy="${point.y}" r="3.2"><title>${escapeHtml(point.item.chave)}: ${fmtNumber(point.item.total)}</title></circle>`)
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Aberturas por ano">
      ${gridLines.join('')}
      <path class="area" d="${area}" />
      <polyline class="line" points="${line}" />
      ${dots}
      ${labels}
    </svg>`;
}

function renderDashboard(data) {
  const totals = data.totais ?? {};
  const kpis = [
    ['Estabelecimentos', totals.estabelecimentos],
    ['Empresas', totals.empresas],
    ['Sócios', totals.socios],
    ['Simples', totals.simples],
    ['MEI', totals.mei],
    ['Com e-mail', totals.com_email],
    ['Com telefone', totals.com_telefone],
    ['Com sócios', totals.com_socios],
  ];
  $('dash-kpis').innerHTML = kpis
    .map(
      ([label, value]) => `
        <article class="kpi">
          <span>${escapeHtml(label)}</span>
          <strong>${fmtNumber(value)}</strong>
        </article>`,
    )
    .join('');

  renderDonut('chart-situacao', data.situacoes ?? []);
  renderBars('chart-porte', data.portes ?? []);
  renderBars('chart-ufs', data.ufs ?? []);
  renderBars('chart-cnaes', data.cnaes ?? [], {
    label: (item) => `${item.chave} — ${String(item.rotulo ?? '').slice(0, 60)}`,
  });
  renderBars('chart-municipios', data.municipios ?? [], {
    label: (item) => `${item.rotulo ?? item.chave} / ${item.uf ?? ''}`,
  });
  renderLineChart('chart-aberturas', data.aberturas ?? []);
  renderBars('chart-idades', data.idades ?? []);
  renderBars('chart-capital', data.capital ?? []);
  renderBars('chart-socios', data.socios ?? []);
}

async function loadDashboard() {
  if (state.dashboardLoading) return;
  state.dashboardLoading = true;
  const params = buildDashboardParams();

  $('dash-kpis').innerHTML = '<article class="kpi"><span>Carregando…</span><strong>—</strong></article>';
  for (const id of [
    'chart-situacao',
    'chart-porte',
    'chart-ufs',
    'chart-cnaes',
    'chart-municipios',
    'chart-aberturas',
    'chart-idades',
    'chart-capital',
    'chart-socios',
  ]) {
    $(id).innerHTML = '<p class="chart-empty">Carregando…</p>';
  }

  try {
    const data = await fetchJson(`/api/dashboard?${params.toString()}`);
    renderDashboard(data);
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    $('dash-kpis').innerHTML = '<article class="kpi"><span>Erro</span><strong>—</strong></article>';
    for (const id of [
      'chart-situacao',
      'chart-porte',
      'chart-ufs',
      'chart-cnaes',
      'chart-municipios',
      'chart-aberturas',
      'chart-idades',
      'chart-capital',
      'chart-socios',
    ]) {
      $(id).innerHTML = '<p class="chart-empty">Erro ao carregar.</p>';
    }
  } finally {
    state.dashboardLoading = false;
  }
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  state.page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  state.pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') ?? 25) || 25));

  const textFields = [
    'q',
    'uf',
    'municipio',
    'situacao',
    'porte',
    'idade_min',
    'capital_min',
    'capital_max',
    'socios_min',
    'socios_max',
    'cnae',
  ];
  for (const field of textFields) {
    if (params.has(field)) $(field).value = params.get(field);
  }
  if (!params.has('situacao')) $('situacao').value = '02';
  if (!params.has('idade_min')) $('idade_min').value = '3';

  for (const id of ['simples', 'mei', 'com_email', 'com_telefone', 'matriz']) {
    $(id).checked = params.get(id) === 'true';
  }

  return params;
}

function wireEvents() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });

  $('clear').addEventListener('click', async () => {
    form.reset();
    $('situacao').value = '02';
    $('idade_min').value = '3';
    refreshSelect($('cnae'));
    await loadCities($('uf'), $('municipio'));
    search();
  });

  $('export').addEventListener('click', () => {
    showToast('Gerando exportação CSV…');
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

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  $('uf').addEventListener('change', () => {
    void loadCities($('uf'), $('municipio'));
  });
  $('dash-uf').addEventListener('change', () => {
    void loadCities($('dash-uf'), $('dash-municipio'));
  });

  dashboardForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadDashboard();
  });

  $('dash-clear').addEventListener('click', async () => {
    dashboardForm.reset();
    $('dash-idade').value = '0';
    refreshSelect($('dash-cnae'));
    await loadCities($('dash-uf'), $('dash-municipio'));
    void loadDashboard();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllSelects();
      if ($('detail').open) $('detail').close();
    }
  });
}

async function init() {
  wireEvents();
  try {
    await loadOptions();
    await loadMeta();
    const params = readUrlParams();
    enhanceAllSelects();
    await loadCities($('uf'), $('municipio'));
    if (params.get('municipio')) {
      $('municipio').value = params.get('municipio');
      refreshSelect($('municipio'));
    }
    await loadCities($('dash-uf'), $('dash-municipio'));

    if (window.location.hash === '#dashboard') setView('dashboard', false);
    else {
      setView('search', false);
      await search({ resetPage: false });
    }
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    $('result-info').textContent = 'Falha ao inicializar a aplicação.';
    resultsBody.innerHTML = '<tr><td colspan="10" class="empty">Verifique se a API e o banco estão disponíveis.</td></tr>';
  }
}

void init();
