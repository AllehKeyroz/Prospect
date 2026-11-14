import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { loadFromSnapshotDir } from './load.js';

/**
 * Placeholder para a carga completa.
 *
 * Fluxo esperado:
 *   1. baixar os 37 ZIPs de um snapshot para data/raw/<snapshot>/
 *   2. extrair os CSVs para data/extracted/<snapshot>/{empresas,estabelecimentos,socios,simples}/
 *      e as dimensões para data/extracted/<snapshot>/dim_*.csv
 *   3. chamar loadFromCsvDir com esse diretório.
 *
 * Nesta primeira versão, a carga completa usa o mesmo loader da amostra.
 * O diretório precisa conter os arquivos com os nomes:
 *   empresas.csv, estabelecimentos.csv, socios.csv, simples.csv,
 *   dim_cnae.csv, dim_municipio.csv, dim_natureza.csv,
 *   dim_qualificacao.csv, dim_motivo.csv, dim_pais.csv
 */
async function main(): Promise<void> {
  const dir = path.join(config.dataDir, 'extracted', config.snapshot);
  if (!fs.existsSync(dir)) {
    console.error(`Diretório não encontrado: ${dir}`);
    console.error('Gere a amostra primeiro com: npm run sample && npm run ingest:sample');
    console.error('A extração do snapshot completo será adicionada na próxima etapa.');
    process.exit(1);
  }
  await loadFromSnapshotDir({ dir, snapshot: config.snapshot, reset: true });
}

main().catch((error) => {
  console.error('Falha na carga completa:', error);
  process.exit(1);
});
