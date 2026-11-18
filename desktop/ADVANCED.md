# 進階測試版 0.2.0-beta.2

保留輕量版錄影、攝影機、浮水印、全域快捷鍵、設定記憶與框選範圍功能，另內建原生 FFmpeg 6.1.1 Windows x64 引擎。

## 新增功能

- MP4（H.264／AAC）、MKV（H.264／AAC）、WebM（VP9／Opus）輸出。
- 高畫質、平衡及較小檔案三種成品畫質。
- 預設即時錄影：可選 MP4、MKV 或 WebM，直接寫入所選容器，無須停止後再處理整段影片。
- 即時 MP4：VP8 擷取後同步編碼成 H.264／AAC，使用分段 MP4，停止時完成剩餘編碼與封裝。CPU 負擔較高，ultrafast 編碼的檔案可能較大。
- 即時 MKV：保留擷取時的影音編碼直接封裝；即時 WebM：直接分塊寫入。兩者避免額外影片重新編碼，畫質取決於擷取設定。
- 保留「先錄 WebM，停止後再轉檔」模式及自動轉檔核取方塊；此模式才保留原始 WebM。
- 錄影開始時固定本次格式及畫質；待寫資料超過 64 MiB 或引擎失敗時停止錄影並報錯，避免無限堆積記憶體。未完成的檔案會保留，但不保證可完整播放。
- 原生精準裁切、分割、音量節點輸出，不需要播放整段影片；速度取決於片長、畫質及 CPU。
- MKV 無損快速封裝：不重新編碼，切點依關鍵影格，且不套用音量節點。需要精準時間或音量調整時請用精準模式。
- 完整影片轉檔、處理進度、取消、同名檔案自動加編號。

## 測試步驟

1. 開啟「錄影進階設定」，選「即時儲存所選格式」，分別測試 MP4、MKV、WebM。
2. 錄製一段影片、暫停／繼續並停止，確認所選副檔名、影音同步與播放正常；即時模式只產生一份檔案。另測試「先錄 WebM，停止後再轉檔」，確認保留原始 WebM。
3. 載入本機影片，拖曳裁切範圍、調整音量節點，再輸出。也可在播放頭分割成兩段。
4. 改成 MKV 或 WebM，再試「轉換完整影片格式」。
5. 測試取消處理，確認原始影片仍在。

建議先以數分鐘影片測試，再測試長片。音訊波形分析仍會讀取影片資料；非常大的影片可能消耗較多記憶體。事後轉檔模式的原始錄影與輸出檔各占磁碟空間。即時 MP4 若跟不上擷取速度，停止後仍需等候剩餘處理，請改用 MKV／WebM 或降低畫質。MKV 在內建播放器的支援程度依音視訊編碼而異，可用外部播放器檢查。

進階版與輕量版使用分開的設定資料夾，可並存；同時執行時全域快捷鍵可能衝突。

## 開發建置

```sh
npm ci
npm run prepare:advanced
node --test desktop/*.test.js
npm run dist:advanced
```

成品：`release-advanced/Screenrecorder-Pro-Advanced-0.2.0-beta.2-Portable.exe`。

## 第三方引擎

FFmpeg 6.1.1 essentials build，來源：eugeneware/ffmpeg-static 的 b6.1.1 Windows x64 發布檔（Gyan.dev 建置），透過獨立子行程執行。取用時驗證 SHA-256。原始授權及建置說明隨程式置於 resources/ffmpeg/LICENSE.txt 與 README.txt。

- 二進位與建置說明：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- FFmpeg 對應原始碼：https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- 建置來源及相依函式庫資訊：https://www.gyan.dev/ffmpeg/builds/

本版為測試版，尚未數位簽章。原生引擎轉檔測試會檢查三種格式、輸出長度、音量、取消與原檔保留；Windows 畫面擷取、不同裝置及長時間錄影仍需實機驗證。
