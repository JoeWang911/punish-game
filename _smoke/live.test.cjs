/* 线上验证：直接对 GitHub Pages 的真实地址跑一局 */
const { JSDOM, VirtualConsole } = require('./node_modules/jsdom');

const LIVE = process.argv[2] || 'https://joewang911.github.io/punish-game/';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 70) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(step); }
  return false;
}

const errors = [], failed = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String(e.detail || e.message);
  errors.push(m);
  if (/Could not load|404|Error:/.test(m)) failed.push(m);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

(async function () {
  console.log('目标：' + LIVE + '\n');
  console.log('── 加载线上页面 ──');
  const dom = await JSDOM.fromURL(LIVE, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = dom.window, doc = win.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));
  win.scrollTo = () => {};
  win.addEventListener('error', e => { errors.push('window.error: ' + e.message); });

  await new Promise(r => win.addEventListener('load', r));
  await wait(400);

  check('页面标题正确', doc.title === '惩罚游戏', doc.title);
  check('styles.css 从线上加载成功', Array.from(doc.styleSheets).length > 0);
  check('cards.js 生效（尺度 4 档已渲染）', $$('#lv button').length === 4, '实际 ' + $$('#lv button').length);
  check('app.js 生效（红线 9 项已渲染）', $$('#tags button').length === 9, '实际 ' + $$('#tags button').length);
  check('JS 文件都是 200（无 404）', failed.length === 0, failed.slice(0, 3).join(' | '));

  console.log('\n── 线上真打一局 ──');
  $('#in-a').value = '阿离';
  $('#in-b').value = '小满';
  $$('#lv button').find(b => b.dataset.lv === '3').click();
  $('#to-limits').click();
  check('能进红线页', $('#sc-limits').classList.contains('on'));
  $('#start').click();
  check('能进游戏页', $('#sc-game').classList.contains('on'));
  check('名字带进去了', $('#n-0').textContent === '阿离' && $('#n-1').textContent === '小满');

  $$('.box')[0].click();
  check('盲盒能开，弹出卡片', await until(() => $('.c-text') && !$('#ov').classList.contains('hide')));
  const txt = $('.c-text').textContent;
  check('卡片正文正常', txt.length > 4 && !txt.includes('{'), txt.slice(0, 32));

  if ($('#done')) { $('#done').click(); await wait(300); }
  check('结算后热度 +1', $('#heat-txt').textContent.startsWith('1 /'), $('#heat-txt').textContent);

  // 再连抽几张，确认牌堆在线上也没问题
  let n = 0;
  for (let i = 0; i < 4; i++) {
    $$('.box')[i % 3].click();
    if (await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 6000)) n++;
    if ($('#done')) { $('#done').click(); await wait(250); }
  }
  check('连抽 4 张都正常（共 ' + (n + 1) + ' 张）', n === 4, '成功 ' + n);

  console.log('\n── 转盘 / 安全词 ──');
  $('#wheel').click();
  check('转盘能开', await until(() => $('#spin')));
  check('转盘 12 格', $$('.wheel span').length === 12, '实际 ' + $$('.wheel span').length);
  $('#ov-x').click(); await wait(150);
  $('#safe-line').click();
  check('安全词能停', await until(() => $('#hug')));
  $('#ov-x').click(); await wait(150);

  console.log('\n── 线上无报错 ──');
  const real = errors.filter(e => !/favicon/i.test(e));
  check('没有资源加载失败或 JS 报错', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  win.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('线上测试崩溃：', e); process.exit(2); });
