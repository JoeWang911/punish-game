/* 样式表体检：确认 CSS 真的被解析器吃进去了，而不是有语法错被整段丢掉 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require('./node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

(async () => {
  const cssText = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  console.log('\n── 文本层 ──');
  const open = (cssText.match(/\{/g) || []).length;
  const close = (cssText.match(/\}/g) || []).length;
  check('大括号成对（' + open + ' 开 / ' + close + ' 闭）', open === close, '差 ' + (open - close));
  check('没有 CSS 注释没闭合', (cssText.match(/\/\*/g) || []).length === (cssText.match(/\*\//g) || []).length);
  // !important 只允许出现在这几个地方：工具类、禁用态覆盖、减弱动效
  // 先把注释整段抹成空白（保留换行，行号才对得上），否则注释里提到 !important 会误报
  const code = cssText.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const imLines = code.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /!important/.test(l));
  const imOk = imLines.every(([, l]) =>
    /display:none!important/.test(l) ||          // .hide 工具类
    /transform:none!important|filter:none!important/.test(l) ||  // 禁用态压住 hover
    /animation-duration|animation-iteration-count|transition-duration/.test(l)  // prefers-reduced-motion
  );
  check('!important 只用在工具类 / 禁用态 / 减弱动效（' + imLines.length + ' 处）', imOk,
    imLines.filter(([, l]) => !(/display:none!important|transform:none!important|filter:none!important|animation-duration|animation-iteration-count|transition-duration/.test(l)))
      .map(([n, l]) => 'L' + n + ' ' + l.trim().slice(0, 40)).join(' | '));

  console.log('\n── 解析层 ──');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.detail || e.message)));

  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  const srv = http.createServer((q, s) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    s.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const dom = await JSDOM.fromURL(base + '/index.html', {
    runScripts: 'outside-only', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await wait(300);

  const sheet = dom.window.document.styleSheets[0];
  check('外部样式表被加载', !!sheet);
  const rules = sheet ? Array.from(sheet.cssRules) : [];
  check('解析出了样式规则（' + rules.length + ' 条）', rules.length > 60, '只有 ' + rules.length + ' 条');

  // 文本里写了多少个选择器块，解析器就应该吃到差不多数量
  const declared = (cssText.match(/^[ \t]*[^\n@/][^\n{]*\{/gm) || []).length;
  check('没有成段被解析器丢弃（写了 ' + declared + ' 条，解析出 ' + rules.length + ' 条）',
    rules.length >= declared * 0.9, '丢了 ' + (declared - rules.length) + ' 条');

  // 关键选择器必须真的在解析结果里
  const sel = rules.filter(r => r.selectorText).map(r => r.selectorText).join(' | ');
  const must = [
    ['.screen', /\.screen/], ['.btn.primary', /\.btn\.primary/], ['.box', /\.box/],
    ['.mw', /\.mw/], ['.ult-word', /\.ult-word/], ['.b-box', /\.b-box/], ['.b-lid', /\.b-lid/],
    ['.swipe', /\.swipe/], ['.c-text', /\.c-text/], ['.c-kind', /\.c-kind/], ['.who-pick', /\.who-pick/],
    ['.reel', /\.reel/], ['.dice', /\.dice/], ['.timer', /\.timer/], ['.toast', /\.toast/],
    ['.tags', /\.tags/], ['.rule', /\.rule/], ['.sum-row', /\.sum-row/], ['.menu-list', /\.menu-list/],
    ['.swipe button.on', /\.swipe button\.on/], ['.box.open', /\.box\.open/],
    ['.b-box.open .b-lid', /\.b-box\.open \.b-lid/], ['.hide', /\.hide/], ['.on', /\.on/]
  ];
  const missSel = must.filter(([, re]) => !re.test(sel)).map(([n]) => n);
  check('关键选择器全部解析成功', missSel.length === 0, '缺 ' + missSel.join(', '));

  // 变量必须都有定义
  console.log('\n── 设计变量 ──');
  const defined = new Set((cssText.match(/--[\w-]+(?=\s*:)/g) || []));
  const used = new Set((cssText.match(/var\((--[\w-]+)/g) || []).map(s => s.slice(4)));
  const undef = [...used].filter(v => !defined.has(v));
  check('用到的变量都定义过（' + defined.size + ' 个变量）', undef.length === 0, '未定义 ' + undef.join(', '));
  // 每个 var() 都该有兜底，或者变量确实定义了——这里查关键色板
  const palette = ['--ink-0', '--ink-2', '--txt', '--txt-2', '--txt-3', '--rose', '--gold', '--line', '--ease'];
  check('色板变量齐全', palette.every(p => defined.has(p)), palette.filter(p => !defined.has(p)).join(', '));

  console.log('\n── 资源 ──');
  check('没有加载失败的资源', errors.filter(e => !/favicon/i.test(e)).length === 0,
    errors.slice(0, 2).join(' | '));

  console.log('\n════════════════════════');
  console.log('  通过 ' + pass + '，失败 ' + fail);
  console.log('════════════════════════');
  dom.window.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('样式测试崩溃：', e); process.exit(2); });
