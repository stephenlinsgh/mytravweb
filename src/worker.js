/**
 * 个人笔记 · 全站 Worker
 * ---------------------------------------------------------------------------
 * 一个 Worker 同时干两件事：
 *   1. 静态资源：首页、3D 游戏页、CSS、GLB 模型 —— 直接从磁盘读，不进数据库
 *   2. 后台接口：/admin 写文章、/api/* 存取数据 —— 落进 D1 数据库
 *
 * 为什么不用 Cloudflare Pages：Pages 只能放死文件，Pages Functions 又要另一套
 * 部署流程。一个 Worker 全包，域名、部署、回滚都是一处。
 */

import { Hono } from 'hono'
import { getContent } from './content.js'
import { renderMarkdown } from './markdown.js'

const app = new Hono()

/* ==========================================================================
   一、登录鉴权
   --------------------------------------------------------------------------
   密码用 HMAC 签一个 7 天有效的令牌，存在浏览器的 cookie 里。
   密码本身永远不出现在 HTML 或接口里。
   ========================================================================== */

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
}

async function makeToken(secret) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000
  const payload = btoa(JSON.stringify({ exp }))
  return payload + '.' + b64url(await hmac(secret, payload))
}

async function verifyToken(token, secret) {
  try {
    const [p, s] = String(token).split('.')
    if (!p || !s) return false
    if (b64url(await hmac(secret, p)) !== s) return false
    return JSON.parse(atob(p)).exp > Date.now()
  } catch {
    return false
  }
}

/** 从 cookie 里取令牌；前端和 API 用同一套鉴权，不用 localStorage */
async function isAuthed(c) {
  const raw = c.req.header('cookie') || ''
  const m = raw.match(/(?:^|;\s*)pn_token=([^;]+)/)
  return m ? verifyToken(decodeURIComponent(m[1]), c.env.ADMIN_PASSWORD) : false
}

const requireAuth = async (c, next) => {
  if (!(await isAuthed(c))) return c.json({ error: '未登录或登录已过期' }, 401)
  await next()
}

/* ==========================================================================
   二、数据库
   ========================================================================== */

