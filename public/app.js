import * as maplibregl from '/vendor/maplibre-gl.mjs';

if (maplibregl.setWorkerUrl) {
  maplibregl.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');
}

const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  pageSize: 25,
  totalPages: 0,
  searchSort: 'razao_social',
  searchOrder: 'asc',
  savedSearches: [],
  options: null,
  meta: null,
  loading: false,
  pendingSearch: false,
  dashboardLoading: false,
  pendingDashboard: false,
  hubLoading: false,
  hubPending: false,
  hubToken: 0,
  hubs: [],
  searchTimer: null,
  mapTimer: null,
  dashboardTimer: null,
  hubTimer: null,
  view: 'mapa',
  map: null,
  mapReady: false,
  mapLevel: 'uf',
  mapMetric: 'estabelecimentos',
  mapMetrics: { regiao: [], uf: [], municipio: [] },
  mapIndexes: { regiao: new Map(), uf: new Map(), municipio: new Map() },
  mapCache: new Map(),
  mapCompanyCache: new Map(),
  mapTimelineCache: new Map(),
  mapGeo: null,
  mapSelection: null,
  mapSelectionRow: null,
  mapHovered: null,
  mapFitted: false,
  mapPreviewTimer: null,
  mapPreviewToken: 0,
  mapListLimit: 6,
  mapLoading: false,
  network: null,
  networkLoading: false,
  networkSuggestionTimer: null,
  networkFilters: new Set([
    'socio_de',
    'mesmo_email',
    'mesmo_telefone',
    'mesmo_endereco',
    'mesma_marca',
  ]),
  networkMap: null,
  networkMapReady: false,
  networkCentroids: { municipio: new Map(), uf: new Map() },
  networkCentroidsPromise: null,
  networkMapFitted: false,
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

function debounce(key, callback, delay = 300) {
  clearTimeout(state[key]);
  state[key] = setTimeout(callback, delay);
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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
  params.set('sort', state.searchSort);
  params.set('order', state.searchOrder);
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
  $('view-mapa').hidden = view !== 'mapa';
  $('view-search').hidden = view !== 'search';
  $('view-rede').hidden = view !== 'rede';
  $('view-dashboard').hidden = view !== 'dashboard';
  $('view-dados').hidden = view !== 'dados';
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = view;
    window.history.replaceState(null, '', url);
  }
  closeAllSelects();
  if (view === 'mapa') {
    void ensureMap();
    setTimeout(() => {
      if (!state.map) return;
      state.map.resize();
      if (!state.mapFitted) fitMapToBrazil();
    }, 80);
  }
  if (view === 'search' && !state.loading && !resultsBody.querySelector('tr[data-cnpj]')) {
    void search({ resetPage: true });
  }
  if (view === 'rede') {
    void ensureNetworkMap();
    setTimeout(() => state.networkMap?.resize(), 80);
    if (state.hubs.length === 0) void loadHubs();
  }
  if (view === 'dashboard') void loadDashboard();
  if (view === 'dados') void loadCoverage();
}

/* ------------------------------------------------------------------ */
/* Metadados e opções                                                  */
/* ------------------------------------------------------------------ */

async function loadOptions() {
  const options = await fetchJson('/api/opcoes');
  state.options = options;

  for (const selectId of ['uf', 'dash-uf', 'hub-uf']) {
    const select = $(selectId);
    for (const value of options.ufs ?? []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  }

  for (const selectId of ['cnae', 'dash-cnae', 'map-cnae', 'hub-cnae']) {
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
  state.meta = meta;
  $('snapshot-badge').textContent = `Snapshot ${meta.snapshot ?? '—'}`;
  $('rows-badge').textContent = `${fmtNumber(meta.estabelecimentos)} estabelecimentos na amostra`;
  $('rows-badge').title = 'Amostra local; não representa o Brasil inteiro';
  $('note-snapshot').textContent = meta.snapshot ?? '2026-10';
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */

const MAP_LEVEL_LABEL = { regiao: 'Região', uf: 'Estado', municipio: 'Cidade' };

function mapFilterParams() {
  const data = new FormData($('map-filters'));
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (key === 'metric') continue;
    const text = String(value).trim();
    if (text === '') continue;
    if (['simples', 'mei'].includes(key)) continue;
    params.set(key, text);
  }
  if ($('map-simples').checked) params.set('simples', 'true');
  if ($('map-mei').checked) params.set('mei', 'true');
  return params;
}

function mapTerritoryParams(selection) {
  const params = mapFilterParams();
  if (selection) {
    if (selection.nivel === 'regiao') params.set('regiao', selection.codigo);
    else if (selection.nivel === 'uf') params.set('uf', selection.codigo);
    else params.set('municipio_ibge', selection.codigo);
  }
  return params;
}

function mapApiParams(selection) {
  const params = mapFilterParams();
  if (selection) {
    params.set('nivel', selection.nivel);
    params.set('codigo', selection.codigo);
  }
  return params;
}

function mapFeatureKey(level, props) {
  if (level === 'regiao') return props.nome;
  if (level === 'uf') return props.uf;
  return props.codigo;
}

function mapFeatureName(level, props) {
  if (level === 'municipio') return `${props.nome} / ${props.uf}`;
  if (level === 'uf') return `${props.nome} (${props.uf})`;
  return props.nome;
}

function mapMetricValue(row, metric) {
  if (!row) return 0;
  if (metric === 'saldo_12m') {
    return Number(row.aberturas_12m ?? 0) - Number(row.fechamentos_12m ?? 0);
  }
  const value = Number(row[metric]);
  return Number.isFinite(value) ? value : 0;
}

function formatMapMetric(metric, value) {
  if (metric === 'capital_mediano') return fmtMoney(value);
  if (metric === 'idade_media') return `${Number(value).toFixed(1)} anos`;
  return fmtNumber(value);
}

async function ensureMap() {
  if (state.map) {
    state.map.resize();
    return;
  }
  if (!maplibregl || !$('map')) return;

  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#eaf0f3' },
        },
      ],
    },
    bounds: [
      [-74, -34],
      [-34, 6],
    ],
    fitBoundsOptions: { padding: 28 },
    minZoom: 2.4,
    maxZoom: 10,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });

  state.map = map;
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    'top-right',
  );
  map.on('error', (event) => console.error('map error', event.error));

  map.on('load', async () => {
    try {
      map.resize();
      fitMapToBrazil();
      await setupMapLayers(map);
    } catch (error) {
      console.error(error);
      showToast('Falha ao carregar o mapa.', 'error');
      $('map-loading').hidden = true;
    }
  });
}

async function setupMapLayers(map) {
  const [regioes, estados, municipios] = await Promise.all([
    fetchJson('/geo/regioes.geojson'),
    fetchJson('/geo/estados.geojson'),
    fetchJson('/geo/municipios.geojson'),
  ]);
  state.mapGeo = { regiao: regioes, uf: estados, municipio: municipios };

  for (const level of ['regiao', 'uf', 'municipio']) {
    const visible = level === 'uf';
    map.addSource(level, {
      type: 'geojson',
      data: state.mapGeo[level],
      promoteId: 'codigo',
    });
    map.addLayer({
      id: `fill-${level}`,
      type: 'fill',
      source: level,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'fill-color': '#dbe7ea',
        'fill-opacity': 0.78,
      },
    });
    map.addLayer({
      id: `line-${level}`,
      type: 'line',
      source: level,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'line-color': 'rgba(255,255,255,0.9)',
        'line-width': 0.6,
        'line-opacity': 0.85,
      },
    });
  }

  state.mapReady = true;
  $('map-loading').hidden = true;
  fitMapToBrazil();
  map.on('mousemove', onMapMove);
  map.on('click', onMapClick);
  map.getCanvas().addEventListener('mouseleave', onMapLeave);

  await setMapLevel('uf');
}

async function setMapLevel(level, load = true) {
  state.mapLevel = level;
  document.querySelectorAll('#map-level button').forEach((button) => {
    button.classList.toggle('active', button.dataset.level === level);
  });

  if (!state.mapReady || !state.map) return;

  for (const candidate of ['regiao', 'uf', 'municipio']) {
    const visible = candidate === level;
    state.map.setLayoutProperty(
      `fill-${candidate}`,
      'visibility',
      visible ? 'visible' : 'none',
    );
    state.map.setLayoutProperty(
      `line-${candidate}`,
      'visibility',
      visible ? 'visible' : 'none',
    );
  }

  clearMapHover();
  clearMapSelection();
  state.mapListLimit = 6;

  if (load) await loadMapMetrics(level);
  else if (state.mapIndexes[level].size > 0) applyMetricToMap();
  resetTerritoryPreview();
}

