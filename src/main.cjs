const { app, BrowserWindow, clipboard, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const settingsPath = () => path.join(app.getPath('userData'), 'window.json');
let widgetWindow;
let blocksMenuWindow;
let blocksMenuAnchor = { x: 0, y: 0, width: 0, height: 0 };
let blocksMenuPosition;
const blocksMenuSize = { width: 206, height: 300 };
let blocksMenuFixedSize = { ...blocksMenuSize };
let blocksMenuMoveTimer;
let blocksMenuResizeTimer;
let diagnosticRecording = false;

function recordDiagnostic(type, data = {}) {
  if (!diagnosticRecording || !widgetWindow || widgetWindow.isDestroyed()) return;
  const bounds = widgetWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  widgetWindow.webContents.send('diagnostics:event', {
    time: new Date().toISOString(),
    source: 'main',
    type,
    data: {
      ...data,
      widgetBounds: bounds,
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      workArea: display.workArea,
      menuBounds: blocksMenuWindow && !blocksMenuWindow.isDestroyed() ? blocksMenuWindow.getBounds() : null
    }
  });
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveBounds() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const { x, y, width, height } = widgetWindow.getBounds();
  fs.writeFileSync(settingsPath(), JSON.stringify({ x, y, width, height }));
}

function initialBounds() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find(display => display.id !== primary.id);
  const saved = readSettings();
  const width = Math.max(300, Math.min(saved.width || 360, 540));
  const height = Math.max(300, Math.min(saved.height || 410, 650));

  if (secondary) {
    const savedBounds = { x: saved.x, y: saved.y, width, height };
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && intersectsDisplay(secondary, savedBounds)) {
      return savedBounds;
    }
    return {
      x: secondary.workArea.x + Math.max(16, secondary.workArea.width - width - 24),
      y: secondary.workArea.y + 40,
      width,
      height
    };
  }

  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const savedBounds = { x: saved.x, y: saved.y, width, height };
    if (displays.some(display => intersectsDisplay(display, savedBounds))) return savedBounds;
  }

  return {
    x: primary.workArea.x + Math.max(16, primary.workArea.width - width - 24),
    y: primary.workArea.y + 40,
    width,
    height
  };
}

function intersectsDisplay(display, bounds) {
  const area = display.workArea;
  return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
}

