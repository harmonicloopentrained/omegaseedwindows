const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'omegaseed';
const APP_HOST = 'app';
const ROOT_DIR = path.resolve(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function resolveLocalPath(requestUrl) {
  const parsed = new URL(requestUrl);
  let pathname = decodeURIComponent(parsed.pathname || '/index.html');

  // omegaseed://app/index.html has host "app" and path "/index.html".
  // Keep the host reserved so relative URLs resolve consistently from index.html.
  if (parsed.hostname && parsed.hostname !== APP_HOST) {
    pathname = `/${parsed.hostname}${pathname}`;
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const targetPath = path.normalize(path.join(ROOT_DIR, relativePath));

  if (!targetPath.startsWith(ROOT_DIR)) {
    return null;
  }

  return targetPath;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#05070b',
    title: 'OmegaSeed',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`${APP_SCHEME}://`)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://`)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);

  if (process.env.OMEGASEED_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, request => {
    const localPath = resolveLocalPath(request.url);
    if (!localPath) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(localPath).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