async function loadMapMetrics(level = state.mapLevel) {
  const params = mapFilterParams();
  params.set('nivel', level);
  const key = `${level}|${params.toString()}`;
  $('map-loading').hidden = false;

  try {
    let rows = state.mapCache.get(key);
    if (!rows) {
      const data = await fetchJson(`/api/mapa?${params.toString()}`);
      rows = data.data ?? [];
      state.mapCache.set(key, rows);
    }
    state.mapMetrics[level] = rows;
    state.mapIndexes[level] = new Map(rows.map((row) => [row.codigo, row]));
    if (level === state.mapLevel) applyMetricToMap();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    $('map-loading').hidden = true;
  }
}

function applyMetricToMap() {
  if (!state.mapReady || !state.map || !state.mapGeo) return;
  const level = state.mapLevel;
  const collection = state.mapGeo[level];
  const index = state.mapIndexes[level];
  if (!collection) return;

  let min = Infinity;
  let max = -Infinity;
  for (const feature of collection.features) {
    const key = mapFeatureKey(level, feature.properties);
    const row = index.get(key);
    const value = mapMetricValue(row, state.mapMetric);
    feature.properties.metric = value;
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min = state.mapMetric === 'saldo_12m' ? Math.min(0, min) : 0;
    max = max === 0 ? 1 : max;
  }
  if (state.mapMetric === 'saldo_12m') {
    if (max <= 0) max = 1;
    if (min >= 0) min = -1;
  } else {
    min = Math.min(0, min);
  }

  state.map.getSource(level).setData(collection);

  const fillColor =
    state.mapMetric === 'saldo_12m'
      ? [
          'interpolate',
          ['linear'],
          ['get', 'metric'],
          min,
          '#b33a3a',
          0,
          '#f4f6f8',
          max,
          '#0d5c63',
        ]
      : [
          'interpolate',
          ['linear'],
          ['get', 'metric'],
          min,
          '#e8f4f5',
          min + (max - min) * 0.5,
          '#7fc4c8',
          max,
          '#0d5c63',
        ];

  state.map.setPaintProperty(`fill-${level}`, 'fill-color', fillColor);
  state.map.setPaintProperty(`fill-${level}`, 'fill-opacity', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    1,
    ['boolean', ['feature-state', 'hover'], false],
    0.94,
    0.78,
  ]);
  state.map.setPaintProperty(`line-${level}`, 'line-color', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    '#e8a33d',
    ['boolean', ['feature-state', 'hover'], false],
    '#0d5c63',
    'rgba(255,255,255,0.9)',
  ]);
  state.map.setPaintProperty(`line-${level}`, 'line-width', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    2.4,
    ['boolean', ['feature-state', 'hover'], false],
    1.8,
    0.6,
  ]);

  updateMapLegend(min, max, state.mapMetric);
}

function updateMapLegend(min, max, metric) {
  const label =
    $('map-metric').selectedOptions[0]?.textContent ?? metric;
  const gradient =
    metric === 'saldo_12m'
      ? 'linear-gradient(90deg, #b33a3a, #f4f6f8, #0d5c63)'
      : 'linear-gradient(90deg, #e8f4f5, #7fc4c8, #0d5c63)';
  $('map-legend').innerHTML = `
    <div class="map-legend-title">${escapeHtml(label)}</div>
    <div class="map-legend-bar" style="background:${gradient}"></div>
    <div class="map-legend-scale">
      <span>${escapeHtml(formatMapMetric(metric, min))}</span>
      <span>${escapeHtml(formatMapMetric(metric, max))}</span>
    </div>
    <div class="map-legend-scale"><span>${fmtNumber(state.mapMetrics[state.mapLevel]?.length ?? 0)} territórios</span></div>
  `;
}

function fitMapToBrazil() {
  if (!state.map) return;
  state.map.resize();
  const canvas = state.map.getCanvas();
  if (!canvas.width || !canvas.height) return;
  state.map.fitBounds(
    [
      [-74, -34],
      [-34, 6],
    ],
    { padding: 28, animate: false },
  );
  state.mapFitted = true;
}

function clearMapSelection() {
  if (state.mapSelected && state.map) {
    state.map.setFeatureState(
      { source: state.mapSelected.level, id: state.mapSelected.id },
      { selected: false },
    );
  }
  state.mapSelected = null;
  state.mapSelection = null;
  state.mapSelectionRow = null;
}

function clearMapHover() {
  if (state.mapHovered && state.map) {
    state.map.setFeatureState(
      { source: state.mapHovered.level, id: state.mapHovered.id },
      { hover: false },
    );
  }
  state.mapHovered = null;
  hideMapTooltip();
  if (state.map) state.map.getCanvas().style.cursor = '';
}

function setMapHover(feature) {
  const level = state.mapLevel;
  const id = feature.id ?? feature.properties.codigo;
  if (state.mapHovered) {
    if (state.mapHovered.id === id && state.mapHovered.level === level) return;
    state.map.setFeatureState(
      { source: state.mapHovered.level, id: state.mapHovered.id },
      { hover: false },
    );
  }
  state.mapHovered = { level, id };
  state.map.setFeatureState({ source: level, id }, { hover: true });
  state.map.getCanvas().style.cursor = 'pointer';
}

function onMapMove(event) {
  if (!state.mapReady || !state.map) return;
  const layer = `fill-${state.mapLevel}`;
  const features = state.map.queryRenderedFeatures(event.point, {
    layers: [layer],
  });
  if (!features.length) {
    clearMapHover();
    return;
  }

  const feature = features[0];
  const key = mapFeatureKey(state.mapLevel, feature.properties);
  const row = state.mapIndexes[state.mapLevel].get(key);
  setMapHover(feature);
  updateMapTooltip(event, feature, row);
  scheduleMapPreview(state.mapLevel, feature, row, false);
}

function onMapClick(event) {
  if (!state.mapReady || !state.map) return;
  const layer = `fill-${state.mapLevel}`;
  const features = state.map.queryRenderedFeatures(event.point, {
    layers: [layer],
  });
  if (!features.length) return;

  const feature = features[0];
  const level = state.mapLevel;
  const key = mapFeatureKey(level, feature.properties);
  const id = feature.id ?? feature.properties.codigo;

  if (state.mapSelected) {
    state.map.setFeatureState(
      { source: state.mapSelected.level, id: state.mapSelected.id },
      { selected: false },
    );
  }
  state.mapSelected = { level, id };
  state.map.setFeatureState({ source: level, id }, { selected: true });

  state.mapSelection = {
    nivel: level,
    codigo: key,
    nome: mapFeatureName(level, feature.properties),
    uf: feature.properties.uf ?? '',
    regiao: feature.properties.regiao ?? '',
  };
  state.mapListLimit = 6;
  const row = state.mapIndexes[level].get(key);
  state.mapSelectionRow = row ?? null;
  scheduleMapPreview(level, feature, row, true);
}

function onMapLeave() {
  clearMapHover();
  if (!state.mapSelection) {
    resetTerritoryPreview();
    return;
  }

  const selection = state.mapSelection;
  const token = ++state.mapPreviewToken;
  renderMapTerritory(
    selection.nivel,
    selection.nome,
    state.mapSelectionRow,
    true,
  );
  loadMapCompanies(selection, state.mapListLimit, token);
  loadMapTimeline(selection, token);
}

function updateMapTooltip(event, feature, row) {
  const tooltip = $('map-tooltip');
  const metric = state.mapMetric;
  const value = mapMetricValue(row, metric);
  const name = mapFeatureName(state.mapLevel, feature.properties);
  tooltip.innerHTML = `
    <h4>${escapeHtml(name)}</h4>
    <p>${escapeHtml(MAP_LEVEL_LABEL[state.mapLevel] ?? '')} · prévia</p>
    <div class="tooltip-row"><span>${escapeHtml($('map-metric').selectedOptions[0]?.textContent ?? metric)}</span><strong>${escapeHtml(formatMapMetric(metric, value))}</strong></div>
    <div class="tooltip-row"><span>Estabelecimentos</span><strong>${fmtNumber(row?.estabelecimentos)}</strong></div>
    <div class="tooltip-row"><span>Aberturas 12m</span><strong>${fmtNumber(row?.aberturas_12m)}</strong></div>
    <div class="tooltip-row"><span>Fechamentos 12m</span><strong>${fmtNumber(row?.fechamentos_12m)}</strong></div>
    <div class="tooltip-row"><span>Idade média</span><strong>${row?.idade_media != null ? `${Number(row.idade_media).toFixed(1)} anos` : '—'}</strong></div>
    <div class="tooltip-hint">Clique para fixar o território</div>
  `;
  const panel = $('map').getBoundingClientRect();
  const tooltipWidth = 260;
  const tooltipHeight = 190;
  let left = event.point.x + 16;
  let top = event.point.y + 16;
  if (left + tooltipWidth > panel.width) left = event.point.x - tooltipWidth - 16;
  if (top + tooltipHeight > panel.height) top = event.point.y - tooltipHeight - 16;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
  tooltip.style.display = 'block';
}

