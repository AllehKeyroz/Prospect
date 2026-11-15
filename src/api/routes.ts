import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query, queryOne } from '../db/duckdb.js';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
} from '../db/appDb.js';
import { formatCnpj, isValidCnpj, normalizeCnpj } from '../lib/cnpj.js';
import { toCsvLine } from '../lib/text.js';
import {
  buildCountQuery,
  buildDashboardQueries,
  buildListQuery,
  buildResumoQuery,
  buildStatsQuery,
  toSearchInput,
} from './queryBuilder.js';
import {
  buildMapQuery,
  buildMarketQueries,
  buildTimelineQuery,
} from './geoQueries.js';
import {
  buildCompanyGraph,
  buildHubGraph,
} from './networkGraph.js';
import {
  DEFAULT_NETWORK_LIMITS,
  getContactCompanies,
  getContactList,
  getNetworkCompany,
  getNetworkSummary,
  getPartnerCompanies,
  getTargetPartners,
} from './networkQueries.js';
import {
  getHubCompanies,
  getHubExpansion,
  getHubSummary,
  listHubs,
} from './hubQueries.js';
import { buildPassport } from './passport.js';
import { coveragePayload } from '../history/coverage.js';
import {
  cnpjParamsSchema,
  dashboardSchema,
  exportSchema,
  hubDetailSchema,
  hubListSchema,
  idParamsSchema,
  mapaSchema,
  mercadoSchema,
  municipiosQuerySchema,
  networkQuerySchema,
  savedSearchSchema,
  searchSchema,
  statsSchema,
  timelineSchema,
} from './schemas.js';

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metaToObject(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function dashboardRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    total: asNumber(row.total),
    ...(row.ordem !== undefined ? { ordem: asNumber(row.ordem) } : {}),
  }));
}

function mapRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    estabelecimentos: asNumber(row.estabelecimentos),
    ativas: asNumber(row.ativas),
    aberturas_12m: asNumber(row.aberturas_12m),
    fechamentos_12m: asNumber(row.fechamentos_12m),
    simples: asNumber(row.simples),
    mei: asNumber(row.mei),
    com_email: asNumber(row.com_email),
    com_telefone: asNumber(row.com_telefone),
    idade_media: asNullableNumber(row.idade_media),
    capital_mediano: asNullableNumber(row.capital_mediano),
  }));
}

function timelineRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    periodo: row.periodo,
    nascimentos: asNumber(row.nascimentos),
    fechamentos: asNumber(row.fechamentos),
  }));
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    return value.replace('.', ',');
  }
  return String(value);
}

