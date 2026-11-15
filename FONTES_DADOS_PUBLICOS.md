# Fontes de Dados Públicos para o PROSPECT

**Guia para leigos — só fontes gratuitas e recomendadas**

Versão 1.0 — 14/11/2026

Este documento reúne as fontes públicas, gratuitas e com potencial real de enriquecer o CNPJ Prospect. Para cada uma, explica:

- **quem é o dono** (órgão, empresa ou comunidade);
- **por que ela existe**;
- **por que o dado é público**;
- **o que tem dentro**;
- **se você precisa consultar empresa por empresa ou se existe exportação em massa**;
- **como usar no PROSPECT**;
- **cuidados**.

> **Regra de ouro:** nenhuma fonte recomendada aqui exige uma chamada por empresa para o volume principal. O que existe é: (a) download em lote; (b) API que varre por período/órgão; (c) consulta pontual para validar um caso. As exceções estão marcadas como **MISTO** (parte em lote, parte consulta); nenhuma fonte recomendada é **MANUAL**.

---

## 1. Como ler este documento

### Glossário rápido

| Termo | O que significa na prática |
|---|---|
| **Dado aberto** | Dado público disponibilizado em formato legível por máquina, com licença que permite usar e redistribuir. |
| **Lote (bulk)** | Você baixa a base inteira de uma vez, normalmente em CSV, ZIP ou Parquet. É o cenário ideal. |
| **API** | Um “garçom” que leva seu pedido ao banco de dados do órgão e devolve a resposta em JSON. Você não acessa o banco direto. |
| **API em lote** | A API não é por empresa: você pede um período, um órgão ou uma UF e ela devolve tudo aquilo, em páginas. |
| **CSV** | Planilha em texto puro, separada por ponto e vírgula ou vírgula. Abre no Excel, mas para volumes grandes é melhor usar DuckDB/Python. |
| **Parquet** | Formato colunar comprimido, ideal para análise em massa. Mais rápido e menor que CSV. |
| **Snapshot** | “Foto” de uma base em uma data. Cada fonte tem a sua; não misture sem registrar a data. |
| **CNPJ raiz** | Os 8 primeiros dígitos. Representam a empresa (matriz + filiais). |
| **CNPJ estabelecimento** | Os 14 dígitos. Representam uma unidade (matriz ou filial). |
| **Open data / licença aberta** | O dado pode ser usado, mas com condições: atribuição, compartilhamento igual, etc. |
| **Rate limit** | Limite de quantas chamadas você pode fazer por minuto. Se exceder, o servidor devolve erro 429. |

### Semáforo de acesso

| Tag | Significado |
|---|---|
| **LOTE** | Existe download da base inteira. Melhor cenário. |
| **API-LOTE** | API que varre por período/órgão/UF, não por empresa. Equivalente a lote. |
| **MISTO** | Parte em lote, parte em consulta. |
| **MANUAL** | Só consulta individual/captcha. Evitar para volume. |

### Mapa mental: “quero saber X, uso Y”

| Pergunta | Fonte principal |
|---|---|
| Quem vende para o governo? | PNCP, Compras.gov.br |
| Quem foi sancionado? | CEIS/CNEP, TCU |
| Quem deve à União? | PGFN (DAU) |
| Quem recebeu dinheiro público? | Portal da Transparência, Transferegov |
| Quem forneceu para político/campanha? | TSE, CEAP, Senado |
| Quem realmente opera na saúde? | CNES, ANS |
| Quem opera em combustíveis? | ANP |
| Quem é transportador? | ANTT |
| Quem é do agro? | MAPA |
| Quem tem passivo ambiental? | IBAMA |
| Quem minera? | ANM |
| Quem gera/comercializa energia? | ANEEL |
| Quem se fundiu/comprou? | CADE |
| Quem é companhia aberta? | CVM |
| Quem é dono da marca? | INPI |
| Quem exporta/importa? | Comex Stat |
| Onde fica o endereço? | IBGE (CNEFE), OpenStreetMap |
| Quem é o grupo global? | GLEIF |
| Como é a reputação do consumidor? | Consumidor.gov.br |
| O que aconteceu no município? | Querido Diário |

---

## 2. Resumo executivo

