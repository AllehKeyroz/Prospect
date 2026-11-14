import type { NetworkSummary } from '../api/networkQueries.js';

type Row = Record<string, unknown>;

export interface PassportFact {
  id: string;
  rotulo: string;
  valor: string | number | null;
  detalhe?: string;
  fonte: string;
  data_referencia?: string | null;
}

export interface PassportEvent {
  data: string | null;
  tipo: string;
  titulo: string;
  descricao: string;
  fonte: string;
  confianca: 'oficial' | 'validado' | 'reconstruido';
}

export interface Passport {
  cobertura: {
    snapshot: string;
    historico_empresa: string;
    snapshots_historicos: string;
    observacao: string;
  };
  fatos: PassportFact[];
  eventos: PassportEvent[];
  rede_resumo: NetworkSummary;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown): string | null {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : null;
}

function uniqueContacts(estabelecimentos: Row[]): { emails: number; telefones: number } {
  const emails = new Set<string>();
  const telefones = new Set<string>();
  for (const row of estabelecimentos) {
    const email = text(row.email).toLowerCase();
    if (email) emails.add(email);
    for (const key of ['ddd1', 'ddd2'] as const) {
      const ddd = text(row[key]).replace(/\D/g, '');
      const phone = text(row[key === 'ddd1' ? 'telefone1' : 'telefone2']).replace(/\D/g, '');
      if (phone) telefones.add(`${ddd}${phone}`);
    }
  }
  return { emails: emails.size, telefones: telefones.size };
}

