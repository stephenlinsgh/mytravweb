@echo off
chcp 65001 >nul
title 个人笔记 - 本地预览服务器
cd /d "%~dp0"

set NODE=
if exist "%~dp0node.exe" set NODE="%~dp0node.exe"
if not defined NODE (
  for %%i in (node.exe) do set NODE=%%~$PATH:i
)
if not defined NODE (
  echo.
  echo [错误] 没有找到 node.exe
  echo 请到 https://nodejs.org 下载安装 LTS 版本后重试。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在启动本地服务器...
echo.
start "" "http://127.0.0.1:8899/note-plane-spotting.html"

%NODE% -e "const http=require('http'),fs=require('fs'),p=require('path');const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const f=p.join(process.cwd(),u);fs.readFile(f,(e,d)=>{if(e){s.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});s.end('404 未找到: '+u);return;}s.writeHead(200,{'Content-Type':T[p.extname(f).toLowerCase()]||'application/octet-stream'});s.end(d);});}).listen(8899,()=>console.log('服务器已启动: http://127.0.0.1:8899'))"

echo.
echo 服务器运行中，关闭此窗口即停止。
pause