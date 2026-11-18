# 螢幕錄影工具 Pro（Screenrecorder）

本專案目前提供 **線上版**與 **Windows 進階版**，適合教學示範、簡報解說與課程錄製。

## 攝影機去背\n\n預設使用 RVM 高品質去背（WebGPU）。初次使用需連線載入 ONNX Runtime Web 與 RVM 模型；若裝置不支援 WebGPU 或載入失敗，會自動改用 MediaPipe。\n\n## 線上版

**[立即開啟線上版](https://harmonica80.github.io/Screenrecorder/)**

免下載、免安裝，使用瀏覽器錄製螢幕與攝影機畫面。支援麥克風、可用的系統或分頁音訊、倒數、浮水印、攝影機子母畫面及影片預覽下載。錄影資料在本機瀏覽器處理；瀏覽器支援的擷取來源與影片格式可能不同。錄影完成後關閉頁面時，瀏覽器會詢問是否離開。

## Windows 進階版

**[開啟進階版下載頁（Latest）](https://github.com/harmonica80/Screenrecorder/releases/latest)**

適用 Windows 10／11 x64，免安裝 Portable 執行檔。提供 WebM、MP4、MKV 輸出，支援 H.264／H.265 選項、影片剪輯，以及實驗中的 Rust 原生錄影核心。進階版持續以測試版發布，請閱讀各版發布說明後再更新。

## 開發與授權

進階版原始碼與建置說明位於 [advanced-preview 分支](https://github.com/harmonica80/Screenrecorder/tree/advanced-preview)。網站說明與介面文字採用 [創用 CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant)；程式原始碼改採 [GNU GPL 第 3 版（GPL-3.0-only）](LICENSE)。
