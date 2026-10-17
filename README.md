# mytravweb · 个人笔记站点 + 后台发文系统

一个 Cloudflare Worker 同时托管：静态站点（首页、3D 游戏页、GLB 模型）+ 写作后台 `/admin` + 文章接口（D1 数据库）+ 图片上传（R2 存储）。

## 仓库结构

```
mytravweb/
├── feiyou-notes-github/   站点静态文件（首页 html、3D 游戏、GLB 模型、CSS）
├── src/
│   ├── worker.js          后台页面 + 所有接口 + 文章详情页渲染
│   ├── content.js         静态资源读取（env.ASSETS）
│   └── markdown.js        Markdown 转 HTML
├── wrangler.toml          部署配置（数据库、存储、绑定）
├── schema.sql             数据库表结构
└── package.json
```

## 部署（Cloudflare Workers · Connect Git 自动构建）

1. Cloudflare 里用 **Workers → Connect Git** 连这个仓库。
2. 后台建好 **D1 数据库 `personal_notes`**，把它的 `database_id` 填进 `wrangler.toml`。
3. 建好 **R2 存储桶 `personal-notes-media`**（名字必须一字不差）。
   - 个人站点用 R2 基本免费：前 10GB/月存储免费、出口流量永久免费。
4. 在 Worker 项目「设置 → 变量和机密」里加 secret：`ADMIN_PASSWORD`（后台密码）。
5. 推送到 `main`，Cloudflare 自动 `wrangler deploy`。

## 本地预览

```bash
npm install
npx wrangler dev
# 打开 http://localhost:8787/admin
```

## 使用

- 前台：`/` 首页文章列表；`/post/网址名` 单篇文章
- 后台：`/admin` 写文章（支持拖拽上传封面、Markdown 编辑器、正文插图）
