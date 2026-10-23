import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRecorder } from '../packages/client/src/lib/sessions/recorder';
import { calculateMetrics } from '../packages/client/src/lib/sessions/metrics';
import {
  comparisonWarnings,
  sessionReportHTML,
  sessionToCSV,
} from '../packages/client/src/lib/sessions/exports';
import { parseBackup } from '../packages/client/src/lib/sessions/validation';
import type { StabilogramSample } from '@stabilometer/shared';
import type { SessionBackup } from '../packages/client/src/lib/sessions/types';

const options = {
  participantId: 'person',
  protocol: { id: 'open', name: 'Проба', eyes: 'open' as const },
  demo: true,
};
function sample(time: number, x = 0, y = 0, force = 100): StabilogramSample {
  const coords = { x, y, z: 0, f: force };
  return {
    sensors: { d1: 25, d2: 25, d3: 25, d4: 25 },
    raw: { ...coords },
    centered: { ...coords },
    filtered: { ...coords },
    mm: { x, y },
    deviceTime: time,
    clientTime: time,
    packetNumber: time,
  };
}
function straightLine() {
  const recorder = new SessionRecorder(options, 'session', 1000);
  for (let i = 0; i <= 50; i++)
    recorder.ingest(sample(i * 20, i * 0.2), i * 20);
  return recorder.stop();
}
function backup(): SessionBackup {
  return {
    format: 'stabilometer-backup',
    version: 1,
    exportedAt: 1000,
    participants: [
      { id: 'person', name: 'Участник', notes: '', createdAt: 1000 },
    ],
    sessions: [straightLine()],
  };
}

test('10 mm/s acquisition gives 10 mm/s independently of any rendering updates', () => {
  const session = straightLine();
  assert.equal(session.metrics.durationSeconds, 1);
  assert.ok(Math.abs(session.metrics.pathLengthMm - 10) < 1e-10);
  assert.ok(Math.abs(session.metrics.meanVelocityMmS - 10) < 1e-10);
  for (const fps of [30, 60, 144]) {
    for (let frame = 0; frame < fps; frame++) calculateMetrics(session.samples);
    assert.deepEqual(calculateMetrics(session.samples), session.metrics);
  }
});

test('coordinates at (0,0) with load are valid; no-load breaks the path', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  recorder.ingest(sample(0, 0, 0), 0);
  recorder.ingest(sample(20, 1, 0), 20);
  recorder.ingest(sample(40, 100, 0, 0), 40);
  recorder.ingest(sample(60, 200, 0), 60);
  const session = recorder.stop();
  assert.equal(session.samples[0].valid, true);
  assert.equal(session.metrics.validCount, 3);
  assert.equal(session.metrics.pathLengthMm, 1);
  assert.equal(session.metrics.observedSeconds, 0.02);
  assert.equal(session.quality[0].code, 'no-load');
});

test('gaps and reset clocks never create movement across missing data', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  recorder.ingest(sample(1000, 0), 0);
  recorder.ingest(sample(1020, 1), 20);
  recorder.ingest(sample(2020, 1000), 1020);
  recorder.ingest(sample(0, 2000), 1040);
  const session = recorder.stop('Связь потеряна');
  assert.equal(session.status, 'interrupted');
  assert.equal(session.metrics.pathLengthMm, 1);
  assert.equal(session.metrics.meanVelocityMmS, 50);
  assert.ok(session.quality.some((q) => q.code === 'gap'));
  assert.ok(session.quality.some((q) => q.code === 'clock-reset'));
  assert.equal(session.samples[3].timeMs, 1040);
});

test('server invalidity overrides plausible coordinates and load', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  recorder.ingest(
    { ...sample(0, 10), isValid: false, invalidReason: 'calibrating' },
    0,
  );
  const session = recorder.stop();
  assert.equal(session.metrics.validCount, 0);
  assert.equal(session.samples[0].valid, false);
  assert.ok(session.quality[0].detail.includes('calibrating'));
});

test('coalesced batch with unavailable clocks does not invent 50 Hz intervals', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  for (let i = 0; i < 10; i++) recorder.ingest(sample(0, i), 100);
  const session = recorder.stop();
  assert.equal(session.metrics.durationSeconds, 0);
  assert.equal(session.metrics.observedSeconds, 0);
  assert.equal(session.metrics.pathLengthMm, 0);
  assert.ok(session.quality.some((q) => q.code === 'clock-fallback'));
});

