/* ============================================================
 *  从 题库.txt 反向生成 js/cards.js
 *  ------------------------------------------------------------
 *  用法：
 *    node _smoke/import.cjs            先diff，确认没问题再写
 *    node _smoke/import.cjs --write    真的写入
 *
 *  设计原则：
 *    1. 先解析、先校验、先报差异，最后才动文件。默认不写。
 *    2. 校验不过就拒绝写入，绝不产出一个坏掉的 cards.js。
 *    3. 导出 → 导入 必须回到同一份数据（有测试盯着）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TXT = path.join(ROOT, '题库.txt');
const WRITE = process.argv.indexOf('--write') >= 0;
// --out=xxx 可以写到别的地方（用来预览生成结果，不动真的 cards.js）
const outArg = process.argv.filter(a => a.indexOf('--out=') === 0)[0];
const REAL = path.join(ROOT, 'js', 'cards.js');       // 正式的 cards.js
const OUT = outArg ? path.resolve(ROOT, outArg.slice(6)) : REAL;

const TYPE_BY_NAME = { '真心话': 'truth', '大冒险': 'dare', '惩罚': 'punish', '一起做': 'duo' };
const TYPE_ORDER = ['truth', 'dare', 'punish', 'duo'];
const TYPE_NAME = { truth: '真心话', dare: '大冒险', punish: '惩罚', duo: '一起做' };

/* ── 载入当前 cards.js，用来做差异对比（永远读正式那份） ── */
function loadCurrent() {
  const w = {};
  w.window = w;
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(REAL, 'utf8'), w);
  return { TAGS: w.TAGS, PROPS: w.PROPS, LEVELS: w.LEVELS, CARD_POOL: w.CARD_POOL, SPECIAL: w.SPECIAL, SLOT: w.SLOT };
}

/* ============================================================
 *  解析 题库.txt
 * ============================================================ */
function parseTxt(text) {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  const out = {
    TAGS: [], PROPS: [], LEVELS: {}, CARD_POOL: { 1: {}, 2: {}, 3: {}, 4: {} },
    SPECIAL: { reverse: [], lucky: [], cost: [] }, SLOT: { act: [], part: [] }
  };
  TYPE_ORDER.forEach(t => [1, 2, 3, 4].forEach(lv => { out.CARD_POOL[lv][t] = []; }));

  let lv = 0, type = null, zone = 'head', sub = '';
  let lastCard = null;      // 指向最近一张卡，用来挂 [..] 元数据
  const problems = [];

  const CTX = { '正文': 'pool', '翻牌子': 'slot', '特殊': 'special', '道具': 'props', '标签': 'tags' };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (!t) continue;
    if (/^[═─]+$/.test(t)) continue;

    /* ── 大区块标题 ── */
    if (/^Lv(\d) ·/.test(t) && zone === 'slot') { lv = +t.match(/^Lv(\d)/)[1]; sub = ''; continue; }
    if (t.indexOf('翻 牌 子') >= 0) { zone = 'slot'; continue; }
    if (t.indexOf('特 殊') >= 0) { zone = 'special'; continue; }
    if (t.indexOf('道 具 清 单') >= 0) { zone = 'props'; continue; }
    if (t.indexOf('红 线 标 签') >= 0) { zone = 'tags'; continue; }
    if (t.indexOf('基 本 边 界') >= 0 || t.indexOf('等 级 边 界') >= 0) { zone = 'bounds'; continue; }
    if (/^Lv(\d) ·/.test(t) && zone !== 'slot') {
      lv = +t.match(/^Lv(\d)/)[1];
      const m = t.match(/^Lv\d · (\S+?)　+(.*)$/);
      if (m) out.LEVELS[lv] = { n: m[1], d: m[2] };
      zone = 'pool'; type = null; continue;
    }
    if (/^Lv1 暖场/.test(t) && zone === 'head') continue;

    /* ── 区块内 ── */
    if (zone === 'bounds') continue;

    if (zone === 'head') continue;

    if (zone === 'tags') {
      const m = t.match(/^(\d+)\.\s+(\S+)\s+(.+)$/);
      if (m) {
        let desc = m[3];
        const was = [];
        const w = desc.match(/（旧名：(.+?)）\s*$/);
        if (w) { w[1].split('、').forEach(x => was.push(x)); desc = desc.replace(/（旧名：.+?）\s*$/, ''); }
        out.TAGS.push({ id: m[2], d: desc.trim(), was: was });
        continue;
      }
      continue;                                  // 「出现 N 处」那行忽略
    }

    if (zone === 'props') {
      if (t.indexOf('·') >= 0) {
        t.split('·').forEach(x => { x = x.trim(); if (x) out.PROPS.push(x); });
        continue;
      }
      continue;
    }

    if (zone === 'special') {
      if (t.indexOf('【反转】') >= 0) { sub = 'reverse'; lastCard = null; continue; }
      if (t.indexOf('【幸运】') >= 0) { sub = 'lucky'; lastCard = null; continue; }
      if (t.indexOf('【认输代价】') >= 0) { sub = 'cost'; lastCard = null; continue; }
      if (/^·\s+/.test(t) && sub) { out.SPECIAL[sub].push(t.replace(/^·\s+/, '')); continue; }
      const m = t.match(/^(\d+)\.\s+(.+)$/);
      if (m && sub === 'cost') {
        lastCard = { t: 'cost', x: m[2] };
        out.SPECIAL.cost.push(lastCard);
        continue;
      }
      applyMeta(t, lastCard);
      continue;
    }

    if (zone === 'slot') {
      const a = t.match(/^动作：(.*)$/);
      const p = t.match(/^部位：(.*)$/);
      if (a) { parseSlotList(a[1]).forEach(x => out.SLOT.act.push(x)); continue; }
      if (p) { parseSlotList(p[1]).forEach(x => out.SLOT.part.push(x)); continue; }
      continue;
    }

    /* ── 正题库 ── */
    const sec = t.match(/^──\s*(真心话|大冒险|惩罚|一起做)（(\d+)）/);
    if (sec) { type = TYPE_BY_NAME[sec[1]]; lastCard = null; continue; }

    if (type && lv) {
      const m = t.match(/^(\d+)\.\s+(.+)$/);
      if (m) {
        const card = { t: type, x: m[2] };
        out.CARD_POOL[lv][type].push(card);
        lastCard = card;
        continue;
      }
      if (applyMeta(t, lastCard)) continue;
      if (problems.length < 8) problems.push('Lv' + lv + ' 里认不出这一行：' + t.slice(0, 40));
    }
  }

  /* 补齐没写到的等级名 */
  [1, 2, 3, 4].forEach(l => { if (!out.LEVELS[l]) out.LEVELS[l] = { n: 'Lv' + l, d: '' }; });
  return { data: out, problems: problems };
}

