/* ==========================================================================
   主题切换（浅色 / 深色）
   - 首次访问跟随系统 prefers-color-scheme，之后记住用户的选择
   - <head> 里的内联脚本负责首屏前设置 data-theme，防止闪白；
     本文件在 body 末尾加载，负责兜底同步 + 绑定按钮点击
   - 所有颜色都在 style.css 的 [data-theme="dark"] 里覆盖
   ========================================================================== */
(function () {
  var KEY = 'pn-theme'

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t)
  }

  function bind() {
    var btn = document.getElementById('themeToggle')
    if (!btn || !btn.addEventListener) return
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark'
      apply(next)
      try { localStorage.setItem(KEY, next) } catch (e) {}
    })
  }

  // 兜底：以 localStorage 为准再同步一次（正常情况下 head 内联脚本已设好）
  var saved = null
  try { saved = localStorage.getItem(KEY) } catch (e) {}
  if (saved === 'dark' || saved === 'light') apply(saved)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind)
  } else {
    bind()
  }
})()
