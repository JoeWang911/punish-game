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
let firstErrShown = false;
function noteErr(m, stack) {
  errors.push(m);
  if (!firstErrShown) {
    firstErrShown = true;
    console.log('   ⚠️  ' + m);
    if (stack) console.log('       ' + String(stack).split('\n').slice(1, 6).join('\n       '));
  }
}
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const d = e.detail || e;
  noteErr('jsdomError: ' + (d.message || d), d && d.stack);
});
vc.on('error', (...a) => noteErr('console.error: ' + a.join(' ')));

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

async function boot(base, seed, setup) {
  const dom = await JSDOM.fromURL(base + '/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (seed) w.localStorage.setItem('punish-game-v1', JSON.stringify(seed));
      if (setup) setup(w);
    }
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.addEventListener('error', e => noteErr('window.error: ' + e.message, e.error && e.error.stack));
  await new Promise(r => w.addEventListener('load', r));
  await wait(180);
  return dom;
}

/* 假音频：把每一次 beep 记下来（时间 + 音高 + 波形），
   这样能真的验证「音效先密后疏、先高后低」，而不是只看代码里写了什么。 */
function fakeAudio(w) {
  w.__osc = [];
  function FakeCtx() {
    this.currentTime = 0;
    this.destination = {};
    this.createOscillator = function () {
      var o = {
        type: 'sine',
        frequency: { value: 0 },
        connect: function () {},
        stop: function () {},
        start: function () { w.__osc.push({ at: Date.now(), f: o.frequency.value, type: o.type }); }
      };
      return o;
    };
    this.createGain = function () {
      return {
        gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
        connect: function () {}
      };
    };
  }
  w.AudioContext = FakeCtx;
  w.webkitAudioContext = FakeCtx;
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
  check('红线 12 项', $$('#tags button').length === 12, '实际 ' + $$('#tags button').length);
  check('默认选中 Lv2', $('#lv button.on').dataset.lv === '2');
  check('没存档时不显示「接着上一局」', $('#btn-resume').classList.contains('hide'));

  console.log('\n── 2 · 设置 → 红线 → 开局 ──');
  $('#in-a').value = '阿离';
  $('#in-b').value = '小满';
  $$('#lv button').find(b => b.dataset.lv === '3').click();
  $('#to-limits').click();
  check('进入红线页', $('#sc-limits').classList.contains('on'));
  $$('#tags button').find(b => b.dataset.tag === '绑束').click();
  $('#start').click();
  check('进入游戏页', $('#sc-game').classList.contains('on'));
  check('名字正确', $('#n-0').textContent === '阿离' && $('#n-1').textContent === '小满');
  check('第一步是转盘，不是盲盒', !$('#step-spin').classList.contains('hide') && $('#step-pick').classList.contains('hide'));
  check('升级进度初始 0/16', $('#heat-txt').textContent === '0 / 16', $('#heat-txt').textContent);
  check('没有终极按钮了（终极改成自动触发）', $('#ult') === null);

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
  /* 转盘落定之后还有 4% 反转 / 4% 幸运会把结果截胡，而这两条已经在第 20 节单独验过了。
     这一节要验的是正常流程，所以先把这两个概率按住（顺带让扇区也定下来）：
     spinMain 里第 1 次 Math.random 用来挑扇区、第 2 次才是抽截胡。 */
  const realRandom = win.Math.random;
  let nRand = 0;
  win.Math.random = function () { nRand++; return nRand === 1 ? 0.5 : 0.99; };
  $('#spin-main').click();
  check('转的时候按钮禁用', $('#spin-main').disabled === true);
  const spinned = await until(() => TYPES.includes($('#mw-say').textContent), 9000);
  check('转完了出结果', spinned, $('#mw-say').textContent);
  // 再等一会儿，确认没有被截胡（截胡会在落定后 700ms 改字）
  await wait(1200);
  const landed = $('#mw-say').textContent;
  check('这一把抽到了第 3 个扇区（惩罚）', landed === '惩罚', landed);
  check('这一把没有被反转 / 幸运截胡', !['反转！', '幸运！'].includes(landed), landed);
  win.Math.random = realRandom;

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
    check('卡片类型 = 转盘结果，或是反转/幸运', kind === landed || ['幸运'].includes(kind), kind);
    const txt = $('.c-text').textContent;
    check('正文占位符已替换', !txt.includes('{') && txt.length > 4, txt.slice(0, 30));
    const before = $('#turn').textContent;
    $('#done').click();
    check('结算后进度 +1', await until(() => $('#heat-txt').textContent.startsWith('1 /'), 2000), $('#heat-txt').textContent);
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
  // 盒子有 4% 出幸运卡，那张没有认输按钮；出到就跳过重新抽
  let gotCard = false;
  for (let tryN = 0; tryN < 5 && !gotCard; tryN++) {
    if (!$('#ov').classList.contains('hide')) shut();
    await wait(200);
    if ($('#step-pick').classList.contains('hide')) {
      $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
      $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="punish"]'));
      $('#ov-body [data-t="punish"]').click();
      await until(() => !$('#step-pick').classList.contains('hide'), 3000);
    }
    $$('.box')[tryN % 3].click();
    if (!await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 5000)) continue;
    if ($('#done') && $('.c-kind').textContent === '幸运') { $('#done').click(); await wait(400); continue; }
    gotCard = true;
  }
  check('抽到了真卡（不是幸运跳过）', gotCard);
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
  check('翻牌子计入进度', parseInt($('#heat-txt').textContent, 10) === heatB + 1, $('#heat-txt').textContent);

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
  const rolled = await until(() => $('#p0') && $('#p1') && /\d+/.test($('#p0').textContent) && /\d+/.test($('#p1').textContent), 4000);
  check('两边都掷出点数', rolled, $('#p0') ? $('#p0').textContent + ' / ' + $('#p1').textContent : '(骰子面板不见了)');
  await wait(1600);
  if (!$('#ov').classList.contains('hide') && $('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 10 · 升级进度与等级按钮 ──');
  check('页面上有等级按钮', !!$('#lv-chip'));
  check('等级按钮显示当前档位', $('#lv-chip').textContent.includes('Lv3'), $('#lv-chip').textContent);
  check('进度条文案是「已做 / 16」', /\/ 16$/.test($('#heat-txt').textContent), $('#heat-txt').textContent);
  $('#lv-chip').click();
  check('点等级按钮弹出选择', await until(() => $$('#ov-body [data-lv]').length === 4, 3000), '实际 ' + $$('#ov-body [data-lv]').length);
  check('当前档位有标记', !!$('#ov-body [data-lv="3"]') && $('#ov-body [data-lv="3"]').classList.contains('cur'));
  $('#ov-body [data-lv="1"]').click();
  await wait(400);
  check('切到 Lv1 后按钮跟着变', $('#lv-chip').textContent.includes('Lv1'), $('#lv-chip').textContent);
  // 走到第 10 步时可能已经有人攒够 4 张了，那种情况下换档后会落在终极舞台，
  // 而不是转盘——两者都是「可以继续」的状态
  check('切档后回到可继续的状态',
    !$('#step-spin').classList.contains('hide') || !$('#step-ult').classList.contains('hide'),
    '转盘 ' + !$('#step-spin').classList.contains('hide') + ' / 终极 ' + !$('#step-ult').classList.contains('hide'));

  console.log('\n── 10.5 · 严格等级：只出当前档的题 ──');
  let leaked = [], drew = 0;
  for (let i = 0; i < 8; i++) {
    if (i > 0) {
      if (!$('#ov').classList.contains('hide')) shut();
      await wait(150);
    }
    $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
    $('#ov-body [data-m="pick"]').click();
    const t = ['dare', 'punish', 'truth', 'duo'][i % 4];
    if (!await until(() => $('#ov-body [data-t="' + t + '"]'), 2000)) break;
    $('#ov-body [data-t="' + t + '"]').click();
    if (!await until(() => !$('#step-pick').classList.contains('hide'), 3000)) break;
    $$('.box')[i % 3].click();
    if (!await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 5000)) break;
    if ($('.c-kind').textContent === '幸运') {   // 4% 的跳过卡，没有等级，不算数
      $('#done').click(); await wait(400); continue;
    }
    const lv = $('.c-top').textContent.match(/Lv(\d)/);
    if (!lv) { leaked.push('卡片没有等级标记'); }
    else if (lv[1] !== '1') leaked.push('Lv1 里抽到了 Lv' + lv[1]);
    drew++;
    if ($('#done')) { $('#done').click(); await wait(400); }
  }
  check('抽了 ' + drew + ' 张 Lv1 的卡', drew >= 6, '只抽到 ' + drew);
  check('🔥 一张都没混进别的等级', leaked.length === 0, leaked.slice(0, 3).join(' ; '));

  console.log('\n── 10.6 · 翻牌子也只出当前档 ──');
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click();
  await until(() => $('#ov-body [data-t="slot"]'));
  $('#ov-body [data-t="slot"]').click();
  await until(() => $('#spin-act'));
  $('#spin-act').click(); await until(() => !$('#spin-act').disabled, 7000);
  $('#spin-part').click(); await until(() => !$('#spin-part').disabled, 7000);
  const sAct = $('#reel-act span').textContent, sPart = $('#reel-part span').textContent;
  check('翻出的动作属于当前档（' + sAct + '）', win.SLOT.act.some(x => x.x === sAct && x.lv === 1), sAct);
  check('翻出的部位属于当前档（' + sPart + '）', win.SLOT.part.some(x => x.x === sPart && x.lv === 1), sPart);
  $('#slot-done').click(); await wait(400);

  console.log('\n── 11 · 反转 / 幸运 / 代价 +2 ──');
  // 直接验概率常量和它们的效果，比等随机触发可靠
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  check('反转概率是 4%', /REVERSE_P\s*=\s*0\.04/.test(src));
  check('幸运概率是 4%', /LUCKY_P\s*=\s*0\.04/.test(src));

  // 代价卡：做完积分 +2
  const before2 = Number($('#s-0').textContent) + Number($('#s-1').textContent);
  $('#menu').click(); await until(() => $('#ov-body [data-m="pick"]'));
  $('#ov-body [data-m="pick"]').click(); await until(() => $('#ov-body [data-t="punish"]'));
  $('#ov-body [data-t="punish"]').click();
  await until(() => !$('#step-pick').classList.contains('hide'), 3000);
  $$('.box')[0].click();
  await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 5000);
  if ($('.c-kind') && $('.c-kind').textContent === '幸运') { $('#done').click(); await wait(400); }
  if (await until(() => $('#give'), 4000)) {
    $('#give').click();
    if (await until(() => $('.c-kind') && $('.c-kind').textContent === '代价', 3000)) {
      check('代价卡提示了「做完积分 +2」', $('#ov-body').textContent.includes('+2'), '');
      $('#done').click(); await wait(500);
      const after2 = Number($('#s-0').textContent) + Number($('#s-1').textContent);
      check('代价做完积分 +2（' + before2 + ' → ' + after2 + '）', after2 === before2 + 2, '差 ' + (after2 - before2));
    }
  }
  if (!$('#ov').classList.contains('hide')) { shut(); await wait(200); }

  console.log('\n── 11.5 · 等级按钮可以升级 ──');
  // 合计过 16 之后等级按钮应该进入「可升级」状态（升级询问本身在另一段单独验）
  const combinedNow = Number($('#s-0').textContent) + Number($('#s-1').textContent);
  check('合计已经到 ' + combinedNow + ' 张', combinedNow >= 16, '实际 ' + combinedNow);
  check('等级按钮进入可升级状态', $('#lv-chip').classList.contains('ready'));
  $('#lv-chip').click(); await wait(250);
  check('点等级按钮能打开选择', await until(() => $('#ov-body [data-lv="2"]'), 2000));
  $('#ov-body [data-lv="2"]').click(); await wait(400);
  check('升档后等级按钮变成 Lv2', $('#lv-chip').textContent.includes('Lv2'), $('#lv-chip').textContent);
  if (!$('#ov').classList.contains('hide')) { shut(); await wait(200); }

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
  check('积分归零', after.score[0] === 0 && after.score[1] === 0);
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
  // 存档停在 Lv4，接着上一局也要先过密码（否则刷新一次密码就白设了）
  d2.querySelector('#btn-resume').click(); await wait(400);
  check('Lv4 存档点「接着上一局」要先验密码', !!d2.querySelector('#pin'));
  check('验密码之前没进游戏页', !d2.querySelector('#sc-game').classList.contains('on'));
  d2.querySelector('#pin').value = '0519';
  d2.querySelector('#pin-go').click(); await wait(500);
  check('点进游戏页', d2.querySelector('#sc-game').classList.contains('on'));
  check('Lv4 存档显示「已满档」而不是升级目标', d2.querySelector('#heat-txt').textContent.includes('已满档'), d2.querySelector('#heat-txt').textContent);
  check('分数恢复 6/4', d2.querySelector('#s-0').textContent === '6' && d2.querySelector('#s-1').textContent === '4');
  check('回合恢复给第二人', d2.querySelector('#turn').textContent.includes('小满'), d2.querySelector('#turn').textContent);
  d2.querySelector('#menu').click(); await wait(200);
  d2.querySelector('#ov-body [data-m="log"]').click(); await wait(200);
  d2.querySelectorAll('.tabs button')[1].click(); await wait(200);
  check('真心话旧答案读得出', d2.querySelector('#tb').innerHTML.includes('锁骨'));
  check('旧卡里的 {other} 还原成人名', d2.querySelector('#tb').innerHTML.includes('小满') && !d2.querySelector('#tb').innerHTML.includes('{other}'));
  // 这份存档里的 blocked 用的是旧标签名「拍摄」。
  // 迁移只发生在内存里（load 时映射），localStorage 里还是老种子，
  // 所以要看界面有没有把它显示成已屏蔽——那才是用户能看到的真实结果。
  d2.querySelector('#ov-x').click(); await wait(250);
  d2.querySelector('#menu').click(); await wait(250);
  d2.querySelector('#ov-body [data-m="limits"]').click(); await wait(300);
  const tagBtns = Array.from(d2.querySelectorAll('#tags2 button'));
  const imgBtn = tagBtns.find(b => b.dataset.tag === '影像');
  check('🔥 旧标签名自动迁移（拍摄 → 影像），红线里显示为已屏蔽',
    !!imgBtn && imgBtn.classList.contains('off'), imgBtn ? imgBtn.className : '没找到「影像」');
  check('旧的「拍摄」已经不在清单里', !tagBtns.some(b => b.dataset.tag === '拍摄'));
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

  console.log('\n── 18 · 终极模式：页面内上演，不弹窗 ──');
  const ultSeed = {
    names: ['阿离', '小满'], safe: '菠萝', max: 3, blocked: [], turn: 0, round: 5,
    score: [4, 2], mult: 1, armed: [1, 0], ultPending: [true, false], prompted16: false,
    toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'dare', x: '占位记录', st: 'done', ans: '' }],
    truths: [], sessions: 0
  };
  const dom4 = await boot(base, ultSeed);
  const w4 = dom4.window, d4 = w4.document;
  const $4 = s => d4.querySelector(s);
  const $$4 = s => Array.from(d4.querySelectorAll(s));
  d4.querySelector('#btn-resume').click();
  await wait(400);

  check('没有弹窗，改用页面内的终极舞台', await until(() => !$4('#step-ult').classList.contains('hide'), 3000));
  check('弹层没有被打开', $4('#ov').classList.contains('hide'));
  check('写明了是谁攒够的', $4('#ult-sub').textContent.includes('阿离') && $4('#ult-sub').textContent.includes('4'), $4('#ult-sub').textContent);
  check('没有直接跳到选模式（先问谁受罚）', $4('#ult-body').textContent.includes('谁受罚'));

  console.log('\n── 18.1 · 可以改「谁受罚」──');
  check('两个人都能选', $$4('#ult-who [data-w]').length === 2, '实际 ' + $$4('#ult-who [data-w]').length);
  check('默认选中攒够的那位', $4('#ult-who [data-w="0"]').classList.contains('on'));
  check('默认按钮写着「受终极」', $4('#ult-go').textContent.includes('阿离') && $4('#ult-go').textContent.includes('终极'), $4('#ult-go').textContent);
  $4('#ult-who [data-w="1"]').click(); await wait(200);
  check('点另一个人就换过去', $4('#ult-who [data-w="1"]').classList.contains('on') && !$4('#ult-who [data-w="0"]').classList.contains('on'));
  check('切到另一位后按钮改成「普通受罚」', $4('#ult-go').textContent.includes('小满') && $4('#ult-go').textContent.includes('普通'), $4('#ult-go').textContent);
  $4('#ult-who [data-w="0"]').click(); await wait(200);
  check('能换回来', $4('#ult-who [data-w="0"]').classList.contains('on'));

  $4('#ult-go').click(); await wait(400);
  check('进入后由对方指定模式', $4('#ult-sub').textContent.includes('小满'), $4('#ult-sub').textContent);
  check('五种模式都能选', $$4('#ult-body .ult-mode').length === 5, '实际 ' + $$4('#ult-body .ult-mode').length);
  check('终极标记已消耗掉', JSON.parse(w4.localStorage.getItem('punish-game-v1')).ultPending[0] === false);

  console.log('\n── 18.2 · 盒子全部爆开 ──');
  $$4('#ult-body [data-u="punish"]')[0].click();
  await wait(300);
  check('出现三个盒子', $$4('#burst .b-box').length === 3, '实际 ' + $$4('#burst .b-box').length);
  check('刚出现时盖子是盖着的', !$$4('#burst .b-box')[0].classList.contains('open'));
  check('盖子会依次打开（有错开延迟）', $$4('#burst .b-lid').every(l => /transition-delay/.test(l.getAttribute('style'))), '');
  check('盒子带爆开动画', $$4('#burst .b-box').every(b => /animation-delay/.test(b.getAttribute('style'))));
  await until(() => $$4('#burst .b-box').every(b => b.classList.contains('open')), 4000);
  check('三个盖子全开了', $$4('#burst .b-box').every(b => b.classList.contains('open')));
  const optTexts = $$4('#burst .opt-x').map(x => x.textContent.trim());
  check('内容直接摊开（不是问号）', optTexts.every(t => t.length > 4), optTexts[0] && optTexts[0].slice(0, 20));
  check('三张内容互不相同', new Set(optTexts).size === 3);
  check('每张都标了等级', $$4('#burst .opt-k').every(k => /Lv3/.test(k.textContent)));

  $$4('#burst .b-box')[1].click();
  await wait(700);
  check('选中的卡弹出来了', await until(() => $4('.c-text') && !$4('#ov').classList.contains('hide'), 3000));
  check('卡片上有终极横幅', $4('.banner.ult') && $4('.banner.ult').textContent.includes('终极模式'));
  check('横幅写明是谁指定的', $4('.banner.ult').textContent.includes('小满'), $4('.banner.ult').textContent);
  check('卡主是攒够的那位（阿离）', $4('.c-who').textContent === '阿离', $4('.c-who').textContent);
  check('内容正是被挑中的那个', $4('.c-text').textContent.trim() === optTexts[1], $4('.c-text').textContent.slice(0, 26));
  if ($4('#done')) { $4('#done').click(); await wait(500); }

  console.log('\n── 18.3 · 切到对方 = 普通一轮，终极留着 ──');
  const ultSeed3 = JSON.parse(JSON.stringify(ultSeed));
  ultSeed3.ultPending = [true, false];
  const dom6 = await boot(base, ultSeed3);
  const w6 = dom6.window, d6 = w6.document;
  const $6 = s => d6.querySelector(s);
  const $$6 = s => Array.from(d6.querySelectorAll(s));
  d6.querySelector('#btn-resume').click(); await wait(400);
  await until(() => $6('#ult-who [data-w="1"]'), 3000);
  $6('#ult-who [data-w="1"]').click(); await wait(200);
  $6('#ult-go').click(); await wait(500);
  check('切到另一位后离开终极舞台', $6('#step-ult').classList.contains('hide'));
  check('落回正常转盘步骤', !$6('#step-spin').classList.contains('hide'));
  check('🔥 终极没有被消耗掉（还留着）', JSON.parse(w6.localStorage.getItem('punish-game-v1')).ultPending[0] === true);
  check('这一轮归对方', $6('#turn').textContent.includes('小满'), $6('#turn').textContent);

  // 用点菜直接给这一轮抽一张，把普通一轮走完（比等转盘落地确定）
  $6('#menu').click();
  await until(() => $6('#ov-body [data-m="pick"]'), 3000);
  $6('#ov-body [data-m="pick"]').click();
  await until(() => $6('#ov-body [data-t="dare"]'), 2000);
  $6('#ov-body [data-t="dare"]').click();
  await until(() => !$6('#step-pick').classList.contains('hide'), 3000);
  $$6('.box')[0].click();
  if (await until(() => $6('.c-text') && !$6('#ov').classList.contains('hide'), 6000)) {
    check('普通一轮的卡主是小满', $6('.c-who').textContent === '小满', $6('.c-who').textContent);
    check('这张卡上没有终极横幅', !$6('.banner.ult'));
    if ($6('#done')) { $6('#done').click(); await wait(800); }
  }
  // 转回攒够的那位，终极应该还在
  check('轮回到攒够的那位时，终极重新出现',
    await until(() => !$6('#step-ult').classList.contains('hide'), 4000),
    '终极舞台可见=' + !$6('#step-ult').classList.contains('hide'));
  check('终极仍在待用状态', JSON.parse(w6.localStorage.getItem('punish-game-v1')).ultPending[0] === true);
  dom6.window.close();

  console.log('\n── 19 · 终极里的翻牌子：滚轮选择 ──');
  const ultSeed2 = JSON.parse(JSON.stringify(ultSeed));
  const dom5 = await boot(base, ultSeed2);
  const w5 = dom5.window, d5 = w5.document;
  const $5 = s => d5.querySelector(s);
  const $$5 = s => Array.from(d5.querySelectorAll(s));
  d5.querySelector('#btn-resume').click(); await wait(400);
  await until(() => $5('#ult-go'), 3000);
  $5('#ult-go').click(); await wait(350);
  await until(() => $5('#ult-body [data-u="slot"]'), 2500);
  $5('#ult-body [data-u="slot"]').click(); await wait(350);
  check('动作和部位都是滚轮', !!$5('#drum-act') && !!$5('#drum-part'));
  check('滚轮里是选项按钮不是输入框', $$5('#drum-act button').length > 0 && $$5('#drum-part button').length > 0,
    '动作 ' + $$5('#drum-act button').length + ' / 部位 ' + $$5('#drum-part button').length);
  check('滚轮带 drum 类名（可拖动 + 有中间选中带）', $5('#drum-act').className.includes('drum'));
  check('每个滚轮中间都画了选中带', $$5('#ult-body .drum-band').length === 2);
  check('每个滚轮有上下两个箭头（鼠标也能用）', $$5('#ult-body .drum-arrow').length === 4,
    '实际 ' + $$5('#ult-body .drum-arrow').length);
  check('上下箭头各两个', $$5('#ult-body .drum-arrow[data-dir="-1"]').length === 2 && $$5('#ult-body .drum-arrow[data-dir="1"]').length === 2);
  check('箭头能对应到滚轮', $$5('#ult-body .drum-arrow[data-for="drum-act"]').length === 2 && $$5('#ult-body .drum-arrow[data-for="drum-part"]').length === 2);
  check('一打开就选中第一格（中间不会是空的）', $$5('#drum-act button.sel').length === 1 && $$5('#drum-act button')[0].classList.contains('sel'));
  check('选项只来自当前档（Lv3）', $$5('#drum-act button').every(b => w5.SLOT.act.some(x => x.x === b.textContent && x.lv === 3)),
    $$5('#drum-act button').map(b => b.textContent).join('/'));
  $$5('#ult-body .drum-arrow[data-dir="1"]')[0].click(); await wait(400);
  check('点下箭头换到第二格，滚轮没崩', !!$5('#drum-act') && $$5('#drum-act button')[1].classList.contains('sel'),
    '选中的是第 ' + $$5('#drum-act button').findIndex(b => b.classList.contains('sel')) + ' 格');
  $$5('#ult-body .drum-arrow[data-dir="-1"]')[0].click(); await wait(400);
  check('点上箭头转回第一格', $$5('#drum-act button')[0].classList.contains('sel'));
  check('滚轮选中的项永远只有一格高亮', $$5('#drum-act button.sel').length === 1 && $$5('#drum-part button.sel').length === 1);
  $$5('#drum-act button')[2].click(); await wait(400);
  $$5('#drum-part button')[1].click(); await wait(400);
  check('点某一条能直接落到中间', $$5('#drum-act button')[2].classList.contains('sel') && $$5('#drum-part button')[1].classList.contains('sel'));
  check('确定按钮一直可用（滚轮永远有一格在中间）', $5('#u-go').disabled === false);
  const pickAct = $$5('#drum-act button')[2].textContent, pickPart = $$5('#drum-part button')[1].textContent;
  check('按钮上预览了结果', $5('#u-go').textContent.includes(pickAct) && $5('#u-go').textContent.includes(pickPart), $5('#u-go').textContent);

  // ── 真的按住拖一把。速度的符号写反过一次，一松手会往后甩回第一格，
  //    所以这里必须验「往上拖之后停在更后面」，不能只验「没崩」。
  function selIdx() { return $$5('#drum-act button').findIndex(b => b.classList.contains('sel')); }
  function drag(steps, dy) {
    const box = $5('#drum-act');
    box.dispatchEvent(new w5.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100, clientY: 400, button: 0 }));
    const dragging = box.classList.contains('dragging');
    return (async () => {
      for (let i = 1; i <= steps; i++) {
        d5.dispatchEvent(new w5.MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: 100, clientY: 400 + dy * i, button: 0
        }));
        await wait(16);
      }
      const during = selIdx();
      d5.dispatchEvent(new w5.MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: 100, clientY: 400 + dy * steps, button: 0
      }));
      await wait(900);
      return { dragging, during, after: selIdx() };
    })();
  }

  // 先回到第一格，方便数数
  $$5('#drum-act button')[0].click(); await wait(500);
  const up = await drag(8, -16);          // 手指往上划 = 看后面的
  check('按下去就进入拖动状态', up.dragging === true);
  check('往上拖的时候滚轮跟着走（到第 ' + up.during + ' 格）', up.during > 0);
  check('松手之后停在更后面，不会往回甩（0 → ' + up.after + '）', up.after >= up.during && up.after > 0,
    '拖到 ' + up.during + '，松手后 ' + up.after);

  $$5('#drum-act button')[0].click(); await wait(500);
  const dn = await drag(6, 16);           // 往下划 = 看前面的，已经在第 0 格，只能被弹回来
  check('往下拖到头的橡皮筋不会失控（停在第 ' + dn.after + ' 格）', dn.after === 0, '实际 ' + dn.after);
  check('拖完选中项还是只有一格', $$5('#drum-act button.sel').length === 1);
  check('拖完滚轮还在，没被拖坏', $$5('#drum-act button').length > 0);

  // 拖完把选择拨回上面记下的那两格，后面的流程才对得上
  $$5('#drum-act button')[2].click(); await wait(400);
  $$5('#drum-part button')[1].click(); await wait(400);
  check('拖完之后还能精确选回指定的两格',
    $$5('#drum-act button')[2].classList.contains('sel') && $$5('#drum-part button')[1].classList.contains('sel'));
  $5('#u-go').click();
  await until(() => $5('.c-text'), 3000);
  const finalTxt = $5('.c-text') ? $5('.c-text').textContent : '(没有卡片)';
  check('出的正是对方滑选的那一套（' + pickAct + ' × ' + pickPart + '）', finalTxt.includes(pickAct) && finalTxt.includes(pickPart), finalTxt);
  check('这句话带上了两个人的名字', finalTxt.includes('阿离') && finalTxt.includes('小满'), finalTxt);
  check('指定之后卡主仍是受罚方', !!$5('.c-who') && $5('.c-who').textContent === '阿离', $5('.c-who') && $5('.c-who').textContent);
  const before5 = JSON.parse(w5.localStorage.getItem('punish-game-v1')).score[0];
  if ($5('#done')) { $5('#done').click(); await wait(500); }
  const s5 = JSON.parse(w5.localStorage.getItem('punish-game-v1'));
  check('做完了才 +1（' + before5 + ' → ' + s5.score[0] + '）', s5.score[0] === before5 + 1, 'score=' + s5.score.join('/'));
  dom5.window.close();
  dom4.window.close();

  console.log('\n── 20 · 转盘：五格等概率 + 极小概率的反转 / 幸运 ──');
  const src2 = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  check('五个扇区不再带权重字段 w', !/k: '\w+',\s*n: '[^']+',\s*w:/.test(src2), '');
  check('扇区跨度是 360/5（等分）', /360\s*\/\s*SECTORS\.length/.test(src2));
  check('反转 4% 且不在扇区列表里', /REVERSE_P\s*=\s*0\.04/.test(src2) && !/k: 'reverse'/.test(src2));
  check('幸运 4% 且不在扇区列表里', /LUCKY_P\s*=\s*0\.04/.test(src2) && !/k: 'lucky'/.test(src2));
  check('截胡发生在转盘那一步（不是开盒）', /twist = roll < REVERSE_P/.test(src2));
  check('反转会把整把交给对方', /pendingReverse = true/.test(src2));
  // 实转若干次，确认五格都出得来、且没有第七种结果。
  // 每次都要把这一手走完，否则回不到转盘那一步。
  const seenTypes = {};
  async function spinOnce() {
    if (!$('#ov').classList.contains('hide')) { shut(); await wait(250); }
    if ($('#step-spin').classList.contains('hide')) return null;
    $('#spin-main').click();
    const okSpin = await until(() => TYPES.includes($('#mw-say').textContent) || ['反转！', '幸运！'].includes($('#mw-say').textContent), 9000);
    if (!okSpin) return null;
    const got = $('#mw-say').textContent;
    await wait(2400);                       // 等它跳到下一步
    if ($('#reel-act')) { shut(); await wait(250); return got; }   // 翻牌子，关掉即可
    if (!$('#ov').classList.contains('hide') && $('.c-kind') && $('.c-kind').textContent === '幸运') {
      $('#done').click(); await wait(500); return got;
    }
    if (!$('#step-pick').classList.contains('hide')) {
      $$('.box')[0].click();
      if (await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 6000)) {
        if ($('#done')) $('#done').click();
        await wait(500);
      }
    }
    return got;
  }
  for (let i = 0; i < 8; i++) {
    const got = await spinOnce();
    if (got) seenTypes[got] = (seenTypes[got] || 0) + 1;
  }
  const seenKeys = Object.keys(seenTypes);
  check('转盘只出这 5 种（外加反转/幸运两种截胡）', seenKeys.length > 0 && seenKeys.every(k => TYPES.includes(k) || k === '反转！' || k === '幸运！'), seenKeys.join('/'));
  check('转了 ' + seenKeys.length + ' 种结果：' + JSON.stringify(seenTypes), seenKeys.length >= 2, JSON.stringify(seenTypes));

  console.log('\n── 21 · 升级询问（干净场景）──');
  // 主流程里分数是随机涨上去的，可能早就过了 16，测不准。
  // 这里种一个「15 张、还没问过」的状态，跨过 16 时应该问一次。
  const lvSeed = {
    names: ['阿离', '小满'], safe: '菠萝', max: 2, blocked: [], turn: 0, round: 3,
    score: [10, 5], mult: 1, armed: [0, 0], ultPending: [false, false], prompted16: false,
    toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 2, t: 'dare', x: '占位', st: 'done', ans: '' }],
    truths: [], sessions: 0
  };
  const dom7 = await boot(base, lvSeed);
  const w7 = dom7.window, d7 = w7.document;
  const $lv = s => d7.querySelector(s);
  const $$lv = s => Array.from(d7.querySelectorAll(s));
  d7.querySelector('#btn-resume').click();
  await wait(400);
  check('开局合计 15 张，还没到线', $lv('#s-0').textContent === '10' && $lv('#s-1').textContent === '5');
  check('此时等级按钮没高亮', !$lv('#lv-chip').classList.contains('ready'));
  check('此时不弹升级询问', !$lv('#lu-yes'));

  // 认输拿代价，一次 +2，跨过 16
  $lv('#menu').click(); await wait(250);
  $lv('#ov-body [data-m="pick"]').click(); await wait(250);
  $lv('#ov-body [data-t="punish"]').click();
  await wait(500);
  $$lv('.box')[0].click();
  await wait(1500);
  if ($lv('#give')) { $lv('#give').click(); await wait(800); }
  if ($lv('#done')) { $lv('#done').click(); await wait(700); }

  const after7 = Number($lv('#s-0').textContent) + Number($lv('#s-1').textContent);
  check('合计跨过 16（现在 ' + after7 + '）', after7 >= 16, '实际 ' + after7);
  check('自动弹出升级询问', await until(() => $lv('#lu-yes'), 6000), $lv('#ov-body') ? $lv('#ov-body').textContent.slice(0, 40) : '(没有弹层)');
  if ($lv('#lu-yes')) {
    check('写明升到哪一档', $lv('#lu-yes').textContent.includes('Lv3'), $lv('#lu-yes').textContent);
    check('有「先不升」', !!$lv('#lu-no'));
    $lv('#lu-no').click(); await wait(300);
    check('选「先不升」后弹层关掉', $lv('#ov').classList.contains('hide'));
    check('不升的话等级没变', $lv('#lv-chip').textContent.includes('Lv2'), $lv('#lv-chip').textContent);
    check('按钮保持可升级状态', $lv('#lv-chip').classList.contains('ready'));
    // 这次真升
    $lv('#menu').click(); await wait(250);
    if ($lv('#ov-body [data-m="pick"]')) {
      $lv('#ov-x').click(); await wait(250);
    }
    $lv('#lv-chip').click(); await wait(250);
    check('再打开等级选择', await until(() => $lv('#ov-body [data-lv="3"]'), 2000));
    $lv('#ov-body [data-lv="3"]').click(); await wait(500);
    check('升到 Lv3 成功', $lv('#lv-chip').textContent.includes('Lv3'), $lv('#lv-chip').textContent);
    check('不会再弹第二次升级询问', !$lv('#lu-yes'));
  }
  dom7.window.close();

  console.log('\n── 22 · Lv4 密码门 ──');
  const dom8 = await boot(base);
  const w8 = dom8.window, d8 = w8.document;
  const $8 = s => d8.querySelector(s);
  const $$8 = s => Array.from(d8.querySelectorAll(s));
  const lvOn = () => $8('#lv button.on') && $8('#lv button.on').dataset.lv;

  check('主页默认是 Lv2', lvOn() === '2', lvOn());

  $$8('#lv button').find(b => b.dataset.lv === '4').click();
  await wait(300);
  check('主页点 Lv4 弹出密码框', !!$8('#pin'), $8('#ov-body') ? $8('#ov-body').textContent.slice(0, 26) : '(没弹)');
  check('密码框是 password 类型（不明文）', $8('#pin') && $8('#pin').type === 'password');
  check('此时还没选中 Lv4', lvOn() === '2', lvOn());

  $8('#pin').value = '1234';
  $8('#pin-go').click(); await wait(300);
  check('密码错了不关掉', !!$8('#pin'));
  check('密码错了会提示', $8('#pin-err').textContent.includes('不对'), $8('#pin-err').textContent);
  check('密码错了输入框被清空', $8('#pin').value === '');
  check('密码错了输入框标红', $8('#pin').classList.contains('bad'));
  check('密码错了仍然没选中 Lv4', lvOn() === '2', lvOn());

  $8('#pin').value = '';
  $8('#pin-go').click(); await wait(250);
  check('空密码会提示', $8('#pin-err').textContent.includes('还没输'), $8('#pin-err').textContent);

  $8('#pin').value = '0519';
  $8('#pin-go').click(); await wait(400);
  check('密码对了弹层关闭', $8('#ov').classList.contains('hide'));
  check('🔥 密码对了才选中 Lv4', lvOn() === '4', lvOn());

  $$8('#lv button').find(b => b.dataset.lv === '2').click(); await wait(200);
  check('切回 Lv2 不需要密码', lvOn() === '2' && $8('#ov').classList.contains('hide'));
  $$8('#lv button').find(b => b.dataset.lv === '4').click(); await wait(300);
  check('再点 Lv4 又要一次密码', !!$8('#pin'));
  $8('#pin').value = '0519';
  $8('#pin').dispatchEvent(new w8.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(400);
  check('回车提交也生效', lvOn() === '4', lvOn());

  $$8('#lv button').find(b => b.dataset.lv === '3').click(); await wait(200);
  $$8('#lv button').find(b => b.dataset.lv === '4').click(); await wait(300);
  $8('#pin-no').click(); await wait(300);
  check('点「算了」关掉且不切档', $8('#ov').classList.contains('hide') && lvOn() === '3', lvOn());

  console.log('\n── 22.1 · 游戏里切换也要密码 ──');
  $8('#in-a').value = '阿离';
  $8('#in-b').value = '小满';
  $8('#to-limits').click(); await wait(300);
  $8('#start').click(); await wait(400);
  check('进游戏后是 Lv3', $8('#lv-chip').textContent.includes('Lv3'), $8('#lv-chip').textContent);

  $8('#lv-chip').click(); await wait(300);
  check('等级选择能打开', await until(() => $8('#ov-body [data-lv]'), 2000));
  $8('#ov-body [data-lv="4"]').click(); await wait(350);
  check('游戏里切 Lv4 也要密码', !!$8('#pin'));
  check('还没切过去', $8('#lv-chip').textContent.includes('Lv3'), $8('#lv-chip').textContent);

  $8('#pin').value = '0519';
  $8('#pin-go').click(); await wait(500);
  check('🔥 密码对了切到 Lv4', $8('#lv-chip').textContent.includes('Lv4'), $8('#lv-chip').textContent);
  check('切完回到可继续的状态', await until(() => !$8('#step-spin').classList.contains('hide') || !$8('#step-ult').classList.contains('hide'), 3000));

  $8('#lv-chip').click(); await wait(300);
  $8('#ov-body [data-lv="4"]').click(); await wait(400);
  check('已经在 Lv4 时不再重复要密码', !$8('#pin'), $8('#pin') ? '又要了一次' : '');
  dom8.window.close();

  console.log('\n── 23 · Lv3 不再自动升到 Lv4 ──');
  const lv3Seed = {
    names: ['阿离', '小满'], safe: '菠萝', max: 3, blocked: [], turn: 0, round: 3,
    score: [20, 20], mult: 1, armed: [0, 0], ultPending: [false, false], prompted16: false,
    toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'dare', x: '占位', st: 'done', ans: '' }],
    truths: [], sessions: 0
  };
  const dom9 = await boot(base, lv3Seed);
  const d9 = dom9.window.document;
  const $9 = s => d9.querySelector(s);
  d9.querySelector('#btn-resume').click(); await wait(500);
  check('停在 Lv3', $9('#lv-chip').textContent.includes('Lv3'), $9('#lv-chip').textContent);
  check('合计 40 分也不高亮可升级', !$9('#lv-chip').classList.contains('ready'));
  check('不弹升级询问', !$9('#lu-yes'));

  $9('#lv-chip').click(); await wait(300);
  await until(() => $9('#ov-body [data-lv="4"]'), 2000);
  $9('#ov-body [data-lv="4"]').click(); await wait(350);
  check('Lv3 下手动切 Lv4 仍要密码（没被一起关掉）', !!$9('#pin'));
  $9('#pin').value = '0519';
  $9('#pin-go').click(); await wait(500);
  check('手动切 Lv4 成功', $9('#lv-chip').textContent.includes('Lv4'), $9('#lv-chip').textContent);
  dom9.window.close();

  const lv2Seed = JSON.parse(JSON.stringify(lv3Seed));
  lv2Seed.max = 2;
  const dom10 = await boot(base, lv2Seed);
  const d10 = dom10.window.document;
  const $10 = s => d10.querySelector(s);
  const $$10 = s => Array.from(d10.querySelectorAll(s));
  d10.querySelector('#btn-resume').click(); await wait(400);
  check('Lv2 且分数够了，按钮是可升级状态', $10('#lv-chip').classList.contains('ready'));
  $10('#menu').click(); await wait(250);
  $10('#ov-body [data-m="pick"]').click(); await wait(250);
  $10('#ov-body [data-t="punish"]').click(); await wait(500);
  $$10('.box')[0].click(); await wait(1500);
  if ($10('#give')) { $10('#give').click(); await wait(800); }
  if ($10('#done')) { $10('#done').click(); await wait(700); }
  const asked10 = await until(() => $10('#lu-yes'), 6000);
  check('Lv2 跨过 16 时仍会问升级', asked10);
  if (asked10) {
    check('Lv2 升的目标是 Lv3（不是 Lv4）', $10('#lu-yes').textContent.includes('Lv3'), $10('#lu-yes').textContent);
    $10('#lu-yes').click(); await wait(500);
    check('升到 Lv3 成功', $10('#lv-chip').textContent.includes('Lv3'), $10('#lv-chip').textContent);
  }
  dom10.window.close();

  console.log('\n── 24 · Lv4 密码门：刷新后不能绕过（回归）──');
  // 之前只拦住了「主页点击」和「游戏内切换」。
  // 但存档停在 Lv4 时，init 会把主页按钮回填成选中，
  // 于是「下一步→开始」和「接着上一局」都直接进了 Lv4——密码等于消失。
  const lv4Seed = {
    names: ['阿离', '小满'], safe: '菠萝', max: 4, blocked: [], turn: 0, round: 3,
    score: [2, 1], mult: 1, armed: [0, 0], ultPending: [false, false], prompted16: false,
    toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 4, t: 'dare', x: '占位', st: 'done', ans: '' }],
    truths: [], sessions: 1
  };

  const dA = await boot(base, lv4Seed);
  const wA = dA.window, dA_ = wA.document;
  const $A = s => dA_.querySelector(s);
  const $$A = s => Array.from(dA_.querySelectorAll(s));
  const lvOnA = () => $A('#lv button.on') && $A('#lv button.on').dataset.lv;

  check('存档停在 Lv4，主页回填成选中', lvOnA() === '4', lvOnA());
  check('Lv4 按钮上标了需要密码', /🔒|需要密码/.test($$A('#lv button').find(b => b.dataset.lv === '4').textContent),
    $$A('#lv button').find(b => b.dataset.lv === '4').textContent.trim());

  // 路径 1：下一步 → 应该被拦住
  $A('#to-limits').click(); await wait(350);
  check('🔥 点「下一步」会先要密码', !!$A('#pin'), $A('#pin') ? '' : '(没拦住)');
  check('拦住时没有进红线页', !$A('#sc-limits').classList.contains('on'));
  $A('#pin').value = '0000';
  $A('#pin-go').click(); await wait(300);
  check('密码错了进不去', !$A('#sc-limits').classList.contains('on') && !!$A('#pin'));
  $A('#pin-no').click(); await wait(250);
  check('点「算了」回到主页', $A('#sc-setup').classList.contains('on') && $A('#ov').classList.contains('hide'));

  // 路径 2：接着上一局 → 应该被拦住
  $A('#btn-resume').click(); await wait(350);
  check('🔥 点「接着上一局」会先要密码', !!$A('#pin'), $A('#pin') ? '' : '(没拦住)');
  check('拦住时没有进游戏页', !$A('#sc-game').classList.contains('on'));
  $A('#pin').value = '0519';
  $A('#pin-go').click(); await wait(500);
  check('密码对了才进游戏', $A('#sc-game').classList.contains('on'));
  check('进去就是 Lv4', $A('#lv-chip').textContent.includes('Lv4'), $A('#lv-chip').textContent);

  // 同一次打开里已经验过，再点「下一步」不该重复问
  $A('#menu').click(); await wait(250);
  $A('#ov-x').click(); await wait(200);

  // 游戏内从低档切回 Lv4：应该再问一次
  $A('#lv-chip').click(); await wait(300);
  $A('#ov-body [data-lv="3"]').click(); await wait(400);
  check('先切到 Lv3', $A('#lv-chip').textContent.includes('Lv3'), $A('#lv-chip').textContent);
  $A('#lv-chip').click(); await wait(300);
  $A('#ov-body [data-lv="4"]').click(); await wait(350);
  check('🔥 游戏内切回 Lv4 要重新验密码', !!$A('#pin'), $A('#pin') ? '' : '(没拦住)');
  $A('#pin').value = '0519';
  $A('#pin-go').click(); await wait(500);
  check('验完切回 Lv4', $A('#lv-chip').textContent.includes('Lv4'), $A('#lv-chip').textContent);
  dA.window.close();

  console.log('\n── 24.1 · 干净打开页面时 Lv4 也要密码 ──');
  const dB = await boot(base);
  const dB_ = dB.window.document;
  const $B = s => dB_.querySelector(s);
  const $$B = s => Array.from(dB_.querySelectorAll(s));
  check('默认在 Lv2，没被 Lv4 污染', $B('#lv button.on').dataset.lv === '2', $B('#lv button.on').dataset.lv);
  check('Lv4 按钮标着需要密码', /需要密码/.test($$B('#lv button').find(b => b.dataset.lv === '4').textContent));
  dB.window.close();

  console.log('\n── 25 · 卡上现场掷骰 / 抛硬币 ──');
  // 掷骰卡在池子里只占少数，随机抽不靠谱。
  // 办法：把 Lv4 大冒险里「不带骰子」的全部塞进 seen，
  // 这样牌堆里剩下的 fresh 就只有掷骰卡，抽到的一定是它。
  const lv4dare = win.CARD_POOL[4].dare;
  const seenIds = [];
  lv4dare.forEach((c, i) => { if (!c.d) seenIds.push('4dare' + i); });
  const diceCount = lv4dare.filter(c => c.d).length;
  check('Lv4 大冒险里有 ' + diceCount + ' 张掷骰卡', diceCount >= 1, '实际 ' + diceCount);

  const diceSeed = {
    names: ['阿离', '小满'], safe: '菠萝', max: 4, blocked: [], turn: 0, round: 2,
    score: [1, 1], mult: 1, armed: [0, 0], ultPending: [false, false], prompted16: false,
    toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [],
    seen: seenIds,
    history: [{ at: Date.now(), who: '阿离', lvl: 4, t: 'dare', x: '占位', st: 'done', ans: '' }],
    truths: [], sessions: 0
  };
  const domD = await boot(base, diceSeed);
  const wD = domD.window, dD = wD.document;
  const $D = s => dD.querySelector(s);
  const $$D = s => Array.from(dD.querySelectorAll(s));
  dD.querySelector('#btn-resume').click(); await wait(400);
  if ($D('#pin')) { $D('#pin').value = '0519'; $D('#pin-go').click(); await wait(500); }
  check('进入 Lv4', $D('#lv-chip').textContent.includes('Lv4'), $D('#lv-chip').textContent);

  // 点菜 → 大冒险 → 抽到掷骰卡
  $D('#menu').click(); await until(() => $D('#ov-body [data-m="pick"]'), 3000);
  $D('#ov-body [data-m="pick"]').click();
  await until(() => $D('#ov-body [data-t="dare"]'), 2000);
  $D('#ov-body [data-t="dare"]').click();
  await until(() => !$D('#step-pick').classList.contains('hide'), 3000);
  $$D('.box')[0].click();
  const diceCardSeen = await until(() => $D('.c-text') && !$D('#ov').classList.contains('hide'), 6000);
  check('抽到卡了', diceCardSeen);
  if (diceCardSeen) {
    const isDice = $D('.c-text').textContent.includes('骰子');
    const isCoin = $D('.c-text').textContent.includes('硬币');
    check('抽到的正是掷骰/硬币那类（' + (isDice ? '骰子' : isCoin ? '硬币' : '？') + '）', isDice || isCoin,
      $D('.c-text').textContent.slice(0, 26));
    check('卡片上出现了掷一次的按钮', !!$D('#act-roll'), $D('#act-roll') ? '' : '没有按钮');
    check('按钮文案跟类型对上', !!$D('#act-roll') &&
      (isDice ? $D('#act-roll').textContent.includes('骰子') : $D('#act-roll').textContent.includes('硬币')),
      $D('#act-roll') && $D('#act-roll').textContent);
    check('掷之前显示「还没掷」', $D('#roll-out').textContent.includes('还没掷'), $D('#roll-out').textContent);

    $D('#act-roll').click();
    check('掷的时候按钮禁用（防连点）', $D('#act-roll').disabled === true);
    const rolled = await until(() => $D('#roll-out').classList.contains('done'), 5000);
    check('掷出了结果', rolled, $D('#roll-out').textContent);
    const outTxt = $D('#roll-out').textContent;
    if (isDice) {
      check('骰子结果形如「⚄ ⚂ → 9 点」', /→\s*\d+\s*点/.test(outTxt), outTxt);
      const sum = parseInt(outTxt.match(/→\s*(\d+)\s*点/)[1], 10);
      check('两颗骰子的和在 2–12 之间（实际 ' + sum + '）', sum >= 2 && sum <= 12);
    } else {
      check('硬币结果形如「正 反 正 → 1 个反面」', /→\s*\d\s*个反面/.test(outTxt), outTxt);
      const tails = parseInt(outTxt.match(/→\s*(\d)\s*个反面/)[1], 10);
      check('反面个数在 0–3 之间（实际 ' + tails + '）', tails >= 0 && tails <= 3);
    }
    check('结果样式有高亮', $D('#roll-out').classList.contains('hit') || $D('#roll-out').classList.contains('done'));
    check('按钮变成「再掷一次」', $D('#act-roll').textContent.includes('再掷'), $D('#act-roll').textContent);
    check('按钮重新可用', $D('#act-roll').disabled === false);

    // 再掷一次应该换个数（不一定每次都不同，所以只验它还能掷）
    $D('#act-roll').click();
    await until(() => $D('#act-roll').disabled === false && $D('#roll-out').classList.contains('done'), 5000);
    check('可以再掷一次', $D('#roll-out').classList.contains('done'), $D('#roll-out').textContent);

    check('掷完还能正常结算', !!$D('#done'));
    if ($D('#done')) { $D('#done').click(); await wait(500); }
    check('结算后回到转盘 / 终极步骤',
      !$D('#step-spin').classList.contains('hide') || !$D('#step-ult').classList.contains('hide'));
  }
  domD.window.close();

  console.log('\n── 26 · 转盘：字永远朝上 + 音效跟着转盘一起减速 ──');
  const spinSeed = JSON.parse(JSON.stringify(ultSeed));
  spinSeed.armed = [0, 0];
  spinSeed.ultPending = [false, false];
  const domE = await boot(base, spinSeed, fakeAudio);
  const wE = domE.window, dE = wE.document;
  const $E = s => dE.querySelector(s);
  const $$E = s => Array.from(dE.querySelectorAll(s));
  await wait(300);
  $E('#btn-resume').click(); await wait(400);
  check('一进游戏就停在转盘那一步', !$E('#step-spin').classList.contains('hide'));

  // 把「转盘自己转的角度 + 每个扇区的中线角 + 文字自己的反向角」加起来，
  // 只要恒等于 0°，文字在屏幕坐标系里就一定是水平的。
  function labelSums() {
    const wm = /rotate\((-?[\d.]+)deg\)/.exec($E('#mw').style.transform || 'rotate(0deg)');
    const rs = wm ? parseFloat(wm[1]) : 0;
    return $$E('#mw .mw-lb').map(lb => {
      const om = /rotate\((-?[\d.]+)deg\)/.exec(lb.style.transform || '');
      const b = lb.querySelector('b');
      const im = b ? /rotate\((-?[\d.]+)deg\)/.exec(b.style.transform || '') : null;
      const norm = x => ((x % 360) + 360) % 360;
      return {
        text: b ? b.textContent : '',
        mid: parseFloat(lb.dataset.mid),
        // 归一化到 [-0.5, 0.5] 再看离 0° 多远
        off: Math.min(norm(rs + (om ? parseFloat(om[1]) : 0) + (im ? parseFloat(im[1]) : 0)),
                    360 - norm(rs + (om ? parseFloat(om[1]) : 0) + (im ? parseFloat(im[1]) : 0)))
      };
    });
  }

  check('每个扇区都有自己的文字节点', $$E('#mw .mw-lb').length === 5, '实际 ' + $$E('#mw .mw-lb').length);
  check('文字是包在内层 <b> 里的（那样才能单独反向转）',
    $$E('#mw .mw-lb').every(lb => lb.querySelector('b') && lb.querySelector('b').textContent.length > 0));
  check('每个文字节点都记着自己扇区的中线角',
    $$E('#mw .mw-lb').every(lb => /^-?[\d.]+$/.test(lb.dataset.mid || '')));
  const lblBefore = labelSums();
  check('停下没转的时候文字是正的', lblBefore.every(x => x.off < 0.6),
    lblBefore.map(x => x.text + '=' + x.off.toFixed(1) + '°').join(' '));
  check('外层的 mid 角各不相同（说明真的按扇区分开了）',
    new Set(lblBefore.map(x => Math.round(x.mid))).size === lblBefore.length);

  const tickAt0 = wE.__osc.length;
  $E('#spin-main').click();
  const okSpinE = await until(() => TYPES.includes($E('#mw-say').textContent) || ['反转！', '幸运！'].includes($E('#mw-say').textContent), 9000);
  check('转完了出结果', okSpinE, $E('#mw-say').textContent);
  const spunDeg = /rotate\((-?[\d.]+)deg\)/.exec($E('#mw').style.transform);
  check('转盘真的转过好几圈（' + (spunDeg ? parseFloat(spunDeg[1]).toFixed(0) : '?') + '°）',
    !!spunDeg && Math.abs(parseFloat(spunDeg[1])) >= 1080);

  const lblAfter = labelSums();
  check('转完之后文字依然是正的（不是倒的 / 斜的）', lblAfter.every(x => x.off < 0.6),
    lblAfter.map(x => x.text + '=' + x.off.toFixed(1) + '°').join(' '));
  check('转完之后每个扇区的字还是各就各位',
    lblAfter.map(x => x.text).join('/') === lblBefore.map(x => x.text).join('/'));

  // ── 音效：把这一次转动里所有的「扇区哒哒声」拿出来 ──
  const ticks = wE.__osc.slice(tickAt0).filter(o => o.type === 'square');
  check('转的时候每个扇区都响了一记（' + ticks.length + ' 记）', ticks.length >= 8, '只有 ' + ticks.length + ' 记');
  if (ticks.length >= 8) {
    const gaps = [];
    for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i].at - ticks[i - 1].at);
    const f0 = ticks[0].f, fl = ticks[ticks.length - 1].f;
    check('开头响得很密（第一格 ' + gaps[0] + 'ms）', gaps[0] <= 130, '第一格 ' + gaps[0] + 'ms');
    check('越到后面越稀（最后一格 ' + gaps[gaps.length - 1] + 'ms）', gaps[gaps.length - 1] >= 260,
      '最后一格 ' + gaps[gaps.length - 1] + 'ms');
    check('间隔是越来越大，不是匀速（' + gaps[0] + 'ms → ' + gaps[gaps.length - 1] + 'ms）',
      gaps[gaps.length - 1] > gaps[0] * 3,
      '首 ' + gaps[0] + ' 尾 ' + gaps[gaps.length - 1]);
    // 每记之间隔多久。这个值会被「一帧 16ms」量化，所以不看单步、只看整体趋势。
    const q = Math.max(1, Math.floor(gaps.length / 4));
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const head = avg(gaps.slice(0, q)), tail = avg(gaps.slice(gaps.length - q));
    check('开头四分之一平均 ' + head.toFixed(0) + 'ms，结尾四分之一平均 ' + tail.toFixed(0) + 'ms —— 明显越来越慢',
      tail > head * 3, head.toFixed(0) + 'ms → ' + tail.toFixed(0) + 'ms');
    // 只允许「突然又加快一大截」出现极少数几次（时间戳取整的抖动）
    let rush = 0;
    for (let i = 1; i < gaps.length; i++) if (gaps[i] < gaps[i - 1] * 0.4) rush++;
    check('没有突然又猛地加速的地方（只有 ' + rush + ' 处）', rush <= 1, rush + ' 处');
    check('音高从高到低（' + Math.round(f0) + 'Hz → ' + Math.round(fl) + 'Hz）', f0 >= 900 && fl <= 1000 && f0 > fl + 200,
      Math.round(f0) + ' → ' + Math.round(fl));
    // 音高直接跟转速挂钩，转速一路降，音高就该一路降（只允许舍入级别的回升）
    let fbad = 0;
    for (let i = 1; i < ticks.length; i++) if (ticks[i].f > ticks[i - 1].f + 1) fbad++;
    check('音高一路往下降，不是来回跳（回升的只有 ' + fbad + ' 处）', fbad <= 1, fbad + ' 处回升');
    check('停下来之后不再继续响（没有卡在匀速的定时器里）', wE.__osc.slice(tickAt0).filter(o => o.type === 'square').length === ticks.length);
  }
  const spinSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  check('已经删掉了那条「每 105ms 恒定响一次」的定时器', !/setInterval\(function \(\) \{ beep\(1200/.test(spinSrc));
  check('音效跟着 requestAnimationFrame 一帧一帧算', /raf\(frame\)/.test(spinSrc) && /function frame\(now\)/.test(spinSrc));
  check('时长和曲线是从 CSS 变量读的，不会和转盘走岔',
    /cssMs\('--spin-dur'/.test(spinSrc) && /cssNums\('--spin-ease'/.test(spinSrc));
  domE.window.close();

  console.log('\n── 27 · 弹层被顶掉时，还在跑的定时器不能崩 ──');
  // 掷骰子 / 掷骰卡 / 倒计时都是一串 setInterval + setTimeout。
  // 这中间要是有别的弹层插进来（升级询问、认输、点等级按钮），
  // 旧面板就被换掉了，那串定时器再往 null 上写 textContent 就会抛错。
  const dashSeed = JSON.parse(JSON.stringify(ultSeed));
  dashSeed.armed = [0, 0];
  dashSeed.ultPending = [false, false];
  const domF = await boot(base, dashSeed);
  const wF = domF.window, dF = wF.document;
  const $F = s => dF.querySelector(s);
  await wait(300);
  $F('#btn-resume').click(); await wait(500);
  const errAt27 = errors.length;

  check('游戏页上有「谁受罚」骰子', !!$F('#dice') && $F('#dice').textContent.includes('谁受罚'));
  $F('#dice').click();
  check('骰子面板开出来了', await until(() => $F('#roll'), 2500));
  $F('#roll').click();
  await wait(150);                       // 让那串定时器先跑起来
  check('掷骰面板正在动（还没出结果）', $F('#p0') && !/\d/.test($F('#p0').textContent), $F('#p0') && $F('#p0').textContent);
  $F('#lv-chip').click();                // 面板被等级面板顶掉
  await wait(400);
  check('弹层确实被顶掉了（骰子面板不在了）', !$F('#roll'));
  await wait(2200);                      // 等骰子那串 setTimeout 全部烧完
  check('骰子定时器烧完之后没有报错', errors.length === errAt27, errors.slice(errAt27).join(' | '));

  // 同一招再试倒计时：计时器面板被顶掉
  shut(); await wait(200);
  if ($F('#step-pick').classList.contains('hide')) { $F('#spin-main').click(); await wait(5200); }
  const errAt27b = errors.length;
  $F('#lv-chip').click(); await wait(300);
  check('清空弹层之后也没有残留报错', errors.length === errAt27b, errors.slice(errAt27b).join(' | '));
  domF.window.close();

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  win.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });
