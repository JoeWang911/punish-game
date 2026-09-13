/* 卡池体检 + 红线过滤不变式 + 极端设置下的稳定性 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const win = {};
win.window = win;              // cards.js 里写的是 window.XXX
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/cards.js'), 'utf8'), win);

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

const POOL = win.CARD_POOL, TAGS = win.TAGS.map(t => t.id), PROPS = win.PROPS;
const TYPES = ['truth', 'dare', 'punish', 'duo'];
const all = [];

console.log('\n── 卡池结构 ──');
let bad = [];
Object.keys(POOL).forEach(lvl => {
  TYPES.forEach(t => {
    if (!Array.isArray(POOL[lvl][t])) bad.push(lvl + '/' + t + ' 缺失');
    else POOL[lvl][t].forEach((c, i) => {
      const id = lvl + '/' + t + '[' + i + ']';
      if (c.t !== t) bad.push(id + ' 的 t 字段与所在分组不符（' + c.t + '）');
      if (typeof c.x !== 'string' || c.x.trim().length < 6) bad.push(id + ' 正文过短或非字符串');
      if (c.s != null && (typeof c.s !== 'number' || c.s <= 0)) bad.push(id + ' 的限时不是正数');
      (c.g || []).forEach(g => { if (TAGS.indexOf(g) < 0) bad.push(id + ' 用了未登记的标签 ' + g); });
      (c.p || []).forEach(p => { if (PROPS.indexOf(p) < 0) bad.push(id + ' 用了未登记的道具 ' + p); });
      all.push({ lvl: +lvl, t: t, x: c.x, s: c.s || 0, p: c.p || [], g: c.g || [], id: id });
    });
  });
});
check('所有卡片字段合法', bad.length === 0, bad.slice(0, 5).join(' ; '));
check('卡池总量 ≥ 150 张', all.length >= 150, '实际 ' + all.length);

console.log('\n── 各等级 / 各类型分布 ──');
Object.keys(POOL).forEach(lvl => {
  const n = all.filter(c => c.lvl === +lvl).length;
  const byType = TYPES.map(t => t + ':' + all.filter(c => c.lvl === +lvl && c.t === t).length).join('  ');
  console.log('   Lv' + lvl + '  共 ' + String(n).padStart(3) + ' 张   ' + byType);
  check('Lv' + lvl + ' 每种类型都够抽（≥4 张）', TYPES.every(t => all.filter(c => c.lvl === +lvl && c.t === t).length >= 4));
});

console.log('\n── 占位符与文案 ──');
const ph = all.filter(c => /\{(other|self)\}/.test(c.x));
check('有 ' + ph.length + ' 张卡带 {other}/{self} 占位符', ph.length >= 80, '实际 ' + ph.length);
check('没有写错的占位符（如 {othr}）', !all.some(c => /\{[a-z]+\}/.test(c.x.replace(/\{(other|self)\}/g, ''))));
check('没有空卡片 / 纯空格卡片', !all.some(c => !c.x.trim()));
const dupes = {};
all.forEach(c => { dupes[c.x] = (dupes[c.x] || 0) + 1; });
const dupList = Object.keys(dupes).filter(k => dupes[k] > 1);
check('没有重复文案（同文重复 ' + dupList.length + ' 处）', dupList.length === 0, dupList.slice(0, 2).join(' / '));
check('高级别卡够多（Lv3+Lv4）', all.filter(c => c.lvl >= 3).length >= 70, '实际 ' + all.filter(c => c.lvl >= 3).length);

console.log('\n── 特殊卡 ──');
const SP = win.SPECIAL;
check('反转卡 ≥3 张', SP.reverse.length >= 3, '实际 ' + SP.reverse.length);
check('幸运卡 ≥5 张', SP.lucky.length >= 5, '实际 ' + SP.lucky.length);
check('代价卡 ≥8 张', SP.cost.length >= 8, '实际 ' + SP.cost.length);
check('幸运卡 idx0/1/2 是真发卡（app.js 依赖这三个下标）', SP.lucky[0].x.includes('免罚卡') && SP.lucky[1].x.includes('反转卡') && SP.lucky[2].x.includes('免罚'));
check('代价卡都非空且带 t 字段', SP.cost.every(c => c.t === 'cost' && typeof c.x === 'string' && c.x.trim().length > 0));
check('代价卡没有重复文案', new Set(SP.cost.map(c => c.x)).size === SP.cost.length);
check('特殊卡标签也都在登记表里', [...SP.reverse, ...SP.lucky, ...SP.cost].every(c => (c.g || []).every(g => TAGS.indexOf(g) >= 0)));

console.log('\n── 红线过滤不变式（模拟 app.js 的 allowed()）──');
function allowed(c, blocked, maxLevel) {
  if (c.lvl > maxLevel) return false;
  return !c.g.some(g => blocked.indexOf(g) >= 0);
}
function drawType(list, type, blocked, maxLevel, forceTop, seen) {
  let l = list.filter(c => c.t === type && allowed(c, blocked, maxLevel));
  if (forceTop && l.length) {
    const top = Math.max(...l.map(c => c.lvl));
    l = l.filter(c => c.lvl === top);
  }
  if (!l.length) {
    l = list.filter(c => c.t === 'dare' && allowed(c, blocked, maxLevel));
    if (!l.length) l = list.filter(c => allowed(c, blocked, maxLevel));
    if (!l.length) l = list.filter(c => c.lvl <= maxLevel);
    if (!l.length) l = list.slice();
  }
  let fresh = l.filter(c => seen.indexOf(c.id) < 0);
  if (!fresh.length) fresh = l;
  return fresh[Math.floor(Math.random() * fresh.length)];
}

let violations = [];
for (let trial = 0; trial < 400; trial++) {
  const maxLevel = 1 + Math.floor(Math.random() * 4);
  // 随机关掉一半标签
  const blocked = TAGS.filter(() => Math.random() < 0.5);
  const seen = [];
  for (let k = 0; k < 25; k++) {
    const type = TYPES[Math.floor(Math.random() * 4)];
    const c = drawType(all, type, blocked, maxLevel, Math.random() < 0.2, seen);
    if (!c) { violations.push('抽到 undefined'); continue; }
    if (c.lvl > maxLevel) violations.push('超出等级上限 ' + c.lvl + '>' + maxLevel);
    if (c.g.some(g => blocked.indexOf(g) >= 0)) violations.push('抽到了被屏蔽的标签 ' + c.g);
    if (c.id) seen.push(c.id);
  }
}
check('400 轮 × 25 抽，从不越界、从不抽到被屏蔽的标签', violations.length === 0, violations.slice(0, 3).join(' ; '));

console.log('\n── 极端设置 ──');
let crash = null;
try {
  const allBlocked = TAGS.slice();
  for (let k = 0; k < 40; k++) {
    const c = drawType(all, TYPES[k % 4], allBlocked, 1, k % 5 === 0, []);
    if (!c || !c.x) throw new Error('全部标签屏蔽时抽到空卡');
  }
} catch (e) { crash = e.message; }
check('把 9 个标签全部屏蔽 + Lv1 也不会崩', crash === null, crash);

let crash2 = null;
try {
  for (const lv of [1, 2, 3, 4]) {
    for (const t of TYPES) {
      const c = drawType(all, t, [], lv, false, all.map(x => x.id)); // seen 塞满 → 触发洗牌
      if (!c) throw new Error('Lv' + lv + '/' + t + ' 抽到空卡');
    }
  }
} catch (e) { crash2 = e.message; }
check('牌抽光时会自动洗牌重来', crash2 === null, crash2);

console.log('\n── 老虎机数据（动作 × 部位）──');
const SLOT = win.SLOT;
check('SLOT 存在且有 act / part', !!SLOT && Array.isArray(SLOT.act) && Array.isArray(SLOT.part));
const slotBad = [];
['act', 'part'].forEach(k => {
  SLOT[k].forEach((it, i) => {
    if (typeof it.x !== 'string' || !it.x.trim()) slotBad.push(k + '[' + i + '] 文案为空');
    if (typeof it.lv !== 'number' || it.lv < 1 || it.lv > 4) slotBad.push(k + '[' + i + '] 等级非法: ' + it.lv);
    (it.g || []).forEach(g => { if (TAGS.indexOf(g) < 0) slotBad.push(k + '[' + i + '] 未登记标签 ' + g); });
  });
});
check('老虎机条目字段都合法', slotBad.length === 0, slotBad.slice(0, 3).join(' ; '));
check('动作无重复', new Set(SLOT.act.map(a => a.x)).size === SLOT.act.length);
check('部位无重复', new Set(SLOT.part.map(p => p.x)).size === SLOT.part.length);
[1, 2, 3, 4].forEach(lv => {
  const a = SLOT.act.filter(x => x.lv <= lv).length;
  const p = SLOT.part.filter(x => x.lv <= lv).length;
  check('Lv' + lv + ' 尺度下组合够多（' + a + '×' + p + '=' + a * p + '）', a * p >= 40);
});
check('Lv1 动作与部位都够多样', SLOT.act.filter(x => x.lv === 1).length >= 6 && SLOT.part.filter(x => x.lv === 1).length >= 6,
  'act ' + SLOT.act.filter(x => x.lv === 1).length + ' / part ' + SLOT.part.filter(x => x.lv === 1).length);
check('Lv1 不含露骨部位', !SLOT.part.some(p => p.lv === 1 && /大腿|胸口|臀|肚脐/.test(p.x)));

/* 权重分布：确定性地验，采样 2 万次，不受单次手气影响。
   app.js 用的就是同一个 window.slotWeight，改公式这里会挂。 */
