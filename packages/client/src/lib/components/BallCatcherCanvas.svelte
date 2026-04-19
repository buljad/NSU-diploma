<!-- packages/client/src/lib/components/BallCatcherCanvas.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { stabilogramStore } from '../stores/stabilogram';
  import { gameState } from '../stores/gameState';
  import { BallCatcherGame } from '../game/BallCatcherGame';
  import type { Ball, FloatingText } from '../game/types';
  import {
    BALL_STATE_INACTIVE,
    BALL_STATE_FALLING,
    BALL_STATE_DWELLING,
    BALL_STATE_CAUGHT,
    BALL_STATE_MISSED,
    BALL_NORMAL,
    STAGE_RESULTS,
  } from '../game/types';
  import {
    GAME_BG_COLOR,
    BALL_FILL_COLORS,
    BALL_STROKE_COLORS,
    BALL_GLOW_COLORS,
    BALL_SYMBOLS,
    BASKET_FILL_COLOR,
    BASKET_STROKE_COLOR,
    BASKET_WOBBLE_FILL_COLOR,
    BASKET_WOBBLE_STROKE_COLOR,
    BASKET_CORNER_RADIUS,
    BASKET_STROKE_WIDTH,
    DWELL_RING_FILL,
    DWELL_RING_BG,
    DWELL_RING_WIDTH,
    DWELL_RING_GAP,
    COMFORT_ZONE_COLOR,
    COMFORT_ZONE_ACTIVE_COLOR,
    COMFORT_ZONE_VISUAL_RADIUS,
    SCORE_TEXT_COLORS,
    SCORE_FLOAT_FONT,
    BALL_SYMBOL_FONT,
    HUD_FONT,
    TARGET_HINT_FONT,
    COLOR_CHANGE_FLASH_MS,
    RESULTS_TITLE_FONT,
    RESULTS_BODY_FONT,
  } from '../game/constants';

  // ══════════════════════════════════════════════
  // Props
  // ══════════════════════════════════════════════

  export let width = 800;
  export let height = 600;

  // ══════════════════════════════════════════════
  // Exported methods (parent calls via bind:this)
  // ══════════════════════════════════════════════

  export function startGame(difficulty: number): void {
    if (!game) return;
    game.start(difficulty);
    snapshotCounter = SNAPSHOT_INTERVAL;
  }

  export function pauseGame(): void {
    if (!game) return;
    game.pause();
    gameState.updateSnapshot(game.getSnapshot());
  }

  export function resumeGame(): void {
    if (!game) return;
    game.resume();
    gameState.updateSnapshot(game.getSnapshot());
  }

  export function stopGame(): void {
    if (!game) return;
    game.stop();
    gameState.updateSnapshot(game.getSnapshot());
  }

  export function restartGame(): void {
    if (!game) return;
    game.restart();
    snapshotCounter = SNAPSHOT_INTERVAL;
  }

  // ══════════════════════════════════════════════
  // Local state
  // ══════════════════════════════════════════════

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let game: BallCatcherGame;
  let animationId: number;

  // FPS tracking
  let frameCount = 0;
  let fps = 0;
  let fpsUpdateTime = 0;

  // Snapshot throttle (~6 Гц)
  const SNAPSHOT_INTERVAL = 10;
  let snapshotCounter = 0;

  // Pre-computed constants (avoid Math.PI in hot loop)
  const TWO_PI = 6.283185307179586;
  const HALF_PI = 1.5707963267948966;

  // ══════════════════════════════════════════════
  // Reactive: auto-pause on disconnect
  // ══════════════════════════════════════════════

  $: isDeviceOk = $stabilogramStore.isDeviceConnected && $stabilogramStore.isWsConnected;

  $: if (game && game.isRunning && !game.isPaused && !isDeviceOk) {
    game.pause();
    gameState.updateSnapshot(game.getSnapshot());
  }

  $: if (game && game.isRunning && game.isPaused && isDeviceOk) {
    game.resume();
    gameState.updateSnapshot(game.getSnapshot());
  }

  // ══════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    game = new BallCatcherGame(width, height);
    stabilogramStore.initialize({ x: width, y: height });
    fpsUpdateTime = performance.now();
    animate();
  });

  onDestroy(() => {
    if (animationId) cancelAnimationFrame(animationId);
  });

  // ══════════════════════════════════════════════
  // Render loop (ZERO-GC)
  // ══════════════════════════════════════════════

  function animate(): void {
    const now = performance.now();

    // FPS
    frameCount++;
    if (now - fpsUpdateTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsUpdateTime = now;
    }

    // Update game (zero-GC: all scalar params)
    if (game && game.isRunning && !game.isPaused) {
      const pos = stabilogramStore.getRenderPosition();
      const vel = stabilogramStore.getRenderVelocity();
      game.update(pos.x, pos.y, vel.x, vel.y, now);
    }

    // Draw (zero-GC)
    draw(now);

    // Snapshot → Svelte Store (throttled, ~6 Гц)
    if (game) {
      snapshotCounter++;
      if (snapshotCounter >= SNAPSHOT_INTERVAL) {
        snapshotCounter = 0;
        gameState.updateSnapshot(game.getSnapshot());
      }
    }

    animationId = requestAnimationFrame(animate);
  }

  // ══════════════════════════════════════════════
  // Draw orchestrator
  // ══════════════════════════════════════════════

  function draw(now: number): void {
    // Background
    ctx.fillStyle = GAME_BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    if (!game || !game.isRunning) {
      drawWaitingScreen();
      return;
    }

    if (game.stageManager.currentStage === STAGE_RESULTS) {
      drawResultsScreen();
      return;
    }

    // Active game
    drawComfortZone();
    drawBalls();
    drawBasket();
    drawFloatingTexts();
    drawHUD(now);
    drawColorChangeFlash(now);

    if (game.isPaused) {
      drawPauseOverlay();
    }
  }

  // ══════════════════════════════════════════════
  // Draw: Comfort Zone
  // ══════════════════════════════════════════════

  function drawComfortZone(): void {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const isActive = game.scoreManager.isInComfortZone;

    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = isActive ? COMFORT_ZONE_ACTIVE_COLOR : COMFORT_ZONE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, COMFORT_ZONE_VISUAL_RADIUS, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill if active
    if (isActive) {
      ctx.fillStyle = COMFORT_ZONE_COLOR;
      ctx.beginPath();
      ctx.arc(cx, cy, COMFORT_ZONE_VISUAL_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
  }

  // ══════════════════════════════════════════════
  // Draw: Balls
  // ══════════════════════════════════════════════

  function drawBalls(): void {
    const balls = game.ballPool.balls;
    const cap = game.ballPool.capacity;

    for (let i = 0; i < cap; i++) {
      const b = balls[i];
      if (b.state === BALL_STATE_INACTIVE) continue;
      drawSingleBall(b);
    }
  }

  function drawSingleBall(b: Ball): void {
    let drawR = b.radius;
    let drawAlpha = b.opacity;

    // ── Animations ──
    if (b.state === BALL_STATE_CAUGHT) {
      drawR = b.radius * (1 + b.animProgress * 0.5);
      drawAlpha = (1 - b.animProgress) * b.opacity;
    } else if (b.state === BALL_STATE_MISSED) {
      drawR = b.radius * (1 - b.animProgress * 0.5);
      drawAlpha = (1 - b.animProgress) * b.opacity;
    }

    if (drawAlpha <= 0.01 || drawR < 1) return;

    ctx.globalAlpha = drawAlpha;

    // ── Glow ──
    ctx.fillStyle = BALL_GLOW_COLORS[b.colorIndex];
    ctx.beginPath();
    ctx.arc(b.x, b.y, drawR + 8, 0, TWO_PI);
    ctx.fill();

    // ── Main circle ──
    if (b.state === BALL_STATE_MISSED) {
      ctx.fillStyle = '#e74c3c';
    } else {
      ctx.fillStyle = BALL_FILL_COLORS[b.colorIndex];
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, drawR, 0, TWO_PI);
    ctx.fill();

    // ── Stroke ──
    if (b.ballType !== BALL_NORMAL) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = BALL_STROKE_COLORS[b.colorIndex];
    }
    ctx.stroke();

    // ── Highlight (3D effect) ──
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(b.x - drawR * 0.25, b.y - drawR * 0.25, drawR * 0.3, 0, TWO_PI);
    ctx.fill();

    // ── Symbol (Final stage) ──
    if (b.symbolIndex >= 0 && b.symbolIndex < BALL_SYMBOLS.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = BALL_SYMBOL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(BALL_SYMBOLS[b.symbolIndex], b.x, b.y + 1);
    }

    // ── Target indicator (subtle ring for target balls) ──
    if (b.isTarget && b.state !== BALL_STATE_CAUGHT && b.state !== BALL_STATE_MISSED) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, drawR + 3, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Dwell ring ──
    if (b.state === BALL_STATE_DWELLING && b.dwellProgress > 0) {
      drawDwellRing(b.x, b.y, drawR, b.dwellProgress);
    }

    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════
  // Draw: Dwell Ring (progress of catch)
  // ══════════════════════════════════════════════

  function drawDwellRing(x: number, y: number, r: number, progress: number): void {
    const ringR = r + DWELL_RING_GAP + DWELL_RING_WIDTH * 0.5;

    // Background ring
    ctx.strokeStyle = DWELL_RING_BG;
    ctx.lineWidth = DWELL_RING_WIDTH;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, TWO_PI);
    ctx.stroke();

    // Progress arc (starts from top, clockwise)
    ctx.strokeStyle = DWELL_RING_FILL;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, ringR, -HALF_PI, -HALF_PI + progress * TWO_PI);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // ══════════════════════════════════════════════
  // Draw: Basket
  // ══════════════════════════════════════════════

  function drawBasket(): void {
    const bc = game.basketController;
    const bk = bc.basket;
    const bx = bc.getDrawX();
    const by = bc.getDrawY();
    const bw = bk.width;
    const bh = bk.height;
    const isWobbling = bc.isWobbling();

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundedRect(bx - bw * 0.5 + 3, by - bh * 0.5 + 4, bw, bh, BASKET_CORNER_RADIUS);
    ctx.fill();

    // Body
    ctx.fillStyle = isWobbling ? BASKET_WOBBLE_FILL_COLOR : BASKET_FILL_COLOR;
    ctx.strokeStyle = isWobbling ? BASKET_WOBBLE_STROKE_COLOR : BASKET_STROKE_COLOR;
    ctx.lineWidth = BASKET_STROKE_WIDTH;

    roundedRect(bx - bw * 0.5, by - bh * 0.5, bw, bh, BASKET_CORNER_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Inner lines (basket texture)
    ctx.strokeStyle = isWobbling ? 'rgba(231,76,60,0.3)' : 'rgba(74,158,255,0.25)';
    ctx.lineWidth = 1;
    const innerX = bx - bw * 0.5 + 8;
    const innerW = bw - 16;
    const lineY1 = by - bh * 0.15;
    const lineY2 = by + bh * 0.15;

    ctx.beginPath();
    ctx.moveTo(innerX, lineY1);
    ctx.lineTo(innerX + innerW, lineY1);
    ctx.moveTo(innerX, lineY2);
    ctx.lineTo(innerX + innerW, lineY2);
    ctx.stroke();

    // Wobble indicator (intensity bar)
    if (bk.wobbleIntensity > 0.01) {
      const barW = bw * bk.wobbleIntensity;
      ctx.fillStyle = 'rgba(231,76,60,0.6)';
      ctx.fillRect(bx - barW * 0.5, by + bh * 0.5 + 4, barW, 3);
    }
  }

  // ══════════════════════════════════════════════
  // Draw: Floating Texts (score popups)
  // ══════════════════════════════════════════════

  function drawFloatingTexts(): void {
    const texts = game.scoreManager.texts;
    const cap = game.scoreManager.textCapacity;
    const sm = game.scoreManager;

    ctx.font = SCORE_FLOAT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < cap; i++) {
      const t = texts[i];
      if (!t.active) continue;

      const alpha = sm.getTextOpacity(t);
      if (alpha <= 0.01) continue;

      const scale = sm.getTextScale(t);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = SCORE_TEXT_COLORS[t.colorIndex] ?? 'white';

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════
  // Draw: HUD (score, target hint, timer)
  // ══════════════════════════════════════════════

  function drawHUD(now: number): void {
    const sm = game.stageManager;
    const sc = game.scoreManager;

    // ── Score (top-left) ──
    ctx.font = HUD_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    ctx.fillText('Очки: ' + sc.score, 15, 15);

    // ── Streak (below score) ──
    if (sc.streak > 1) {
      ctx.fillStyle = '#f1c40f';
      ctx.fillText('Серия: ×' + sc.streak, 15, 42);
    }

    // ── Target hint (top-center) ──
    ctx.textAlign = 'center';
    ctx.font = TARGET_HINT_FONT;
    ctx.fillStyle = BALL_FILL_COLORS[sm.targetColorIndex];
    ctx.fillText('Лови ' + sm.getTargetColorName() + '!', width * 0.5, 18);

    // ── Stage indicator (top-right) ──
    ctx.textAlign = 'right';
    ctx.font = HUD_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Этап ' + sm.currentStage, width - 15, 15);

    // ── Timer (below stage, if time-limited) ──
    const remaining = sm.getTimeRemainingSec();
    if (remaining >= 0) {
      const secs = Math.ceil(remaining);
      ctx.fillStyle = remaining < 10 ? '#e74c3c' : 'rgba(255,255,255,0.7)';
      ctx.fillText(secs + ' с', width - 15, 42);
    }

    // ── Comfort zone timer (bottom-center) ──
    if (sc.isInComfortZone && sc.comfortZoneTime > 0.5) {
      ctx.textAlign = 'center';
      ctx.fillStyle = COMFORT_ZONE_ACTIVE_COLOR;
      ctx.font = HUD_FONT;
      ctx.fillText(
        'Баланс: ' + sc.comfortZoneTime.toFixed(1) + ' с',
        width * 0.5,
        height - 20,
      );
    }

    // ── FPS (bottom-left, small) ──
    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('FPS: ' + fps, 10, height - 10);
  }

  // ══════════════════════════════════════════════
  // Draw: Color Change Flash (Stage 2+)
  // ══════════════════════════════════════════════

  function drawColorChangeFlash(now: number): void {
    const elapsed = now - game.stageManager.lastColorChangeTime;
    if (elapsed >= COLOR_CHANGE_FLASH_MS || elapsed < 0) return;

    const progress = elapsed / COLOR_CHANGE_FLASH_MS;
    const alpha = (1 - progress) * 0.15;

    ctx.fillStyle = BALL_FILL_COLORS[game.stageManager.targetColorIndex];
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════
  // Draw: Pause Overlay
  // ══════════════════════════════════════════════

  function drawPauseOverlay(): void {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = RESULTS_TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText('ПАУЗА', width * 0.5, height * 0.45);

    ctx.font = RESULTS_BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Ожидание подключения...', width * 0.5, height * 0.55);
  }

  // ══════════════════════════════════════════════
  // Draw: Waiting Screen (before game starts)
  // ══════════════════════════════════════════════

  function drawWaitingScreen(): void {
    ctx.font = TARGET_HINT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Поймай мяч! 🎾', width * 0.5, height * 0.4);

    ctx.font = RESULTS_BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('Выберите сложность и нажмите «Старт»', width * 0.5, height * 0.52);
  }

  // ══════════════════════════════════════════════
  // Draw: Results Screen
  // ══════════════════════════════════════════════

  function drawResultsScreen(): void {
    const sc = game.scoreManager;

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.font = RESULTS_TITLE_FONT;
    ctx.fillStyle = '#f1c40f';
    ctx.fillText('Игра завершена!', width * 0.5, height * 0.22);

    // Score
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = 'white';
    ctx.fillText('' + sc.score, width * 0.5, height * 0.36);

    ctx.font = RESULTS_BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('очков', width * 0.5, height * 0.43);

    // Stats
    ctx.font = RESULTS_BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const col1x = width * 0.35;
    const col2x = width * 0.65;
    let rowY = height * 0.55;
    const rowH = 30;

    ctx.textAlign = 'left';
    ctx.fillText('Поймано:', col1x, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#2ecc71';
    ctx.fillText('' + sc.catchCount, col2x, rowY);

    rowY += rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Пропущено:', col1x, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e74c3c';
    ctx.fillText('' + sc.missCount, col2x, rowY);

    rowY += rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Ошибок:', col1x, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e67e22';
    ctx.fillText('' + sc.wrongCatchCount, col2x, rowY);

    rowY += rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Лучшая серия:', col1x, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText('×' + sc.bestStreak, col2x, rowY);

    rowY += rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Время:', col1x, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'white';
    ctx.fillText((game.totalElapsedMs * 0.001).toFixed(1) + ' с', col2x, rowY);

    // Hint
    ctx.textAlign = 'center';
    ctx.font = RESULTS_BODY_FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Нажмите «Заново» для повторной игры', width * 0.5, height * 0.88);
  }

  // ══════════════════════════════════════════════
  // Helper: Rounded Rectangle (zero-GC path ops)
  // ══════════════════════════════════════════════

  function roundedRect(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
</script>

<div class="game-canvas-container">
  <canvas
    bind:this={canvas}
    {width}
    {height}
  />
</div>

<style>
  .game-canvas-container {
    position: relative;
    display: inline-block;
  }

  canvas {
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: block;
  }
</style>