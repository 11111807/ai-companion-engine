/**
 * 一键跑全套测试。
 *
 * 为什么要有这份清单：以前每轮都是手敲一个 PowerShell 循环去遍历 test-*.mjs，
 * 容易漏（少写一个文件名就"全绿"了）。这里把清单固定下来，谁也漏不掉。
 *
 * 这里测的都是**源码**。私有构建流程里还有一份产物自检
 *（把构建产物和源码逐字节比对，再用产物里的代码真跑一遍），
 * 那部分依赖构建产物目录，不在这份参考实现里。
 *
 * 用法：
 *   node test-all.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const FILES = [
  'test-app.mjs',
  'test-persona.mjs',
  'test-profession.mjs',
  'test-friends.mjs',
  'test-mood.mjs',
  'test-modules.mjs',
  'test-time.mjs',
  'test-memory.mjs',
  'test-native.mjs',
  'test-recall.mjs',
  'test-habits.mjs',
  'test-curve.mjs',
  'test-ui.mjs',
];

// 写死清单的同时校验一遍，防止以后新增了测试文件却忘了加进来
const onDisk = fs.readdirSync(root).filter((f) => /^test-.*\.mjs$/.test(f) && f !== 'test-all.mjs');
const missing = onDisk.filter((f) => !FILES.includes(f));
if (missing.length) {
  console.log(`警告：这些测试文件没被列进来：${missing.join(', ')}`);
  FILES.push(...missing);
}

let totalPass = 0;
let totalFail = 0;
const failed = [];

const run = (file) => {
  let out = '';
  let timedOut = false;
  try {
    out = execFileSync(process.execPath, [file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 240000,          // 别让某个测试挂住把整套拖死
    });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    if (e.killed || e.signal || /ETIMEDOUT/.test(String(e.code))) timedOut = true;
  }
  const m = out.match(/(\d+)\s*项通过,\s*(\d+)\s*项失败/);
  if (timedOut && !m) {
    failed.push(file);
    console.log(`  ?? ${file.padEnd(20)} 超时被杀（4 分钟没跑完）`);
    return;
  }
  if (!m) {
    failed.push(file);
    console.log(`  ?  ${file.padEnd(20)} 没跑到结果`);
    const tail = out.trim().split('\n').slice(-3).join(' | ');
    if (tail) console.log(`       ${tail}`);
    return;
  }
  const pass = Number(m[1]);
  const fail = Number(m[2]);
  totalPass += pass;
  totalFail += fail;
  if (fail) {
    failed.push(file);
    console.log(`  XX ${file.padEnd(20)} ${pass} / ${fail}`);
    for (const line of out.split('\n')) if (line.includes('❌')) console.log(`       ${line.trim()}`);
  } else {
    console.log(`  OK ${file.padEnd(20)} ${pass}`);
  }
};

console.log('=== 跑全部测试 ===\n');
for (const f of FILES) run(f);

console.log(`\n=== 合计 ${totalPass} 项通过, ${totalFail} 项失败 ===`);
if (failed.length) console.log(`失败：${failed.join(', ')}`);
process.exit(totalFail ? 1 : 0);