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
        if (/SELECT id, cover FROM posts WHERE slug=\?/i.test(sql)) {
          const s = store.find((p) => p.slug === args[0])
          return s ? { id: s.id, cover: s.cover } : null
        }
        if (/SELECT id FROM posts WHERE slug=\?/i.test(sql)) {
          const s = store.find((p) => p.slug === args[0])
          return s ? { id: s.id } : null
        }
        if (/SELECT cover, content FROM posts WHERE id=\?/i.test(sql)) {
          const s = store.find((p) => p.id === Number(args[0]))
          return s ? { cover: s.cover, content: s.content } : null
        }
        if (/SELECT COUNT\(\*\) AS n FROM posts/i.test(sql)) {
          const url = args[0]
          const n = store.filter(
            (p) => p.cover === url || (p.content || '').includes(url)
          ).length
          return { n }
        }
        return null
      },
      async run() {
        if (/INSERT INTO posts/i.test(sql)) {
          const [slug, title, category, summary, content, cover, created_at, updated_at] = args
          store.push({ id: nextId++, slug, title, category, summary, content, cover, created_at, updated_at })
          return { meta: { changes: 1 } }
        }
        if (/UPDATE posts SET cover=\? WHERE id=\?/i.test(sql)) {
          const p = store.find((x) => x.id === Number(args[1]))
          if (!p) return { meta: { changes: 0 } }
          p.cover = args[0]
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
          if (/category=\?/i.test(sql)) {
            const cat = args.find((a) => typeof a === 'string' && !a.startsWith('%'))
            if (cat) rows = rows.filter((p) => p.category === cat)
          }
          if (/LIKE \?/i.test(sql)) {
            const like = args.find((a) => typeof a === 'string' && a.startsWith('%'))
            const kw = like ? like.slice(1, -1) : ''
            rows = rows.filter((p) =>
              (p.title || '').includes(kw) ||
              (p.summary || '').includes(kw) ||
              (p.content || '').includes(kw)
            )
          }
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

  console.log('=== 9. 封面与正文分开 ===')
  check('导入数据封面全为空（不拿正文图冒充）', importedPosts.every((p) => !p.cover))
  check('正文里的图片仍然保留', importedPosts.some((p) => /!\[[^\]]*\]\(\/assets\/travels\//.test(p.content)))

  // 模拟旧版本留下的错误封面，再导一次应该被清掉，且正文不被覆盖
  const bj = store.find((p) => p.slug === 'note-beijing')
  bj.cover = '/assets/travels/beijing.jpg'
  bj.content = '用户自己改过的正文'
  r = await app.request('/api/admin/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{}'
  }, env)
  check('再次导入清空旧封面', !bj.cover, 'cover=' + bj.cover)
  check('正文修改未被覆盖', bj.content === '用户自己改过的正文', bj.content)

  console.log('=== 10. 关键词搜索 ===')
  r = await app.request('/api/posts?q=' + encodeURIComponent('宁波'), { headers: { cookie } }, env)
  const sq = await r.json()
  check('搜「宁波」有结果', (sq.posts || []).length >= 1, 'len=' + (sq.posts || []).length)
  check('结果确实含关键词', (sq.posts || []).every((p) => (p.title + p.summary + p.content).includes('宁波')))

  r = await app.request('/api/posts?q=' + encodeURIComponent('绝不存在xyz'), { headers: { cookie } }, env)
  const sq2 = await r.json()
  check('搜不到时返回空', (sq2.posts || []).length === 0, 'len=' + (sq2.posts || []).length)

  r = await app.request('/api/posts?category=travel&q=' + encodeURIComponent('宁波'), { headers: { cookie } }, env)
  const sq3 = await r.json()
  check('分类 + 关键词可叠加', (sq3.posts || []).length >= 1 && (sq3.posts || []).every((p) => p.category === 'travel'))

  r = await app.request('/api/posts?q=' + encodeURIComponent('宁波'), {}, env)
  check('搜索接口需登录', r.status === 401, 'status=' + r.status)

  console.log('=== 11. 无封面时取标题首字 ===')
  function firstChar(s) {
    var m = String(s || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/)
    return m ? m[0] : '·'
  }
  check('普通中文标题', firstChar('京城夏日') === '京', firstChar('京城夏日'))
  check('跳过书名号', firstChar('《眼力大挑战》') === '眼', firstChar('《眼力大挑战》'))
  check('跳过引号空格', firstChar('  「测试」') === '测', firstChar('  「测试」'))
  check('英文数字标题', firstChar('A320 体验') === 'A', firstChar('A320 体验'))
  check('纯符号兜底', firstChar('!!!') === '·', firstChar('!!!'))

  console.log('=== 12. 前台公开接口搜索 ===')
  r = await app.request('/api/public/posts?q=' + encodeURIComponent('宁波'), {}, env)
  const ps = await r.json()
  check('前台搜「宁波」有结果', (ps.posts || []).length >= 1, 'len=' + (ps.posts || []).length)
  check('前台结果含关键词', (ps.posts || []).every((p) => (p.title + p.summary).includes('宁波')))

  r = await app.request('/api/public/posts?category=travel&q=' + encodeURIComponent('宁波'), {}, env)
  const ps2 = await r.json()
  check('前台分类 + 搜索叠加', (ps2.posts || []).length >= 1 && (ps2.posts || []).every((p) => p.category === 'travel'))

  r = await app.request('/api/public/posts?q=' + encodeURIComponent('不存在xyz'), {}, env)
  const ps3 = await r.json()
  check('前台搜不到返回空', (ps3.posts || []).length === 0, 'len=' + (ps3.posts || []).length)

  r = await app.request('/api/public/posts?q=' + encodeURIComponent('宁波'), {}, env)
  check('前台搜索无需登录', r.status === 200, 'status=' + r.status)

  console.log('=== 13. 换封面时清理 R2 旧图 ===')
  const deleted = []
  env.MEDIA = {
    async delete(key) { deleted.push(key) },
    async put() {}
  }

  const bj2 = store.find((p) => p.slug === 'note-beijing')
  bj2.cover = '/img/covers/old-cover.jpg'

  r = await app.request('/api/posts/' + bj2.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      title: bj2.title, content: bj2.content, category: bj2.category,
      summary: '', cover: ''
    })
  }, env)
  check('更新接口返回 ok', r.status === 200, 'status=' + r.status)
  check('旧封面已从 R2 删除', deleted.indexOf('covers/old-cover.jpg') >= 0, deleted.join(','))
  check('数据库里封面已清空', !store.find((p) => p.slug === 'note-beijing').cover)

  // 同一张图还被别的文章正文引用时，必须保留
  deleted.length = 0
  const nb = store.find((p) => p.slug === 'note-ningbo')
  nb.cover = '/img/covers/shared.jpg'
  const bj3 = store.find((p) => p.slug === 'note-beijing')
  bj3.content = bj3.content + '\n\n![图](/img/covers/shared.jpg)'

  r = await app.request('/api/posts/' + nb.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      title: nb.title, content: nb.content, category: nb.category,
      summary: '', cover: ''
    })
  }, env)
  check('仍被其它文章引用的图不删', deleted.indexOf('covers/shared.jpg') < 0, deleted.join(','))

  console.log('=== 14. 草稿存 R2 ===')
  const r2 = new Map()
  env.MEDIA = {
    async put(key, value) { r2.set(key, value) },
    async get(key) {
      if (!r2.has(key)) return null
      const v = r2.get(key)
      return { json: async () => JSON.parse(v) }
    },
    async delete(key) { r2.delete(key) },
    async list(opts) {
      const prefix = (opts && opts.prefix) || ''
      return {
        objects: [...r2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
        truncated: false
      }
    }
  }

  r = await app.request('/api/admin/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ title: '草稿标题', category: 'travel', summary: '摘要', content: '正文内容' })
  }, env)
  const saved = await r.json()
  check('保存草稿成功', saved.ok === true && !!saved.id, JSON.stringify(saved))
  const draftId = saved.id

  r = await app.request('/api/admin/drafts', { headers: { cookie } }, env)
  const listD = await r.json()
  check('草稿列表有 1 条', (listD.drafts || []).length === 1, 'len=' + (listD.drafts || []).length)
  check('列表标题正确', !!(listD.drafts || [])[0] && listD.drafts[0].title === '草稿标题')

  r = await app.request('/api/admin/drafts/' + draftId, { headers: { cookie } }, env)
  const got = await r.json()
  check('读取草稿内容', !!(got.draft && got.draft.content === '正文内容'), JSON.stringify(got))

  r = await app.request('/api/admin/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }, env)
  check('保存草稿需登录', r.status === 401, 'status=' + r.status)

  r = await app.request('/api/admin/drafts/' + draftId, { method: 'DELETE', headers: { cookie } }, env)
  check('删除草稿成功', r.status === 200, 'status=' + r.status)

  r = await app.request('/api/admin/drafts', { headers: { cookie } }, env)
  const listD2 = await r.json()
  check('删除后列表为空', (listD2.drafts || []).length === 0, 'len=' + (listD2.drafts || []).length)

  console.log('')
  console.log('结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
