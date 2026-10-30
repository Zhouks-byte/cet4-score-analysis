/*!
 * pwa.js — 安装引导与离线状态
 *   1) 注册 Service Worker（离线可用）
 *   2) 捕获 beforeinstallprompt，提供「安装到手机」按钮
 *   3) iOS Safari 不支持该事件 → 展示「添加到主屏幕」图文指引
 *   4) 离线 / 恢复在线时给出状态提示
 *   5) 已以独立模式运行时不显示任何安装入口
 */
(function () {
  'use strict';

  var LS_DISMISS = 'cet4.install.dismissed';
  var LS_INSTALLED = 'cet4.install.done';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.navigator.standalone === true) ||
      (document.referrer || '').indexOf('android-app://') === 0;
  }
  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      /* iPadOS 13+ 伪装成 macOS */
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  var deferredPrompt = null;
  var installed = false;

  /* ---------------- Service Worker ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    /* file:// 打开时 SW 不可用，直接跳过（离线单文件版不受影响） */
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
      /* 有新版本时静默更新，下次打开生效 */
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('cet4:sw-updated'));
          }
        });
      });
    }).catch(function () { /* 注册失败不影响使用 */ });
  }

  /* ---------------- 安装按钮 ---------------- */
  function createInstallUI() {
    var bar = document.createElement('div');
    bar.className = 'install-bar';
    bar.id = 'installBar';
    bar.innerHTML =
      '<div class="ib-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 512 512" width="100%" height="100%">' +
          '<defs><linearGradient id="ib-bg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#7b78ff"/><stop offset="52%" stop-color="#5b5bf5"/><stop offset="100%" stop-color="#8b5cf6"/>' +
          '</linearGradient></defs>' +
          '<rect x="36" y="36" width="440" height="440" rx="112" fill="url(#ib-bg)"/>' +
          '<text x="252.6" y="339" text-anchor="middle" fill="#fff" font-size="200" font-weight="800" ' +
          'letter-spacing="-10" font-family="system-ui,sans-serif">4</text>' +
        '</svg>' +
      '</div>' +
      '<div class="ib-main"><b>安装到手机</b><span id="ibSub">像 App 一样全屏使用</span></div>' +
      '<button class="ib-btn" id="ibAction" type="button">安装</button>' +
      '<button class="ib-close" id="ibClose" type="button" aria-label="关闭">&times;</button>';
    document.body.appendChild(bar);

    $('#ibClose').addEventListener('click', function () {
      setBarVisible(bar, false);
      try { localStorage.setItem(LS_DISMISS, String(Date.now())); } catch (e) { /* 忽略 */ }
    });

    $('#ibAction').addEventListener('click', function () {
      if (deferredPrompt) {
        /* Android / Chrome：调用原生安装弹窗 */
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') {
            try { localStorage.setItem(LS_INSTALLED, '1'); } catch (e) { /* 忽略 */ }
            setBarVisible(bar, false);
          } else {
            setBarVisible(bar, false);
            try { localStorage.setItem(LS_DISMISS, String(Date.now())); } catch (e) { /* 忽略 */ }
          }
          deferredPrompt = null;
        });
      } else if (isIOS()) {
        showIOSGuide();
      } else {
        showManualGuide();
      }
    });

    return bar;
  }

  /* 统一控制安装条显隐，并同步 body 类名（用于底部预留空间） */
  function setBarVisible(bar, visible) {
    if (!bar) return;
    bar.classList.toggle('show', !!visible);
    document.body.classList.toggle('has-install-bar', !!visible);
  }

  /* iOS 添加到主屏幕指引 */
  function showIOSGuide() {
    var mask = document.createElement('div');
    mask.className = 'guide-mask show';
    mask.innerHTML =
      '<div class="guide-card">' +
        '<h3>添加到主屏幕</h3>' +
        '<ol class="guide-steps">' +
          '<li>点击 Safari 底部的 <b>分享</b> 按钮 ' +
            '<svg class="gico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>' +
          '</li>' +
          '<li>在菜单里选择 <b>「添加到主屏幕」</b></li>' +
          '<li>点击右上角 <b>添加</b>，即可像 App 一样打开</li>' +
        '</ol>' +
        '<div class="guide-note">iOS 不支持网页直接弹出安装框，需按上述步骤手动添加。</div>' +
        '<button class="btn btn-primary btn-block" id="guideOk" type="button">我知道了</button>' +
      '</div>';
    document.body.appendChild(mask);
    $('#guideOk').addEventListener('click', function () {
      mask.classList.remove('show');
      setTimeout(function () { mask.remove(); }, 260);
      try { localStorage.setItem(LS_DISMISS, String(Date.now())); } catch (e) { /* 忽略 */ }
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { mask.classList.remove('show'); setTimeout(function () { mask.remove(); }, 260); }
    });
  }

  /* 桌面浏览器的通用指引 */
  function showManualGuide() {
    var mask = document.createElement('div');
    mask.className = 'guide-mask show';
    mask.innerHTML =
      '<div class="guide-card">' +
        '<h3>如何安装</h3>' +
        '<ol class="guide-steps">' +
          '<li><b>手机</b>：用 Chrome / Edge 打开，点右上角菜单 →「安装应用 / 添加到主屏幕」</li>' +
          '<li><b>电脑</b>：点击地址栏右侧的安装图标</li>' +
        '</ol>' +
        '<div class="guide-note">安装后可以全屏使用、离线打开，数据依然只存在本机。</div>' +
        '<button class="btn btn-primary btn-block" id="guideOk" type="button">我知道了</button>' +
      '</div>';
    document.body.appendChild(mask);
    $('#guideOk').addEventListener('click', function () {
      mask.classList.remove('show');
      setTimeout(function () { mask.remove(); }, 260);
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { mask.classList.remove('show'); setTimeout(function () { mask.remove(); }, 260); }
    });
  }

  /* ---------------- 离线提示 ---------------- */
  function setupOnlineUI() {
    function update() {
      var el = $('#offlineHint');
      if (navigator.onLine) {
        if (el) el.classList.remove('show');
      } else {
        if (!el) {
          el = document.createElement('div');
          el.id = 'offlineHint';
          el.className = 'offline-hint';
          el.innerHTML = '<span class="oh-dot"></span>当前离线，数据仍可正常保存';
          document.body.appendChild(el);
        }
        el.classList.add('show');
      }
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    registerSW();
    setupOnlineUI();

    if (isStandalone()) return;                       /* 已在 App 模式，不打扰 */
    try {
      if (localStorage.getItem(LS_INSTALLED) === '1') return;
      var dismissed = Number(localStorage.getItem(LS_DISMISS) || 0);
      if (dismissed && Date.now() - dismissed < 14 * 24 * 3600 * 1000) return;  /* 14 天内不再提示 */
    } catch (e) { /* 隐私模式忽略 */ }

    var bar = createInstallUI();

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      setBarVisible(bar, true);
    });

    window.addEventListener('appinstalled', function () {
      installed = true;
      setBarVisible(bar, false);
      try { localStorage.setItem(LS_INSTALLED, '1'); } catch (e) { /* 忽略 */ }
    });

    /* iOS 没有 beforeinstallprompt，主动给出入口 */
    if (isIOS() && !isStandalone()) {
      setTimeout(function () { setBarVisible(bar, true); }, 1500);
    } else if (!deferredPrompt) {
      /* 其他浏览器（含已安装但非 standalone 场景）延迟显示手动入口 */
      setTimeout(function () {
        if (!deferredPrompt && !installed) setBarVisible(bar, true);
      }, 4000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__CET4_PWA__ = {
    isStandalone: isStandalone,
    isIOS: isIOS,
    isAndroid: isAndroid,
    showGuide: function () { if (isIOS()) showIOSGuide(); else showManualGuide(); }
  };
})();
