require('dotenv').config();
const { pool } = require('./pool');

const SQL = `
-- ─── Users (property owners / managers) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  phone       VARCHAR(30),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Properties ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     VARCHAR(300) NOT NULL,
  city        VARCHAR(100) NOT NULL,
  state       VARCHAR(100) NOT NULL,
  country     VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Tenants ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  occupation  VARCHAR(150),
  phone       VARCHAR(30),
  email       VARCHAR(255),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Leases ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leases (
  id              SERIAL PRIMARY KEY,
  property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  move_in_date    DATE NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  yearly_rent     NUMERIC(15, 2) NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 12,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired', 'renewed', 'terminated')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Payments ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  lease_id    INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount      NUMERIC(15, 2) NOT NULL,
  paid_date   DATE NOT NULL,
  note        TEXT,
  receipt_no  VARCHAR(30) UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Reminder logs (avoid duplicate sends) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_logs (
  id          SERIAL PRIMARY KEY,
  lease_id    INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  channel     VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms')),
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  days_before INTEGER NOT NULL
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_properties_user    ON properties(user_id);
CREATE INDEX IF NOT EXISTS idx_leases_property    ON leases(property_id);
CREATE INDEX IF NOT EXISTS idx_leases_status      ON leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_end_date    ON leases(end_date);
CREATE INDEX IF NOT EXISTS idx_payments_lease     ON payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_reminder_lease     ON reminder_logs(lease_id);

-- ─── Auto-update updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','properties','tenants','leases'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%I_updated ON %I;
      CREATE TRIGGER trg_%I_updated
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t, t, t);
  END LOOP;
END $$;
`;

(async () => {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(SQL);
    console.log('✅  All tables created successfully.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
