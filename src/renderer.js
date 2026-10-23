const meterMath = window.AudioMeter;

const elements = {
  status: document.getElementById('status'),
  liveDot: document.getElementById('liveDot'),
  peak: document.getElementById('peak'),
  meter: document.querySelector('.meter'),
  meterFill: document.getElementById('meterFill'),
  meterThresholds: document.getElementById('meterThresholds'),
  deviceSelect: document.getElementById('deviceSelect'),
  rangeSlider: document.getElementById('rangeSlider'),
  rangeOutput: document.getElementById('rangeOutput'),
  alertVolumeSlider: document.getElementById('alertVolumeSlider'),
  alertVolumeOutput: document.getElementById('alertVolumeOutput'),
  rangeBlock: document.getElementById('rangeBlock'),
  alertVolumeBlock: document.getElementById('alertVolumeBlock'),
  statusBlock: document.getElementById('statusBlock'),
  meterBlock: document.getElementById('meterBlock'),
  peakBlock: document.getElementById('peakBlock'),
  deviceBlock: document.getElementById('deviceBlock'),
  filterBlock: document.getElementById('filterBlock'),
  diagnosticsBlock: document.getElementById('diagnosticsBlock'),
  diagnosticsState: document.getElementById('diagnosticsState'),
  diagnosticsToggle: document.getElementById('diagnosticsToggle'),
  diagnosticsCopy: document.getElementById('diagnosticsCopy'),
  diagnosticsClear: document.getElementById('diagnosticsClear'),
  diagnosticsLog: document.getElementById('diagnosticsLog'),
  pauseButton: document.getElementById('pauseButton'),
  pauseLabel: document.getElementById('pauseLabel'),
  alwaysOnTop: document.getElementById('alwaysOnTop'),
  blocksMenuButton: document.getElementById('blocksMenuButton'),
  voiceFilter: document.getElementById('voiceFilter'),
  filterStatus: document.getElementById('filterStatus'),
  notice: document.getElementById('notice'),
  noticeText: document.getElementById('noticeText'),
  retryButton: document.getElementById('retryButton')
};

let stream;
let audioContext;
let analyser;
let denoiser;
let muteNode;
let samples;
let animationFrame;
let paused = false;
let switching = false;
let restartAfterSwitch = false;
let resizeFrame;
let diagnosticsRecording = false;
let diagnosticLines = [];
let lastDeviceId = '';
const recentPeak = new meterMath.RecentPeak(2500);
const visibilityStorageKey = 'widget-block-visibility';
const alertThresholdsStorageKey = 'meter-alert-thresholds';
const alertVolumeStorageKey = 'meter-alert-volume';
const voiceFilterStorageKey = 'voice-filter-enabled-v2';
elements.voiceFilter.checked = localStorage.getItem(voiceFilterStorageKey) !== 'false';
const storedAlertVolume = Number(localStorage.getItem(alertVolumeStorageKey));
elements.alertVolumeSlider.value = String(Number.isFinite(storedAlertVolume) && localStorage.getItem(alertVolumeStorageKey) !== null
  ? Math.max(0, Math.min(100, storedAlertVolume))
  : 100);
let selectedAlertThresholds = new Set();
try {
  selectedAlertThresholds = new Set(JSON.parse(localStorage.getItem(alertThresholdsStorageKey) || '[]').filter(value => Number.isInteger(value) && value >= 10 && value <= 100 && value % 10 === 0));
} catch { /* use no alert thresholds */ }
const thresholdCrossings = new meterMath.ThresholdCrossings(4);
let lastAlertTime = 0;
const visibilityBlocks = {
  status: elements.statusBlock,
  meter: elements.meterBlock,
  peak: elements.peakBlock,
  device: elements.deviceBlock,
  range: elements.rangeBlock,
  alertVolume: elements.alertVolumeBlock,
  filter: elements.filterBlock,
  pause: elements.pauseButton,
  diagnostics: elements.diagnosticsBlock
};

