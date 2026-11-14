import { loadSample } from './load.js';

loadSample().catch((error) => {
  console.error('Falha ao carregar amostra:', error);
  process.exit(1);
});