function hideMapTooltip() {
  const tooltip = $('map-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function scheduleMapPreview(level, feature, row, locked) {
  const key = mapFeatureKey(level, feature.properties);
  const selection = {
    nivel: level,
    codigo: key,
    nome: mapFeatureName(level, feature.properties),
    uf: feature.properties.uf ?? '',
    regiao: feature.properties.regiao ?? '',
  };
  const token = ++state.mapPreviewToken;
  renderMapTerritory(level, selection.nome, row, locked);

  clearTimeout(state.mapPreviewTimer);
  state.mapPreviewTimer = setTimeout(() => {
    loadMapCompanies(selection, locked ? state.mapListLimit : 6, token);
    loadMapTimeline(selection, token);
    if (locked) loadMapMarket(selection, token);
  }, 120);
}

function renderMapTerritory(level, name, row, locked) {
  $('map-territory-name').textContent = name;
  $('map-territory-subtitle').textContent = `${MAP_LEVEL_LABEL[level] ?? ''} · ${
    locked ? 'selecionado' : 'prévia'
  }`;
  const kpis = [
    ['Estabelecimentos', fmtNumber(row?.estabelecimentos)],
    ['Ativas', fmtNumber(row?.ativas)],
    ['Aberturas 12m', fmtNumber(row?.aberturas_12m)],
    ['Fechamentos 12m', fmtNumber(row?.fechamentos_12m)],
    [
      'Idade média',
      row?.idade_media != null ? `${Number(row.idade_media).toFixed(1)} anos` : '—',
    ],
    ['Capital mediano', row?.capital_mediano != null ? fmtMoney(row.capital_mediano) : '—'],
    ['Simples', fmtNumber(row?.simples)],
    ['MEI', fmtNumber(row?.mei)],
  ];
  $('map-kpis').innerHTML = kpis
    .map(
      ([label, value]) => `
        <div class="map-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('');
}

function resetTerritoryPreview() {
  if (state.mapSelection) return;
  const token = ++state.mapPreviewToken;
  const meta = state.meta ?? {};
  $('map-territory-name').textContent = 'Brasil';
  $('map-territory-subtitle').textContent = 'Visão geral do snapshot';
  const kpis = [
    ['Estabelecimentos', fmtNumber(meta.estabelecimentos)],
    ['Empresas', fmtNumber(meta.empresas)],
    ['Sócios', fmtNumber(meta.socios)],
    ['Municípios mapeados', fmtNumber(meta.municipios_mapeados)],
  ];
  $('map-kpis').innerHTML = kpis
    .map(
      ([label, value]) => `
        <div class="map-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('');
  $('map-market').innerHTML =
    '<p class="muted small">Clique em um território para carregar o raio-X competitivo.</p>';
  loadMapCompanies(null, 6, token);
  loadMapTimeline(null, token);
}

async function loadMapCompanies(selection, limit, token) {
  const params = mapTerritoryParams(selection);
  params.set('page_size', String(limit));
  params.set('sort', 'razao_social');
  params.set('order', 'asc');
  const key = params.toString();

  try {
    let rows = state.mapCompanyCache.get(key);
    if (!rows) {
      const payload = await fetchJson(`/api/empresas?${key}`);
      rows = payload.data ?? [];
      state.mapCompanyCache.set(key, rows);
    }
    if (token !== state.mapPreviewToken) return;
    renderMapCompanies(rows, limit);
  } catch (error) {
    console.error(error);
    if (token === state.mapPreviewToken) {
      $('map-company-list').innerHTML =
        '<p class="muted small">Erro ao carregar empresas.</p>';
    }
  }
}

function renderMapCompanies(rows, limit) {
  $('map-see-all').textContent = limit > 6 ? 'Ver menos' : 'Ver mais';
  if (!rows.length) {
    $('map-company-list').innerHTML =
      '<p class="muted small">Nenhuma empresa com os filtros atuais.</p>';
    return;
  }
  $('map-company-list').innerHTML = rows
    .map((row) => {
      const name = row.razao_social || row.cnpj_formatado || row.cnpj;
      const local = [row.municipio_nome, row.uf].filter(Boolean).join(' / ');
      const contact = row.email || firstPhone(row);
      return `
        <div class="map-company" data-cnpj="${escapeHtml(row.cnpj)}">
          <div class="map-company-name">${escapeHtml(name)}</div>
          <div class="map-company-value">${fmtNumber(row.socios_count)} sócios</div>
          <div class="map-company-meta">${escapeHtml(row.cnae_principal ?? '')} · ${escapeHtml(local)} · ${escapeHtml(row.situacao_descricao ?? '')}</div>
          <div class="map-company-sub">${escapeHtml(contact ?? '')} · ${row.capital_social != null ? fmtMoney(row.capital_social) : 'capital não informado'}</div>
        </div>`;
    })
    .join('');
}

async function loadMapTimeline(selection, token) {
  try {
    const params = mapApiParams(selection);
    const key = params.toString();
    let rows = state.mapTimelineCache.get(key);
    if (!rows) {
      const payload = await fetchJson(`/api/timeline?${key}`);
      rows = payload.data ?? [];
      state.mapTimelineCache.set(key, rows);
    }
    if (token !== state.mapPreviewToken) return;
    renderTimelineChart('map-timeline', rows);
  } catch (error) {
    console.error(error);
  }
}

async function loadMapMarket(selection, token) {
  try {
    const params = mapApiParams(selection);
    const payload = await fetchJson(`/api/mercado?${params.toString()}`);
    if (token !== state.mapPreviewToken) return;
    renderMapMarket(payload);
  } catch (error) {
    console.error(error);
    if (token === state.mapPreviewToken) {
      $('map-market').innerHTML =
        '<p class="muted small">Não foi possível carregar o raio-X.</p>';
    }
  }
}

function renderMapMarket(data) {
  const totais = data.totais ?? {};
  const kpis = [
    ['Estabelecimentos', fmtNumber(totais.estabelecimentos)],
    ['Aberturas 12m', fmtNumber(totais.aberturas_12m)],
    ['Fechamentos 12m', fmtNumber(totais.fechamentos_12m)],
    ['HHI', data.hhi != null ? Number(data.hhi).toFixed(1) : '—'],
    ['Idade média', totais.idade_media != null ? `${Number(totais.idade_media).toFixed(1)} anos` : '—'],
    ['Capital mediano', totais.capital_mediano != null ? fmtMoney(totais.capital_mediano) : '—'],
  ];
  const cnaes = (data.cnaes ?? [])
    .slice(0, 5)
    .map(
      (item) => `
        <div class="tooltip-row">
          <span>${escapeHtml(item.cnae_principal)} — ${escapeHtml(String(item.cnae_descricao ?? '').slice(0, 34))}</span>
          <strong>${fmtNumber(item.total)}</strong>
        </div>`,
    )
    .join('');
  const players = (data.players ?? [])
    .slice(0, 5)
    .map(
      (item) => `
        <div class="map-company" data-cnpj="${escapeHtml(item.cnpj_base)}">
          <div class="map-company-name">${escapeHtml(item.razao_social || item.cnpj_base)}</div>
          <div class="map-company-value">${fmtNumber(item.estabelecimentos)} estab.</div>
          <div class="map-company-meta">${escapeHtml(item.municipio_nome ?? '')} ${escapeHtml(item.uf ?? '')} · ${escapeHtml(item.situacao_descricao ?? '')}</div>
          <div class="map-company-sub">${item.capital_social != null ? fmtMoney(item.capital_social) : 'capital não informado'}</div>
        </div>`,
    )
    .join('');

  $('map-market').innerHTML = `
    <div class="market-kpis">
      ${kpis
        .map(
          ([label, value]) =>
            `<div class="market-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
        )
        .join('')}
    </div>
    <div>
      <p class="market-subtitle">Top CNAEs</p>
      <div class="stats">${cnaes || '<p class="muted small">Sem dados.</p>'}</div>
    </div>
    <div>
      <p class="market-subtitle">Top players</p>
      <div class="map-company-list" style="max-height:220px">${players || '<p class="muted small">Sem dados.</p>'}</div>
    </div>
  `;
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
  if (state.loading) {
    state.pendingSearch = true;
    return;
  }
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

    const sortLabel = {
      razao_social: 'razão social',
      data_inicio: 'abertura recente',
      capital_social: 'capital',
      socios: 'sócios',
    }[state.searchSort] ?? 'razão social';
    const info = [
      `${fmtNumber(payload.total)} estabelecimentos`,
      payload.total > 0
        ? `exibindo ${fmtNumber((payload.page - 1) * payload.page_size + 1)}–${fmtNumber(
            Math.min(payload.page * payload.page_size, payload.total),
          )}`
        : null,
      `ordenado por ${sortLabel}`,
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
    if (state.pendingSearch) {
      state.pendingSearch = false;
      void search({ resetPage: false });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rede de ligações                                                    */
/* ------------------------------------------------------------------ */

const NETWORK_NODE_COLOR = {
  empresa: '#0d5c63',
  socio: '#7c5cbf',
  email: '#e8a33d',
  telefone: '#2f80ed',
  endereco: '#8a6d3b',
  marca: '#b33a3a',
};

const NETWORK_EDGE_COLOR = {
  socio_de: '#0d5c63',
  mesmo_email: '#e8a33d',
  mesmo_telefone: '#2f80ed',
  mesmo_endereco: '#8a6d3b',
  mesma_marca: '#b33a3a',
};

const NETWORK_EDGE_LABEL = {
  socio_de: 'Sócio',
  mesmo_email: 'E-mail',
  mesmo_telefone: 'Telefone',
  mesmo_endereco: 'Endereço',
  mesma_marca: 'Marca',
};

function networkNodeRadius(node) {
  if (node.tipo === 'empresa') return node.central ? 17 : 9;
  if (node.tipo === 'socio') return 8;
  return node.hub ? 11 : 7;
}

function networkNodeLabel() {
  // O usuário precisa ler o nome em cada conexão, não só no centro.
  return true;
}

function networkNodeColor(node) {
  if (node.central) return '#e8a33d';
  if (node.ring === 2) return '#7c5cbf';
  return NETWORK_NODE_COLOR[node.tipo] ?? '#7b8b92';
}

function shorten(value, size = 30) {
  const text = String(value ?? '');
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
}

function geometryCenter(geometry) {
  if (!geometry) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      minX = Math.min(minX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxX = Math.max(maxX, coords[0]);
      maxY = Math.max(maxY, coords[1]);
      return;
    }
    for (const item of coords) walk(item);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

async function ensureNetworkCentroids() {
  if (state.networkCentroids.municipio.size > 0) return;
  if (state.networkCentroidsPromise) return state.networkCentroidsPromise;
  state.networkCentroidsPromise = (async () => {
    const [municipios, estados] = await Promise.all([
      fetchJson('/geo/municipios.geojson'),
      fetchJson('/geo/estados.geojson'),
    ]);
    for (const feature of municipios.features ?? []) {
      const center = geometryCenter(feature.geometry);
      if (center) state.networkCentroids.municipio.set(String(feature.properties.codigo), center);
    }
    for (const feature of estados.features ?? []) {
      const center = geometryCenter(feature.geometry);
      if (center) state.networkCentroids.uf.set(String(feature.properties.uf), center);
    }
  })();
  try {
    await state.networkCentroidsPromise;
  } finally {
    state.networkCentroidsPromise = null;
  }
}

function networkCoordinates(empresa) {
  if (empresa.municipio_ibge) {
    const point = state.networkCentroids.municipio.get(String(empresa.municipio_ibge));
    if (point) return point;
  }
  if (empresa.uf) {
    const point = state.networkCentroids.uf.get(String(empresa.uf));
    if (point) return point;
  }
  return null;
}

function ensureNetworkMap() {
  if (state.networkMap) {
    state.networkMap.resize();
    return Promise.resolve(state.networkMapReady);
  }
  if (!$('network-map')) return Promise.resolve(false);

  return new Promise((resolve) => {
    const map = new maplibregl.Map({
      container: 'network-map',
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#dbe8ec' } },
        ],
      },
      bounds: [
        [-74, -34],
        [-34, 6],
      ],
      fitBoundsOptions: { padding: 24 },
      minZoom: 2.4,
      maxZoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    state.networkMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (event) => console.error('network map error', event.error));
    map.on('load', async () => {
      try {
        const estados = await fetchJson('/geo/estados.geojson');
        map.addSource('network-estados', { type: 'geojson', data: estados });
        map.addLayer({
          id: 'network-estados-fill',
          type: 'fill',
          source: 'network-estados',
          paint: { 'fill-color': '#f7fbfb', 'fill-opacity': 1 },
        });
        map.addLayer({
          id: 'network-estados-line',
          type: 'line',
          source: 'network-estados',
          paint: { 'line-color': '#b8ced3', 'line-width': 1, 'line-opacity': 1 },
        });
      } catch (error) {
        console.error('network map states error', error);
      }
      map.fitBounds(
        [
          [-74, -34],
          [-34, 6],
        ],
        { padding: 24, animate: false },
      );
      map.addSource('network-companies', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'network-halo',
        type: 'circle',
        source: 'network-companies',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'central'], false], 18, 11],
          'circle-color': '#ffffff',
          'circle-opacity': 0.7,
        },
      });
      map.addLayer({
        id: 'network-points',
        type: 'circle',
        source: 'network-companies',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'central'], false], 9, 6],
          'circle-color': [
            'case',
            ['boolean', ['get', 'central'], false],
            '#e8a33d',
            '#0d5c63',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
      map.on('click', 'network-points', (event) => {
        const feature = event.features?.[0];
        const base = feature?.properties?.cnpj_base;
        if (base) openDetail(base);
      });
      map.on('mouseenter', 'network-points', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'network-points', () => {
        map.getCanvas().style.cursor = '';
      });
      state.networkMapReady = true;
      map.resize();
      if (state.network) void updateNetworkMap(state.network);
      resolve(true);
    });
  });
}

async function updateNetworkMap(data) {
  if (!state.networkMap) return;
  await ensureNetworkCentroids();
  if (!state.networkMapReady) return;

  const features = [];
  for (const empresa of data.empresas ?? []) {
    const coordinates = networkCoordinates(empresa);
    if (!coordinates) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates },
      properties: {
        cnpj_base: empresa.cnpj_base,
        razao_social: empresa.razao_social,
        relacoes: (empresa.relacoes ?? []).join(', '),
        central: Boolean((empresa.relacoes ?? []).includes('centro')),
        situacao: empresa.situacao ?? '',
      },
    });
  }

  state.networkMap.getSource('network-companies')?.setData({
    type: 'FeatureCollection',
    features,
  });
  $('network-map-count').textContent = `${fmtNumber(features.length)} de ${fmtNumber(
    data.empresas?.length ?? 0,
  )} com localização`;

  if (features.length > 0) {
    // A visão padrão é o Brasil inteiro; o usuário pode aproximar com os
    // controles do mapa. Isso evita que uma rede local esconda o território.
    state.networkMap.fitBounds(
      [
        [-74, -34],
        [-34, 6],
      ],
      { padding: 24, animate: false },
    );
    state.networkMapFitted = true;
  }
}

function renderNetworkGraph(data) {
  const container = $('network-graph');
  if (!container) return;
  const activeEdges = (data.edges ?? []).filter((edge) => state.networkFilters.has(edge.tipo));
  const activeNodeIds = new Set();
  for (const edge of activeEdges) {
    activeNodeIds.add(edge.origem);
    activeNodeIds.add(edge.destino);
  }
  const nodes = (data.nodes ?? []).filter((node) => node.central || activeNodeIds.has(node.id));
  if (!nodes.length) {
    container.innerHTML = '<p class="graph-empty muted">Nenhuma ligação com os filtros atuais.</p>';
    return;
  }

  const width = Math.max(560, Math.round(container.clientWidth || 900));
  const height = Math.max(420, Math.round(container.clientHeight || 640));
  const positions = new Map();
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    const radius = node.central ? 0 : Math.min(width, height) * 0.34;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    });
  });

  const degree = new Map();
  for (const edge of activeEdges) {
    degree.set(edge.origem, (degree.get(edge.origem) ?? 0) + 1);
    degree.set(edge.destino, (degree.get(edge.destino) ?? 0) + 1);
  }

  for (let iteration = 0; iteration < 180; iteration++) {
    const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id);
        const b = positions.get(nodes[j].id);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.max(24, Math.hypot(dx, dy));
        const force = 5200 / (distance * distance);
        const ux = dx / distance;
        const uy = dy / distance;
        forces.get(nodes[i].id).x += ux * force;
        forces.get(nodes[i].id).y += uy * force;
        forces.get(nodes[j].id).x -= ux * force;
        forces.get(nodes[j].id).y -= uy * force;
      }
    }
    for (const edge of activeEdges) {
      const a = positions.get(edge.origem);
      const b = positions.get(edge.destino);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = edge.tipo === 'socio_de' ? 135 : 110;
      const force = (distance - desired) * 0.0035;
      const ux = dx / distance;
      const uy = dy / distance;
      forces.get(edge.origem).x += ux * force;
      forces.get(edge.origem).y += uy * force;
      forces.get(edge.destino).x -= ux * force;
      forces.get(edge.destino).y -= uy * force;
    }
    for (const node of nodes) {
      const point = positions.get(node.id);
      const force = forces.get(node.id);
      force.x += (width / 2 - point.x) * 0.0009;
      force.y += (height / 2 - point.y) * 0.0009;
      point.x += Math.max(-7, Math.min(7, force.x));
      point.y += Math.max(-7, Math.min(7, force.y));
      point.x = Math.max(36, Math.min(width - 36, point.x));
      point.y = Math.max(36, Math.min(height - 36, point.y));
    }
  }

  const edgeSvg = activeEdges
    .map((edge) => {
      const a = positions.get(edge.origem);
      const b = positions.get(edge.destino);
      if (!a || !b) return '';
      const color = NETWORK_EDGE_COLOR[edge.tipo] ?? '#9aa8ae';
      const widthLine = edge.tipo === 'socio_de' ? 1.8 : 1.1;
      return `<line class="graph-edge ${escapeHtml(edge.confianca)}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(
        1,
      )}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-width="${widthLine}" />`;
    })
    .join('');

  const nodeSvg = nodes
    .map((node) => {
      const point = positions.get(node.id);
      const radius = networkNodeRadius(node);
      const color = networkNodeColor(node);
      const label = networkNodeLabel();
      const labelY = point.y - radius - 8;
      const subY = point.y + radius + 13;
      const safeLabel = shorten(node.rotulo, 34);
      const safeSub = shorten(node.subtitulo, 40);
      const cn = node.cnpj_base ? ` data-cnpj="${escapeHtml(node.cnpj_base)}"` : '';
      return `
        <g class="graph-node" data-node-id="${escapeHtml(node.id)}"${cn} data-tipo="${escapeHtml(
          node.tipo,
        )}" data-label="${escapeHtml(node.rotulo)}" data-sub="${escapeHtml(node.subtitulo)}">
          <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius}" fill="${color}" stroke="${
            node.hub ? '#e8a33d' : '#ffffff'
          }" stroke-width="${node.hub ? 3 : 1.5}" />
          <title>${escapeHtml(node.rotulo)} — ${escapeHtml(node.subtitulo)}</title>
          ${
            label
              ? `<text class="graph-label" x="${point.x.toFixed(1)}" y="${labelY.toFixed(
                  1,
                )}" text-anchor="middle">${escapeHtml(safeLabel)}</text>
                 <text class="graph-label sub" x="${point.x.toFixed(1)}" y="${subY.toFixed(
                   1,
                 )}" text-anchor="middle">${escapeHtml(safeSub)}</text>`
              : ''
          }
        </g>`;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de ligações da empresa">
      ${edgeSvg}
      ${nodeSvg}
    </svg>`;

  const svg = container.querySelector('svg');
  svg?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-node-id]');
    if (!target) return;
    if (target.dataset.cnpj) {
      openDetail(target.dataset.cnpj);
      return;
    }
    showToast(`${target.dataset.label} · ${target.dataset.sub}`);
  });
}

