import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from '../packages/server/node_modules/ws/index.js';
import { StabilogramServer } from '../packages/server/src/StabilogramServer.ts';
import {
  CalibrationStorage,
  isStoredCalibration,
} from '../packages/server/src/CalibrationStorage.ts';

const temporaryRoot = resolve('.tmp');
mkdirSync(temporaryRoot, { recursive: true });
const directory = mkdtempSync(join(temporaryRoot, 'server-tests-'));
const previousDataDir = process.env.STABILOMETER_DATA_DIR;
process.env.STABILOMETER_DATA_DIR = directory;
const calibration = {
  sensorOffsets: { d1: 1000, d2: 1000, d3: 1000, d4: 1000 },
  platformSize: { width: 300, height: 300 },
  sensorDistance: { x: 260, y: 260 },
  createdAt: new Date().toISOString(),
  sampleCount: 200,
};

test.beforeEach(() => assert.equal(CalibrationStorage.save(calibration), true));

test.after(() => {
  if (previousDataDir === undefined) delete process.env.STABILOMETER_DATA_DIR;
  else process.env.STABILOMETER_DATA_DIR = previousDataDir;
  assert.ok(
    directory.startsWith(temporaryRoot + '\\') ||
      directory.startsWith(temporaryRoot + '/'),
  );
  rmSync(directory, { recursive: true, force: true });
});

test('calibration storage validates data, writes atomically and preserves the last good file', () => {
  assert.equal(CalibrationStorage.save(calibration), true);
  assert.deepEqual(CalibrationStorage.load(), calibration);
  const before = readFileSync(CalibrationStorage.getPath(), 'utf8');
  assert.equal(
    CalibrationStorage.save({
      ...calibration,
      sensorOffsets: { ...calibration.sensorOffsets, d1: NaN },
    }),
    false,
  );
  assert.equal(readFileSync(CalibrationStorage.getPath(), 'utf8'), before);
  assert.equal(
    readdirSync(directory).some((name) => name.endsWith('.tmp')),
    false,
  );
  assert.equal(
    isStoredCalibration({ ...calibration, sensorDistance: { x: -1, y: 260 } }),
    false,
  );
  writeFileSync(CalibrationStorage.getPath(), '{broken');
  assert.equal(CalibrationStorage.load(), null);
  assert.equal(CalibrationStorage.save(calibration), true);
});

async function connect(server: StabilogramServer) {
  for (let count = 0; !server.port && count < 100; count++) await delay(5);
  assert.ok(server.port);
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const wait = async (predicate: (message: any) => boolean) => {
    for (let count = 0; count < 200; count++) {
      const index = messages.findIndex(predicate);
      if (index !== -1) return messages.splice(index, 1)[0];
      await delay(5);
    }
    assert.fail(
      `Timed out waiting for message. Received: ${JSON.stringify(messages)}`,
    );
  };
  return {
    ws,
    messages,
    wait,
    send: (data: unknown) => ws.send(JSON.stringify(data)),
  };
}

test('WS rejects malformed commands and can still respond after each error', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const client = await connect(server);
    const snapshot = await client.wait(
      (message) => message.type === 'CONNECTED',
    );
    assert.equal(snapshot.calibrated, true);
    assert.deepEqual(
      snapshot.calibration.sensorOffsets,
      calibration.sensorOffsets,
    );
    for (const command of [
      null,
      { type: 'CONNECT', testMode: 'false' },
      { type: 'SET_PERFORMANCE', settings: { batchSize: -5 } },
      { type: 'CONFIGURE_AXES', swapXY: true },
      { type: 'CALIBRATE_ZERO' },
      { type: 'UNKNOWN' },
    ]) {
      client.send(command);
      assert.equal(
        typeof (await client.wait((message) => message.type === 'ERROR')).error,
        'string',
      );
    }
    client.ws.send('{broken');
    await client.wait((message) => message.type === 'ERROR');
    client.send({ type: 'PING' });
    await client.wait((message) => message.type === 'PONG');
  } finally {
    await server.shutdown();
  }
});

test('WebSocket rejects an unrelated browser origin', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    for (let count = 0; !server.port && count < 100; count++) await delay(5);
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, {
      origin: 'https://unrelated.example',
    });
    const failure = await new Promise<Error>((resolve, reject) => {
      ws.once('open', () =>
        reject(new Error('Unrelated browser origin was accepted')),
      );
      ws.once('error', (error) => resolve(error));
    });
    assert.match(failure.message, /40[13]/);
    ws.terminate();
  } finally {
    await server.shutdown();
  }
});

