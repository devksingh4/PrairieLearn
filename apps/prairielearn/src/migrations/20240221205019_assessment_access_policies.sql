CREATE TABLE IF NOT EXISTS assessment_access_policies (
  id BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT NOT NULL REFERENCES assessments (id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id BIGINT REFERENCES users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  group_id BIGINT REFERENCES groups (id) ON UPDATE CASCADE ON DELETE CASCADE,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  credit INTEGER NOT NULL,
  note TEXT,
  created_by BIGINT NOT NULL REFERENCES users (user_id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, user_id),
  UNIQUE (assessment_id, group_id),
  CHECK (num_nonnulls (user_id, group_id) = 1),
  CHECK (credit >= 0)
);
