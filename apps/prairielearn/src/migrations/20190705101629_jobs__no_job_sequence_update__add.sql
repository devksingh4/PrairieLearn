ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS no_job_sequence_update BOOLEAN DEFAULT FALSE;
