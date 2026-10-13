(() => {
  const bridge = window.desktopRecorderBridge;
  const key = 'screenRecorderPreferencesV1';
  let data;
  try { data = bridge?.isDesktop ? bridge.initialPreferences : JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { data = {}; }
  data = { remember: true, values: {}, controls: {}, ...data };
  if (!data.remember) { data.values = {}; data.controls = {}; }
  const panel = document.querySelector('main > section');
  const controls = [...panel.querySelectorAll('input[id], select[id]')].filter(el => el.type !== 'file');
  const read = el => el.type === 'checkbox' ? el.checked : el.value;
  const defaults = Object.fromEntries(controls.map(el => [el.id, read(el)]));
  const apply = (el, value) => {
    if (el.type === 'checkbox') el.checked = value === true;
    else if (el.tagName !== 'SELECT' || [...el.options].some(option => option.value === value)) el.value = value;
  };
  for (const el of controls) if (Object.hasOwn(data.controls, el.id)) apply(el, data.controls[el.id]);
  let timer;
  const persist = () => {
    clearTimeout(timer);
    const snapshot = data.remember ? data : { remember: false, values: {}, controls: {} };
    const result = bridge?.isDesktop ? bridge.savePreferences(snapshot) : Promise.resolve(localStorage.setItem(key, JSON.stringify(snapshot)));
    return result.catch(error => { status.textContent = '設定儲存失敗：' + error.message; });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(persist, 100); };
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 0 0;font-size:14px;color:#334155';
  row.innerHTML = '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input id="rememberRecordingSettings" type="checkbox" style="accent-color:#2563eb">儲存上次錄影設定</label><button id="resetRecordingSettings" type="button" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:white">重設為預設值</button><span role="status" style="font-size:12px;color:#64748b;width:100%"></span>';
  panel.lastElementChild.appendChild(row);
  const remember = row.querySelector('input');
  const reset = row.querySelector('button');
  const status = row.querySelector('[role="status"]');
  remember.checked = data.remember;
  window.recordingPreferences = {
    storage: {
      getItem: name => data.values[name] ?? (bridge?.isDesktop || !data.remember ? null : localStorage.getItem(name)),
      setItem: (name, value) => { data.values[name] = String(value); schedule(); }
    },
    initialize(isBusy) {
      const capture = () => { data.controls = Object.fromEntries(controls.map(el => [el.id, read(el)])); schedule(); };
      // Dispatch after all application listeners exist so labels and previews match restored values.
      for (const el of controls) {
        if (Object.hasOwn(data.controls, el.id) && !['cameraToggle', 'micDeviceSelect', 'cameraDeviceSelect'].includes(el.id)) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (document.getElementById('cameraToggle').checked) document.getElementById('cameraToggle').dispatchEvent(new Event('change'));
      panel.addEventListener('input', capture);
      panel.addEventListener('change', capture);
      panel.addEventListener('keyup', capture);
      remember.addEventListener('change', async () => {
        data.remember = remember.checked;
        capture();
        await persist();
        status.textContent = remember.checked ? '將保留目前設定供下次使用。' : '下次開啟將使用預設錄影設定；指定儲存資料夾仍保留。';
      });
      reset.addEventListener('click', async () => {
        if (isBusy()) { status.textContent = '請先停止錄影，再重設設定。'; return; }
        data.values = {};
        for (const el of controls) {
          apply(el, defaults[el.id]);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        for (const button of panel.querySelectorAll('button[aria-expanded="true"]')) button.click();
        try {
          if (bridge?.isDesktop) {
            await bridge.clearRecordingFolder();
            document.getElementById('desktopFolderPath').textContent = '尚未指定（每次開始錄影時詢問）';
          }
          capture();
          await persist();
          status.textContent = '已還原預設錄影設定。';
        } catch (error) { status.textContent = '重設失敗：' + error.message; }
      });
      window.addEventListener('beforeunload', () => { capture(); persist(); });
    }
  };
})();
