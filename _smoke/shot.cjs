/* 用无头 Chrome 真的把页面跑起来截几张图，用眼睛验一下转盘和滚轮。
   不是测试，是给人看的。用法：node _smoke/shot.cjs  */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
const PORT = 9333;
const wait = ms => new Promise(r => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

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

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.logs = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const c = new CDP(ws);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { resolve, reject } = c.waiting.get(m.id);
        c.waiting.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        c.logs.push(m.params.args.map(a => a.value).join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        c.logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      }
    });
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
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
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   📸 ' + name + '.png');
  }
}

const SEED_ULT = {
  names: ['阿离', '小满'], safe: '菠萝', max: 3, blocked: [], turn: 0, round: 5,
  score: [4, 2], mult: 1, armed: [0, 0], ultPending: [true, false], prompted16: false,
  toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }], needed: [], seen: [],
  history: [{ at: Date.now(), who: '阿离', lvl: 3, t: 'dare', x: '占位记录', st: 'done', ans: '' }],
  truths: [], sessions: 0
};
const SEED_WHEEL = JSON.parse(JSON.stringify(SEED_ULT));
SEED_WHEEL.ultPending = [false, false];

async function drive(cdp, base, seed, steps) {
  await cdp.send('Page.navigate', { url: base + '/index.html' });
  await wait(700);
  await cdp.eval('localStorage.setItem("punish-game-v1", ' + JSON.stringify(JSON.stringify(seed)) + '); return 1;');
  await cdp.send('Page.navigate', { url: base + '/index.html' });
  await wait(900);
  await steps(cdp);
}

(async () => {
  if (!CHROME) { console.log('没找到 Chrome，跳过截图'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=2',
    '--window-size=430,932', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try { ver = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/version')); } catch (e) { await wait(250); }
  }
  if (!ver) { console.log('Chrome 没起来'); chrome.kill(); srv.close(); return; }
  console.log('Chrome ' + ver['Browser']);

  const list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list'));
  const page = list.find(t => t.type === 'page');
  const cdp = await CDP.attach(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true
  });

  console.log('\n── 转盘 ──');
  await drive(cdp, base, SEED_WHEEL, async c => {
    await c.eval('document.querySelector("#btn-resume").click(); return 1;');
    await wait(600);
    await c.shot('01-wheel-before');
    await c.eval('document.querySelector("#spin-main").click(); return 1;');
    await wait(700);
    await c.shot('02-wheel-spinning');
    await wait(3600);
    await c.shot('03-wheel-after');
    console.log('   结果：' + await c.eval('return document.querySelector("#mw-say").textContent;'));
  });

  console.log('\n── 翻牌子滚轮 ──');
  await drive(cdp, base, SEED_ULT, async c => {
    await c.eval('document.querySelector("#btn-resume").click(); return 1;');
    await wait(900);
    await c.eval('document.querySelector("#ult-go").click(); return 1;');
    await wait(700);
    await c.eval('document.querySelector(\'#ult-body [data-u="slot"]\').click(); return 1;');
    await wait(700);
    await c.shot('04-drum-open');
    // 按几下下箭头，看中间那格有没有跟着变大变白
    await c.eval('var a=document.querySelectorAll(\'#ult-body .drum-arrow[data-dir="1"]\'); a[0].click(); a[1].click(); return 1;');
    await wait(700);
    await c.shot('05-drum-moved');
    console.log('   确定按钮：' + await c.eval('return document.querySelector("#u-go").textContent;'));
  });

  // 滚轮单独放大看细节
  await drive(cdp, base, SEED_ULT, async c => {
    await c.eval('document.querySelector("#btn-resume").click(); return 1;');
    await wait(900);
    await c.eval('document.querySelector("#ult-go").click(); return 1;');
    await wait(700);
    await c.eval('document.querySelector(\'#ult-body [data-u="slot"]\').click(); return 1;');
    await wait(600);
    await c.eval('var e=document.querySelector("#drum-act"); e.scrollIntoView(); return 1;');
    await wait(400);
    const box = await c.eval(
      'var r=document.querySelector("#drum-act").getBoundingClientRect();' +
      'var b=document.querySelector("#drum-act .drum-band").getBoundingClientRect();' +
      'var s=document.querySelector("#drum-act .drum-it.sel").getBoundingClientRect();' +
      'return JSON.stringify({drum:[r.top,r.height],band:[b.top,b.height],sel:[s.top,s.height],' +
      'bandMid:b.top+b.height/2,drumMid:r.top+r.height/2,selMid:s.top+s.height/2,' +
      'selFont:getComputedStyle(document.querySelector("#drum-act .drum-it.sel")).fontSize,' +
      'selWeight:getComputedStyle(document.querySelector("#drum-act .drum-it.sel")).fontWeight,' +
      'selColor:getComputedStyle(document.querySelector("#drum-act .drum-it.sel")).color});'
    );
    console.log('   几何校验：' + box);
  });

  cdp.ws.close();
  chrome.kill();
  srv.close();
  await wait(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
})().catch(e => { console.error('截图失败：', e); process.exit(1); });