function renderNetworkSummary(data) {
  const resumo = data.resumo ?? {};
  const isHub = data.tipo_rede === 'hub';
  const kpis = isHub
    ? [
        ['Empresas', data.hub?.empresas],
        ['Ativas', data.hub?.ativas],
        ['UFs', data.hub?.ufs],
        ['CNAEs', data.hub?.cnaes],
        ['Capital somado', fmtMoney(data.hub?.capital_somado)],
        ['Idade média', data.hub?.idade_media != null ? `${Number(data.hub.idade_media).toFixed(1)} anos` : '—'],
      ]
    : [
        ['Sócios', resumo.socios],
        ['Empresas via sócios', resumo.empresas_via_socios],
        ['Contatos', resumo.contatos],
        ['Empresas via contatos', resumo.empresas_via_contatos],
        ['Hubs', resumo.hubs],
        ['Empresas no grafo', resumo.empresas_no_grafo],
      ];
  $('network-summary').innerHTML = `
    <div class="network-summary">
      ${kpis
        .map(
          ([label, value]) =>
            `<div class="map-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(
              typeof value === 'string' ? value : fmtNumber(value),
            )}</strong></div>`,
        )
        .join('')}
      <p class="network-summary-note">
        Contagens totais da rede. O grafo exibe uma amostra limitada de empresas por nó.
      </p>
    </div>`;
}

