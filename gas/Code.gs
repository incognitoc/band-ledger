/**
 * 樂團記帳 — 後端（Google Apps Script，綁定在試算表上）
 *
 * 前端以 POST 傳入 JSON：{ action, idToken, payload }
 * 一律回傳 JSON：{ ok: true, data } 或 { ok: false, error }
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   LINE_CHANNEL_ID    Line Login channel 的 Channel ID（需手動填入）
 *   RECEIPT_FOLDER_ID  單據資料夾 ID（執行 setup() 後自動寫入）
 */

var SHEET_ENTRIES = '帳目';
var SHEET_MEMBERS = '成員';
var SHEET_CATEGORIES = '分類';

var ROLE_MANAGER = '管帳';
var ROLE_VIEWER = '檢視';
var ROLE_PENDING = '待審核';

var TYPES = ['收入', '支出', '還款'];
var SOURCES = ['公基金', '代墊'];

// 帳目欄位順序（與試算表標題列一致）
var ENTRY_COLS = ['id', 'date', 'type', 'amount', 'category', 'note', 'source',
  'advancer', 'receiptId', 'recorder', 'createdAt', 'deleted'];

var MAX_RECEIPT_BYTES = 6 * 1024 * 1024;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var user = verifyToken_(body.idToken);
    var me = getOrRegisterMember_(user);
    var data = route_(body.action, body.payload || {}, me);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, data: 'band-ledger backend is running' });
}

function route_(action, payload, me) {
  if (action === 'init') return init_(me);

  // 以下動作都需要已核准的身分
  if (me.role !== ROLE_MANAGER && me.role !== ROLE_VIEWER) throw new Error('尚未核准，無法查看帳目');
  if (action === 'receipt') return getReceipt_(payload);

  // 以下動作只有管帳者可用
  if (me.role !== ROLE_MANAGER) throw new Error('只有管帳者可以執行這個動作');
  if (action === 'add') return withLock_(function () { return addEntry_(payload, me); });
  if (action === 'update') return withLock_(function () { return updateEntry_(payload, me); });
  if (action === 'delete') return withLock_(function () { return deleteEntry_(payload); });
  if (action === 'setRole') return withLock_(function () { return setRole_(payload, me); });

  throw new Error('未知的動作：' + action);
}

/* ---------- 身分 ---------- */

function verifyToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new Error('缺少登入資訊，請從 Line 重新開啟');

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var channelId = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ID');
  if (!channelId) throw new Error('後端尚未設定 LINE_CHANNEL_ID');

  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('登入已過期，請關閉後從 Line 重新開啟');

  var claims = JSON.parse(res.getContentText());
  var user = { userId: claims.sub, name: claims.name || '未命名' };
  var ttl = Math.floor(claims.exp - Date.now() / 1000);
  if (ttl > 60) cache.put(key, JSON.stringify(user), Math.min(ttl, 3600));
  return user;
}

function getOrRegisterMember_(user) {
  var found = findMember_(user.userId);
  if (found) return found;

  return withLock_(function () {
    var again = findMember_(user.userId);
    if (again) return again;
    var sheet = sheet_(SHEET_MEMBERS);
    var rows = readRows_(sheet);
    var hasManager = rows.some(function (r) { return r[2] === ROLE_MANAGER; });
    // 第一位開啟的人成為管帳者，之後的人都是待審核
    var role = hasManager ? ROLE_PENDING : ROLE_MANAGER;
    sheet.appendRow([user.userId, safe_(user.name), role, now_()]);
    return { userId: user.userId, name: user.name, role: role };
  });
}

function findMember_(userId) {
  var rows = readRows_(sheet_(SHEET_MEMBERS));
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === userId) {
      return { userId: userId, name: String(rows[i][1]), role: String(rows[i][2]), row: i + 2 };
    }
  }
  return null;
}

function setRole_(payload, me) {
  var role = payload.role;
  if ([ROLE_MANAGER, ROLE_VIEWER, ROLE_PENDING].indexOf(role) < 0) throw new Error('角色不正確');
  var target = findMember_(String(payload.userId || ''));
  if (!target) throw new Error('找不到這位成員');
  if (target.userId === me.userId && role !== ROLE_MANAGER) {
    throw new Error('不能取消自己的管帳權限，請由另一位管帳者操作');
  }
  sheet_(SHEET_MEMBERS).getRange(target.row, 3).setValue(role);
  return listMembers_(true);
}

function listMembers_(withIds) {
  return readRows_(sheet_(SHEET_MEMBERS)).map(function (r) {
    var m = { name: String(r[1]), role: String(r[2]) };
    if (withIds) m.userId = String(r[0]);
    return m;
  });
}

/* ---------- 讀取 ---------- */

function init_(me) {
  var out = { me: { name: me.name, role: me.role } };
  if (me.role !== ROLE_MANAGER && me.role !== ROLE_VIEWER) return out;

  out.entries = listEntries_();
  out.categories = readRows_(sheet_(SHEET_CATEGORIES)).map(function (r) {
    return { name: String(r[0]), type: String(r[1]) };
  });
  out.members = listMembers_(me.role === ROLE_MANAGER);
  return out;
}

function listEntries_() {
  var out = [];
  readRows_(sheet_(SHEET_ENTRIES)).forEach(function (r) {
    var e = rowToEntry_(r);
    if (!e.deleted) { delete e.deleted; out.push(e); }
  });
  return out;
}