console.log('\n── 转轮加权：越玩越热 ──');
const W = win.slotWeight;
check('slotWeight 存在且递增', typeof W === 'function' && W(1) < W(2) && W(2) < W(3) && W(3) < W(4),
  [1, 2, 3, 4].map(W).join(','));

function share(kind, maxLv, lv) {
  const list = SLOT[kind].filter(it => it.lv <= maxLv);
  const total = list.reduce((s, it) => s + W(it.lv), 0);
  const part = list.filter(it => it.lv === lv).reduce((s, it) => s + W(it.lv), 0);
  return part / total;
}
function uniformShare(kind, maxLv, lv) {
  const list = SLOT[kind].filter(it => it.lv <= maxLv);
  return list.filter(it => it.lv === lv).length / list.length;
}

[1, 2, 3, 4].forEach(maxLv => {
  const hi = share('act', maxLv, maxLv), lo = share('act', maxLv, 1);
  const hiU = uniformShare('act', maxLv, maxLv), loU = uniformShare('act', maxLv, 1);
  console.log('   Lv' + maxLv + '　最高档占比 ' + (hi * 100).toFixed(0) + '%'
    + '（不加权只有 ' + (hiU * 100).toFixed(0) + '%）　最低档 ' + (lo * 100).toFixed(0) + '%');
  if (maxLv === 1) {
    check('Lv1 只有一档，无所谓权重', true);
  } else {
    check('Lv' + maxLv + ' 最高档比最低档更容易抽到', hi > lo, (hi * 100).toFixed(0) + '% vs ' + (lo * 100).toFixed(0) + '%');
    check('Lv' + maxLv + ' 最高档占比高于均匀分布', hi > hiU + 0.05, (hi * 100).toFixed(0) + '% vs ' + (hiU * 100).toFixed(0) + '%');
  }
});

