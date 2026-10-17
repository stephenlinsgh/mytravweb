/**
 * 接口级测试：不依赖 wrangler，用内存版 D1 验证导入流程。
 * 运行：node test-import.mjs
 */
import app from './src/worker.js'
import importedPosts from './src/import-data.js'

// ---- 内存版 D1，只实现导入流程用到的 SQL ----
const store = []
let nextId = 1

const DB = {
  async exec() { /* CREATE TABLE / INDEX 直接当成功 */ },
  prepare(sql) {
    let args = []
    const api = {
      bind(...a) { args = a; return api },
      async first() {
        if (/SELECT id FROM posts WHERE slug=\?/i.test(sql)) {
          const s = store.find((p) => p.slug === args[0])
          return s ? { id: s.id } : null
        }
        return null
      },
      async run() {
        if (/INSERT INTO posts/i.test(sql)) {
          const [slug, title, category, summary, content, cover, created_at, updated_at] = args
          store.push({ id: nextId++, slug, title, category, summary, content, cover, created_at, updated_at })
          return { meta: { changes: 1 } }
        }
        if (/UPDATE posts/i.test(sql)) {
          const id = args[args.length - 1]
          const p = store.find((x) => x.id === Number(id))
          if (!p) return { meta: { changes: 0 } }
          p.title = args[0]; p.category = args[1]; p.summary = args[2]
          p.content = args[3]; p.cover = args[4]; p.updated_at = args[5]
          return { meta: { changes: 1 } }
        }
        if (/DELETE FROM posts/i.test(sql)) {
          const i = store.findIndex((x) => x.id === Number(args[0]))
          if (i >= 0) store.splice(i, 1)
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
      async all() {
        if (/FROM posts/i.test(sql)) {
          let rows = store.slice()
          if (/WHERE slug=\?/i.test(sql)) rows = rows.filter((p) => p.slug === args[0])
          if (/WHERE category=\?/i.test(sql)) rows = rows.filter((p) => p.category === args[0])
          rows.sort((a, b) => b.created_at - a.created_at)
          return { results: rows }
        }
        return { results: [] }
      }
    }
    return api
  }
}

const env = {
  DB,
  ADMIN_PASSWORD: 'test123',
  MEDIA: null,
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) }
}

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

async function main() {
  console.log('=== 1. 未登录调用导入接口应被拒 ===')
  let r = await app.request('/api/admin/import', { method: 'POST', body: '{}' }, env)
  check('401 未登录', r.status === 401, 'status=' + r.status)

  console.log('=== 2. 登录 ===')
  r = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test123' })
  }, env)
  check('登录成功', r.status === 200 && (await r.json()).ok === true, 'status=' + r.status)
  const cookie = r.headers.get('set-cookie')
  check('拿到 cookie', !!cookie && cookie.includes('pn_token='))

  console.log('=== 3. 导入原有文章 ===')
  r = await app.request('/api/admin/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{}'
  }, env)
  const d = await r.json()
  check('导入接口返回 ok', d.ok === true, JSON.stringify(d))
  check('新增 10 篇', d.inserted === 10, 'inserted=' + d.inserted)
  check('跳过 0 篇', d.skipped === 0, 'skipped=' + d.skipped)
  check('数据库里有 10 篇', store.length === 10, 'store=' + store.length)

  console.log('=== 4. 再导一次应全部跳过（幂等） ===')
  r = await app.request('/api/admin/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{}'
  }, env)
  const d2 = await r.json()
  check('新增 0 篇', d2.inserted === 0, 'inserted=' + d2.inserted)
  check('跳过 10 篇', d2.skipped === 10, 'skipped=' + d2.skipped)
  check('数据库仍是 10 篇', store.length === 10, 'store=' + store.length)

  console.log('=== 5. 后台列表能读到文章 ===')
  r = await app.request('/api/posts', { headers: { cookie } }, env)
  const list = await r.json()
  check('返回 10 篇', (list.posts || []).length === 10, 'len=' + (list.posts || []).length)
  check('含标题', !!(list.posts || []).find((p) => p.title === '京城夏日'))
  check('含正文', !!(list.posts || []).find((p) => p.slug === 'note-beijing' && p.content.length > 50))
  check('含分类', !!(list.posts || []).find((p) => p.slug === 'note-plane-spotting' && p.category === 'notes'))

  console.log('=== 6. 前台公开接口能读到 ===')
  r = await app.request('/api/public/posts?category=travel', {}, env)
  const pub = await r.json()
  check('旅行分类 9 篇', (pub.posts || []).length === 9, 'len=' + (pub.posts || []).length)
  r = await app.request('/api/public/posts?category=notes', {}, env)
  const pubNotes = await r.json()
  check('笔记分类 1 篇', (pubNotes.posts || []).length === 1, 'len=' + (pubNotes.posts || []).length)

  console.log('=== 7. 文章详情页能渲染 ===')
  r = await app.request('/post/note-beijing', {}, env)
  const html = await r.text()
  check('详情页 200', r.status === 200, 'status=' + r.status)
  check('标题渲染正确', html.includes('京城夏日'))
  check('图片路径为绝对路径', html.includes('/assets/travels/beijing.jpg') && !html.includes('./assets/travels/beijing.jpg'))
  check('转成 img 标签', html.includes('<img') && html.includes('alt="京城天际线'))

  console.log('=== 8. 导入数据完整性 ===')
  check('共 10 条', importedPosts.length === 10)
  check('每条都有标题', importedPosts.every((p) => p.title && p.title.length > 0))
  check('每条都有正文', importedPosts.every((p) => p.content && p.content.length > 100))
  check('分类合法', importedPosts.every((p) => ['travel', 'notes', 'sports', 'visit'].includes(p.category)))
  check('无重复 slug', new Set(importedPosts.map((p) => p.slug)).size === 10)

  console.log('')
  console.log('结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
