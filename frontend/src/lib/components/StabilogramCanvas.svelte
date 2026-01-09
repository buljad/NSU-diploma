<script lang="ts">
  import { wsStore } from '$lib/stores/websocket';
  import type { StabilogramDataMessage } from '$lib/types/stabilogram';
  import { onMount, afterUpdate } from 'svelte';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  
  // Размеры canvas
  const CANVAS_WIDTH = 600;
  const CANVAS_HEIGHT = 600;
  
  // Параметры визуализации
  const PLATFORM_SIZE = 400;
  const SCALE = CANVAS_WIDTH / (PLATFORM_SIZE * 2);
  const CENTER_X = CANVAS_WIDTH / 2;
  const CENTER_Y = CANVAS_HEIGHT / 2;
  
  // Текущая точка центра давления
  let currentX = 0;
  let currentY = 0;
  let currentForce = 0;
  
  // История точек для траектории
  let trail: Array<{x: number, y: number}> = [];
  const MAX_TRAIL_LENGTH = 50;
  
  // Настройки отображения
  let showGrid = true;
  let showTrail = true;
  let showCrosshair = true;
  
  // ✅ РЕАКТИВНОЕ ОБНОВЛЕНИЕ при новых данных
  $: if ($wsStore.data.length > 0) {
    updateVisualization($wsStore.data[$wsStore.data.length - 1]);
  }
  
  onMount(() => {
    ctx = canvas.getContext('2d');
    if (ctx) {
      drawCoordinateSystem();
    }
  });
  
  /**
   * ✅ ОБНОВЛЕННАЯ ФУНКЦИЯ: принимает типизированные данные
   */
  function updateVisualization(message: StabilogramDataMessage) {
    if (!message.parsed?.interpretation) {
      console.warn('⚠️ Нет распарсенных данных');
      return;
    }
    
    // Используем вариант 2 (центрированные координаты)
    const { x, y, force } = message.parsed.interpretation.variant2;
    
    // Обновляем текущие значения
    currentX = x;
    currentY = y;
    currentForce = force;
    
    // Добавляем в траекторию
    if (showTrail) {
      trail.push({ x, y });
      
      if (trail.length > MAX_TRAIL_LENGTH) {
        trail.shift();
      }
    }
    
    // Перерисовываем
    if (ctx) {
      redraw();
    }
  }
  
  /**
   * Перерисовка canvas
   */
  function redraw() {
    if (!ctx) return;
    
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawCoordinateSystem();
    
    if (showTrail && trail.length > 1) {
      drawTrail();
    }
    
    drawCurrentPoint();
    
    if (showCrosshair) {
      drawCrosshair();
    }
  }
  
  function drawCoordinateSystem() {
    if (!ctx) return;
    
    // Фон
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Граница платформы
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, PLATFORM_SIZE * SCALE / 2, 0, Math.PI * 2);
    ctx.stroke();
    
    if (showGrid) {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      const gridStep = 50 * SCALE;
      
      for (let x = CENTER_X % gridStep; x < CANVAS_WIDTH; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      
      for (let y = CENTER_Y % gridStep; y < CANVAS_HEIGHT; y += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }
    }
    
    // Оси
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(0, CENTER_Y);
    ctx.lineTo(CANVAS_WIDTH, CENTER_Y);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(CENTER_X, 0);
    ctx.lineTo(CENTER_X, CANVAS_HEIGHT);
    ctx.stroke();
    
    // Центр
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Подписи
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('X', CANVAS_WIDTH - 20, CENTER_Y - 10);
    ctx.fillText('Y', CENTER_X + 20, 20);
  }
  
  function drawTrail() {
    if (!ctx || trail.length < 2) return;
    
    ctx.strokeStyle = 'rgba(33, 150, 243, 0.3)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const screenX = CENTER_X + (point.x * SCALE / 1000);
      const screenY = CENTER_Y - (point.y * SCALE / 1000);
      
      if (i === 0) {
        ctx.moveTo(screenX, screenY);
      } else {
        ctx.lineTo(screenX, screenY);
      }
      
      const alpha = (i / trail.length) * 0.5;
      ctx.globalAlpha = alpha;
    }
    
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }
  
  function drawCurrentPoint() {
    if (!ctx) return;
    
    const screenX = CENTER_X + (currentX * SCALE / 1000);
    const screenY = CENTER_Y - (currentY * SCALE / 1000);
    
    const baseRadius = 8;
    const forceScale = Math.min(currentForce / 2000000, 2);
    const radius = baseRadius * forceScale;
    
    // Внешнее кольцо
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    
    // Градиент
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radius);
    gradient.addColorStop(0, '#4CAF50');
    gradient.addColorStop(0.7, '#2196F3');
    gradient.addColorStop(1, 'rgba(33, 150, 243, 0.3)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Центр
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  function drawCrosshair() {
    if (!ctx) return;
    
    const screenX = CENTER_X + (currentX * SCALE / 1000);
    const screenY = CENTER_Y - (currentY * SCALE / 1000);
    
    ctx.strokeStyle = 'rgba(244, 67, 54, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, CANVAS_HEIGHT);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(CANVAS_WIDTH, screenY);
    ctx.stroke();
    
    ctx.setLineDash([]);
  }
  
  function clearTrail() {
    trail = [];
    if (ctx) redraw();
  }
  
  function resetPosition() {
    currentX = 0;
    currentY = 0;
    currentForce = 0;
    trail = [];
    if (ctx) redraw();
  }
</script>

<div class="canvas-container">
  <div class="canvas-header">
    <h3>📊 Визуализация центра давления</h3>
    <div class="canvas-controls">
      <label class="checkbox">
        <input type="checkbox" bind:checked={showGrid} on:change={redraw} />
        Сетка
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={showTrail} />
        Траектория
      </label>
      <label class="checkbox">
        <input type="checkbox" bind:checked={showCrosshair} on:change={redraw} />
        Прицел
      </label>
      <button class="btn-small" on:click={clearTrail}>Очистить траекторию</button>
      <button class="btn-small" on:click={resetPosition}>Сброс</button>
    </div>
  </div>
  
  <div class="canvas-wrapper">
    <canvas 
      bind:this={canvas}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
    ></canvas>
  </div>
  
  <div class="canvas-info">
    <div class="info-item">
      <span class="info-label">X:</span>
      <span class="info-value" class:positive={currentX > 0} class:negative={currentX < 0}>
        {(currentX / 1000).toFixed(2)} мм
      </span>
    </div>
    <div class="info-item">
      <span class="info-label">Y:</span>
      <span class="info-value" class:positive={currentY > 0} class:negative={currentY < 0}>
        {(currentY / 1000).toFixed(2)} мм
      </span>
    </div>
    <div class="info-item">
      <span class="info-label">Сила:</span>
      <span class="info-value force">
        {currentForce.toLocaleString()} у.е.
      </span>
    </div>
    <div class="info-item">
      <span class="info-label">Точек в траектории:</span>
      <span class="info-value">{trail.length}</span>
    </div>
  </div>
</div>

<style>
  /* Все стили остаются прежними */
  .canvas-container {
    background: white;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    margin-bottom: 20px;
  }
  
  .canvas-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    flex-wrap: wrap;
    gap: 10px;
  }
  
  .canvas-header h3 {
    margin: 0;
    color: #333;
    font-size: 18px;
  }
  
  .canvas-controls {
    display: flex;
    gap: 15px;
    align-items: center;
    flex-wrap: wrap;
  }
  
  .checkbox {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 14px;
    color: #666;
    cursor: pointer;
  }
  
  .checkbox input {
    cursor: pointer;
  }
  
  .btn-small {
    padding: 6px 12px;
    font-size: 12px;
    background: #e3f2fd;
    color: #1976D2;
    border: 1px solid #90caf9;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .btn-small:hover {
    background: #bbdefb;
  }
  
  .canvas-wrapper {
    display: flex;
    justify-content: center;
    margin-bottom: 15px;
  }
  
  canvas {
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    background: white;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);
  }
  
  .canvas-info {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 15px;
    padding: 15px;
    background: #f9f9f9;
    border-radius: 6px;
  }
  
  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    background: white;
    border-radius: 4px;
  }
  
  .info-label {
    font-weight: 500;
    color: #666;
    font-size: 14px;
  }
  
  .info-value {
    font-family: 'Courier New', monospace;
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }
  
  .info-value.positive {
    color: #4CAF50;
  }
  
  .info-value.negative {
    color: #f44336;
  }
  
  .info-value.force {
    color: #2196F3;
  }
  
  @media (max-width: 768px) {
    canvas {
      max-width: 100%;
      height: auto;
    }
    
    .canvas-header {
      flex-direction: column;
      align-items: flex-start;
    }
    
    .canvas-controls {
      width: 100%;
      justify-content: flex-start;
    }
  }
</style>