| Fonte | Dono | O que entrega | Acesso | CNPJ? | Prioridade |
|---|---|---|---|---|---|
| **PNCP** | Comitê Gestor da Rede Nacional de Contratações Públicas (MGI) | Licitações, contratos, atas, itens, valores, fornecedores | API-LOTE + export CSV da busca | Sim | **1** |
| **Compras.gov.br** | Ministério da Gestão e Inovação (MGI) | Compras federais, contratos, fornecedores, preços | LOTE/API-LOTE | Sim | **1** |
| **Portal da Transparência (CEIS/CNEP)** | CGU | Empresas inidôneas, suspensas e punidas | LOTE | Sim | **1** |
| **PGFN (DAU)** | Procuradoria-Geral da Fazenda Nacional | Dívida Ativa da União | LOTE | Sim | **1** |
| **TCU** | Tribunal de Contas da União | Inidôneos, inabilitados, contas irregulares | LOTE/API | Sim | **1** |
| **TSE** | Tribunal Superior Eleitoral | Prestação de contas de campanhas, fornecedores | LOTE | Sim | **2** |
| **Câmara (CEAP)** | Câmara dos Deputados | Despesas de gabinete, fornecedores | LOTE/API | Sim | **2** |
| **Transferegov** | Ministério da Gestão e Inovação (MGI) | Convênios e repasses federais | LOTE/API-LOTE | Sim | **2** |
| **CNES** | Ministério da Saúde/DATASUS | Estabelecimentos de saúde, leitos, equipamentos | LOTE/API-LOTE | Sim | **2** |
| **ANP** | Agência Nacional do Petróleo | Postos, preços de combustíveis, autorizações | LOTE/MISTO | Sim | **2** |
| **ANTT** | Agência Nacional de Transportes Terrestres | Transportadores registrados (RNTRC) | LOTE/API | Sim | **2** |
| **MAPA** | Ministério da Agricultura e Pecuária | Estabelecimentos agropecuários, SIF/SIE/SIM | MISTO | Sim | **2** |
| **IBAMA** | Instituto Brasileiro do Meio Ambiente | Autos de infração, embargos, CTF | LOTE | Sim | **2** |
| **ANM** | Agência Nacional de Mineração | Títulos minerários, CFEM | LOTE | Sim | **2** |
| **ANEEL** | Agência Nacional de Energia Elétrica | Usinas, agentes, outorgas | LOTE | Sim (SIGA) | **2** |
| **CADE** | Conselho Administrativo de Defesa Econômica | Atos de concentração, processos | MISTO | Nem sempre | **3** |
| **CVM** | Comissão de Valores Mobiliários | Companhias abertas, subsidiárias, fundos | LOTE | Sim | **3** |
| **INPI** | Instituto Nacional da Propriedade Industrial | Marcas, patentes, softwares | LOTE (RPI) + consulta | Parcial | **3** |
| **Comex Stat** | MDIC | Exportação/importação, empresas exportadoras | LOTE | Sim (lista) | **3** |
| **IBGE (CNEFE)** | IBGE | Endereços e coordenadas | LOTE | Não | **1** |
| **OpenStreetMap** | Fundação OSM (comunidade) | POIs, marcas, endereços | LOTE | Não | **1** |

---

## 3. Fichas detalhadas

### 3.1 PNCP — Portal Nacional de Contratações Públicas

**Quem é o dono:** o Comitê Gestor da Rede Nacional de Contratações Públicas, ligado ao Ministério da Gestão e da Inovação em Serviços Públicos (MGI). Os dados são enviados por órgãos federais, estaduais e municipais.

**Por que existe:** a Lei nº 14.133/2021 (nova Lei de Licitações) obriga a publicação centralizada de licitações, contratos, atas de registro de preços e planos de contratação. O PNCP é o portal nacional que centraliza isso.

**Por que é público:** a lei trata a publicidade como condição de eficácia dos atos de contratação. Qualquer pessoa pode consultar sem login, e o portal publica dados abertos e APIs.

**O que tem:** contratações, contratos, atas, itens, valores, órgão comprador, fornecedor (CNPJ), vigência, aditivos e, mais recentemente, a NF-e vinculada a contratos públicos. Também tem plano anual de contratações e catálogo de padronização.

**Massa ou por empresa?** **API-LOTE por período**, não por empresa. A API é paginada (até 500 registros por página) e aceita filtros por data, órgão, UF, município e modalidade. A tela do PNCP também permite gerar CSV/XLSX de uma busca. **Não existe um dump nacional único**; a recomendação oficial é varrer por período.

**CNPJ?** Sim, do fornecedor e do órgão.

**Frequência:** contínua/diária.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** arestas `supplier_of_public_body`, `won_contract`, `contract_value`, `contract_expiry`; benchmark de preços; radar de renovação.

**Cuidados:** a cobertura é crescente, mas muitos municípios pequenos ainda publicam só no portal local; a API é lenta e devolve 429 com frequência; alguns órgãos publicam atrasado. Planeje ingestão incremental diária, com retry e backoff.

**Link:** `https://pncp.gov.br` — API: `https://pncp.gov.br/api/consulta`

---

### 3.2 Compras.gov.br

**Quem é o dono:** Ministério da Gestão e da Inovação em Serviços Públicos (MGI). É o sistema de compras do governo federal.

**Por que existe:** centralizar o ciclo de compras federais (licitação, contrato, ata, fornecedor) e dar transparência aos gastos.

**Por que é público:** transparência ativa e Lei de Acesso à Informação; o portal publica API de Dados Abertos, repositório CSV e dados no padrão internacional OCDS.

**O que tem:** licitações, contratos, fornecedores, itens, preços, atas, compras sem licitação e o legado da Lei 8.666/1993. Também tem painel de pesquisa de preços.

**Massa ou por empresa?** **LOTE/API-LOTE**. Você baixa o conjunto ou varre por período/órgão; não precisa consultar empresa por empresa.

**CNPJ?** Sim, do fornecedor e do órgão.

**Frequência:** contínua.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** compras federais, benchmark de preços, grafo fornecedor→órgão, séries históricas.

**Cuidados:** o foco é federal; para municipal, use PNCP e TCEs. Parte do legado tem qualidade irregular.

**Link:** `https://www.gov.br/compras/pt-br/cidadao/portal-de-dados-abertos` — API: `https://dadosabertos.compras.gov.br`

---

### 3.3 Portal da Transparência — CEIS/CNEP

**Quem é o dono:** Controladoria-Geral da União (CGU).

**Por que existe:** o CEIS (Cadastro Nacional de Empresas Inidôneas e Suspensas) e o CNEP (Cadastro Nacional de Empresas Punidas) registram empresas e pessoas que sofreram sanções administrativas. A consulta é obrigatória em contratações públicas.

**Por que é público:** a lei de licitações exige a divulgação das sanções para proteger o erário e permitir o controle social.

