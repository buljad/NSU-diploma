// packages/client/src/lib/stores/gameState.ts

import { writable, derived } from 'svelte/store';
import type { GameSnapshot } from '../game/types';
import { 
  STAGE_MENU, 
  STAGE_RESULTS,
  DIFF_MEDIUM 
} from '../game/types';

// ════════════════════════════════════════════════
// Стор состояния игры (обновляется ~2-4 Гц из Canvas)
// ════════════════════════════════════════════════

function createGameStateStore() {
  // ✅ ИСПРАВЛЕНИЕ: Убеждаемся что начальное состояние корректное
  const defaultSnapshot: GameSnapshot = {
    stage: STAGE_MENU,
    difficulty: DIFF_MEDIUM,
    score: 0,
    streak: 0,
    bestStreak: 0,
    targetColorIndex: 3,
    targetColorName: 'синие',
    catchCount: 0,
    missCount: 0,
    wrongCatchCount: 0,
    stageTimeRemaining: -1,
    totalElapsed: 0,
    isInComfortZone: false,
    comfortZoneTime: 0,
    isPaused: false,
    isRunning: false,
  };

  const state = writable<GameSnapshot>({ ...defaultSnapshot });

  return {
    subscribe: state.subscribe,
    
    /**
     * Обновить снимок состояния.
     * Вызывается Canvas компонентом по таймеру (~2-4 Гц).
     */
    updateSnapshot: (snapshot: GameSnapshot) => {
      // ✅ ЛОГИРОВАНИЕ для отладки
      if (snapshot.stage !== defaultSnapshot.stage) {
        console.log('🎮 Stage changed:', { 
          from: defaultSnapshot.stage, 
          to: snapshot.stage,
          isRunning: snapshot.isRunning 
        });
      }
      
      state.set(snapshot);
      // Обновляем default для следующего сравнения
      Object.assign(defaultSnapshot, snapshot);
    },

    /**
     * Сбросить в дефолтное состояние (возврат в меню).
     */
    reset: () => {
      const resetState = {
        stage: STAGE_MENU,
        difficulty: DIFF_MEDIUM,
        score: 0,
        streak: 0,
        bestStreak: 0,
        targetColorIndex: 3,
        targetColorName: 'синие',
        catchCount: 0,
        missCount: 0,
        wrongCatchCount: 0,
        stageTimeRemaining: -1,
        totalElapsed: 0,
        isInComfortZone: false,
        comfortZoneTime: 0,
        isPaused: false,
        isRunning: false,
      };
      
      console.log('🔄 Game state reset to menu');
      state.set(resetState);
      Object.assign(defaultSnapshot, resetState);
    },
  };
}

export const gameStateStore = createGameStateStore();

// ════════════════════════════════════════════════
// Производные сторы для UI биндинга
// ════════════════════════════════════════════════

/** Текущий этап для условного рендеринга UI */
export const currentStage = derived(
  gameStateStore, 
  $state => $state.stage
);

/** Игра активна (не меню, не результаты) */
export const isGameActive = derived(
  gameStateStore,
  $state => $state.isRunning && $state.stage !== STAGE_MENU && $state.stage !== STAGE_RESULTS
);

/** Форматированный счёт для отображения */
export const formattedScore = derived(
  gameStateStore,
  $state => {
    const score = $state.score;
    return score >= 0 ? `+${score}` : `${score}`;
  }
);

/** Прогресс зоны комфорта в процентах */
export const comfortZoneProgress = derived(
  gameStateStore,
  $state => Math.min($state.comfortZoneTime / 10, 1) * 100 // 10 сек = 100%
);