function applyMeta(t, card) {
  if (!card) return false;
  if (!/^\[.*\]/.test(t)) return false;
  const chunks = t.match(/\[[^\]]*\]/g) || [];
  chunks.forEach(c => {
    const body = c.slice(1, -1);
    let m;
    if ((m = body.match(/^限时\s+(\d+)\s*秒$/))) card.s = +m[1];
    else if ((m = body.match(/^道具：(.+)$/))) card.p = m[1].split('、').map(x => x.trim()).filter(Boolean);
    else if ((m = body.match(/^标签：(.+)$/))) card.g = m[1].split('、').map(x => x.trim()).filter(Boolean);
    else if (body.indexOf('骰子') >= 0) card.d = 'dice';
    else if (body.indexOf('硬币') >= 0) card.d = 'coin';
  });
  return true;
}

function parseSlotList(s) {
  return s.split('　').map(x => x.trim()).filter(Boolean).map(chunk => {
    const m = chunk.match(/^(.+?)\((.+)\)$/);
    if (m) return { x: m[1], g: m[2].split('/') };
    return { x: chunk };
  });
}

/* ============================================================
 *  生成 js/cards.js
 * ============================================================ */
function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

function genCard(c, indent) {
  const parts = ['t: ' + q(c.t), 'x: ' + q(c.x)];
  if (c.s) parts.push('s: ' + c.s);
  if (c.d) parts.push('d: ' + q(c.d));
  if (c.p && c.p.length) parts.push('p: [' + c.p.map(q).join(', ') + ']');
  if (c.g && c.g.length) parts.push('g: [' + c.g.map(q).join(', ') + ']');
  return indent + '{ ' + parts.join(', ') + ' }';
}