**O que tem:** CEIS, CNEP, acordos de leniência, cartões de pagamento do governo federal, favorecidos por despesa, convênios e outras bases.

**Massa ou por empresa?** **LOTE**. Os arquivos são CSV, baixados inteiros, com atualização diária ou mensal. Não precisa consultar empresa por empresa.

**CNPJ?** Sim, na maioria dos registros.

**Frequência:** diária/mensal, conforme a base.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** flag `sanctioned`, `leniency_agreement`, `federal_payment_recipient`.

**Cuidados:** sanção administrativa não é condenação penal; leia a natureza, o órgão sancionador e a validade. Alguns registros podem estar sub judice.

**Link:** `https://portaldatransparencia.gov.br/download-de-dados` — CEIS: `https://portaldatransparencia.gov.br/download-de-dados/ceis`

---

### 3.4 PGFN — Dívida Ativa da União (DAU)

**Quem é o dono:** Procuradoria-Geral da Fazenda Nacional (PGFN), vinculada ao Ministério da Fazenda.

**Por que existe:** a PGFN cobra judicialmente os créditos da União inscritos em dívida ativa. A lista pública existe para dar transparência à cobrança.

**Por que é público:** é um cadastro de devedores da União, com publicidade prevista em lei e disponibilizado em dados abertos.

**O que tem:** devedores pessoa jurídica e pessoa física, CNPJ/CPF, valor consolidado, natureza da dívida, número de inscrição e situação.

**Massa ou por empresa?** **LOTE**. Arquivo CSV com a base inteira, atualizado mensalmente.

**CNPJ?** Sim.

**Frequência:** mensal.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** flag `debtor`, `debt_value`, `debt_nature`.

**Cuidados:** estar na dívida ativa não significa insolvência; a dívida pode estar parcelada, garantida ou contestada. Use como sinal, não como sentença.

**Link:** `https://dadosabertos.pgfn.gov.br`

---

### 3.5 TCU — inidôneos, inabilitados e contas irregulares

**Quem é o dono:** Tribunal de Contas da União (TCU), órgão de controle externo do Congresso Nacional.

**Por que existe:** o TCU fiscaliza a aplicação de recursos federais e julga as contas de gestores. As listas de inidôneos, inabilitados e contas irregulares servem para impedir que pessoas e empresas com histórico grave contratem com o poder público.

**Por que é público:** o controle externo é público por mandato constitucional; as listas e certidões são instrumentos de transparência e de defesa do erário.

**O que tem:** listas de licitantes inidôneos, responsáveis inabilitados, contas julgadas irregulares, jurisprudência e webservices.

**Massa ou por empresa?** **LOTE/API**. Há webservices REST (JSON) e downloads em CSV. A certidão individual existe, mas o volume principal está nas listas.

**CNPJ?** Sim, quando o responsável é pessoa jurídica.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** flags `barred_from_federal_contracts`, `irregular_accounts`, `ineligible`.

**Cuidados:** algumas listas têm finalidade eleitoral e escopo temporal específico; leia o que cada lista significa antes de cruzar.

**Link:** `https://sites.tcu.gov.br/dados-abertos`

---

### 3.6 TSE — Prestação de Contas Eleitorais

**Quem é o dono:** Tribunal Superior Eleitoral (TSE).

**Por que existe:** a Justiça Eleitoral fiscaliza a arrecadação e os gastos das campanhas e dos partidos. A prestação de contas é obrigatória para candidatos e partidos.

**Por que é público:** a Lei nº 9.504/1997 determina a divulgação das contas eleitorais. O TSE publica os dados em seu Portal de Dados Abertos.

**O que tem:** receitas, despesas, fornecedores (com CNPJ), documentos fiscais, candidatos, partidos, comitês e transferências entre campanhas.

**Massa ou por empresa?** **LOTE**. Arquivos CSV/TXT por eleição e por tipo de prestação de contas. Não é consulta por empresa.

**CNPJ?** Sim, do fornecedor e do CNPJ de campanha.

**Frequência:** anual/por eleição.

**Custo/licença:** gratuito; dados abertos (CC-BY).

**Uso no PROSPECT:** arestas `campaign_supplier`, `politician_supplier`; cruzamento com contratos públicos e CEAP.

**Cuidados:** desde 2015, empresas não podem doar diretamente para campanhas; o que existe é **fornecimento** de bens e serviços. Não confunda fornecedor de campanha com doador.

**Link:** `https://dadosabertos.tse.jus.br`

---

### 3.7 Câmara dos Deputados — CEAP

**Quem é o dono:** Câmara dos Deputados.

**Por que existe:** a Cota para o Exercício da Atividade Parlamentar (CEAP) reembolsa despesas do mandato, como passagens, aluguel de veículos, combustível, divulgação e manutenção de escritório.

**Por que é público:** é dinheiro público; a Câmara publica os gastos e os fornecedores em dados abertos, com API e CSV.

**O que tem:** despesas por deputado, tipo de despesa, fornecedor (CNPJ/CPF), valor, data, documento fiscal e trecho.

**Massa ou por empresa?** **LOTE/API**. Arquivos CSV por ano e API REST. Não precisa consultar empresa por empresa.

**CNPJ?** Sim, do fornecedor (campo `cnpjCpfFornecedor`).

**Frequência:** mensal.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** `politician_supplier`, `same_supplier_as_public_body`, `gabinete_expense`.

**Cuidados:** parte dos fornecedores é pessoa física (CPF); trate como dado pessoal e não exponha. O reembolso não é prova de irregularidade.

