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
      all.push({ lvl: +lvl, t: t, x: c.x, s: c.s || 0, p: c.p || [], g: c.g || [], id: id, d: c.d || '' });
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

console.log('\n── 特殊（反转 / 幸运现在是文案池，不是卡）──');
const SP = win.SPECIAL;
check('反转文案池是字符串数组', Array.isArray(SP.reverse) && SP.reverse.every(x => typeof x === 'string' && x.length > 4));
check('幸运文案池是字符串数组', Array.isArray(SP.lucky) && SP.lucky.every(x => typeof x === 'string' && x.length > 4));
check('反转文案 ≥3 条', SP.reverse.length >= 3, '实际 ' + SP.reverse.length);
check('幸运文案 ≥4 条', SP.lucky.length >= 4, '实际 ' + SP.lucky.length);
check('反转文案都用到了 {other}', SP.reverse.every(x => x.includes('{other}')));
check('代价卡 ≥8 张', SP.cost.length >= 8, '实际 ' + SP.cost.length);
check('代价卡都是卡对象', SP.cost.every(c => c.t === 'cost' && typeof c.x === 'string' && c.x.trim().length > 0));
check('代价卡没有重复文案', new Set(SP.cost.map(c => c.x)).size === SP.cost.length);
check('代价卡标签都在登记表里', SP.cost.every(c => (c.g || []).every(g => TAGS.indexOf(g) >= 0)));
check('代价卡不再出现「没有拒绝权」这种硬表述', !SP.cost.some(c => /没有拒绝权/.test(c.x)));

console.log('\n── 红线过滤不变式（模拟 app.js 的 allowed()）──');
function allowed(c, blocked, maxLevel) {
  if (c.lvl !== maxLevel) return false;   // 严格等级：选了 Lv4 就只出 Lv4
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
    if (!l.length) l = list.filter(c => c.lvl === maxLevel);
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
    if (c.lvl !== maxLevel) violations.push('等级不对 ' + c.lvl + ' != ' + maxLevel);
    if (c.g.some(g => blocked.indexOf(g) >= 0)) violations.push('抽到了被屏蔽的标签 ' + c.g);
    if (c.id) seen.push(c.id);
  }
}
check('400 轮 × 25 抽，题目永远是当前等级、从不抽到被屏蔽的标签', violations.length === 0, violations.slice(0, 3).join(' ; '));

console.log('\n── 极端设置 ──');
let crash = null;
try {
  const allBlocked = TAGS.slice();
  for (let k = 0; k < 40; k++) {
    const c = drawType(all, TYPES[k % 4], allBlocked, 1, k % 5 === 0, []);
    if (!c || !c.x) throw new Error('全部标签屏蔽时抽到空卡');
  }
} catch (e) { crash = e.message; }
check('把 11 个标签全部屏蔽 + Lv1 也不会崩', crash === null, crash);

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
  const a = SLOT.act.filter(x => x.lv === lv).length;
  const p = SLOT.part.filter(x => x.lv === lv).length;
  check('Lv' + lv + ' 本档组合够多（' + a + '×' + p + '=' + a * p + '）', a * p >= 64);
});
check('Lv1 动作与部位都够多样', SLOT.act.filter(x => x.lv === 1).length >= 6 && SLOT.part.filter(x => x.lv === 1).length >= 6,
  'act ' + SLOT.act.filter(x => x.lv === 1).length + ' / part ' + SLOT.part.filter(x => x.lv === 1).length);
check('Lv1 不含露骨部位', !SLOT.part.some(p => p.lv === 1 && /大腿|胸口|臀|肚脐/.test(p.x)));

/* 严格等级之后，同一档内权重相同；这里验的是每档词量够不够、组合够不够翻。
   真正要防的回归是：有人把等级过滤改回 <= ，Lv1 的词会渗进 Lv4。 */
console.log('\n── 翻牌子：严格按等级 ──');
const W = win.slotWeight;
check('slotWeight 存在且递增', typeof W === 'function' && W(1) < W(2) && W(2) < W(3) && W(3) < W(4),
  [1, 2, 3, 4].map(W).join(','));

