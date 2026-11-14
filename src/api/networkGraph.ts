import type {
  ContactCompanyRow,
  ContactRow,
  NetworkCompanyRow,
  NetworkLimits,
  PartnerCompanyRow,
  TargetPartnerRow,
} from './networkQueries.js';

export type GraphNodeType = 'empresa' | 'socio' | 'email' | 'telefone' | 'endereco' | 'marca';
export type GraphEdgeType =
  | 'socio_de'
  | 'mesmo_email'
  | 'mesmo_telefone'
  | 'mesmo_endereco'
  | 'mesma_marca';
export type Confidence = 'alta' | 'media' | 'baixa';

export interface GraphNode {
  id: string;
  tipo: GraphNodeType;
  rotulo: string;
  subtitulo: string;
  cnpj?: string | null;
  cnpj_base?: string | null;
  uf?: string | null;
  municipio?: string | null;
  municipio_ibge?: string | null;
  situacao?: string | null;
  data_inicio?: string | null;
  idade_anos?: number | null;
  capital_social?: number | null;
  central?: boolean;
  hub?: boolean;
  ocorrencias?: number;
  relacoes?: string[];
}

export interface GraphEdge {
  id: string;
  origem: string;
  destino: string;
  tipo: GraphEdgeType;
  rotulo: string;
  confianca: Confidence;
  evidencias: string[];
  peso: number;
}

export interface GraphCompany {
  cnpj_base: string;
  cnpj: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  uf: string | null;
  municipio: string | null;
  municipio_ibge: string | null;
  situacao: string | null;
  idade_anos: number | null;
  capital_social: number | null;
  relacoes: string[];
}

export interface CompanyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  empresas: GraphCompany[];
}

const CONTACT_META: Record<
  ContactRow['tipo'],
  { edge: GraphEdgeType; rotulo: string; relacao: string; evidencia: string }
> = {
  email: {
    edge: 'mesmo_email',
    rotulo: 'E-mail em comum',
    relacao: 'e-mail',
    evidencia: 'E-mail idêntico em empresas diferentes',
  },
  telefone: {
    edge: 'mesmo_telefone',
    rotulo: 'Telefone em comum',
    relacao: 'telefone',
    evidencia: 'Telefone idêntico em empresas diferentes',
  },
  endereco: {
    edge: 'mesmo_endereco',
    rotulo: 'Endereço em comum',
    relacao: 'endereço',
    evidencia: 'CEP + número + complemento idênticos',
  },
  marca: {
    edge: 'mesma_marca',
    rotulo: 'Marca em comum',
    relacao: 'marca',
    evidencia: 'Nome fantasia normalizado idêntico',
  },
};