**Link:** `https://dadosabertos.camara.leg.br`

---

### 3.8 Transferegov

**Quem é o dono:** Ministério da Gestão e da Inovação em Serviços Públicos (MGI).

**Por que existe:** operacionalizar as transferências voluntárias da União para estados, municípios, consórcios e entidades privadas sem fins lucrativos — convênios, contratos de repasse e termos similares.

**Por que é público:** é orçamento público; a plataforma publica dados abertos, arquivos CSV e APIs.

**O que tem:** convênios, proponentes, concedentes, valores, objetos, prazos, execução e prestação de contas.

**Massa ou por empresa?** **LOTE/API-LOTE**. Há repositório CSV e API pública por módulo. A API está em expansão; confira a documentação do módulo.

**CNPJ?** Sim, do proponente e do concedente.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `federal_transfer`, `convenio`, `proponente`.

**Cuidados:** a API nova cobre inicialmente os atos preparatórios; para o histórico, use os CSVs. Compare sempre período e módulo.

**Link:** `https://api-publica.transferegov.gestao.gov.br`

---

### 3.9 CNES — Cadastro Nacional de Estabelecimentos de Saúde

**Quem é o dono:** Ministério da Saúde, operado pelo DATASUS.

**Por que existe:** cadastrar todos os estabelecimentos de saúde do país, públicos e privados, para operar o SUS e planejar a assistência.

**Por que é público:** é a base cadastral oficial da saúde; os dados são publicados em dados abertos e API.

**O que tem:** estabelecimentos, CNPJ da entidade mantenedora, tipo de unidade, leitos, equipamentos, profissionais, endereço, coordenadas e vínculo com o SUS.

**Massa ou por empresa?** **LOTE/API-LOTE**. Há CSV nacional e API com paginação; não é consulta por empresa.

**CNPJ?** Sim, no campo `numero_cnpj_entidade` (CNPJ da entidade mantenedora).

**Frequência:** diária.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** `health_establishment`, `beds`, `equipment`, `sus_link`.

**Cuidados:** o CNPJ é da entidade mantenedora, não necessariamente do estabelecimento; pode haver mais de um estabelecimento sob o mesmo CNPJ.

**Link:** `https://dadosabertos.saude.gov.br/dataset/cnes-cadastro-nacional-de-estabelecimentos-de-saude`

---

### 3.10 ANP — Agência Nacional do Petróleo, Gás Natural e Biocombustíveis

**Quem é o dono:** ANP, autarquia federal vinculada ao Ministério de Minas e Energia.

**Por que existe:** regular o setor de petróleo, gás e biocombustíveis, autorizar agentes e fiscalizar a qualidade e os preços dos combustíveis.

**Por que é público:** a ANP publica autorizações, cadastros e pesquisas de preços em dados abertos, como parte da transparência regulatória.

**O que tem:** autorizações de revendedores (CNPJ), levantamento semanal de preços por posto, importadores, produtores, distribuidores e interdições.

**Massa ou por empresa?** **LOTE** para a pesquisa de preços; **MISTO** para autorizações (parte em CSV, parte em consulta).

**CNPJ?** Sim, do revendedor.

**Frequência:** semanal (preços) e contínua (autorizações).

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `fuel_station`, `fuel_price`, `authorized_reseller`, `interdiction`.

**Cuidados:** a pesquisa de preços é amostral e semanal, não é NF-e. Nem todo posto aparece em todas as semanas.

**Link:** `https://www.gov.br/anp/pt-br/assuntos/combustiveis/combustiveis-liquidos` — dados: `https://dados.gov.br/dataset/levantamento-de-precos-de-combustiveis`

---

### 3.11 ANTT — Agência Nacional de Transportes Terrestres

**Quem é o dono:** ANTT, autarquia federal vinculada ao Ministério dos Transportes.

**Por que existe:** regular o transporte terrestre, incluindo o transporte rodoviário de cargas (RNTRC) e as concessões de rodovias.

**Por que é público:** o registro de transportadores e as concessões são dados públicos, disponibilizados em dados abertos.

**O que tem:** transportadores registrados (CNPJ), categoria, situação, veículos, licenças e concessões.

**Massa ou por empresa?** **LOTE/API**. Há arquivos CSV e API; não é consulta por empresa.

**CNPJ?** Sim.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `logistics_provider`, `fleet`, `rntrc_status`.

**Cuidados:** o registro não garante frota própria; muitos transportadores são autônomos ou agregados.

**Link:** `https://dados.antt.gov.br`

---

### 3.12 MAPA — Ministério da Agricultura e Pecuária

**Quem é o dono:** Ministério da Agricultura e Pecuária (MAPA).

**Por que existe:** registrar e inspecionar estabelecimentos agropecuários, garantir sanidade animal e vegetal e habilitar exportações.

**Por que é público:** a defesa agropecuária é atividade estatal; os registros e certificações são publicados para transparência e controle.

**O que tem:** estabelecimentos registrados no SIF/SIE/SIM, produtos, certificações, habilitados a exportar e registros de agroquímicos.

**Massa ou por empresa?** **MISTO**. Alguns conjuntos estão em CSV; a consulta de estabelecimento é individual. Não é um dump único de tudo.

**CNPJ?** Sim, quando disponível no registro.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `agro_establishment`, `export_certified`, `sanitary_registration`.

**Cuidados:** a cobertura varia por estado e por tipo de registro; nem todo estabelecimento tem CNPJ no layout.

**Link:** `https://dados.agricultura.gov.br` — consulta: `https://sistemasweb.agricultura.gov.br`