function generate(d) {
  const L = [];
  const P = (s) => L.push(s === undefined ? '' : s);

  P('/* ============================================================');
  P(' *  卡池');
  P(' *  ------------------------------------------------------------');
  P(' *  这份文件由 _smoke/import.cjs 从 题库.txt 生成。');
  P(' *  想改内容：改 题库.txt，然后跑');
  P(' *      node _smoke/import.cjs --write');
  P(' *  也可以直接改这里，但下次从 txt 导入会覆盖。');
  P(' *');
  P(' *  写法约定（重要）：');
  P(' *    你      = 抽到这张卡的人');
  P(' *    {other} = 另一个人（会自动换成对方的名字）');
  P(' *    别用「我」指人，会搞混。');
  P(' *');
  P(' *  字段：');
  P(' *    t  类型 truth / dare / punish / duo');
  P(' *    x  正文');
  P(' *    s  限时秒数（可选，填了自动弹倒计时）');
  P(' *    p  需要的道具（可选）');
  P(' *    g  标签（可选，会被「红线」过滤）');
  P(' *    d  需要现场掷一次（可选）：\'dice\' 两颗骰子 / \'coin\' 三枚硬币');
  P(' *');
  P(' *  ── 等级边界（每张卡必须守得住自己那一档）──');
  P(' *    Lv1 暖场  只聊天、握手、拥抱。不碰敏感部位。');
  P(' *    Lv2 暧昧  亲亲抱抱摸，隔着衣服。衣服全程不脱。');
  P(' *    Lv3 灼热  开始脱，露出皮肤，碰敏感部位，会出声。');
  P(' *    Lv4 失控  Lv4 没有尺度限制。');
  P(' * ============================================================ */');
  P('');
  P('window.TAGS = [');
  d.TAGS.forEach((t, i) => {
    let s = '  { id: ' + q(t.id) + ', d: ' + q(t.d);
    if (t.was && t.was.length) s += ', was: [' + t.was.map(q).join(', ') + ']';
    s += ' }' + (i < d.TAGS.length - 1 ? ',' : '');
    P(s);
  });
  P('];');
  P('');
  P('window.PROPS = [');
  P('  ' + d.PROPS.map(q).join(', '));
  P('];');
  P('');
  P('window.LEVELS = {');
  [1, 2, 3, 4].forEach((l, i) => {
    const L2 = d.LEVELS[l];
    P('  ' + l + ': { n: ' + q(L2.n) + ", i: '" + (L2.i || ['', '🌤', '🔥', '💋', '🌋'][l]) + "', d: " + q(L2.d) + ' }' + (i < 3 ? ',' : ''));
  });
  P('};');
  P('');
  P('window.CARD_POOL = {');
  [1, 2, 3, 4].forEach((l, li) => {
    const total = TYPE_ORDER.reduce((s, t) => s + d.CARD_POOL[l][t].length, 0);
    P('  /* ══════════════════ Lv' + l + ' · ' + d.LEVELS[l].n + ' · ' + total + ' 张 ══════════════════ */');
    P('  ' + l + ': {');
    TYPE_ORDER.forEach((t, ti) => {
      P('    ' + t + ': [');
      d.CARD_POOL[l][t].forEach((c, ci) => {
        P(genCard(c, '      ') + (ci < d.CARD_POOL[l][t].length - 1 ? ',' : ''));
      });
      P('    ]' + (ti < TYPE_ORDER.length - 1 ? ',' : ''));
    });
    P('  }' + (li < 3 ? ',' : ''));
  });
  P('};');
  P('');
  P('/* ══════════ 特殊 ══════════');
  P(' *  反转和幸运不是「卡」，是转盘之外各 4% 的截胡。');
  P(' *  下面两组只是随机挑一句的文案池。');
  P(' */');
  P('window.SPECIAL = {');
  P('  reverse: [');
  d.SPECIAL.reverse.forEach((x, i) => P('    ' + q(x) + (i < d.SPECIAL.reverse.length - 1 ? ',' : '')));
  P('  ],');
  P('  lucky: [');
  d.SPECIAL.lucky.forEach((x, i) => P('    ' + q(x) + (i < d.SPECIAL.lucky.length - 1 ? ',' : '')));
  P('  ],');
  P('  cost: [');
  d.SPECIAL.cost.forEach((c, i) => P(genCard(c, '    ') + (i < d.SPECIAL.cost.length - 1 ? ',' : '')));
  P('  ]');
  P('};');
  P('');
  P('/* ══════════ 翻牌子：动作 × 部位 ══════════');
  P(' *  严格按等级取词：选了 Lv4 就只出 Lv4 的词。');
  P(' */');
  P('');
  P('window.slotWeight = function (lv) { return Math.pow(2, lv - 1); };');
  P('');
  P('window.SLOT = {');
  ['act', 'part'].forEach((k, ki) => {
    P('  ' + k + ': [');
    [1, 2, 3, 4].forEach(l => {
      const list = d.SLOT[k].filter(x => (x.lv || 0) === l);
      if (!list.length) return;
      P('    /* Lv' + l + ' · ' + list.length + ' 个 */');
      list.forEach(x => {
        const parts = ['x: ' + q(x.x), 'lv: ' + (x.lv || l)];
        if (x.g && x.g.length) parts.push('g: [' + x.g.map(q).join(', ') + ']');
        P('    { ' + parts.join(', ') + ' },');
      });
    });
    if (P.length) { /* noop */ }
    P('  ]' + (ki === 0 ? ',' : ''));
  });
  P('};');
  P('');
  return L.join('\n');
}