/** 建表。D1 的 exec() 对多行 SQL 容易截断，所以压成单行一条条跑。 */
let schemaReady = false
async function ensureSchema(db) {
  if (schemaReady) return
  await db.exec('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT \'notes\', summary TEXT NOT NULL DEFAULT \'\', content TEXT NOT NULL DEFAULT \'\', cover TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
  await db.exec('CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, created_at DESC)')
  schemaReady = true
}

/** 分类白名单：与前台栏目一一对应，防止写错分类导致文章不显示 */
const CATEGORIES = {
  notes: '笔记',
  travel: '旅行',
  sports: '运动',
  visit: '参观'
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/* ==========================================================================
   三、后台页面 /admin
   ========================================================================== */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

const ADMIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>写作后台 · 个人笔记</title>
<link rel="stylesheet" href="/assets/editor/easymde.min.css">
<style>
  :root{
    --bg:#f7f9fc; --card:#fff; --fg:#1f2933; --muted:#5b6b7b;
    --line:#dce4ee; --blue:#15457a; --sky:#e9f1fb; --red:#c0392b; --green:#1d9e75;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       background:var(--bg);color:var(--fg);line-height:1.7;font-size:15px;-webkit-font-smoothing:antialiased}
  .top{background:var(--blue);color:#fff;padding:14px 0;position:sticky;top:0;z-index:20}
  .top-in{max-width:1100px;margin:0 auto;padding:0 20px;display:flex;align-items:center;gap:14px}
  .top h1{font-size:17px;font-weight:600;flex:1}
  .top a{color:#cfe0f2;font-size:14px;text-decoration:none}
  .top a:hover{color:#fff}
  .btn{background:var(--blue);color:#fff;border:none;border-radius:9px;padding:9px 18px;
       font-size:15px;font-family:inherit;cursor:pointer;font-weight:500}
  .btn:hover{background:#0d2f57}
  .btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.45);color:#fff}
  .btn.ghost:hover{background:rgba(255,255,255,.14)}
  .btn.mini{padding:5px 12px;font-size:13px;border-radius:7px}
  .btn.danger{background:var(--red)}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  main{max-width:1100px;margin:0 auto;padding:26px 20px 70px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;margin-bottom:22px}
  .panel h2{font-size:18px;margin-bottom:4px;font-weight:600}
  .hint{color:var(--muted);font-size:13px;margin-bottom:18px}
  label{display:block;font-size:13px;color:var(--muted);margin:16px 0 6px;font-weight:500}
  input,select,textarea{width:100%;background:#fff;border:1px solid var(--line);border-radius:9px;
       padding:11px 13px;font-size:15px;font-family:inherit;color:var(--fg);line-height:1.6}
  input:focus,select:focus,textarea:focus{outline:2px solid var(--sky);border-color:var(--blue)}
  textarea{resize:vertical;min-height:260px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:700px){.row{grid-template-columns:1fr}}
  .acts{display:flex;gap:10px;align-items:center;margin-top:22px;flex-wrap:wrap}
  .msg{font-size:14px;color:var(--muted)}
  .msg.ok{color:var(--green)}
  .msg.err{color:var(--red)}
  .list-item{display:flex;justify-content:space-between;align-items:center;gap:14px;
       padding:13px 0;border-bottom:1px solid var(--line)}
  .list-item:last-child{border-bottom:none}
  .list-item .t{font-size:16px;font-weight:500}
  .list-item .m{font-size:13px;color:var(--muted);margin-top:2px}
  .tag{display:inline-block;background:var(--sky);color:var(--blue);border-radius:999px;
       padding:1px 10px;font-size:12px;margin-left:8px;vertical-align:2px}
  .empty{color:var(--muted);text-align:center;padding:34px 0;font-size:14px}
  .box{max-width:400px;margin:90px auto;text-align:center}
  .box h1{font-size:22px;margin-bottom:8px}
  .box p{color:var(--muted);margin-bottom:24px;font-size:14px}
  .tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
  .tabs button{background:#fff;border:1px solid var(--line);border-radius:8px;padding:7px 15px;
       font-size:14px;font-family:inherit;cursor:pointer;color:var(--muted)}
  .tabs button.on{background:var(--blue);border-color:var(--blue);color:#fff}
  /* 封面上传区 */
  .drop{border:2px dashed var(--line);border-radius:10px;padding:18px;text-align:center;
       color:var(--muted);font-size:14px;cursor:pointer;transition:.15s;background:#fbfdff}
  .drop:hover,.drop.over{border-color:var(--blue);background:var(--sky);color:var(--blue)}
  .drop .big{font-size:15px;color:var(--fg);margin-bottom:3px}
  .cover-prev{display:none;margin-top:12px;align-items:center;gap:12px}
  .cover-prev img{max-width:180px;max-height:110px;border-radius:8px;border:1px solid var(--line);background:#fff}
  .cover-prev .u{font-size:12px;color:var(--muted);word-break:break-all}
  /* EasyMDE 编辑器微调，贴合后台配色 */
  .EasyMDEContainer .editor-toolbar{border-color:var(--line);border-radius:10px 10px 0 0}
  .EasyMDEContainer .CodeMirror{border:1px solid var(--line);border-top:none;border-radius:0 0 10px 10px;font-size:15px;line-height:1.7}
  .EasyMDEContainer .editor-toolbar button{border-radius:5px}
  .EasyMDEContainer .editor-toolbar i.separator{margin:0 6px}
</style>
</head>
<body>

<div class="top"><div class="top-in">
  <h1>写作后台</h1>
  <a href="/" target="_blank">查看网站 ↗</a>
  <button class="btn ghost mini" id="logoutBtn" style="display:none">退出登录</button>
</div></div>

<main>
  <div class="box" id="loginBox" style="display:none">
    <h1>请输入管理员密码</h1>
    <p>密码是你在部署时自己设定的那一串，忘了可以重新设定。</p>
    <input id="pw" type="password" placeholder="管理员密码" autocomplete="current-password">
    <div class="acts" style="justify-content:center">
      <button class="btn" id="loginBtn">登录</button>
      <span class="msg" id="loginMsg"></span>
    </div>
  </div>

  <div id="app" style="display:none">
    <div class="panel">
      <h2 id="formTitle">写新文章</h2>
      <div class="hint">带 * 的是必填。分类决定它出现在前台哪个栏目。</div>
      <input type="hidden" id="editId">
      <div class="row">
        <div>
          <label>所属分类 *</label>
          <select id="category">
            <option value="notes">笔记</option>
            <option value="travel">旅行</option>
            <option value="sports">运动</option>
            <option value="visit">参观</option>
          </select>
        </div>
        <div>
          <label>发布日期（留空用今天）</label>
          <input id="pubdate" type="date">
        </div>
      </div>
      <label>标题 *</label>
      <input id="title" placeholder="例如：首飞 C919 体验">
      <label>摘要（列表页显示的一句话）</label>
      <input id="summary" placeholder="用一两句话概括，读者靠它决定要不要点进去">
      <label>封面图（可留空）</label>
      <div class="drop" id="drop">
        <div class="big">把图片拖到这里，或点击选择文件上传</div>
        <div>支持 jpg / png / webp / gif，单张不超过 5MB</div>
      </div>
      <input type="file" id="coverFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
      <div class="cover-prev" id="coverPrev">
        <img id="coverImg" alt="封面预览">
        <div style="flex:1;min-width:0">
          <div class="u" id="coverUrlText"></div>
          <button type="button" class="btn mini" id="coverClear"
                  style="background:#fff;color:var(--red);border:1px solid var(--line);margin-top:6px">移除封面</button>
        </div>
      </div>
      <input id="cover" placeholder="也可以直接粘贴图片外链 https://...">
      <label>正文 *</label>
      <textarea id="content" placeholder="支持 Markdown 语法：&#10;&#10;## 二级标题&#10;- 列表项&#10;**加粗**&#10;[链接](https://...)&#10;> 引用"></textarea>
      <div class="acts">
        <button class="btn" id="saveBtn">发布文章</button>
        <button class="btn ghost" id="resetBtn" style="background:#fff;border-color:var(--line);color:var(--fg)">清空重写</button>
        <span class="msg" id="saveMsg"></span>
      </div>
    </div>

    <div class="panel">
      <h2>已发布的文章</h2>
      <div class="hint">点「编辑」可以修改已发布的文章，改完再点一次发布即可覆盖。</div>
      <div class="tabs" id="catTabs">
        <button class="on" data-cat="">全部</button>
        <button data-cat="notes">笔记</button>
        <button data-cat="travel">旅行</button>
        <button data-cat="sports">运动</button>
        <button data-cat="visit">参观</button>
      </div>
      <div id="list"><div class="empty">加载中…</div></div>
    </div>
  </div>
</main>

<script src="/assets/editor/easymde.min.js"></script>
<script>
const $ = (id) => document.getElementById(id)
const CAT = { notes:'笔记', travel:'旅行', sports:'运动', visit:'参观' }
let filter = ''
let CACHE_IDS = {}

// ---- 正文编辑器（EasyMDE，开源 Markdown 编辑器）----
let mde = null
if (typeof EasyMDE !== 'undefined') {
  mde = new EasyMDE({
    element: $('content'),
    spellChecker: false,
    status: false,
    minHeight: '320px',
    placeholder: '支持 Markdown：## 标题、**加粗**、- 列表、> 引用、![图片]',
    uploadImage: true,
    imageAccept: 'image/jpeg,image/png,image/webp,image/gif',
    imageUploadFunction: function (file, onSuccess, onError) {
      uploadFile(file).then(onSuccess).catch(function (e) { onError(e.message || '上传失败') })
    },
    toolbar: ['bold','italic','heading','|','unordered-list','ordered-list','|','link','image','table','code','quote','|','preview','side-by-side','|','guide']
  })
}
function getBody() { return mde ? mde.value() : $('content').value }
function setBody(v) { if (mde) mde.value(v || ''); else $('content').value = v || '' }

// ---- 封面上传（拖拽 / 点击，存到 R2，返回 /img/...）----
function setCover(url) {
  $('cover').value = url || ''
  if (url) { $('coverImg').src = url; $('coverUrlText').textContent = url; $('coverPrev').style.display = 'flex' }
  else { $('coverPrev').style.display = 'none'; $('coverImg').removeAttribute('src') }
}
function uploadFile(file) {
  var fd = new FormData(); fd.append('file', file)
  return fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', body: fd })
    .then(function (r) {
      return r.json().catch(function () { return { error: '上传失败' } }).then(function (d) {
        if (!r.ok || d.error) throw new Error(d.error || '上传失败')
        return d.url
      })
    })
}
var drop = $('drop')
drop.onclick = function () { $('coverFile').click() }
$('coverFile').onchange = function (e) { if (e.target.files[0]) handleCover(e.target.files[0]); e.target.value = '' }
;['dragover','dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over') }) })
;['dragleave','drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over') }) })
drop.addEventListener('drop', function (e) {
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) handleCover(f)
})
function handleCover(f) {
  var tip = drop.querySelector('.big'); var old = tip.textContent
  tip.textContent = '上传中：' + f.name
  uploadFile(f).then(function (url) { setCover(url); tip.textContent = '上传成功，可再点替换' })
    .catch(function (err) { tip.textContent = old; $('saveMsg').textContent = '封面上传失败：' + err.message; $('saveMsg').className = 'msg err' })
    .finally(function () { setTimeout(function () { tip.textContent = '把图片拖到这里，或点击选择文件上传' }, 2500) })
}
$('coverClear').onclick = function () { setCover('') }
$('cover').addEventListener('input', function () { setCover($('cover').value.trim()) })

// 后台页面里的 HTML 片段是拼出来的，拼之前必须转义，
// 否则文章标题里带尖括号就会把页面结构搞坏
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  })
}

async function api(path, opts) {
  opts = opts || {}
  opts.credentials = 'same-origin'
  // GET 不需要 Content-Type，带上反而会让某些环境预检失败
  if (opts.method && opts.method !== 'GET') {
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
  }
  const r = await fetch(path, opts)
  if (r.status === 401) { showLogin(); throw new Error('未登录') }
  return r.json()
}

function showLogin() {
  $('loginBox').style.display = ''
  $('app').style.display = 'none'
  $('logoutBtn').style.display = 'none'
}
function showApp() {
  $('loginBox').style.display = 'none'
  $('app').style.display = ''
  $('logoutBtn').style.display = ''
}

$('loginBtn').onclick = async () => {
  const pw = $('pw').value
  if (!pw) return
  $('loginBtn').disabled = true
  try {
    const r = await fetch('/api/login', {
      method:'POST', credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ password: pw })
    })
    if (r.ok) { $('pw').value=''; showApp(); load() }
    else { $('loginMsg').textContent = '密码不对，再试一次'; $('loginMsg').className='msg err' }
  } catch (e) {
    $('loginMsg').textContent = '网络出错：' + e.message; $('loginMsg').className='msg err'
  }
  $('loginBtn').disabled = false
}
$('pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click() })

$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method:'POST' }); showLogin() }

function resetForm() {
  $('editId').value = ''
  $('formTitle').textContent = '写新文章'
  $('saveBtn').textContent = '发布文章'
  $('title').value = ''
  $('summary').value = ''
  setCover('')
  setBody('')
  $('category').value = 'notes'
  $('pubdate').value = ''
  $('saveMsg').textContent = ''
}
$('resetBtn').onclick = resetForm

$('saveBtn').onclick = async () => {
  const title = $('title').value.trim()
  const content = getBody().trim()
  if (!title)  { $('saveMsg').textContent = '标题不能为空'; $('saveMsg').className='msg err'; return }
  if (!content){ $('saveMsg').textContent = '正文不能为空'; $('saveMsg').className='msg err'; return }

  const id = $('editId').value
  $('saveBtn').disabled = true
  $('saveMsg').textContent = '保存中…'
  $('saveMsg').className = 'msg'
  try {
    const body = {
      title, content,
      category: $('category').value,
      summary: $('summary').value.trim(),
      cover: $('cover').value.trim(),
      date: $('pubdate').value || ''
    }
    const d = await api(id ? '/api/posts/' + id : '/api/posts', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    })
    if (d.error) throw new Error(d.error)
    // 先清表单，再写提示 —— resetForm() 会把 saveMsg 清空，顺序反了就看不到成功反馈
    resetForm()
    $('saveMsg').textContent = id ? '已更新 ✓' : '发布成功，刷新前台就能看到 ✓'
    $('saveMsg').className = 'msg ok'
    load()
  } catch (e) {
    $('saveMsg').textContent = '失败：' + e.message
    $('saveMsg').className = 'msg err'
  }
  $('saveBtn').disabled = false
}

$('catTabs').onclick = (e) => {
  const b = e.target.closest('button[data-cat]')
  if (!b) return
  filter = b.dataset.cat
  ;[...$('catTabs').children].forEach(x => x.classList.toggle('on', x === b))
  load()
}

async function load() {
  $('list').innerHTML = '<div class="empty">加载中…</div>'
  // 登录过期时 api() 会抛错，这里接住，别让未捕获异常刷 console
  let d
  try {
    d = await api('/api/posts' + (filter ? '?category=' + filter : ''))
  } catch (e) {
    $('list').innerHTML = '<div class="empty">请先登录</div>'
    return
  }
  const posts = d.posts || []
  if (!posts.length) { $('list').innerHTML = '<div class="empty">还没有文章，上面写一篇试试</div>'; return }
  // 先把每篇文章存进CACHE，onclick 里只传 id。
  // 直接把标题拼进 onclick 会在标题含引号时把 JS 打断。
  const CACHE = {}
  const rows = posts.map(p => {
    CACHE[p.id] = { id:p.id, title:p.title, category:p.category,
                    summary:p.summary, cover:p.cover, content:p.content }
    return \`
    <div class="list-item">
      <div>
        <div class="t">\${esc(p.title)}<span class="tag">\${esc(CAT[p.category] || p.category)}</span></div>
        <div class="m">\${esc(p.created_date)} · /post/\${esc(p.slug)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn mini" style="background:#fff;color:var(--blue);border:1px solid var(--line)"
                onclick="edit(\${p.id})">编辑</button>
        <button class="btn mini danger" onclick="del(\${p.id})">删除</button>
      </div>
    </div>\`
  }).join('')
  CACHE_IDS = CACHE
  $('list').innerHTML = rows
}

function edit(id) {
  const p = CACHE_IDS[id]
  if (!p) { alert('列表已刷新，请重新点一次'); return }
  $('editId').value = p.id
  $('formTitle').textContent = '编辑：' + p.title
  $('saveBtn').textContent = '保存修改'
  $('title').value = p.title
  $('category').value = p.category
  $('summary').value = p.summary
  setCover(p.cover || '')
  setBody(p.content)
  $('pubdate').value = ''
  $('saveMsg').textContent = ''
  window.scrollTo({ top:0, behavior:'smooth' })
}

async function del(id) {
  const p = CACHE_IDS[id]
  const name = p ? p.title : '这篇文章'
  if (!confirm('确定删除「' + name + '」？删了就找不回来了。')) return
  const d = await api('/api/posts/' + id, { method:'DELETE' })
  if (d.error) alert(d.error)
  load()
}

// 进页面先试探登录状态。
// showApp() 只负责显示界面，拉列表是另一件事 —— 这里必须显式 load()，
// 否则刷新后台会停在「加载中…」。
api('/api/me')
  .then(() => { showApp(); load() })
  .catch(showLogin)
</script>
</body>
</html>`

/* ==========================================================================
   四、路由：后台
   ========================================================================== */

app.get('/admin', (c) => c.html(ADMIN_PAGE))

app.post('/api/login', async (c) => {
  let password = ''
  try { ({ password } = await c.req.json()) } catch {}
  if (!password || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: '密码不对' }, 401)
  }
  const token = await makeToken(c.env.ADMIN_PASSWORD)
  // Secure 只在 https 下有效。本地 wrangler dev 走 http，
  // 硬加 Secure 会导致本地每次都要重新登录，所以按协议判断。
  const secure = (c.req.url || '').startsWith('https') ? '; Secure' : ''
  c.header(
    'Set-Cookie',
    `pn_token=${encodeURIComponent(token)}; Path=/; Max-Age=${7 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}`
  )
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  const secure = (c.req.url || '').startsWith('https') ? '; Secure' : ''
  c.header('Set-Cookie', `pn_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`)
  return c.json({ ok: true })
})

app.get('/api/me', async (c) =>
  (await isAuthed(c)) ? c.json({ ok: true }) : c.json({ error: '未登录' }, 401)
)

/* ==========================================================================
   五、路由：文章数据
   ========================================================================== */

// 公开接口：前台页面调这个拿文章列表，不需要登录
app.get('/api/public/posts', async (c) => {
  await ensureSchema(c.env.DB)
  const cat = c.req.query('category')
  const sql = cat
    ? 'SELECT slug,title,category,summary,cover,created_at FROM posts WHERE category=? ORDER BY created_at DESC LIMIT 200'
    : 'SELECT slug,title,category,summary,cover,created_at FROM posts ORDER BY created_at DESC LIMIT 200'
  const { results } = await c.env.DB.prepare(sql).bind(...(cat ? [cat] : [])).all()
  return c.json({ posts: results })
})

app.get('/api/public/post/:slug', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM posts WHERE slug=?')
    .bind(c.req.param('slug')).all()
  if (!results.length) return c.json({ error: '文章不存在' }, 404)
  return c.json({ post: results[0] })
})