---

### 3.13 IBAMA — Instituto Brasileiro do Meio Ambiente e dos Recursos Naturais Renováveis

**Quem é o dono:** IBAMA, autarquia federal vinculada ao Ministério do Meio Ambiente.

**Por que existe:** fiscalizar o cumprimento da legislação ambiental, licenciar empreendimentos federais e manter o Cadastro Técnico Federal (CTF).

**Por que é público:** a fiscalização ambiental e os autos de infração são dados públicos, disponibilizados em dados abertos.

**O que tem:** autos de infração, embargos, CTF, licenças, apreensões e processos.

**Massa ou por empresa?** **LOTE**. Arquivos CSV no portal de dados abertos.

**CNPJ?** Sim, do autuado/embargado.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** flags `environmental_violation`, `embargo`, `ctf_registered`.

**Cuidados:** auto de infração não é condenação definitiva; pode haver recurso e revisão. Leia a situação do processo.

**Link:** `https://dadosabertos.ibama.gov.br`

---

### 3.14 ANM — Agência Nacional de Mineração

**Quem é o dono:** ANM, autarquia federal vinculada ao Ministério de Minas e Energia.

**Por que existe:** regular a mineração, outorgar títulos minerários e arrecadar a Compensação Financeira pela Exploração de Recursos Minerais (CFEM).

**Por que é público:** os títulos minerários e a CFEM são dados públicos, com publicação em dados abertos.

**O que tem:** cadastro mineiro, títulos, requerimentos, barragens de mineração e arrecadação de CFEM por titular (CNPJ).

**Massa ou por empresa?** **LOTE**. Arquivos CSV no portal de dados abertos.

**CNPJ?** Sim, do titular.

**Frequência:** mensal/contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `mining_title`, `royalty_payer`, `mining_activity`.

**Cuidados:** ter título não significa estar produzindo; a CFEM paga é a melhor proxy de atividade real.

**Link:** `https://dadosabertos.anm.gov.br`

---

### 3.15 ANEEL — Agência Nacional de Energia Elétrica

**Quem é o dono:** ANEEL, autarquia federal vinculada ao Ministério de Minas e Energia.

**Por que existe:** regular a geração, transmissão, distribuição e comercialização de energia elétrica.

**Por que é público:** o setor elétrico é regulado e os dados de agentes, usinas e outorgas são publicados em dados abertos.

**O que tem:** SIGA (usinas, agentes, CNPJ, participação), outorgas, liberação para operação comercial, geração distribuída (GD) e relatórios.

**Massa ou por empresa?** **LOTE**. CSV, Parquet e API no portal de dados abertos.

**CNPJ?** Sim no SIGA e nos agentes; **não** na GD, onde o titular é tarjado.

**Frequência:** diária/mensal.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `energy_agent`, `power_plant`, `outorga`, `commercial_operation`.

**Cuidados:** não use a base de GD para CNPJ; o titular vem mascarado. Para empresa, use SIGA/agentes.

**Link:** `https://dadosabertos.aneel.gov.br`

---

### 3.16 CADE — Conselho Administrativo de Defesa Econômica

**Quem é o dono:** CADE, autarquia federal vinculada ao Ministério da Justiça.

**Por que existe:** defender a concorrência, julgar atos de concentração (fusões, aquisições, joint ventures) e investigar condutas anticompetitivas.

**Por que é público:** os processos e decisões são públicos, com publicação de atos de concentração e painéis de acompanhamento.

**O que tem:** atos de concentração, partes envolvidas, setores, decisões, TCCs, processos administrativos e multas.

**Massa ou por empresa?** **MISTO**. Há painéis e conjuntos em CSV, mas a cobertura granular varia; parte exige consulta processual.

**CNPJ?** Nem sempre; muitas vezes só o nome das partes.

**Frequência:** contínua.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `merged_with`, `joint_venture`, `antitrust_case`, `acquirer_of`.

**Cuidados:** o CADE só cobre operações acima dos thresholds legais; é um recorte de M&A, não o mercado inteiro.

**Link:** `https://www.gov.br/cade/pt-br/acesso-a-informacao/dados-abertos` — painel: `https://qap.cade.gov.br/extensions/cadenumeros/atosdeconcentracao.html`

---

### 3.17 CVM — Comissão de Valores Mobiliários

**Quem é o dono:** CVM, autarquia federal vinculada ao Ministério da Fazenda.

**Por que existe:** regular o mercado de capitais, proteger investidores e fiscalizar companhias abertas, fundos e intermediários.

**Por que é público:** o mercado de capitais é regulado com transparência obrigatória; a CVM publica dados abertos de companhias, fundos e sanções.

**O que tem:** companhias abertas, formulários de referência, subsidiárias, acionistas, fundos, fatos relevantes, ofertas e sanções.

**Massa ou por empresa?** **LOTE**. Arquivos CSV no portal de dados abertos.

**CNPJ?** Sim, das companhias e fundos.

**Frequência:** diária/mensal.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `listed_company`, `subsidiary_of`, `shareholder_of`, `fund_manager`.

**Cuidados:** cobre companhias abertas e fundos; não cobre PMEs fechadas.

**Link:** `https://dados.cvm.gov.br`

---

### 3.18 INPI — Instituto Nacional da Propriedade Industrial

**Quem é o dono:** INPI, autarquia federal vinculada ao Ministério do Desenvolvimento, Indústria, Comércio e Serviços.

**Por que existe:** registrar marcas, patentes, desenhos industriais, programas de computador e transferências de tecnologia.

