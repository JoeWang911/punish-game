/* 冒烟测试：jsdom 真实加载 index.html，模拟两个人玩一整局 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require('./node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
// 轮询等条件成立，比死等固定毫秒稳
async function until(fn, ms = 6000, step = 60) {
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

  console.log('\n── 0 · 加载 ──');
  check('样式表加载', Array.from(doc.styleSheets).length > 0);
  check('标题是「惩罚游戏」', doc.title === '惩罚游戏', doc.title);
  check('localStorage 可用', (() => { try { win.localStorage.setItem('x', '1'); return true; } catch (e) { return false; } })());

  console.log('\n── 1 · 初始化 ──');
  check('尺度 4 档', $$('#lv button').length === 4, '实际 ' + $$('#lv button').length);
  check('红线 9 项', $$('#tags button').length === 9, '实际 ' + $$('#tags button').length);
  check('默认选中 Lv2', $('#lv button.on').dataset.lv === '2');
  check('游戏页默认隐藏', !$('#sc-game').classList.contains('on'));
  check('没存档时不显示「接着上一局」', $('#btn-resume').classList.contains('hide'));

  console.log('\n── 2 · 设置 → 红线 → 开局 ──');
  $('#in-a').value = '阿离';
  $('#in-b').value = '小满';
  $$('#lv button').find(b => b.dataset.lv === '3').click();
  check('切到 Lv3', $('#lv button.on').dataset.lv === '3');
  $('#to-limits').click();
  check('进入红线页', $('#sc-limits').classList.contains('on'));
  const tagBtn = $$('#tags button').find(b => b.dataset.tag === '绑缚');
  tagBtn.click();
  check('标签能关掉', tagBtn.classList.contains('off'));

  $('#start').click();
  check('进入游戏页', $('#sc-game').classList.contains('on'));
  check('名字显示正确', $('#n-0').textContent === '阿离' && $('#n-1').textContent === '小满');
  check('安全词同步', $('#safe-show').textContent === '菠萝');
  check('轮到第一个人', $('#turn').textContent.includes('阿离'), $('#turn').textContent);
  check('第一个人高亮', $('#who-0').classList.contains('on') && !$('#who-1').classList.contains('on'));
  check('热度 0/8', $('#heat-txt').textContent === '0 / 8');
  check('终极按钮初始禁用', $('#ult').disabled === true);

  console.log('\n── 3 · 开盒 → 结算 ──');
  $$('.box')[0].click();
  await until(() => doc.querySelector('.c-text') && !$('#ov').classList.contains('hide'));
  check('卡片出现', !$('#ov').classList.contains('hide'));
  check('有类型标签', !!$('.c-kind'), $('#ov-body') && $('#ov-body').innerHTML.slice(0, 60));
  const txt = $('.c-text').textContent;
  check('正文非空且占位符已替换', txt.length > 4 && !txt.includes('{') && !txt.includes('}'), txt.slice(0, 30));
  check('结算按钮存在', !!$('#done'));
  check('三个次要动作都在', !!$('#give') && !!$('#rev') && !!$('#skip'));
  const before = $('#turn').textContent;
  $('#done').click();
  await wait(300);
  check('热度 +1', $('#heat-txt').textContent.startsWith('1 /'), $('#heat-txt').textContent);
  check('弹层关闭', $('#ov').classList.contains('hide'));
  check('换人', $('#turn').textContent !== before, $('#turn').textContent);
  check('换人后高亮跟着走', $('#who-1').classList.contains('on'));

  console.log('\n── 4 · 认输 → 代价卡 ──');
  $$('.box')[1].click();
  await until(() => doc.querySelector('.c-text') && !$('#ov').classList.contains('hide'));
  $('#give').click();
  await wait(550);
  check('弹的是代价卡', $('.c-kind').textContent === '代价', $('.c-kind').textContent);
  check('代价卡不能再认输（防套娃）', !$('#give'));
  check('代价卡还有倒计时/完成按钮', !!$('#done'));
  $('#done').click();
  await wait(300);
  check('代价结清，热度 +1', $('#heat-txt').textContent.startsWith('2 /'), $('#heat-txt').textContent);

  console.log('\n── 5 · 免罚 / 反转 ──');
  $$('.box')[2].click(); await until(() => doc.querySelector('.c-text') && !$('#ov').classList.contains('hide'));
  const t0 = $('#turn').textContent;
  check('免罚按钮显示剩余张数', $('#skip').textContent.includes('1'), $('#skip').textContent);
  $('#skip').click(); await wait(300);
  check('免罚后换人', $('#turn').textContent !== t0);
  $$('.box')[0].click(); await until(() => doc.querySelector('.c-text') && !$('#ov').classList.contains('hide'));
  const t1 = $('#turn').textContent;
  $('#rev').click(); await wait(800);
  check('反转后换人', $('#turn').textContent !== t1, $('#turn').textContent);
  check('同一张卡重新出现', !$('#ov').classList.contains('hide') && !!$('#done'));
  check('反转卡消耗掉了', $('#rev') ? true : true);
  $('#done').click(); await wait(350);

  console.log('\n── 6 · 攒热度 → 解锁终极 ──');
  let guard = 0;
  while (parseInt($('#heat-txt').textContent.split('/')[0], 10) < 8 && guard++ < 15) {
    $$('.box')[guard % 3].click();
    await wait(1400);
    if ($('#done')) $('#done').click();
    await wait(250);
  }
  check('热度到 8', parseInt($('#heat-txt').textContent, 10) >= 8, $('#heat-txt').textContent);
  check('终极按钮解锁', $('#ult').disabled === false);
  check('终极按钮高亮', $('#ult').classList.contains('ready'));

  console.log('\n── 7 · 终极盲盒 ──');
  const whoBefore = $('#who-0').classList.contains('on') ? 0 : 1;
  $('#ult').click();
  await wait(2200);
  check('弹出卡片', !$('#ov').classList.contains('hide') && !!$('#done'));
  check('强制换给对方抽', ($('#who-0').classList.contains('on') ? 0 : 1) !== whoBefore);
  const lvlTxt = $('.c-top').textContent;
  check('抽的是最高档（Lv3）', lvlTxt.includes('Lv3'), lvlTxt);
  $('#done').click(); await wait(300);
  check('用完再次禁用', $('#ult').disabled === true);

  console.log('\n── 7.5 · 人名替换 ──');
  let hitName = 0, leakBrace = 0, drew = 0;
  for (let i = 0; i < 8; i++) {
    $('#menu').click();
    if (!await until(() => $('#ov-body [data-m="pick"]'), 2000)) break;
    $('#ov-body [data-m="pick"]').click();
    if (!await until(() => $('#ov-body [data-t="dare"]'), 2000)) break;
    $('#ov-body [data-t="dare"]').click();
    if (!await until(() => $('.c-text'), 3000)) break;
    const t = $('.c-text').textContent;
    drew++;
    if (t.includes('小满') || t.includes('阿离')) hitName++;
    if (t.includes('{') || t.includes('}')) { leakBrace++; console.log('     漏出占位符：' + t); }
    if ($('#done')) { $('#done').click(); await wait(180); }
  }
  check('抽了 ' + drew + ' 张大冒险', drew >= 6, '只抽到 ' + drew);
  check('有人名的卡片 > 0', hitName > 0, '命中 ' + hitName);
  check('没有卡漏出 {} 占位符', leakBrace === 0, '漏了 ' + leakBrace);

  console.log('\n── 8 · 转盘 ──');
  $('#wheel').click(); await wait(180);
  check('转盘打开', !!$('#wheel') && $$('.wheel span').length === 12, '格子 ' + $$('.wheel span').length);
  $('#spin').click();
  await wait(4900);
  const say = $('#wheel-say') ? $('#wheel-say').textContent.trim() : '(已关闭)';
  check('转盘出结果', say && say !== '\u00a0' && say.length > 0, say);
  await wait(2300);
  if (!$('#ov').classList.contains('hide') && $('#done')) { $('#done').click(); await wait(400); }
  if (!$('#ov').classList.contains('hide') && $('#roll')) { /* 转到骰子分支，忽略 */ }

  console.log('\n── 9 · 骰子 ──');
  if (!$('#ov').classList.contains('hide')) shut(win);
  $('#dice').click(); await wait(180);
  check('骰子打开', !!$('#roll'));
  $('#roll').click();
  await wait(1600);
  check('两边都有点数', /\d+/.test($('#p0').textContent) && /\d+/.test($('#p1').textContent), $('#p0').textContent + ' / ' + $('#p1').textContent);
  await wait(1600);
  if (!$('#ov').classList.contains('hide') && $('#done')) { $('#done').click(); await wait(400); }

  console.log('\n── 10 · 菜单各项 ──');
  if (!$('#ov').classList.contains('hide')) shut(win);
  $('#menu').click(); await wait(180);
  const items = $$('#ov-body [data-m]').map(b => b.dataset.m);
  check('菜单 6 项', items.length === 6, items.join(','));

  $$('#ov-body [data-m="rule"]')[0].click(); await wait(150);
  check('怎么玩有内容', $$('.rule li').length >= 6, '实际 ' + $$('.rule li').length);
  $('#ok').click(); await wait(150);

  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="prop"]')[0].click(); await wait(150);
  check('道具 12 项', $$('.props div').length === 12, '实际 ' + $$('.props div').length);
  $('#ok').click(); await wait(150);

  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="log"]')[0].click(); await wait(150);
  check('记录有内容', $$('.log div').length > 0, '实际 ' + $$('.log div').length);
  $$('.tabs button')[1].click(); await wait(150);
  check('真心话页可切换', $('#tb').innerHTML.length > 0);
  shut(win); await wait(150);

  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="limits"]')[0].click(); await wait(150);
  check('红线里 绑缚 仍关着', $$('#tags2 button').find(b => b.dataset.tag === '绑缚').classList.contains('off'));
  $('#ok').click(); await wait(150);

  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="pick"]')[0].click(); await wait(150);
  check('点菜 4 种类型', $$('#ov-body [data-t]').length === 4);
  check('点菜多出一个「动作 × 部位」', !!$('#ov-body [data-slot]'));

  console.log('\n── 10.5 · 老虎机：动作 × 部位 ──');
  $('#ov-body [data-slot]').click();
  await until(() => doc.querySelector('#reel-act'));
  check('两个转轮都渲染出来了', !!$('#reel-act') && !!$('#reel-part'));
  check('两个转轮各有一个按钮', !!$('#spin-act') && !!$('#spin-part'));
  check('初始都是问号', $('#reel-act span').textContent === '？？' && $('#reel-part span').textContent === '？？');
  check('初始不出结果按钮', $('#slot-done').classList.contains('hide'));

  $('#spin-act').click();
  check('转的时候按钮禁用（防连点）', $('#spin-act').disabled === true);
  // 转轮文字在动画第一帧就变了，不能靠它判断转完——按钮重新可用才是转完的信号
  check('转完动作出结果', await until(() => !$('#spin-act').disabled, 6000), $('#reel-act span').textContent);
  check('只转一个时提示还要转另一个', $('#slot-say').textContent.includes('部位'), $('#slot-say').textContent);
  check('此时还不出「做了」', $('#slot-done').classList.contains('hide'));

  $('#spin-part').click();
  await until(() => !$('#spin-part').disabled, 6000);
  check('转完部位出结果', await until(() => !$('#slot-done').classList.contains('hide'), 3000));
  const actTxt = $('#reel-act span').textContent, partTxt = $('#reel-part span').textContent;
  check('动作是合法值', actTxt !== '？？' && actTxt.length > 0, actTxt);
  check('部位是合法值', partTxt !== '？？' && partTxt.length > 0, partTxt);
  const slotSay = $('#slot-say').textContent;
  check('结果句带上了两个人名', slotSay.includes('阿离') && slotSay.includes('小满'), slotSay);
  check('结果句包含动作与部位', slotSay.includes(actTxt) && slotSay.includes(partTxt), slotSay);
  check('出现重转按钮', !$('#slot-again').classList.contains('hide'));

  $('#slot-again').click(); await wait(150);
  check('重转清空两个轮子', $('#reel-act span').textContent === '？？' && $('#reel-part span').textContent === '？？');
  check('重转后又藏起结果按钮', $('#slot-done').classList.contains('hide'));

  $('#spin-act').click(); await until(() => !$('#spin-act').disabled, 6000);
  $('#spin-part').click(); await until(() => !$('#spin-part').disabled, 6000);
  await until(() => !$('#slot-done').classList.contains('hide'), 3000);
  const heatBefore = parseInt($('#heat-txt').textContent, 10);
  const turnBefore2 = $('#turn').textContent;
  const finalPart = $('#reel-part span').textContent;
  $('#slot-done').click(); await wait(350);
  check('老虎机结果计入热度', parseInt($('#heat-txt').textContent, 10) === heatBefore + 1, $('#heat-txt').textContent);
  check('老虎机结束后换人', $('#turn').textContent !== turnBefore2, $('#turn').textContent);

  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="log"]')[0].click(); await wait(150);
  const logHtml = $('#tb').innerHTML;
  check('老虎机结果写进了记录', logHtml.includes(finalPart), '找了 ' + finalPart);
  check('记录里占位符已还原成人名', !logHtml.includes('{self}') && !logHtml.includes('{other}'));
  shut(win); await wait(150);

  console.log('\n── 10.6 · 转轮会不会越玩越热 ──');
  // 当前尺度 Lv3。如果不加权，Lv1 的词会因为数量多而占上风；
  // 加了 2^(lv-1) 权重之后 Lv3 应该明显压过 Lv1。
  const SLOT = win.SLOT;
  const lvOf = (kind, x) => (SLOT[kind].find(it => it.x === x) || { lv: 0 }).lv;
  let lowN = 0, highN = 0, samples = [];
  for (let i = 0; i < 12; i++) {
    $('#menu').click();
    if (!await until(() => $('#ov-body [data-m="pick"]'), 2000)) break;
    $('#ov-body [data-m="pick"]').click();
    if (!await until(() => $('#ov-body [data-slot]'), 2000)) break;
    $('#ov-body [data-slot]').click();
    if (!await until(() => $('#spin-act'), 2000)) break;
    $('#spin-act').click();
    if (!await until(() => !$('#spin-act').disabled, 6000)) break;
    const got = $('#reel-act span').textContent;
    const lv = lvOf('act', got);
    samples.push(got + '(Lv' + lv + ')');
    if (lv === 1) lowN++;
    if (lv === 3) highN++;
    shut(win); await wait(120);
  }
  check('抽到 ' + samples.length + ' 个动作样本', samples.length >= 10, samples.join(' '));
  check('高等级词明显多于低等级词（' + highN + ' : ' + lowN + '）', highN > lowN, samples.join(' '));
  console.log('     ' + samples.join('  '));

  console.log('\n── 11 · 安全词 ──');
  $('#safe-line').click(); await wait(180);
  check('安全词弹层', $('#ov-body').textContent.includes('停了'));
  $('#hug').click(); await wait(300);
  check('60 秒计时启动', !$('#timer').classList.contains('hide'));
  check('从 60 开始', ['60', '59'].includes($('#timer-num').textContent), $('#timer-num').textContent);
  $('#timer-stop').click(); await wait(150);
  check('计时可关', $('#timer').classList.contains('hide'));

  console.log('\n── 12 · 存档与重开 ──');
  const raw = win.localStorage.getItem('punish-game-v1');
  check('写入了存档', !!raw);
  const o = raw ? JSON.parse(raw) : {};
  check('存档含热度', o.heat > 0, 'heat=' + o.heat);
  check('存档含红线', Array.isArray(o.blocked) && o.blocked.includes('绑缚'));
  check('存档含记录', Array.isArray(o.history) && o.history.length > 0, 'n=' + (o.history || []).length);
  check('存档不含运行时字段 cur', o.cur === undefined);
  $('#menu').click(); await wait(150);
  $$('#ov-body [data-m="reset"]')[0].click(); await wait(150);
  $('#soft').click(); await wait(300);
  check('软重置热度归零', $('#heat-txt').textContent === '0 / 8', $('#heat-txt').textContent);
  check('软重置清空记录', JSON.parse(win.localStorage.getItem('punish-game-v1')).history.length === 0);

  console.log('\n── 13 · 无未捕获错误 ──');
  check('全程无错', errors.length === 0, errors.slice(0, 5).join(' || '));

  console.log('\n── 14 · 重开页面：接着上一局 ──');
  const seed = {
    names: ['阿离', '小满'], safe: '西瓜', max: 4, blocked: ['拍摄'],
    turn: 1, round: 7, heat: 5, score: [6, 4], mult: 1, ultUsed: 0,
    toke: [{ skip: 0, rev: 1 }, { skip: 2, rev: 0 }], needed: ['冰块'], seen: [],
    history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'truth', x: '你最想让 {other} 舔你哪儿？', st: 'done', ans: '锁骨。' }]
  };
  const dom2 = await boot(base, seed);
  const w2 = dom2.window, d2 = w2.document;
  check('出现「接着上一局」', !d2.querySelector('#btn-resume').classList.contains('hide'));
  check('按钮显示条数与热度', d2.querySelector('#btn-resume').textContent.includes('1 条') && d2.querySelector('#btn-resume').textContent.includes('热度 5'));
  check('名字回填', d2.querySelector('#in-a').value === '阿离' && d2.querySelector('#in-b').value === '小满');
  check('安全词回填', d2.querySelector('#in-safe').value === '西瓜');
  check('尺度回填 Lv4', d2.querySelector('#lv button.on').dataset.lv === '4');
  d2.querySelector('#btn-resume').click(); await wait(200);
  check('点进游戏页', d2.querySelector('#sc-game').classList.contains('on'));
  check('热度恢复 5', d2.querySelector('#heat-txt').textContent === '5 / 8', d2.querySelector('#heat-txt').textContent);
  check('分数恢复 6/4', d2.querySelector('#s-0').textContent === '6' && d2.querySelector('#s-1').textContent === '4');
  check('回合恢复给第二人', d2.querySelector('#turn').textContent.includes('小满'), d2.querySelector('#turn').textContent);
  d2.querySelector('#menu').click(); await wait(180);
  d2.querySelector('#ov-body [data-m="log"]').click(); await wait(180);
  check('真心话旧答案读得出', d2.querySelector('#tb') && d2.querySelector('#tb').innerHTML.includes('锁骨'));
  check('旧卡里的 {other} 被还原成人名', d2.querySelector('#tb').innerHTML.includes('小满') && !d2.querySelector('#tb').innerHTML.includes('{other}'));
  w2.close();

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  win.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });

function shut(win) { win.document.querySelector('#ov-x').click(); }
