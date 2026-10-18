/**
 * 把网站上原有的静态文章（note-*.html）转成后台可编辑的数据。
 * 产物：src/import-data.js
 *
 * 运行：node scripts/build-import.js
 *
 * 转换规则：
 *   - 标题取 <h1>，摘要取 <meta name="description">
 *   - 正文取 <article class="prose">，HTML 转 Markdown
 *   - 图片相对路径 ./assets/... 统一转成绝对路径 /assets/...（否则文章页 /post/xxx 下会 404）
 *   - 「眼力大挑战」是 3D 互动游戏页，只导入文字部分，游戏留在原页面
 */
const fs = require('fs')
const path = require('path')

const SITE = path.resolve(__dirname, '..', 'feiyou-notes-github')
const OUT = path.resolve(__dirname, '..', 'src', 'import-data.js')

// 9 篇旅行笔记（首页那 16 张卡片里的文章）
const TRAVEL = [
  'note-beijing', 'note-dishuihu', 'note-nanjing', 'note-nantong',
  'note-ningbo', 'note-qingdao', 'note-shaoxing', 'note-xiamen', 'note-yangzhou'
]

function abs(src) {
  if (!src) return ''
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src
  return '/' + src.replace(/^\.\//, '')
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** HTML 片段转 Markdown */
function htmlToMarkdown(html) {
  let s = html

  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  // 去掉「← 返回旅行 / 全部笔记」这类导航尾巴。
  // 注意必须逐段判断：直接写 /<p[\s\S]*?← 返回/ 会从第一个 <p> 一路吃到尾巴，把整篇正文删光。
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, function (m, inner) {
    return /←\s*返回/.test(inner) ? '' : m
  })

  // 表格 → Markdown 表格（要在 p/li 之前处理）
  s = s.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, function (m) {
    const rows = []
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let tr
    while ((tr = trRe.exec(m))) {
      const cells = []
      const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi
      let c
      while ((c = cellRe.exec(tr[1]))) cells.push(stripTags(c[2]).replace(/\|/g, '\\|'))
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return ''
    const head = rows[0]
    const body = rows.slice(1)
    return '\n\n| ' + head.join(' | ') + ' |\n|' +
      head.map(function () { return ' --- ' }).join('|') + '|\n' +
      body.map(function (r) { return '| ' + r.join(' | ') + ' |' }).join('\n') +
      '\n\n'
  })

  // figure：图片 + 图注
  s = s.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, function (m, inner) {
    const img = inner.match(/<img[^>]*>/i)
    const cap = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
    let out = ''
    if (img) {
      const src = (img[0].match(/src="([^"]*)"/i) || [])[1] || ''
      const alt = (img[0].match(/alt="([^"]*)"/i) || [])[1] || ''
      out += '![' + decodeEntities(alt) + '](' + abs(src) + ')\n\n'
    }
    if (cap) out += stripTags(cap[1]) + '\n\n'
    return out
  })

  // 独立图片
  s = s.replace(/<img[^>]*>/gi, function (m) {
    const src = (m.match(/src="([^"]*)"/i) || [])[1] || ''
    const alt = (m.match(/alt="([^"]*)"/i) || [])[1] || ''
    return '\n\n![' + decodeEntities(alt) + '](' + abs(src) + ')\n\n'
  })

  // 标题
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')

  // 强调
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')

  // 链接
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2](' + '$1' + ')')

  // 列表
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n')

  // 段落与换行
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')

  // 清掉残留标签
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)

  // 压缩空白
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

function readFile(name) {
  return fs.readFileSync(path.join(SITE, name + '.html'), 'utf8')
}

function pickTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return stripTags(h1[1])
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return t ? stripTags(t[1]).replace(/\s*·\s*旅行笔记$/, '') : ''
}

function pickSummary(html) {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)
  return m ? decodeEntities(m[1]).trim() : ''
}

function pickBody(html) {
  const m = html.match(/<article[^>]*class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/article>/i)
  return m ? m[1] : ''
}

// 封面不自动从正文取图。
// 正文里的照片是内容的一部分，不该冒充封面；需要封面时在后台单独上传。
function pickCover() {
  return ''
}

/** 从 .pill 里找 2024.07.02 这样的日期 */
function pickDate(html) {
  const m = html.match(/<span[^>]*class="pill"[^>]*>\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/i)
  if (!m) return 0
  const iso = m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0')
  const ts = new Date(iso + 'T12:00:00+08:00').getTime()
  return isNaN(ts) ? 0 : ts
}

const posts = []
let fallback = Date.now()

// ---- 9 篇旅行笔记：完整导入 ----
TRAVEL.forEach(function (name, i) {
  const html = readFile(name)
  const body = pickBody(html)
  posts.push({
    slug: name,
    title: pickTitle(html),
    category: 'travel',
    summary: pickSummary(html),
    cover: pickCover(html),
    content: htmlToMarkdown(body),
    created_at: pickDate(html) || (fallback - (TRAVEL.length - i) * 86400000)
  })
})

// ---- 眼力大挑战：只导入文字，游戏留在原页面 ----
;(function () {
  const name = 'note-plane-spotting'
  const html = readFile(name)
  const body = pickBody(html)

  const lead = body.match(/<p[^>]*class="lead"[^>]*>([\s\S]*?)<\/p>/i)
  // 从「为什么这样就能认出来」这个 h2 开始截，别把前面的游戏 div 残片带进来
  const idx = body.indexOf('为什么这样就能认出来')
  let tail = ''
  if (idx >= 0) {
    const start = body.lastIndexOf('<h2', idx)
    tail = body.slice(start >= 0 ? start : idx)
  }

  let md = ''
  if (lead) md += htmlToMarkdown(lead[1]) + '\n\n'
  if (tail) md += htmlToMarkdown(tail)
  md += '\n\n> 3D 模型和六关眼力挑战是互动内容，请前往 [原页面](/note-plane-spotting.html) 体验。'

  posts.push({
    slug: name,
    title: pickTitle(html),
    category: 'notes',
    summary: pickSummary(html) ||
      '三架真实 3D 模型可以拖动旋转，配六关眼力挑战，练出机场一眼认出 A320、B737 和 C919 的眼力。',
    cover: '',
    content: md.trim(),
    created_at: pickDate(html) || (fallback - 10 * 86400000)
  })
})()

const out = '// 由 scripts/build-import.js 自动生成，请勿手改。\n' +
  '// 内容来自网站上原有的静态文章（note-*.html），已转成 Markdown。\n' +
  'export default ' + JSON.stringify(posts, null, 2) + '\n'

fs.writeFileSync(OUT, out, 'utf8')

console.log('生成完成：' + OUT)
posts.forEach(function (p) {
  console.log('  - [' + p.category + '] ' + p.title +
    ' | 正文 ' + p.content.length + ' 字 | 封面 ' + (p.cover || '无'))
})
