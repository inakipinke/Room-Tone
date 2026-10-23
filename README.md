# Mic Noise Widget

Compact Windows desktop microphone meter. Audio is analyzed locally in memory; the app does not record, save, or transmit microphone audio.

## Run

Install Node.js 22.12 or newer, then run from this folder:

```powershell
npm install
npm start
```

The window opens on the secondary display when one is connected and remembers its size and position. Use the microphone selector to change inputs, the slider to set the meter floor, the centered button to pause, and the pin icon in the title bar to keep the widget above other windows. If Windows privacy settings block microphone access, allow access for desktop apps and press **Reintentar**.

To capture a window/menu issue, open the gear menu, enable **Diagnóstico**, then press **Iniciar captura** in the widget. Reproduce the problem, press **Detener captura**, and use **Copiar registro** to copy up to the latest 500 geometry/UI events. The capture contains timestamps, window/display bounds, scale factor, resize requests, and popup lifecycle events; it does not capture microphone audio.

With **Filtro de voz** enabled, microphone audio is processed locally by RNNoise in WebAssembly, followed by a stronger voice-activity gate and Windows echo cancellation/automatic gain control. It reduces non-speech noise, breaths, and playback echo, but is not speaker identification: it cannot guarantee that other people's speech is removed while preserving only one specific speaker. Filtering applies only to this app's meter; it does not create a virtual microphone for Discord or other apps.

## Measurement

The bar shows RMS level in dBFS without a live numeric readout. The peak holds for 2.5 seconds. dBFS is not calibrated sound pressure in dB SPL and depends on the microphone, audio interface, driver, distance, input gain, and OS audio processing.

## Tests

```powershell
npm test
```