/* 把题库导成一份可读的 txt，方便在编辑器里直接改 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const win = {};
win.window = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/cards.js'), 'utf8'), win);

const TAGS = win.TAGS, POOL = win.CARD_POOL, SLOT = win.SLOT, SP = win.SPECIAL, LV = win.LEVELS;
const PROPS = win.PROPS;

const TYPE_NAME = { truth: '真心话', dare: '大冒险', punish: '惩罚', duo: '一起做' };
const TYPE_ORDER = ['truth', 'dare', 'punish', 'duo'];

const lines = [];
const push = (s) => lines.push(s === undefined ? '' : s);
const rule = (ch, n) => ch.repeat(n || 64);

/* ── 统计 ── */
const perLevel = {};
let total = 0, tagged = 0;
[1, 2, 3, 4].forEach(lv => {
  const g = POOL[lv];
  perLevel[lv] = TYPE_ORDER.reduce((s, t) => s + g[t].length, 0);
  total += perLevel[lv];
  TYPE_ORDER.forEach(t => g[t].forEach(c => { if ((c.g || []).length) tagged++; }));
});
const tagUse = {};
TAGS.forEach(t => { tagUse[t.id] = 0; });
[1, 2, 3, 4].forEach(lv => TYPE_ORDER.forEach(t => POOL[lv][t].forEach(c =>
  (c.g || []).forEach(g => { if (tagUse[g] !== undefined) tagUse[g]++; }))));
['act', 'part'].forEach(k => SLOT[k].forEach(it => (it.g || []).forEach(g => { if (tagUse[g] !== undefined) tagUse[g]++; })));
SP.cost.forEach(c => (c.g || []).forEach(g => { if (tagUse[g] !== undefined) tagUse[g]++; }));

/* ── 封面 ── */
push(rule('═'));
push('  惩 罚 游 戏 · 题 库');
push(rule('═'));
push('');
push('  这份文件是从 js/cards.js 自动导出的，只用于阅读和校对。');
push('  要改内容请改 js/cards.js，改完重新导出即可。');
push('');
push('  导出时间：' + new Date().toLocaleString('zh-CN'));
push('  题目总数：' + total + ' 张（带标签 ' + tagged + ' 张）');
push('  翻牌子词：' + SLOT.act.length + ' 个动作 × ' + SLOT.part.length + ' 个部位');
push('');
push('  各档题量：');
[1, 2, 3, 4].forEach(lv => {
  push('    Lv' + lv + ' ' + LV[lv].n + '  ' + String(perLevel[lv]).padStart(3) + ' 张   '
    + TYPE_ORDER.map(t => TYPE_NAME[t] + ' ' + POOL[lv][t].length).join(' · '));
});
push('');
push('  写法：你 = 抽到卡的人，{other} = 另一个人。');
push('');

/* ── 等级边界 ── */
push(rule('─'));
push('  等 级 边 界');
push(rule('─'));
push('');
push('  Lv1 暖场   只聊天、握手、拥抱。不碰敏感部位。');
push('  Lv2 暧昧   亲亲抱抱摸，隔着衣服。衣服全程不脱。');
push('  Lv3 灼热   开始脱，露出皮肤，碰敏感部位，会出声。');
push('  Lv4 失控   没有尺度限制。用嘴、用手、进来、绑住、拍打、晾着。');
push('');
push('  每个标签都有「最早能从哪一档出现」，写错了测试会直接报错。');
push('');

/* ── 红线标签 ── */
push(rule('─'));
push('  红 线 标 签（' + TAGS.length + ' 个，双数）');
push(rule('─'));
push('');
TAGS.forEach((t, i) => {
  const was = (t.was || []).length ? '　（旧名：' + t.was.join('、') + '）' : '';
  push('  ' + String(i + 1).padStart(2) + '. ' + t.id.padEnd(6) + t.d + was);
  push('      出现 ' + tagUse[t.id] + ' 处');
});
push('');

/* ── 正文 ── */
[1, 2, 3, 4].forEach(lv => {
  push('');
  push(rule('═'));
  push('  Lv' + lv + ' · ' + LV[lv].n + '　　' + LV[lv].d);
  push('  共 ' + perLevel[lv] + ' 张');
  push(rule('═'));

  TYPE_ORDER.forEach(t => {
    const list = POOL[lv][t];
    push('');
    push('── ' + TYPE_NAME[t] + '（' + list.length + '）' + rule('─', Math.max(2, 50 - TYPE_NAME[t].length * 2)));

    list.forEach((c, i) => {
      const meta = [];
      if (c.s) meta.push('限时 ' + c.s + ' 秒');
      if (c.d) meta.push(c.d === 'coin' ? '现场抛三枚硬币' : '现场掷两颗骰子');
      if (c.p && c.p.length) meta.push('道具：' + c.p.join('、'));
      if (c.g && c.g.length) meta.push('标签：' + c.g.join('、'));

      push('');
      push('  ' + String(i + 1).padStart(2) + '. ' + c.x);
      if (meta.length) push('      [' + meta.join('] [') + ']');
    });
    push('');
  });
});

/* ── 翻牌子 ── */
push('');
push(rule('═'));
push('  翻 牌 子 · 动作 × 部位');
push('  两个转轮分开转，合起来就是一张卡。严格按等级取词。');
push(rule('═'));
[1, 2, 3, 4].forEach(lv => {
  const a = SLOT.act.filter(x => x.lv === lv);
  const p = SLOT.part.filter(x => x.lv === lv);
  push('');
  push('── Lv' + lv + ' ' + LV[lv].n + '　' + a.length + ' 动作 × ' + p.length + ' 部位 = ' + (a.length * p.length) + ' 种组合' + rule('─', 12));
  push('');
  push('  动作：' + a.map(x => x.x + ((x.g || []).length ? '(' + x.g.join('/') + ')' : '')).join('　'));
  push('  部位：' + p.map(x => x.x + ((x.g || []).length ? '(' + x.g.join('/') + ')' : '')).join('　'));
});

/* ── 特殊 ── */
push('');
push('');
push(rule('═'));
push('  特 殊');
push(rule('═'));
push('');
push('  反转 / 幸运：转盘之外各 4% 的截胡，下面是随机挑一句的文案池。');
push('');
push('  【反转】指针停在哪一格不重要，这一把整个归对方。');
SP.reverse.forEach(x => push('    · ' + x));
push('');
push('  【幸运】这轮直接跳过。');
SP.lucky.forEach(x => push('    · ' + x));
push('');
push('  【认输代价】点「认输」抽一张，做完积分 +2（' + SP.cost.length + ' 张）');
SP.cost.forEach((c, i) => {
  const m = [];
  if (c.s) m.push('限时 ' + c.s + ' 秒');
  if ((c.g || []).length) m.push('标签：' + c.g.join('、'));
  push('');
  push('  ' + String(i + 1).padStart(2) + '. ' + c.x);
  if (m.length) push('      [' + m.join('] [') + ']');
});

/* ── 道具 ── */
push('');
push('');
push(rule('─'));
push('  道 具 清 单（' + PROPS.length + ' 项）');
push(rule('─'));
push('');
push('  ' + PROPS.join('　·　'));
push('');
push('');
push(rule('═'));
push('  以上共 ' + total + ' 张题目，翻牌子 ' + (SLOT.act.length * SLOT.part.length) + ' 种表面组合。');
push(rule('═'));

const out = path.join(ROOT, '题库.txt');
fs.writeFileSync(out, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
console.log('已导出：' + out);
console.log('行数 ' + lines.length + '，大小 ' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