test('server acquisition timestamps preserve timing when device clock is absent', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  for (let i = 0; i < 5; i++) {
    recorder.ingest(
      { ...sample(0, i), serverTime: 1000 + i * 100 } as StabilogramSample,
      500,
    );
  }
  const session = recorder.stop();
  assert.equal(session.samples[1].timestampSource, 'server');
  assert.equal(session.metrics.durationSeconds, 0.4);
  assert.equal(session.metrics.meanVelocityMmS, 10);
});

test('covariance ellipse uses sample covariance and chi-square 95% area', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].forEach(([x, y], i) => recorder.ingest(sample(i * 20, x, y), i * 20));
  const session = recorder.stop();
  assert.equal(session.metrics.meanX, 0);
  assert.equal(session.metrics.meanY, 0);
  assert.ok(Math.abs(session.metrics.stdX - Math.sqrt(4 / 3)) < 1e-12);
  assert.ok(
    Math.abs(session.metrics.ellipse95Mm2 - (Math.PI * 5.991464547 * 4) / 3) <
      1e-10,
  );
});

test('recorder owns raw copies, stops accepting samples and retains complete recordings', () => {
  const recorder = new SessionRecorder(options, 'session', 1000);
  const input = sample(0, 1);
  recorder.ingest(input, 0);
  input.centered.x = 999;
  for (let i = 1; i < 2000; i++) recorder.ingest(sample(i * 20, i), i * 20);
  const session = recorder.stop();
  recorder.ingest(sample(50000), 50000);
  assert.equal(session.samples.length, 2000);
  assert.equal(session.samples[0].sample.centered.x, 1);
  assert.equal(session.metrics.sampleCount, 2000);
});

test('backup validates entire content and recalculates untrusted metrics', () => {
  const data = backup();
  data.sessions[0].metrics.meanVelocityMmS = 999;
  const loaded = parseBackup(JSON.stringify(data));
  assert.ok(Math.abs(loaded.sessions[0].metrics.meanVelocityMmS - 10) < 1e-10);
  const bad = backup();
  bad.sessions[0].samples[2].timeMs = -1;
  assert.throws(() => parseBackup(JSON.stringify(bad)), /Некорректный архив/);
  const missing = backup();
  missing.participants = [];
  assert.throws(
    () => parseBackup(JSON.stringify(missing)),
    /не найден участник/,
  );
  assert.throws(() => parseBackup('{'), /JSON/);
  assert.throws(() => parseBackup('{"format":"other"}'), /Некорректный архив/);
});

test('unfinished backup sessions recover as interrupted rather than auto-starting', () => {
  const data = backup();
  data.sessions[0].status = 'recording';
  data.sessions[0].endedAt = null;
  const loaded = parseBackup(JSON.stringify(data));
  assert.equal(loaded.sessions[0].status, 'interrupted');
  assert.ok(loaded.sessions[0].endedAt !== null);
});

test('backup round trip retains invalid evidence and missing-clock fallback', () => {
  const data = backup();
  const recorder = new SessionRecorder(options, 'session', 1000);
  const a = sample(0, 1);
  a.deviceTime = NaN;
  recorder.ingest(a, 0);
  const b = sample(0, NaN);
  b.deviceTime = NaN;
  recorder.ingest(b, 20);
  data.sessions = [recorder.stop()];
  const loaded = parseBackup(JSON.stringify(data));
  assert.equal(loaded.sessions[0].samples.length, 2);
  assert.equal(loaded.sessions[0].metrics.validCount, 1);
});

test('reports escape HTML and CSV protect text fields against spreadsheet formulas', () => {
  const session = straightLine();
  session.notes = '<script>alert(1)</script>';
  session.protocol.id = '=SUM(1,2)';
  const html = sessionReportHTML(session, {
    id: 'person',
    name: '<img src=x onerror=alert(1)>',
    notes: '',
    createdAt: 0,
  });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  const csv = sessionToCSV(session);
  assert.equal(csv.split('\r\n').length, session.samples.length + 1);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
});

test('comparison identifies demo, conditions and interrupted quality limitations', () => {
  const a = straightLine();
  const b = straightLine();
  assert.deepEqual(comparisonWarnings(a, b), []);
  b.demo = false;
  b.protocol.eyes = 'closed';
  b.status = 'interrupted';
  assert.equal(comparisonWarnings(a, b).length, 3);
});
