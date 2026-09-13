/* 冒烟测试：jsdom 真实加载 index.html，模拟两个人玩一整局 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require('./node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(step); }
  return false;
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = 'jsdomError: ' + (e.detail || e.message); errors.push(m); console.log('   ⚠️  ' + m); });
vc.on('error', (...a) => { const m = 'console.error: ' + a.join(' '); errors.push(m); console.log('   ⚠️  ' + m); });

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

async function boot(base, seed) {
  const dom = await JSDOM.fromURL(base + '/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { if (seed) w.localStorage.setItem('punish-game-v1', JSON.stringify(seed)); }
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.addEventListener('error', e => { const m = 'window.error: ' + e.message; errors.push(m); console.log('   ⚠️  ' + m); });
  await new Promise(r => w.addEventListener('load', r));
  await wait(180);
  return dom;
}

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const dom = await boot(base);
  const win = dom.window, doc = win.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));
  const shut = () => $('#ov-x').click();
  const saved = () => JSON.parse(win.localStorage.getItem('punish-game-v1'));

  console.log('\n── 0 · 加载 ──');
  check('样式表加载', Array.from(doc.styleSheets).length > 0);
  check('标题是「惩罚游戏」', doc.title === '惩罚游戏', doc.title);
  check('localStorage 可用', (() => { try { win.localStorage.setItem('x', '1'); return true; } catch (e) { return false; } })());

  console.log('\n── 1 · 初始化 ──');
  check('尺度 4 档', $$('#lv button').length === 4);
  check('红线 11 项', $$('#tags button').length === 11);
  check('默认选中 Lv2', $('#lv button.on').dataset.lv === '2');
  check('没存档时不显示「接着上一局」', $('#btn-resume').classList.contains('hide'));

  console.log('\n── 2 · 设置 → 红线 → 开局 ──');
  $('#in-a').value = '阿离';
  $('#in-b').value = '小满';
  $$('#lv button').find(b => b.dataset.lv === '3').click();
  $('#to-limits').click();
  check('进入红线页', $('#sc-limits').classList.contains('on'));
  $$('#tags button').find(b => b.dataset.tag === '绑缚').click();
  $('#start').click();
  check('进入游戏页', $('#sc-game').classList.contains('on'));
  check('名字正确', $('#n-0').textContent === '阿离' && $('#n-1').textContent === '小满');
  check('第一步是转盘，不是盲盒', !$('#step-spin').classList.contains('hide') && $('#step-pick').classList.contains('hide'));
  check('热度 0/8', $('#heat-txt').textContent === '0 / 8');
  check('终极按钮初始禁用', $('#ult').disabled === true);

  console.log('\n── 3 · 手动换人（别的游戏输了）──');
  check('初始轮到第一个人', $('#who-0').classList.contains('on'));
  check('有「点名字换人」提示', $('#turn-hint').textContent.includes('点'));
  $('#who-1').click(); await wait(150);
  check('点第二个人就换过去', $('#who-1').classList.contains('on') && !$('#who-0').classList.contains('on'));
  check('回合文字跟着变', $('#turn').textContent.includes('小满'), $('#turn').textContent);
  $('#who-0').click(); await wait(150);
  check('再点回来也行', $('#who-0').classList.contains('on'));
  check('得分区是可点按钮，不是死文字', $('#who-0').tagName === 'BUTTON' && $('#who-1').tagName === 'BUTTON');

  console.log('\n── 4 · 第一步：转类型 ──');
  check('转盘画好了（5 个扇区）', $$('#mw span').length === 5, '实际 ' + $$('#mw span').length);
  const names = $$('#mw span').map(s => s.textContent);
  check('扇区就是那 5 类', ['真心话', '大冒险', '惩罚', '一起做', '翻牌子'].every(n => names.includes(n)), names.join('/'));
  const TYPES = ['真心话', '大冒险', '惩罚', '一起做', '翻牌子'];
  $('#spin-main').click();
  check('转的时候按钮禁用', $('#spin-main').disabled === true);
  const spinned = await until(() => TYPES.includes($('#mw-say').textContent), 9000);
  check('转完了出结果', spinned, $('#mw-say').textContent);
  const landed = $('#mw-say').textContent;
  check('结果是 5 类之一', ['真心话', '大冒险', '惩罚', '一起做', '翻牌子'].includes(landed), landed);

  console.log('\n── 5 · 第二步：按类型抽盲盒 ──');
  if (landed === '翻牌子') {
    check('转到翻牌子直接进转轮', await until(() => $('#reel-act'), 3000));
    shut(); await wait(250);
    check('关掉后回到转盘步骤', !$('#step-spin').classList.contains('hide'));
  } else {
    check('进入挑盒子步骤', await until(() => !$('#step-pick').classList.contains('hide'), 3000));
    check('页面提示了这把的类型（' + landed + '）', $('#pick-type').textContent === landed, $('#pick-type').textContent);
    $$('.box')[0].click();
    check('开出卡片', await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 4000));
    const kind = $('.c-kind').textContent;
    check('卡片类型 = 转盘结果，或是意外卡', kind === landed || ['反转', '幸运'].includes(kind), kind);
    const txt = $('.c-text').textContent;
    check('正文占位符已替换', !txt.includes('{') && txt.length > 4, txt.slice(0, 30));
    const before = $('#turn').textContent;
    $('#done').click();
    check('结算后热度 +1', await until(() => $('#heat-txt').textContent.startsWith('1 /'), 2000), $('#heat-txt').textContent);
    check('结算后回到转盘步骤', !$('#step-spin').classList.contains('hide'));
    check('结算后换人', $('#turn').textContent !== before, $('#turn').textContent);
  }

  console.log('\n── 6 · 点菜直接指定类型 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="dare"]'));
  check('点菜有 5 项（含翻牌子）', $$('#ov-body [data-t]').length === 5, '实际 ' + $$('#ov-body [data-t]').length);
  check('点菜里有「翻牌子」', $('#ov-body [data-t="slot"]').textContent.includes('翻牌子'));
  $('#ov-body [data-t="dare"]').click();
  check('点大冒险就直接进挑盒子', await until(() => !$('#step-pick').classList.contains('hide'), 3000));
  check('类型显示大冒险', $('#pick-type').textContent === '大冒险');
  $$('.box')[1].click();
  await until(() => $('.c-text'), 4000);
  if ($('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 7 · 认输 → 代价卡 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="punish"]'));
  $('#ov-body [data-t="punish"]').click();
  await until(() => !$('#step-pick').classList.contains('hide'), 3000);
  $$('.box')[2].click();
  await until(() => $('.c-text'), 4000);
  check('有认输按钮', !!$('#give'));
  if ($('#give')) {
    $('#give').click();
    check('弹出代价卡', await until(() => $('.c-kind') && $('.c-kind').textContent === '代价', 3000), $('.c-kind') && $('.c-kind').textContent);
    check('代价卡不能再认输（防套娃）', !$('#give'));
  }
  if ($('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 8 · 翻牌子的两个转轮 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="slot"]'));
  $('#ov-body [data-t="slot"]').click();
  check('两个转轮渲染出来', await until(() => $('#reel-act') && $('#reel-part'), 2500));
  check('弹层标题是「翻牌子」', $('#ov-body .ov-h').textContent === '翻牌子');
  $('#spin-act').click();
  await until(() => !$('#spin-act').disabled, 6000);
  const actTxt = $('#reel-act span').textContent;
  check('动作转出合法值', actTxt !== '？？' && actTxt.length > 0, actTxt);
  check('只翻一个时提示还要翻另一个', $('#slot-say').textContent.includes('部位'), $('#slot-say').textContent);
  $('#spin-part').click();
  await until(() => !$('#spin-part').disabled, 6000);
  const partTxt = $('#reel-part span').textContent;
  check('部位转出合法值', partTxt !== '？？' && partTxt.length > 0, partTxt);
  check('合成句带两个名字', $('#slot-say').textContent.includes('阿离') && $('#slot-say').textContent.includes('小满'), $('#slot-say').textContent);
  check('翻出的词都来自词表', win.SLOT.act.some(i => i.x === actTxt) && win.SLOT.part.some(i => i.x === partTxt));
  const heatB = parseInt($('#heat-txt').textContent, 10);
  $('#slot-done').click(); await wait(400);
  check('翻牌子计入热度', parseInt($('#heat-txt').textContent, 10) === heatB + 1, $('#heat-txt').textContent);

  console.log('\n── 8.5 · 中途关掉不能卡死（回归）──');
  // 曾经：转到翻牌子 → 点 ✕ 关掉 → 转盘按钮还禁用着、盒子也没了，整个卡住
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="slot"]'));
  $('#ov-body [data-t="slot"]').click();
  check('翻牌子已打开', await until(() => $('#spin-act'), 2500));
  shut(); await wait(300);
  check('关掉后转盘步骤回来了', !$('#step-spin').classList.contains('hide'));
  check('关掉后挑盒子步骤是隐藏的', $('#step-pick').classList.contains('hide'));
  check('转盘按钮重新可用（没卡死）', $('#spin-main').disabled === false);
  check('还能继续转', await (async () => {
    $('#spin-main').click();
    return await until(() => TYPES.includes($('#mw-say').textContent), 9000);
  })());
  await wait(1200);
  if ($('#reel-act')) { shut(); await wait(250); }
  else if (!$('#step-pick').classList.contains('hide')) {
    $$('.box')[0].click();
    if (await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 4000)) { $('#done').click(); await wait(400); }
  }

  console.log('\n── 9 · 骰子决定谁受罚 ──');
  check('骰子按钮是「谁受罚」', $('#dice').textContent.includes('谁受罚'), $('#dice').textContent);
  $('#dice').click(); await until(() => $('#roll'));
  $('#roll').click();
  check('两边都掷出点数', await until(() => /\d+/.test($('#p0').textContent) && /\d+/.test($('#p1').textContent), 4000),
    $('#p0').textContent + ' / ' + $('#p1').textContent);
  await wait(1600);
  if (!$('#ov').classList.contains('hide') && $('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 10 · 攒热度 → 终极 ──');
  // 完整打完一手：转到翻牌子就把两个轮子翻完，不然这一圈不计分
  async function playTurn() {
    if (!$('#ov').classList.contains('hide')) shut();
    await wait(150);
    if (!$('#step-pick').classList.contains('hide')) {
      $$('.box')[0].click();
      if (await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 4000)) {
        if ($('#done')) $('#done').click();
        await wait(450);
      }
      return;
    }
    $('#spin-main').click();
    await until(() => TYPES.includes($('#mw-say').textContent), 9000);
    await wait(1100);
    if ($('#reel-act')) {
      $('#spin-act').click(); await until(() => !$('#spin-act').disabled, 6000);
      $('#spin-part').click(); await until(() => !$('#spin-part').disabled, 6000);
      if ($('#slot-done') && !$('#slot-done').classList.contains('hide')) $('#slot-done').click();
      await wait(450);
      return;
    }
    if (!$('#step-pick').classList.contains('hide')) {
      $$('.box')[1].click();
      if (await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 4000)) {
        if ($('#done')) $('#done').click();
        await wait(450);
      }
    }
  }
  let guard = 0;
  while (parseInt($('#heat-txt').textContent, 10) < 8 && guard++ < 14) {
    await playTurn();
  }
  check('热度到 8', parseInt($('#heat-txt').textContent, 10) >= 8, $('#heat-txt').textContent);
  check('终极解锁', $('#ult').disabled === false);

  console.log('\n── 11 · 终极盲盒只出真卡 ──');
  $('#ult').click();
  check('弹出卡片', await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 4000));
  const ultKind = $('.c-kind').textContent;
  check('终极不会给幸运/反转这种奖励卡', !['幸运', '反转'].includes(ultKind), ultKind);
  check('终极抽的是最高档 Lv3', $('.c-top').textContent.includes('Lv3'), $('.c-top').textContent);
  if ($('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 12 · 记录与真心话 ──');
  if (!$('#ov').classList.contains('hide')) shut();
  await wait(150);
  $('#menu').click(); await until(() => $('#ov-body [data-m="log"]'));
  $('#ov-body [data-m="log"]').click();
  await until(() => $('.tabs'));
  check('两个 tab：本局 / 真心话', $$('.tabs button').length === 2, $$('.tabs button').map(b => b.textContent).join(' | '));
  check('本局有记录', $$('#tb .log div').length > 0, '实际 ' + $$('#tb .log div').length);
  $$('.tabs button')[1].click(); await wait(150);
  check('真心话页可切换', $('#tb').innerHTML.length > 0);
  shut(); await wait(200);

  console.log('\n── 13 · 结束这一局：真心话必须留下 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="truth"]'));
  $('#ov-body [data-t="truth"]').click();
  await until(() => !$('#step-pick').classList.contains('hide'), 3000);
  $$('.box')[0].click();
  check('真心话卡带作答框', await until(() => $('#ans'), 4000));
  $('#ans').value = '锁骨，还有后颈。';
  $('#done').click(); await wait(450);
  const truthsBefore = saved().truths.length;
  check('真心话写进了存档（' + truthsBefore + ' 条）', truthsBefore > 0);
  check('本局记录也有 ' + saved().history.length + ' 条', saved().history.length > 0);

  $('#menu').click(); await until(() => $('#ov-body [data-m="finish"]'));
  $('#ov-body [data-m="finish"]').click();
  await until(() => $('#fs-again'));
  check('结束弹层显示双方张数与合计', $$('.sum-row').length === 3, '实际 ' + $$('.sum-row').length);
  check('提示真心话会保留', $('#ov-body').textContent.includes('真心话留下'), $('#ov-body').textContent.slice(0, 40));
  $('#fs-again').click(); await wait(600);
  const after = saved();
  check('本局记录已清空', after.history.length === 0, '实际 ' + after.history.length);
  check('🔥 真心话没被清掉（' + after.truths.length + ' 条）', after.truths.length === truthsBefore);
  check('分数归零', after.score[0] === 0 && after.score[1] === 0);
  check('热度归零', after.heat === 0);
  check('局数 +1', after.sessions === 1, 'sessions=' + after.sessions);
  check('回到转盘步骤', !$('#step-spin').classList.contains('hide'));
  check('免罚卡/反转卡重置', after.toke[0].skip === 1 && after.toke[0].rev === 1);

  console.log('\n── 14 · 清空所有数据 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="wipe"]'));
  $('#ov-body [data-m="wipe"]').click();
  await until(() => $('#yes'));
  check('清空前有二次确认', $('#ov-body').textContent.includes('找不回来'));
  $('#yes').click(); await wait(450);
  check('回到首页', $('#sc-setup').classList.contains('on'));
  check('存档已删除', win.localStorage.getItem('punish-game-v1') === null);

  console.log('\n── 15 · 无未捕获错误 ──');
  check('全程无错', errors.length === 0, errors.slice(0, 5).join(' || '));

  console.log('\n── 16 · 重开页面：接着上一局 ──');
  const seed = {
    names: ['阿离', '小满'], safe: '西瓜', max: 4, blocked: ['拍摄'],
    turn: 1, round: 7, heat: 5, score: [6, 4], mult: 1, ultUsed: 0, sessions: 2,
    toke: [{ skip: 0, rev: 1 }, { skip: 2, rev: 0 }], needed: ['冰块'], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'truth', x: '你最想让 {other} 舔你哪儿？', st: 'done', ans: '锁骨。' }],
    truths: [{ at: Date.now(), who: '阿离', x: '你最想让 {other} 舔你哪儿？', ans: '锁骨。' }]
  };
  const dom2 = await boot(base, seed);
  const w2 = dom2.window, d2 = w2.document;
  check('出现「接着上一局」', !d2.querySelector('#btn-resume').classList.contains('hide'));
  check('名字回填', d2.querySelector('#in-a').value === '阿离' && d2.querySelector('#in-b').value === '小满');
  check('安全词回填', d2.querySelector('#in-safe').value === '西瓜');
  check('尺度回填 Lv4', d2.querySelector('#lv button.on').dataset.lv === '4');
  d2.querySelector('#btn-resume').click(); await wait(300);
  check('点进游戏页', d2.querySelector('#sc-game').classList.contains('on'));
  check('热度恢复 5', d2.querySelector('#heat-txt').textContent === '5 / 8', d2.querySelector('#heat-txt').textContent);
  check('分数恢复 6/4', d2.querySelector('#s-0').textContent === '6' && d2.querySelector('#s-1').textContent === '4');
  check('回合恢复给第二人', d2.querySelector('#turn').textContent.includes('小满'), d2.querySelector('#turn').textContent);
  d2.querySelector('#menu').click(); await wait(200);
  d2.querySelector('#ov-body [data-m="log"]').click(); await wait(200);
  d2.querySelectorAll('.tabs button')[1].click(); await wait(200);
  check('真心话旧答案读得出', d2.querySelector('#tb').innerHTML.includes('锁骨'));
  check('旧卡里的 {other} 还原成人名', d2.querySelector('#tb').innerHTML.includes('小满') && !d2.querySelector('#tb').innerHTML.includes('{other}'));
  w2.close();

  console.log('\n── 17 · 旧存档兼容（真心话原本混在 history 里）──');
  const legacy = {
    names: ['A', 'B'], safe: '菠萝', max: 2, blocked: [], turn: 0, round: 1, heat: 1,
    score: [1, 0], mult: 1, ultUsed: 0, toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }],
    needed: [], seen: [],
    history: [{ at: 1700000000000, who: 'A', lvl: 2, t: 'truth', x: '你最喜欢 {other} 什么声音？', st: 'done', ans: '喘气。' }]
    // 故意不带 truths 字段，模拟改名前的存档
  };
  const dom3 = await boot(base, legacy);
  const d3 = dom3.window.document;
  d3.querySelector('#btn-resume').click(); await wait(250);
  d3.querySelector('#menu').click(); await wait(200);
  d3.querySelector('#ov-body [data-m="log"]').click(); await wait(200);
  d3.querySelectorAll('.tabs button')[1].click(); await wait(200);
  check('老存档里的真心话被迁移过来', d3.querySelector('#tb').innerHTML.includes('喘气'), d3.querySelector('#tb').innerHTML.slice(0, 80));
  dom3.window.close();

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  win.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });
