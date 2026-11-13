/**
 * 第一次使用時，在 Apps Script 編輯器選擇 setup 後按「執行」。
 * 會建立三個分頁、預設分類，以及存放單據的雲端硬碟資料夾。
 * 重複執行是安全的：已存在的分頁與資料不會被覆寫。
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_ENTRIES, ['編號', '日期', '類型', '金額', '分類', '說明',
    '付款來源', '代墊人／還款對象', '單據檔案ID', '記錄者', '建立時間', '已刪除']);
  ensureSheet_(ss, SHEET_MEMBERS, ['Line userId', '顯示名稱', '角色', '加入時間']);
  var cat = ensureSheet_(ss, SHEET_CATEGORIES, ['名稱', '適用類型']);

  if (cat.getLastRow() < 2) {
    cat.getRange(2, 1, 9, 2).setValues([
      ['團費', '收入'], ['演出收入', '收入'], ['贊助', '收入'], ['其他收入', '收入'],
      ['練團室', '支出'], ['器材', '支出'], ['交通', '支出'], ['餐飲', '支出'], ['其他支出', '支出']
    ]);
  }

  // 日期欄維持純文字，避免試算表自動改格式
  ss.getSheetByName(SHEET_ENTRIES).getRange('B:B').setNumberFormat('@');

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RECEIPT_FOLDER_ID')) {
    var folder = DriveApp.createFolder('樂團記帳－單據');
    props.setProperty('RECEIPT_FOLDER_ID', folder.getId());
  }

  var first = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  Logger.log('設定完成。請到「專案設定 → 指令碼屬性」新增 LINE_CHANNEL_ID。');
}

function ensureSheet_(ss, name, headers) {
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}
