/**
 * 一键跑全套测试。
 *
 * 为什么要有它：以前每轮都是手敲一个 PowerShell 循环去遍历 test-*.mjs，
 * 容易漏（少写一个文件名就"全绿"了）。
 *
 * ⚠️ 这里**故意不在代码里写死清单**：磁盘上有哪些 test-*.mjs 就跑哪些。
 *    私有仓库那份是写死的（用来防漏），但那边有一行"没被列进来"的警告兜着；
 *    这份是给读代码的人看的，多一张要手工同步的表只会多一个出错的地方。
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

const FILES = fs.readdirSync(root)
  .filter((f) => /^test-.*\.mjs$/.test(f) && f !== 'test-all.mjs')
  .sort();

// 清单是扫出来的，所以理论上不会有"漏登记"——
// 留这一句只是为了哪天改成写死清单时还能提醒到人。
const gone = FILES.filter((f) => !fs.existsSync(path.join(root, f)));
if (gone.length) console.log(`警告：清单里的这些文件不存在：${gone.join(', ')}`);

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