test('demo reconnect restores state, repeated CONNECT does not leak generators, DISCONNECT stops samples', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const client = await connect(server);
    client.send({ type: 'CONNECT', testMode: true });
    await client.wait((message) => message.type === 'SERIAL_CONNECTED');
    await client.wait(
      (message) => message.type === 'DATA_BATCH' || message.type === 'DATA',
    );
    const second = await connect(server);
    const snapshot = await second.wait(
      (message) => message.type === 'CONNECTED',
    );
    assert.equal(snapshot.serialConnected, true);
    assert.equal(snapshot.testMode, true);
    assert.equal(snapshot.calibration, null);
    client.send({ type: 'CONNECT', testMode: true });
    await client.wait((message) => message.type === 'SERIAL_CONNECTED');
    client.send({ type: 'DISCONNECT' });
    await delay(100);
    client.messages.length = 0;
    await delay(80);
    assert.equal(
      client.messages.some((message) => message.type.startsWith('DATA')),
      false,
    );
    const disconnected = await connect(server);
    assert.equal(
      (await disconnected.wait((message) => message.type === 'CONNECTED'))
        .serialConnected,
      false,
    );
  } finally {
    await server.shutdown();
  }
});

test('real packet processing flags empty load separately from a valid centered position', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const harness = server as any;
    const packet = {
      status: 0,
      sensors: { d1: 2000, d2: 2000, d3: 2000, d4: 2000 },
      deviceTime: 20,
      packetNumber: 1,
      isValid: true,
    };
    const centered = harness.processPacket(packet);
    assert.equal(centered.isValid, true);
    assert.equal(centered.centered.x, 0);
    assert.ok(Number.isFinite(centered.serverTime));
    const empty = harness.processPacket({
      ...packet,
      sensors: calibration.sensorOffsets,
    });
    assert.equal(empty.isValid, false);
    assert.equal(empty.invalidReason, 'insufficient-load');
    assert.equal(
      harness.processPacket({
        ...packet,
        sensors: { ...packet.sensors, d1: 8388607 },
      }).invalidReason,
      'sensor-saturation',
    );
    harness.isCalibrated = false;
    assert.equal(harness.processPacket(packet).invalidReason, 'not-calibrated');
  } finally {
    await server.shutdown();
  }
});

test('disconnect cancels calibration and preserves the prior saved offsets', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const client = await connect(server);
    const harness = server as any;
    harness.serialPort = {
      isOpen: true,
      path: 'TEST-DEVICE',
      close(callback: () => void) {
        callback();
      },
    };
    client.send({ type: 'CALIBRATE_ZERO' });
    await client.wait((message) => message.type === 'CALIBRATION_STARTED');
    client.send({ type: 'DISCONNECT' });
    await client.wait((message) => message.type === 'CALIBRATION_CANCELLED');
    await client.wait((message) => message.type === 'SERIAL_DISCONNECTED');
    assert.equal(harness.calibrationTimer, null);
    assert.deepEqual(
      CalibrationStorage.load()?.sensorOffsets,
      calibration.sensorOffsets,
    );
  } finally {
    await server.shutdown();
  }
});

test('valid axis changes are persisted and synchronized on reconnect', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const client = await connect(server);
    const config = {
      swapXY: false,
      invertX: true,
      invertY: false,
      rotationDeg: 90,
    };
    client.send({ type: 'CONFIGURE_AXES', ...config });
    assert.deepEqual(
      (await client.wait((message) => message.type === 'AXES_CONFIGURED'))
        .config,
      config,
    );
    assert.deepEqual(CalibrationStorage.load()?.axisConfig, config);
    const second = await connect(server);
    assert.deepEqual(
      (await second.wait((message) => message.type === 'CONNECTED')).axisConfig,
      config,
    );
  } finally {
    await server.shutdown();
  }
});

test('200-sample empty-platform calibration uses raw medians and restores its snapshot', async () => {
  const server = new StabilogramServer({ port: 0 });
  try {
    const client = await connect(server);
    const harness = server as any;
    harness.serialPort = {
      isOpen: true,
      path: 'TEST-DEVICE',
      close(callback: () => void) {
        callback();
      },
    };
    client.send({ type: 'CALIBRATE_ZERO' });
    await client.wait((message) => message.type === 'CALIBRATION_STARTED');
    for (let index = 0; index < 200; index++) {
      harness.processPacket({
        status: 0,
        sensors: { d1: index === 0 ? 100000 : 100, d2: 200, d3: 300, d4: 400 },
        deviceTime: index * 20,
        packetNumber: index,
        isValid: true,
      });
    }
    const result = await client.wait(
      (message) => message.type === 'CALIBRATION_COMPLETE',
    );
    assert.deepEqual(result.calibration.sensorOffsets, {
      d1: 100,
      d2: 200,
      d3: 300,
      d4: 400,
    });
    assert.equal(result.calibration.sampleCount, 200);
    assert.equal(CalibrationStorage.load()?.deviceId, 'TEST-DEVICE');
    const second = await connect(server);
    const restored = await second.wait(
      (message) => message.type === 'CONNECTED',
    );
    assert.equal(restored.isCalibrating, false);
    assert.deepEqual(restored.calibration, result.calibration);
  } finally {
    await server.shutdown();
  }
});
