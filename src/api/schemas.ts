import { z } from 'zod';
import { normalizeCnpj } from '../lib/cnpj.js';
import { config } from '../config.js';

const optionalNumber = (min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().min(min).max(max).optional(),
  );

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (['1', 'true', 'sim', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'nao', 'não', 'no', 'off'].includes(text)) return false;
  return undefined;
}, z.boolean().optional());

const optionalUf = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : String(value).toUpperCase()),
  z.string().length(2).optional(),
);

const optionalCnae = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : String(value).trim()),
  z.string().min(1).max(120).optional(),
);

const optionalCnpj = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : normalizeCnpj(String(value))),
  z
    .string()
    .min(8)
    .max(14)
    .refine((value) => value.length === 8 || value.length === 14, {
      message: 'CNPJ deve ter 8 ou 14 caracteres',
    })
    .optional(),
);

const optionalText = (max = 120) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : String(value).trim()),
    z.string().min(1).max(max).optional(),
  );

export const filterShape = {
  q: optionalText(120),
  cnpj: optionalCnpj,
  uf: optionalUf,
  municipio: optionalText(80),
  municipio_ibge: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : String(value).trim()),
    z.string().regex(/^\d{7}$/).optional(),
  ),
  regiao: optionalText(40),
  cnae: optionalCnae,
  situacao: optionalText(2),
  porte: optionalText(2),
  natureza: optionalText(4),
  idade_min: optionalNumber(0, 150),
  idade_max: optionalNumber(0, 150),
  capital_min: optionalNumber(0),
  capital_max: optionalNumber(0),
  socios_min: optionalNumber(0, 10_000),
  socios_max: optionalNumber(0, 10_000),
  simples: optionalBoolean,
  mei: optionalBoolean,
  com_email: optionalBoolean,
  com_telefone: optionalBoolean,
  matriz: optionalBoolean,
};

export const sortValues = [
  'razao_social',
  'data_inicio',
  'capital_social',
  'uf',
  'cnae',
  'situacao',
  'idade',
  'socios',
  'fit',
] as const;

export const searchSchema = z.object({
  ...filterShape,
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(config.maxPageSize)
    .default(config.defaultPageSize),
  sort: z.enum(sortValues).default('razao_social'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const statsSchema = z.object({
  ...filterShape,
  group_by: z
    .enum(['uf', 'cnae', 'situacao', 'porte', 'municipio', 'natureza'])
    .default('uf'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const exportSchema = z.object({
  ...filterShape,
});

export const dashboardSchema = z.object({
  ...filterShape,
});

export const mapaSchema = z.object({
  ...filterShape,
  nivel: z.enum(['regiao', 'uf', 'municipio']).default('uf'),
});

export const mercadoSchema = z.object({
  ...filterShape,
  nivel: z.enum(['regiao', 'uf', 'municipio']),
  codigo: z.string().min(1).max(40),
});

export const timelineSchema = z.object({
  ...filterShape,
  nivel: z.enum(['regiao', 'uf', 'municipio']).optional(),
  codigo: optionalText(20),
  granularidade: z.enum(['ano', 'mes']).default('ano'),
});

export const municipiosQuerySchema = z.object({
  uf: z.preprocess(
    (value) => String(value ?? '').toUpperCase(),
    z.string().length(2),
  ),
});

export const cnpjParamsSchema = z.object({
  cnpj: z.string().min(8).max(20),
});

export const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.string()),
});

export const idParamsSchema = z.object({
  id: z.string().min(1).max(100),
});

export type SearchInput = z.infer<typeof searchSchema>;
export type StatsInput = z.infer<typeof statsSchema>;
export type ExportInput = z.infer<typeof exportSchema>;
export type DashboardInput = z.infer<typeof dashboardSchema>;
export type MapaInput = z.infer<typeof mapaSchema>;
export type MercadoInput = z.infer<typeof mercadoSchema>;
export type TimelineInput = z.infer<typeof timelineSchema>;