function companyNodeId(cnpjBase: string): string {
  return `empresa:${cnpjBase}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCompanyNode(row: NetworkCompanyRow, relacao: string): GraphNode {
  const name = row.razao_social || row.nome_fantasia || row.cnpj_base;
  const location = [row.municipio_nome, row.uf].filter(Boolean).join(' / ');
  return {
    id: companyNodeId(row.cnpj_base),
    tipo: 'empresa',
    rotulo: name,
    subtitulo: location || 'Local não informado',
    cnpj: row.cnpj,
    cnpj_base: row.cnpj_base,
    uf: row.uf,
    municipio: row.municipio_nome,
    municipio_ibge: row.municipio_ibge,
    situacao: row.situacao_descricao,
    data_inicio: row.data_inicio,
    idade_anos: toNumber(row.idade_anos),
    capital_social: toNumber(row.capital_social),
    relacoes: [relacao],
  };
}

export function buildCompanyGraph(input: {
  target: NetworkCompanyRow;
  partners: TargetPartnerRow[];
  partnerCompanies: PartnerCompanyRow[];
  contacts: ContactRow[];
  contactCompanies: ContactCompanyRow[];
  limits: NetworkLimits;
}): CompanyGraph {
  const { target, partners, partnerCompanies, contacts, contactCompanies, limits } = input;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const targetNode = toCompanyNode(target, 'centro');
  targetNode.central = true;
  nodes.set(targetNode.id, targetNode);

  const addNode = (node: GraphNode) => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    if (node.tipo === 'empresa') {
      existing.relacoes = Array.from(new Set([...(existing.relacoes ?? []), ...(node.relacoes ?? [])]));
      if (!existing.municipio_ibge && node.municipio_ibge) {
        existing.municipio_ibge = node.municipio_ibge;
        existing.municipio = node.municipio;
        existing.uf = node.uf;
      }
    }
  };

  const addEdge = (edge: Omit<GraphEdge, 'id'>) => {
    const id = `${edge.origem}|${edge.destino}|${edge.tipo}`;
    if (edges.has(id)) return;
    edges.set(id, { ...edge, id });
  };

  const otherCompaniesByPartner = new Map<string, PartnerCompanyRow[]>();
  for (const row of partnerCompanies) {
    const list = otherCompaniesByPartner.get(row.partner_key) ?? [];
    list.push(row);
    otherCompaniesByPartner.set(row.partner_key, list);
  }

  const rankedPartners = [...partners]
    .sort((a, b) => {
      const aCount = otherCompaniesByPartner.get(a.partner_key)?.length ?? 0;
      const bCount = otherCompaniesByPartner.get(b.partner_key)?.length ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return (a.nome_socio ?? '').localeCompare(b.nome_socio ?? '');
    })
    .slice(0, limits.partnerLimit);

  for (const partner of rankedPartners) {
    const partnerId = `socio:${partner.partner_key}`;
    const qualificacao = partner.qualificacao_socio_descricao || partner.qualificacao_socio || 'Sócio';
    const cpf = partner.cpf_cnpj_socio ? `CPF/CNPJ ${partner.cpf_cnpj_socio}` : 'CPF/CNPJ não informado';
    addNode({
      id: partnerId,
      tipo: 'socio',
      rotulo: partner.nome_socio || 'Sócio sem nome',
      subtitulo: `${qualificacao} · ${cpf}`,
      relacoes: ['sócio'],
    });
    addEdge({
      origem: partnerId,
      destino: targetNode.id,
      tipo: 'socio_de',
      rotulo: 'Sócio da empresa',
      confianca: 'alta',
      evidencias: ['CPF/CNPJ mascarado + nome normalizado'],
      peso: 3,
    });

    for (const company of otherCompaniesByPartner.get(partner.partner_key) ?? []) {
      const node = toCompanyNode(company, 'socio');
      addNode(node);
      addEdge({
        origem: partnerId,
        destino: node.id,
        tipo: 'socio_de',
        rotulo: 'Sócio da empresa',
        confianca: 'alta',
        evidencias: ['CPF/CNPJ mascarado + nome normalizado'],
        peso: 3,
      });
    }
  }

  const companiesByContact = new Map<string, ContactCompanyRow[]>();
  for (const row of contactCompanies) {
    const key = `${row.tipo}|${row.valor}`;
    const list = companiesByContact.get(key) ?? [];
    list.push(row);
    companiesByContact.set(key, list);
  }

  for (const contact of contacts) {
    const meta = CONTACT_META[contact.tipo];
    const ocorrencias = Number(contact.outras ?? 0) + 1;
    const contactId = `${contact.tipo}:${contact.valor}`;
    const label = contact.rotulo || contact.valor;
    addNode({
      id: contactId,
      tipo: contact.tipo,
      rotulo: label,
      subtitulo: `${ocorrencias} empresa${ocorrencias === 1 ? '' : 's'}`,
      hub: ocorrencias >= limits.hubMin,
      ocorrencias,
      relacoes: [meta.relacao],
    });
    addEdge({
      origem: contactId,
      destino: targetNode.id,
      tipo: meta.edge,
      rotulo: meta.rotulo,
      confianca: 'media',
      evidencias: [`${meta.evidencia} (${ocorrencias} empresa${ocorrencias === 1 ? '' : 's'})`],
      peso: 2,
    });

    for (const company of companiesByContact.get(`${contact.tipo}|${contact.valor}`) ?? []) {
      const node = toCompanyNode(company, meta.relacao);
      addNode(node);
      addEdge({
        origem: contactId,
        destino: node.id,
        tipo: meta.edge,
        rotulo: meta.rotulo,
        confianca: 'media',
        evidencias: [`${meta.evidencia} (${ocorrencias} empresa${ocorrencias === 1 ? '' : 's'})`],
        peso: 2,
      });
    }
  }

  const graphNodes = [...nodes.values()];

  const empresas = graphNodes
    .filter((node) => node.tipo === 'empresa')
    .map((node) => ({
      cnpj_base: node.cnpj_base ?? '',
      cnpj: node.cnpj ?? null,
      razao_social: node.rotulo,
      nome_fantasia: null,
      uf: node.uf ?? null,
      municipio: node.municipio ?? null,
      municipio_ibge: node.municipio_ibge ?? null,
      situacao: node.situacao ?? null,
      idade_anos: node.idade_anos ?? null,
      capital_social: node.capital_social ?? null,
      relacoes: node.relacoes ?? [],
    }));

  return {
    nodes: graphNodes,
    edges: [...edges.values()],
    empresas,
  };
}