function rowToEntry_(r) {
  var e = {};
  ENTRY_COLS.forEach(function (c, i) { e[c] = r[i]; });
  e.id = String(e.id);
  e.date = dateStr_(e.date);
  e.amount = Number(e.amount) || 0;
  e.createdAt = e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt);
  e.deleted = e.deleted === true || String(e.deleted).toUpperCase() === 'TRUE';
  ['type', 'category', 'note', 'source', 'advancer', 'receiptId', 'recorder'].forEach(function (c) {
    e[c] = String(e[c] == null ? '' : e[c]);
  });
  return e;
}

function getReceipt_(payload) {
  var fileId = String(payload.receiptId || '');
  if (!fileId) throw new Error('缺少單據編號');
  // 只允許讀取帳目中登記過的單據，避免被當成任意讀檔的入口
  var known = readRows_(sheet_(SHEET_ENTRIES)).some(function (r) {
    return String(r[ENTRY_COLS.indexOf('receiptId')]) === fileId;
  });
  if (!known) throw new Error('找不到這張單據');
  var blob = DriveApp.getFileById(fileId).getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- 寫入 ---------- */

function addEntry_(payload, me) {
  var v = validateEntry_(payload);
  var receiptId = payload.receipt ? saveReceipt_(payload.receipt, v) : '';
  var id = Utilities.getUuid();
  sheet_(SHEET_ENTRIES).appendRow([
    id, v.date, v.type, v.amount, safe_(v.category), safe_(v.note), v.source,
    safe_(v.advancer), receiptId, safe_(me.name), now_(), false
  ]);
  return { id: id, entries: listEntries_() };
}

function updateEntry_(payload, me) {
  var rowNo = findEntryRow_(payload.id);
  var v = validateEntry_(payload);
  var sheet = sheet_(SHEET_ENTRIES);
  var old = rowToEntry_(sheet.getRange(rowNo, 1, 1, ENTRY_COLS.length).getValues()[0]);

  var receiptId = old.receiptId;
  if (payload.receipt) receiptId = saveReceipt_(payload.receipt, v);
  else if (payload.removeReceipt) receiptId = '';

  sheet.getRange(rowNo, 2, 1, 8).setValues([[
    v.date, v.type, v.amount, safe_(v.category), safe_(v.note), v.source, safe_(v.advancer), receiptId
  ]]);
  return { id: old.id, entries: listEntries_() };
}

function deleteEntry_(payload) {
  var rowNo = findEntryRow_(payload.id);
  sheet_(SHEET_ENTRIES).getRange(rowNo, ENTRY_COLS.indexOf('deleted') + 1).setValue(true);
  return { entries: listEntries_() };
}

function findEntryRow_(id) {
  id = String(id || '');
  var rows = readRows_(sheet_(SHEET_ENTRIES));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id) return i + 2;
  }
  throw new Error('找不到這筆帳目');
}

function validateEntry_(p) {
  var v = {
    date: String(p.date || ''),
    type: String(p.type || ''),
    amount: Number(p.amount),
    category: String(p.category || '').trim().slice(0, 40),
    note: String(p.note || '').trim().slice(0, 200),
    source: String(p.source || ''),
    advancer: String(p.advancer || '').trim().slice(0, 40)
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || isNaN(new Date(v.date).getTime())) throw new Error('日期格式不正確');
  if (TYPES.indexOf(v.type) < 0) throw new Error('類型不正確');
  if (!(v.amount > 0) || v.amount !== Math.floor(v.amount) || v.amount > 100000000) {
    throw new Error('金額必須是大於 0 的整數');
  }

  if (v.type === '收入') {
    v.source = '公基金'; v.advancer = '';
  } else if (v.type === '還款') {
    v.source = '公基金'; v.category = '還款';
    if (!v.advancer) throw new Error('請選擇還款對象');
  } else {
    if (SOURCES.indexOf(v.source) < 0) throw new Error('請選擇付款來源');
    if (v.source === '代墊' && !v.advancer) throw new Error('請選擇代墊人');
    if (v.source === '公基金') v.advancer = '';
  }
  return v;
}

function saveReceipt_(receipt, v) {
  var mime = String(receipt.mime || '');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw new Error('單據必須是圖片');
  var bytes = Utilities.base64Decode(String(receipt.data || ''));
  if (!bytes.length) throw new Error('單據圖片是空的');
  if (bytes.length > MAX_RECEIPT_BYTES) throw new Error('單據圖片太大');

  var folderId = PropertiesService.getScriptProperties().getProperty('RECEIPT_FOLDER_ID');
  if (!folderId) throw new Error('後端尚未建立單據資料夾，請先執行 setup()');
  var ext = mime.split('/')[1].replace('jpeg', 'jpg');
  var name = v.date + '_' + v.type + '_' + v.amount + '_' + Date.now() + '.' + ext;
  var file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, mime, name));
  return file.getId();
}

/* ---------- 共用 ---------- */

function sheet_(name) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) throw new Error('找不到分頁「' + name + '」，請先執行 setup()');
  return s;
}

function readRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues()
    .filter(function (r) { return r[0] !== '' && r[0] != null; });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// 避免使用者輸入被試算表當成公式執行
function safe_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function dateStr_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(d).slice(0, 10);
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
