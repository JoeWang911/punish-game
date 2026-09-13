/* ============================================================
 *  惩罚游戏 · 逻辑
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var rnd = function (n) { return Math.floor(Math.random() * n); };
  var pick = function (a) { return a[rnd(a.length)]; };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var hide = function (el, yes) { el.classList.toggle('hide', yes); };

  var LS = 'punish-game-v1';
  var HEAT_STEP = 8;

  var S = null;
  var spinDeg = 0;
  var busy = false;
  var tick = null;
  var pending = null;      // 转盘定下来的类型
  var inTurn = false;      // 手上有张没结算的卡

  /* ── 声音 ── */
  var AC = null;
  function beep(f, d, type) {
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.14, AC.currentTime + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
      o.connect(g); g.connect(AC.destination);
      o.start(); o.stop(AC.currentTime + d + 0.02);
    } catch (e) {}
  }
  function chord(list) { list.forEach(function (f, i) { setTimeout(function () { beep(f, 0.26, 'triangle'); }, i * 85); }); }
  function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  /* ── 状态 ──
     history 只装「这一局」，truths 跨局永久保留——
     结束一局只清前者，真心话是这游戏唯一值钱的东西，不能被重开冲掉。 */
  function blank() {
    return {
      names: ['宝贝', '亲爱的'], safe: '菠萝', max: 2, blocked: [],
      turn: 0, round: 1, heat: 0, score: [0, 0], mult: 1, ultUsed: 0,
      toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }],
      history: [],          // 本局
      truths: [],           // 跨局保留
      sessions: 0,
      needed: [], seen: []
    };
  }
  function save() {
    var keep = ['names', 'safe', 'max', 'blocked', 'turn', 'round', 'heat', 'score',
                'mult', 'ultUsed', 'toke', 'history', 'truths', 'sessions', 'needed', 'seen'];
    var o = {};
    keep.forEach(function (k) { o[k] = S[k]; });
    try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return null;
      var d = JSON.parse(raw);
      var s = blank();
      Object.keys(s).forEach(function (k) { if (d[k] !== undefined) s[k] = d[k]; });
      // 老存档兼容：以前真心话是混在 history 里的
      if (!Array.isArray(s.truths)) s.truths = [];
      s.history.forEach(function (r) {
        if (r.ans && !s.truths.some(function (t) { return t.at === r.at && t.ans === r.ans; })) {
          s.truths.push({ at: r.at, who: r.who, x: r.x, ans: r.ans });
        }
      });
      return s;
    } catch (e) { return null; }
  }

  var selfN = function () { return S.names[S.turn]; };
  var otherN = function () { return S.names[1 - S.turn]; };

  /* ── 卡池索引 ── */
  var POOL = [];
  Object.keys(window.CARD_POOL).forEach(function (lvl) {
    var g = window.CARD_POOL[lvl];
    Object.keys(g).forEach(function (t) {
      g[t].forEach(function (c, i) {
        POOL.push({ id: lvl + t + i, lvl: +lvl, t: c.t, x: c.x, s: c.s || 0, p: c.p || [], g: c.g || [] });
      });
    });
  });

  var LVW = { 1: 1, 2: 1.45, 3: 1.9, 4: 2.4 };

  function ok(c) {
    if (c.lvl > S.max) return false;
    for (var i = 0; i < c.g.length; i++) if (S.blocked.indexOf(c.g[i]) >= 0) return false;
    return true;
  }
  function weight(list, f) {
    var total = 0, ws = list.map(function (c) { var w = f(c); total += w; return w; });
    if (total <= 0) return pick(list);
    var r = Math.random() * total;
    for (var i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function special(t) {
    var arr = window.SPECIAL[t], i = rnd(arr.length);
    return { id: t + i, idx: i, lvl: 0, t: t, x: arr[i].x, s: arr[i].s || 0, p: arr[i].p || [], g: arr[i].g || [] };
  }

  /** 抽一张指定类型的卡。type 为空就自己按权重挑一个。 */
  function draw(type, top) {
    if (type === 'reverse' || type === 'lucky') return special(type);
    if (!type) {
      var ks = ['truth', 'dare', 'punish', 'duo'];
      type = pick(ks);
    }
    var list = POOL.filter(function (c) { return c.t === type && ok(c); });
    if (top && list.length) {
      var hi = Math.max.apply(null, list.map(function (c) { return c.lvl; }));
      list = list.filter(function (c) { return c.lvl === hi; });
    }
    if (!list.length) list = POOL.filter(function (c) { return ok(c); });
    if (!list.length) list = POOL.filter(function (c) { return c.lvl <= S.max; });
    if (!list.length) list = POOL.slice();
    var fresh = list.filter(function (c) { return S.seen.indexOf(c.id) < 0; });
    if (!fresh.length) { S.seen = []; fresh = list; }
    var c = weight(fresh, function (x) { return LVW[x.lvl] || 1; });
    S.seen.push(c.id);
    return { id: c.id, lvl: c.lvl, t: c.t, x: c.x, s: c.s, p: c.p, g: c.g };
  }
  function drawCost() {
    var a = window.SPECIAL.cost, i = rnd(a.length);
    return { id: 'cost' + i, idx: i, lvl: 0, t: 'cost', x: a[i].x, s: a[i].s || 0, p: [], g: a[i].g || [] };
  }

  /* ── 屏幕 ── */
  function go(id) {
    $$('.screen').forEach(function (s) { s.classList.remove('on'); });
    $('#' + id).classList.add('on');
    window.scrollTo(0, 0);
  }

  function buildLv() {
    var box = $('#lv');
    box.innerHTML = '';
    Object.keys(window.LEVELS).forEach(function (k) {
      var L = window.LEVELS[k];
      var b = document.createElement('button');
      b.dataset.lv = k;
      if (+k === 2) b.className = 'on';
      b.innerHTML = '<em>' + L.i + '</em><span>' + esc(L.n) + '<small>' + esc(L.d) + '</small></span>';
      b.onclick = function () {
        $$('#lv button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        beep(660, 0.06, 'square');
      };
      box.appendChild(b);
    });
  }

  function buildTags() {
    var box = $('#tags');
    box.innerHTML = '';
    window.TAGS.forEach(function (t) {
      var b = document.createElement('button');
      b.dataset.tag = t.id;
      if (S.blocked.indexOf(t.id) >= 0) b.className = 'off';
      b.innerHTML = esc(t.id) + '<small>' + esc(t.d) + '</small>';
      b.onclick = function () { toggleTag(t.id, b); };
      box.appendChild(b);
    });
  }
  function toggleTag(id, el) {
    var i = S.blocked.indexOf(id);
    if (i >= 0) { S.blocked.splice(i, 1); el.classList.remove('off'); beep(720, 0.06, 'square'); }
    else { S.blocked.push(id); el.classList.add('off'); beep(300, 0.07, 'square'); }
    save();
  }

  /* ── HUD ── */
  function hud() {
    [0, 1].forEach(function (i) {
      $('#n-' + i).textContent = S.names[i];
      $('#s-' + i).textContent = S.score[i];
      $('#who-' + i).classList.toggle('on', S.turn === i);
      $('#who-' + i).title = '点一下，轮到 ' + S.names[i];
    });
    var inStep = S.heat % HEAT_STEP;
    $('#heat-fill').style.width = (S.heat === 0 ? 0 : Math.max(6, inStep / HEAT_STEP * 100)) + '%';
    $('#heat-txt').textContent = S.heat + ' / ' + (Math.floor(S.heat / HEAT_STEP) + 1) * HEAT_STEP;
    $('#turn').innerHTML = '轮到 <b>' + esc(selfN()) + '</b>';
    var c = charges();
    $('#ult').disabled = c <= 0;
    $('#ult').classList.toggle('ready', c > 0);
  }
  function charges() { return Math.floor(S.heat / HEAT_STEP) - (S.ultUsed || 0); }

  /* 手动换人：别的游戏输了的人可以直接被点成受罚方 */
  function setTurn(i) {
    if (S.turn === i) return;
    S.turn = i;
    save(); hud();
    beep(560, 0.06, 'square');
    toast('轮到 ' + selfN());
  }

  /* ── 弹层 ── */
  function sheet(html) {
    $('#ov-body').innerHTML = html;
    $('#ov').classList.remove('hide');
  }
  function shut() {
    $('#ov').classList.add('hide');
    $('#ov-body').innerHTML = '';
  }

  /* 关掉弹层。
     如果手里还攥着一张没结算的卡（尤其翻牌子转到一半），
     直接关会卡死：转盘按钮还是禁用的，盒子也已经没了。
     所以这时候把回合退回到转盘那一步。 */
  function dismiss() {
    if (inTurn) {
      inTurn = false;
      shut();
      showSpin();
      toast('这张先算了');
      return;
    }
    shut();
  }

  var KIND = {
    truth:   { n: '真心话', c: '' },
    dare:    { n: '大冒险', c: '' },
    punish:  { n: '惩罚',   c: 't-punish' },
    duo:     { n: '一起做', c: 't-duo' },
    reverse: { n: '反转',   c: 't-reverse' },
    lucky:   { n: '幸运',   c: 't-lucky' },
    cost:    { n: '代价',   c: 't-cost' }
  };

  function fill(text) {
    return esc(text)
      .replace(/\{self\}/g, '<em>' + esc(selfN()) + '</em>')
      .replace(/\{other\}/g, '<em>' + esc(otherN()) + '</em>');
  }

  function show(card, isCost) {
    busy = false;
    inTurn = true;
    S.cur = card;
    var k = KIND[card.t];
    var mult = S.mult || 1;
    card.p.forEach(function (p) { if (S.needed.indexOf(p) < 0) S.needed.push(p); });

    var h = '<div class="c-top">';
    h += '<span class="c-kind ' + k.c + '">' + k.n + '</span>';
    if (card.lvl) h += '<span class="c-lvl">Lv' + card.lvl + (mult > 1 ? ' · ×' + mult : '') + '</span>';
    h += '<span class="c-who">' + esc(selfN()) + '</span></div>';

    h += '<p class="c-text">' + fill(card.x) + '</p>';

    var meta = [];
    if (card.s) meta.push('<span class="w">⏱ ' + sec(card.s) + '</span>');
    if (card.p.length) meta.push('<span class="w">需要 ' + card.p.map(esc).join('、') + '</span>');
    if (mult > 1) meta.push('<span class="w">罚两份</span>');
    if (meta.length) h += '<div class="c-meta">' + meta.join('') + '</div>';

    if (card.t === 'truth') {
      h += '<div class="c-ans"><textarea id="ans" placeholder="写下来会存进「真心话」，以后能翻"></textarea></div>';
    }

    if (card.s) h += '<button class="btn primary" id="act-timer">开始倒计时</button>';
    h += '<button class="btn primary" id="done">' + (isCost ? '做完了' : '做了') + '</button>';

    if (!isCost) {
      h += '<div class="c-sub">';
      h += '<button id="give">认输</button>';
      h += '<button id="rev">反转 ' + S.toke[S.turn].rev + '</button>';
      h += '<button id="skip">免罚 ' + S.toke[S.turn].skip + '</button>';
      h += '</div>';
    }
    sheet(h);

    if (card.s) $('#act-timer').onclick = function () { runTimer(card.s, k.n); };
    $('#done').onclick = isCost ? endCost : endCard;
    if (!isCost) {
      $('#give').onclick = giveUp;
      $('#rev').onclick = useRev;
      $('#skip').onclick = useSkip;
    }
    chord(card.t === 'punish' || card.t === 'cost' ? [330, 262] : [523, 659]);
    buzz(card.t === 'punish' || card.t === 'cost' ? 90 : 35);
  }

  function sec(s) {
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60), r = s % 60;
    return r ? m + ' 分 ' + r + ' 秒' : m + ' 分钟';
  }

  /* ── 结算 ── */
  function log(card, status, ans) {
    S.history.push({
      at: Date.now(), who: selfN(), lvl: card.lvl || 0, t: card.t,
      x: card.x, st: status, ans: ans || ''
    });
    if (S.history.length > 300) S.history.shift();
    if (ans) {
      S.truths.push({ at: Date.now(), who: selfN(), x: card.x, ans: ans });
      if (S.truths.length > 500) S.truths.shift();
    }
  }

  function endCard() {
    var c = S.cur;
    var ans = $('#ans') ? $('#ans').value.trim() : '';
    inTurn = false;
    log(c, 'done', ans);
    S.score[S.turn]++;
    S.heat++;
    S.mult = 1;
    lucky(c);
    save(); shut(); hud();

    if (c.t === 'reverse') {
      S.turn = 1 - S.turn;
      hud();
      toast('甩给 ' + selfN() + ' 了');
      setTimeout(showSpin, 650);
      return;
    }
    toast(c.t === 'duo' ? '这张算两个人的' : '热度 +1');
    bumpHeat();
    next();
  }

  function lucky(c) {
    if (c.t !== 'lucky') return;
    if (c.idx === 0) { S.toke[S.turn].skip++; toast('拿到一张免罚卡'); }
    if (c.idx === 1) { S.toke[S.turn].rev++; toast('拿到一张反转卡'); }
    if (c.idx === 2) {
      S.toke[S.turn].skip++;
      setTimeout(function () { toBox('punish'); }, 900);
    }
  }

  function endCost() {
    inTurn = false;
    log(S.cur, 'cost');
    S.heat++;
    S.mult = 1;
    save(); shut(); hud();
    toast('代价付清了');
    bumpHeat();
    next();
  }

  function bumpHeat() {
    if (S.heat > 0 && S.heat % HEAT_STEP === 0) {
      setTimeout(function () { hearts(); toast('终极盲盒解锁'); }, 450);
    }
  }

  function useRev() {
    if (S.toke[S.turn].rev <= 0) return;
    var c = S.cur;
    S.toke[S.turn].rev--;
    S.turn = 1 - S.turn;
    save(); hud(); shut();
    toast('甩给 ' + selfN() + ' 了');
    setTimeout(function () { show(c, false); }, 420);
  }

  function useSkip() {
    if (S.toke[S.turn].skip <= 0) return;
    inTurn = false;
    S.toke[S.turn].skip--;
    log(S.cur, 'skip');
    save(); shut(); hud();
    toast('这张不算');
    next();
  }

  function giveUp() {
    shut();
    var c = drawCost();
    setTimeout(function () { show(c, true); }, 340);
  }

  function next() {
    S.turn = 1 - S.turn;
    S.round++;
    save(); hud();
    showSpin();
  }

  /* ============================================================
   *  第一步：转类型
   * ============================================================ */
  var SECTORS = [
    { k: 'truth',  n: '真心话', w: 1.1, c: '#a81c50' },
    { k: 'dare',   n: '大冒险', w: 1.3, c: '#3a1030' },
    { k: 'punish', n: '惩罚',   w: 1.3, c: '#a81c50' },
    { k: 'duo',    n: '一起做', w: 0.7, c: '#3a1030' },
    { k: 'slot',   n: '翻牌子', w: 0.6, c: '#6d1b4c' }
  ];

  function layout() {
    var total = SECTORS.reduce(function (s, x) { return s + x.w; }, 0);
    var acc = 0;
    return SECTORS.map(function (s) {
      var span = s.w / total * 360;
      var o = { s: s, start: acc, span: span, mid: acc + span / 2 };
      acc += span;
      return o;
    });
  }

  function paintWheel() {
    var segs = layout();
    var stops = segs.map(function (g) {
      return g.s.c + ' ' + g.start.toFixed(2) + 'deg ' + (g.start + g.span).toFixed(2) + 'deg';
    }).join(',');
    var el = $('#mw');
    el.style.background = 'conic-gradient(' + stops + ')';
    el.innerHTML = segs.map(function (g) {
      return '<span style="transform:rotate(' + g.mid.toFixed(2) + 'deg) translateY(-76px) rotate('
        + (-g.mid).toFixed(2) + 'deg) translate(-50%,-50%)">' + esc(g.s.n) + '</span>';
    }).join('');
  }

  function showSpin() {
    pending = null;
    busy = false;
    inTurn = false;
    hide($('#step-spin'), false);
    hide($('#step-pick'), true);
    $('#mw-say').textContent = '转一下，看这把玩什么';
    $('#spin-main').disabled = false;
    if (!$('#mw').innerHTML) paintWheel();
  }

  function spinMain() {
    var btn = $('#spin-main');
    if (btn.disabled) return;
    btn.disabled = true;

    var segs = layout();
    var total = SECTORS.reduce(function (s, x) { return s + x.w; }, 0);
    var r = Math.random() * total, acc = 0, hit = segs[segs.length - 1];
    for (var i = 0; i < segs.length; i++) {
      acc += segs[i].s.w;
      if (r <= acc) { hit = segs[i]; break; }
    }

    var need = (360 - hit.mid) % 360;
    var target = spinDeg - (spinDeg % 360) + need;
    while (target <= spinDeg + 360 * 3) target += 360;
    spinDeg = target;
    $('#mw').style.transform = 'rotate(' + target + 'deg)';
    $('#mw-say').textContent = '……';
    beep(300, 0.4, 'sawtooth');
    var n = 0, iv = setInterval(function () { beep(1200, 0.015, 'square'); if (++n > 34) clearInterval(iv); }, 105);

    setTimeout(function () {
      clearInterval(iv);
      $('#mw-say').textContent = hit.s.n;
      chord([659, 880]); buzz(50);
      setTimeout(function () { toBox(hit.s.k); }, 850);
    }, 4000);
  }

  /* 第二步：挑盒子抽卡 */
  function toBox(k) {
    pending = k;
    if (k === 'slot') { openSlot(); return; }
    hide($('#step-spin'), true);
    hide($('#step-pick'), false);
    $('#pick-type').textContent = KIND[k] ? KIND[k].n : k;
  }

  function boxes() {
    $$('.box').forEach(function (b) {
      b.onclick = function () {
        if (busy) return;
        busy = true;
        $$('.box').forEach(function (x) { if (x !== b) x.classList.add('gone'); });
        b.classList.add('opening');
        beep(420, 0.08, 'square');
        setTimeout(function () {
          b.classList.remove('opening');
          b.classList.add('open');
          chord([523, 659, 784]);
          buzz([20, 35, 20]);
          setTimeout(function () {
            $$('.box').forEach(function (x) { x.classList.remove('gone', 'open'); });
            busy = false;
            // 小概率来张意外的：反转 / 幸运
            var t = Math.random() < 0.08 ? (Math.random() < 0.5 ? 'reverse' : 'lucky') : pending;
            show(draw(t), false);
          }, 560);
        }, 660);
      };
    });
  }

  /* ============================================================
   *  翻牌子：动作 × 部位
   * ============================================================ */
  function slotList(kind) {
    var src = window.SLOT[kind];
    var list = src.filter(function (it) {
      if (it.lv > S.max) return false;
      for (var i = 0; i < (it.g || []).length; i++) if (S.blocked.indexOf(it.g[i]) >= 0) return false;
      return true;
    });
    if (!list.length) list = src.filter(function (it) { return it.lv <= S.max; });
    if (!list.length) list = src;
    return list;
  }

  function slotPick(list) {
    var W = window.slotWeight;
    var total = 0;
    var ws = list.map(function (it) { var w = W(it.lv); total += w; return w; });
    var r = Math.random() * total;
    for (var i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function openSlot() {
    inTurn = true;
    var na = slotList('act').length, np = slotList('part').length;
    var h = '<h3 class="ov-h">翻牌子</h3>';
    h += '<p class="ov-p">两个转轮分开转。上面出动作，下面出部位，合起来就是你这张卡。<br>翻到哪儿就是哪儿，不许挑。</p>';
    h += '<div class="slot">';
    h += '<div class="reel" id="reel-act"><span>？？</span></div>';
    h += '<button class="btn primary sm full" id="spin-act">翻动作</button>';
    h += '<div class="reel" id="reel-part"><span>？？</span></div>';
    h += '<button class="btn primary sm full" id="spin-part">翻部位</button>';
    h += '</div>';
    h += '<p class="slot-say" id="slot-say">两个都翻完就出结果</p>';
    h += '<button class="btn primary hide" id="slot-done">做了，下一张</button>';
    h += '<button class="btn ghost hide" id="slot-again">两个重翻</button>';
    h += '<p class="slot-note">当前尺度下：' + na + ' 个动作 × ' + np + ' 个部位 = ' + (na * np) + ' 种组合</p>';
    sheet(h);

    var got = { act: null, part: null };
    var spinning = { act: false, part: false };

    function render() {
      if (got.act && got.part) {
        $('#slot-say').innerHTML = '<b>' + esc(selfN()) + '</b>　' + esc(got.act)
          + '　<b>' + esc(otherN()) + '</b>的' + esc(got.part);
        hide($('#slot-done'), false);
        hide($('#slot-again'), false);
        chord([659, 880]); buzz(40);
      } else if (got.act || got.part) {
        $('#slot-say').textContent = got.act ? '还要翻部位' : '还要翻动作';
      }
    }

    function spin(which) {
      if (spinning[which]) return;
      var list = slotList(which === 'act' ? 'act' : 'part');
      var final = slotPick(list);
      var el = $('#reel-' + which);
      var btn = $('#spin-' + which);
      spinning[which] = true;
      btn.disabled = true;
      el.classList.add('rolling');
      hide($('#slot-done'), true);
      hide($('#slot-again'), true);

      var t = 0, delay = 45, total = 1150 + rnd(450);
      (function step() {
        el.querySelector('span').textContent = slotPick(list).x;
        beep(1400, 0.012, 'square');
        t += delay;
        if (t < total * 0.55) delay = 45;
        else if (t < total * 0.8) delay = 95;
        else delay = 165;
        if (t < total) { setTimeout(step, delay); return; }
        el.querySelector('span').textContent = final.x;
        el.classList.remove('rolling');
        el.classList.add('landed');
        setTimeout(function () { el.classList.remove('landed'); }, 400);
        got[which] = final.x;
        spinning[which] = false;
        btn.disabled = false;
        beep(880, 0.12, 'triangle');
        render();
      })();
    }

    $('#spin-act').onclick = function () { spin('act'); };
    $('#spin-part').onclick = function () { spin('part'); };
    $('#slot-again').onclick = function () {
      got.act = null; got.part = null;
      $('#reel-act').querySelector('span').textContent = '？？';
      $('#reel-part').querySelector('span').textContent = '？？';
      $('#slot-say').textContent = '两个都翻完就出结果';
      hide($('#slot-done'), true);
      hide($('#slot-again'), true);
    };
    $('#slot-done').onclick = function () {
      inTurn = false;
      log({ lvl: S.max, t: 'dare', x: '{self} ' + got.act + ' {other} 的' + got.part }, 'done');
      S.score[S.turn]++;
      S.heat++;
      S.mult = 1;
      save(); shut(); hud();
      toast('热度 +1');
      bumpHeat();
      next();
    };
  }

  /* ============================================================
   *  骰子：决定谁受罚
   * ============================================================ */
  var FACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function openDice() {
    var h = '<h3 class="ov-h">谁受罚</h3><p class="ov-p">各两颗，小的抽惩罚。一样大就一起做。<br>别的游戏输了也能用这个定。</p><div class="dice">';
    [0, 1].forEach(function (i) {
      h += '<div id="d' + i + '"><h4>' + esc(S.names[i]) + '</h4><div class="face" id="f' + i + '">⚀ ⚀</div><div class="pt" id="p' + i + '">—</div></div>';
    });
    h += '</div><p class="dice-say" id="dsay">&nbsp;</p><button class="btn primary" id="roll">掷</button>';
    sheet(h);
    $('#roll').onclick = doRoll;
  }

  function doRoll() {
    var b = $('#roll');
    if (!b || b.disabled) return;
    b.disabled = true;
    $('#d0').classList.add('roll'); $('#d1').classList.add('roll');
    var n = 0, iv = setInterval(function () {
      $('#f0').textContent = FACE[rnd(6)] + ' ' + FACE[rnd(6)];
      $('#f1').textContent = FACE[rnd(6)] + ' ' + FACE[rnd(6)];
      beep(900, 0.015, 'square');
      if (++n > 11) {
        clearInterval(iv);
        var a = 1 + rnd(6), a2 = 1 + rnd(6), c = 1 + rnd(6), c2 = 1 + rnd(6);
        $('#d0').classList.remove('roll'); $('#d1').classList.remove('roll');
        $('#f0').textContent = FACE[a - 1] + ' ' + FACE[a2 - 1];
        $('#f1').textContent = FACE[c - 1] + ' ' + FACE[c2 - 1];
        var ta = a + a2, tb = c + c2;
        $('#p0').textContent = ta; $('#p1').textContent = tb;
        setTimeout(function () {
          if (ta === tb) {
            $('#dsay').textContent = '平手，两个人一起做';
            chord([523, 659, 784]);
            setTimeout(function () { shut(); setTurn(0); toBox('duo'); }, 1000);
          } else {
            var lose = ta < tb ? 0 : 1;
            $('#d' + lose).classList.add('lose');
            $('#d' + (1 - lose)).classList.add('win');
            $('#dsay').textContent = S.names[lose] + ' 输了';
            buzz(110);
            setTimeout(function () { shut(); setTurn(lose); toBox('punish'); }, 1000);
          }
        }, 240);
      }
    }, 90);
  }

  /* ── 计时 ── */
  function runTimer(total, label) {
    shut();
    var left = total, fg = $('#ring-fg'), num = $('#timer-num');
    var C = 2 * Math.PI * 54;
    $('#timer').classList.remove('hide');
    $('#timer-label').textContent = label || '限时';
    fg.style.strokeDasharray = C;
    function paint() { num.textContent = left; fg.style.strokeDashoffset = C * (1 - left / total); }
    paint();
    clearInterval(tick);
    tick = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(tick);
        num.textContent = '0'; fg.style.strokeDashoffset = C;
        chord([880, 1046, 1318]); buzz([70, 50, 70, 50, 150]);
        $('#timer-label').textContent = '时间到，做到哪儿算哪儿';
        return;
      }
      if (left <= 4) beep(880, 0.09, 'square');
      paint();
    }, 1000);
    $('#timer-stop').onclick = stopTimer;
    $('#timer-again').onclick = function () { runTimer(total, label); };
  }
  function stopTimer() { clearInterval(tick); $('#timer').classList.add('hide'); }

  /* ============================================================
   *  菜单
   * ============================================================ */
  function openMenuList() {
    var h = '<h3 class="ov-h">菜单</h3><div class="menu-list">';
    h += '<button data-m="pick"><em>💬</em>点菜<s>直接指定类型</s></button>';
    h += '<button data-m="prop"><em>🧰</em>要准备什么<s>' + S.needed.length + ' 样</s></button>';
    h += '<button data-m="log"><em>📜</em>记录<s>本局 ' + S.history.length + ' · 真心话 ' + S.truths.length + '</s></button>';
    h += '<button data-m="limits"><em>🚧</em>红线<s>' + (S.blocked.length ? '关了 ' + S.blocked.length + ' 类' : '全开') + '</s></button>';
    h += '<button data-m="rule"><em>📖</em>怎么玩</button>';
    h += '<button data-m="finish"><em>🏁</em>结束这一局</button>';
    h += '<button data-m="wipe"><em>🗑</em>清空所有数据</button>';
    h += '</div>';
    sheet(h);
    $$('#ov-body [data-m]').forEach(function (b) {
      b.onclick = function () {
        var m = b.dataset.m;
        if (m === 'pick') openMenu();
        if (m === 'prop') propList();
        if (m === 'log') logs();
        if (m === 'limits') limits();
        if (m === 'rule') rules();
        if (m === 'finish') finishSession();
        if (m === 'wipe') wipeAll();
      };
    });
  }

  function rules() {
    var h = '<h3 class="ov-h">怎么玩</h3><ul class="rule">';
    h += '<li><b>转</b>　先转上面那个盘，决定这把玩什么：真心话 / 大冒险 / 惩罚 / 一起做 / 翻牌子。</li>';
    h += '<li><b>抽</b>　转到哪类，就从盲盒里抽哪类。转到<b>翻牌子</b>就直接进两个转轮。</li>';
    h += '<li><b>谁受罚</b>　默认轮流。但点上面两个人的名字可以直接换人——<b>别的游戏输了也能直接点他</b>。</li>';
    h += '<li><b>做不到</b>　点「认输」抽一张代价卡。躲是可以躲的，就是要付钱。</li>';
    h += '<li><b>真心话</b>　写下来的答案进「真心话」，<b>结束一局也不会清掉</b>，跨局一直留着。</li>';
    h += '<li><b>热度</b>　每完成一张加一点，每满 ' + HEAT_STEP + ' 点解锁一次「终极」，里面是最狠的那几张，而且是<b>对方</b>替你抽。</li>';
    h += '<li><b>安全词</b>　说出来立刻停，抱六十秒。不用解释，不算输。</li>';
    h += '</ul><button class="btn primary" id="ok">知道了</button>';
    sheet(h);
    $('#ok').onclick = shut;
  }

  function propList() {
    var h = '<h3 class="ov-h">要准备什么</h3><p class="ov-p">标出来的是这局已经用到的，提前去拿。没有就拿身边的东西顶。</p><div class="props">';
    window.PROPS.forEach(function (p) {
      var need = S.needed.indexOf(p) >= 0;
      h += '<div class="' + (need ? 'need' : '') + '">' + (need ? '★ ' : '') + esc(p) + '</div>';
    });
    h += '</div><button class="btn primary" id="ok">好</button>';
    sheet(h);
    $('#ok').onclick = shut;
  }

  function logs() {
    var h = '<h3 class="ov-h">记录</h3>';
    h += '<div class="tabs"><button class="on" data-t="now">本局 ' + S.history.length + '</button>'
      + '<button data-t="ans">真心话 ' + S.truths.length + '</button></div>';
    h += '<div id="tb"></div>';
    sheet(h);
    $$('.tabs button').forEach(function (b) {
      b.onclick = function () {
        $$('.tabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        fillTab(b.dataset.t);
      };
    });
    fillTab('now');
  }

  function pretty(r) {
    var other = S.names[0] === r.who ? S.names[1] : S.names[0];
    return esc(r.x).replace(/\{self\}/g, esc(r.who)).replace(/\{other\}/g, esc(other));
  }
  function stamp(ts) {
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function fillTab(t) {
    var box = $('#tb');
    var rows = t === 'ans' ? S.truths : S.history;
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (t === 'ans' ? '还没人写过答案<br>抽到真心话时顺手写一句' : '本局还没抽过卡') + '</div>';
      return;
    }
    if (t === 'ans') {
      box.innerHTML = '<div class="log">' + rows.slice().reverse().map(function (r) {
        return '<div><small>' + esc(r.who) + ' · ' + stamp(r.at) + '</small>' + pretty(r)
          + '<div class="ans">💬 ' + esc(r.ans) + '</div></div>';
      }).join('') + '</div>';
      return;
    }
    var ST = { done: '做了', skip: '免罚', cost: '付了代价' };
    box.innerHTML = '<div class="log">' + rows.slice().reverse().map(function (r) {
      return '<div><small>' + esc(r.who) + ' · ' + (ST[r.st] || '') + ' · ' + stamp(r.at) + '</small>'
        + pretty(r) + (r.ans ? '<div class="ans">💬 ' + esc(r.ans) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function limits() {
    var h = '<h3 class="ov-h">哪些不玩</h3><p class="ov-p">点一下变灰，这类卡不会再出现。改完立刻生效。</p>';
    h += '<div class="tags" id="tags2"></div><button class="btn primary" id="ok">好</button>';
    sheet(h);
    var box = $('#tags2');
    window.TAGS.forEach(function (t) {
      var b = document.createElement('button');
      b.dataset.tag = t.id;
      if (S.blocked.indexOf(t.id) >= 0) b.className = 'off';
      b.innerHTML = esc(t.id) + '<small>' + esc(t.d) + '</small>';
      b.onclick = function () { toggleTag(t.id, b); };
      box.appendChild(b);
    });
    $('#ok').onclick = shut;
  }

  function openMenu() {
    var h = '<h3 class="ov-h">点菜</h3><p class="ov-p">不想转盘就直接点，但抽到什么牌堆说了算。</p>';
    h += '<div class="menu-list">';
    h += '<button data-t="truth"><em>💬</em>真心话</button>';
    h += '<button data-t="dare"><em>🎯</em>大冒险</button>';
    h += '<button data-t="punish"><em>⚡</em>惩罚</button>';
    h += '<button data-t="duo"><em>💞</em>一起做</button>';
    h += '<button data-t="slot"><em>🎰</em>翻牌子<s>动作 × 部位</s></button>';
    h += '</div>';
    sheet(h);
    $$('#ov-body [data-t]').forEach(function (b) {
      b.onclick = function () {
        var t = b.dataset.t;
        shut();
        setTimeout(function () { toBox(t); }, 200);
      };
    });
  }

  /* ── 结束这一局 ──
     只清「本局」，真心话永久保留。 */
  function finishSession() {
    var drew = S.score[0] + S.score[1];
    var h = '<h3 class="ov-h">这一局结束了</h3>';
    h += '<div class="sum">';
    h += '<div class="sum-row"><span>' + esc(S.names[0]) + '</span><b>' + S.score[0] + ' 张</b></div>';
    h += '<div class="sum-row"><span>' + esc(S.names[1]) + '</span><b>' + S.score[1] + ' 张</b></div>';
    h += '<div class="sum-row total"><span>一共做了 ' + drew + ' 张 · 热度 ' + S.heat + '</span><b>第 ' + ((S.sessions || 0) + 1) + ' 局</b></div>';
    h += '</div>';

    if (S.truths.length) {
      h += '<p class="ov-p"><b>真心话留下了 ' + S.truths.length + ' 条</b>，结束一局不会清掉，下次还能翻。</p>';
    } else {
      h += '<p class="ov-p">这局没写过真心话。下次抽到真心话，顺手写一句。</p>';
    }

    h += '<button class="btn primary" id="fs-again">再来一局</button>';
    h += '<button class="btn ghost" id="fs-home">回首页，今天到这儿</button>';
    h += '<button class="btn ghost" id="ok">还没完，继续</button>';
    sheet(h);

    $('#fs-again').onclick = function () {
      S.sessions = (S.sessions || 0) + 1;
      S.history = [];           // 只清本局
      S.score = [0, 0];
      S.heat = 0; S.mult = 1; S.ultUsed = 0; S.round = 1;
      S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];
      S.seen = []; S.needed = [];
      save(); hud(); shut(); showSpin();
      toast('新的一局');
    };
    $('#fs-home').onclick = function () {
      S.sessions = (S.sessions || 0) + 1;
      S.history = []; S.score = [0, 0]; S.heat = 0; S.ultUsed = 0; S.round = 1;
      S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];
      S.seen = []; S.needed = [];
      save(); shut();
      $('#btn-resume').classList.add('hide');
      go('sc-setup');
    };
    $('#ok').onclick = shut;
  }

  function wipeAll() {
    var h = '<h3 class="ov-h">清空所有数据</h3>';
    h += '<p class="ov-p">名字、红线、本局记录，<b>还有全部 ' + S.truths.length + ' 条真心话</b>，全都会没。<br>这个删了找不回来。</p>';
    h += '<button class="btn danger" id="yes">确认，全删</button>';
    h += '<button class="btn ghost" id="ok">算了</button>';
    sheet(h);
    $('#yes').onclick = function () {
      try { localStorage.removeItem(LS); } catch (e) {}
      S = blank();
      shut();
      $('#btn-resume').classList.add('hide');
      go('sc-setup');
    };
    $('#ok').onclick = shut;
  }

  function safeStop() {
    clearInterval(tick);
    $('#timer').classList.add('hide');
    var h = '<h3 class="ov-h">停了</h3><p class="ov-p">游戏结束，现在什么都不用做。<br>抱六十秒，别说话。</p>';
    h += '<button class="btn primary" id="hug">开始六十秒</button>';
    h += '<button class="btn ghost" id="ok">就这样</button>';
    sheet(h);
    $('#hug').onclick = function () { runTimer(60, '抱着，别松手'); };
    $('#ok').onclick = shut;
  }

  function ultOpen() {
    if (charges() <= 0) return;
    S.ultUsed = (S.ultUsed || 0) + 1;
    S.turn = 1 - S.turn;
    hud();
    chord([196, 262, 330, 392]);
    toast('轮到 ' + selfN() + ' 抽');
    setTimeout(function () { show(draw(null, true), false); }, 700);
  }

  /* ── 特效 ── */
  function hearts() {
    var box = $('#hearts'), emo = ['❤️', '💋', '🔥', '💞'];
    for (var i = 0; i < 14; i++) {
      var s = document.createElement('span');
      s.textContent = emo[rnd(emo.length)];
      s.style.left = rnd(100) + 'vw';
      s.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
      s.style.animationDelay = (Math.random() * .4) + 's';
      s.style.fontSize = (15 + rnd(14)) + 'px';
      box.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 4600); })(s);
    }
  }
  var tHandle = null;
  function toast(m) {
    var t = $('#toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(tHandle);
    tHandle = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* ── 开局 ── */
  function readSetup() {
    var a = ($('#in-a').value || '').trim().slice(0, 6) || '宝贝';
    var b = ($('#in-b').value || '').trim().slice(0, 6) || '亲爱的';
    if (a === b) b = b + '²';
    S.names = [a, b];
    S.safe = ($('#in-safe').value || '').trim().slice(0, 6) || '菠萝';
    var on = $('#lv button.on');
    S.max = on ? +on.dataset.lv : 2;
  }

  function enterGame() {
    $('#safe-show').textContent = S.safe;
    hud();
    showSpin();
    go('sc-game');
  }

  function freshStart() {
    readSetup();
    S.turn = 0; S.round = 1; S.heat = 0; S.score = [0, 0]; S.mult = 1;
    S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];
    S.history = []; S.seen = []; S.needed = []; S.ultUsed = 0;
    save();
    enterGame();
  }

  /* ── 绑定 ── */
  function bind() {
    $('#to-limits').onclick = function () {
      readSetup();
      $('#safe-show').textContent = S.safe;
      go('sc-limits');
      chord([523, 659]);
    };
    $('#back-setup').onclick = function () { go('sc-setup'); };
    $('#start').onclick = function () { freshStart(); hearts(); chord([523, 659, 784, 1046]); };

    $('#who-0').onclick = function () { setTurn(0); };
    $('#who-1').onclick = function () { setTurn(1); };

    boxes();
    $('#spin-main').onclick = spinMain;
    $('#respins').onclick = function () { showSpin(); };
    $('#dice').onclick = openDice;
    $('#ult').onclick = ultOpen;
    $('#menu').onclick = openMenuList;
    $('#safe-line').onclick = safeStop;
    $('#ov-x').onclick = dismiss;
    $('#ov').onclick = function (e) { if (e.target === $('#ov')) dismiss(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dismiss(); });
  }

  function init() {
    S = load() || blank();
    if (S.mult == null) S.mult = 1;
    if (S.ultUsed == null) S.ultUsed = 0;
    if (S.sessions == null) S.sessions = 0;
    if (!S.truths) S.truths = [];
    if (!S.needed) S.needed = [];
    if (!S.seen) S.seen = [];
    if (!S.toke) S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];

    buildLv();
    buildTags();
    bind();
    paintWheel();

    $('#in-a').value = S.names[0];
    $('#in-b').value = S.names[1];
    $('#in-safe').value = S.safe;
    $('#safe-show').textContent = S.safe;
    $$('#lv button').forEach(function (x) { x.classList.toggle('on', +x.dataset.lv === S.max); });

    if (S.history.length) {
      var b = $('#btn-resume');
      b.classList.remove('hide');
      b.textContent = '接着上一局（' + S.history.length + ' 条 · 热度 ' + S.heat + '）';
      b.onclick = enterGame;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
