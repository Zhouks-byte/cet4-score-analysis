/*!
 * tools/build.mjs — 把 src/*.css|js 内联进单文件 dist/index.html
 * 用法：node tools/build.mjs
 * 输出：dist/index.html（可直接双击打开、也可直接放 GitHub Pages）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error('缺少文件：' + rel);
  // 去掉 UTF-8 BOM：带 BOM 的单文件 HTML 会让浏览器提前结束解析，整页变成纯文本
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

const css = read('src/styles.css');
const js = [
  'src/model.js',
  'src/content.js',
  'src/charts.js',
  'src/analysis.js',
  'src/app.js'
].map(read).join('\n\n');

// 防止脚本内容提前闭合 <script>
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
const safeCss = css.replace(/<\/style>/gi, '<\\/style>');

const tpl = read('tools/index.template.html');
const html = tpl
  .replace('/*__INLINE_CSS__*/', () => safeCss)
  .replace('/*__INLINE_JS__*/', () => safeJs);

mkdirSync(join(root, 'dist'), { recursive: true });
const finalHtml = html.replace(/^\uFEFF/, '');
writeFileSync(join(root, 'dist', 'index.html'), finalHtml, 'utf8');

if (finalHtml.charCodeAt(0) !== 0x3c) throw new Error('构建产物首字符异常：' + JSON.stringify(finalHtml.slice(0, 20)));
const kb = (Buffer.byteLength(finalHtml, 'utf8') / 1024).toFixed(1);
console.log(`✓ dist/index.html 已生成（${kb} KB，CSS ${(css.length / 1024).toFixed(1)}K / JS ${(js.length / 1024).toFixed(1)}K）`);
