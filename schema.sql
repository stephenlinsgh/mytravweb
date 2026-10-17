-- 个人笔记 · 数据库结构
--
-- 一般不需要手动执行：程序在第一次访问时会自动建表。
-- 这里的 SQL 是给你「想手动查看或备份数据」时用的。
--
--   npx wrangler d1 execute personal_notes --file=schema.sql

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    UNIQUE NOT NULL,   -- 网址名，如 weather-in-ningbo
  title      TEXT    NOT NULL,          -- 标题
  category   TEXT    NOT NULL DEFAULT 'notes',  -- travel/notes/sports/visit
  summary    TEXT    NOT NULL DEFAULT '',       -- 列表页那一句摘要
  content    TEXT    NOT NULL DEFAULT '',       -- 正文（Markdown）
  cover      TEXT,                              -- 封面图地址，可空
  created_at INTEGER NOT NULL,          -- 发布时间戳（毫秒）
  updated_at INTEGER NOT NULL           -- 最后修改时间戳
);

-- 按栏目查文章时会用到这个索引
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, created_at DESC);