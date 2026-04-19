// packages/client/src/lib/stores/gameState.ts
//
// Svelte Store для UI-компонентов, отображающих состояние игры.
// Обновляется из BallCatcherCanvas каждые ~10 кадров (~6 Гц).
//
// DESIGN:
//   • Чистый data store — без логики.
//   • GameSnapshot создаётся в BallCatcherGame.getSnapshot() (~6 Гц).
//   • UI-компоненты подписываются через $gameState.
// ─────────────────────────────────────────────────────

import { writable } from 'svelte/store';
import type { GameSnapshot } from '../game/types';
import { STAGE_MENU, DIFF_MEDIUM } from '../game/types';

const DEFAULT_SNAPSHOT: GameSnapshot = {
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

function createGameStore() {
  const { subscribe, set } = writable<GameSnapshot>(DEFAULT_SNAPSHOT);

  return {
    subscribe,

    /** Обновить снимок из BallCatcherGame (вызывается ~6 Гц) */
    updateSnapshot(snapshot: GameSnapshot): void {
      set(snapshot);
    },

    /** Сброс к начальному состоянию */
    reset(): void {
      set({
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
      });
    },
  };
}

export const gameState = createGameStore();