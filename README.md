# 寶島大富翁

可愛台灣風景的 **3D 大富翁**：40 格棋盤走遍離島、山海、夜市與都會，買地、蓋房、收過路費、用道具，最後存活的人獲勝。
單機可跟四種難度的電腦玩，也可以開線上房間跟朋友玩、邀請觀戰。平板觸控優先，手機、桌機都能玩。

- 前端：純 HTML／CSS／JavaScript，3D 使用 [three.js](https://threejs.org/)（MIT，精簡版已放在 `public/vendor/three.min.js`），沒有建置步驟
- 伺服器：Node.js（>= 22），**零第三方依賴**（自己實作 WebSocket），房間只存在記憶體
- 規則與電腦共用同一份程式（`public/js/rules.js`、`ai.js`），單機與線上不會出現兩套規則

## 快速開始

```bash
node server.js          # 或 npm start
# 打開 http://localhost:3100
```

Windows 可以直接按兩下 `啟動遊戲.bat`。只玩單機的話，伺服器不是必要的，但 three.js 以 ES 模組載入，請用 `http://` 開啟，不要直接用 `file://`。

> 需要瀏覽器支援 **WebGL**（近幾年的手機、平板、電腦瀏覽器都有）。不支援時會顯示說明文字，玩不了。

## 玩法摘要

- 擲骰前進，停在空地可以買；踩到別人的地要付過路費；同色整組可以蓋房子、旅店，租金大漲
- 停在「機會」「命運」抽卡；監獄擲雙骰、繳 50 元或用出獄許可證離開
- 沒有交易與拍賣，改成 **強制收購**：已經有同色組其他格時，可以用 2 倍地價買下最後一塊（沒蓋房才行，每回合一次）
- **道具**（最多帶 3 個）：停在溫泉休息站或抽到道具卡取得。「遙控骰」自己選走 1～6 步、「機票」飛到任何一格（不能去坐牢，倒飛不領薪水）；「免租券」「防收購券」「招財貓」在適當時機自動生效
- 勝負：其他人都破產，最後存活的人獲勝；也可以設回合上限（20／30／40 回合，或無上限），時間到比總資產
- 電腦難度：幼幼班（亂玩、不用道具）、簡單、普通、困難（會搶整組、算過路費風險、聰明地用道具與收購）
- 顏色以外還有形狀（圓、方、三角、菱形）區分玩家，色盲也看得出來

## 操作

- 點棋盤上的格子看說明；拖曳轉動視角、雙指／滾輪縮放、雙擊回正；右下角按鈕切換「跟著棋子／看全圖」
- 空白鍵或 Enter：擲骰、買地、結束回合；Esc：開選單或關視窗
- 右上角齒輪：背景音樂／音效（各自音量）、震動、減少動態、加快動畫、大字，設定會存在這台裝置

## 環境變數

複製 `.env.example` 參考（伺服器本身不會自動讀 `.env`，請由平台或 shell 設定）：

| 變數 | 用途 | 預設 |
| --- | --- | --- |
| `PORT` | 伺服器埠號 | `3100` |
| `GAME_SERVER_URL` | 前端要連的遊戲伺服器（僅在前端與伺服器分開部署時使用，建置時注入） | 同源 |
| `ALLOW_ORIGIN` | 允許連線的前端來源（正式環境請填前端網址，例如 `https://<帳號>.github.io`） | `*` |

前端只從 `public/js/config.js` 這一個模組讀取伺服器位置，程式其他地方沒有寫死網址。

## 測試

```bash
npm test               # 規則單元測試＋電腦互打 100 局（不需要瀏覽器）
npm run test:online    # 啟動真的伺服器，用 WebSocket 測房間、邀請、觀戰、斷線重連
npm run test:browser   # Playwright：5 種視窗尺寸、設定彈窗、3D 棋盤、道具、單機一整局、線上流程
```

`test:browser` 需要 Playwright 與 Chromium（`npm i -g playwright`），無 GPU 的環境會用軟體 WebGL，比較慢。

## 部署（免費方案）

專案已整理成可由 Git 平台匯入的狀態，**不會自動推送或部署**，請自行決定：

1. **伺服器**：Render 免費 Web Service（`render.yaml`）。Build 留空、Start 為 `node server.js`、健康檢查 `/health`。免費方案會休眠，第一位玩家進來要等 30～60 秒喚醒；房間只存在記憶體，服務重啟後未打完的對局不會恢復
2. **前端**（選用）：GitHub Pages（`.github/workflows/pages.yml`）。在 repo 的 Variables 設定 `GAME_SERVER_URL` 為伺服器網址，工作流程會在建置時執行 `node scripts/inject-server-url.js` 注入；正式建置不接受 `localhost`
3. 伺服器 `ALLOW_ORIGIN` 請填前端網址；正式環境使用 HTTPS／WSS
4. 想省事也可以只部署伺服器，它本身就會提供 `public/` 靜態檔案（同源，不必設 `GAME_SERVER_URL`）

## 目錄

```
server.js            HTTP 靜態檔 + /health + /api/presence + /api/rooms + WebSocket
lib/                 ws.js（WebSocket）、rooms.js（房間、邀請 token、觀戰、斷線代打）
public/js/rules.js   規則核心（伺服器為準）、ai.js 電腦、rng.js 種子亂數
public/js/board3d.js three.js 3D 棋盤；board.js 棋盤操作面板與動畫；solo.js 單機；online.js 線上
tests/  scripts/     測試與部署輔助
```

## 假設與限制

- 沒有交易、拍賣（以強制收購取代）；40 格為接近經典版的台灣版配置
- 美術為程式繪製的向量圖與 3D 幾何，音效／音樂為程式合成，皆為暫用，可換成正式資產
- 邀請連結有房間範圍、有效期限，房主可撤銷；房間滿員時可選擇以觀戰身分加入
- 不支援沒有 WebGL 的瀏覽器；不做帳號與永久排行榜，戰績只記在本機

## 授權

MIT。three.js 為 MIT 授權（Copyright © 2010-2026 three.js authors）。
