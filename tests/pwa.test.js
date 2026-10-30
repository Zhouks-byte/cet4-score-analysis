/*!
 * tests/pwa.test.js — PWA 可安装性与离线能力测试
 * 运行：node tests/pwa.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------------- 1. manifest 安装条件 ---------------- */
let manifest;
try { manifest = JSON.parse(read('manifest.webmanifest')); } catch (e) { manifest = null; }
ok(!!manifest, 'manifest.webmanifest 是合法 JSON');

if (manifest) {
  ok(manifest.name && manifest.name.length > 0, 'name 非空', manifest.name);
  ok(manifest.short_name && manifest.short_name.length <= 13, 'short_name 存在且不超 13 字', manifest.short_name);
  ok(manifest.start_url, 'start_url 存在', manifest.start_url);
  ok(manifest.scope, 'scope 存在', manifest.scope);
  ok(manifest.display === 'standalone' || (manifest.display_override || []).includes('standalone'),
    'display 支持 standalone', manifest.display);
  ok(manifest.background_color && /^#[0-9a-f]{6}$/i.test(manifest.background_color), 'background_color 合法');
  ok(manifest.theme_color && /^#[0-9a-f]{6}$/i.test(manifest.theme_color), 'theme_color 合法');
  ok(manifest.id, 'id 存在（安装标识稳定）', manifest.id);
  ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2, '提供快捷方式', (manifest.shortcuts || []).length);

  const icons = manifest.icons || [];
  const sizes = icons.map(i => i.sizes);
  ok(sizes.includes('192x192'), '包含 192x192 图标');
  ok(sizes.includes('512x512'), '包含 512x512 图标');
  ok(icons.some(i => (i.purpose || '').includes('maskable')), '包含 maskable 图标');
  ok(icons.every(i => i.type && i.src), '图标同时声明 type 与 src');

  /* 图标文件必须真实存在 */
  for (const icon of icons) {
    if (!icon.src) continue;
    if (icon.src === 'assets/favicon.svg') {
      ok(fs.existsSync(path.join(ROOT, icon.src)), '图标文件存在: ' + icon.src);
    } else {
      ok(fs.existsSync(path.join(ROOT, icon.src)), '图标文件存在: ' + icon.src);
    }
  }
}

/* ---------------- 2. Service Worker ---------------- */
const sw = read('src/sw.js');
ok(/VERSION\s*=/.test(sw), 'SW 定义缓存版本号');
ok(/addEventListener\(\s*'install'/.test(sw), 'SW 处理 install');
ok(/addEventListener\(\s*'activate'/.test(sw), 'SW 处理 activate');
ok(/addEventListener\(\s*'fetch'/.test(sw), 'SW 处理 fetch');
ok(/caches\.open/.test(sw), 'SW 使用 Cache Storage');
ok(/skipWaiting/.test(sw), 'SW 立即接管（skipWaiting）');
ok(/clients\.claim/.test(sw), 'SW 接管已打开页面（clients.claim）');
ok(/caches\.keys/.test(sw) && /caches\.delete/.test(sw), 'SW 激活时清理旧版本缓存');
ok(/networkFirst/.test(sw), '导航请求采用 network-first（内容可更新）');
ok(/staleWhileRevalidate/.test(sw), '静态资源采用 stale-while-revalidate');
ok(/req\.method\s*!==\s*'GET'/.test(sw), 'SW 跳过非 GET 请求');
ok(/url\.origin\s*!==\s*self\.location\.origin/.test(sw), 'SW 只处理同源请求');
/* 超时回落 */
ok(/setTimeout\(/.test(sw), 'SW 有超时回落机制，弱网也能打开');

/* ---------------- 3. SW 语法可执行 ---------------- */
try {
  new vm.Script(sw, { filename: 'sw.js' });
  ok(true, 'sw.js 语法正确');
} catch (e) {
  ok(false, 'sw.js 语法正确', e.message);
}

/* ---------------- 4. 注册与安装引导 ---------------- */
const pwa = read('src/pwa.js');
ok(/serviceWorker\.register/.test(pwa), '页面注册 Service Worker');
ok(/beforeinstallprompt/.test(pwa), '捕获 beforeinstallprompt');
ok(/preventDefault/.test(pwa), '阻止浏览器默认安装条（改用自有 UI）');
ok(/appinstalled/.test(pwa), '监听 appinstalled');
ok(/display-mode:\s*standalone/.test(pwa), '检测独立模式');
ok(/iPad\|iPhone\|iPod|isIOS/.test(pwa), '识别 iOS');
ok(/添加到主屏幕/.test(pwa), 'iOS 提供「添加到主屏幕」指引');
ok(/share|分享/.test(pwa) || /分享/.test(pwa), 'iOS 指引包含分享按钮说明');
ok(/file:/.test(pwa), 'file:// 协议下跳过 SW（离线单文件版不受影响）');
ok(/navigator\.onLine/.test(pwa), '监听在线/离线状态');
ok(/localStorage/.test(pwa), '记录安装/忽略状态');

/* ---------------- 5. 独立模式样式 ---------------- */
const pwaCss = read('src/pwa.css');
ok(/display-mode:\s*standalone/.test(pwaCss), 'CSS 适配独立模式');
ok(/safe-area-inset/.test(pwaCss), 'CSS 处理安全区');
ok(/\.install-bar/.test(pwaCss), '安装条样式存在');
ok(/\.guide-mask/.test(pwaCss), '引导浮层样式存在');
ok(/\.offline-hint/.test(pwaCss), '离线提示样式存在');
ok(/@media print[\s\S]*install-bar[\s\S]*display:\s*none/.test(pwaCss), '打印时隐藏引导 UI');

/* ---------------- 6. 构建产物包含 PWA ---------------- */
const distPath = path.join(ROOT, 'dist', 'index.html');
if (fs.existsSync(distPath)) {
  const html = fs.readFileSync(distPath, 'utf8');
  ok(html.includes('serviceWorker.register'), '构建产物含 SW 注册');
  ok(html.includes('install-bar'), '构建产物含安装条');
  ok(html.includes('beforeinstallprompt'), '构建产物含安装事件处理');
  ok(/rel="manifest"/.test(html), '构建产物链接 manifest');
  ok(fs.existsSync(path.join(ROOT, 'dist', 'sw.js')), 'dist/sw.js 存在');
  ok(fs.existsSync(path.join(ROOT, 'dist', 'manifest.webmanifest')), 'dist/manifest.webmanifest 存在');
  ok(fs.existsSync(path.join(ROOT, 'dist', 'assets', 'icon-512.png')), 'dist 含 512 图标');
  /* 单文件仍可离线打开：不应有跨域脚本 */
  const ext = html.match(/<script[^>]+src="https?:/g);
  ok(!ext, '没有跨域脚本（离线可用）', ext ? ext.join(',') : '');
}

/* ---------------- 7. 数据仍只存本地 ---------------- */
const app = read('src/app.js');
ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(app), '应用层无任何网络上传');
ok(/localStorage/.test(app), '数据存 localStorage');
ok(!/analytics|gtag|百度统计|umeng/i.test(app), '无统计埋点');

/* ---------------- 输出 ---------------- */
console.log(`\nPWA 测试：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✓');
