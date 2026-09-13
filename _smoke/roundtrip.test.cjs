/* ============================================================
 *  往返一致性：cards.js → 题库.txt → cards.js 必须回到同一份数据
 *  ------------------------------------------------------------
 *  这是「改 txt 就能更新线上题目」这件事的前提。
 *  任何一边改了格式，这里会立刻红。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildTxt } = require('./export.cjs');
const imp = require('./import.cjs');

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

/* 只比较「数据」，不管文件里怎么排版和写注释 */
function norm(d) {
  const s = {
    TAGS: d.TAGS.map(t => ({ id: t.id, d: t.d, was: (t.was || []).slice() })),
    PROPS: d.PROPS.slice(),
    LEVELS: [1, 2, 3, 4].map(l => ({ l: l, n: d.LEVELS[l].n, d: d.LEVELS[l].d })),
    POOL: {},
    COST: d.SPECIAL.cost.map(c => ({ t: c.t, x: c.x, s: c.s || 0, p: (c.p || []).slice(), g: (c.g || []).slice() })),
    REV: d.SPECIAL.reverse.slice(),
    LUK: d.SPECIAL.lucky.slice(),
    ACT: d.SLOT.act.map(x => ({ x: x.x, lv: x.lv, g: (x.g || []).slice() })),
    PART: d.SLOT.part.map(x => ({ x: x.x, lv: x.lv, g: (x.g || []).slice() }))
  };
  [1, 2, 3, 4].forEach(lv => {
    s.POOL[lv] = {};
    ['truth', 'dare', 'punish', 'duo'].forEach(t => {
      s.POOL[lv][t] = d.CARD_POOL[lv][t].map(c => ({
        t: c.t, x: c.x, s: c.s || 0, d: c.d || '',
        p: (c.p || []).slice(), g: (c.g || []).slice()
      }));
    });
  });
  return JSON.stringify(s);
}

console.log('\n── 1 · 导出能生成文本 ──');
const txt = buildTxt();
check('导出非空（' + (txt.length / 1024).toFixed(1) + ' KB）', txt.length > 10000, txt.length + ' 字节');
check('带 BOM，Windows 记事本不会乱码', txt.charCodeAt(0) === 0xFEFF);

console.log('\n── 2 · 解析回来 ──');
const parsed = imp.parseTxt(txt);
const nd = parsed.data;
imp.remapSlotLevels(txt, nd);
check('没有认不出来的行', parsed.problems.length === 0, parsed.problems.slice(0, 3).join(' ; '));

const cur = imp.loadCurrent();
const totalOf = (d) => [1, 2, 3, 4].reduce((s, lv) =>
  s + ['truth', 'dare', 'punish', 'duo'].reduce((a, t) => a + d.CARD_POOL[lv][t].length, 0), 0);
check('题目数一致（' + totalOf(cur) + ' 张）', totalOf(cur) === totalOf(nd), totalOf(cur) + ' vs ' + totalOf(nd));
check('标签数一致（' + cur.TAGS.length + ' 个）', cur.TAGS.length === nd.TAGS.length);
check('道具数一致（' + cur.PROPS.length + ' 项）', cur.PROPS.length === nd.PROPS.length);
check('翻牌子动作数一致（' + cur.SLOT.act.length + '）', cur.SLOT.act.length === nd.SLOT.act.length);
check('翻牌子部位数一致（' + cur.SLOT.part.length + '）', cur.SLOT.part.length === nd.SLOT.part.length);
check('代价卡数一致（' + cur.SPECIAL.cost.length + '）', cur.SPECIAL.cost.length === nd.SPECIAL.cost.length);

console.log('\n── 3 · 数据完全一致（这条最要紧）──');
const identical = norm(cur) === norm(nd);
if (!identical) {
  // 找出到底哪里不一样，别只说一句「不一致」
  const A = norm(cur), B = norm(nd);
  check('往返后数据完全一致', false, '长度 ' + A.length + ' vs ' + B.length);
  const d = imp.diff(cur, nd);
  console.log('     新增 ' + d.added.length + ' / 删除 ' + d.removed.length + ' / 改动 ' + d.changed.length);
  d.changed.slice(0, 5).forEach(k => console.log('     ~ ' + k.slice(0, 60)));
} else {
  check('往返后数据完全一致（' + totalOf(cur) + ' 张题目逐字对比）', true);
}

console.log('\n── 4 · 差异统计应该是全零 ──');
const df = imp.diff(cur, nd);
check('新增 0 张', df.added.length === 0, df.added.slice(0, 3).join(' ; '));
check('删除 0 张', df.removed.length === 0, df.removed.slice(0, 3).join(' ; '));
check('改动 0 张', df.changed.length === 0, df.changed.slice(0, 3).join(' ; '));

console.log('\n── 5 · 解析结果能通过校验 ──');
const v = imp.validate(nd);
check('校验无错误', v.errs.length === 0, v.errs.slice(0, 4).join(' ; '));
check('校验无警告', v.warns.length === 0, v.warns.slice(0, 4).join(' ; '));

console.log('\n── 6 · 生成的 cards.js 能跑，而且数据还是同一份 ──');
const code = imp.generate(nd);
const w = {};
w.window = w;
vm.createContext(w);
let loadErr = null;
try { vm.runInContext(code, w); } catch (e) { loadErr = e.message + ' @ ' + String(e.stack).split('\n')[1]; }
check('生成的代码语法正确、能执行', loadErr === null, loadErr);
if (!loadErr) {
  const back = { TAGS: w.TAGS, PROPS: w.PROPS, LEVELS: w.LEVELS, CARD_POOL: w.CARD_POOL, SPECIAL: w.SPECIAL, SLOT: w.SLOT };
  check('生成的文件再读回来，数据仍然一致', norm(back) === norm(nd));
  check('生成的代码里没有 undefined / NaN', !/undefined|NaN/.test(code), (code.match(/undefined|NaN/) || [''])[0]);
  const mini = /t: 'truth'[\s\S]*?x: '/
  check('生成的文件里每张卡都有类型和正文', !/t: '[a-z]+', x: ''/.test(code));
}

console.log('\n── 7 · 二次往返（导出→导入→再导出）稳定 ──');
const txt2 = buildTxt(nd);
check('二次导出的文本和第一次一致', txt === txt2,
  txt === txt2 ? '' : '长度 ' + txt.length + ' vs ' + txt2.length);
const parsed2 = imp.parseTxt(txt2);
imp.remapSlotLevels(txt2, parsed2.data);
check('二次解析仍然一致', norm(parsed2.data) === norm(nd));

console.log('\n════════════════════════');
console.log('  通过 ' + pass + '，失败 ' + fail);
console.log('════════════════════════');
process.exit(fail ? 1 : 0);