// 后台接口：需要登录
app.get('/api/posts', requireAuth, async (c) => {
  await ensureSchema(c.env.DB)
  const cat = c.req.query('category')
  const sql = `SELECT id,slug,title,category,summary,cover,content,
                       datetime(created_at/1000,'unixepoch','+8 hours') AS created_date
                FROM posts ${cat ? 'WHERE category=?' : ''} ORDER BY created_at DESC`
  const { results } = await c.env.DB.prepare(sql).bind(...(cat ? [cat] : [])).all()
  return c.json({ posts: results })
})

app.post('/api/posts', requireAuth, async (c) => {
  await ensureSchema(c.env.DB)
  const b = await c.req.json().catch(() => ({}))
  const title = (b.title || '').trim()
  const content = (b.content || '').trim()
  if (!title || !content) return c.json({ error: '标题和正文不能为空' }, 400)

  const category = CATEGORIES[b.category] ? b.category : 'notes'
  // slug 冲突时自动加时间戳，绝不让用户卡在「保存失败」
  let slug = slugify(b.slug || title) || 'post-' + Date.now()
  const dup = await c.env.DB.prepare('SELECT id FROM posts WHERE slug=?').bind(slug).first()
  if (dup) slug = slug + '-' + String(Date.now()).slice(-6)

  // 用户指定了日期就用它，否则用当前时间
  let ts = Date.now()
  if (b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    ts = new Date(b.date + 'T12:00:00+08:00').getTime()
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO posts (slug,title,category,summary,content,cover,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(slug, title, category, (b.summary || '').trim(), content, (b.cover || '').trim() || null, ts, ts).run()
    return c.json({ ok: true, slug })
  } catch (e) {
    return c.json({ error: '保存失败：' + e.message }, 500)
  }
})

app.put('/api/posts/:id', requireAuth, async (c) => {
  await ensureSchema(c.env.DB)
  const b = await c.req.json().catch(() => ({}))
  const title = (b.title || '').trim()
  const content = (b.content || '').trim()
  if (!title || !content) return c.json({ error: '标题和正文不能为空' }, 400)

  const id = Number(c.req.param('id'))
  const category = CATEGORIES[b.category] ? b.category : 'notes'
  try {
    const r = await c.env.DB.prepare(
      `UPDATE posts SET title=?, category=?, summary=?, content=?, cover=?, updated_at=?
       WHERE id=?`
    ).bind(title, category, (b.summary || '').trim(), content, (b.cover || '').trim() || null, Date.now(), id).run()
    if (!r.meta.changes) return c.json({ error: '找不到这篇文章' }, 404)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: '更新失败：' + e.message }, 500)
  }
})

