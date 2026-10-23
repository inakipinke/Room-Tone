const test = require('node:test');
const assert = require('node:assert/strict');
const { MIN_DBFS, calculateDbfs, dbfsToPercent, voiceActivityToGain, thresholdToAlertFrequency, thresholdToAlertGain, RecentPeak, ThresholdCrossings } = require('../src/audio-meter.js');

test('silence is clamped to the digital noise floor', () => {
  assert.equal(calculateDbfs(new Float32Array(256)), MIN_DBFS);
  assert.equal(calculateDbfs([]), MIN_DBFS);
});

test('RMS reports a full-scale sine near -3.01 dBFS', () => {
  const samples = Float32Array.from({ length: 2048 }, (_, index) => Math.sin(2 * Math.PI * index / 64));
  assert.ok(Math.abs(calculateDbfs(samples) - (-3.01)) < 0.02);
});

test('meter range clamps below floor and at full scale', () => {
  assert.equal(dbfsToPercent(-72, -60), 0);
  assert.equal(dbfsToPercent(-30, -60), 50);
  assert.equal(dbfsToPercent(0, -60), 100);
});

test('recent peak holds briefly then follows a quieter level', () => {
  const peak = new RecentPeak(2500);
  assert.equal(peak.update(-24, 1000), -24);
  assert.equal(peak.update(-42, 2000), -24);
  assert.equal(peak.update(-42, 3600), -42);
});

test('voice activity gate rejects non-voice and passes strong speech', () => {
  assert.equal(voiceActivityToGain(0), 0);
  assert.equal(voiceActivityToGain(0.35), 0);
  assert.ok(Math.abs(voiceActivityToGain(0.525) - 0.5) < 1e-12);
  assert.equal(voiceActivityToGain(1), 1);
});

test('threshold alerts fire only on upward crossing and rearm below hysteresis', () => {
  const crossings = new ThresholdCrossings(4);
  assert.deepEqual(crossings.update(0, [30]), []);
  assert.deepEqual(crossings.update(29, [30]), []);
  assert.deepEqual(crossings.update(31, [30]), [30]);
  assert.deepEqual(crossings.update(50, [30]), []);
  assert.deepEqual(crossings.update(25, [30]), []);
  assert.deepEqual(crossings.update(30, [30]), [30]);
});

test('a threshold enabled just below its current level still alerts on the next crossing', () => {
  const crossings = new ThresholdCrossings(4);
  assert.deepEqual(crossings.update(9, []), []);
  assert.deepEqual(crossings.update(11, [10]), [10]);
});

test('alert frequency rises with the selected volume threshold', () => {
  assert.equal(thresholdToAlertFrequency(10), 1190);
  assert.equal(thresholdToAlertFrequency(50), 1550);
  assert.equal(thresholdToAlertFrequency(100), 2000);
  assert.ok(thresholdToAlertFrequency(80) > thresholdToAlertFrequency(30));
});

test('alert volume rises with the selected volume threshold', () => {
  assert.ok(Math.abs(thresholdToAlertGain(10) - 0.296) < 1e-12);
  assert.equal(thresholdToAlertGain(50), 0.52);
  assert.equal(thresholdToAlertGain(100), 0.8);
  assert.ok(thresholdToAlertGain(80) > thresholdToAlertGain(30));
});

test('alert volume slider scales and can mute threshold alerts', () => {
  assert.equal(thresholdToAlertGain(50, 100), 0.52);
  assert.equal(thresholdToAlertGain(50, 50), 0.26);
  assert.equal(thresholdToAlertGain(50, 0), 0);
  assert.equal(thresholdToAlertGain(50, 150), 0.52);
});