/* ============================================================
 *  校验
 * ============================================================ */
const MIN_LV = {
  '留痕': 1, '敏感部位': 2, '绑束': 2, '蒙眼': 2, '听指令': 2, '道具': 2, '影像': 2, '被听见': 2,
  '裸露': 3, '疼痛': 3, '性行为': 4, '用嘴': 4
};

function validate(d) {
  const errs = [], warns = [];
  const ids = d.TAGS.map(t => t.id);
  if (ids.length % 2 !== 0) errs.push('标签数必须是双数，现在是 ' + ids.length);
  if (new Set(ids).size !== ids.length) errs.push('标签 id 有重复');
  if (!d.TAGS.length) errs.push('一个标签都没解析到');

  const idSet = new Set(ids);
  [1, 2, 3, 4].forEach(lv => TYPE_ORDER.forEach(t => d.CARD_POOL[lv][t].forEach(c => {
    if (c.t !== t) errs.push('Lv' + lv + '/' + t + ' 的类型字段不对');
    if (!c.x || !c.x.trim()) errs.push('Lv' + lv + '/' + t + ' 有空卡');
    (c.g || []).forEach(g => { if (!idSet.has(g)) errs.push('未登记的标签「' + g + '」在 ' + c.x.slice(0, 16)); });
    (c.p || []).forEach(p => { if (d.PROPS.indexOf(p) < 0) errs.push('未登记的道具「' + p + '」在 ' + c.x.slice(0, 16)); });
    (c.g || []).forEach(g => {
      if (MIN_LV[g] !== undefined && lv < MIN_LV[g]) errs.push('Lv' + lv + ' 出了「' + g + '」：' + c.x.slice(0, 18));
    });
  })));
  ['act', 'part'].forEach(k => d.SLOT[k].forEach(it => {
    if (!it.lv) errs.push('翻牌子「' + it.x + '」没有等级');
    (it.g || []).forEach(g => { if (!idSet.has(g)) errs.push('翻牌子未登记标签「' + g + '」'); });
    (it.g || []).forEach(g => { if (MIN_LV[g] !== undefined && it.lv < MIN_LV[g]) errs.push('翻牌子 Lv' + it.lv + ' 出「' + g + '」'); });
  }));
  d.SPECIAL.cost.forEach(c => (c.g || []).forEach(g => { if (!idSet.has(g)) errs.push('代价卡未登记标签「' + g + '」'); }));

  [1, 2, 3, 4].forEach(lv => {
    const n = TYPE_ORDER.reduce((s, t) => s + d.CARD_POOL[lv][t].length, 0);
    if (n < 20) errs.push('Lv' + lv + ' 只解析出 ' + n + ' 张，太少，八成是格式被改坏了');
    TYPE_ORDER.forEach(t => {
      if (d.CARD_POOL[lv][t].length < 4) warns.push('Lv' + lv + ' 的' + TYPE_NAME[t] + '只剩 ' + d.CARD_POOL[lv][t].length + ' 张');
    });
  });
  if (!d.SPECIAL.reverse.length) errs.push('反转文案池是空的');
  if (!d.SPECIAL.lucky.length) errs.push('幸运文案池是空的');
  if (!d.SPECIAL.cost.length) errs.push('代价卡是空的');
  return { errs, warns };
}

/* ============================================================
 *  差异
 * ============================================================ */
function flatten(d) {
  const m = new Map();
  [1, 2, 3, 4].forEach(lv => TYPE_ORDER.forEach(t => d.CARD_POOL[lv][t].forEach(c => {
    m.set('Lv' + lv + '/' + t + '/' + c.x, JSON.stringify(c));
  })));
  d.SPECIAL.cost.forEach(c => m.set('代价/' + c.x, JSON.stringify(c)));
  return m;
}

function diff(oldD, newD) {
  const A = flatten(oldD), B = flatten(newD);
  const added = [], removed = [], changed = [];
  B.forEach((v, k) => {
    if (!A.has(k)) added.push(k);
    else if (A.get(k) !== v) changed.push(k);
  });
  A.forEach((v, k) => { if (!B.has(k)) removed.push(k); });
  return { added, removed, changed };
}

/* ============================================================
 *  跑
 * ============================================================ */