function renderNetworkCompanies(data) {
  const companies = [...(data.empresas ?? [])]
    .sort((a, b) => {
      const byRelations = (b.relacoes?.length ?? 0) - (a.relacoes?.length ?? 0);
      return byRelations || String(a.razao_social).localeCompare(String(b.razao_social));
    })
    .slice(0, 24);
  if (!companies.length) {
    $('network-companies').innerHTML = '<p class="muted small">Nenhuma empresa conectada.</p>';
    return;
  }
  $('network-companies').innerHTML = `
    <div class="network-companies">
      ${companies
        .map((item) => {
          const relacoes = (item.relacoes ?? [])
            .filter((value) => value !== 'centro')
            .map((value) => value[0]?.toUpperCase() + value.slice(1))
            .slice(0, 3)
            .join(' · ');
          const local = [item.municipio, item.uf].filter(Boolean).join(' / ');
          return `<div class="network-company" data-cnpj="${escapeHtml(item.cnpj_base)}">
            <div class="network-company-name">${escapeHtml(item.razao_social)}</div>
            <div class="network-company-tag">${escapeHtml(
              item.ring === 2 ? `2ª camada · ${relacoes || 'sócio'}` : relacoes || 'centro',
            )}</div>
            <div class="network-company-meta">${escapeHtml(local || 'Local não informado')} · ${escapeHtml(
              item.situacao ?? 'situação não informada',
            )}</div>
          </div>`;
        })
        .join('')}
    </div>`;
}

function renderNetwork(data) {
  state.network = data;
  state.networkMapFitted = false;
  const centro = data.centro ?? {};
  const isHub = data.tipo_rede === 'hub';
  $('network-title').textContent = centro.razao_social || 'Rede da empresa';
  $('network-subtitle').textContent = isHub
    ? `${fmtNumber(data.hub?.empresas)} empresas · ${fmtNumber(data.hub?.ufs)} UF(s) · ${fmtNumber(
        data.hub?.cnaes,
      )} CNAE(s) · ${fmtNumber(data.hub?.ativas)} ativas`
    : `${centro.cnpj_formatado || centro.cnpj_base || ''} · ${
        data.resumo?.empresas_no_grafo ?? 0
      } empresa(s) no grafo`;
  $('network-legend').innerHTML = `
    ${Object.entries(NETWORK_NODE_COLOR)
      .map(
        ([tipo, color]) =>
          `<span class="legend-item"><i class="legend-dot" style="background:${color}"></i>${escapeHtml(
            tipo === 'socio' ? 'Sócio' : tipo === 'empresa' ? 'Empresa' : tipo[0].toUpperCase() + tipo.slice(1),
          )}</span>`,
      )
      .join('')}
    <span class="legend-item"><i class="legend-dot" style="background:#e8a33d"></i>Hub / centro</span>
    <span class="legend-item"><i class="legend-dot" style="background:#7c5cbf"></i>2ª camada</span>`;
  renderNetworkSummary(data);
  renderNetworkCompanies(data);
  renderNetworkGraph(data);
  void ensureNetworkMap().then(() => updateNetworkMap(data));
  $('network-suggestions').innerHTML = '';
}

async function loadNetworkByCnpj(cnpj) {
  if (state.networkLoading) return;
  state.networkLoading = true;
  $('network-title').textContent = 'Carregando rede…';
  $('network-subtitle').textContent = 'Consultando sócios, contatos, endereços e marcas.';
  $('network-graph').innerHTML = '<p class="graph-empty muted">Calculando ligações…</p>';
  try {
    const data = await fetchJson(`/api/rede/empresa/${encodeURIComponent(cnpj)}`);
    renderNetwork(data);
    const normalized = String(cnpj).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const url = new URL(window.location.href);
    url.hash = `rede=${normalized}`;
    window.history.replaceState(null, '', url);
    $('network-q').value = data.centro?.cnpj_formatado || normalized;
  } catch (error) {
    console.error(error);
    $('network-title').textContent = 'Rede não encontrada';
    $('network-graph').innerHTML = `<p class="graph-empty muted">${escapeHtml(error.message)}</p>`;
    showToast(error.message, 'error');
  } finally {
    state.networkLoading = false;
  }
}