[1, 2, 3, 4].forEach(lv => {
  const a = SLOT.act.filter(x => x.lv === lv).length;
  const p = SLOT.part.filter(x => x.lv === lv).length;
  console.log('   Lv' + lv + '　' + a + ' 动作 × ' + p + ' 部位 = ' + (a * p) + ' 种组合');
  check('Lv' + lv + ' 动作和部位都 ≥8 个', a >= 8 && p >= 8, a + ' / ' + p);
  check('Lv' + lv + ' 组合数 ≥64，不容易重复', a * p >= 64, (a * p) + ' 种');
});

// 模拟 app.js 的 slotList：严格只取本档
function slotPick(lv, kind, blocked) {
  let list = SLOT[kind].filter(it => it.lv === lv && !(it.g || []).some(g => blocked.indexOf(g) >= 0));
  if (!list.length) list = SLOT[kind].filter(it => it.lv === lv);
  if (!list.length) list = SLOT[kind].filter(it => it.lv <= lv);
  return list[Math.floor(Math.random() * list.length)];
}
let slotBad2 = [];
for (let lv = 1; lv <= 4; lv++) {
  for (let i = 0; i < 300; i++) {
    const a = slotPick(lv, 'act', []), p = slotPick(lv, 'part', []);
    if (!a || !p) { slotBad2.push('Lv' + lv + ' 抽到 undefined'); continue; }
    if (a.lv !== lv) slotBad2.push('Lv' + lv + ' 抽到 Lv' + a.lv + ' 的动作 ' + a.x);
    if (p.lv !== lv) slotBad2.push('Lv' + lv + ' 抽到 Lv' + p.lv + ' 的部位 ' + p.x);
  }
}
check('4 档 × 300 次，从不出别档的词', slotBad2.length === 0, slotBad2.slice(0, 3).join(' ; '));

// 红线标签仍然生效
let slotBad3 = [];
for (let i = 0; i < 200; i++) {
  const a = slotPick(4, 'act', ['留痕']);
  if ((a.g || []).indexOf('留痕') >= 0) slotBad3.push('关掉痕迹后仍抽到 ' + a.x);
}
check('关掉「留痕」后 Lv4 不再出留印类的词', slotBad3.length === 0, slotBad3.slice(0, 3).join(' ; '));

console.log('\n── 掷骰 / 抛硬币的卡 ──');
const rollCards = all.filter(c => c.d);
check('有需要现场掷一次的卡（' + rollCards.length + ' 张）', rollCards.length >= 4, '实际 ' + rollCards.length);
check('掷的类型只有 dice / coin',
  rollCards.every(c => c.d === 'dice' || c.d === 'coin'),
  [...new Set(rollCards.map(c => c.d))].join(','));
check('掷骰的卡都在 Lv2 以上', rollCards.every(c => c.lvl >= 2),
  rollCards.filter(c => c.lvl < 2).map(c => c.x).join(' ; '));
rollCards.forEach(c => console.log('   Lv' + c.lvl + ' [' + c.d + '] ' + c.x.slice(0, 30)));

console.log('\n── 等级 / 标签边界 ──');
// 这是这条规则的可执行版本：每个标签最早能从哪一档出现。
// 用户报过「选了 Lv4 会出其他等级的题」，这条就是防它回来的。
const TAG_MIN_LEVEL = {
  '留痕': 1,
  '敏感部位': 2, '绑束': 2, '蒙眼': 2, '听指令': 2, '道具': 2, '影像': 2, '被听见': 2,
  '裸露': 3, '疼痛': 3,
  '性行为': 4, '用嘴': 4
};
check('边界表覆盖了全部标签', TAGS.every(id => TAG_MIN_LEVEL[id] !== undefined),
  TAGS.filter(id => TAG_MIN_LEVEL[id] === undefined).join(','));

const crosses = [];
all.forEach(c => (c.g || []).forEach(g => {
  if (TAG_MIN_LEVEL[g] !== undefined && c.lvl < TAG_MIN_LEVEL[g]) {
    crosses.push('Lv' + c.lvl + ' 出了「' + g + '」: ' + c.x.slice(0, 20));
  }
}));
SLOT.act.concat(SLOT.part).forEach(it => (it.g || []).forEach(g => {
  if (TAG_MIN_LEVEL[g] !== undefined && it.lv < TAG_MIN_LEVEL[g]) {
    crosses.push('翻牌子 Lv' + it.lv + ' 出了「' + g + '」: ' + it.x);
  }
}));
check('卡池没有跨等级内容（Lv2 不脱衣、Lv3 不做爱，以此类推）',
  crosses.length === 0, crosses.slice(0, 4).join(' ; '));

// 逐档点名确认
const tagAt = (lv) => {
  const set = new Set();
  all.filter(c => c.lvl === lv).forEach(c => (c.g || []).forEach(g => set.add(g)));
  return set;
};
const l1 = tagAt(1);
check('Lv1 只有留痕（纯聊天拥抱）', [...l1].every(g => g === '留痕'), [...l1].join(','));
check('Lv2 完全没有裸露', !tagAt(2).has('裸露'), '');
check('Lv2 完全没有性行为 / 用嘴', !tagAt(2).has('性行为') && !tagAt(2).has('用嘴'), '');
check('Lv3 完全没有性行为 / 用嘴', !tagAt(3).has('性行为') && !tagAt(3).has('用嘴'), '');
check('Lv4 有性行为，也单独有「用嘴」', tagAt(4).has('性行为') && tagAt(4).has('用嘴'), [...tagAt(4)].join(','));
check('Lv4 有疼痛（微暴力）', tagAt(4).has('疼痛'));

console.log('\n── 红线标签体系 ──');
const ids = TAGS.slice();
check('12 个标签（双数，界面两列刚好）', ids.length === 12 && ids.length % 2 === 0, '实际 ' + ids.length);
check('每个标签都有说明', win.TAGS.every(t => t.d && t.d.length > 4));
check('标签 id 不重复', new Set(ids).size === ids.length);
check('标签说明不重复', new Set(win.TAGS.map(t => t.d)).size === ids.length);

// 每个标签都得真的挂到东西上，否则就是死标签
const usedInPool = {};
ids.forEach(id => { usedInPool[id] = 0; });
all.forEach(c => (c.g || []).forEach(g => { if (usedInPool[g] !== undefined) usedInPool[g]++; }));
SLOT.act.concat(SLOT.part).forEach(it => (it.g || []).forEach(g => { if (usedInPool[g] !== undefined) usedInPool[g]++; }));
SP.cost.forEach(c => (c.g || []).forEach(g => { if (usedInPool[g] !== undefined) usedInPool[g]++; }));
const dead = ids.filter(id => usedInPool[id] === 0);
check('没有空标签（每个至少挂到 1 处）', dead.length === 0, '空的: ' + dead.join(', '));
const thin = ids.filter(id => usedInPool[id] < 3);
check('没有过薄的标签（每个至少 3 处，实际最薄 ' + Math.min.apply(null, ids.map(i => usedInPool[i])) + '）',
  thin.length === 0, '过薄: ' + thin.join(', '));
ids.forEach(id => console.log('   ' + id.padEnd(6) + String(usedInPool[id]).padStart(3) + ' 处'));

// 迁移用的旧名字不能和现用 id 撞
const cur = new Set(ids);
const clash = [];
win.TAGS.forEach(t => (t.was || []).forEach(old => { if (cur.has(old)) clash.push(old); }));
check('旧标签名不会和现用名冲突', clash.length === 0, clash.join('; '));
const wasAll = win.TAGS.flatMap(t => t.was || []);
check('旧标签名不重复', new Set(wasAll).size === wasAll.length, wasAll.join(','));
check('每个改名过的标签都留了 was', wasAll.length >= 8, '实际 ' + wasAll.length);

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
