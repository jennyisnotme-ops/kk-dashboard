-- KK魔法學院 繪師儀表板 — 資料庫結構
-- 在 Zeabur PostgreSQL 服務上執行這份檔案來建立資料表

-- 帳號（對應原本 PropertiesService 裡的 users）
CREATE TABLE IF NOT EXISTS users (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  secret TEXT NOT NULL UNIQUE,
  role   TEXT NOT NULL DEFAULT 'editor'
);

-- 組員（對應原本「組員」分頁）
CREATE TABLE IF NOT EXISTS members (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  "group" TEXT,
  country TEXT,
  role    TEXT,
  note    TEXT DEFAULT '',
  tags    JSONB DEFAULT '[]'
);

-- 專案（對應原本「專案」分頁）
CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT,
  owner              TEXT,
  start              TEXT,
  deadline           TEXT,
  progress           INTEGER DEFAULT 0,
  "progressOverride" BOOLEAN DEFAULT FALSE,
  status             TEXT,
  assignees          JSONB DEFAULT '[]',
  note               TEXT DEFAULT '',
  tags               JSONB DEFAULT '[]',
  longterm           BOOLEAN DEFAULT FALSE
);

-- 操作記錄（對應原本「操作記錄」分頁）
CREATE TABLE IF NOT EXISTS logs (
  id       SERIAL PRIMARY KEY,
  time     TEXT NOT NULL,
  operator TEXT,
  role     TEXT,
  action   TEXT,
  target   TEXT
);

-- 系統設定（對應原本 PropertiesService 裡的 groups / countries）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB
);

-- 預設資料（初始帳號與設定）
INSERT INTO users (name, secret, role)
  VALUES ('超級管理員', 'admin1234', 'super_admin')
  ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value) VALUES ('groups',    '["A組","B組"]') ON CONFLICT DO NOTHING;
INSERT INTO settings (key, value) VALUES ('countries', '["TW","CN"]')   ON CONFLICT DO NOTHING;
