import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionInterpolator } from '../packages/client/src/lib/rendering/PositionInterpolator';
import { KalmanFilter2D } from '../packages/client/src/lib/filters/KalmanFilter';

const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

test('display position at a timestamp is independent of render frequency and repeated reads', () => {
  function render(fps: number) {
    const interpolator = new PositionInterpolator();
    interpolator.updateSettings({ smoothingFactor: 0.5 }); // 30 ms presentation delay
    interpolator.addSample({ x: 0, y: 10 }, 0, 0);
    interpolator.addSample({ x: 10, y: 20 }, 100, 100);
    for (let now = 100; now < 150; now += 1000 / fps)
      interpolator.getInterpolatedPosition(now);
    return { ...interpolator.getInterpolatedPosition(150) };
  }
  assert.deepEqual(render(60), render(144));
  close(render(60).x, 12);
});

test('interpolation copies pooled input and reuses its render vector', () => {
  const interpolator = new PositionInterpolator();
  interpolator.updateSettings({ smoothingFactor: 0.5 });
  const pooled = { x: 10, y: 5 };
  interpolator.addSample(pooled, 0, 0);
  pooled.x = 20;
  interpolator.addSample(pooled, 100, 100);
  pooled.x = 999;
  const result = interpolator.getInterpolatedPosition(80);
  close(result.x, 15);
  assert.equal(result, interpolator.getInterpolatedPosition(80));
});

test('stalled input freezes at a bounded endpoint, never fades back to centre', () => {
  const interpolator = new PositionInterpolator();
  interpolator.addSample({ x: 30, y: 15 }, 100, 100);
  interpolator.addSample({ x: 32, y: 16 }, 120, 120);
  const endpoint = { ...interpolator.getInterpolatedPosition(400) };
  assert.equal(interpolator.isFresh(620), true);
  assert.equal(interpolator.isFresh(621), false);
  assert.deepEqual(interpolator.getInterpolatedPosition(2000), endpoint);
  assert.deepEqual(interpolator.getVelocity(), { x: 0, y: 0 });
  assert.ok(endpoint.x >= 32 && endpoint.x <= 42);
});

test('ring wrap retains chronological interpolation; duplicate/invalid packets do not revive freshness', () => {
  const interpolator = new PositionInterpolator();
  interpolator.updateSettings({ smoothingFactor: 0.5 });
  for (let i = 0; i < 100; i++)
    interpolator.addSample({ x: i, y: -i }, i * 20, i * 20);
  close(interpolator.getInterpolatedPosition(2000).x, 98.5);
  interpolator.addSample({ x: 200, y: 0 }, 1980, 10000);
  interpolator.addSample({ x: NaN, y: 0 }, 2000, 10000);
  assert.equal(interpolator.isFresh(10000), false);
  assert.equal(interpolator.getDebugInfo().samplesCount, 16);
  interpolator.reset();
  assert.equal(interpolator.isFresh(), false);
  assert.deepEqual(interpolator.getInterpolatedPosition(), { x: 0, y: 0 });
});

test('same-timestamp measurements in one receive burst replace the endpoint without extending freshness', () => {
  const interpolator = new PositionInterpolator();
  interpolator.updateSettings({ maxExtrapolationTime: 0 });
  interpolator.addSample({ x: 10, y: 5 }, 100, 100);
  interpolator.addSample({ x: 20, y: 6 }, 120, 120);
  interpolator.addSample({ x: 25, y: 7 }, 120, 121);
  assert.deepEqual(interpolator.getInterpolatedPosition(200), { x: 25, y: 7 });
  assert.equal(interpolator.getDebugInfo().samplesCount, 2);
  assert.equal(interpolator.isFresh(620), true);
  assert.equal(interpolator.isFresh(621), false);
  interpolator.addSample({ x: 999, y: 999 }, 120, 5000);
  assert.deepEqual(interpolator.getInterpolatedPosition(5000), { x: 25, y: 7 });
  assert.equal(interpolator.isFresh(5000), false);
});

test('constant-velocity Kalman converges to position and velocity using irregular sampling intervals', () => {
  const filter = new KalmanFilter2D({
    processNoise: 400,
    measurementNoise: 1.2,
  });
  let elapsed = 0;
  filter.update(0, 5);
  for (let i = 0; i < 300; i++) {
    const dt = i % 2 ? 0.01 : 0.03;
    elapsed += dt;
    filter.update(10 * elapsed, 5 - 4 * elapsed, dt);
  }
  const result = filter.getState();
  close(result.x, 10 * elapsed, 0.02);
  close(result.y, 5 - 4 * elapsed, 0.02);
  close(result.vx, 10, 0.1);
  close(result.vy, -4, 0.1);
});

test('Kalman measurement noise setting changes estimated response', () => {
  const lowNoise = new KalmanFilter2D({ measurementNoise: 0.1 });
  const highNoise = new KalmanFilter2D({ measurementNoise: 10 });
  lowNoise.update(0, 0);
  highNoise.update(0, 0);
  assert.ok(lowNoise.update(10, 0, 0.02).x > highNoise.update(10, 0, 0.02).x);
});

test('Kalman rejects isolated spikes and invalid numbers but accepts a sustained relocation', () => {
  const filter = new KalmanFilter2D();
  filter.update(10, 20);
  assert.equal(filter.update(1000, 1000).x, 10);
  assert.equal(filter.update(NaN, Infinity).x, 10);
  filter.update(10, 20);
  for (let i = 0; i < 5; i++) filter.update(300, 300);
  assert.equal(filter.getState().x, 300);
  assert.equal(filter.getStats().autoResets, 1);
  filter.reset();
  assert.equal(filter.update(50, 60).x, 50);
});