app.delete('/api/posts/:id', requireAuth, async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

/* ==========================================================================
   六、路由：文章详情页 /post/:slug
   --------------------------------------------------------------------------
   前台文章页由 Worker 现拼 HTML，标题和正文都做了转义，
   因此数据库里存 Markdown 源码也不会被注入。
   ========================================================================== */

app.get('/post/:slug', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM posts WHERE slug=?')
    .bind(c.req.param('slug')).all()
  if (!results.length) {
    return c.html('<!doctype html><meta charset="utf-8"><title>未找到</title>' +
      '<body style="font-family:sans-serif;padding:60px;text-align:center">' +
      '<h1>这篇文章不存在</h1><p><a href="/">← 回到首页</a></p></body>', 404)
  }
  const p = results[0]
  const date = new Date(p.created_at).toLocaleDateString('zh-CN')
  const cat = CATEGORIES[p.category] || '笔记'

  return c.html(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} · 个人笔记</title>
<meta name="description" content="${esc(p.summary || p.title)}">
<link rel="stylesheet" href="/assets/style.css">
<style>
  .post{max-width:760px;margin:0 auto;padding:44px 20px 80px}
  .post h1{font-size:32px;line-height:1.35;color:var(--blue);margin-bottom:14px;font-weight:700}
  .post .meta{color:var(--muted);font-size:14px;margin-bottom:34px;
       padding-bottom:22px;border-bottom:1px solid var(--line)}
  .post .body{font-size:17px;line-height:1.9;color:var(--ink)}
  .post .body h2{font-size:23px;margin:38px 0 14px;color:var(--blue-deep)}
  .post .body h3{font-size:19px;margin:30px 0 12px}
  .post .body p{margin:16px 0}
  .post .body ul,.post .body ol{padding-left:26px;margin:16px 0}
  .post .body li{margin:7px 0}
  .post .body img{border-radius:var(--radius);margin:22px 0}
  .post .body code{background:var(--sky-soft);border:1px solid var(--line);
       border-radius:5px;padding:1px 6px;font-size:.9em;
       font-family:ui-monospace,Menlo,Consolas,monospace}
  .post .body pre{background:#0f172a;color:#e2e8f0;border-radius:12px;
       padding:18px 20px;overflow-x:auto;margin:20px 0}
  .post .body pre code{background:none;border:none;color:inherit;padding:0}
  .post .body blockquote{border-left:4px solid var(--sky);background:var(--sky-soft);
       padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;color:var(--muted)}
  .post .body table{width:100%;border-collapse:collapse;margin:22px 0;font-size:15px}
  .post .body th,.post .body td{border:1px solid var(--line);padding:10px 13px;text-align:left}
  .post .body th{background:var(--sky-soft);font-weight:600}
  .post .body hr{border:none;border-top:1px solid var(--line);margin:36px 0}
  .post .back{display:inline-block;margin-top:46px;color:var(--blue);text-decoration:none}
  @media(max-width:700px){.post h1{font-size:25px}.post .body{font-size:16px}}
</style>
</head>
<body>
<article class="post">
  <h1>${esc(p.title)}</h1>
  <div class="meta">${esc(cat)} · ${date}</div>
  <div class="body">${renderMarkdown(p.content)}</div>
  <a class="back" href="/">← 返回首页</a>
</article>
</body>
</html>`)
})

/* ==========================================================================
   六·B、图片上传与读取（R2 存储）
   --------------------------------------------------------------------------
   /api/admin/upload：登录后上传图片，返回 /img/... 地址，正文和封面都用它。
   /img/*：按 key 从 R2 读图，长期缓存（图片地址一旦生成就不变）。
   ========================================================================== */

const IMG_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'
}

app.post('/api/admin/upload', requireAuth, async (c) => {
  if (!c.env.MEDIA) return c.json({ error: '存储未配置（缺 R2 绑定）' }, 500)
  let form
  try { form = await c.req.parseBody() } catch { return c.json({ error: '表单解析失败' }, 400) }
  const file = form.file
  if (!(file instanceof File)) return c.json({ error: '没有收到文件' }, 400)
  const ext = IMG_TYPES[file.type]
  if (!ext) return c.json({ error: '只支持 jpg / png / webp / gif' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: '图片不能超过 5MB' }, 400)
  const key = `covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
  return c.json({ ok: true, url: '/img/' + key })
})

app.get('/img/*', async (c) => {
  if (!c.env.MEDIA) return c.text('存储未配置', 500)
  let key
  try { key = decodeURIComponent(c.req.path.slice(5)) } catch { return c.text('Bad request', 400) }
  if (!/^[\w./-]+$/.test(key) || key.includes('..')) return c.text('Bad request', 400)
  const obj = await c.env.MEDIA.get(key)
  if (!obj) return c.text('图片不存在', 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(obj.body, { headers })
})

/* ==========================================================================
   七、兜底：静态资源
   --------------------------------------------------------------------------
   放在最后。任何前面没匹配上的路径，都当作「要一个文件」来处理，
   这样首页、3D 游戏页、GLB 模型、CSS 都能正常返回。
   ========================================================================== */

app.all('*', async (c) => {
  const file = await getContent(c.env, c.req.path)
  if (file) return new Response(file.body, { headers: file.headers })
  return c.text('页面不存在', 404)
})

export default app