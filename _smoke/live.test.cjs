/* 线上验证：直接对 GitHub Pages 的真实地址跑一局 */
const { JSDOM, VirtualConsole } = require('./node_modules/jsdom');

const LIVE = process.argv[2] || 'https://joewang911.github.io/punish-game/';
const TYPES = ['真心话', '大冒险', '惩罚', '一起做', '翻牌子'];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 9000, step = 70) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(step); }
  return false;
}

const errors = [], failed = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String(e.detail || e.message);
  errors.push(m);
  if (/Could not load|404/.test(m)) failed.push(m);
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
  const shut = () => $('#ov-x').click();
  win.scrollTo = () => {};
  win.addEventListener('error', e => errors.push('window.error: ' + e.message));

  await new Promise(r => win.addEventListener('load', r));
  await wait(400);

  check('页面标题正确', doc.title === '惩罚游戏', doc.title);
  check('样式表从线上加载成功', Array.from(doc.styleSheets).length > 0);
  check('cards.js 生效（尺度 4 档）', $$('#lv button').length === 4, '实际 ' + $$('#lv button').length);
  check('红线 11 项（含性行为 / 拍打）', $$('#tags button').length === 11, '实际 ' + $$('#tags button').length);
  check('红线里有「性行为」', $$('#tags button').some(b => b.dataset.tag === '性行为'));
  check('红线里有「拍打」', $$('#tags button').some(b => b.dataset.tag === '拍打'));
  check('JS 文件都是 200（无 404）', failed.length === 0, failed.slice(0, 3).join(' | '));

  console.log('\n── 线上开局 ──');
  $('#in-a').value = '阿离';
  $('#in-b').value = '小满';
  $$('#lv button').find(b => b.dataset.lv === '2').click();
  $('#to-limits').click();
  check('能进红线页', $('#sc-limits').classList.contains('on'));
  $('#start').click();
  check('能进游戏页', $('#sc-game').classList.contains('on'));
  check('名字带进去了', $('#n-0').textContent === '阿离' && $('#n-1').textContent === '小满');
  check('第一步是转盘', !$('#step-spin').classList.contains('hide') && $('#step-pick').classList.contains('hide'));
  check('线上转盘 5 个扇区', $$('#mw span').length === 5, '实际 ' + $$('#mw span').length);
  check('没有终极按钮了', $('#ult') === null);
  check('有等级按钮，显示 Lv2', $('#lv-chip') && $('#lv-chip').textContent.includes('Lv2'), $('#lv-chip') && $('#lv-chip').textContent);
  check('升级进度显示 /16', /\/ 16$/.test($('#heat-txt').textContent), $('#heat-txt').textContent);

  console.log('\n── 线上手动换人 ──');
  $('#who-1').click(); await wait(200);
  check('点名字能换人', $('#who-1').classList.contains('on') && $('#turn').textContent.includes('小满'), $('#turn').textContent);
  $('#who-0').click(); await wait(200);
  check('能换回来', $('#who-0').classList.contains('on'));

  console.log('\n── 线上等级切换 ──');
  $('#lv-chip').click();
  check('等级选择能打开', await until(() => $$('#ov-body [data-lv]').length === 4, 3000));
  $('#ov-body [data-lv="3"]').click(); await wait(400);
  check('切到 Lv3 后按钮变了', $('#lv-chip').textContent.includes('Lv3'), $('#lv-chip').textContent);

  console.log('\n── 线上严格等级 ──');
  let leaked = [], drew = 0;
  for (let i = 0; i < 5; i++) {
    if (!$('#ov').classList.contains('hide')) { shut(); await wait(250); }
    $('#menu').click();
    if (!await until(() => $('#ov-body [data-m="pick"]'), 3000)) break;
    $('#ov-body [data-m="pick"]').click();
    const t = ['dare', 'punish', 'truth', 'duo'][i % 4];
    if (!await until(() => $('#ov-body [data-t="' + t + '"]'), 2000)) break;
    $('#ov-body [data-t="' + t + '"]').click();
    if (!await until(() => !$('#step-pick').classList.contains('hide'), 3000)) break;
    $$('.box')[i % 3].click();
    if (!await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 6000)) break;
    if ($('.c-kind').textContent === '幸运') { $('#done').click(); await wait(500); continue; }
    const lv = $('.c-top').textContent.match(/Lv(\d)/);
    if (!lv) leaked.push('没等级标记');
    else if (lv[1] !== '3') leaked.push('Lv3 里出到 Lv' + lv[1]);
    drew++;
    if ($('#done')) { $('#done').click(); await wait(500); }
  }
  check('线上抽了 ' + drew + ' 张 Lv3 的题', drew >= 3, '只抽到 ' + drew);
  check('🔥 线上也没混进别的等级', leaked.length === 0, leaked.slice(0, 3).join(' ; '));

  console.log('\n── 线上走完整流程 ──');
  let done = 0;
  for (let round = 0; round < 3; round++) {
    if (!$('#ov').classList.contains('hide')) { shut(); await wait(300); }
    if ($('#reel-act')) { shut(); await wait(200); }
    if (!$('#step-pick').classList.contains('hide')) {
      $$('.box')[round % 3].click();
    } else {
      $('#spin-main').click();
      if (!await until(() => TYPES.includes($('#mw-say').textContent), 9000)) break;
      await wait(1100);
      if ($('#reel-act')) {
        $('#spin-act').click(); if (!await until(() => !$('#spin-act').disabled, 7000)) break;
        $('#spin-part').click(); if (!await until(() => !$('#spin-part').disabled, 7000)) break;
        const a = $('#reel-act span').textContent, p = $('#reel-part span').textContent;
        check('转盘出「翻牌子」→ 轮子出了 ' + a + ' × ' + p, a !== '？？' && p !== '？？');
        if ($('#slot-done') && !$('#slot-done').classList.contains('hide')) { $('#slot-done').click(); done++; }
        await wait(500);
        continue;
      }
      if (!await until(() => !$('#step-pick').classList.contains('hide'), 3000)) break;
      const got = $('#mw-say').textContent;
      check('转盘出「' + got + '」→ 盒子提示同一类型', $('#pick-type').textContent === got, $('#pick-type').textContent);
      $$('.box')[round % 3].click();
    }
    if (!await until(() => $('.c-text') && !$('#ov').classList.contains('hide'), 6000)) break;
    const kind = $('.c-kind').textContent;
    check('抽出来的卡对得上（' + kind + '）', ['真心话', '大冒险', '惩罚', '一起做', '幸运'].includes(kind), kind);
    if ($('#done')) { $('#done').click(); done++; }
    await wait(500);
  }
  check('线上完整打完 ' + done + ' 手', done >= 3, '只完成 ' + done);

  console.log('\n── 线上菜单 / 安全词 ──');
  if (!$('#ov').classList.contains('hide')) shut();
  await wait(250);
  if ($('#lu-no')) { $('#lu-no').click(); await wait(250); }
  $('#menu').click();
  check('菜单能开', await until(() => $('#ov-body [data-m="finish"]'), 3000));
  check('菜单里有「结束这一局」', !!$('#ov-body [data-m="finish"]'));
  check('菜单里有「清空所有数据」', !!$('#ov-body [data-m="wipe"]'));
  $('#ov-body [data-m="rule"]').click();
  check('怎么玩里写了终极模式和升级', await until(() => $('#ov-body').textContent.includes('终极模式') && $('#ov-body').textContent.includes('升级'), 3000));
  shut(); await wait(200);

  $('#safe-line').click();
  check('安全词能停', await until(() => $('#hug'), 3000));
  shut(); await wait(150);

  console.log('\n── 线上无报错 ──');
  const real = errors.filter(e => !/favicon/i.test(e));
  check('没有资源加载失败或 JS 报错', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  win.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('线上测试崩溃：', e); process.exit(2); });