function main() {
  if (!fs.existsSync(TXT)) { console.error('找不到 题库.txt'); process.exit(1); }
  const cur = loadCurrent();
  const parsed = parseTxt(fs.readFileSync(TXT, 'utf8'));
  const nd = parsed.data;

  /* SLOT 的 lv：txt 里靠分档标题还原 */
  remapSlotLevels(fs.readFileSync(TXT, 'utf8'), nd);

  console.log('── 解析 题库.txt ──');
  [1, 2, 3, 4].forEach(lv => {
    const parts = TYPE_ORDER.map(t => TYPE_NAME[t] + ' ' + nd.CARD_POOL[lv][t].length);
    console.log('  Lv' + lv + ' ' + (nd.LEVELS[lv].n || '') + '  ' + parts.join(' · '));
  });
  console.log('  标签 ' + nd.TAGS.length + ' 个 · 道具 ' + nd.PROPS.length + ' 项'
    + ' · 翻牌子 ' + nd.SLOT.act.length + '×' + nd.SLOT.part.length
    + ' · 代价 ' + nd.SPECIAL.cost.length + ' 张');
  if (parsed.problems.length) {
    console.log('');
    console.log('  ⚠️ 有认不出来的行：');
    parsed.problems.forEach(p => console.log('     ' + p));
  }

  console.log('');
  console.log('── 校验 ──');
  const v = validate(nd);
  if (v.warns.length) v.warns.forEach(w => console.log('  ⚠️ ' + w));
  if (v.errs.length) {
    console.log('  ❌ ' + v.errs.length + ' 个错误，拒绝写入：');
    v.errs.slice(0, 12).forEach(e => console.log('     ' + e));
    process.exit(1);
  }
  console.log('  ✅ 通过');

  console.log('');
  console.log('── 和现有 cards.js 的差异 ──');
  const df = diff(cur, nd);
  console.log('  新增 ' + df.added.length + ' 张');
  df.added.slice(0, 10).forEach(k => console.log('     + ' + k.slice(0, 52)));
  if (df.added.length > 10) console.log('     …还有 ' + (df.added.length - 10) + ' 张');
  console.log('  删除 ' + df.removed.length + ' 张');
  df.removed.slice(0, 10).forEach(k => console.log('     - ' + k.slice(0, 52)));
  if (df.removed.length > 10) console.log('     …还有 ' + (df.removed.length - 10) + ' 张');
  console.log('  改动 ' + df.changed.length + ' 张');
  df.changed.slice(0, 10).forEach(k => console.log('     ~ ' + k.slice(0, 52)));
  if (df.changed.length > 10) console.log('     …还有 ' + (df.changed.length - 10) + ' 张');

  const norm = (tags) => tags.map(t => ({ id: t.id, d: t.d, was: (t.was || []).slice() }));
  const tagsChanged = JSON.stringify(norm(cur.TAGS)) !== JSON.stringify(norm(nd.TAGS));
  if (tagsChanged) console.log('  （标签表也有变化）');

  if (!WRITE) {
    console.log('');
    console.log('  以上只是预览。确认没问题就跑：');
    console.log('      node _smoke/import.cjs --write');
    return;
  }

  fs.writeFileSync(OUT, generate(nd), 'utf8');
  console.log('');
  console.log('✅ 已写入 ' + OUT);
  console.log('   接着跑一下测试：node _smoke/cards.test.cjs');
}

/* txt 里翻牌子是分档标题 + 动作/部位行，解析时要把档位回填到每个词上 */
function remapSlotLevels(text, nd) {
  const lines = text.split(/\r?\n/);
  let lv = 0, zone = '';
  const act = [], part = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (t.indexOf('翻 牌 子') >= 0) { zone = 'slot'; continue; }
    if (t.indexOf('特 殊') >= 0) { zone = ''; continue; }
    if (zone !== 'slot') continue;
    const a = t.match(/^动作：(.*)$/);
    if (a) { parseSlotList(a[1]).forEach(x => { x.lv = lv; act.push(x); }); continue; }
    const p = t.match(/^部位：(.*)$/);
    if (p) { parseSlotList(p[1]).forEach(x => { x.lv = lv; part.push(x); }); continue; }
    // 分档标题长这样：── Lv1 暖场　9 动作 × 10 部位 = 90 种组合────
    // 不是以 Lv 开头，得在整行里找
    const m = t.match(/Lv(\d)/);
    if (m) { lv = +m[1]; continue; }
  }
  if (act.length) nd.SLOT.act = act;
  if (part.length) nd.SLOT.part = part;
}

if (require.main === module) main();
module.exports = { parseTxt, validate, generate, loadCurrent, remapSlotLevels, diff, flatten, REAL, OUT };
