# 第三方元件與模型授權

本專案程式碼以 GNU GPL 第 3 版（GPL-3.0-only）授權，詳見 [LICENSE](LICENSE)。

## Robust Video Matting（RVM）
RVM 人像去背模型採用 GPL-3.0。網頁版使用 WebcamOverlay 專案提供的 WebGPU 相容修補模型，固定於提交 `52ccc3add7880acd35a0df51e7b8683975d4b72f`：
- 模型及其授權：[WebcamOverlay RVM vendor](https://github.com/harmonica80/WebcamOverlay/tree/52ccc3add7880acd35a0df51e7b8683975d4b72f/src/vendor/rvm)
- RVM 上游專案：[PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting)

## ONNX Runtime Web
ONNX Runtime Web 1.24.3 以 CDN 載入，採 MIT License：[Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime)。

## MediaPipe
RVM 不可用時使用 MediaPipe Tasks Vision 1.2.2 與 Selfie Segmentation 作為備援，依 Apache License 2.0 授權：[Google MediaPipe](https://github.com/google-ai-edge/mediapipe)。

網站說明與介面文字另依 README 所述 CC BY-NC-SA 4.0 授權。
