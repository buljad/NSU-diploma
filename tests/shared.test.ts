import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PacketParser,
  CoPSmartFilter,
  CoPCalculator,
  AxisTransform,
  MAX_BUFFER_SIZE,
} from '../packages/shared/src/index.ts';

function field(value: number): number[] {
  const unsigned = value & 0xffffff;
  return Array.from({ length: 4 }, (_, index) => {
    const part = (unsigned >> (index * 6)) & 63;
    return part <= 58 ? part + 35 : part + 36;
  });
}
function frame(values = [3, -1, 0x7fffff, -0x800000], time = 1234): Uint8Array {
  return Uint8Array.from([35, ...values.flatMap(field), ...field(time), 38]);
}

for (const enableFastMode of [false, true]) {
  test(`parser preserves payload '&', signed limits and fragmented frames (fast=${enableFastMode})`, () => {
    const parser = new PacketParser({ filterOutliers: false, enableFastMode });
    const bytes = frame();
    parser.addData(bytes.subarray(0, 4));
    assert.deepEqual(parser.parseAll(), []);
    parser.addData(bytes.subarray(4));
    const [packet] = parser.parseAll();
    assert.equal(packet.isValid, true);
    assert.deepEqual(packet.sensors, {
      d1: 3,
      d2: -1,
      d3: 8388607,
      d4: -8388608,
    });
    assert.equal(packet.deviceTime, 1234);
    assert.equal(parser.getStats().invalidPackets, 0);
  });
}

test('parser never fabricates a reading from invalid ASCII; resynchronizes after noise', () => {
  const parser = new PacketParser({
    filterOutliers: false,
    enablePacketRecovery: true,
  });
  const broken = frame([1000, 1000, 1000, 1000]);
  broken[7] = 94;
  parser.addData(
    Uint8Array.from([0, 255, ...broken, ...frame([11, 12, 13, 14])]),
  );
  const packets = parser.parseAll();
  assert.equal(packets.filter((packet) => packet.isValid).length, 1);
  assert.deepEqual(packets.at(-1)?.sensors, { d1: 11, d2: 12, d3: 13, d4: 14 });
  assert.ok(parser.getStats().invalidPackets > 0);
  assert.equal(
    parser.getStats().totalPackets,
    parser.getStats().validPackets + parser.getStats().invalidPackets,
  );
  assert.equal(parser.getPerformanceInfo().packetRecovery, false);
});

test('parser consumes more than 50 frames in a burst and retains the next fragment', () => {
  const parser = new PacketParser({ filterOutliers: false });
  const packets = Array.from({ length: 80 }, (_, n) =>
    frame([n, n, n, n], n * 20),
  );
  const next = frame([91, 92, 93, 94]);
  parser.addData(
    Uint8Array.from([
      ...packets.flatMap((bytes) => [...bytes]),
      ...next.subarray(0, 10),
    ]),
  );
  assert.equal(parser.parseAll().length, 80);
  parser.addData(next.subarray(10));
  assert.equal(parser.parseNext()?.sensors.d1, 91);
});

test('parser bounds a giant corrupted burst and recovers the following frame', () => {
  const parser = new PacketParser({ filterOutliers: false });
  parser.addData(new Uint8Array(MAX_BUFFER_SIZE * 2).fill(255));
  parser.parseAll();
  parser.addData(frame([7, 8, 9, 10]));
  assert.equal(
    parser
      .parseAll()
      .filter((packet) => packet.isValid)
      .at(-1)?.sensors.d1,
    7,
  );
  assert.equal(parser.getStats().bufferOverflows, 1);
});

test('a sustained real load step does not lock the parser to the previous baseline', () => {
  const parser = new PacketParser({ outlierThreshold: 100 });
  parser.addData(
    Uint8Array.from([
      ...frame([0, 0, 0, 0]),
      ...frame([1000, 1000, 1000, 1000]),
      ...frame([1000, 1000, 1000, 1000]),
    ]),
  );
  assert.deepEqual(
    parser.parseAll().map((packet) => packet.isValid),
    [true, false, true],
  );
});

test('a loaded center is accepted, no-load is flagged, and load recovery starts cleanly', () => {
  const filter = new CoPSmartFilter();
  filter.filter({ x: 20, y: 0, f: 4000 }, 0);
  filter.filter({ x: 0, y: 0, f: 4000 }, 20);
  assert.equal(filter.getStats().zeroInputsIgnored, 0);
  assert.equal(filter.filter({ x: 0, y: 0, f: 4000 }, 40).x, 0);
  assert.equal(filter.filter({ x: 0, y: 0, f: 0 }, 60).confidence, 0);
  assert.equal(filter.filter({ x: -20, y: 0, f: 4000 }, 80).x, -20);
});

test('filter never invents motion on a stationary platform even with legacy reanimation enabled', () => {
  const filter = new CoPSmartFilter({
    enableReanimation: true,
    frozenThreshold: 1,
  });
  for (let n = 0; n < 20; n++) {
    const result = filter.filter({ x: 4, y: 8, f: 100 }, n * 20);
    assert.equal(result.x, 4);
    assert.equal(result.y, 8);
  }
  filter.updateConfig({ bufferSize: 1 });
  assert.equal(filter.filter({ x: 0, y: 0, f: 100 }, 500).x, 0);
  assert.throws(() => filter.updateConfig({ bufferSize: 0 }));
});

test('CoP matches centered and corner loads, subtracts offsets and preserves configured geometry', () => {
  const calculator = new CoPCalculator();
  calculator.setOffsets({ d1: 1000, d2: 1000, d3: 1000, d4: 1000 });
  assert.deepEqual(
    calculator.calculate({ d1: 2000, d2: 2000, d3: 2000, d4: 2000 }),
    { x: 0, y: 0, z: 0, f: 4 },
  );
  assert.deepEqual(
    calculator.calculate({ d1: 1000, d2: 3000, d3: 1000, d4: 1000 }),
    { x: 130, y: 130, z: 0, f: 2 },
  );
  calculator.configure({ sensorDistanceX: 400 });
  assert.equal(
    calculator.calculate({ d1: 1000, d2: 3000, d3: 1000, d4: 1000 }).x,
    200,
  );
  assert.equal(
    calculator.calculate({ d1: 1000, d2: 1000, d3: 1000, d4: 1000 }).f,
    0,
  );
  assert.throws(() => calculator.configure({ sensorDistanceX: NaN }));
});

test('axis transform preserves load and maps a rotated point', () => {
  const transform = new AxisTransform({
    swapXY: false,
    invertX: false,
    invertY: false,
    rotationDeg: 90,
  });
  const result = transform.transform({ x: 10, y: 0, z: 0, f: 200 });
  assert.ok(Math.abs(result.x) < 1e-10);
  assert.equal(result.y, 10);
  assert.equal(result.f, 200);
});
