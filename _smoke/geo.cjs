/* 看不到图，就把「看得见的东西」全量成数字：
   转盘文字到底正不正（用外接矩形反推），滚轮中间那格到底在不在正中、有没有变大变白。
   用法：node _smoke/geo.cjs  */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9334;
const wait = ms => new Promise(r => setTimeout(r, ms));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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
const get = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
});

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async attach(u) {
    const ws = new WebSocket(u); const c = new CDP(ws);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const w = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result);
      }
    });
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
}

const SEED = {
  names: ['阿离', '小满'], safe: '菠萝', max: 3, blocked: [], turn: 0, round: 5,
  score: [4, 2], mult: 1, armed: [0, 0], ultPending: [true, false], prompted16: false,
  toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
  history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'dare', x: '占位记录', st: 'done', ans: '' }],
  truths: [], sessions: 0
};
const SEED_W = JSON.parse(JSON.stringify(SEED));
SEED_W.ultPending = [false, false];

const ok = (c, msg) => console.log('  ' + (c ? '✅' : '❌') + ' ' + msg);
let fails = 0;
const CK = (c, msg) => { if (!c) fails++; ok(c, msg); };

const LABELS_JS = `
  var wm = document.querySelector('#mw');
  var wr = wm.getBoundingClientRect();
  var wcx = wr.left + wr.width/2, wcy = wr.top + wr.height/2;
  return JSON.stringify({
    wheel: { r: wr.width/2, cx: wcx, cy: wcy },
    labels: Array.from(document.querySelectorAll('#mw .mw-lb')).map(function (lb) {
      var b = lb.querySelector('b');
      var r = b.getBoundingClientRect();
      var cs = getComputedStyle(b);
      var m = /matrix\\(([^)]+)\\)/.exec(cs.transform);
      var nb = /none/.test(cs.transform) ? 0 : (m ? Math.atan2(+m[1].split(',')[1], +m[1].split(',')[0]) : NaN);
      return {
        text: b.textContent,
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        cx: +(r.left + r.width/2 - wcx).toFixed(1), cy: +(r.top + r.height/2 - wcy).toFixed(1),
        dist: +Math.hypot(r.left + r.width/2 - wcx, r.top + r.height/2 - wcy).toFixed(1),
        ownDeg: +(nb * 180 / Math.PI).toFixed(2),
        font: cs.fontSize, weight: cs.fontWeight, color: cs.color
      };
    })
  });
`;

