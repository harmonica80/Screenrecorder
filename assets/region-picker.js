window.chooseRecordingRegion = video => new Promise(resolve => {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:#0f172aee;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:white;padding:20px;border-radius:16px;max-width:1000px;width:100%;max-height:95vh;overflow:auto"><h2 style="font-size:20px;font-weight:bold">拖曳選擇錄影範圍</h2><p>在螢幕預覽上拖曳框選，確認後只錄製選取區域。</p><div data-stage style="position:relative;margin:12px auto;line-height:0;max-width:100%;touch-action:none;cursor:crosshair"><canvas style="width:100%;height:auto;max-height:65vh;object-fit:contain"></canvas><div data-box style="position:absolute;border:2px solid #ef4444;background:#ef444433;pointer-events:none;display:none"></div></div><p data-size role="status">尚未選取範圍</p><div style="display:flex;gap:12px;margin-top:12px"><button data-ok disabled style="padding:10px 16px;border:1px solid #cbd5e1;border-radius:8px">使用此範圍</button><button data-cancel style="padding:10px 16px;border:1px solid #cbd5e1;border-radius:8px">取消</button></div></div>';
  const canvas = overlay.querySelector('canvas');
  const stage = overlay.querySelector('[data-stage]');
  const box = overlay.querySelector('[data-box]');
  const ok = overlay.querySelector('[data-ok]');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  stage.style.width = `${Math.min(940, innerWidth - 80, (innerHeight * .65) * canvas.width / canvas.height)}px`;
  let origin, selection;
  const paint = () => { if (video.readyState >= 2) canvas.getContext('2d').drawImage(video, 0, 0); };
  paint();
  const timer = setInterval(paint, 250);
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  stage.addEventListener('pointerdown', event => { origin = point(event); stage.setPointerCapture(event.pointerId); });
  stage.addEventListener('pointermove', event => {
    if (!origin || !stage.hasPointerCapture(event.pointerId)) return;
    const end = point(event);
    const x = Math.min(origin.x, end.x), y = Math.min(origin.y, end.y);
    const width = Math.abs(origin.x - end.x), height = Math.abs(origin.y - end.y);
    selection = { x: Math.floor(x * canvas.width / 2) * 2, y: Math.floor(y * canvas.height / 2) * 2, width: Math.floor(width * canvas.width / 2) * 2, height: Math.floor(height * canvas.height / 2) * 2 };
    Object.assign(box.style, { display: 'block', left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` });
    ok.disabled = selection.width < 32 || selection.height < 32;
    overlay.querySelector('[data-size]').textContent = `${selection.width} × ${selection.height} 像素${ok.disabled ? '，請框選至少 32 × 32 像素' : ''}`;
  });
  stage.addEventListener('pointerup', event => { if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); });
  const close = value => { clearInterval(timer); document.removeEventListener('keydown', keydown); overlay.remove(); resolve(value); };
  const keydown = event => { if (event.key === 'Escape') close(null); };
  document.addEventListener('keydown', keydown);
  ok.addEventListener('click', () => close(selection));
  overlay.querySelector('[data-cancel]').addEventListener('click', () => close(null));
  document.body.appendChild(overlay);
});