**Por que é público:** a propriedade industrial é um registro público; a Revista da Propriedade Industrial (RPI) é publicada semanalmente.

**O que tem:** RPI em XML (marcas, patentes, desenhos, softwares, contratos), titular, classes, status, oposições e decisões.

**Massa ou por empresa?** **LOTE XML (RPI)** para o volume; **consulta** para uma marca/processo específico. A base completa de marcas em CSV ainda é limitada.

**CNPJ?** O titular pode ser pessoa jurídica, mas o CNPJ nem sempre vem estruturado; pode exigir match por nome.

**Frequência:** semanal.

**Custo/licença:** gratuito.

**Uso no PROSPECT:** `brand_owner`, `patent_owner`, `software_registration`, `licensed_to`.

**Cuidados:** a RPI é grande e exige parser; a cobertura de marcas em formato tabular ainda está em evolução.

**Link:** `https://www.gov.br/inpi/pt-br/acesso-a-informacao/dados-abertos`

---

### 3.19 Comex Stat

**Quem é o dono:** Ministério do Desenvolvimento, Indústria, Comércio e Serviços (MDIC), com dados da Secretaria de Comércio Exterior (SECEX).

**Por que existe:** divulgar as estatísticas oficiais de exportação e importação brasileiras, a partir do SISCOMEX.

**Por que é público:** as estatísticas de comércio exterior são publicadas em dados abertos para pesquisa, imprensa e planejamento.

**O que tem:** exportação/importação por NCM, país, UF, município, via de transporte, peso e valor; e a lista de empresas exportadoras/importadoras com CNPJ e totais por ano.

**Massa ou por empresa?** **LOTE**. Arquivos CSV por ano, mais a lista de empresas. O transacional é agregado; **não** tem CNPJ por operação.

**CNPJ?** Sim na lista de empresas exportadoras/importadoras; **não** no detalhamento transacional.

**Frequência:** mensal.

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** `exporter`, `importer`, `trade_value`, `main_products`, `destination_countries`.

**Cuidados:** não é “quem vendeu para quem”; o dado aberto não revela a contraparte comercial. O CNPJ por operação existe no Siscomex Estatístico, que é outro serviço, com credenciamento.

**Link:** `https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior/estatisticas/base-de-dados-bruta`

---

### 3.20 IBGE — CNEFE (Cadastro Nacional de Endereços para Fins Estatísticos)

**Quem é o dono:** Instituto Brasileiro de Geografia e Estatística (IBGE).

**Por que existe:** o IBGE precisa de uma lista completa de endereços para realizar o Censo e produzir estatísticas territoriais.

**Por que é público:** o Censo é um bem público; o CNEFE é publicado como dado aberto, com endereços e coordenadas.

**O que tem:** endereços, CEP, logradouro, número, bairro, município, coordenadas e tipo de uso.

**Massa ou por empresa?** **LOTE**. Arquivos CSV/ZIP por UF, do Censo 2022.

**CNPJ?** Não. É uma base de endereço, não de empresa.

**Frequência:** decenal (Censo 2022).

**Custo/licença:** gratuito; dados abertos.

**Uso no PROSPECT:** geocodificação, `same_address`, qualidade de endereço, análise territorial.

**Cuidados:** não tem CNPJ; o match com sua base é por CEP + logradouro + número. Pode haver duplicidade e endereços novos.

**Link:** `https://www.ibge.gov.br/estatisticas/downloads-estatisticas.html` (procurar CNEFE 2022)

---

### 3.21 OpenStreetMap (OSM)

**Quem é o dono:** Fundação OpenStreetMap, com uma comunidade global de voluntários.

**Por que existe:** criar um mapa livre, editável e reutilizável, alternativa aos mapas proprietários.

**Por que é público:** o dado é publicado sob a licença ODbL, que permite uso e redistribuição com atribuição e compartilhamento igual.

**O que tem:** POIs (pontos de interesse), nomes, marcas (`brand`), endereços, categorias, horários e geometrias.

**Massa ou por empresa?** **LOTE**. Extratos do Brasil em PBF/Shapefile, via Geofabrik.

**CNPJ?** Não. O match é por nome, endereço e coordenadas.

**Frequência:** diária.

**Custo/licença:** gratuito; ODbL (atribuição e share-alike).

**Uso no PROSPECT:** `poi`, `brand`, `same_location`, validação de endereço e de presença física.

**Cuidados:** a qualidade varia muito por região; não é cadastro oficial. A licença exige atribuição e cuidado se você misturar com dados proprietários.

**Link:** `https://download.geofabrik.de/south-america/brazil.html`

---

## 4. Segunda onda (fichas resumidas)

| Fonte | Dono | O que entrega | Acesso | CNPJ? | Uso no PROSPECT |
|---|---|---|---|---|---|
| **Senado — CEAPS** | Senado Federal | Despesas de gabinete dos senadores, fornecedores | LOTE CSV | Sim | `politician_supplier` |
| **ANS** | Agência Nacional de Saúde Suplementar | Operadoras, beneficiários, rede | LOTE CSV | Sim | `health_operator` |
| **BNDES** | Banco Nacional de Desenvolvimento Econômico e Social | Financiamentos por empresa | LOTE/API | Sim | `financed_by` |
| **GLEIF** | Global Legal Entity Identifier Foundation | LEI, parent/child global | LOTE/API | Às vezes (local ID) | `parent_of`, `group_entity` |
| **Consumidor.gov.br** | Senacon/Ministério da Justiça | Reclamações, índice de solução, satisfação | LOTE CSV | Nem sempre | `consumer_complaints` |
| **Querido Diário** | Open Knowledge Brasil (ONG) | Diários oficiais municipais, busca textual | API/LOTE | Não estruturado | `municipal_event`, `licitacao_texto` |
| **Base dos Dados** | Organização sem fins lucrativos | Mirrors em Parquet/BigQuery de várias fontes | LOTE | Depende | Atalho de ingestão |

