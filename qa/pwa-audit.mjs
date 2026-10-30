/* 检查当前 PWA 基础设施：manifest 完整性、meta 标签、service worker 是否存在 */
import { readFileSync, existsSync } from 'node:fs';

const tpl = readFileSync('tools/index.template.html', 'utf8');
const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));

console.log('=== manifest.webmanifest ===');
const required = ['name', 'short_name', 'start_url', 'display', 'icons', 'background_color', 'theme_color'];
for (const k of required) {
  const v = manifest[k];
  console.log(`  ${v ? '✓' : '✗'} ${k}: ${Array.isArray(v) ? v.length + ' 项' : JSON.stringify(v)}`);
}
console.log('  · scope:', manifest.scope || '(未设置)');
console.log('  · id:', manifest.id || '(未设置)');
console.log('  · display_override:', manifest.display_override || '(未设置)');
console.log('  · orientation:', manifest.orientation || '(未设置)');

const iconOk = (manifest.icons || []).some(i => i.sizes === '192x192') &&
               (manifest.icons || []).some(i => i.sizes === '512x512');
console.log('  安装条件（192 + 512 图标）:', iconOk ? '✓' : '✗');
const maskable = (manifest.icons || []).some(i => (i.purpose || '').includes('maskable'));
console.log('  maskable 图标:', maskable ? '✓' : '✗');

console.log('\n=== 页面 meta / 链接 ===');
const checks = {
  'viewport-fit=cover': /viewport-fit=cover/.test(tpl),
  'theme-color': /name="theme-color"/.test(tpl),
  'apple-mobile-web-app-capable': /apple-mobile-web-app-capable/.test(tpl),
  'apple-mobile-web-app-status-bar-style': /apple-mobile-web-app-status-bar-style/.test(tpl),
  'apple-touch-icon': /apple-touch-icon/.test(tpl),
  'manifest 链接': /manifest\.webmanifest/.test(tpl)
};
for (const [k, v] of Object.entries(checks)) console.log('  ' + (v ? '✓' : '✗') + ' ' + k);

console.log('\n=== Service Worker ===');
const swExists = existsSync('dist/sw.js') || existsSync('sw.js');
console.log('  sw.js 存在:', swExists ? '✓' : '✗（离线不可用，每次打开都要联网）');
console.log('  注册代码:', /serviceWorker\.register/.test(tpl) ? '✓' : '✗');

console.log('\n=== 独立模式适配 ===');
const css = readFileSync('src/styles.css', 'utf8');
console.log('  safe-area-inset 使用:', /safe-area-inset/.test(css) ? '✓' : '✗');
console.log('  standalone 媒体查询:', /display-mode:\s*standalone/.test(css) ? '✓' : '✗');
console.log('\n=== 安装引导 UI ===');
console.log('  beforeinstallprompt 处理:', /beforeinstallprompt/.test(tpl) || /beforeinstallprompt/.test(readFileSync('src/app.js', 'utf8')) ? '✓' : '✗');