function appendDiagnostic(type, data = {}, source = 'renderer', time = new Date().toISOString()) {
  if (!diagnosticsRecording) return;
  const event = { time, source, type, data };
  diagnosticLines.push(JSON.stringify(event));
  if (diagnosticLines.length > 500) diagnosticLines.shift();
  elements.diagnosticsLog.value = diagnosticLines.join('\n');
  elements.diagnosticsLog.scrollTop = elements.diagnosticsLog.scrollHeight;
  elements.diagnosticsCopy.disabled = diagnosticLines.length === 0;
}

function setDiagnosticsRecording(enabled) {
  if (!enabled && diagnosticsRecording) appendDiagnostic('capture-stopped');
  diagnosticsRecording = enabled;
  elements.diagnosticsState.textContent = enabled ? 'Capturando' : 'Detenido';
  elements.diagnosticsToggle.textContent = enabled ? 'Detener captura' : 'Iniciar captura';
  if (enabled) {
    appendDiagnostic('capture-started', {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio
    });
  }
  window.widget.setDiagnosticRecording(enabled);
}
function applyBlockVisibility() {
  let visibility = {};
  try { visibility = JSON.parse(localStorage.getItem(visibilityStorageKey) || '{}'); } catch { /* use defaults */ }
  for (const [name, block] of Object.entries(visibilityBlocks)) {
    const visible = visibility[name] !== false;
    block.hidden = !visible;
  }
}

function saveBlockVisibility(name, visible) {
  let visibility = {};
  try { visibility = JSON.parse(localStorage.getItem(visibilityStorageKey) || '{}'); } catch { /* use defaults */ }
  visibility[name] = visible;
  localStorage.setItem(visibilityStorageKey, JSON.stringify(visibility));
  visibilityBlocks[name].hidden = !visible;
  appendDiagnostic('block-visibility', { name, visible });
  fitWindowToContent();
}

function fitWindowToContent() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    const widget = document.querySelector('.widget');
    const height = Math.ceil(widget.getBoundingClientRect().height);
    appendDiagnostic('fit-content-renderer', { height, viewport: window.innerHeight });
    window.widget.fitContent(height);
  });
}

function setState(message, state = 'idle') {
  if (elements.status.textContent !== message) appendDiagnostic('status-change', { previous: elements.status.textContent, message, state });
  elements.status.textContent = message;
  elements.liveDot.className = `live-dot ${state}`;
}

function showNotice(message) {
  elements.noticeText.textContent = message;
  elements.notice.hidden = !message;
}

function playThresholdAlert(threshold) {
  if (!audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  if (now - lastAlertTime < 0.28) return;
  lastAlertTime = now;
  const frequency = meterMath.thresholdToAlertFrequency(threshold);
  const volume = meterMath.thresholdToAlertGain(threshold, Number(elements.alertVolumeSlider.value));
  if (volume <= 0) return;
  const pipDuration = 0.075;
  const pipGap = 0.055;
  const patternStart = now + 0.03;
  for (let index = 0; index < 3; index += 1) {
    const start = patternStart + index * (pipDuration + pipGap);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.007);
    gain.gain.setValueAtTime(volume, start + pipDuration - 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + pipDuration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + pipDuration + 0.002);
  }
  appendDiagnostic('meter-threshold-alert', { threshold, frequency, volume, pips: 3, pipDurationMs: 75, pipGapMs: 55 });
}

function updateDisplay(dbfs, allowAlert = true) {
  const floor = Number(elements.rangeSlider.value);
  const percent = meterMath.dbfsToPercent(dbfs, floor);
  elements.meterFill.style.width = `${percent}%`;
  elements.meter.setAttribute('aria-valuenow', percent.toFixed(0));
  const peak = recentPeak.update(dbfs);
  elements.peak.textContent = `${meterMath.dbfsToPercent(peak, floor).toFixed(0)} / 100`;
  const crossed = thresholdCrossings.update(percent, selectedAlertThresholds);
  if (allowAlert && crossed.length > 0) playThresholdAlert(Math.max(...crossed));
}

