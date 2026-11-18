# Windows 進階測試版 0.2.0-beta.14：RVM 去背與 GPL-3.0

- 新增 Robust Video Matting（RVM）WebGPU 去背，並設為預設品質模式。
- 使用 RVM 的前景色與 alpha 遮罩合成，改善頭髮、細小邊緣及背景色溢出。
- RVM／WebGPU 無法使用時，自動退回 MediaPipe 多類別模型，再退回快速模型。
- 固定 ONNX Runtime Web 1.24.3 與 RVM 相容修補模型來源；首次載入去背模型需要網路連線。
- 專案程式碼授權改為 GPL-3.0-only；新增 GPL 授權全文與第三方元件聲明。
- 網頁版與 Windows 進階版共用 RVM 去背實作。
