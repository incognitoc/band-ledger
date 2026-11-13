(function () {
  'use strict';

  var $app = document.getElementById('app');
  var MOCK = new URLSearchParams(location.search).has('mock');
  var CONFIG = window.CONFIG || {};

  var S = {
    me: null, entries: [], categories: [], members: [],
    idToken: null, canSend: false,
    flash: '', error: '', busy: false,
    month: null, typeFilter: '全部', year: null,
    form: null, formKey: '', confirmDelete: false,
    receipts: {}
  };

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function signed(n) { return (n < 0 ? '−' : '') + money(n); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function shortDate(s) { return Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)); }
  function monthLabel(m) { return m.slice(0, 4) + ' 年 ' + Number(m.slice(5, 7)) + ' 月'; }
  function shiftMonth(m, by) {
    var d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function isManager() { return S.me && S.me.role === '管帳'; }

  /* ---------- 計算 ---------- */

  function sorted() {
    return S.entries.slice().sort(function (a, b) {
      return a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : (a.date < b.date ? 1 : -1);
    });
  }
  function balance() {
    return S.entries.reduce(function (t, e) {
      if (e.type === '收入') return t + e.amount;
      if (e.type === '還款') return t - e.amount;
      return e.source === '公基金' ? t - e.amount : t;
    }, 0);
  }
  function owedList() {
    var map = {};
    S.entries.forEach(function (e) {
      if (e.type === '支出' && e.source === '代墊') map[e.advancer] = (map[e.advancer] || 0) + e.amount;
      if (e.type === '還款') map[e.advancer] = (map[e.advancer] || 0) - e.amount;
    });
    return Object.keys(map).filter(function (k) { return map[k] !== 0; })
      .map(function (k) { return { name: k, amount: map[k] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }
  function sums(list) {
    var o = { income: 0, expense: 0 };
    list.forEach(function (e) {
      if (e.type === '收入') o.income += e.amount;
      if (e.type === '支出') o.expense += e.amount;
    });
    return o;
  }
  function peopleNames() {
    var seen = {}, out = [];
    function add(n) { if (n && !seen[n]) { seen[n] = 1; out.push(n); } }
    S.members.forEach(function (m) { if (m.role !== '待審核') add(m.name); });
    S.entries.forEach(function (e) { add(e.advancer); });
    return out;
  }

  /* ---------- 後端 ---------- */

  function api(action, payload) {
    if (MOCK) return window.MOCK_API(action, payload || {});
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      // 用 text/plain 避免瀏覽器先送 preflight（Apps Script 不支援）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: S.idToken, payload: payload || {} })
    }).then(function (r) {
      if (!r.ok) throw new Error('伺服器沒有回應（' + r.status + '）');
      return r.json();
    }).then(function (j) {
      if (!j.ok) throw new Error(j.error || '發生錯誤');
      return j.data;
    });
  }

  function applyInit(d) {
    S.me = d.me;
    S.entries = d.entries || [];
    S.categories = d.categories || [];
    S.members = d.members || [];
  }

  /* ---------- 啟動 ---------- */

  function boot() {
    var ready;
    if (MOCK) {
      S.canSend = true;
      ready = Promise.resolve();
    } else if (!CONFIG.LIFF_ID || !CONFIG.API_URL) {
      $app.innerHTML = '<div class="welcome"><h1>BAND FUND</h1><h2>樂團記帳</h2>' +
        '<p>尚未完成設定。請依 SETUP.md 填入 <code>config.js</code> 的 LIFF ID 與後端網址。</p>' +
        '<a class="btn" href="?mock=1"><span>先看示範畫面</span><span>→</span></a></div>';
      return;
    } else {
      ready = liff.init({ liffId: CONFIG.LIFF_ID }).then(function () {
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return new Promise(function () {}); }
        S.idToken = liff.getIDToken();
        var ctx = liff.getContext() || {};
        S.canSend = liff.isInClient() && ['group', 'room', 'utou'].indexOf(ctx.type) >= 0 &&
          liff.isApiAvailable('sendMessages');
      });
    }
    ready.then(function () { return api('init'); }).then(function (d) {
      applyInit(d);
      window.addEventListener('hashchange', function () { S.flashKeep = false; render(); });
      render();
    }).catch(function (err) {
      $app.innerHTML = '<div class="state"><p>' + esc(err.message || err) + '</p>' +
        '<button class="mini-btn" data-act="reload">重新載入</button></div>';
    });
  }

  /* ---------- 路由 ---------- */

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var i = h.indexOf('?');
    if (i >= 0) {
      new URLSearchParams(h.slice(i + 1)).forEach(function (v, k) { q[k] = v; });
      h = h.slice(0, i);
    }
    var parts = h.split('/').filter(Boolean);
    return { name: parts[0] || 'home', id: parts[1] ? decodeURIComponent(parts[1]) : '', q: q };
  }

  function render() {
    if (!S.me) return;
    if (S.me.role !== '管帳' && S.me.role !== '檢視') { $app.innerHTML = viewPending(); return; }

    var r = route();
    var body, tab = r.name, hasBar = false, gradient = false;

    if ((r.name === 'new' || r.name === 'edit') && !isManager()) { location.hash = '#/home'; return; }
    if (r.name !== 'new' && r.name !== 'edit') { S.form = null; S.formKey = ''; }
    if (r.name !== 'entry') S.confirmDelete = false;

    if (r.name === 'list') { body = viewList(); hasBar = isManager(); }
    else if (r.name === 'entry') { body = viewEntry(r.id); tab = 'list'; hasBar = isManager(); }
    else if (r.name === 'new' || r.name === 'edit') { body = viewForm(r); tab = ''; hasBar = true; gradient = true; }
    else if (r.name === 'report') body = viewReport();
    else if (r.name === 'members') body = viewMembers();
    else { body = viewHome(); tab = 'home'; hasBar = isManager(); }

    var notice = (S.error ? '<div class="error" role="alert">' + esc(S.error) + '</div>' : '') +
      (S.flash ? '<div class="flash" role="status">' + esc(S.flash) + '</div>' : '');

    $app.innerHTML =
      '<header class="shell"><div class="shell-in"><span class="shell-title">樂團記帳</span>' +
      '<span class="shell-me">' + esc(S.me.name) + '・' + esc(S.me.role) + '</span></div></header>' +
      '<main class="page' + (hasBar ? ' has-bar' : '') + (gradient ? ' on-gradient' : '') +
      (S.busy ? ' busy' : '') + '">' + body.top + notice + body.main + '</main>' +
      (body.bar ? '<div class="bar"><div class="bar-in">' + body.bar + '</div></div>' : '') +
      tabs(tab);

    S.error = '';
    if (!S.flashKeep) S.flash = '';
    S.flashKeep = false;
  }

  function tabs(on) {
    var items = [
      ['home', '總覽', '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>'],
      ['list', '明細', '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'],
      ['report', '報表', '<path d="M5 20V10M12 20V4M19 20v-7"/>'],
      ['members', '成員', '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-5 8-5s6.500 1 8 5"/>']
    ];
    return '<nav class="tabs" aria-label="主要分頁"><div class="tabs-in">' + items.map(function (t) {
      return '<a class="tab' + (on === t[0] ? ' on' : '') + '" href="#/' + t[0] + '"' +
        (on === t[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' +
        t[2] + '</svg>' + t[1] + '</a>';
    }).join('') + '</div></nav>';
  }

  function head(title, sub, back) {
    return (back ? '<a class="back" href="' + back[0] + '">‹ ' + esc(back[1]) + '</a>' : '') +
      '<div class="head"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>';
  }

  function entryRow(e) {
    var bits = [shortDate(e.date)];
    if (e.note) bits.push(e.note);
    if (e.type === '支出' && e.source === '代墊') bits.push(e.advancer + ' 代墊');
    if (e.type === '還款') bits.push('還給 ' + e.advancer);
    var cls = e.type === '收入' ? 'green' : 'red';
    var sign = e.type === '收入' ? '+' : '−';
    return '<a class="row" href="#/entry/' + encodeURIComponent(e.id) + '">' +
      '<div class="row-main"><b>' + esc(e.category || e.type) + '</b><span>' + esc(bits.join('・')) + '</span></div>' +
      '<div class="row-amt num ' + cls + '">' + sign + money(e.amount) +
      (e.receiptId ? '<small>有單據</small>' : '') + '</div></a>';
  }

  var ADD_BAR = '<a class="btn btn-primary" href="#/new">記一筆</a>';

  /* ---------- 總覽 ---------- */

  function viewHome() {
    var m = today().slice(0, 7);
    var ms = sums(S.entries.filter(function (e) { return e.date.slice(0, 7) === m; }));
    var owed = owedList();
    var recent = sorted().slice(0, 5);
    var bal = balance();

    var main = '<section class="card"><div class="hero-label">BAND FUND</div>' +
      '<div class="hero-sub">大家一起存下來的公基金，現在還有</div>' +
      '<div class="hero-num num' + (bal < 0 ? ' red' : '') + '">' + signed(bal) + '</div>' +
      '<div class="pair"><div><small>本月收入</small><b class="num green">+' + money(ms.income) + '</b></div>' +
      '<div><small>本月支出</small><b class="num red">−' + money(ms.expense) + '</b></div></div></section>';

    main += '<h2 class="sec-title">還沒還給團員的錢</h2><section class="card flush">';
    if (!owed.length) main += '<div class="empty">目前沒有人代墊，帳都結清了。</div>';
    owed.forEach(function (o) {
      main += '<div class="row"><div class="row-main"><b>' + esc(o.name) + '</b><span>' +
        (o.amount > 0 ? '先幫樂團墊了錢' : '還款超過代墊金額，請檢查') + '</span></div>' +
        '<div class="row-amt num">' + signed(o.amount) + '</div>' +
        (isManager() && o.amount > 0 ? '<a class="mini-btn" href="#/new?type=' + encodeURIComponent('還款') +
          '&to=' + encodeURIComponent(o.name) + '&amount=' + o.amount + '">還款</a>' : '') + '</div>';
    });
    main += '</section>';

    main += '<h2 class="sec-title">最近的帳目<a href="#/list">看全部</a></h2><section class="card flush">';
    main += recent.length ? recent.map(entryRow).join('') : '<div class="empty">還沒有任何帳目。</div>';
    main += '</section>';

    return {
      top: head('總覽', isManager() ? '看看公基金現況，有新的收支就在下方記一筆。' : '公基金的現況都在這裡，點任一筆可以看單據。'),
      main: main, bar: isManager() ? ADD_BAR : ''
    };
  }

  /* ---------- 明細 ---------- */

  function viewList() {
    if (!S.month) S.month = today().slice(0, 7);
    var inMonth = sorted().filter(function (e) { return e.date.slice(0, 7) === S.month; });
    var list = inMonth.filter(function (e) { return S.typeFilter === '全部' || e.type === S.typeFilter; });
    var ms = sums(inMonth);

    var main = '<div class="stepper"><button data-act="month" data-v="-1" aria-label="上個月">‹</button>' +
      '<b>' + monthLabel(S.month) + '</b>' +
      '<button data-act="month" data-v="1" aria-label="下個月">›</button></div>' +
      '<div class="seg" role="group" aria-label="類型">' + ['全部', '收入', '支出', '還款'].map(function (t) {
        return '<button data-act="type-filter" data-v="' + t + '"' + (S.typeFilter === t ? ' class="on" aria-pressed="true"' : '') + '>' + t + '</button>';
      }).join('') + '</div>' +
      '<div class="totals"><span>收入 <b class="num green">+' + money(ms.income) + '</b></span>' +
      '<span>支出 <b class="num red">−' + money(ms.expense) + '</b></span><span>共 ' + list.length + ' 筆</span></div>' +
      '<section class="card flush">' +
      (list.length ? list.map(entryRow).join('') : '<div class="empty">這個月沒有符合的帳目。</div>') + '</section>';

    return { top: head('明細', '切換月份或類型找到那一筆，點進去看完整內容與單據。'), main: main, bar: isManager() ? ADD_BAR : '' };
  }

  /* ---------- 帳目詳情 ---------- */

  function viewEntry(id) {
    var e = S.entries.filter(function (x) { return x.id === id; })[0];
    var back = ['#/list', '回明細'];
    if (!e) return { top: head('找不到這筆帳目', '它可能已經被刪除。', back), main: '', bar: '' };

    var cls = e.type === '收入' ? 'green' : 'red';
    var rows = [['日期', e.date], ['類型', e.type], ['分類', e.category || '—']];
    if (e.type === '支出') rows.push(['付款來源', e.source === '代墊' ? e.advancer + ' 代墊' : '公基金']);
    if (e.type === '還款') rows.push(['還款對象', e.advancer]);
    rows.push(['說明', e.note || '—'], ['記錄者', e.recorder || '—']);

    var rc = S.receipts[e.receiptId];
    var receipt = !e.receiptId ? '<p class="muted">這筆沒有附單據。</p>'
      : rc ? '<img src="' + rc + '" alt="單據照片">'
        : '<button class="mini-btn" data-act="receipt" data-v="' + esc(e.receiptId) + '">查看單據照片</button>';

    var main = '<section class="card"><div class="hero-label">' + esc(e.type) + '</div>' +
      '<div class="hero-num num ' + cls + '">' + (e.type === '收入' ? '+' : '−') + money(e.amount) + '</div>' +
      '<dl class="dl">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') +
      '</dl></section><h2 class="sec-title">單據</h2><section class="card receipt">' + receipt + '</section>';

    var bar = '';
    if (isManager()) {
      bar = S.confirmDelete
        ? '<button class="btn btn-gray" data-act="delete-cancel">先不要</button><button class="btn btn-danger" data-act="delete" data-v="' + esc(e.id) + '">確定刪除</button>'
        : '<button class="btn btn-gray btn-narrow" data-act="delete-ask">刪除</button><a class="btn btn-primary" href="#/edit/' + encodeURIComponent(e.id) + '">編輯</a>';
    }
    return { top: head(e.category || e.type, shortDate(e.date) + ' 由 ' + (e.recorder || '—') + ' 記錄。', back), main: main, bar: bar };
  }

  /* ---------- 記一筆 ---------- */

  function initForm(r) {
    var key = r.name + ':' + r.id + ':' + JSON.stringify(r.q);
    if (S.formKey === key && S.form) return;
    S.formKey = key;
    var e = r.name === 'edit' ? S.entries.filter(function (x) { return x.id === r.id; })[0] : null;
    S.form = e ? {
      id: e.id, type: e.type, amount: String(e.amount), date: e.date, category: e.category, note: e.note,
      source: e.source || '公基金', advancer: e.advancer, hasReceipt: !!e.receiptId,
      photo: null, removeReceipt: false, send: false
    } : {
      id: '', type: r.q.type || '支出', amount: r.q.amount || '', date: today(), category: '', note: '',
      source: '公基金', advancer: r.q.to || '', hasReceipt: false,
      photo: null, removeReceipt: false, send: S.canSend
    };
  }

  function viewForm(r) {
    initForm(r);
    var f = S.form, editing = !!f.id;
    if (r.name === 'edit' && !editing) return { top: head('找不到這筆帳目', '它可能已經被刪除。', ['#/list', '回明細']), main: '', bar: '' };

    var cats = S.categories.filter(function (c) { return c.type === f.type; }).map(function (c) { return c.name; });
    if (f.category && f.type !== '還款' && cats.indexOf(f.category) < 0) cats.push(f.category);
    var people = peopleNames();
    var needPerson = f.type === '還款' || (f.type === '支出' && f.source === '代墊');

    function chips(act, list, cur) {
      return '<div class="chips">' + list.map(function (n) {
        return '<button type="button" class="chip' + (cur === n ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(n) + '"' +
          (cur === n ? ' aria-pressed="true"' : '') + '>' + esc(n) + '</button>';
      }).join('') + '</div>';
    }
    function seg(act, list, cur, label) {
      return '<div class="seg" role="group" aria-label="' + label + '">' + list.map(function (n) {
        return '<button type="button" data-act="' + act + '" data-v="' + n + '"' + (cur === n ? ' class="on" aria-pressed="true"' : '') + '>' + n + '</button>';
      }).join('') + '</div>';
    }

    var photo;
    if (f.photo) {
      photo = '<div class="photo-prev"><img src="' + f.photo.url + '" alt="單據預覽"><button type="button" class="link-btn" data-act="photo-remove">移除照片</button></div>';
    } else if (f.hasReceipt && !f.removeReceipt) {
      photo = '<div class="photo-prev"><span>已附單據</span><label class="link-btn">更換<input type="file" id="photo" accept="image/*" hidden></label>' +
        '<button type="button" class="link-btn" data-act="receipt-remove">移除</button></div>';
    } else {
      photo = '<label class="photo-pick">拍照或選擇照片<input type="file" id="photo" accept="image/*"></label>';
    }

    var main = '<form class="card" id="form" novalidate>' +
      '<div class="field"><span class="label">類型</span>' + seg('f-type', ['支出', '收入', '還款'], f.type, '類型') + '</div>' +
      '<div class="field"><label for="f-amount">金額</label><input class="input amount num" id="f-amount" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off" value="' + esc(f.amount) + '"></div>' +
      '<div class="field"><label for="f-date">日期</label><input class="input" id="f-date" type="date" value="' + esc(f.date) + '"></div>' +
      (f.type !== '還款' ? '<div class="field"><span class="label">分類</span>' + chips('f-cat', cats, f.category) + '</div>' : '') +
      (f.type === '支出' ? '<div class="field"><span class="label">誰付的錢</span>' + seg('f-source', ['公基金', '代墊'], f.source, '付款來源') + '</div>' : '') +
      (needPerson ? '<div class="field"><label for="f-adv">' + (f.type === '還款' ? '還給誰' : '代墊的人') + '</label>' +
        chips('f-adv', people, f.advancer) +
        '<input class="input" id="f-adv" placeholder="或輸入名字" autocomplete="off" value="' + esc(people.indexOf(f.advancer) < 0 ? f.advancer : '') + '"></div>' : '') +
      '<div class="field"><label for="f-note">說明</label><input class="input" id="f-note" maxlength="200" placeholder="例如：11 月練團室" autocomplete="off" value="' + esc(f.note) + '"></div>' +
      '<div class="field"><span class="label">單據</span>' + photo + '</div>' +
      (S.canSend && !editing ? '<div class="field"><label class="check"><input type="checkbox" id="f-send"' + (f.send ? ' checked' : '') + '>存檔後在群組送出一則摘要</label></div>' : '') +
      '</form>';

    var backTo = editing ? '#/entry/' + encodeURIComponent(f.id) : '#/home';
    return {
      top: head(editing ? '編輯帳目' : '記一筆', '選類型、填金額，拍下單據就完成。', [backTo, editing ? '回這筆帳目' : '回總覽']),
      main: main,
      bar: '<a class="btn btn-gray btn-narrow" href="' + backTo + '">取消</a><button class="btn btn-primary" data-act="save">儲存</button>'
    };
  }

  function syncForm() {
    var f = S.form;
    if (!f) return;
    function val(id) { var el = document.getElementById(id); return el ? el.value : null; }
    var a = val('f-amount'); if (a !== null) f.amount = a.replace(/[^\d]/g, '');
    var d = val('f-date'); if (d !== null) f.date = d;
    var n = val('f-note'); if (n !== null) f.note = n;
    var adv = val('f-adv'); if (adv !== null && adv.trim()) f.advancer = adv.trim();
    var s = document.getElementById('f-send'); if (s) f.send = s.checked;
  }

  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.8);
        resolve({ url: dataUrl, mime: 'image/jpeg', data: dataUrl.split(',')[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('這個檔案不是可用的圖片')); };
      img.src = url;
    });
  }

  function summaryText(f) {
    var lines = ['【樂團記帳】' + f.type + ' ' + money(Number(f.amount)) +
      (f.type !== '還款' && f.category ? '｜' + f.category : '') + '｜' + shortDate(f.date)];
    if (f.note) lines.push(f.note);
    if (f.type === '支出' && f.source === '代墊') lines.push(f.advancer + ' 代墊');
    if (f.type === '還款') lines.push('還給 ' + f.advancer);
    lines.push('公基金餘額 ' + signed(balance()));
    return lines.join('\n');
  }

  function save() {
    syncForm();
    var f = S.form;
    var amount = Number(f.amount);
    var err = '';
    if (!(amount > 0)) err = '請填入金額。';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) err = '請選擇日期。';
    else if (f.type !== '還款' && !f.category) err = '請選一個分類。';
    else if (f.type === '還款' && !f.advancer) err = '請選擇要還給誰。';
    else if (f.type === '支出' && f.source === '代墊' && !f.advancer) err = '請選擇代墊的人。';
    if (err) { S.error = err; render(); window.scrollTo(0, 0); return; }

    var payload = {
      id: f.id, type: f.type, amount: amount, date: f.date, category: f.category, note: f.note.trim(),
      source: f.source, advancer: f.advancer, removeReceipt: f.removeReceipt
    };
    if (f.photo) payload.receipt = { mime: f.photo.mime, data: f.photo.data };

    S.busy = true; render();
    api(f.id ? 'update' : 'add', payload).then(function (d) {
      S.entries = d.entries;
      S.busy = false;
      S.flash = f.id ? '已更新這筆帳目。' : '已記下這筆' + f.type + '。';
      var sending = Promise.resolve();
      if (!f.id && f.send && S.canSend) {
        var text = summaryText(f);
        sending = MOCK ? Promise.resolve(console.log('[mock] 群組摘要\n' + text))
          : liff.sendMessages([{ type: 'text', text: text }]).catch(function () {
            S.flash += '（群組摘要沒有送出）';
          });
      }
      return sending.then(function () {
        S.form = null; S.formKey = '';
        go(f.id ? '#/entry/' + encodeURIComponent(d.id) : '#/home');
      });
    }).catch(fail);
  }

  function go(hash) {
    S.flashKeep = true;
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function fail(err) {
    S.busy = false;
    S.error = err.message || String(err);
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- 報表 ---------- */

  function viewReport() {
    var years = {};
    S.entries.forEach(function (e) { years[e.date.slice(0, 4)] = 1; });
    var thisYear = today().slice(0, 4);
    years[thisYear] = 1;
    var list = Object.keys(years).sort();
    if (!S.year || list.indexOf(S.year) < 0) S.year = thisYear;
    var idx = list.indexOf(S.year);

    var byMonth = {}, byCat = {}, tot = { income: 0, expense: 0 };
    S.entries.forEach(function (e) {
      if (e.date.slice(0, 4) !== S.year || e.type === '還款') return;
      var m = e.date.slice(5, 7);
      byMonth[m] = byMonth[m] || { income: 0, expense: 0 };
      if (e.type === '收入') { byMonth[m].income += e.amount; tot.income += e.amount; }
      else { byMonth[m].expense += e.amount; tot.expense += e.amount; byCat[e.category || '未分類'] = (byCat[e.category || '未分類'] || 0) + e.amount; }
    });
    var months = Object.keys(byMonth).sort();
    var cats = Object.keys(byCat).map(function (k) { return [k, byCat[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var top = cats.length ? cats[0][1] : 1;
    function net(n) { return '<td class="num ' + (n < 0 ? 'red' : 'green') + '">' + (n < 0 ? '−' : '+') + money(n) + '</td>'; }

    var main = '<div class="stepper"><button data-act="year" data-v="-1" aria-label="前一年"' + (idx <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<b>' + S.year + ' 年</b><button data-act="year" data-v="1" aria-label="後一年"' + (idx >= list.length - 1 ? ' disabled' : '') + '>›</button></div>';

    main += '<h2 class="sec-title">每月收支</h2><section class="card flush">';
    if (!months.length) main += '<div class="empty">這一年還沒有帳目。</div>';
    else {
      main += '<table class="table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>結餘</th></tr></thead><tbody>' +
        months.map(function (m) {
          var v = byMonth[m];
          return '<tr><td>' + Number(m) + ' 月</td><td class="num">' + money(v.income) + '</td><td class="num">' + money(v.expense) + '</td>' + net(v.income - v.expense) + '</tr>';
        }).join('') + '</tbody><tfoot><tr><td>全年</td><td class="num">' + money(tot.income) + '</td><td class="num">' + money(tot.expense) + '</td>' + net(tot.income - tot.expense) + '</tr></tfoot></table>';
    }
    main += '</section><h2 class="sec-title">大家的錢花在哪</h2><section class="card flush">';
    if (!cats.length) main += '<div class="empty">這一年還沒有支出。</div>';
    cats.forEach(function (c) {
      main += '<div class="barrow"><div class="barrow-top"><span>' + esc(c[0]) + '</span><b class="num">' + money(c[1]) + '</b></div>' +
        '<div class="track"><i style="width:' + Math.max(2, Math.round(c[1] / top * 100)) + '%"></i></div></div>';
    });
    main += '</section><p class="muted" style="font-size:12px">支出包含團員代墊的金額；還款不重複計入。</p>';

    return { top: head('報表', '切換年份，回顧每個月的收支與花費去向。'), main: main, bar: '' };
  }

  /* ---------- 成員 ---------- */

  function viewMembers() {
    var order = { '待審核': 0, '管帳': 1, '檢視': 2 };
    var list = S.members.slice().sort(function (a, b) { return order[a.role] - order[b.role]; });
    var main = '<section class="card flush">';
    list.forEach(function (m) {
      var ctl = isManager() && m.userId
        ? '<select class="role-select" data-role-user="' + esc(m.userId) + '" aria-label="' + esc(m.name) + ' 的角色">' +
          ['管帳', '檢視', '待審核'].map(function (r) { return '<option' + (r === m.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>'
        : '<span class="role-tag">' + esc(m.role) + '</span>';
      main += '<div class="row"><div class="row-main"><b>' + esc(m.name) + '</b><span>' +
        (m.role === '管帳' ? '可以記帳與管理成員' : m.role === '檢視' ? '可以查看帳目與單據' : '等待核准，目前看不到帳目') +
        '</span></div>' + ctl + '</div>';
    });
    if (!list.length) main += '<div class="empty">還沒有成員。</div>';
    main += '</section>';
    return {
      top: head('成員', isManager() ? '新加入的團員會排在最上面，幫他們選一個角色。' : '這些人可以看到樂團的帳目。'),
      main: main, bar: ''
    };
  }

  /* ---------- 等待核准 ---------- */

  function viewPending() {
    return '<div class="welcome"><h1>BAND FUND</h1><h2>樂團記帳</h2>' +
      '<p>' + esc(S.me.name) + '，你已經登記了。等管帳的團員核准之後，就能看到樂團的帳目。</p>' +
      '<button class="btn" data-act="reload"><span>重新整理</span><span>→</span></button></div>';
  }

  /* ---------- 事件 ---------- */

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    if (el.tagName === 'BUTTON') ev.preventDefault();

    if (act === 'reload') location.reload();
    else if (act === 'month') { S.month = shiftMonth(S.month, Number(v)); render(); }
    else if (act === 'type-filter') { S.typeFilter = v; render(); }
    else if (act === 'year') {
      var ys = {}; S.entries.forEach(function (e) { ys[e.date.slice(0, 4)] = 1; }); ys[today().slice(0, 4)] = 1;
      var l = Object.keys(ys).sort(), i = l.indexOf(S.year) + Number(v);
      if (l[i]) { S.year = l[i]; render(); }
    }
    else if (act === 'f-type') { syncForm(); S.form.type = v; S.form.category = ''; render(); }
    else if (act === 'f-cat') { syncForm(); S.form.category = v; render(); }
    else if (act === 'f-source') { syncForm(); S.form.source = v; render(); }
    else if (act === 'f-adv') {
      syncForm(); S.form.advancer = v; render();
      var inp = document.getElementById('f-adv'); if (inp) inp.value = '';
    }
    else if (act === 'photo-remove') { syncForm(); S.form.photo = null; render(); }
    else if (act === 'receipt-remove') { syncForm(); S.form.removeReceipt = true; render(); }
    else if (act === 'save') save();
    else if (act === 'delete-ask') { S.confirmDelete = true; render(); }
    else if (act === 'delete-cancel') { S.confirmDelete = false; render(); }
    else if (act === 'delete') {
      S.busy = true; render();
      api('delete', { id: v }).then(function (d) {
        S.entries = d.entries; S.busy = false; S.confirmDelete = false;
        S.flash = '已刪除這筆帳目。';
        go('#/list');
      }).catch(fail);
    }
    else if (act === 'receipt') {
      el.disabled = true; el.textContent = '載入中…';
      api('receipt', { receiptId: v }).then(function (d) {
        S.receipts[v] = 'data:' + d.mime + ';base64,' + d.data;
        render();
      }).catch(fail);
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'photo' && t.files && t.files[0]) {
      syncForm();
      compress(t.files[0]).then(function (p) {
        S.form.photo = p; S.form.removeReceipt = false; render();
      }).catch(fail);
    } else if (t.hasAttribute && t.hasAttribute('data-role-user')) {
      S.busy = true; render();
      api('setRole', { userId: t.getAttribute('data-role-user'), role: t.value }).then(function (members) {
        S.members = members; S.busy = false; S.flash = '已更新角色。'; S.flashKeep = true; render();
      }).catch(fail);
    }
  });

  // 輸入名字時取消已選的人名按鈕，避免兩者並存造成誤會
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'f-adv' && ev.target.value.trim() && S.form) {
      S.form.advancer = ev.target.value.trim();
      document.querySelectorAll('[data-act="f-adv"].on').forEach(function (b) { b.classList.remove('on'); });
    }
    if (ev.target.id === 'f-amount') ev.target.value = ev.target.value.replace(/[^\d]/g, '');
  });

  document.addEventListener('submit', function (ev) { ev.preventDefault(); });

  boot();
})();
