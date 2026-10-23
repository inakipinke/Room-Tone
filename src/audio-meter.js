const MIN_DBFS = -96;

function calculateDbfs(samples) {
  if (!samples || samples.length === 0) return MIN_DBFS;

  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 0) return MIN_DBFS;
  return Math.max(MIN_DBFS, 20 * Math.log10(rms));
}

function dbfsToPercent(dbfs, floorDbfs = -60) {
  const floor = Math.min(-1, floorDbfs);
  return Math.max(0, Math.min(100, ((dbfs - floor) / -floor) * 100));
}

function voiceActivityToGain(voiceActivity) {
  return Math.max(0, Math.min(1, (voiceActivity - 0.35) / 0.35));
}

function thresholdToAlertFrequency(threshold) {
  const normalized = Math.max(0, Math.min(100, threshold)) / 100;
  return Math.round(1100 + normalized * 900);
}

function thresholdToAlertGain(threshold, volumePercent = 100) {
  const normalized = Math.max(0, Math.min(100, threshold)) / 100;
  const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
  return (0.24 + normalized * 0.56) * volume;
}

class ThresholdCrossings {
  constructor(hysteresis = 4) {
    this.hysteresis = hysteresis;
    this.previous = 0;
    this.armed = new Map();
  }

  update(percent, activeThresholds) {
    const active = new Set(activeThresholds);
    const crossed = [];
    for (let threshold = 10; threshold <= 100; threshold += 10) {
      if (!active.has(threshold)) {
        this.armed.delete(threshold);
        continue;
      }
      if (!this.armed.has(threshold)) {
        this.armed.set(threshold, this.previous < threshold);
      } else if (percent < threshold - this.hysteresis) {
        this.armed.set(threshold, true);
      }
      if (this.armed.get(threshold) && this.previous < threshold && percent >= threshold) {
        crossed.push(threshold);
        this.armed.set(threshold, false);
      }
    }
    this.previous = percent;
    return crossed;
  }
}

class RecentPeak {
  constructor(holdMs = 2500) {
    this.holdMs = holdMs;
    this.value = MIN_DBFS;
    this.updatedAt = 0;
  }

  update(dbfs, now = Date.now()) {
    if (dbfs >= this.value || now - this.updatedAt > this.holdMs) {
      this.value = dbfs;
      this.updatedAt = now;
    }
    return this.value;
  }
}

const audioMeter = { MIN_DBFS, calculateDbfs, dbfsToPercent, voiceActivityToGain, thresholdToAlertFrequency, thresholdToAlertGain, RecentPeak, ThresholdCrossings };
if (typeof module !== 'undefined' && module.exports) module.exports = audioMeter;
else globalThis.AudioMeter = audioMeter;