### Notas rápidas

- **Senado — CEAPS:** mesmo espírito da CEAP, mas para senadores. CSV por ano. CNPJ do fornecedor. Cuidado com CPF de pessoa física.
- **ANS:** boa para saúde suplementar; operadoras têm CNPJ. Não cobre todos os prestadores; para estabelecimentos, use CNES.
- **BNDES:** mostra quem recebeu financiamento do banco público, valor e setor. Ótimo para `financed_by` e para identificar empresas de capital intensivo.
- **GLEIF:** padrão global de identificação de entidades jurídicas. O “local ID” às vezes é o CNPJ; nem sempre. Útil para grupos multinacionais.
- **Consumidor.gov.br:** base de reclamações de empresas participantes. A participação é voluntária; ausência não significa ausência de reclamação. O CNPJ pode não vir estruturado.
- **Querido Diário:** cobre milhares de municípios, mas o dado é texto de diário oficial, não tabela. Serve para busca textual e para achar licitações, contratos, nomeações e sanções locais.
- **Base dos Dados:** não é fonte primária; é um espelho organizado de bases públicas. Excelente atalho para DuckDB, mas confira a data de atualização.

---

## 5. O que não está aqui (e por quê)

Esta seção não é uma lista de alternativas: ela existe para evitar que você perca tempo procurando bases que não são públicas, não são gratuitas ou não têm CNPJ. As fontes recomendadas e gratuitas estão nas seções 3 e 4.

| Base | Por que não entrou |
|---|---|
| **NF-e B2B** | Sigilo fiscal. Não existe base pública nacional de notas fiscais entre empresas. O PNCP exibe NF-e vinculada a contratos públicos, mas isso é consulta por contrato, não uma base B2B. |
| **SPED/ECD/ECF** | Sigilo fiscal. Não é público no nível da empresa. |
| **SCR/Bacen** | Sigilo bancário. Não é público. |
| **Serasa/Boavista** | Serviços privados e pagos. |
| **Protestos** | Base privada (CENPROT), sem acesso público em massa. |
| **Siscomex Estatístico** | Serviço com credenciamento; o dado aberto do Comex é agregado. |
| **RAIS/CAGED por CNPJ** | Microdados públicos são anonimizados e não trazem CNPJ. Não permitem ranking por empresa. |
| **DataJud por CNPJ** | A API pública do CNJ omite partes e CPF/CNPJ. Não dá para puxar processo por empresa. |
| **SICAR (titular)** | A consulta pública não entrega o titular de forma confiável; tratar como dado sensível. |
| **ANEEL GD (titular)** | O titular vem tarjado; não serve para CNPJ. |
| **OpenSanctions** | Gratuito, mas com licença CC-BY-NC; uso comercial exige licença. Não entrou na lista principal por isso. |

---

## 6. Como o PROSPECT usa isso

### 6.1 Chaves canônicas

- `cnpj_14` — estabelecimento.
- `cnpj_raiz_8` — empresa.
- `pessoa_id` — sócio resolvido (nome + CPF hash quando disponível).
- `endereco_id` — endereço normalizado/geocodificado.
- `marca_id` — marca do INPI.

### 6.2 Arestas tipadas

```
edges (
  source_type, source_id,
  target_type, target_id,
  edge_type,
  evidence,        -- URL, campo, trecho
  confidence,      -- 0..1
  valid_from, valid_to,
  snapshot
)
```

Exemplos de `edge_type`:

- `supplier_of_public_body`
- `won_contract`
- `sanctioned`
- `debtor`
- `partner_of`
- `same_address`
- `same_phone`
- `same_email`
- `brand_owner`
- `licensed_to`
- `merged_with`
- `parent_of`
- `financed_by`
- `exporter`
- `importer`
- `health_establishment`
- `fuel_station`
- `mining_title`
- `energy_agent`

### 6.3 Ingestão

1. **Raw** — guardar o arquivo original (CSV, ZIP, XML) e o hash.
2. **Staging** — tabela crua, sem tipagem forte.
3. **Normalized** — CNPJ como texto, datas ISO, valores decimais, nomes normalizados.
4. **Graph** — arestas com evidência, confiança e snapshot.
5. **Read models** — `estabelecimentos_busca` continua sendo a tabela de leitura principal; o enriquecimento entra em tabelas satélites.

### 6.4 Snapshot e qualidade

- Registrar `fonte`, `url`, `licenca`, `data_extracao`, `data_referencia`, `hash` e `versao`.
- Não comparar fontes sem data de referência.
- CNPJ sempre texto; normalizar maiúsculas (alfanumérico já é realidade).
- Nome matching com `nome_normalizado` + `municipio` + `CEP` + `CNAE` + `telefone`/`email`.
- CPF: hash, nunca texto claro; quando a fonte expõe, restringir acesso.
- Dedupe de endereço e de pessoa com `confianca`.
- Não criar score composto; expor fatos e flags e deixar o usuário ranquear.

### 6.5 LGPD e licenças

