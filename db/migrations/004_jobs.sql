-- Prospect — jobs de carga controlados pela interface
--
-- Cada execução de download/extração/carga vira uma linha em app.jobs, com a
-- saída do processo em app.job_logs. A tela #dados lê daqui para mostrar
-- progresso e log ao vivo.

CREATE TABLE IF NOT EXISTS app.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'error', 'cancelled')),
  step text,
  started_at timestamptz,
  finished_at timestamptz,
  exit_code integer,
  message text
);

CREATE INDEX IF NOT EXISTS ix_jobs_status ON app.jobs (status);
CREATE INDEX IF NOT EXISTS ix_jobs_started ON app.jobs (started_at DESC);

CREATE TABLE IF NOT EXISTS app.job_logs (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES app.jobs(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  line text NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_job_logs_job ON app.job_logs (job_id, id);

COMMENT ON TABLE app.jobs IS
  'Execuções de carga disparadas pela interface. Uma por clique em Baixar/Carregar.';
