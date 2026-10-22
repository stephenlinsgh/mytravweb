/**
 * 前台脚本测试：用极简 DOM mock 跑 cms-list.js
 * 验证：搜索框位置、分组渲染、首页无槽位时的动态结果区
 * 运行：node test-front.mjs
 */
import fs from 'fs'

const code = fs.readFileSync('feiyou-notes-github/assets/cms-list.js', 'utf8')

function el(tag) {
  const e = {
    tagName: tag,
    style: {},
    className: '',
    innerHTML: '',
    value: '',
    offsetWidth: 0,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c) },
      remove(c) { this.set.delete(c) },
      toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c) },
      contains(c) { return this.set.has(c) }
    },
    appendChild(child) { return child },
    insertBefore(child) { return child },
    setAttribute() {},
    addEventListener(type, fn) { this['on' + type] = fn },
    querySelector() { return el('i') },
    focus() {}
  }
  return e
}

const posts = [
  { slug: 'a', title: '京城夏日', category: 'travel', summary: '北京', cover: '', created_at: 1000 },
  { slug: 'b', title: '风雨里的宁波', category: 'travel', summary: '宁波', cover: '', created_at: 2000 },
  { slug: 'note-plane-spotting', title: '眼力大挑战', category: 'notes', summary: '航空', cover: '', created_at: 3000 },
  { slug: 'd', title: '跑步记录', category: 'sports', summary: '运动', cover: '', created_at: 4000 }
]

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')) }
}

async function run(withSlot) {
  const created = []
  const slot = withSlot ? el('div') : null
  const brand = el('div')
  const navInner = el('div')
  navInner.querySelector = () => brand
  navInner.insertBefore = (child) => { navInner.inserted = child; return child }
  brand.nextSibling = null

  const parent = {
    children: [],
    insertBefore(child) { this.children.push(child); child.parentNode = this; return child },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child)
      child.parentNode = null
    }
  }
  if (slot) slot.parentNode = parent

  const main = el('main')
  main.firstChild = null
  main.insertBefore = (child) => { main.inserted = child; child.parentNode = main; return child }
  main.removeChild = (child) => {
    main.children = (main.children || []).filter((c) => c !== child)
    child.parentNode = null
  }

  const doc = {
    currentScript: { getAttribute: (k) => (k === 'data-cat' ? 'notes' : '') },
    readyState: 'complete',
    querySelector(sel) {
      if (sel === '[data-cms-slot]') return slot
      if (sel === '.nav-inner') return navInner
      if (sel === 'main') return main
      return null
    },
    createElement(tag) {
      const e = el(tag)
      created.push(e)
      return e
    },
    body: { appendChild() {} }
  }

  let lastUrl = ''
  async function mockFetch(url) {
    lastUrl = url
    return { ok: true, json: async () => ({ posts }) }
  }

  const fn = new Function('document', 'fetch', 'setTimeout', 'clearTimeout', code)
  fn(doc, mockFetch, setTimeout, clearTimeout)
  await new Promise((r) => setTimeout(r, 60))

  const box = created.find((e) => e.className === 'nav-search')
  const input = created.find((e) => e.tagName === 'input')

  console.log(withSlot ? '=== 有 CMS 槽位的页面（笔记页）===' : '=== 无 CMS 槽位的页面（首页）===')

  check('搜索框插到了导航栏', !!navInner.inserted && navInner.inserted === box)
  check('搜索框有输入框', !!input)

  // 首次加载
  if (withSlot) {
    check('栏目页首次加载带 category=notes', lastUrl.includes('category=notes'), lastUrl)
    check('栏目页首次渲染了文章', slot.innerHTML.includes('眼力大挑战'))
  } else {
    check('首页首次不请求文章列表', lastUrl === '', lastUrl)
    check('首页首次不建结果区', !main.inserted)
  }

  // 输入关键词，触发搜索
  input.value = '宁波'
  input.oninput()
  await new Promise((r) => setTimeout(r, 450))

  check('搜索时不再带 category（全站）', lastUrl.includes('q=') && !lastUrl.includes('category='), lastUrl)

  const out = withSlot ? slot : created.find((e) => e.className === 'grid cms-results')
  check('搜索结果有结果容器', !!out)

  const html = out.innerHTML
  check('有分组标题「旅行」', html.includes('cms-group-title') && html.includes('旅行'))
  check('有分组标题「笔记」', html.includes('笔记'))
  check('有分组标题「运动」', html.includes('运动'))
  check('标出篇数', html.includes('共 2 篇') && html.includes('共 1 篇'), html.match(/共 \d+ 篇/g))
  check('分组顺序：旅行在笔记前', html.indexOf('旅行') < html.indexOf('笔记'))
  check('分组顺序：笔记在运动前', html.indexOf('笔记') < html.indexOf('运动'))
  check('没有空状态提示', !html.includes('还没有文章'))
  check('互动游戏卡片跳原页面', html.includes('href="/note-plane-spotting.html"'), html.slice(0, 200))
  check('普通文章仍进 /post/', html.includes('href="/post/a"'))

  // 搜索模式：收起原板块 + 返回按钮
  check('进入搜索模式（收起原板块）', main.classList.contains('cms-searching'))
  const backBox = created.find((e) => e.className === 'cms-back')
  check('有返回按钮容器', !!backBox)
  const backBtn = created.find((e) => e.tagName === 'button' && e.textContent === '← 返回上一页')
  check('返回按钮文案正确', !!backBtn)

  if (backBtn) {
    backBtn.onclick()
    await new Promise((r) => setTimeout(r, 90))
    check('点返回后退出搜索模式', !main.classList.contains('cms-searching'))
    check('搜索框已清空', input.value === '', input.value)
    check('结果区不再有分组标题', !(withSlot ? slot.innerHTML : (main.inserted && main.inserted.innerHTML) || '').includes('cms-group-title'))
  }
}

await run(true)
console.log('')
await run(false)

console.log('')
console.log('结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
if (fail > 0) process.exit(1)
