function createShortcuts(globalShortcut, dispatch) {
  return {
    configure(bindings) {
      globalShortcut.unregisterAll();
      const failed = [];
      for (const key of new Set(Object.values(bindings || {}))) {
        if (typeof key !== 'string' || !key || key.length > 80) continue;
        const accelerator = key.replace(/Meta/g, 'Super').replace(/\+\+$/, '+Plus');
        let lastTrigger = -Infinity;
        try { if (!globalShortcut.register(accelerator, () => {
          const now = Date.now(), repeated = now - lastTrigger < 400;
          lastTrigger = now;
          if (!repeated) dispatch(key);
        })) failed.push(key); }
        catch { failed.push(key); }
      }
      return failed;
    },
    clear() { globalShortcut.unregisterAll(); }
  };
}
module.exports = { createShortcuts };
