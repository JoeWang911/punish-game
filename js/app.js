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

  var LS = 'punish-game-v1';
  var HEAT_STEP = 8;

  var S = null;
  var spin = 0;
  var busy = false;
  var tick = null;

  /* ── 声音（没有音频文件，现场合成） ── */
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

  /* ── 状态 ── */
  function blank() {
    return {
      names: ['宝贝', '亲爱的'], safe: '菠萝', max: 2, blocked: [],
      turn: 0, round: 1, heat: 0, score: [0, 0], mult: 1, ultUsed: 0,
      toke: [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }],
      history: [], needed: [], seen: []
    };
  }
  function save() {
    // 只存该存的，S.cur 这类运行时字段不要落盘
    var keep = ['names', 'safe', 'max', 'blocked', 'turn', 'round', 'heat', 'score',
                'mult', 'ultUsed', 'toke', 'history', 'needed', 'seen'];
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
  var TW = { truth: 26, dare: 30, punish: 20, duo: 12, reverse: 6, lucky: 6 };

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
  function rollType(noSpecial) {
    var ks = noSpecial ? ['truth', 'dare', 'punish', 'duo'] : Object.keys(TW);
    var total = 0;
    ks.forEach(function (k) { total += TW[k]; });
    var r = Math.random() * total;
    for (var i = 0; i < ks.length; i++) { r -= TW[ks[i]]; if (r <= 0) return ks[i]; }
    return 'dare';
  }
  function draw(type, top) {
    // top = 终极盲盒，只出真卡，不给幸运/反转这种奖励卡
    var t = type || rollType(top);
    if (t === 'reverse' || t === 'lucky') {
      var arr = window.SPECIAL[t], i = rnd(arr.length);
      return { id: t + i, idx: i, lvl: 0, t: t, x: arr[i].x, s: arr[i].s || 0, p: arr[i].p || [], g: arr[i].g || [] };
    }
    var list = POOL.filter(function (c) { return c.t === t && ok(c); });
    if (top && list.length) {
      var hi = Math.max.apply(null, list.map(function (c) { return c.lvl; }));
      list = list.filter(function (c) { return c.lvl === hi; });
    }
    if (!list.length) list = POOL.filter(function (c) { return ok(c); });
    if (!list.length) list = POOL.filter(function (c) { return c.lvl <= S.max; });
    if (!list.length) list = POOL.slice();          // 兜底，宁可越过红线也不崩
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

  /* ── 弹层 ── */
  function sheet(html) {
    $('#ov-body').innerHTML = html;
    $('#ov').classList.remove('hide');
  }
  function shut() {
    $('#ov').classList.add('hide');
    $('#ov-body').innerHTML = '';
  }

  var KIND = {
    truth:   { n: '真心话', c: '' },
    dare:    { n: '大冒险', c: '' },
    punish:  { n: '惩罚',   c: 't-punish' },
    duo:     { n: '一起',   c: 't-duo' },
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
    if (S.history.length > 200) S.history.shift();
  }

  function endCard() {
    var c = S.cur;
    var ans = $('#ans') ? $('#ans').value.trim() : '';
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
      setTimeout(function () { dealWhenFree(); }, 650);
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
      // 此刻还没换人，等 next() 之后 S.turn 才是对方，正好是"让 TA 抽一张"
      setTimeout(function () { dealWhenFree(null, true); }, 1000);
    }
  }

  function endCost() {
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
  }

  function deal(type, top) {
    if (busy) return;
    show(draw(type, top), false);
  }

  /* 自动补抽（反转、幸运卡）不能撞上正在开盒的动画，
     撞上就被 deal() 静默吞掉，卡就丢了。等到空闲再抽。 */
  function dealWhenFree(type, top, tries) {
    tries = tries || 0;
    if (busy && tries < 40) {
      setTimeout(function () { dealWhenFree(type, top, tries + 1); }, 150);
      return;
    }
    deal(type, top);
  }

  /* ── 盲盒 ── */
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
            deal();
          }, 560);
        }, 660);
      };
    });
  }

  /* ── 转盘 ── */
  var WHEEL = [
    { k: 'punA', f: function (n) { return n[0] + '受罚'; }, c: '#a81c50' },
    { k: 'duo',  f: function () { return '一起'; },      c: '#3a1030' },
    { k: 'punB', f: function (n) { return n[1] + '受罚'; }, c: '#a81c50' },
    { k: 'swap', f: function () { return '换人'; },      c: '#3a1030' },
    { k: 'truth',f: function () { return '真心话'; },    c: '#a81c50' },
    { k: 'lucky',f: function () { return '幸运'; },      c: '#3a1030' },
    { k: 'drawA',f: function (n) { return n[0] + '抽'; },c: '#a81c50' },
    { k: 'x2',   f: function () { return '加码×2'; },    c: '#3a1030' },
    { k: 'drawB',f: function (n) { return n[1] + '抽'; },c: '#a81c50' },
    { k: 'top',  f: function () { return '最狠'; },      c: '#3a1030' },
    { k: 'ask',  f: function () { return '点菜'; },      c: '#a81c50' },
    { k: 'dice', f: function () { return '骰子'; },      c: '#3a1030' }
  ];

  function openWheel() {
    var n = S.names.map(function (s) { return s.slice(0, 3); });
    var seg = 360 / WHEEL.length;
    var stops = WHEEL.map(function (w, i) { return w.c + ' ' + (i * seg) + 'deg ' + ((i + 1) * seg) + 'deg'; }).join(',');
    var h = '<h3 class="ov-h">转盘</h3><p class="ov-p">转到什么就是什么。</p>';
    h += '<div class="wheel-wrap"><div class="wheel" id="wheel" style="background:conic-gradient(' + stops + ')">';
    WHEEL.forEach(function (w, i) {
      var mid = i * seg + seg / 2;
      h += '<span style="transform:rotate(' + mid + 'deg) translateY(-96px) rotate(' + (-mid) + 'deg) translate(-50%,-50%)">' + esc(w.f(n)) + '</span>';
    });
    h += '</div><div class="wheel-pin">▼</div></div><p class="wheel-say" id="wheel-say">&nbsp;</p>';
    h += '<button class="btn primary" id="spin">转</button>';
    sheet(h);
    spin = 0;
    $('#spin').onclick = doSpin;
  }

  function doSpin() {
    var b = $('#spin');
    if (!b || b.disabled) return;
    b.disabled = true;
    var i = rnd(WHEEL.length), seg = 360 / WHEEL.length;
    var need = (360 - (i * seg + seg / 2)) % 360;
    var target = spin - (spin % 360) + need;
    while (target <= spin + 360 * 3) target += 360;
    spin = target;
    $('#wheel').style.transform = 'rotate(' + target + 'deg)';
    beep(300, 0.4, 'sawtooth');
    var n = 0, iv = setInterval(function () { beep(1200, 0.015, 'square'); if (++n > 38) clearInterval(iv); }, 105);
    setTimeout(function () {
      clearInterval(iv);
      land(WHEEL[i]);
    }, 4300);
  }

  function land(w) {
    $('#wheel-say').textContent = w.f(S.names);
    chord([659, 880]); buzz(60);
    setTimeout(function () {
      shut();
      var was = S.turn;
      switch (w.k) {
        case 'punA': S.turn = 0; hud(); deal('punish'); break;
        case 'punB': S.turn = 1; hud(); deal('punish'); break;
        case 'drawA': S.turn = 0; hud(); deal(); break;
        case 'drawB': S.turn = 1; hud(); deal(); break;
        case 'duo': deal('duo'); break;
        case 'truth': deal('truth'); break;
        case 'lucky': deal('lucky'); break;
        case 'top': deal(null, true); break;
        case 'x2': toast('这张罚两份'); S.mult = 2; deal('punish'); break;
        case 'swap':
          S.turn = 1 - S.turn; hud();
          toast('换人，轮到 ' + selfN());
          setTimeout(function () { dealWhenFree(); }, 750);
          break;
        case 'dice': openDice(); break;
        case 'ask': openMenu(); break;
        default: deal();
      }
    }, 1900);
  }

  /* ── 骰子 ── */
  var FACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function openDice() {
    var h = '<h3 class="ov-h">掷骰子</h3><p class="ov-p">各两颗，小的抽惩罚。一样大就一起做。</p><div class="dice">';
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
            $('#dsay').textContent = '平手，一起做';
            chord([523, 659, 784]);
            setTimeout(function () { shut(); S.turn = 0; hud(); deal('duo'); }, 1000);
          } else {
            var lose = ta < tb ? 0 : 1;
            $('#d' + lose).classList.add('lose');
            $('#d' + (1 - lose)).classList.add('win');
            $('#dsay').textContent = S.names[lose] + ' 输了';
            buzz(110);
            setTimeout(function () { shut(); S.turn = lose; hud(); deal('punish'); }, 1000);
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

  /* ── 菜单 ── */
  function openMenuList() {
    var h = '<h3 class="ov-h">菜单</h3><div class="menu-list">';
    h += '<button data-m="rule"><em>📖</em>怎么玩</button>';
    h += '<button data-m="pick"><em>💬</em>点菜<s>指定类型</s></button>';
    h += '<button data-m="prop"><em>🧰</em>要准备什么<s>' + S.needed.length + ' 样</s></button>';
    h += '<button data-m="log"><em>📜</em>今晚的记录<s>' + S.history.length + ' 条</s></button>';
    h += '<button data-m="limits"><em>🚧</em>红线<s>' + (S.blocked.length ? '关了 ' + S.blocked.length + ' 类' : '全开') + '</s></button>';
    h += '<button data-m="reset"><em>↺</em>重开</button>';
    h += '</div>';
    sheet(h);
    $$('#ov-body [data-m]').forEach(function (b) {
      b.onclick = function () {
        var m = b.dataset.m;
        if (m === 'rule') rules();
        if (m === 'pick') openMenu();
        if (m === 'prop') propList();
        if (m === 'log') logs();
        if (m === 'limits') limits();
        if (m === 'reset') resetMenu();
      };
    });
  }

  function rules() {
    var h = '<h3 class="ov-h">怎么玩</h3><ul class="rule">';
    h += '<li><b>抽卡</b>　三个盒子挑一个，里面可能是真心话、大冒险、惩罚、一起做，也可能反转或幸运。</li>';
    h += '<li><b>做不到</b>　点「认输」抽一张代价卡。躲是可以躲的，就是要付钱。</li>';
    h += '<li><b>真心话</b>　写下来的答案会存进「真心话」，以后能翻出来看。这是这游戏唯一值钱的东西。</li>';
    h += '<li><b>热度</b>　做完一张加一点，每满 ' + HEAT_STEP + ' 点解锁一次「终极」，里面是最狠的那几张，而且是<b>对方</b>替你抽。</li>';
    h += '<li><b>卡</b>　免罚和反转各一张，幸运卡还能再发。用掉就没了。</li>';
    h += '<li><b>翻牌子</b>　菜单里的「点菜」可以直接指定类型。里面还有个<b>翻牌子</b>：两个转轮分开转，上面出动作、下面出部位，合起来就是一张卡。</li>';
    h += '<li><b>限时</b>　带 ⏱ 的会弹倒计时，时间到就停，做到哪儿算哪儿。</li>';
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
    var h = '<h3 class="ov-h">今晚</h3>';
    h += '<div class="tabs"><button class="on" data-t="all">抽过的</button><button data-t="ans">真心话</button></div>';
    h += '<div id="tb"></div>';
    sheet(h);
    $$('.tabs button').forEach(function (b) {
      b.onclick = function () {
        $$('.tabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        fillTab(b.dataset.t);
      };
    });
    fillTab('all');
  }

  function pretty(r) {
    var other = S.names[0] === r.who ? S.names[1] : S.names[0];
    return esc(r.x).replace(/\{self\}/g, esc(r.who)).replace(/\{other\}/g, esc(other));
  }
  function fillTab(t) {
    var box = $('#tb');
    var rows = t === 'ans' ? S.history.filter(function (r) { return r.ans; }) : S.history;
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (t === 'ans' ? '还没人写过答案' : '还没抽过卡') + '</div>';
      return;
    }
    var ST = { done: '做了', skip: '免罚', cost: '付了代价' };
    box.innerHTML = '<div class="log">' + rows.slice().reverse().map(function (r) {
      var d = new Date(r.at);
      var t2 = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return '<div><small>' + esc(r.who) + ' · ' + (ST[r.st] || '') + ' · ' + t2 + '</small>'
        + pretty(r) + (r.ans ? '<div class="ans">' + esc(r.ans) + '</div>' : '') + '</div>';
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
    var h = '<h3 class="ov-h">点菜</h3><p class="ov-p">想要哪种就点哪种，但抽到什么牌堆说了算。</p>';
    h += '<div class="menu-list">';
    h += '<button data-t="truth"><em>💬</em>真心话</button>';
    h += '<button data-t="dare"><em>🎯</em>大冒险</button>';
    h += '<button data-t="punish"><em>⚡</em>惩罚</button>';
    h += '<button data-t="duo"><em>💞</em>一起做</button>';
    h += '<button data-slot="1"><em>🎰</em>翻牌子<s>动作 × 部位</s></button>';
    h += '</div>';
    sheet(h);
    $$('#ov-body [data-t]').forEach(function (b) {
      b.onclick = function () { shut(); setTimeout(function () { deal(b.dataset.t); }, 200); };
    });
    var s = $('#ov-body [data-slot]');
    if (s) s.onclick = openSlot;
  }

  /* ── 老虎机：动作 × 部位 ── */
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

  /* 权重公式在 cards.js 里（window.slotWeight），方便测试直接验 */
  function slotPick(list) {
    var W = window.slotWeight;
    var total = 0;
    var ws = list.map(function (it) { var w = W(it.lv); total += w; return w; });
    var r = Math.random() * total;
    for (var i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function openSlot() {
    var na = slotList('act').length, np = slotList('part').length;
    var h = '<h3 class="ov-h">翻牌子</h3>';
    h += '<p class="ov-p">两个转轮分开转。上面出动作，下面出部位，合起来就是你这张卡。<br>翻到哪儿就是哪儿，不许挑。</p>';
    h += '<div class="slot">';
    h += '<div class="reel" id="reel-act"><span>？？</span></div>';
    h += '<button class="btn primary sm full" id="spin-act">转动作</button>';
    h += '<div class="reel" id="reel-part"><span>？？</span></div>';
    h += '<button class="btn primary sm full" id="spin-part">转部位</button>';
    h += '</div>';
    h += '<p class="slot-say" id="slot-say">两个都转完就出结果</p>';
    h += '<button class="btn primary hide" id="slot-done">做了，下一张</button>';
    h += '<button class="btn ghost hide" id="slot-again">两个重转</button>';
    h += '<p class="slot-note">当前尺度下：' + na + ' 个动作 × ' + np + ' 个部位 = ' + (na * np) + ' 种组合</p>';
    sheet(h);

    var got = { act: null, part: null };
    var spinning = { act: false, part: false };

    function render() {
      if (got.act && got.part) {
        $('#slot-say').innerHTML = '<b>' + esc(selfN()) + '</b>　' + esc(got.act)
          + '　<b>' + esc(otherN()) + '</b>的' + esc(got.part);
        $('#slot-done').classList.remove('hide');
        $('#slot-again').classList.remove('hide');
        chord([659, 880]);
        buzz(40);
      } else if (got.act || got.part) {
        $('#slot-say').textContent = got.act ? '还要转部位' : '还要转动作';
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
      $('#slot-done').classList.add('hide');
      $('#slot-again').classList.add('hide');

      var t = 0, delay = 45;
      var total = 1150 + rnd(450);
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
      $('#slot-say').textContent = '两个都转完就出结果';
      $('#slot-done').classList.add('hide');
      $('#slot-again').classList.add('hide');
    };
    $('#slot-done').onclick = function () {
      var text = '{self} ' + got.act + ' {other} 的' + got.part;
      log({ lvl: S.max, t: 'dare', x: text }, 'done');
      S.score[S.turn]++;
      S.heat++;
      S.mult = 1;
      save(); shut(); hud();
      toast('热度 +1');
      bumpHeat();
      next();
    };
  }

  function resetMenu() {
    var h = '<h3 class="ov-h">重开</h3><p class="ov-p">名字和红线都留着，只清空这一局。</p>';
    h += '<button class="btn primary" id="soft">重开一局</button>';
    h += '<button class="btn ghost" id="hard">全部清空</button>';
    h += '<button class="btn ghost" id="ok">继续玩</button>';
    sheet(h);
    $('#soft').onclick = function () {
      S.turn = 0; S.round = 1; S.heat = 0; S.score = [0, 0]; S.mult = 1;
      S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];
      S.history = []; S.seen = []; S.needed = []; S.ultUsed = 0;
      save(); hud(); shut(); toast('重新开始');
    };
    $('#hard').onclick = function () {
      try { localStorage.removeItem(LS); } catch (e) {}
      S = blank();
      shut(); go('sc-setup');
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
    setTimeout(function () { deal(null, true); }, 800);
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
    boxes();
    $('#wheel').onclick = openWheel;
    $('#dice').onclick = openDice;
    $('#ult').onclick = ultOpen;
    $('#menu').onclick = openMenuList;
    $('#safe-line').onclick = safeStop;
    $('#ov-x').onclick = shut;
    $('#ov').onclick = function (e) { if (e.target === $('#ov')) shut(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
  }

  function init() {
    S = load() || blank();
    if (S.mult == null) S.mult = 1;
    if (S.ultUsed == null) S.ultUsed = 0;
    if (!S.needed) S.needed = [];
    if (!S.seen) S.seen = [];
    if (!S.toke) S.toke = [{ skip: 1, rev: 1 }, { skip: 1, rev: 1 }];

    buildLv();
    buildTags();
    bind();

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