for (const button of elements.meterThresholds.querySelectorAll('[data-threshold]')) {
  const threshold = Number(button.dataset.threshold);
  const active = selectedAlertThresholds.has(threshold);
  button.setAttribute('aria-pressed', String(active));
  button.addEventListener('click', async () => {
    if (selectedAlertThresholds.has(threshold)) selectedAlertThresholds.delete(threshold);
    else selectedAlertThresholds.add(threshold);
    button.setAttribute('aria-pressed', String(selectedAlertThresholds.has(threshold)));
    localStorage.setItem(alertThresholdsStorageKey, JSON.stringify([...selectedAlertThresholds].sort((a, b) => a - b)));
    appendDiagnostic('meter-alert-threshold-toggle', { threshold, enabled: selectedAlertThresholds.has(threshold) });
    if (audioContext?.state === 'suspended') await audioContext.resume().catch(() => {});
  });
}

async function createVoiceDenoiser(context) {
  await context.audioWorklet.addModule(new URL('rnnoise-worklet.mjs', window.location.href));
  const node = new AudioWorkletNode(context, 'voice-denoiser', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit'
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('El filtro local tardó demasiado en cargar.')), 10000);
    node.port.onmessage = event => {
      if (event.data?.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      } else if (event.data?.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(event.data.message));
      }
    };
    node.port.onmessageerror = () => {
      clearTimeout(timeout);
      reject(new Error('No se pudo comunicar con el filtro local.'));
    };
  });
  return node;
}

function measure() {
  if (!analyser || paused) return;
  analyser.getFloatTimeDomainData(samples);
  updateDisplay(meterMath.calculateDbfs(samples));
  animationFrame = requestAnimationFrame(measure);
}

async function closeStream() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  if (audioContext) {
    denoiser?.disconnect();
    muteNode?.disconnect();
    await audioContext.close().catch(() => {});
    audioContext = undefined;
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = undefined;
  }
  analyser = undefined;
  denoiser = undefined;
}

async function refreshDevices(preferredId) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter(device => device.kind === 'audioinput');
  const selectedId = preferredId || elements.deviceSelect.value || lastDeviceId;
  elements.deviceSelect.replaceChildren();

  if (inputs.length === 0) {
    const option = new Option('No se detectaron micrófonos', '');
    elements.deviceSelect.add(option);
    elements.deviceSelect.disabled = true;
    return '';
  }

  elements.deviceSelect.disabled = false;
  inputs.forEach((device, index) => {
    const option = new Option(device.label || `Micrófono ${index + 1}`, device.deviceId);
    elements.deviceSelect.add(option);
  });
  const target = inputs.some(device => device.deviceId === selectedId) ? selectedId : inputs[0].deviceId;
  elements.deviceSelect.value = target;
  return target;
}

async function startCapture(deviceId) {
  if (switching) {
    restartAfterSwitch = true;
    return;
  }
  switching = true;
  showNotice('');
  setState('Solicitando acceso al micrófono…');
  await closeStream();

  try {
    const voiceFilterEnabled = elements.voiceFilter.checked;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: voiceFilterEnabled,
        noiseSuppression: false,
        autoGainControl: voiceFilterEnabled
      },
      video: false
    });
    lastDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId || deviceId;
    const context = new AudioContext(voiceFilterEnabled ? { sampleRate: 48000 } : undefined);
    audioContext = context;
    const source = context.createMediaStreamSource(stream);
    if (voiceFilterEnabled) {
      if (context.sampleRate !== 48000) throw new Error(`El filtro RNNoise requiere 48 kHz; el sistema abrió ${context.sampleRate} Hz.`);
      elements.filterStatus.textContent = 'Cargando filtro neuronal local…';
      denoiser = await createVoiceDenoiser(context);
      source.connect(denoiser);
      denoiser.connect(analyser = context.createAnalyser());
      elements.filterStatus.textContent = 'RNNoise activo · supresión local';
    } else {
      elements.filterStatus.textContent = 'Filtro desactivado';
      source.connect(analyser = context.createAnalyser());
    }
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    muteNode = context.createGain();
    muteNode.gain.value = 0;
    analyser.connect(muteNode);
    muteNode.connect(context.destination);
    samples = new Float32Array(analyser.fftSize);
    recentPeak.value = meterMath.MIN_DBFS;
    updateDisplay(meterMath.MIN_DBFS);
    const actualId = await refreshDevices(lastDeviceId);
    if (actualId) elements.deviceSelect.value = actualId;
    if (paused) {
      await context.suspend();
      setState('Medición pausada');
    } else {
      await context.resume();
      setState('Midiendo en tiempo real', 'active');
      measure();
    }
    stream.getAudioTracks()[0]?.addEventListener('ended', handleDeviceLoss, { once: true });
  } catch (error) {
    await closeStream();
    const denied = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError';
    setState(denied ? 'Permiso de micrófono denegado' : 'No se pudo iniciar el micrófono', 'error');
    showNotice(denied
      ? 'Habilitá el acceso al micrófono para esta aplicación en la configuración de privacidad de Windows y volvé a elegir el dispositivo.'
      : error.name === 'NotFoundError'
        ? 'Conectá un micrófono. La app volverá a detectar entradas cuando cambie el hardware.'
        : `No se pudo iniciar la captura/filtro (${error.message || error.name || 'error'}). Revisá el dispositivo y los permisos de Windows.`);
    elements.filterStatus.textContent = voiceFilterEnabledForStatus() ? 'Filtro no disponible' : 'Filtro desactivado';
    try { await refreshDevices(); } catch { /* keep the current error state */ }
  } finally {
    switching = false;
    elements.voiceFilter.disabled = false;
    if (restartAfterSwitch) {
      restartAfterSwitch = false;
      startCapture(elements.deviceSelect.value);
    }
  }
}