function addressLine(row: Record<string, unknown>): string {
  const parts = [
    row.tipo_logradouro,
    row.logradouro,
    row.numero,
    row.complemento,
  ].filter((part) => part !== null && part !== undefined && String(part).trim() !== '');
  return parts.join(' ');
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    try {
      await queryOne('SELECT 1 AS ok');
      const metaRows = await query<{ key: string; value: string }>('SELECT key, value FROM meta');
      const meta = metaToObject(metaRows);
      const memory = process.memoryUsage();
      return {
        ok: true,
        status: 'ok',
        db_ready: true,
        snapshot: meta.snapshot ?? config.snapshot,
        generated_at: meta.generated_at ?? null,
        rows: {
          estabelecimentos: asNumber(meta.estabelecimentos),
          empresas: asNumber(meta.empresas),
          socios: asNumber(meta.socios),
        },
        memory_mb: Math.round(memory.rss / 1024 / 1024),
        uptime_s: Math.round(process.uptime()),
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(503).send({ ok: false, error: 'Banco indisponível' });
    }
  });

  app.get('/api/meta', async () => {
    const rows = await query<{ key: string; value: string }>('SELECT key, value FROM meta');
    return metaToObject(rows);
  });

  app.get('/api/historico/cobertura', async () => coveragePayload());

  app.get('/api/opcoes', async () => {
    const [ufs, cnaes, naturezas, situacoes, portes] = await Promise.all([
      query<{ uf: string }>(
        "SELECT DISTINCT uf FROM estabelecimentos WHERE uf IS NOT NULL AND uf <> '' ORDER BY uf",
      ),
      query<{ codigo: string; descricao: string }>(
        'SELECT codigo, descricao FROM dim_cnae ORDER BY codigo',
      ),
      query<{ codigo: string; descricao: string }>(
        'SELECT codigo, descricao FROM dim_natureza ORDER BY codigo',
      ),
      query<{ codigo: string; descricao: string }>(`
        SELECT DISTINCT situacao AS codigo,
          CASE situacao
            WHEN '01' THEN 'Nula'
            WHEN '02' THEN 'Ativa'
            WHEN '03' THEN 'Suspensa'
            WHEN '04' THEN 'Inapta'
            WHEN '08' THEN 'Baixada'
            ELSE 'Outra'
          END AS descricao
        FROM estabelecimentos
        WHERE situacao IS NOT NULL AND situacao <> ''
        ORDER BY codigo
      `),
      query<{ codigo: string; descricao: string }>(`
        SELECT DISTINCT porte AS codigo,
          CASE porte
            WHEN '01' THEN 'Microempresa'
            WHEN '03' THEN 'Empresa de Pequeno Porte'
            WHEN '05' THEN 'Demais'
            ELSE 'Não informado'
          END AS descricao
        FROM empresas
        WHERE porte IS NOT NULL AND porte <> ''
        ORDER BY codigo
      `),
    ]);

    return {
      ufs: ufs.map((row) => row.uf),
      cnaes,
      naturezas,
      situacoes,
      portes,
    };
  });

  app.get('/api/municipios', async (request, reply) => {
    const parsed = municipiosQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Informe a UF com 2 letras',
        details: parsed.error.flatten(),
      });
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT municipio_codigo AS codigo,
              any_value(municipio_nome) AS nome,
              count(*) AS total
       FROM estabelecimentos_busca
       WHERE uf = $uf
         AND municipio_codigo IS NOT NULL
         AND municipio_codigo <> ''
       GROUP BY 1
       ORDER BY 2`,
      { uf: parsed.data.uf },
    );

    return {
      uf: parsed.data.uf,
      data: rows.map((row) => ({
        codigo: row.codigo,
        nome: row.nome,
        total: asNumber(row.total),
      })),
    };
  });

  app.get('/api/dashboard', async (request, reply) => {
    const parsed = dashboardSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }

    const queries = buildDashboardQueries(parsed.data);
    const [
      totaisRow,
      situacoes,
      portes,
      ufs,
      cnaes,
      municipios,
      idades,
      capital,
      socios,
      aberturas,
    ] = await Promise.all([
      queryOne<Record<string, unknown>>(queries.totais.sql, queries.totais.params),
      query<Record<string, unknown>>(queries.situacoes.sql, queries.situacoes.params),
      query<Record<string, unknown>>(queries.portes.sql, queries.portes.params),
      query<Record<string, unknown>>(queries.ufs.sql, queries.ufs.params),
      query<Record<string, unknown>>(queries.cnaes.sql, queries.cnaes.params),
      query<Record<string, unknown>>(queries.municipios.sql, queries.municipios.params),
      query<Record<string, unknown>>(queries.idades.sql, queries.idades.params),
      query<Record<string, unknown>>(queries.capital.sql, queries.capital.params),
      query<Record<string, unknown>>(queries.socios.sql, queries.socios.params),
      query<Record<string, unknown>>(queries.aberturas.sql, queries.aberturas.params),
    ]);

    const totais = Object.fromEntries(
      Object.entries(totaisRow ?? {}).map(([key, value]) => [key, asNumber(value)]),
    );

    return {
      filtros: parsed.data,
      totais,
      situacoes: dashboardRows(situacoes),
      portes: dashboardRows(portes),
      ufs: dashboardRows(ufs),
      cnaes: dashboardRows(cnaes),
      municipios: dashboardRows(municipios),
      idades: dashboardRows(idades),
      capital: dashboardRows(capital),
      socios: dashboardRows(socios),
      aberturas: dashboardRows(aberturas),
    };
  });

  app.get('/api/mapa', async (request, reply) => {
    const parsed = mapaSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }
    const queryDef = buildMapQuery(parsed.data);
    const rows = await query<Record<string, unknown>>(queryDef.sql, queryDef.params);
    return {
      nivel: parsed.data.nivel,
      data: mapRows(rows),
    };
  });

  app.get('/api/mercado', async (request, reply) => {
    const parsed = mercadoSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }

    const queries = buildMarketQueries(parsed.data);
    const [totaisRow, hhiRow, players, cnaes, timeline] = await Promise.all([
      queryOne<Record<string, unknown>>(queries.totais.sql, queries.totais.params),
      queryOne<Record<string, unknown>>(queries.hhi.sql, queries.hhi.params),
      query<Record<string, unknown>>(queries.players.sql, queries.players.params),
      query<Record<string, unknown>>(queries.cnaes.sql, queries.cnaes.params),
      query<Record<string, unknown>>(queries.timeline.sql, queries.timeline.params),
    ]);

    return {
      territorio: {
        nivel: parsed.data.nivel,
        codigo: parsed.data.codigo,
      },
      totais: {
        estabelecimentos: asNumber(totaisRow?.estabelecimentos),
        ativas: asNumber(totaisRow?.ativas),
        aberturas_12m: asNumber(totaisRow?.aberturas_12m),
        fechamentos_12m: asNumber(totaisRow?.fechamentos_12m),
        idade_media: asNullableNumber(totaisRow?.idade_media),
        capital_mediano: asNullableNumber(totaisRow?.capital_mediano),
        simples: asNumber(totaisRow?.simples),
        mei: asNumber(totaisRow?.mei),
        com_email: asNumber(totaisRow?.com_email),
        com_telefone: asNumber(totaisRow?.com_telefone),
      },
      hhi: asNullableNumber(hhiRow?.hhi),
      players: players.map((row) => ({
        ...row,
        estabelecimentos: asNumber(row.estabelecimentos),
        capital_social: asNullableNumber(row.capital_social),
      })),
      cnaes: cnaes.map((row) => ({
        ...row,
        total: asNumber(row.total),
      })),
      timeline: timelineRows(timeline),
    };
  });

  app.get('/api/timeline', async (request, reply) => {
    const parsed = timelineSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }
    const queryDef = buildTimelineQuery(parsed.data);
    const rows = await query<Record<string, unknown>>(queryDef.sql, queryDef.params);
    return {
      granularidade: parsed.data.granularidade,
      data: timelineRows(rows),
    };
  });

  app.get('/api/buscas', async () => {
    const rows = await listSavedSearches();
    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        filters: JSON.parse(row.filters) as Record<string, string>,
        created_at: row.created_at,
      })),
    };
  });

  app.post('/api/buscas', async (request, reply) => {
    const parsed = savedSearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Dados inválidos',
        details: parsed.error.flatten(),
      });
    }
    const row = await createSavedSearch(parsed.data.name, parsed.data.filters);
    return reply.status(201).send({
      data: {
        id: row.id,
        name: row.name,
        filters: JSON.parse(row.filters),
      },
    });
  });

  app.delete('/api/buscas/:id', async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ID inválido' });
    }
    await deleteSavedSearch(parsed.data.id);
    return { ok: true };
  });

  app.get('/api/empresas', async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }

    const filters = parsed.data;
    const listQuery = buildListQuery(filters);
    const countQuery = buildCountQuery(filters);
    const resumoQuery = buildResumoQuery(filters);

    const [rows, countRows, resumoRows] = await Promise.all([
      query(listQuery.sql, listQuery.params),
      query<{ total: unknown }>(countQuery.sql, countQuery.params),
      query<Record<string, unknown>>(resumoQuery.sql, resumoQuery.params),
    ]);

    const total = asNumber(countRows[0]?.total);
    const resumo = resumoRows[0] ?? {};

    return {
      data: rows.map((row) => ({
        ...row,
        cnpj_formatado: formatCnpj(String(row.cnpj ?? '')),
        capital_social: asNullableNumber(row.capital_social),
        idade_anos: asNullableNumber(row.idade_anos),
        socios_count: asNumber(row.socios_count),
      })),
      total,
      page: filters.page,
      page_size: filters.page_size,
      total_pages: total === 0 ? 0 : Math.ceil(total / filters.page_size),
      resumo: {
        total: asNumber(resumo.total),
        ativas: asNumber(resumo.ativas),
        mais_3_anos: asNumber(resumo.mais_3_anos),
        com_email: asNumber(resumo.com_email),
        com_telefone: asNumber(resumo.com_telefone),
        com_socios: asNumber(resumo.com_socios),
      },
      filters,
    };
  });

  app.get('/api/estatisticas', async (request, reply) => {
    const parsed = statsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }
    const statsQuery = buildStatsQuery(parsed.data);
    const rows = await query<{ chave: string; rotulo: string | null; total: unknown }>(
      statsQuery.sql,
      statsQuery.params,
    );
    return {
      group_by: parsed.data.group_by,
      data: rows.map((row) => ({
        chave: row.chave,
        rotulo: row.rotulo ?? row.chave,
        total: asNumber(row.total),
      })),
    };
  });

  app.get('/api/cnpj/:cnpj', async (request, reply) => {
    const params = cnpjParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'CNPJ inválido' });
    }

    const normalized = normalizeCnpj(params.data.cnpj);
    if (normalized.length !== 14 && normalized.length !== 8) {
      return reply.status(400).send({ error: 'Informe 8 ou 14 caracteres de CNPJ' });
    }
    if (normalized.length === 14 && !isValidCnpj(normalized)) {
      return reply.status(400).send({ error: 'Dígito verificador do CNPJ inválido' });
    }

    const base = normalized.slice(0, 8);

    const [empresaRows, estabelecimentoRows, socioRows, simplesRows, redeResumo] =
      await Promise.all([
        query<Record<string, unknown>>(
          `SELECT e.*, n.descricao AS natureza_descricao,
                  q.descricao AS qualificacao_responsavel_descricao,
                  CASE e.porte
                    WHEN '01' THEN 'Microempresa'
                    WHEN '03' THEN 'Empresa de Pequeno Porte'
                    WHEN '05' THEN 'Demais'
                    ELSE 'Não informado'
                  END AS porte_descricao
           FROM empresas e
           LEFT JOIN dim_natureza n ON n.codigo = e.natureza_juridica
           LEFT JOIN dim_qualificacao q ON q.codigo = e.qualificacao_responsavel
           WHERE e.cnpj_base = $base
           LIMIT 1`,
          { base },
        ),
        query<Record<string, unknown>>(
          `SELECT e.*, c.descricao AS cnae_descricao, m.descricao AS municipio_nome,
                  CASE e.situacao
                    WHEN '01' THEN 'Nula'
                    WHEN '02' THEN 'Ativa'
                    WHEN '03' THEN 'Suspensa'
                    WHEN '04' THEN 'Inapta'
                    WHEN '08' THEN 'Baixada'
                    ELSE 'Outra'
                  END AS situacao_descricao,
                  CASE e.matriz_filial
                    WHEN '1' THEN 'Matriz'
                    WHEN '2' THEN 'Filial'
                    ELSE 'Não informado'
                  END AS matriz_filial_descricao,
                  date_diff('year', e.data_inicio, current_date) AS idade_anos,
                  coalesce(e.data_inicio <= current_date - INTERVAL 3 YEAR, false) AS is_mais_3_anos
           FROM estabelecimentos e
           LEFT JOIN dim_cnae c ON c.codigo = e.cnae_principal
           LEFT JOIN dim_municipio m ON m.codigo = e.municipio_codigo
           WHERE e.cnpj_base = $base
           ORDER BY e.matriz_filial, e.cnpj`,
          { base },
        ),
        query<Record<string, unknown>>(
          `SELECT s.*, q.descricao AS qualificacao_socio_descricao,
                  qr.descricao AS qualificacao_representante_descricao
           FROM socios s
           LEFT JOIN dim_qualificacao q ON q.codigo = s.qualificacao_socio
           LEFT JOIN dim_qualificacao qr ON qr.codigo = s.qualificacao_representante
           WHERE s.cnpj_base = $base
           ORDER BY s.nome_socio`,
          { base },
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM simples WHERE cnpj_base = $base LIMIT 1',
          { base },
        ),
        getNetworkSummary(base),
      ]);

    if (empresaRows.length === 0 && estabelecimentoRows.length === 0) {
      return reply.status(404).send({ error: 'CNPJ não encontrado na base' });
    }

    const estabelecimentos = estabelecimentoRows.map((row) => ({
      ...row,
      cnpj_formatado: formatCnpj(String(row.cnpj ?? '')),
      idade_anos: asNullableNumber(row.idade_anos),
    }));
    const snapshot = String(
      empresaRows[0]?.snapshot ?? estabelecimentoRows[0]?.snapshot ?? config.snapshot,
    );
    const passaporte = buildPassport({
      empresa: empresaRows[0] ?? null,
      estabelecimentos: estabelecimentoRows,
      socios: socioRows,
      simples: simplesRows[0] ?? null,
      rede: redeResumo,
      snapshot,
    });

    return {
      cnpj: normalized.length === 14 ? normalized : null,
      cnpj_formatado: normalized.length === 14 ? formatCnpj(normalized) : null,
      cnpj_base: base,
      empresa: empresaRows[0]
        ? {
            ...empresaRows[0],
            capital_social: asNullableNumber(empresaRows[0].capital_social),
          }
        : null,
      estabelecimentos,
      socios: socioRows,
      socios_count: socioRows.length,
      simples: simplesRows[0] ?? null,
      rede_resumo: redeResumo,
      passaporte,
    };
  });

  app.get('/api/rede/empresa/:cnpj', async (request, reply) => {
    const params = cnpjParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'CNPJ inválido' });
    }
    const queryParams = networkQuerySchema.safeParse(request.query);
    if (!queryParams.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: queryParams.error.flatten(),
      });
    }

    const normalized = normalizeCnpj(params.data.cnpj);
    if (normalized.length !== 14 && normalized.length !== 8) {
      return reply.status(400).send({ error: 'Informe 8 ou 14 caracteres de CNPJ' });
    }
    if (normalized.length === 14 && !isValidCnpj(normalized)) {
      return reply.status(400).send({ error: 'Dígito verificador do CNPJ inválido' });
    }

    const base = normalized.slice(0, 8);
    const target = await getNetworkCompany(base);
    if (!target) {
      return reply.status(404).send({ error: 'CNPJ não encontrado na base' });
    }

    const limits = {
      partnerLimit: queryParams.data.parceiros,
      partnerCompanyLimit: queryParams.data.empresas_por_parceiro,
      contactLimit: queryParams.data.contatos,
      contactCompanyLimit: queryParams.data.empresas_por_contato,
      hubMin: queryParams.data.hub_min,
    };
    const [partners, partnerCompanies, contacts, contactCompanies, resumo] =
      await Promise.all([
        getTargetPartners(base),
        getPartnerCompanies(base, limits),
        getContactList(base, limits),
        getContactCompanies(base, limits),
        getNetworkSummary(base, limits.hubMin),
      ]);

    const graph = buildCompanyGraph({
      target,
      partners,
      partnerCompanies,
      contacts,
      contactCompanies,
      limits,
    });

    return {
      centro: {
        cnpj_base: target.cnpj_base,
        cnpj: normalized.length === 14 ? normalized : target.cnpj,
        cnpj_formatado: formatCnpj(String(target.cnpj ?? normalized)),
        razao_social: target.razao_social,
      },
      resumo: {
        ...resumo,
        empresas_no_grafo: graph.empresas.length,
        socios_no_grafo: graph.nodes.filter((node) => node.tipo === 'socio').length,
        contatos_no_grafo: graph.nodes.filter(
          (node) => node.tipo !== 'empresa' && node.tipo !== 'socio',
        ).length,
      },
      nodes: graph.nodes,
      edges: graph.edges,
      empresas: graph.empresas,
      limites: limits,
      cobertura: {
        snapshot: config.snapshot,
        observacao:
          'Rede construída a partir do snapshot atual. Contatos repetidos são hubs; não há pares empresa–empresa quando o contato é muito compartilhado.',
      },
    };
  });

  app.get('/api/rede/hubs', async (request, reply) => {
    const parsed = hubListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }
    const rows = await listHubs({
      tipo: parsed.data.tipo,
      minEmpresas: parsed.data.min_empresas,
      uf: parsed.data.uf,
      cnae: parsed.data.cnae,
      q: parsed.data.q,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return {
      tipo: parsed.data.tipo,
      data: rows.map((row) => ({
        ...row,
        rotulo: row.rotulo ?? row.valor,
        empresas: asNumber(row.empresas),
        ufs: asNumber(row.ufs),
        cnaes: asNumber(row.cnaes),
        ativas: asNumber(row.ativas),
        capital_somado: asNullableNumber(row.capital_somado),
        idade_media: asNullableNumber(row.idade_media),
      })),
    };
  });

  app.get('/api/rede/hub', async (request, reply) => {
    const parsed = hubDetailSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }
    const hub = await getHubSummary(parsed.data.tipo, parsed.data.valor);
    if (!hub) {
      return reply.status(404).send({ error: 'Hub não encontrado na base' });
    }
    const companyLimit = Math.min(parsed.data.limit, 40);
    const [companies, expansion] = await Promise.all([
      getHubCompanies(parsed.data.tipo, parsed.data.valor, companyLimit),
      getHubExpansion(parsed.data.tipo, parsed.data.valor, {
        companyLimit: 12,
        companyPerPartner: 2,
      }),
    ]);
    const graph = buildHubGraph({
      tipo: hub.tipo,
      valor: hub.valor,
      rotulo: hub.rotulo,
      total: hub.empresas,
      companies,
      expansion,
    });
    return {
      tipo_rede: 'hub',
      hub,
      centro: {
        cnpj_base: null,
        cnpj: null,
        cnpj_formatado: '',
        razao_social: hub.rotulo,
      },
      resumo: {
        socios: 0,
        empresas_via_socios: 0,
        contatos: 1,
        empresas_via_contatos: hub.empresas,
        hubs: 1,
        empresas_no_grafo: graph.empresas.length,
        socios_no_grafo: 0,
        contatos_no_grafo: 1,
      },
      nodes: graph.nodes,
      edges: graph.edges,
      empresas: graph.empresas,
      limites: {
        empresas_por_hub: companyLimit,
        expansao_empresas: 12,
        expansao_por_socio: 2,
      },
      cobertura: {
        snapshot: config.snapshot,
        observacao:
          'Hub inferido por contato compartilhado. Clique em uma empresa para abrir a rede completa dela.',
      },
    };
  });

  app.get('/api/export.csv', async (request, reply) => {
    const parsed = exportSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Parâmetros inválidos',
        details: parsed.error.flatten(),
      });
    }

    const filters = toSearchInput({
      ...parsed.data,
      page: 1,
      page_size: config.exportLimit,
      sort: 'razao_social',
      order: 'asc',
    });

    const listQuery = buildListQuery(filters);
    const rows = await query<Record<string, unknown>>(listQuery.sql, listQuery.params);

    const header = [
      'CNPJ',
      'Razão social',
      'Nome fantasia',
      'Situação',
      'Data de abertura',
      'Idade (anos)',
      'CNAE principal',
      'Descrição CNAE',
      'UF',
      'Município',
      'Bairro',
      'CEP',
      'Endereço',
      'E-mail',
      'DDD 1',
      'Telefone 1',
      'DDD 2',
      'Telefone 2',
      'Capital social',
      'Nº de sócios',
      'Porte',
      'Natureza jurídica',
      'Simples',
      'MEI',
      'Matriz/Filial',
    ];

    const lines = [toCsvLine(header, ';')];
    for (const row of rows) {
      lines.push(
        toCsvLine(
          [
            formatCnpj(String(row.cnpj ?? '')),
            row.razao_social ?? '',
            row.nome_fantasia ?? '',
            row.situacao_descricao ?? row.situacao ?? '',
            row.data_inicio ?? '',
            row.idade_anos ?? '',
            row.cnae_principal ?? '',
            row.cnae_descricao ?? '',
            row.uf ?? '',
            row.municipio_nome ?? '',
            row.bairro ?? '',
            row.cep ?? '',
            addressLine(row),
            row.email ?? '',
            row.ddd1 ?? '',
            row.telefone1 ?? '',
            row.ddd2 ?? '',
            row.telefone2 ?? '',
            csvValue(row.capital_social),
            row.socios_count ?? '',
            row.porte_descricao ?? '',
            row.natureza_descricao ?? '',
            row.opcao_simples ?? '',
            row.opcao_mei ?? '',
            row.matriz_filial_descricao ?? '',
          ],
          ';',
        ),
      );
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="cnpj-export.csv"')
      .header('X-Export-Limit', String(config.exportLimit));
    return `\uFEFF${lines.join('\r\n')}`;
  });
}