async function searchNetwork() {
  const query = $('network-q').value.trim();
  if (!query) {
    showToast('Informe um CNPJ ou nome de empresa.', 'error');
    return;
  }
  const digits = query.replace(/[^0-9A-Za-z]/g, '');
  if (digits.length === 14 || digits.length === 8) {
    await loadNetworkByCnpj(digits);
    return;
  }
  await loadNetworkSuggestions(query);
}

function clearNetwork() {
  state.network = null;
  $('network-q').value = '';
  $('network-suggestions').innerHTML = '';
  $('network-title').textContent = 'Redes identificadas';
  $('network-subtitle').textContent =
    'Selecione um hub abaixo ou busque uma empresa para abrir a rede completa.';
  $('network-graph').innerHTML =
    '<p class="graph-empty muted">A rede aparece aqui depois da busca ou da seleção de um hub.</p>';
  $('network-summary').innerHTML = '';
  $('network-companies').innerHTML = '';
  $('network-map-count').textContent = 'Selecione uma rede';
  const url = new URL(window.location.href);
  url.hash = 'rede';
  window.history.replaceState(null, '', url);
}

const HUB_TYPE_LABEL = {
  email: 'E-mail',
  telefone: 'Telefone',
  endereco: 'Endereço',
  marca: 'Marca',
};

function hubFilterParams() {
  const params = new URLSearchParams();
  params.set('tipo', $('hub-tipo').value);
  params.set('min_empresas', $('hub-min').value);
  params.set('limit', '24');
  const uf = $('hub-uf').value;
  if (uf) params.set('uf', uf);
  const cnae = $('hub-cnae').value;
  if (cnae) params.set('cnae', cnae);
  const q = $('hub-q').value.trim();
  if (q) params.set('q', q);
  return params;
}

async function loadHubs() {
  if (!$('hub-list')) return;
  if (state.hubLoading) {
    state.hubPending = true;
    return;
  }
  state.hubLoading = true;
  const token = ++state.hubToken;
  $('hub-list').innerHTML = '<p class="muted small">Atualizando redes identificadas…</p>';
  try {
    const payload = await fetchJson(`/api/rede/hubs?${hubFilterParams().toString()}`);
    if (token !== state.hubToken) return;
    state.hubs = payload.data ?? [];
    renderHubs(state.hubs);
  } catch (error) {
    console.error(error);
    if (token === state.hubToken) {
      $('hub-list').innerHTML = `<p class="muted small">Não foi possível carregar as redes: ${escapeHtml(
        error.message,
      )}</p>`;
    }
  } finally {
    state.hubLoading = false;
    if (state.hubPending) {
      state.hubPending = false;
      void loadHubs();
    }
  }
}

function renderHubs(hubs) {
  const container = $('hub-list');
  if (!hubs.length) {
    container.innerHTML =
      '<p class="muted small">Nenhum hub com esses filtros. Reduza o mínimo de empresas ou limpe a UF/CNAE.</p>';
    return;
  }
  container.innerHTML = hubs
    .map((hub) => {
      const tipo = HUB_TYPE_LABEL[hub.tipo] ?? hub.tipo;
      const exemplo = [hub.exemplo_razao_social, hub.exemplo_uf].filter(Boolean).join(' · ');
      return `<article class="hub-card" data-tipo="${escapeHtml(hub.tipo)}" data-valor="${escapeHtml(
        hub.valor,
      )}" data-rotulo="${escapeHtml(hub.rotulo)}">
        <header>
          <strong title="${escapeHtml(hub.rotulo)}">${escapeHtml(hub.rotulo)}</strong>
          <span class="hub-count">${fmtNumber(hub.empresas)} empresas</span>
        </header>
        <div class="hub-type">${escapeHtml(tipo)} · ${fmtNumber(hub.ufs)} UF(s) · ${fmtNumber(
          hub.cnaes,
        )} CNAE(s)</div>
        <p>${fmtNumber(hub.ativas)} ativas · ${fmtMoney(hub.capital_somado)} capital somado</p>
        <p title="${escapeHtml(exemplo)}">${escapeHtml(exemplo || 'Sem empresa de exemplo')}</p>
      </article>`;
    })
    .join('');
}

async function loadHub(tipo, valor) {
  if (state.networkLoading) return;
  state.networkLoading = true;
  $('network-title').textContent = 'Carregando rede…';
  $('network-subtitle').textContent = 'Consultando as empresas ligadas a este hub.';
  $('network-graph').innerHTML = '<p class="graph-empty muted">Calculando ligações…</p>';
  try {
    const params = new URLSearchParams({ tipo, valor, limit: '30' });
    const data = await fetchJson(`/api/rede/hub?${params.toString()}`);
    renderNetwork(data);
    const url = new URL(window.location.href);
    url.hash = 'rede';
    window.history.replaceState(null, '', url);
  } catch (error) {
    console.error(error);
    $('network-title').textContent = 'Rede não encontrada';
    $('network-graph').innerHTML = `<p class="graph-empty muted">${escapeHtml(error.message)}</p>`;
    showToast(error.message, 'error');
  } finally {
    state.networkLoading = false;
  }
}

async function loadNetworkSuggestions(query) {
  const text = String(query ?? '').trim();
  if (text.length < 2) {
    $('network-suggestions').innerHTML = '';
    return;
  }
  $('network-suggestions').innerHTML = '<p class="muted small">Buscando empresas…</p>';
  try {
    const params = new URLSearchParams({
      q: text,
      page_size: '8',
      sort: 'razao_social',
      order: 'asc',
    });
    const payload = await fetchJson(`/api/empresas?${params.toString()}`);
    const rows = payload.data ?? [];
    if (!rows.length) {
      $('network-suggestions').innerHTML =
        '<p class="muted small">Nenhuma empresa encontrada. Tente outro nome ou o CNPJ.</p>';
      return;
    }
    $('network-suggestions').innerHTML = rows
      .map(
        (row) => `<div class="network-suggestion" data-cnpj="${escapeHtml(row.cnpj)}">
          <strong>${escapeHtml(row.razao_social || row.cnpj_formatado)}</strong>
          <span>${escapeHtml(row.cnpj_formatado || row.cnpj)} · ${escapeHtml(
            [row.municipio_nome, row.uf].filter(Boolean).join(' / '),
          )}</span>
        </div>`,
      )
      .join('');
  } catch (error) {
    console.error(error);
    $('network-suggestions').innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`;
  }
}

/* ------------------------------------------------------------------ */
/* Cobertura histórica                                                 */
/* ------------------------------------------------------------------ */

async function loadCoverage() {
  const container = $('coverage-grid');
  if (!container) return;
  try {
    const payload = await fetchJson('/api/historico/cobertura');
    const labels = {
      oficial: 'Oficial',
      validado: 'Validado',
      espelho: 'Espelho',
      reconstruido: 'Reconstruído',
      parcial: 'Parcial',
      sem_fonte: 'Sem fonte',
    };
    container.innerHTML = (payload.ranges ?? [])
      .map(
        (range) => `<article class="coverage-card">
          <header>
            <h3>${escapeHtml(range.periodo)}</h3>
            <span class="coverage-badge coverage-${escapeHtml(range.camada)}">${escapeHtml(
              labels[range.camada] ?? range.camada,
            )}</span>
          </header>
          <p><strong>${escapeHtml(range.fonte)}</strong></p>
          <p>${escapeHtml(range.campos)}</p>
          <p>${escapeHtml(range.observacao)}</p>
        </article>`,
      )
      .join('');

    const validation = payload.validation;
    const panel = $('coverage-validation-panel');
    if (!validation) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const agreement = validation.agreement ?? {};
    const coverage = validation.coverage ?? {};
    const sample = validation.sample ?? {};
    const files = validation.files ?? [];
    $('coverage-validation-status').textContent = `${fmtNumber(sample.scanned ?? 0)} amostrados`;
    const kpis = [
      ['Match de base', `${coverage.pct_base ?? 0}%`],
      ['Match completo', `${coverage.pct_full ?? 0}%`],
      ['Nome exato', `${agreement.pct_name_exact ?? 0}%`],
      ['Situação', `${agreement.pct_situation ?? 0}%`],
      ['Abertura', `${agreement.pct_opening_date ?? 0}%`],
      ['CNAE', `${agreement.pct_cnae ?? 0}%`],
      ['UF', `${agreement.pct_uf ?? 0}%`],
      ['Arquivos', files.length],
      ['Empresas no arquivo 2019', files.reduce((sum, item) => sum + Number(item.total_companies ?? 0), 0)],
    ];
    $('coverage-validation').innerHTML = kpis
      .map(
        ([label, value]) =>
          `<div class="map-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(
            typeof value === 'number' ? fmtNumber(value) : String(value),
          )}</strong></div>`,
      )
      .join('');
    const archiveCompanies = files.reduce(
      (sum, item) => sum + Number(item.total_companies ?? 0),
      0,
    );
    $('coverage-validation-note').textContent = `Os ${fmtNumber(
      archiveCompanies,
    )} são empresas do arquivo 2019 do Wayback (${files.length} arquivo(s) baixado(s)). A base local tem ${fmtNumber(
      state.meta?.estabelecimentos,
    )} estabelecimentos na amostra; são recortes diferentes.`;
  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="muted">Não foi possível carregar a cobertura: ${escapeHtml(
      error.message,
    )}</p>`;
  }
}