function voiceFilterEnabledForStatus() {
  return elements.voiceFilter.checked;
}

async function handleDeviceLoss() {
  if (switching) return;
  await closeStream();
  setState('Micrófono desconectado', 'error');
  showNotice('La entrada se desconectó. Conectá un micrófono o elegí otro dispositivo.');
  try {
    const next = await refreshDevices();
    if (next) await startCapture(next);
  } catch { /* devicechange will retry when Windows reports the device */ }
}

elements.deviceSelect.addEventListener('change', () => {
  if (elements.deviceSelect.value) startCapture(elements.deviceSelect.value);
});

elements.rangeSlider.addEventListener('input', () => {
  const floor = Number(elements.rangeSlider.value);
  elements.rangeOutput.value = `${floor < 0 ? '−' : ''}${Math.abs(floor)} dBFS`;
  elements.meter.setAttribute('aria-valuemin', '0');
  elements.meter.setAttribute('aria-valuemax', '100');
  if (samples && !paused) updateDisplay(meterMath.calculateDbfs(samples), false);
});

elements.alertVolumeSlider.addEventListener('input', () => {
  const volume = Number(elements.alertVolumeSlider.value);
  elements.alertVolumeOutput.value = `${volume}%`;
  localStorage.setItem(alertVolumeStorageKey, String(volume));
});

elements.voiceFilter.addEventListener('change', () => {
  localStorage.setItem(voiceFilterStorageKey, String(elements.voiceFilter.checked));
  elements.voiceFilter.disabled = true;
  startCapture(elements.deviceSelect.value);
});

elements.diagnosticsToggle.addEventListener('click', () => setDiagnosticsRecording(!diagnosticsRecording));
elements.diagnosticsClear.addEventListener('click', () => {
  diagnosticLines = [];
  elements.diagnosticsLog.value = '';
  elements.diagnosticsCopy.disabled = true;
});
elements.diagnosticsCopy.addEventListener('click', async () => {
  try {
    await window.widget.copyText(diagnosticLines.join('\n'));
    elements.diagnosticsState.textContent = diagnosticsRecording ? 'Copiado · capturando' : 'Registro copiado';
  } catch {
    elements.diagnosticsState.textContent = 'No se pudo copiar';
  }
});
window.widget.onDiagnosticEvent(event => {
  appendDiagnostic(event.type, event.data, event.source, event.time);
});

elements.pauseButton.addEventListener('click', async () => {
  paused = !paused;
  elements.pauseLabel.textContent = paused ? 'Reanudar' : 'Pausar';
  if (audioContext) {
    if (paused) {
      cancelAnimationFrame(animationFrame);
      await audioContext.suspend();
      setState('Medición pausada');
    } else {
      await audioContext.resume();
      setState('Midiendo en tiempo real', 'active');
      measure();
    }
  }
});