- Dado público não é automaticamente livre para redistribuir. Verificar a licença de cada fonte.
- OSM é ODbL (atribuição e share-alike).
- TSE, Câmara, IBGE e a maioria das fontes federais usam licença aberta, mas confira o rodapé de cada portal.
- Não scrapear captcha; preferir bulk/API oficial.
- Documentar base legal e finalidade; minimizar CPF.
- Dados de sanção, dívida e processo são sensíveis para reputação: sempre mostrar fonte, data e natureza.

### 6.6 Operação

- PNCP é lento e devolve 429; ingestão incremental diária, com retry e backoff.
- TSE é anual; CEAP é mensal; CNES é diário; ANP é semanal; DAU é mensal.
- Comex é mensal; CVM é diária/mensal; INPI é semanal; ANM é mensal.
- Base dos Dados pode economizar semanas de ingestão para RAIS, CAGED, Comex, TSE, Câmara, CNES, ANS, ANP, ANEEL e BNDES.

---

## 7. Ordem de implantação sugerida

### 0–2 semanas

1. **PNCP** — começar por contratos e fornecedores.
2. **CEIS/CNEP** — flags de sanção.
3. **PGFN (DAU)** — flags de dívida.
4. **TCU** — inidôneos e contas irregulares.
5. **IBGE (CNEFE)** — geocodificação.
6. **OpenStreetMap** — POIs e validação de endereço.

### 2–4 semanas

7. **Compras.gov.br** — compras federais e benchmark.
8. **CEAP** — fornecedores de gabinete.
9. **TSE** — fornecedores de campanha.
10. **Transferegov** — convênios.

### 1–2 meses

11. **CNES** — saúde.
12. **ANP** — combustíveis.
13. **ANTT** — transportadores.
14. **MAPA** — agro.
15. **IBAMA** — ambiental.
16. **ANM** — mineração.
17. **ANEEL** — energia.

### 2–3 meses

18. **CADE** — M&A.
19. **CVM** — companhias abertas.
20. **INPI** — marcas e patentes.
21. **Comex Stat** — comércio exterior.
22. **Consumidor.gov.br** — reputação.

### Depois

23. **GLEIF** — grupos globais.
24. **BNDES** — financiamentos.
25. **ANS** — saúde suplementar.
26. **Senado** — CEAPS.
27. **Querido Diário** — diários municipais.
28. **Base dos Dados** — atalho e validação.

---

## 8. Checklist antes de ingerir qualquer fonte

- [ ] A fonte é oficial ou tem licença clara?
- [ ] Tem CNPJ? Em qual campo? É CNPJ raiz ou estabelecimento?
- [ ] É lote, API em lote ou consulta por empresa?
- [ ] Qual a frequência de atualização?
- [ ] Qual a data de referência do arquivo?
- [ ] Qual a licença? Exige atribuição? Permite uso interno?
- [ ] Tem CPF? Como vou mascarar/hashear?
- [ ] Como vou resolver nome/endereço sem CNPJ?
- [ ] Qual aresta isso gera no grafo?
- [ ] Qual a confiança inicial?
- [ ] Como vou provar a origem (URL, campo, data)?
- [ ] Isso vira flag/fato, não score composto?
- [ ] O volume cabe no DuckDB? Precisa de Parquet?
- [ ] A ingestão é idempotente?

---

## 9. Glossário de siglas

| Sigla | Nome |
|---|---|
| **ANM** | Agência Nacional de Mineração |
| **ANEEL** | Agência Nacional de Energia Elétrica |
| **ANP** | Agência Nacional do Petróleo, Gás Natural e Biocombustíveis |
| **ANS** | Agência Nacional de Saúde Suplementar |
| **ANTT** | Agência Nacional de Transportes Terrestres |
| **CADE** | Conselho Administrativo de Defesa Econômica |
| **CEAP** | Cota para o Exercício da Atividade Parlamentar |
| **CEIS** | Cadastro Nacional de Empresas Inidôneas e Suspensas |
| **CNEP** | Cadastro Nacional de Empresas Punidas |
| **CNES** | Cadastro Nacional de Estabelecimentos de Saúde |
| **CNEFE** | Cadastro Nacional de Endereços para Fins Estatísticos |
| **CVM** | Comissão de Valores Mobiliários |
| **DAU** | Dívida Ativa da União |
| **GLEIF** | Global Legal Entity Identifier Foundation |
| **IBAMA** | Instituto Brasileiro do Meio Ambiente e dos Recursos Naturais Renováveis |
| **IBGE** | Instituto Brasileiro de Geografia e Estatística |
| **INPI** | Instituto Nacional da Propriedade Industrial |
| **MAPA** | Ministério da Agricultura e Pecuária |
| **MDIC** | Ministério do Desenvolvimento, Indústria, Comércio e Serviços |
| **MGI** | Ministério da Gestão e da Inovação em Serviços Públicos |
| **OSM** | OpenStreetMap |
| **PGFN** | Procuradoria-Geral da Fazenda Nacional |
| **PNCP** | Portal Nacional de Contratações Públicas |
| **RNTRC** | Registro Nacional de Transportadores Rodoviários de Cargas |
| **TCU** | Tribunal de Contas da União |
| **TSE** | Tribunal Superior Eleitoral |

---

## 10. Observação final

O ganho não está em ter “mais uma coluna”. Está em transformar o PROSPECT em um **grafo de evidências**: empresa → sócio → endereço → contrato → sanção → marca → licença → exportação.

A pergunta “quem vende para quem” no B2B privado não tem resposta pública. O equivalente público — **quem vende para o Estado, para campanhas e para o poder** — é o que estas fontes permitem construir.

Tudo neste documento é gratuito. O custo real é de **ingestão, normalização e manutenção**.