function createWindow() {
  widgetWindow = new BrowserWindow({
    ...initialBounds(),
    minWidth: 260,
    minHeight: 100,
    maxWidth: 540,
    maxHeight: 650,
    title: 'Mic Level',
    frame: false,
    transparent: true,
    resizable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  widgetWindow.loadFile(path.join(__dirname, 'index.html'));
  widgetWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Widget page failed to load (${errorCode}): ${errorDescription}`);
    recordDiagnostic('widget-load-failed', { errorCode, errorDescription });
  });
  widgetWindow.webContents.on('console-message', details => {
    if (details.level >= 2) {
      console.error(`Widget renderer: ${details.message}`);
      recordDiagnostic('renderer-console-error', { level: details.level, message: details.message, line: details.lineNumber });
    }
  });
  widgetWindow.once('ready-to-show', () => {
    widgetWindow.show();
    recordDiagnostic('widget-ready-to-show');
  });
  widgetWindow.on('move', () => {
    saveBounds();
    recordDiagnostic('widget-move');
  });
  widgetWindow.on('resize', () => {
    saveBounds();
    recordDiagnostic('widget-resize', { contentSize: widgetWindow.getContentSize(), normalBounds: widgetWindow.getNormalBounds() });
  });
  widgetWindow.on('move', () => {
    if (!blocksMenuWindow || blocksMenuWindow.isDestroyed() || blocksMenuMoveTimer) return;
    blocksMenuMoveTimer = setTimeout(() => {
      blocksMenuMoveTimer = undefined;
      repositionBlocksMenu('widget-move');
    }, 16);
  });
  widgetWindow.on('resize', () => {
    clearTimeout(blocksMenuResizeTimer);
    blocksMenuResizeTimer = setTimeout(() => repositionBlocksMenu('widget-resize'), 100);
  });
  widgetWindow.on('move', () => {
    if (!blocksMenuWindow || blocksMenuWindow.isDestroyed() || blocksMenuMoveTimer) return;
    blocksMenuMoveTimer = setTimeout(() => {
      blocksMenuMoveTimer = undefined;
      repositionBlocksMenu('widget-move');
    }, 16);
  });
  widgetWindow.on('resize', () => {
    clearTimeout(blocksMenuResizeTimer);
    blocksMenuResizeTimer = setTimeout(() => repositionBlocksMenu('widget-resize'), 100);
  });
  widgetWindow.on('focus', () => recordDiagnostic('widget-focus'));
  widgetWindow.on('blur', () => recordDiagnostic('widget-blur'));
  widgetWindow.on('show', () => recordDiagnostic('widget-show'));
  widgetWindow.on('hide', () => recordDiagnostic('widget-hide'));
  widgetWindow.on('blur', () => {
    setTimeout(() => {
      if (blocksMenuWindow && BrowserWindow.getFocusedWindow() !== blocksMenuWindow) closeBlocksMenu();
    }, 80);
  });
  widgetWindow.on('closed', () => { widgetWindow = null; });
}

function closeBlocksMenu() {
  if (!blocksMenuWindow || blocksMenuWindow.isDestroyed()) return;
  recordDiagnostic('popup-hide');
  blocksMenuWindow.hide();
  blocksMenuPosition = undefined;
  widgetWindow?.webContents.send('blocks-menu:closed');
}

function getBlocksMenuPosition(buttonBounds = blocksMenuAnchor) {
  const bounds = widgetWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const anchorX = bounds.x + buttonBounds.x;
  const anchorY = bounds.y + buttonBounds.y;
  const anchorHeight = buttonBounds.height;
  const menuWidth = blocksMenuFixedSize.width;
  const menuHeight = blocksMenuFixedSize.height;
  const x = Math.max(workArea.x + 8, Math.min(anchorX, workArea.x + workArea.width - menuWidth - 8));
  const belowY = anchorY + anchorHeight + 5;
  const fitsBelow = belowY + menuHeight <= workArea.y + workArea.height - 8;
  const desiredY = fitsBelow ? belowY : anchorY - menuHeight - 5;
  const y = Math.max(workArea.y + 8, Math.min(desiredY, workArea.y + workArea.height - menuHeight - 8));
  return { x, y };
}

function repositionBlocksMenu(reason) {
  if (!blocksMenuWindow || blocksMenuWindow.isDestroyed() || !widgetWindow || widgetWindow.isDestroyed()) return;
  const position = getBlocksMenuPosition();
  if (blocksMenuPosition?.x === position.x && blocksMenuPosition?.y === position.y) return;
  const previousBounds = blocksMenuWindow.getBounds();
  blocksMenuPosition = position;
  blocksMenuWindow.setBounds({ ...position, ...blocksMenuFixedSize }, false);
  recordDiagnostic('popup-reposition', {
    reason,
    position,
    previousBounds,
    resultingBounds: blocksMenuWindow.getBounds(),
    fixedSize: blocksMenuFixedSize
  });
}

function toggleBlocksMenu(visible, buttonBounds) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  if (!visible || (blocksMenuWindow && !blocksMenuWindow.isDestroyed())) {
    if (visible && blocksMenuWindow && !blocksMenuWindow.isDestroyed()) {
      blocksMenuAnchor = buttonBounds;
      const position = getBlocksMenuPosition(buttonBounds);
      blocksMenuPosition = position;
      const previousBounds = blocksMenuWindow.getBounds();
      blocksMenuWindow.setBounds({ ...position, ...blocksMenuFixedSize }, false);
      blocksMenuWindow.show();
      blocksMenuWindow.focus();
      recordDiagnostic('popup-show-existing', { position, previousBounds, bounds: blocksMenuWindow.getBounds(), fixedSize: blocksMenuFixedSize });
    } else {
      closeBlocksMenu();
    }
    return;
  }
  blocksMenuAnchor = buttonBounds;
  const position = getBlocksMenuPosition(buttonBounds);
  blocksMenuPosition = position;

  blocksMenuWindow = new BrowserWindow({
    ...position,
    ...blocksMenuSize,
    parent: widgetWindow,
    modal: false,
    frame: false,
    transparent: true,
    resizable: false,
    minWidth: blocksMenuSize.width,
    maxWidth: blocksMenuSize.width,
    minHeight: blocksMenuSize.height,
    maxHeight: blocksMenuSize.height,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'menu-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  recordDiagnostic('popup-created', { position, requestedSize: blocksMenuSize });
  const menuWindow = blocksMenuWindow;
  blocksMenuWindow.loadFile(path.join(__dirname, 'blocks-menu.html'));
  blocksMenuWindow.once('ready-to-show', () => {
    if (blocksMenuWindow === menuWindow) {
      const firstBounds = menuWindow.getBounds();
      blocksMenuFixedSize = { width: firstBounds.width, height: firstBounds.height };
      menuWindow.setMinimumSize(blocksMenuFixedSize.width, blocksMenuFixedSize.height);
      menuWindow.setMaximumSize(blocksMenuFixedSize.width, blocksMenuFixedSize.height);
      menuWindow.setBounds({ ...position, ...blocksMenuFixedSize }, false);
      recordDiagnostic('popup-size-locked', { requestedSize: blocksMenuSize, effectiveSize: blocksMenuFixedSize, bounds: menuWindow.getBounds() });
      blocksMenuWindow.show();
      recordDiagnostic('popup-ready-show', { bounds: blocksMenuWindow.getBounds() });
    }
  });
  blocksMenuWindow.on('closed', () => {
    recordDiagnostic('popup-destroyed');
    if (blocksMenuWindow === menuWindow) blocksMenuWindow = null;
    widgetWindow?.webContents.send('blocks-menu:closed');
  });
  blocksMenuWindow.on('blur', () => {
    recordDiagnostic('popup-blur');
    setTimeout(() => {
      if (blocksMenuWindow === menuWindow && BrowserWindow.getFocusedWindow() !== widgetWindow) {
        recordDiagnostic('popup-blur-close');
        closeBlocksMenu();
      }
    }, 80);
  });
  blocksMenuWindow.on('move', () => recordDiagnostic('popup-move', { bounds: blocksMenuWindow?.getBounds() }));
  blocksMenuWindow.on('resize', () => recordDiagnostic('popup-resize', { bounds: blocksMenuWindow?.getBounds() }));
  blocksMenuWindow.on('focus', () => recordDiagnostic('popup-focus'));
  blocksMenuWindow.on('show', () => recordDiagnostic('popup-show'));
  blocksMenuWindow.on('hide', () => recordDiagnostic('popup-hide-event'));
  blocksMenuWindow.webContents.on('did-finish-load', async () => {
    const visibility = await widgetWindow?.webContents.executeJavaScript(
      `JSON.parse(localStorage.getItem('widget-block-visibility') || '{}')`
    );
    blocksMenuWindow?.webContents.send('blocks-menu:init', visibility || {});
    recordDiagnostic('popup-page-loaded', { visibility });
  });
  blocksMenuWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    recordDiagnostic('popup-load-failed', { errorCode, errorDescription });
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media');
  screen.on('display-added', (_event, display) => recordDiagnostic('display-added', { display }));
  screen.on('display-removed', (_event, display) => recordDiagnostic('display-removed', { display }));
  screen.on('display-metrics-changed', (event, display, metrics) => recordDiagnostic('display-metrics-changed', { display, metrics }));

  ipcMain.on('window:minimize', () => widgetWindow?.minimize());
  ipcMain.on('window:close', () => widgetWindow?.close());
  ipcMain.on('window:always-on-top', (_event, enabled) => {
    widgetWindow?.setAlwaysOnTop(Boolean(enabled), 'screen-saver');
  });
  ipcMain.on('window:fit-content', (_event, requestedHeight) => {
    if (!widgetWindow || !Number.isFinite(requestedHeight)) return;
    const [contentWidth, contentHeight] = widgetWindow.getContentSize();
    const bounds = widgetWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const maxHeight = Math.min(650, display.workArea.height - 24);
    const height = Math.max(100, Math.min(Math.ceil(requestedHeight), maxHeight));
    recordDiagnostic('fit-content-request', { requestedHeight, currentContentSize: [contentWidth, contentHeight], targetHeight: height });
    if (Math.abs(contentHeight - height) > 2) widgetWindow.setContentSize(contentWidth, height);
  });
  ipcMain.on('window:blocks-menu', (_event, visible, buttonBounds) => {
    recordDiagnostic('popup-toggle-request', { visible: Boolean(visible), buttonBounds });
    toggleBlocksMenu(Boolean(visible), buttonBounds);
  });
  ipcMain.on('window:blocks-menu-anchor', (_event, buttonBounds) => {
    if (!blocksMenuWindow || blocksMenuWindow.isDestroyed()) return;
    blocksMenuAnchor = buttonBounds;
    const position = getBlocksMenuPosition(buttonBounds);
    if (blocksMenuPosition?.x === position.x && blocksMenuPosition?.y === position.y) return;
    recordDiagnostic('popup-anchor-update', { buttonBounds, oldPosition: blocksMenuPosition, newPosition: position });
    repositionBlocksMenu('renderer-anchor');
  });
  ipcMain.on('blocks-menu:close', closeBlocksMenu);
  ipcMain.on('blocks-menu:visibility', (event, name, visible) => {
    if (!blocksMenuWindow || event.sender !== blocksMenuWindow.webContents) return;
    widgetWindow?.webContents.send('blocks-menu:visibility', name, Boolean(visible));
    recordDiagnostic('block-visibility', { name, visible: Boolean(visible) });
  });
  ipcMain.on('diagnostics:set-recording', (_event, enabled) => {
    const nextValue = Boolean(enabled);
    if (!nextValue && diagnosticRecording) recordDiagnostic('capture-stopped');
    diagnosticRecording = nextValue;
    if (diagnosticRecording) recordDiagnostic('capture-started-main');
  });
  ipcMain.handle('diagnostics:copy-text', (_event, text) => {
    clipboard.writeText(String(text));
    return true;
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', saveBounds);
app.on('window-all-closed', () => app.quit());