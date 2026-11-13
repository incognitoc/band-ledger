// 假資料模式：網址加上 ?mock=1 啟用，資料只存在記憶體，重新整理就還原。
// 可再加上 &role=viewer 或 &role=pending 檢查其他角色看到的畫面。
(function () {
  var role = new URLSearchParams(location.search).get('role');
  var myRole = role === 'viewer' ? '檢視' : role === 'pending' ? '待審核' : '管帳';

  var d = new Date();
  function ym(back) {
    var x = new Date(d.getFullYear(), d.getMonth() - back, 1);
    return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2);
  }
  var seq = 0;
  function E(back, day, type, amount, category, note, source, advancer, receipt) {
    seq++;
    return {
      id: 'm' + seq, date: ym(back) + '-' + ('0' + day).slice(-2), type: type, amount: amount,
      category: category, note: note, source: source || '公基金', advancer: advancer || '',
      receiptId: receipt ? 'r' + seq : '', recorder: '拉哥', createdAt: '2026-01-01T00:00:' + ('0' + seq).slice(-2)
    };
  }

  var entries = [
    E(2, 3, '收入', 6000, '團費', '第三季團費 5 人'),
    E(2, 10, '支出', 1600, '練團室', '兩小時', '公基金', '', true),
    E(2, 24, '支出', 1600, '練團室', '兩小時', '公基金', '', true),
    E(1, 5, '收入', 12000, '演出收入', '河岸留言'),
    E(1, 5, '支出', 900, '交通', '器材計程車', '代墊', '阿凱', true),
    E(1, 12, '支出', 3200, '器材', '鼓皮與鼓棒', '代墊', '小安', true),
    E(1, 20, '支出', 1600, '練團室', '兩小時', '公基金', '', true),
    E(1, 28, '還款', 900, '還款', '', '公基金', '阿凱'),
    E(0, 2, '收入', 6000, '團費', '第四季團費 5 人'),
    E(0, 6, '支出', 1800, '練團室', '加長到三小時', '公基金', '', true),
    E(0, 9, '支出', 1250, '餐飲', '演出後慶功', '代墊', '阿凱', true)
  ];
  var members = [
    { userId: 'u1', name: '拉哥', role: myRole },
    { userId: 'u2', name: '阿凱', role: '檢視' },
    { userId: 'u3', name: '小安', role: '檢視' },
    { userId: 'u4', name: '大衛', role: '待審核' }
  ];
  if (myRole !== '管帳') members.push({ userId: 'u0', name: '團長', role: '管帳' });
  var categories = [
    ['團費', '收入'], ['演出收入', '收入'], ['贊助', '收入'], ['其他收入', '收入'],
    ['練團室', '支出'], ['器材', '支出'], ['交通', '支出'], ['餐飲', '支出'], ['其他支出', '支出']
  ].map(function (c) { return { name: c[0], type: c[1] }; });
  var photos = {};

  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function placeholder() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#f1f1ee"/>' +
      '<text x="300" y="380" font-size="40" text-anchor="middle" fill="#888" font-family="sans-serif">示範單據</text>' +
      '<text x="300" y="440" font-size="24" text-anchor="middle" fill="#aaa" font-family="sans-serif">SAMPLE RECEIPT</text></svg>';
    return { mime: 'image/svg+xml', data: btoa(unescape(encodeURIComponent(svg))) };
  }

  window.MOCK_API = function (action, p) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(copy(handle(action, p))); } catch (e) { reject(e); }
      }, 300);
    });
  };

  function handle(action, p) {
    var me = { name: '拉哥', role: myRole };
    if (action === 'init') {
      if (myRole === '待審核') return { me: me };
      return {
        me: me, entries: entries, categories: categories,
        members: members.map(function (m) { return myRole === '管帳' ? m : { name: m.name, role: m.role }; })
      };
    }
    if (action === 'receipt') return photos[p.receiptId] || placeholder();
    if (myRole !== '管帳') throw new Error('只有管帳者可以執行這個動作');

    if (action === 'add' || action === 'update') {
      var e;
      if (action === 'add') {
        seq++;
        e = { id: 'm' + seq, receiptId: '', recorder: me.name, createdAt: new Date().toISOString() };
        entries.push(e);
      } else {
        e = entries.filter(function (x) { return x.id === p.id; })[0];
        if (!e) throw new Error('找不到這筆帳目');
      }
      e.date = p.date; e.type = p.type; e.amount = p.amount; e.note = p.note;
      e.category = p.type === '還款' ? '還款' : p.category;
      e.source = p.type === '支出' ? p.source : '公基金';
      e.advancer = (p.type === '還款' || (p.type === '支出' && p.source === '代墊')) ? p.advancer : '';
      if (p.receipt) { e.receiptId = 'r' + e.id + '_' + Date.now(); photos[e.receiptId] = p.receipt; }
      else if (p.removeReceipt) e.receiptId = '';
      return { id: e.id, entries: entries };
    }
    if (action === 'delete') {
      entries = entries.filter(function (x) { return x.id !== p.id; });
      return { entries: entries };
    }
    if (action === 'setRole') {
      var m = members.filter(function (x) { return x.userId === p.userId; })[0];
      if (m.userId === 'u1' && p.role !== '管帳') throw new Error('不能取消自己的管帳權限，請由另一位管帳者操作');
      m.role = p.role;
      return members;
    }
    throw new Error('未知的動作：' + action);
  }
})();
