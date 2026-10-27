import { readFileSync, existsSync } from "node:fs";
const h = readFileSync("index.html", "utf8");
const re = /<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g;
const links = h.match(re) || [];
console.log("图标/manifest 链接：");
for (const l of links) console.log("  " + l);
console.log("\n路径可达性：");
for (const l of links) {
  const m = l.match(/href="([^"]+)"/);
  if (!m) continue;
  const p = m[1];
  if (p.startsWith("data:") || p.startsWith("http")) { console.log("  " + p.slice(0, 40) + " (外链/内联)"); continue; }
  console.log("  " + (existsSync(p) ? "✓" : "✗") + " " + p);
}
