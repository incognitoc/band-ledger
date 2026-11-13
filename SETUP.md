# 樂團記帳 — 上線設定步驟

三個地方各設定一次，約 20 分鐘。順序很重要：先 Google，再 GitHub，最後 Line。

## 一、Google（後端與資料）

1. 用樂團要保管帳目的 Google 帳號，新增一份 Google 試算表，命名為「樂團記帳」。
2. 選單 **擴充功能 → Apps Script**。
3. 把預設的 `程式碼.gs` 內容換成 [gas/Code.gs](gas/Code.gs) 的全部內容。
4. 左側按 **＋ → 指令碼**，命名為 `Setup`，貼上 [gas/Setup.gs](gas/Setup.gs) 的全部內容。存檔。
5. 上方函式選單選 `setup`，按 **執行**。第一次會要求授權（試算表、雲端硬碟、連外網路），同意即可。
   - 完成後試算表會出現「帳目／成員／分類」三個分頁，雲端硬碟多一個「樂團記帳－單據」資料夾。
6. 右上 **部署 → 新增部署作業**：
   - 類型：**網頁應用程式**
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   - 按部署，複製 **網頁應用程式網址**（結尾是 `/exec`）。這是「後端網址」。

> 之後若修改了 `Code.gs`，要到 **部署 → 管理部署作業 → 編輯 → 版本選「新版本」** 才會生效，網址不變。

## 二、GitHub（網站）

1. 建立一個 **public** repository（例如 `band-ledger`），把本專案推上去。
2. repo 的 **Settings → Pages**：Source 選 `Deploy from a branch`，Branch 選 `main`，資料夾選 `/ (root)`。
3. 等一兩分鐘，網站網址會是 `https://你的帳號.github.io/band-ledger/web/`（注意結尾的 `/web/`）。這是「網站網址」。
   - 在網址後面加 `?mock=1` 可以先看示範畫面，確認網站有正常上線。

## 三、Line（讓網站在 Line 裡開啟）

1. 到 [Line Developers Console](https://developers.line.biz/console/) 用你的 Line 帳號登入。
2. 建立一個 **Provider**（名稱隨意，例如樂團名）。
3. 在 Provider 下建立 **LINE Login** channel：
   - App types 勾 **Web app**
   - 建立後在 **Basic settings** 複製 **Channel ID**
4. 進入 channel 的 **LIFF** 分頁 → **Add**：
   - Size：**Full**
   - Endpoint URL：填第二步的「網站網址」
   - Scopes：勾 **openid**、**profile**、**chat_message.write**
   - 建立後複製 **LIFF ID**（格式像 `1234567890-abcdefgh`）
5. 把 channel 狀態從 **Developing** 切到 **Published**（頁面上方）。沒切的話只有你自己打得開。

## 四、把三邊接起來

1. 回到 Apps Script：**專案設定（齒輪）→ 指令碼屬性 → 新增**
   - 屬性：`LINE_CHANNEL_ID`，值：第三步的 Channel ID
2. 編輯 [web/config.js](web/config.js)，填入 LIFF ID 與後端網址，推上 GitHub。
3. 用手機 Line 開啟 `https://liff.line.me/你的LIFF_ID`。
   - **第一個開啟的人會自動成為管帳者**，所以請你自己先開一次，再分享給群組。
4. 在樂團群組貼上這個連結，長按訊息 → **設為公告**。之後團員從群組上方公告點進來即可。
5. 團員第一次開啟會顯示「等待核准」，你在網站的成員管理把他們設為「檢視」或「管帳」。

## 常見狀況

- **打開顯示「登入已過期」**：關掉頁面，從 Line 重新點連結。
- **想直接改資料**：可以直接編輯試算表，網站重新整理就會反映。刪除請把「已刪除」欄改成 `TRUE`，不要刪列。
- **想增減分類**：直接編輯「分類」分頁。
- **換管帳者**：在成員管理把新的人設為「管帳」，再由對方把你改為「檢視」。
