# 進階測試版 0.2.0-beta.1

保留輕量版錄影、攝影機、浮水印、全域快捷鍵、設定記憶與框選範圍功能，另內建原生 FFmpeg 6.1.1 Windows x64 引擎。

## 新增功能

- MP4（H.264／AAC）、MKV（H.264／AAC）、WebM（VP9／Opus）輸出。
- 高畫質、平衡及較小檔案三種成品畫質。
- 停止錄影後自動轉檔，可關閉；錄影時先分塊寫入 WebM，原始檔保留。
- 原生精準裁切、分割、音量節點輸出，不需要播放整段影片；速度取決於片長、畫質及 CPU。
- MKV 無損快速封裝：不重新編碼，切點依關鍵影格，且不套用音量節點。需要精準時間或音量調整時請用精準模式。
- 完整影片轉檔、處理進度、取消、同名檔案自動加編號。

## 測試步驟

1. 開啟「錄影進階設定」，在「進階版影片輸出」選 MP4、平衡畫質，保留「停止錄影後自動轉檔」。
2. 錄製一段影片並停止。等待轉檔後確認資料夾同時有原始 WebM 與 MP4。
3. 載入本機影片，拖曳裁切範圍、調整音量節點，再輸出。也可在播放頭分割成兩段。
4. 改成 MKV 或 WebM，再試「轉換完整影片格式」。
5. 測試取消處理，確認原始影片仍在。

建議先以數分鐘影片測試，再測試長片。音訊波形分析仍會讀取影片資料；非常大的影片可能消耗較多記憶體。原始錄影與輸出檔各占磁碟空間。MKV 在內建播放器的支援程度依音視訊編碼而異，可用外部播放器檢查。

進階版與輕量版使用分開的設定資料夾，可並存；同時執行時全域快捷鍵可能衝突。

## 開發建置

```sh
npm ci
npm run prepare:advanced
node --test desktop/*.test.js
npm run dist:advanced
```

成品：`release-advanced/Screenrecorder-Pro-Advanced-0.2.0-beta.1-Portable.exe`。

## 第三方引擎

FFmpeg 6.1.1 essentials build，來源：eugeneware/ffmpeg-static 的 b6.1.1 Windows x64 發布檔（Gyan.dev 建置），透過獨立子行程執行。取用時驗證 SHA-256。原始授權及建置說明隨程式置於 resources/ffmpeg/LICENSE.txt 與 README.txt。

- 二進位與建置說明：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- FFmpeg 對應原始碼：https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- 建置來源及相依函式庫資訊：https://www.gyan.dev/ffmpeg/builds/

本版為測試版，尚未數位簽章。原生引擎轉檔測試會檢查三種格式、輸出長度、音量、取消與原檔保留；Windows 畫面擷取、不同裝置及長時間錄影仍需實機驗證。
