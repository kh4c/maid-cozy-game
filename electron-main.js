// Electron main process for Maid Cozy Game.
// Serves the project dir through a custom 'maid://' protocol backed by disk —
// no TCP port, so it's immune to Windows loopback-port reservations (EACCES)
// and works fully offline. Assets load with normal XHR/fetch, same as when
// running under the python dev server.
const { app, BrowserWindow, Menu, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

// Must run before app ready: makes maid:// behave like http (relative URLs, XHR/fetch).
if (typeof protocol.registerSchemesAsPrivileged === 'function') { // Electron >= 41-ish
  protocol.registerSchemesAsPrivileged([
    { scheme: 'maid', privileges: { standard: true, supportFetchAPI: true, codeCache: true } },
  ]);
} else if (typeof protocol.registerSchemesAsStandard === 'function') { // older Electron
  protocol.registerSchemesAsStandard([{ scheme: 'maid' }]);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

function registerGameProtocol() {
  const root = path.resolve(__dirname);
  protocol.handle('maid', async (request) => {
    let p;
    try {
      p = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (!p || p === '/') p = '/index.html';
    const file = path.normalize(path.join(root, '.' + p));
    // never escape the project root
    if (file !== root && !file.startsWith(root + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'content-type': type } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#14121f',
    autoHideMenuBar: true,
    title: 'Maid Cozy Game',
  });
  Menu.setApplicationMenu(null); // it's a game; DevTools stays reachable via F12 / Ctrl+Shift+I
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
    }
  });
  await win.loadURL('maid://app/index.html');
}

app.whenReady().then(() => {
  registerGameProtocol();
  return createWindow();
}).catch((err) => {
  console.error(err);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