const DRUM_JS = (id) => `
  var box = document.querySelector('#${id}');
  var br = box.getBoundingClientRect();
  var bm = br.top + br.height/2;
  var band = box.querySelector('.drum-band').getBoundingClientRect();
  return JSON.stringify({
    box: { h: br.height, mid: +bm.toFixed(2) },
    band: { h: band.height, mid: +(band.top + band.height/2).toFixed(2) },
    items: Array.from(box.querySelectorAll('.drum-it')).map(function (el, i) {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      var m = /matrix3?d?\\(([^)]+)\\)/.exec(cs.transform);
      // rotateX + scale 是 3D 变换，computed style 给的是 matrix3d，第 1 个数就是 x 方向缩放
      var sc = 1;
      if (m) {
        var parts = m[1].split(',').map(Number);
        sc = parts.length > 6 ? parts[0] : parts[0];
      }
      return {
        i: i, text: el.textContent, sel: el.classList.contains('sel'),
        disp: cs.display,
        mid: +(r.top + r.height/2 - bm).toFixed(1),
        h: +r.height.toFixed(1),
        scale: +sc.toFixed(3),
        op: +(+cs.opacity).toFixed(2),
        font: cs.fontSize, weight: cs.fontWeight, color: cs.color
      };
    })
  });
`;

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-geo-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--window-size=430,932',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try { ver = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/version')); } catch (e) { await wait(250); }
  }
  const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
  const cdp = await CDP.attach(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });

  async function load(seed) {
    await cdp.send('Page.navigate', { url: base + '/index.html' });
    await wait(700);
    await cdp.eval('localStorage.setItem("punish-game-v1", ' + JSON.stringify(JSON.stringify(seed)) + '); return 1;');
    await cdp.send('Page.navigate', { url: base + '/index.html' });
    await wait(900);
  }

  console.log('\n══ 转盘：字到底正不正 ══');
  await load(SEED_W);
  await cdp.eval('document.querySelector("#btn-resume").click(); return 1;');
  await wait(700);

  for (const [when, act] of [
    ['转之前', async () => {}],
    ['转的当中（第 900ms）', async () => { await cdp.eval('document.querySelector("#spin-main").click(); return 1;'); await wait(900); }],
    // land() 在 DUR+70ms 触发，再等 850ms 才自动跳去开盒那一步，所以要卡在这中间量
    ['刚停下来', async () => { await wait(3300); }]
  ]) {
    await act();
    const d = JSON.parse(await cdp.eval(LABELS_JS));
    const hs = d.labels.map(l => l.h);
    console.log('  · ' + when + '  转盘半径 ' + d.wheel.r.toFixed(0) + 'px');
    console.log('    ' + d.labels.map(l => l.text + '(h=' + l.h + ' w=' + l.w + ' 半径' + l.dist + ' 自转' + l.ownDeg + '° ' + l.font + '/' + l.weight + ')').join(', '));
    // 单行中文横排：外接矩形高度必然在 14~24px。一旦被转歪，高度会逼近文字宽度。
    CK(d.wheel.r > 50, when + '：转盘可见（半径 ' + d.wheel.r.toFixed(0) + 'px）');
    CK(Math.max(...hs) < 26, when + '：每块字的外接矩形都还是「一行」那么扁（最高 ' + Math.max(...hs) + 'px）');
    CK(d.labels.every(l => l.h < l.w), when + '：宽 > 高，说明字是横着的');
    CK(d.labels.every(l => Math.abs(l.dist - 76) < 14), when + '：每块字的中心都落在半径 76px 那圈上');
    CK(d.labels.every(l => l.font === '12.5px' && +l.weight >= 700), when + '：字又粗又大，没被转盘带着缩水');
  }

  console.log('\n══ 翻牌子滚轮：中间那格在不在正中、有没有变大变白 ══');
  await load(SEED);
  await cdp.eval('document.querySelector("#btn-resume").click(); return 1;');
  await wait(900);
  await cdp.eval('document.querySelector("#ult-go").click(); return 1;');
  await wait(700);
  await cdp.eval('document.querySelector(\'#ult-body [data-u="slot"]\').click(); return 1;');
  await wait(700);

  const d1 = JSON.parse(await cdp.eval(DRUM_JS('drum-act')));
  console.log('  滚轮窗口高 ' + d1.box.h + '，中线 y=' + d1.box.mid + '；选中带高 ' + d1.band.h + '，中线 y=' + d1.band.mid);
  CK(Math.abs(d1.box.mid - d1.band.mid) < 1, '选中带正好卡在滚轮正中间（差 ' + Math.abs(d1.box.mid - d1.band.mid).toFixed(2) + 'px）');
  const sel = d1.items.filter(i => i.sel);
  CK(sel.length === 1, '有且只有一格是选中的');
  CK(Math.abs(sel[0].mid) < 1, '选中那格正好在滚轮正中（偏 ' + sel[0].mid + 'px）');
  CK(Math.abs(sel[0].mid - (d1.band.mid - d1.box.mid)) < 1, '选中那格正好压在选中带上');
  const vis = d1.items.filter(i => i.disp !== 'none');
  console.log('  可见的格：' + vis.map(i => i.text + '[y' + i.mid + ' 缩放' + i.scale + ' 透明' + i.op + ' ' + i.font + '/' + i.weight + ']').join('  '));
  CK(sel[0].weight === '800' || +sel[0].weight >= 700, '中间那格加粗了（' + sel[0].weight + '）');
  CK(parseFloat(sel[0].font) > Math.max(...vis.filter(i => !i.sel).map(i => parseFloat(i.font))), '中间那格字最大（' + sel[0].font + '）');
  CK(sel[0].op === 1, '中间那格完全不透明');
  CK(sel[0].scale >= Math.max(...vis.filter(i => !i.sel).map(i => i.scale)), '中间那格缩放最大（' + sel[0].scale + '）');
  CK(vis.filter(i => !i.sel).every(i => i.op < 1), '旁边的格都压暗了（' + vis.filter(i => !i.sel).map(i => i.op).join('/') + '）');
  const sorted = vis.slice().sort((a, b) => Math.abs(a.mid) - Math.abs(b.mid));
  CK(sorted.every((x, i) => i === 0 || x.op <= sorted[i - 1].op + 0.01), '越靠边越暗，是个渐变不是一刀切');
  CK(sorted.every((x, i) => i === 0 || x.scale <= sorted[i - 1].scale + 0.01), '越靠边越小，是个渐变不是一刀切');
  CK(sorted[0].scale > sorted[sorted.length - 1].scale, '中间最靠里那格比最外圈那格大（' + sorted[0].scale + ' > ' + sorted[sorted.length - 1].scale + '）');
  CK(sorted.every((x, i) => i === 0 || Math.abs(x.mid) > Math.abs(sorted[i - 1].mid) - 0.01), '每一格的间距都是等分的一格高');
  CK(d1.items.filter(i => i.disp === 'none').length > 0, '离得远的格直接不画（省性能，一共有 ' + d1.items.filter(i => i.disp === 'none').length + ' 格没画）');
  console.log('  选中格颜色 ' + sel[0].color + '（旁边是 ' + vis.find(i => !i.sel).color + '）');
  CK(sel[0].color !== vis.find(i => !i.sel).color, '中间那格换了颜色，和旁边不一样');

  // 点箭头 / 滚轮 / 直接点某一条，三种操作都要能换格
  console.log('\n  · 三种操作都能换格：');
  const before = d1.items.findIndex(i => i.sel);
  await cdp.eval('document.querySelectorAll(\'#ult-body .drum-arrow[data-for="drum-act"][data-dir="1"]\')[0].click(); return 1;');
  await wait(600);
  let now = JSON.parse(await cdp.eval(DRUM_JS('drum-act')));
  CK(now.items.findIndex(i => i.sel) === before + 1, '点 ▼ 往下走一格（' + before + ' → ' + now.items.findIndex(i => i.sel) + '）');
  await cdp.eval('document.querySelectorAll(\'#ult-body .drum-arrow[data-for="drum-act"][data-dir="-1"]\')[0].click(); return 1;');
  await wait(600);
  now = JSON.parse(await cdp.eval(DRUM_JS('drum-act')));
  CK(now.items.findIndex(i => i.sel) === before, '点 ▲ 转回原来那格');

  // 鼠标真拖：按住往上拖。每一小步之间真的等一帧，速度才是真实的手速
  await cdp.eval(`
    var box = document.querySelector('#drum-act');
    var r = box.getBoundingClientRect();
    window.__x = r.left + r.width / 2;
    window.__y0 = r.top + r.height / 2;
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: window.__x, clientY: window.__y0, button: 0 }));
    return 1;
  `);
  CK(await cdp.eval('return document.querySelector("#drum-act").classList.contains("dragging");'),
    '鼠标按下去就开始跟手（dragging 状态）');
  for (let i = 1; i <= 8; i++) {
    await cdp.eval('document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: window.__x, clientY: window.__y0 - ' + (i * 14) + ', button: 0 })); return 1;');
    await wait(16);
  }
  const midDrag = JSON.parse(await cdp.eval(DRUM_JS('drum-act')));
  CK(midDrag.items.some(i => i.sel && i.i > before), '拖到第 ' + (midDrag.items.findIndex(i => i.sel)) + ' 格了（还没松手）');
  await cdp.eval('document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: window.__x, clientY: window.__y0 - 112, button: 0 })); return 1;');
  await wait(1400);
  const dragged = JSON.parse(await cdp.eval(DRUM_JS('drum-act')));
  const dsel = dragged.items.findIndex(i => i.sel);
  console.log('    拖完停在：' + dragged.items[dsel].text + '（第 ' + dsel + ' 格，本来是第 ' + before + ' 格）');
  CK(dsel > before, '按住往上拖真的把滚轮拖走了（' + before + ' → ' + dsel + '）');
  CK(dsel <= dragged.items.length - 1, '没被甩飞出去（最远第 ' + (dragged.items.length - 1) + ' 格）');
  CK(Math.abs(dragged.items[dsel].mid) < 1, '松手后自动吸附回正中（偏 ' + dragged.items[dsel].mid + 'px）');
  CK(dragged.items.filter(i => i.sel).length === 1, '拖完还是只有一格选中');

  cdp.ws.close(); chrome.kill(); srv.close();
  await wait(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (fails ? '❌ 有 ' + fails + ' 项不对' : '✅ 全对'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('跑挂了：', e); process.exit(2); });
