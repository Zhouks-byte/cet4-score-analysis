/* 清理临时/一次性文件，保持仓库整洁 */
import { readFileSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';

const gitignore = `# 依赖
node_modules/

# 构建与 QA 中间产物
qa/out*/
qa/v2*/
qa/v3*/
qa/v4*/
qa/live*/
qa/dbg*/
qa/shots/
qa/_profile
qa/*.png
qa/probe*.mjs
qa/dbg*.mjs
qa/diag*.mjs
qa/crop.mjs
qa/dump-bar.mjs
qa/check-*.mjs
qa/struct.cjs
qa/charts-*.mjs
qa/shots-*.mjs

# 一次性补丁脚本（已应用，保留会造成困惑）
tools/patch-*.mjs
tools/fix-*.mjs
tools/ui-v2*.mjs
tools/scan-*.cjs
tools/index.utf8.template.html
tools/index.template.html.bak

# 临时文件
app.base.js
app.recovered.js
_records_snippet.js
*.log
.DS_Store
`;

writeFileSync('.gitignore', gitignore, 'utf8');

const tmp = [
  'src/app.base.js',
  'src/app.recovered.js',
  '_records_snippet.js',
  'qa/struct.cjs',
  'qa/dbg1.mjs',
  'qa/probe.mjs',
  'qa/probe2.mjs',
  'qa/dbg-tab.mjs',
  'qa/diag-charts.mjs',
  'tools/fix-adapter.mjs',
  'tools/fix-adapter2.mjs',
  'tools/fix-quotes.mjs',
  'tools/patch-qa.mjs',
  'tools/patch-qa2.mjs',
  'tools/patch-records.mjs',
  'tools/patch-hbars.mjs',
  'tools/patch-ticks.mjs',
  'tools/ui-v2.mjs',
  'tools/ui-v2b.mjs',
  'tools/scan-quotes.cjs',
  'tools/scan-chars.cjs',
  'tools/scan-lex.cjs',
  'tools/scan-balance.cjs',
  'tools/fix-template.mjs'
];

let removed = 0;
for (const f of tmp) {
  if (existsSync(f)) { try { unlinkSync(f); removed++; } catch { /* ignore */ } }
}
for (const d of ['qa/out', 'qa/out2', 'qa/out3', 'qa/out4', 'qa/out5', 'qa/v2a', 'qa/v2b', 'qa/v2', 'qa/v3', 'qa/v4', 'qa/live', 'qa/live2', 'qa/dbg', 'qa/shots']) {
  if (existsSync(d)) { try { rmSync(d, { recursive: true, force: true }); removed++; } catch { /* ignore */ } }
}

/* 保留：qa/cdp.mjs（回归）、qa/probe-page.mjs（冒烟）、qa/crop.mjs? 已删，改保留 shots-light 脚本 */
console.log('✓ 清理完成，删除 ' + removed + ' 项');
