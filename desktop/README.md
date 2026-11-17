# Windows 進階版開發與建置

本分支只建置 Windows 進階版。線上版部署於 GitHub Pages，Windows 輕量版已停止維護與發布。

## 開發測試

```bash
npm ci
npm run prepare:advanced
npm start
```

## 測試與建立 Portable

```bash
node --test desktop/*.test.js
npm run dist:advanced
```

產出檔位於 `release-advanced/`。進階測試版會使用獨立的 `desktop/advanced-builder.json`，並將原生錄影核心及 FFmpeg 一起打包。
