/**
 * 前台文章列表 · 通用脚本
 * ---------------------------------------------------------------------------
 * 用法：在任意页面的 </body> 之前加一行
 *   <script src="/assets/cms-list.js" data-cat="travel"></script>
 *
 * data-cat 取值：travel（旅行）/ notes（笔记）/ sports（运动）/ visit（参观）
 * 留空则列出全部分类的文章。
 *
 * 它做什么：
 *   1. 找到页面上带 data-cms-slot 的容器
 *   2. 在列表前面插入一个搜索框（本栏目内搜索，带顶部进度条）
 *   3. 调 /api/public/posts 从数据库拉文章（支持 ?category= 和 ?q=）
 *   4. 渲染成卡片列表
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
    if (!slot) return

    // 先记住原有内容，拉取失败时原样保留
    var original = slot.innerHTML

    // 搜索框：插在文章列表前面
    var box = document.createElement('div')
    box.className = 'cms-search'

    var input = document.createElement('input')
    input.type = 'search'
    input.placeholder = cat ? '在本栏目搜索文章…' : '搜索文章标题或内容…'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('aria-label', '搜索文章')

    var clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.textContent = '清除'

    box.appendChild(input)
    box.appendChild(clearBtn)
    slot.parentNode.insertBefore(box, slot)

    var timer = null
    var seq = 0

    function load(kw) {
      var my = ++seq
      progressStart()

      var params = []
      if (cat) params.push('category=' + encodeURIComponent(cat))
      if (kw) params.push('q=' + encodeURIComponent(kw))
      var url = '/api/public/posts' + (params.length ? '?' + params.join('&') : '')

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.json()
        })
        .then(function (d) {
          if (my !== seq) return // 只认最后一次请求，避免旧结果盖掉新结果
          var posts = (d && d.posts) || []
          if (!posts.length) {
            slot.innerHTML = kw
              ? '<p class="cms-empty">没有找到包含「' + esc(kw) + '」的文章。</p>'
              : '<p class="cms-empty">还没有文章。登录 <a href="/admin">后台</a> 写第一篇吧。</p>'
            return
          }
          slot.innerHTML = posts.map(card).join('')
        })
        .catch(function () {
          if (my !== seq) return
          // 数据库不可用（本地静态预览）：没搜关键词时保留原有内容
          if (!kw) slot.innerHTML = original
          else slot.innerHTML = '<p class="cms-empty">搜索失败，请稍后再试。</p>'
        })
        .then(function () {
          if (my === seq) progressDone()
        })
    }

    input.addEventListener('input', function () {
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
      load('')
      input.focus()
    })

    load('')
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

  // 取标题第一个「字」：汉字 / 字母 / 数字，跳过空格、标点和符号
  function firstChar(s) {
    var m = String(s || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/)
    return m ? m[0] : '·'
  }

  function card(p) {
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
            (cat ? '' : ' · ' + esc(CAT_NAME[p.category] || p.category)) +
          '</div>' +
          (p.summary ? '<p>' + esc(p.summary) + '</p>' : '') +
        '</div>' +
      '</a>'
    )
  }
})()
