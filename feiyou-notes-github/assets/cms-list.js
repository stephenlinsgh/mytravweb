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
 *   1. 找到页面上带data-cms-slot 的容器
 *   2. 调 /api/public/posts?category=xxx 从数据库拉文章
 *   3. 渲染成卡片列表
 *   4. 拉不到就保持原样（本地预览、无网络时页面照常显示）
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

  function init() {
    var slot = document.querySelector('[data-cms-slot]')
    if (!slot) return

    // 先记住原有内容，拉取失败时原样保留
    var original = slot.innerHTML

    fetch('/api/public/posts' + (cat ? '?category=' + encodeURIComponent(cat) : ''), {
      headers: { Accept: 'application/json' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(function (d) {
        var posts = (d && d.posts) || []
        if (!posts.length) {
          slot.innerHTML =
            '<p class="cms-empty">还没有文章。登录 <a href="/admin">后台</a> 写第一篇吧。</p>'
          return
        }
        slot.innerHTML = posts.map(card).join('')
      })
      .catch(function () {
        // 数据库不可用（本地静态预览）：不动原有内容
        slot.innerHTML = original
      })
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

  function card(p) {
    var href = base + '/post/' + encodeURIComponent(p.slug)
    var cover = p.cover
      ? '<img class="cover" src="' + esc(p.cover) + '" alt="' + esc(p.title) + '">'
      : ''
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