/**
 * 静态资源读取
 * ---------------------------------------------------------------------------
 * Workers 不能直接摸磁盘，所以用 wrangler 的 assets 绑定把整个网站目录
 * （首页、3D 游戏页、CSS、GLB 模型）打包进去，这里按路径取出来返回。
 *
 * 路由顺序很重要：src/worker.js 里 API 和后台页面的路由必须写在最后那个
 * 兜底处理器之前，否则 /admin 会被当成文件名去磁盘上找。
 */

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  glb: 'model/gltf-binary',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

/** 取扩展名小写，不带点 */
const ext = (p) => (p.split('.').pop() || '').toLowerCase()

/**
 * @param env  Worker 环境变量，其中 ASSETS 是 assets 绑定
 * @param path 请求路径，例如 "/" 或 "/assets/models/a320.glb"
 * @returns {Promise<{body:ArrayBuffer, headers:Headers}|null>} 找不到返回 null
 */
export async function getContent(env, path = '/') {
  // 归一化：防目录穿越
  let rel = path.split('?')[0].split('#')[0].replace(/\/+/g, '/')
  if (rel.includes('..')) return null

  // 目录 → index.html；根路径 → 首页
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html'

  // 用 fetch 而不是 ASSETS.get()：后者只在 wrangler 4 可用，
  // 3.x 会抛 "RPC receiver does not implement the method get"
  const url = new URL('https://assets.local/' + rel.replace(/^\//, ''))
  const res = await env.ASSETS.fetch(new Request(url))
  if (!res || res.status === 404) return null

  const e = ext(rel)
  const headers = new Headers()
  headers.set('Content-Type', res.headers.get('Content-Type') || MIME[e] || 'application/octet-stream')
  // HTML 每次都要回源校验，否则改了页面访客还看到旧版；
  // 模型/CSS/图片可以放心缓存一天。
  headers.set('Cache-Control', e === 'html'
    ? 'public, max-age=0, must-revalidate'
    : 'public, max-age=86400')

  return { body: await res.arrayBuffer(), headers }
}