import test from 'node:test';
import assert from 'node:assert/strict';
import { BallCatcherGame } from '../packages/client/src/lib/game/BallCatcherGame';
import {
  BALL_NORMAL,
  BALL_FAST,
  BALL_STATE_CAUGHT,
  BALL_STATE_DWELLING,
  BALL_STATE_FALLING,
  DIFF_EASY,
  DIFF_HARD,
  STAGE_MENU,
  STAGE_RESULTS,
} from '../packages/client/src/lib/game/types';

test('manual pause survives a healthy connection and reconnection', () => {
  const game = new BallCatcherGame(1000, 750);
  assert.equal(game.getSnapshot().stage, STAGE_MENU);
  game.start(DIFF_EASY, 0);
  game.pause();
  game.updateTransportState(true, true, 20);
  assert.equal(game.isPaused, true);
  assert.equal(game.pauseReason, 'manual');
  game.updateTransportState(false, false, 30);
  game.updateTransportState(true, true, 40);
  assert.equal(game.isPaused, true);
  game.resume('manual', 50);
  assert.equal(game.isPaused, false);
});

test('transport pause resumes only on fresh data; manual continue cannot bypass loss of signal', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_EASY, 0);
  game.updateTransportState(true, false, 20);
  assert.equal(game.pauseReason, 'transport');
  game.resume('manual', 30);
  assert.equal(game.isPaused, true);
  game.updateTransportState(true, false, 40);
  assert.equal(game.isPaused, true);
  game.updateTransportState(true, true, 50);
  assert.equal(game.isPaused, false);
  game.update(0, 0, 0, 0, 70);
  assert.ok(Math.abs(game.totalElapsedMs - 20) < 1e-8);
});

test('long pause does not advance active time, ball animations or spawn clock', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_EASY, 0);
  const ballIndex = game.ballPool.spawn(
    100,
    100,
    0,
    10,
    0,
    20,
    BALL_NORMAL,
    true,
    -1,
    0,
  );
  game.update(0, 0, 0, 0, 20);
  const y = game.ballPool.balls[ballIndex].y;
  game.pause();
  game.update(0, 0, 0, 0, 10000);
  assert.equal(game.ballPool.balls[ballIndex].y, y);
  game.resume('manual', 10000);
  game.update(0, 0, 0, 0, 10020);
  assert.ok(Math.abs(game.simulationTime - 40) < 1e-8);
  assert.equal(game.ballPool.activeCount, 1);
  assert.ok(game.ballPool.balls[ballIndex].opacity < 1);
});

test('visual basket wobble never cancels dwell; leaving the target does', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_EASY, 0);
  const basket = game.basketController.basket;
  basket.wobbleIntensity = 1;
  const index = game.ballPool.spawn(
    basket.x,
    basket.y,
    0,
    0,
    0,
    20,
    BALL_NORMAL,
    true,
    -1,
    0,
  );
  game.collisionDetector.configure(500);
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.1,
    0,
  );
  assert.equal(game.ballPool.balls[index].state, BALL_STATE_DWELLING);
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.3,
    300,
  );
  assert.ok(game.ballPool.balls[index].dwellProgress > 0);
  basket.x = 0;
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.1,
    400,
  );
  assert.equal(game.ballPool.balls[index].state, BALL_STATE_FALLING);
  assert.equal(game.ballPool.balls[index].dwellProgress, 0);
  basket.x = 500;
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.1,
    500,
  );
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.5,
    1000,
  );
  assert.equal(game.ballPool.balls[index].state, BALL_STATE_CAUGHT);
  assert.equal(game.scoreManager.catchCount, 1);
});

test('fast non-target ball applies wrong-catch penalty even with visual wobble', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_HARD, 0);
  const basket = game.basketController.basket;
  basket.wobbleIntensity = 1;
  game.ballPool.spawn(basket.x, basket.y, 0, 0, 0, 20, BALL_FAST, false, -1, 0);
  game.collisionDetector.check(
    game.ballPool,
    game.basketController,
    game.scoreManager,
    0.02,
    20,
  );
  assert.equal(game.scoreManager.wrongCatchCount, 1);
  assert.equal(game.scoreManager.catchCount, 0);
});

test('four stages complete and produce independent per-stage results; stop returns to menu', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_EASY, 0);
  let now = 0;
  for (let expected = 1; expected <= 3; expected++) {
    assert.equal(game.stageManager.currentStage, expected);
    game.scoreManager.catchCount += game.stageManager.config.catchesToAdvance;
    now += 20;
    game.update(0, 0, 0, 0, now);
  }
  assert.equal(game.stageManager.currentStage, 4);
  game.stageManager.stageElapsedMs = game.stageManager.config.durationMs - 10;
  game.update(0, 0, 0, 0, now + 20);
  assert.equal(game.stageManager.currentStage, STAGE_RESULTS);
  assert.equal(game.isRunning, false);
  const snapshot = game.getSnapshot();
  assert.deepEqual(
    snapshot.stages?.map((stage) => stage.stage),
    [1, 2, 3, 4],
  );
  snapshot.stages![0].catches = 999;
  assert.equal(game.getSnapshot().stages![0].catches, 8);
  game.stop();
  assert.equal(game.stageManager.currentStage, STAGE_MENU);
});

test('existing balls follow the newly announced target colour', () => {
  const game = new BallCatcherGame(1000, 750);
  game.start(DIFF_EASY, 0);
  game.stageManager.configure(DIFF_EASY, 2, game.scoreManager, 0);
  const oldTarget = game.stageManager.targetColorIndex;
  const index = game.ballPool.spawn(
    100,
    100,
    0,
    0,
    oldTarget,
    20,
    BALL_NORMAL,
    true,
    -1,
    0,
  );
  game.stageManager.update(
    game.scoreManager,
    game.ballPool,
    0,
    0.02,
    game.stageManager.config.colorChangeIntervalMs + 1,
  );
  assert.notEqual(game.stageManager.targetColorIndex, oldTarget);
  assert.equal(game.ballPool.balls[index].isTarget, false);
});
