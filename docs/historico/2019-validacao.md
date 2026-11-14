# Validação do pacote 2019 (Wayback)

Gerado em 2026-11-14T21:09:02.750Z.

## Cobertura da amostra

| Arquivo | Empresas | Sócios | Amostradas |
|---|---:|---:|---:|
| data\wayback\2019\DADOS_ABERTOS_CNPJ_01.zip | 1902007 | 1846962 | 5000 |

## Conferência interna

| Verificação | Ocorrências |
|---|---:|
| invalid_cnpj | 0 |
| invalid_situacao | 0 |
| invalid_uf | 85 |
| invalid_cnae | 0 |
| invalid_date | 2 |
| temporal_violation | 51 |

## Concordância com o snapshot local

- Registros amostrados: **5000**
- Match de CNPJ base: **343** (6.86%)
- Match de CNPJ completo: **81** (1.62%)
- Nome exato: **96.3%**
- Nome similar (≥ 80% de tokens): **96.3%**
- Situação: **90.12%**
- Data de abertura: **100%**
- CNAE: **96.3%**
- UF: **100%**

> A base local é uma amostra de 50 mil estabelecimentos. O match mede apenas os registros presentes nessa amostra; não é uma taxa de cobertura nacional.
> Diferenças de situação entre 2019 e 2026 são esperadas (mudança real de cadastro), não erro de chave.

## Distribuição 2019

### Situação

| Código | Empresas |
|---|---:|
| 08 | 1127396 |
| 02 | 442361 |
| 04 | 315714 |
| 03 | 13697 |
| 01 | 2839 |

### UF

| UF | Empresas |
|---|---:|
| SP | 507763 |
| MG | 173389 |
| RS | 144577 |
| PR | 133871 |
| RJ | 131388 |
| GO | 117691 |
| SC | 98679 |
| BA | 94329 |
| DF | 75357 |
| CE | 66643 |
| PE | 54917 |
| MT | 53492 |
| MS | 38651 |
| MA | 33016 |
| ES | 28788 |

## Limitações

- Validação por amostragem sobre o arquivo 01; os demais arquivos do pacote precisam ser baixados e validados.
- O layout 2019 é fixed-width de 1.200 caracteres, distinto do CSV moderno da Receita.
- A comparação local usa uma amostra de 50 mil estabelecimentos, não o snapshot oficial completo.
- Divergência de situação entre 2019 e 2026 é esperada (mudança real de cadastro), não erro de chave.
- Nenhum dado de 2019 foi mesclado ao banco; o relatório é apenas de confiança e proveniência.