// 两个轮子同时抽到最高档的概率——这是"解锁了却抽不到"的关键指标
// 等级越高，加权带来的提升越大（Lv2 只有一级可升，提升自然小）
const MIN_BOOST = { 2: 1.8, 3: 3, 4: 5 };
[2, 3, 4].forEach(maxLv => {
  const both = share('act', maxLv, maxLv) * share('part', maxLv, maxLv);
  const bothU = uniformShare('act', maxLv, maxLv) * uniformShare('part', maxLv, maxLv);
  const boost = both / bothU;
  console.log('   Lv' + maxLv + '　两个轮子都到最高档：' + (both * 100).toFixed(1) + '%（不加权 ' + (bothU * 100).toFixed(1) + '%，提升 ' + boost.toFixed(1) + ' 倍）');
  check('Lv' + maxLv + ' 双最高档概率提升 ≥' + MIN_BOOST[maxLv] + ' 倍', boost >= MIN_BOOST[maxLv], '实测 ' + boost.toFixed(1) + ' 倍');
});

// 真按权重抽 2 万次，确认实际分布跟算出来的一致
let hit = 0, N = 20000;
const l3 = SLOT.act.filter(it => it.lv <= 3);
const tot = l3.reduce((s, it) => s + W(it.lv), 0);
for (let i = 0; i < N; i++) {
  let r = Math.random() * tot;
  for (const it of l3) { r -= W(it.lv); if (r <= 0) { if (it.lv === 3) hit++; break; } }
}
const measured = hit / N, expected = share('act', 3, 3);
check('实际抽样分布符合权重（差 < 3%）', Math.abs(measured - expected) < 0.03,
  '实测 ' + (measured * 100).toFixed(1) + '% vs 理论 ' + (expected * 100).toFixed(1) + '%');

console.log('\n── 尺寸与道具 ──');
check('道具清单 12 项且无重复', PROPS.length === 12 && new Set(PROPS).size === 12, '实际 ' + PROPS.length);
const propRefs = new Set(all.flatMap(c => c.p));
const orphan = [...propRefs].filter(p => PROPS.indexOf(p) < 0);
check('卡片引用的道具都在清单里', orphan.length === 0, orphan.join(' / '));
console.log('   用到的道具：' + [...propRefs].join('、'));

console.log('\n════════════════════════════');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('════════════════════════════');
process.exit(fail ? 1 : 0);
