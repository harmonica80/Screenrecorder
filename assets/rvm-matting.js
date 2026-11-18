(function () {
  const ORT_JS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.webgpu.min.js';
  const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
  const MODEL_URL = 'https://raw.githubusercontent.com/harmonica80/WebcamOverlay/52ccc3add7880acd35a0df51e7b8683975d4b72f/src/vendor/rvm/rvm_mobilenetv3_webgpu.onnx';

  class RVMMatting {
    constructor() {
      this.session = null;
      this.states = null;
      this.width = 0;
      this.height = 0;
      this.longSide = 960;
      this.timings = [];
    }
    async initialize() {
      if (this.session) return;
      if (!navigator.gpu) throw new Error('此瀏覽器沒有 WebGPU，RVM 將改用備援模型');
      if (!window.ort) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = ORT_JS;
          script.onload = resolve;
          script.onerror = () => reject(new Error('ONNX Runtime 載入失敗'));
          document.head.appendChild(script);
        });
      }
      const ort = window.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = ORT_WASM;
      ort.env.webgpu.powerPreference = 'high-performance';
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('找不到可用的 WebGPU 裝置');
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['webgpu'], graphOptimizationLevel: 'all'
      });
      this.ort = ort;
    }
    reset() {
      if (this.states) Object.values(this.states).forEach(t => t?.dispose?.());
      this.states = null;
      this.width = 0;
      this.height = 0;
    }
    async infer(frame) {
      await this.initialize();
      const started = performance.now();
      const scale = Math.min(1, this.longSide / Math.max(frame.width, frame.height));
      const width = Math.max(16, Math.round(frame.width * scale / 16) * 16);
      const height = Math.max(16, Math.round(frame.height * scale / 16) * 16);
      if (width !== this.width || height !== this.height) {
        this.reset();
        this.width = width;
        this.height = height;
      }
      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = width; inputCanvas.height = height;
      const ictx = inputCanvas.getContext('2d', { willReadFrequently: true });
      ictx.drawImage(frame, 0, 0, width, height);
      const pixels = ictx.getImageData(0, 0, width, height).data;
      const chw = new Float32Array(width * height * 3);
      const plane = width * height;
      for (let i = 0; i < plane; i++) {
        chw[i] = pixels[i * 4] / 255;
        chw[plane + i] = pixels[i * 4 + 1] / 255;
        chw[plane * 2 + i] = pixels[i * 4 + 2] / 255;
      }
      const tensor = new this.ort.Tensor('float32', chw, [1, 3, height, width]);
      const ratio = Math.min(1, 480 / Math.max(width, height));
      const feeds = {
        src: tensor,
        downsample_ratio: new this.ort.Tensor('float32', new Float32Array([ratio]), [1])
      };
      if (this.states) Object.assign(feeds, this.states);
      else for (const n of ['r1i', 'r2i', 'r3i', 'r4i']) feeds[n] = new this.ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
      let out;
      try {
        out = await this.session.run(feeds);
      } finally { tensor.dispose(); feeds.downsample_ratio.dispose(); }
      const pha = out.pha, fgr = out.fgr;
      const outH = pha.dims[2], outW = pha.dims[3], outPlane = outW * outH;
      const matteCanvas = document.createElement('canvas');
      matteCanvas.width = outW; matteCanvas.height = outH;
      const mctx = matteCanvas.getContext('2d');
      const matte = mctx.createImageData(outW, outH);
      const foregroundCanvas = document.createElement('canvas');
      foregroundCanvas.width = outW; foregroundCanvas.height = outH;
      const fctx = foregroundCanvas.getContext('2d');
      const foreground = fctx.createImageData(outW, outH);
      for (let i = 0; i < outPlane; i++) {
        const alpha = Math.max(0, Math.min(1, pha.data[i]));
        const p = i * 4;
        matte.data[p] = matte.data[p + 1] = matte.data[p + 2] = 255;
        matte.data[p + 3] = Math.round(alpha * 255);
        foreground.data[p] = Math.round(Math.max(0, Math.min(1, fgr.data[i])) * 255);
        foreground.data[p + 1] = Math.round(Math.max(0, Math.min(1, fgr.data[outPlane + i])) * 255);
        foreground.data[p + 2] = Math.round(Math.max(0, Math.min(1, fgr.data[outPlane * 2 + i])) * 255);
        foreground.data[p + 3] = 255;
      }
      mctx.putImageData(matte, 0, 0);
      fctx.putImageData(foreground, 0, 0);
      const next = {};
      for (const n of ['r1o', 'r2o', 'r3o', 'r4o']) {
        const t = out[n];
        if (t) next[n.replace('o', 'i')] = new this.ort.Tensor(t.type, new t.data.constructor(t.data), t.dims);
      }
      if (this.states) Object.values(this.states).forEach(t => t.dispose());
      this.states = next;
      Object.values(out).forEach(value => value.dispose?.());
      const elapsed = performance.now() - started;
      this.timings.push(elapsed); if (this.timings.length > 15) this.timings.shift();
      if (this.timings.length === 15 && this.longSide > 640) {
        const sorted = [...this.timings].sort((a,b) => a-b);
        if (sorted[7] > 45) { this.longSide = 640; this.reset(); }
      }
      return { matteCanvas, foregroundCanvas };
    }
    close() { this.reset(); this.session?.release?.(); this.session = null; }
  }
  window.RVMMatting = RVMMatting;
})();