/* ------------------------------------------------------------------ */
/* Ficha cadastral                                                     */
/* ------------------------------------------------------------------ */

function formatPassportFact(fact) {
  if (fact.id === 'capital') return fmtMoney(fact.valor);
  if (fact.id === 'abertura') return fmtDate(fact.valor);
  if (['socios', 'estabelecimentos', 'contatos', 'rede'].includes(fact.id)) {
    return fmtNumber(fact.valor);
  }
  return escapeHtml(fact.valor ?? '—');
}

function renderPassport(passaporte, cnpjBase) {
  if (!passaporte) return '';
  const facts = (passaporte.fatos ?? [])
    .map(
      (fact) => `<div class="passport-fact">
        <span>${escapeHtml(fact.rotulo)}</span>
        <strong>${formatPassportFact(fact)}</strong>
        ${fact.detalhe ? `<small>${escapeHtml(fact.detalhe)}</small>` : ''}
      </div>`,
    )
    .join('');
  const events = (passaporte.eventos ?? [])
    .map(
      (event) => `<li class="passport-event">
        <time>${escapeHtml(fmtDate(event.data))}</time>
        <strong>${escapeHtml(event.titulo)}</strong>
        ${event.descricao ? `<p>${escapeHtml(event.descricao)}</p>` : ''}
      </li>`,
    )
    .join('');
  return `
    <div class="detail-section passport-section">
      <div class="panel-head">
        <h3>Passaporte histórico</h3>
        <span class="tag">${escapeHtml(passaporte.cobertura?.snapshot ?? '')}</span>
      </div>
      <div class="passport-facts">${facts}</div>
      ${
        events
          ? `<ol class="passport-timeline">${events}</ol>`
          : '<p class="muted small">Sem eventos datados para esta empresa.</p>'
      }
      <div class="passport-coverage">
        <strong>Cobertura:</strong> ${escapeHtml(passaporte.cobertura?.historico_empresa ?? '')}
        ${escapeHtml(passaporte.cobertura?.observacao ?? '')}
      </div>
      <div class="passport-actions">
        <button type="button" class="btn btn-primary btn-small" data-open-network="${escapeHtml(
          cnpjBase,
        )}">Abrir mapa de ligações</button>
      </div>
    </div>`;
}

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

    ${renderPassport(data.passaporte, data.cnpj_base)}

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

function renderTimelineChart(containerId, items) {
  const container = $(containerId);
  const data = (items ?? [])
    .map((item) => ({
      ano: Number(String(item.periodo).slice(0, 4)),
      nascimentos: Number(item.nascimentos) || 0,
      fechamentos: Number(item.fechamentos) || 0,
    }))
    .filter((item) => Number.isFinite(item.ano))
    .sort((a, b) => a.ano - b.ano);

  const cutoff = new Date().getFullYear() - 30;
  const filtered = data.filter((item) => item.ano >= cutoff);
  if (!filtered.length) {
    container.innerHTML =
      '<p class="chart-empty">Sem nascimentos ou fechamentos para os filtros atuais.</p>';
    return;
  }

  const width = Math.max(320, Math.round(container.clientWidth || 820));
  const height = containerId === 'map-timeline' ? 210 : 240;
  const pad = { left: 44, right: 16, top: 18, bottom: 34 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(
    ...filtered.flatMap((item) => [item.nascimentos, item.fechamentos]),
    1,
  );
  const groupWidth = plotWidth / filtered.length;
  const barWidth = Math.max(2, Math.min(11, groupWidth * 0.3));

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = pad.top + plotHeight * ratio;
      const value = Math.round(max * (1 - ratio));
      return `
        <line class="axis" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
        <text class="label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${fmtNumber(value)}</text>`;
    })
    .join('');

  const bars = filtered
    .map((item, index) => {
      const center = pad.left + index * groupWidth + groupWidth / 2;
      const birthHeight = (item.nascimentos / max) * plotHeight;
      const deathHeight = (item.fechamentos / max) * plotHeight;
      const birthY = pad.top + plotHeight - birthHeight;
      const deathY = pad.top + plotHeight - deathHeight;
      return `
        <rect x="${center - barWidth - 1}" y="${birthY}" width="${barWidth}" height="${birthHeight}" rx="2" fill="#147d86">
          <title>${item.ano}: ${fmtNumber(item.nascimentos)} nascimentos</title>
        </rect>
        <rect x="${center + 1}" y="${deathY}" width="${barWidth}" height="${deathHeight}" rx="2" fill="#b33a3a">
          <title>${item.ano}: ${fmtNumber(item.fechamentos)} fechamentos</title>
        </rect>`;
    })
    .join('');

  const labelEvery = Math.max(
    1,
    Math.ceil(filtered.length / Math.max(4, Math.floor(width / 58))),
  );
  const labels = filtered
    .map((item, index) => {
      if (index % labelEvery !== 0 && index !== filtered.length - 1) return '';
      const center = pad.left + index * groupWidth + groupWidth / 2;
      return `<text class="label" x="${center}" y="${height - 10}" text-anchor="middle">${item.ano}</text>`;
    })
    .join('');

  container.innerHTML = `
    <div class="timeline-legend">
      <span class="legend-item"><i class="legend-dot" style="background:#147d86"></i>Nascimentos</span>
      <span class="legend-item"><i class="legend-dot" style="background:#b33a3a"></i>Fechamentos</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Nascimentos e fechamentos por ano">
      ${gridLines}
      ${bars}
      ${labels}
    </svg>`;
}

function renderDashboard(data, timeline = []) {
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
  renderTimelineChart('chart-aberturas', timeline);
  renderBars('chart-idades', data.idades ?? []);
  renderBars('chart-capital', data.capital ?? []);
  renderBars('chart-socios', data.socios ?? []);
}

