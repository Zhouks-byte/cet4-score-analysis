/*!
 * sw.js — Service Worker（离线可用 / 秒开）
 * 策略：
 *   · 导航请求（HTML）：network-first，3s 超时后回落缓存 —— 保证既有更新又能离线打开
 *   · 静态资源（图标/manifest）：stale-while-revalidate —— 先给缓存再后台更新
 *   · 其他 GET：cache-first
 * 版本号变更即触发旧缓存清理。
 */
'use strict';

var VERSION = 'cet4-v5';
var APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-16.png',
  './assets/icon-32.png',
  './assets/icon-48.png',
  './assets/icon-64.png',
  './assets/icon-128.png',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

/* ---------------- 安装：预缓存应用外壳 ---------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* 逐个 add，单个失败不阻塞整体安装（资源缺失不应导致 SW 不可用） */
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------------- 激活：清理旧版本缓存 ---------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------------- 请求拦截 ---------------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  /* 只处理同源请求，跨域交给浏览器 */
  if (url.origin !== self.location.origin) return;

  /* 1) 导航请求：network-first + 超时回落 */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    event.respondWith(networkFirst(req));
    return;
  }

  /* 2) 静态资源：stale-while-revalidate */
  event.respondWith(staleWhileRevalidate(req));
});

function networkFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      caches.match('./index.html').then(function (cached) {
        if (cached) resolve(cached);
        /* 没有缓存则继续等网络 */
        else caches.match(req).then(function (r) { resolve(r || fetch(req)); });
      });
    }, 3500);

    fetch(req).then(function (res) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
      }
      resolve(res);
    }).catch(function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caches.match('./index.html').then(function (cached) {
        resolve(cached || new Response(
          '<!DOCTYPE html><meta charset="utf-8"><title>离线</title>' +
          '<body style="font-family:system-ui;padding:40px;text-align:center;color:#333">' +
          '<h2>当前处于离线状态</h2><p>请联网后刷新一次页面，即可离线使用。</p></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ));
      });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.match(req).then(function (cached) {
    var network = fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return null; });

    return cached || network || new Response('', { status: 504 });
  });
}
