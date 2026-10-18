/**
 * 前台文章列表 + 全站搜索 · 通用脚本
 * ---------------------------------------------------------------------------
 * 用法：在任意页面的 </body> 之前加一行
 *   <script src="/assets/cms-list.js" data-cat="travel"></script>
 *
 * data-cat 取值：travel（旅行）/ notes（笔记）/ sports（运动）/ visit（参观）
 * 留空则列出全部分类的文章。
 *
 * 它做什么：
 *   1. 在导航栏「个人笔记」右边插入一个搜索框（搜全站，带顶部进度条）
 *   2. 页面上有 [data-cms-slot] 时，把本栏目的文章渲染进去
 *   3. 搜索时不分栏目，结果里会标出每篇所属分类
 *   4. 页面没有槽位（比如首页）时，搜索结果动态插到 main 末尾
 *   5. 拉不到就保持原样（本地预览、无网络时页面照常显示）
 */
(function () {
  'use strict'

  var script = document.currentScript
  if (!script) return

  var cat = script.getAttribute('data-cat') || ''
  var base = script.getAttribute('data-base') || ''

  // 等待 DOM 就绪（脚本要放 </body> 前，但保险起见判断一下）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  /* ---------------- 顶部进度条 ---------------- */
  var progressEl = null
  var progressAt = 0

  function ensureProgress() {
    if (progressEl) return progressEl
    progressEl = document.createElement('div')
    progressEl.className = 'cms-progress'
    progressEl.innerHTML = '<i></i>'
    document.body.appendChild(progressEl)
    return progressEl
  }

  function progressStart() {
    var el = ensureProgress()
    var fill = el.querySelector('i')
    progressAt = Date.now()
    el.classList.add('on')
    fill.style.transition = 'none'
    fill.style.width = '0'
    void fill.offsetWidth
    fill.style.transition = 'width .3s ease'
    fill.style.width = '72%'
  }

  function progressDone() {
    var el = ensureProgress()
    var fill = el.querySelector('i')
    // 请求太快时也让它至少走 320ms，不然一闪就没
    var wait = Math.max(0, 320 - (Date.now() - progressAt))
    setTimeout(function () {
      fill.style.width = '100%'
      setTimeout(function () {
        el.classList.remove('on')
        setTimeout(function () {
          fill.style.transition = 'none'
          fill.style.width = '0'
        }, 260)
      }, 220)
    }, wait)
  }

  /* ---------------- 列表 + 搜索 ---------------- */
  function init() {
    var slot = document.querySelector('[data-cms-slot]')
    var resultBox = null
    // 先记住原有内容，拉取失败时原样保留
    var original = slot ? slot.innerHTML : ''

    // 搜索框：放到导航栏「个人笔记」右边
    var box = document.createElement('div')
    box.className = 'nav-search'

    var input = document.createElement('input')
    input.type = 'search'
    input.placeholder = '搜索全站文章…'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('aria-label', '搜索全站文章')

    var clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.textContent = '×'
    clearBtn.setAttribute('aria-label', '清除搜索')

    box.appendChild(input)
    box.appendChild(clearBtn)

    var navInner = document.querySelector('.nav-inner')
    var brand = navInner ? navInner.querySelector('.brand') : null
    if (navInner && brand) {
      navInner.insertBefore(box, brand.nextSibling)
    } else if (slot) {
      slot.parentNode.insertBefore(box, slot)
    }

    // 结果显示位置：优先用页面上的 CMS 槽位；
    // 页面没有槽位（比如首页）时，搜索后动态建一个结果区
    function target() {
      if (slot) return slot
      if (!resultBox) {
        resultBox = document.createElement('div')
        resultBox.className = 'grid cms-results'
        var main = document.querySelector('main') || document.body
        // 插到 main 开头，搜索后不用往下翻
        main.insertBefore(resultBox, main.firstChild)
      }
      return resultBox
    }

    var timer = null
    var seq = 0

    function load(kw) {
      // 没有 CMS 槽位、也没输入关键词：什么都不做（首页平时不显示文章列表）
      if (!slot && !kw) {
        if (resultBox) resultBox.innerHTML = ''
        return
      }

      var my = ++seq
      progressStart()

      var params = []
      if (kw) {
        params.push('q=' + encodeURIComponent(kw)) // 有关键词就搜全站
      } else if (cat) {
        params.push('category=' + encodeURIComponent(cat)) // 平时只看本栏目
      }
      var url = '/api/public/posts' + (params.length ? '?' + params.join('&') : '')

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.json()
        })
        .then(function (d) {
          if (my !== seq) return // 只认最后一次请求，避免旧结果盖掉新结果
          var posts = (d && d.posts) || []
          var out = target()

          if (!posts.length) {
            // 平时不显示「还没有文章」这类提示；只有搜索时给一句反馈
            out.innerHTML = kw
              ? '<p class="cms-empty">没有找到包含「' + esc(kw) + '」的文章。</p>'
              : ''
            return
          }

          if (kw) {
            // 全站搜索结果：按分类分组，每组标出篇数
            out.innerHTML = grouped(posts)
          } else {
            // 栏目页平时只显示本栏目，不用再标分类
            out.innerHTML = posts.map(function (p) { return card(p, false) }).join('')
          }
        })
        .catch(function () {
          if (my !== seq) return
          // 数据库不可用（本地静态预览）：没搜关键词时保留原有内容
          if (!kw) {
            if (slot) slot.innerHTML = original
          } else {
            target().innerHTML = '<p class="cms-empty">搜索失败，请稍后再试。</p>'
          }
        })
        .then(function () {
          if (my === seq) progressDone()
        })
    }

    input.addEventListener('input', function () {
      box.classList.toggle('has-value', input.value !== '')
      clearTimeout(timer)
      var kw = input.value.trim()
      timer = setTimeout(function () { load(kw) }, 280)
    })
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(timer)
        load(input.value.trim())
      }
    })
    clearBtn.addEventListener('click', function () {
      input.value = ''
      box.classList.remove('has-value')
      load('')
      input.focus()
    })

    // 有槽位的页面才需要首次拉列表；首页没有槽位，等用户搜索
    if (slot) load('')
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
      }[c]
    })
  }

  function fmtDate(ts) {
    var d = new Date(ts)
    if (isNaN(d)) return ''
    return (
      d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0')
    )
  }

  var CAT_NAME = {
    travel: '旅行',
    notes: '笔记',
    sports: '运动',
    visit: '参观'
  }

  // 搜索结果的分类顺序
  var GROUPS = [
    { key: 'travel', name: '旅行' },
    { key: 'notes', name: '笔记' },
    { key: 'sports', name: '运动' },
    { key: 'visit', name: '参观' }
  ]

  // 按分类分组渲染：加粗组标题 + 共 x 篇 + 该组文章
  function grouped(posts) {
    var html = ''
    var seen = {}

    GROUPS.forEach(function (g) {
      var list = posts.filter(function (p) { return p.category === g.key })
      if (!list.length) return
      seen[g.key] = true
      html += '<h3 class="cms-group-title">' + esc(g.name) +
              '<span class="cms-group-count">共 ' + list.length + ' 篇</span></h3>'
      html += list.map(function (p) { return card(p, false) }).join('')
    })

    // 兜底：未知分类也要显示
    var others = posts.filter(function (p) { return !seen[p.category] })
    if (others.length) {
      html += '<h3 class="cms-group-title">其他' +
              '<span class="cms-group-count">共 ' + others.length + ' 篇</span></h3>'
      html += others.map(function (p) { return card(p, false) }).join('')
    }
    return html
  }

  // 取标题第一个「字」：汉字 / 字母 / 数字，跳过空格、标点和符号
  function firstChar(s) {
    var m = String(s || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/)
    return m ? m[0] : '·'
  }

  function card(p, showCat) {
    var href = base + '/post/' + encodeURIComponent(p.slug)
    var cover = p.cover
      ? '<img class="cover" src="' + esc(p.cover) + '" alt="' + esc(p.title) + '">'
      : '<div class="cover cover-initial" aria-hidden="true">' + esc(firstChar(p.title)) + '</div>'
    return (
      '<a class="card trip-card" href="' + href + '">' +
        cover +
        '<div class="body">' +
          '<h3>' + esc(p.title) + '</h3>' +
          '<div class="meta">' + fmtDate(p.created_at) +
            (showCat ? ' · ' + esc(CAT_NAME[p.category] || p.category) : '') +
          '</div>' +
          (p.summary ? '<p>' + esc(p.summary) + '</p>' : '') +
        '</div>' +
      '</a>'
    )
  }
})()
