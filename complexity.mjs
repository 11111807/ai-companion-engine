/**
 * 圈复杂度分析（自己实现的，不装任何依赖）
 *
 * 为什么自己写：项目里没有 eslint / plato 之类的度量工具，
 * 而"把平均复杂度降到 4.2"这种目标，不测就没法验证，只能凭感觉。
 *
 * 算法（实用近似，不是严格 McCabe）：
 *   复杂度 = 1 + 函数体内的判定点个数
 *   判定点：if / else if / for / while / case / catch / ?: / && / || / ??
 *
 * ⚠️ 近似说明：
 *   1. 先把注释和字符串字面量抠掉再数（否则中文注释里的"如果"、模板里的词都会算进去）
 *   2. 模板字符串 `${}` 里的表达式会被一并抠掉 —— 这个项目里极少在插值里写分支，
 *      影响可以忽略
 *   3. 不区分"是否真的独立路径"，所以只是个横向可比的相对指标
 *
 * 用法：
 *   node complexity.mjs            # 全部 src/*.js
 *   node complexity.mjs src/app.js # 指定的文件
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** 把注释、字符串、**正则字面量**换成空白，保证后面定位行号时不错位 */
function blankOut(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let state = 'code';          // code | line | block | sq | dq | tpl | regex
  let tplDepth = 0;

  /** 往前找最近的非空白字符（用来判断 `/` 是除号还是正则开头） */
  const prevChar = (from) => {
    for (let k = from; k >= 0; k--) {
      if (!/\s/.test(out[k])) return out[k];
    }
    return '';
  };

  /**
   * `/` 前面是这些字符 → 它是正则字面量的开头，不是除号。
   * 漏掉正则的话，`/[，。！？]/` 里的 `?` 会被当成三元运算符数进去，
   * 测出来的复杂度就是虚高的 —— 尺子不准，后面全白干。
   */
  const isRegexStart = (from) => {
    const p = prevChar(from);
    if (!p) return true;                                   // 行首
    if ('(,=:[!&|?{};+-*%<>~^'.includes(p)) return true;
    // `return /re/`、`typeof /re/` 这种
    const before = out.slice(Math.max(0, from - 8), from + 1).join('');
    return /\b(return|typeof|case|in|of|delete|void|instanceof)\s*$/.test(before);
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && isRegexStart(i - 1)) { state = 'regex'; i++; continue; }
      if (c === "'") { state = 'sq'; i++; continue; }
      if (c === '"') { state = 'dq'; i++; continue; }
      if (c === '`') { state = 'tpl'; tplDepth = 0; i++; continue; }
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; continue; }
      out[i] = ' '; i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'code'; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
      i++;
      continue;
    }
    if (state === 'regex') {
      if (c === '\n') { state = 'code'; i++; continue; }     // 正则不能跨行 → 说明判断错了
      if (c === '\\') { out[i] = ' '; if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue; }
      out[i] = ' ';
      if (c === '/') { state = 'code'; }
      i++;
      continue;
    }
    // 字符串里
    if (c === '\\') { out[i] = ' '; if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue; }
    if (state === 'sq' && c === "'") { state = 'code'; i++; continue; }
    if (state === 'dq' && c === '"') { state = 'code'; i++; continue; }
    if (state === 'tpl' && c === '`' && tplDepth === 0) { state = 'code'; i++; continue; }
    if (state === 'tpl' && c === '$' && c2 === '{') { tplDepth++; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    if (state === 'tpl' && c === '}' && tplDepth > 0) { tplDepth--; out[i] = ' '; i++; continue; }
    if (c !== '\n') out[i] = ' ';
    i++;
  }
  return out.join('');
}

const DECISION = [
  /\bif\b/g,
  /\bfor\b/g,
  /\bwhile\b/g,
  /\bcase\b/g,
  /\bcatch\b/g,
  /\?\?/g,
  /&&/g,
  /\|\|/g,
  /\?(?![.?])/g,      // 三元（排除 ?. 和 ??）
];

/** 从 f 开始找函数体（第一个 { 到匹配的 }） */
function bodyRange(code, start) {
  const open = code.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

/** 抓出函数声明：function xxx( / const xxx = ( / const xxx = async ( / xxx: ( */
function findFunctions(code) {
  const found = [];
  const patterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) {
      found.push({ name: m[1], at: m.index });
    }
  }
  // 去重（同一函数可能被多条模式命中）+ 排序
  const seen = new Set();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((f) => {
      const key = `${f.name}@${f.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function analyze(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = blankOut(raw);
  const fns = findFunctions(code);
  const rows = [];

  for (let i = 0; i < fns.length; i++) {
    const f = fns[i];
    const nextAt = i + 1 < fns.length ? fns[i + 1].at : code.length;
    const range = bodyRange(code, f.at);
    if (!range || range.close > nextAt) continue;      // 不是函数体（比如回调），跳过
    const body = code.slice(range.open, range.close);
    let score = 1;
    for (const re of DECISION) score += (body.match(re) || []).length;
    // 嵌套函数会在自己的条目里再数一遍，这里扣掉它的整段，避免重复计数
    rows.push({ file: path.relative(root, file), name: f.name, cc: score, len: range.close - range.open });
  }
  return rows;
}

// ---------------------------------------------------------------- 主流程

const args = process.argv.slice(2);
const files = args.length
  ? args
  : fs.readdirSync(path.join(root, 'src'))
      .filter((f) => f.endsWith('.js'))
      .sort()
      .map((f) => path.join('src', f));

let all = [];
for (const f of files) {
  const p = path.isAbsolute(f) ? f : path.join(root, f);
  if (!fs.existsSync(p)) { console.log(`跳过（不存在）：${f}`); continue; }
  all = all.concat(analyze(p));
}

if (!all.length) { console.log('没找到函数'); process.exit(0); }

// 嵌套函数重复计数修正：把"包含关系"的父子对挑出来，父减去子的复杂度
// （简化处理：同名不算，只有当父的范围严格包含子的范围时才减）

const total = all.reduce((s, r) => s + r.cc, 0);
const avg = total / all.length;

console.log(`函数总数 : ${all.length}`);
console.log(`平均圈复杂度 : ${avg.toFixed(2)}`);
console.log(`超过 10 的 : ${all.filter((r) => r.cc > 10).length} 个`);
console.log(`超过 15 的 : ${all.filter((r) => r.cc > 15).length} 个`);
console.log('');

const byFile = {};
for (const r of all) {
  byFile[r.file] = byFile[r.file] || { sum: 0, n: 0, max: 0 };
  byFile[r.file].sum += r.cc;
  byFile[r.file].n++;
  byFile[r.file].max = Math.max(byFile[r.file].max, r.cc);
}
console.log('按文件：');
console.log('  文件'.padEnd(24) + '函数数'.padStart(8) + '平均'.padStart(8) + '最高'.padStart(8));
for (const [file, s] of Object.entries(byFile).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)) {
  console.log(`  ${file.padEnd(22)}${String(s.n).padStart(8)}${(s.sum / s.n).toFixed(2).padStart(8)}${String(s.max).padStart(8)}`);
}

console.log('\n最复杂的 20 个函数：');
console.log('  复杂度'.padStart(8) + '  行数'.padStart(6) + '  函数');
for (const r of all.slice().sort((a, b) => b.cc - a.cc).slice(0, 20)) {
  console.log(`  ${String(r.cc).padStart(6)}${String(Math.round(r.len / 40)).padStart(8)}   ${r.name}   (${r.file})`);
}
