import { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { voiceActivityToGain } from './audio-meter.js';

const FRAME_SIZE = 480;
const QUEUE_SIZE = 16384;

class VoiceDenoiser extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.ready = false;
    this.frame = new Float32Array(FRAME_SIZE);
    this.frameOffset = 0;
    this.queue = new Float32Array(QUEUE_SIZE);
    this.queueRead = 0;
    this.queueWrite = 0;
    this.voiceGain = 0;
    this.denoiseState = undefined;
    this.port.onmessage = event => {
      if (event.data?.type === 'enabled') this.enabled = Boolean(event.data.value);
    };
    this.initialize();
  }

  async initialize() {
    try {
      const rnnoise = await Rnnoise.load();
      this.denoiseState = rnnoise.createDenoiseState();
      this.ready = true;
      this.port.postMessage({ type: 'ready', frameSize: rnnoise.frameSize });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error?.message || String(error) });
    }
  }

  enqueueFrame() {
    const voiceActivity = this.denoiseState.processFrame(this.frame);
    const targetGain = voiceActivityToGain(voiceActivity);
    const gainStep = (targetGain - this.voiceGain) / FRAME_SIZE;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      this.voiceGain += gainStep;
      this.queue[this.queueWrite] = Math.max(-1, Math.min(1, this.frame[index] / 32768 * this.voiceGain));
      this.queueWrite = (this.queueWrite + 1) % QUEUE_SIZE;
    }
    this.frameOffset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    if (!input) return true;

    if (!this.enabled || !this.ready) {
      output.set(input.subarray(0, output.length));
      return true;
    }

    for (let index = 0; index < input.length; index += 1) {
      this.frame[this.frameOffset] = Math.max(-1, Math.min(1, input[index])) * 32768;
      this.frameOffset += 1;
      if (this.frameOffset === FRAME_SIZE) this.enqueueFrame();

      if (this.queueRead !== this.queueWrite) {
        output[index] = this.queue[this.queueRead];
        this.queueRead = (this.queueRead + 1) % QUEUE_SIZE;
      }
    }
    return true;
  }

  static get parameterDescriptors() {
    return [];
  }
}

registerProcessor('voice-denoiser', VoiceDenoiser);