export function buildPassport(input: {
  empresa: Row | null;
  estabelecimentos: Row[];
  socios: Row[];
  simples: Row | null;
  rede: NetworkSummary;
  snapshot: string;
}): Passport {
  const { empresa, estabelecimentos, socios, simples, rede, snapshot } = input;
  const fonte = `Receita Federal — snapshot ${snapshot}`;
  const matriz =
    estabelecimentos.find((row) => text(row.matriz_filial) === '1') ??
    estabelecimentos[0] ??
    {};
  const situacao = text(matriz.situacao_descricao) || 'Não informada';
  const contatos = uniqueContacts(estabelecimentos);
  const eventos: PassportEvent[] = [];

  const pushEvent = (event: PassportEvent) => {
    if (!event.data && !event.titulo) return;
    const key = `${event.data ?? ''}|${event.tipo}|${event.titulo}|${event.descricao}`;
    if (eventos.some((item) => `${item.data ?? ''}|${item.tipo}|${item.titulo}|${item.descricao}` === key)) {
      return;
    }
    eventos.push(event);
  };

  if (matriz.data_inicio) {
    pushEvent({
      data: dateValue(matriz.data_inicio),
      tipo: 'abertura',
      titulo: 'Abertura da empresa',
      descricao: [text(matriz.municipio_nome), text(matriz.uf)].filter(Boolean).join(' / '),
      fonte,
      confianca: 'oficial',
    });
  }

  for (const row of estabelecimentos) {
    if (text(row.matriz_filial) === '1') continue;
    const data = dateValue(row.data_inicio);
    if (!data) continue;
    pushEvent({
      data,
      tipo: 'filial',
      titulo: 'Abertura de filial',
      descricao: `${text(row.cnpj_formatado) || text(row.cnpj)} · ${[text(row.municipio_nome), text(row.uf)]
        .filter(Boolean)
        .join(' / ')}`,
      fonte,
      confianca: 'oficial',
    });
  }

  const situacaoData = dateValue(matriz.data_situacao);
  if (situacaoData) {
    pushEvent({
      data: situacaoData,
      tipo: 'situacao',
      titulo: `Situação cadastral: ${situacao}`,
      descricao: text(matriz.motivo_descricao) || 'Atualização do cadastro',
      fonte,
      confianca: 'oficial',
    });
  }

  for (const row of socios) {
    const data = dateValue(row.data_entrada);
    if (!data) continue;
    const nome = text(row.nome_socio) || 'Sócio sem nome';
    const qualificacao = text(row.qualificacao_socio_descricao) || text(row.qualificacao_socio);
    pushEvent({
      data,
      tipo: 'socio',
      titulo: 'Entrada de sócio',
      descricao: qualificacao ? `${nome} · ${qualificacao}` : nome,
      fonte,
      confianca: 'oficial',
    });
  }

  const simplesData = dateValue(simples?.data_opcao_simples);
  if (simplesData) {
    pushEvent({
      data: simplesData,
      tipo: 'simples',
      titulo: 'Opção pelo Simples Nacional',
      descricao: 'Data informada pela Receita Federal',
      fonte,
      confianca: 'oficial',
    });
  }
  const simplesExclusao = dateValue(simples?.data_exclusao_simples);
  if (simplesExclusao) {
    pushEvent({
      data: simplesExclusao,
      tipo: 'simples',
      titulo: 'Exclusão do Simples Nacional',
      descricao: 'Data informada pela Receita Federal',
      fonte,
      confianca: 'oficial',
    });
  }
  const meiData = dateValue(simples?.data_opcao_mei);
  if (meiData) {
    pushEvent({
      data: meiData,
      tipo: 'mei',
      titulo: 'Opção pelo MEI',
      descricao: 'Data informada pela Receita Federal',
      fonte,
      confianca: 'oficial',
    });
  }
  const meiExclusao = dateValue(simples?.data_exclusao_mei);
  if (meiExclusao) {
    pushEvent({
      data: meiExclusao,
      tipo: 'mei',
      titulo: 'Exclusão do MEI',
      descricao: 'Data informada pela Receita Federal',
      fonte,
      confianca: 'oficial',
    });
  }

  eventos.sort((a, b) => {
    if (!a.data && !b.data) return 0;
    if (!a.data) return 1;
    if (!b.data) return -1;
    return a.data.localeCompare(b.data);
  });

  const filiais = estabelecimentos.filter((row) => text(row.matriz_filial) === '2').length;
  const fatos: PassportFact[] = [
    {
      id: 'situacao',
      rotulo: 'Situação cadastral',
      valor: situacao,
      detalhe: text(matriz.motivo_descricao) || undefined,
      fonte,
      data_referencia: dateValue(matriz.data_situacao),
    },
    {
      id: 'abertura',
      rotulo: 'Abertura',
      valor: dateValue(matriz.data_inicio),
      detalhe: matriz.idade_anos != null ? `${numberValue(matriz.idade_anos)} anos` : undefined,
      fonte,
      data_referencia: dateValue(matriz.data_inicio),
    },
    {
      id: 'capital',
      rotulo: 'Capital social',
      valor: numberValue(empresa?.capital_social),
      fonte,
      data_referencia: snapshot,
    },
    {
      id: 'socios',
      rotulo: 'Sócios',
      valor: socios.length,
      detalhe: `${rede.empresas_via_socios} empresa(s) conectada(s) por sócio`,
      fonte,
      data_referencia: snapshot,
    },
    {
      id: 'estabelecimentos',
      rotulo: 'Estabelecimentos',
      valor: estabelecimentos.length,
      detalhe: `${filiais} filial(is)`,
      fonte,
      data_referencia: snapshot,
    },
    {
      id: 'contatos',
      rotulo: 'E-mails + telefones',
      valor: contatos.emails + contatos.telefones,
      detalhe: `${contatos.emails} e-mail(s) · ${contatos.telefones} telefone(s)`,
      fonte,
      data_referencia: snapshot,
    },
    {
      id: 'simples',
      rotulo: 'Simples / MEI',
      valor: [simples?.opcao_simples === 'S' ? 'Simples' : null, simples?.opcao_mei === 'S' ? 'MEI' : null]
        .filter(Boolean)
        .join(' · ') || 'Não',
      fonte,
      data_referencia: snapshot,
    },
    {
      id: 'rede',
      rotulo: 'Rede de ligações',
      valor: rede.empresas_via_socios + rede.empresas_via_contatos,
      detalhe: `${rede.contatos} contato(s) · ${rede.hubs} hub(s)`,
      fonte,
      data_referencia: snapshot,
    },
  ];

  return {
    cobertura: {
      snapshot,
      historico_empresa:
        'Abertura, fechamento, situação, sócios e Simples/MEI vêm do snapshot atual.',
      snapshots_historicos:
        'Retratos mensais oficiais começam em 2023-05; 2019 está em validação e 2000–2018 é reconstruído de forma aproximada.',
      observacao:
        'Mudanças de CNAE, endereço ou quadro societário anteriores a 2023-05 não são observáveis nesta base.',
    },
    fatos,
    eventos,
    rede_resumo: rede,
  };
}
