-- Prospect — controle de progresso da carga
--
-- Permite retomar uma carga interrompida sem truncar o que já foi carregado.
-- Cada arquivo CSV carregado com sucesso vira uma linha aqui. O loader só
-- recomeça do zero quando recebe --reset.

CREATE TABLE IF NOT EXISTS core.load_progress (
  snapshot varchar(7) NOT NULL,
  section text NOT NULL,
  file text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot, section, file)
);

COMMENT ON TABLE core.load_progress IS
  'Arquivos já carregados por snapshot. Usado para retomar cargas interrompidas.';
