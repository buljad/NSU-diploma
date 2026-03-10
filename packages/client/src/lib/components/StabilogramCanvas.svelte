<!-- packages/client/src/lib/components/StabilogramCanvas.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { stabilogramStore } from '../stores/stabilogram';
  import type { Vector2D } from '@stabilometer/shared';

  export let width = 800;
  export let height = 600;
  export let showDebug = true;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let animationId: number;
  let lastFrameTime = 0;
  let frameCount = 0;
  let fps = 0;
  let fpsUpdateTime = 0;

  let trail: Vector2D[] = [];
  const maxTrailLength = 200;

  $: position = $stabilogramStore.interpolatedPosition;
  $: velocity = $stabilogramStore.velocity;
  $: scale = $stabilogramStore.scale;
  $: isConnected = $stabilogramStore.isWsConnected;
  $: latency = $stabilogramStore.latency;
  $: packetRate = $stabilogramStore.packetRate;

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    stabilogramStore.initialize({ x: width, y: height });
    lastFrameTime = performance.now();
    fpsUpdateTime = lastFrameTime;
    animate();
  });

  onDestroy(() => {
    if (animationId) cancelAnimationFrame(animationId);
  });

  function animate() {
    const now = performance.now();

    frameCount++;
    if (now - fpsUpdateTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsUpdateTime = now;
      stabilogramStore.updateFps(fps);
    }

    const renderPos = stabilogramStore.getRenderPosition();
    if ($stabilogramStore.currentSample) {
      trail.push({ ...renderPos });
      if (trail.length > maxTrailLength) trail.shift();
    }

    draw(renderPos);

    lastFrameTime = now;
    animationId = requestAnimationFrame(animate);
  }

  function draw(pos: Vector2D) {
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    drawGrid(cx, cy);
    drawTrail(cx, cy);
    drawCharacter(cx + pos.x * scale, cy - pos.y * scale);

    if (showDebug) drawDebugInfo(pos);
  }

  function drawGrid(cx: number, cy: number) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;

    const spacing = 10 * scale;
    for (let x = cx % spacing; x < width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = cy % spacing; y < height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(74,158,255,0.1)';
    ctx.lineWidth = 1;
    for (let r = 50; r < Math.max(width, height); r += 50) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawTrail(cx: number, cy: number) {
    if (trail.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < trail.length; i++) {
      const alpha = (i / trail.length) * 0.8;
      const lw = 1 + (i / trail.length) * 3;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(74,158,255,${alpha})`;
      ctx.lineWidth = lw;

      const prev = trail[i - 1];
      const curr = trail[i];

      ctx.moveTo(cx + prev.x * scale, cy - prev.y * scale);
      ctx.lineTo(cx + curr.x * scale, cy - curr.y * scale);
      ctx.stroke();
    }
  }

  function drawCharacter(x: number, y: number) {
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    const r = 20 + Math.min(speed * 0.5, 10);

    // Glow
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r + 20);
    glow.addColorStop(0, 'rgba(74,158,255,0.5)');
    glow.addColorStop(0.5, 'rgba(74,158,255,0.2)');
    glow.addColorStop(1, 'rgba(74,158,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r + 20, 0, Math.PI * 2);
    ctx.fill();

    // Main
    const main = ctx.createRadialGradient(x - r/3, y - r/3, 0, x, y, r);
    main.addColorStop(0, '#6ee7ff');
    main.addColorStop(0.7, '#4a9eff');
    main.addColorStop(1, '#2563eb');
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(x - r/3, y - r/3, r/4, 0, Math.PI * 2);
    ctx.fill();

    // Direction
    if (speed > 1) {
      const angle = Math.atan2(-velocity.y, velocity.x);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
      ctx.lineTo(x + Math.cos(angle) * (r + 15), y + Math.sin(angle) * (r + 15));
      ctx.stroke();
    }
  }

  function drawDebugInfo(pos: Vector2D) {
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';

    const lines = [
      `FPS: ${fps}`,
      `Latency: ${latency.toFixed(0)}ms`,
      `Packets: ${packetRate}/s`,
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) mm`,
      `Scale: ${scale.toFixed(1)} px/mm`,
      `Status: ${isConnected ? 'Connected' : 'Disconnected'}`
    ];

    lines.forEach((line, i) => {
      ctx.fillText(line, 10, 20 + i * 20);
    });
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    stabilogramStore.setScale(scale * delta);
  }

  function clearTrail() {
    trail = [];
  }
</script>

<div class="canvas-container">
  <!-- svelte-ignore element_invalid_self_closing_tag -->
  <canvas
    bind:this={canvas}
    {width}
    {height}
    on:wheel={handleWheel}
    on:dblclick={clearTrail}
  />

  <div class="indicator" class:connected={isConnected}>
    <span class="dot"></span>
    <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
  </div>

  <div class="hints">
    <span>Scroll: zoom</span>
    <span>Double-click: clear trail</span>
  </div>
</div>

<style>
  .canvas-container {
    position: relative;
    display: inline-block;
  }

  canvas {
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .indicator {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 20px;
    color: white;
    font-size: 12px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e74c3c;
  }

  .connected .dot {
    background: #2ecc71;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(46, 204, 113, 0); }
  }

  .hints {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 20px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }
</style>