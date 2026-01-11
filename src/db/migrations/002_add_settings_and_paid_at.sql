-- UP
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO settings (data) VALUES (
  '{
    "package": {
      "name": "VPN for ALL",
      "price": 10,
      "description": [
        "All server locations included",
        "Up to 5 .ovpn accounts",
        "Unlimited bandwidth",
        "Monthly subscription",
        "24/7 support"
      ]
    },
    "user": {
      "free_minutes": 4320,
      "free_vpn_client_count": 1,
      "paid_vpn_client_count": 5
    }
  }'::jsonb
) ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_verified_paid ON users(verified_at, is_paid);

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- DOWN
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
DROP INDEX IF EXISTS idx_users_verified_paid;
ALTER TABLE users DROP COLUMN IF EXISTS paid_at;
ALTER TABLE users DROP COLUMN IF EXISTS is_paid;
DROP TABLE IF EXISTS settings CASCADE;