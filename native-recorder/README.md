# Rust 原生錄影核心（第一階段實驗版）

保留 Electron 介面、快捷鍵、儲存位置、播放與剪輯；原生模式不經過 Canvas 或 MediaRecorder。

## 資料流程

Windows Graphics Capture → Rust 最新畫面槽 → 固定 30 FPS → FFmpeg 單次編碼 → 暫存 MKV。
WASAPI（CPAL）→ 有上限的音訊佇列 → 個別 PCM 暫存檔。
停止後混合系統音訊與麥克風、編碼 AAC，再複製影片軌封裝 MP4／MKV，不再重編影片。

這不是 GPU 零複製版本：目前仍將 BGRA 畫面讀回記憶體，再交給 FFmpeg。硬體編碼透過 NVENC／QSV／AMF 的實際編碼探測選擇，無可用者回到 libx264／libx265；不保證所有顯示卡可用或一定比相容模式快。

## 使用

Windows 10 1903 以上／Windows 11，x64。開啟「錄影進階設定」，將錄影核心設為 Rust。
選擇即時儲存及 MP4／MKV，關閉內建攝影機與浮水印。螢幕與應用程式視窗均可擷取。
外部攝影機視窗可透過整個螢幕一起錄入；錄製單一視窗不會額外合成其他視窗。
系統音訊錄製開始時的預設播放裝置；麥克風使用 Windows 預設輸入裝置。

- 30 FPS 固定時間軸，暫停時間從聲音與影片中扣除；靜態畫面重用最新幀。
- 不顯示第二路即時預覽，停止後仍可使用既有播放器與編輯器。
- WebM、自訂範圍、內建攝影機、背景去背、浮水印及指定麥克風請使用原有相容模式。遇到不支援的選項會提示，絕不悄悄忽略。
- 視窗尺寸以開始時為準；錄影中放大超過起始尺寸的部分會裁切，縮小留下黑邊。避免錄影中改變尺寸或最小化來源。
- 48 kHz 雙聲道 PCM 每個來源每小時約 0.69 GB 額外暫存空間；停止合併期間還需要最終影片空間。成功後刪除暫存資料，失敗保留。
- 停止後的音訊合併時間取決於長度與磁碟速度。請等待完成後再關閉。

## 建置與驗證

從專案根目錄執行：

```powershell
cargo test --locked --manifest-path native-recorder/Cargo.toml
# 在 crate 目錄執行，讓 .cargo/config.toml 的靜態 CRT 設定生效
cd native-recorder
cargo build --locked --release --target x86_64-pc-windows-msvc
cd ..
New-Item -ItemType Directory -Force vendor/native
Copy-Item native-recorder/target/x86_64-pc-windows-msvc/release/screenrecorder-native.exe vendor/native/
npm run prepare:advanced
node --test desktop/*.test.js
node desktop/native-smoke.cjs
npm run dist:advanced -- --publish never
```

自動化：時間軸單元測試、IPC 生命週期與失敗案例、Windows 編譯與桌面擷取／暫停／MP4 解碼煙霧測試。
仍需實機確認系統音訊、麥克風、混音、不同 GPU、H.265、多螢幕 DPI、視窗最小化及至少一小時聲畫同步。

## 通訊與復原

獨立程序 stdin 接收一行 JSON 設定，後續為 `pause`／`resume`／`stop` 命令；stdout 僅輸出 JSON 事件。
停止指令／EOF 都會完成封裝。父程序逾時會終止程序樹，暫存檔保留於影片旁的 `*.native-work-*` 目錄。
其中 `video.mkv` 可用 FFmpeg 重新封裝；各 `*.pcm` 的取樣率／聲道記錄於同名 JSON，格式為 s16le。
原生核心不使用網路，也不把影音資料傳送至介面程序。