elements.alwaysOnTop.addEventListener('click', () => {
  const enabled = elements.alwaysOnTop.getAttribute('aria-pressed') !== 'true';
  elements.alwaysOnTop.setAttribute('aria-pressed', String(enabled));
  elements.alwaysOnTop.setAttribute('aria-label', enabled ? 'Quitar ventana de encima de otras' : 'Fijar ventana encima de otras');
  elements.alwaysOnTop.title = enabled ? 'Quitar ventana de encima de otras' : 'Fijar ventana encima de otras';
  window.widget.setAlwaysOnTop(enabled);
});
document.getElementById('minimize').addEventListener('click', () => window.widget.minimize());
document.getElementById('close').addEventListener('click', () => window.widget.close());
elements.retryButton.addEventListener('click', () => startCapture(elements.deviceSelect.value));

elements.blocksMenuButton.addEventListener('click', () => {
  const open = elements.blocksMenuButton.getAttribute('aria-expanded') !== 'true';
  const bounds = elements.blocksMenuButton.getBoundingClientRect();
  window.widget.toggleBlocksMenu(open, {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  });
  appendDiagnostic('popup-button', { open, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } });
  elements.blocksMenuButton.setAttribute('aria-expanded', String(open));
});
let blocksAnchorTimer;
window.addEventListener('resize', () => {
  appendDiagnostic('renderer-window-resize-event', { viewport: { width: window.innerWidth, height: window.innerHeight } });
  if (elements.blocksMenuButton.getAttribute('aria-expanded') !== 'true') return;
  clearTimeout(blocksAnchorTimer);
  blocksAnchorTimer = setTimeout(() => {
    const bounds = elements.blocksMenuButton.getBoundingClientRect();
    const anchor = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
    appendDiagnostic('renderer-resize-anchor', { anchor, viewport: { width: window.innerWidth, height: window.innerHeight } });
    window.widget.updateBlocksMenuAnchor(anchor);
  }, 90);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    window.widget.toggleBlocksMenu(false, {});
    elements.blocksMenuButton.setAttribute('aria-expanded', 'false');
  }
});
window.widget.onBlocksVisibility((name, visible) => saveBlockVisibility(name, visible));
window.widget.onBlocksMenuClosed(() => elements.blocksMenuButton.setAttribute('aria-expanded', 'false'));

window.addEventListener('error', event => {
  appendDiagnostic('renderer-error', { message: event.message, filename: event.filename, line: event.lineno, column: event.colno });
  setState('Error en la interfaz', 'error');
  showNotice(`La interfaz encontró un error: ${event.message || 'error de JavaScript'}. Cerrá y volvé a abrir la app.`);
});

window.addEventListener('unhandledrejection', event => {
  const reason = event.reason;
  appendDiagnostic('renderer-unhandled-rejection', {
    message: reason instanceof Error ? reason.message : String(reason)
  });
});

document.addEventListener('visibilitychange', () => {
  appendDiagnostic('document-visibility', { state: document.visibilityState, focused: document.hasFocus() });
});

navigator.mediaDevices.addEventListener('devicechange', async () => {
  try {
    const previousId = lastDeviceId;
    const next = await refreshDevices(previousId);
    if (!next) {
      await handleDeviceLoss();
    } else if (!stream || (previousId && next !== previousId)) {
      await startCapture(next);
    }
  } catch { /* ignore transient enumeration errors */ }
});

elements.rangeSlider.dispatchEvent(new Event('input'));
elements.alertVolumeSlider.dispatchEvent(new Event('input'));
applyBlockVisibility();
const updateMeterWidth = () => elements.meterFill.style.setProperty('--meter-track-width', `${elements.meter.clientWidth}px`);
new ResizeObserver(updateMeterWidth).observe(elements.meter);
updateMeterWidth();
fitWindowToContent();
setState('Buscando micrófono');
startCapture('').then(() => refreshDevices(lastDeviceId)).catch(() => {});