async function loadDashboard() {
  if (state.dashboardLoading) {
    state.pendingDashboard = true;
    return;
  }
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
    const [data, timeline] = await Promise.all([
      fetchJson(`/api/dashboard?${params.toString()}`),
      fetchJson(`/api/timeline?${params.toString()}`).catch(() => ({ data: [] })),
    ]);
    renderDashboard(data, timeline.data ?? []);
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
    if (state.pendingDashboard) {
      state.pendingDashboard = false;
      void loadDashboard();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  state.page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  state.pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') ?? 25) || 25));
  const sort = params.get('sort');
  if (['razao_social', 'data_inicio', 'capital_social', 'socios'].includes(sort)) {
    state.searchSort = sort;
  }
  const order = params.get('order');
  if (order === 'asc' || order === 'desc') state.searchOrder = order;
  if ($('sort')) $('sort').value = state.searchSort;

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

async function loadSavedSearches() {
  try {
    const payload = await fetchJson('/api/buscas');
    state.savedSearches = payload.data ?? [];
    const container = $('saved-searches');
    if (!state.savedSearches.length) {
      container.innerHTML = '<p class="muted small">Nenhuma busca salva.</p>';
      return;
    }
    container.innerHTML = state.savedSearches
      .map(
        (item) => `
          <div class="saved-item">
            <div class="saved-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${item.created_at ? fmtDate(String(item.created_at).slice(0, 10)) : ''}</span>
            </div>
            <div class="saved-actions">
              <button type="button" class="btn btn-small" data-open="${escapeHtml(item.id)}">Abrir</button>
              <button type="button" class="btn btn-small btn-danger" data-delete="${escapeHtml(item.id)}">Excluir</button>
            </div>
          </div>`,
      )
      .join('');
  } catch (error) {
    console.error(error);
  }
}

function openSaveSearchDialog() {
  $('save-search-name').value = '';
  $('save-search-dialog').showModal();
  setTimeout(() => $('save-search-name').focus(), 50);
}

async function saveCurrentSearch() {
  const name = $('save-search-name').value.trim();
  if (!name) {
    showToast('Informe um nome para a busca.', 'error');
    return;
  }
  const filters = Object.fromEntries(buildFilterParams().entries());
  try {
    await fetchJson('/api/buscas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters }),
    });
    $('save-search-dialog').close();
    showToast('Busca salva.', 'success');
    await loadSavedSearches();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  }
}

async function applySavedSearch(filters) {
  form.reset();
  $('situacao').value = filters.situacao ?? '';
  $('idade_min').value = filters.idade_min ?? '3';
  const fields = [
    'q',
    'uf',
    'situacao',
    'porte',
    'idade_min',
    'capital_min',
    'capital_max',
    'socios_min',
    'socios_max',
    'cnae',
  ];
  for (const field of fields) {
    if (filters[field] !== undefined) $(field).value = filters[field];
  }
  for (const id of ['simples', 'mei', 'com_email', 'com_telefone', 'matriz']) {
    $(id).checked = filters[id] === 'true';
  }
  refreshSelect($('cnae'));
  refreshSelect($('situacao'));
  refreshSelect($('porte'));
  await loadCities($('uf'), $('municipio'));
  if (filters.municipio) {
    $('municipio').value = filters.municipio;
    refreshSelect($('municipio'));
  }
  setView('search');
  await search({ resetPage: true });
  showToast('Busca carregada.', 'success');
}

function wireEvents() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });

  form.addEventListener('change', async (event) => {
    const target = event.target;
    if (!target?.id) return;
    if (target.id === 'uf') {
      await loadCities($('uf'), $('municipio'));
      void search({ resetPage: true });
      return;
    }
    if (target.id === 'q') return;
    void search({ resetPage: true });
  });

  $('q').addEventListener('input', () => {
    debounce('searchTimer', () => void search({ resetPage: true }), 400);
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

  dashboardForm.addEventListener('change', async (event) => {
    const target = event.target;
    if (!target?.id) return;
    if (target.id === 'dash-uf') {
      await loadCities($('dash-uf'), $('dash-municipio'));
      void loadDashboard();
      return;
    }
    debounce('dashboardTimer', () => void loadDashboard(), 250);
  });

  $('dash-clear').addEventListener('click', async () => {
    dashboardForm.reset();
    $('dash-idade').value = '0';
    refreshSelect($('dash-cnae'));
    await loadCities($('dash-uf'), $('dash-municipio'));
    void loadDashboard();
  });

  $('map-filters').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMapSelection();
    await loadMapMetrics(state.mapLevel);
    resetTerritoryPreview();
  });

  $('map-filters').addEventListener('change', (event) => {
    if (event.target?.id === 'map-metric') return;
    debounce(
      'mapTimer',
      () => {
        clearMapSelection();
        void loadMapMetrics(state.mapLevel).then(() => resetTerritoryPreview());
      },
      250,
    );
  });

  $('map-clear').addEventListener('click', async () => {
    $('map-filters').reset();
    $('map-idade').value = '0';
    state.mapMetric = 'estabelecimentos';
    refreshSelect($('map-cnae'));
    refreshSelect($('map-situacao'));
    refreshSelect($('map-metric'));
    clearMapSelection();
    await loadMapMetrics(state.mapLevel);
    applyMetricToMap();
    resetTerritoryPreview();
  });

  $('map-metric').addEventListener('change', () => {
    state.mapMetric = $('map-metric').value;
    applyMetricToMap();
  });

  document.querySelectorAll('#map-level button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.level === state.mapLevel) return;
      void setMapLevel(button.dataset.level);
    });
  });

  $('map-see-all').addEventListener('click', () => {
    state.mapListLimit = state.mapListLimit > 6 ? 6 : 30;
    const token = ++state.mapPreviewToken;
    void loadMapCompanies(state.mapSelection, state.mapListLimit, token);
  });

  $('map-company-list').addEventListener('click', (event) => {
    const row = event.target.closest('.map-company[data-cnpj]');
    if (row) openDetail(row.dataset.cnpj);
  });

  $('map-market').addEventListener('click', (event) => {
    const row = event.target.closest('.map-company[data-cnpj]');
    if (row) openDetail(row.dataset.cnpj);
  });

  $('network-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void searchNetwork();
  });

  $('network-q').addEventListener('input', () => {
    const query = $('network-q').value.trim();
    if (query.length < 2) {
      $('network-suggestions').innerHTML = '';
      return;
    }
    debounce('networkSuggestionTimer', () => void loadNetworkSuggestions(query), 350);
  });

  $('network-clear').addEventListener('click', clearNetwork);

  $('network-recenter').addEventListener('click', () => {
    if (state.network) renderNetworkGraph(state.network);
  });

  $('network-map-reset').addEventListener('click', () => {
    if (!state.networkMap) return;
    state.networkMap.fitBounds(
      [
        [-74, -34],
        [-34, 6],
      ],
      { padding: 24, animate: false },
    );
  });

  for (const id of ['hub-tipo', 'hub-min', 'hub-uf', 'hub-cnae']) {
    $(id).addEventListener('change', () => debounce('hubTimer', () => void loadHubs(), 250));
  }
  $('hub-q').addEventListener('input', () => debounce('hubTimer', () => void loadHubs(), 400));

  $('hub-list').addEventListener('click', (event) => {
    const card = event.target.closest('.hub-card[data-tipo][data-valor]');
    if (card) void loadHub(card.dataset.tipo, card.dataset.valor);
  });

  $('network-suggestions').addEventListener('click', (event) => {
    const row = event.target.closest('.network-suggestion[data-cnpj]');
    if (row) void loadNetworkByCnpj(row.dataset.cnpj);
  });

  $('network-companies').addEventListener('click', (event) => {
    const row = event.target.closest('.network-company[data-cnpj]');
    if (row) openDetail(row.dataset.cnpj);
  });

  $('network-filters').addEventListener('change', (event) => {
    const input = event.target.closest('input[data-edge]');
    if (!input) return;
    if (input.checked) state.networkFilters.add(input.dataset.edge);
    else state.networkFilters.delete(input.dataset.edge);
    if (state.network) renderNetworkGraph(state.network);
  });

  $('detail-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-network]');
    if (!button) return;
    $('detail').close();
    setView('rede');
    void loadNetworkByCnpj(button.dataset.openNetwork);
  });

  $('sort').addEventListener('change', () => {
    const value = $('sort').value;
    const mapping = {
      razao_social: ['razao_social', 'asc'],
      data_inicio: ['data_inicio', 'desc'],
      capital_social: ['capital_social', 'desc'],
      socios: ['socios', 'desc'],
    };
    const [sort, order] = mapping[value] ?? ['razao_social', 'asc'];
    state.searchSort = sort;
    state.searchOrder = order;
    search({ resetPage: true });
  });

  $('save-search').addEventListener('click', openSaveSearchDialog);
  $('close-save-search').addEventListener('click', () => $('save-search-dialog').close());
  $('cancel-save-search').addEventListener('click', () => $('save-search-dialog').close());
  $('save-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void saveCurrentSearch();
  });

  $('saved-searches').addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-open]');
    const deleteButton = event.target.closest('[data-delete]');
    if (openButton) {
      const item = state.savedSearches.find((saved) => saved.id === openButton.dataset.open);
      if (item) void applySavedSearch(item.filters);
    }
    if (deleteButton) {
      void (async () => {
        try {
          await fetchJson(`/api/buscas/${encodeURIComponent(deleteButton.dataset.delete)}`, {
            method: 'DELETE',
          });
          showToast('Busca excluída.', 'success');
          await loadSavedSearches();
        } catch (error) {
          console.error(error);
          showToast(error.message, 'error');
        }
      })();
    }
  });

  window.addEventListener('hashchange', () => {
    void applyHashRoute();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllSelects();
      if ($('detail').open) $('detail').close();
    }
  });
}

async function applyHashRoute() {
  if (window.location.hash === '#dashboard') {
    setView('dashboard', false);
    return;
  }
  if (window.location.hash === '#dados') {
    setView('dados', false);
    return;
  }
  if (window.location.hash.startsWith('#rede')) {
    setView('rede', false);
    const networkCnpj = window.location.hash.startsWith('#rede=')
      ? decodeURIComponent(window.location.hash.slice(6))
      : '';
    if (networkCnpj) await loadNetworkByCnpj(networkCnpj);
    return;
  }
  if (window.location.hash === '#busca') {
    setView('search', false);
    await search({ resetPage: false });
    return;
  }
  setView('mapa', false);
}

async function init() {
  wireEvents();
  try {
    await loadOptions();
    await loadMeta();
    await loadSavedSearches();
    const params = readUrlParams();
    enhanceAllSelects();
    await loadCities($('uf'), $('municipio'));
    if (params.get('municipio')) {
      $('municipio').value = params.get('municipio');
      refreshSelect($('municipio'));
    }
    await loadCities($('dash-uf'), $('dash-municipio'));

    await applyHashRoute();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    $('result-info').textContent = 'Falha ao inicializar a aplicação.';
    resultsBody.innerHTML = '<tr><td colspan="10" class="empty">Verifique se a API e o banco estão disponíveis.</td></tr>';
  }
}

void init();

