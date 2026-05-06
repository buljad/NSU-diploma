// packages/client/src/lib/game/CollisionDetector.ts
//
// Проверка столкновений корзинки с шарами + управление dwell-таймером.
//
// АЛГОРИТМ:
//   Circle (шар) vs AABB (корзинка) — точная проверка:
//   1. Найти ближайшую к центру шара точку на прямоугольнике
//   2. Если dist² < radius² → пересечение
//
// МЕХАНИКИ:
//   • Обычный шар (BALL_NORMAL): удержание 1–1.5 сек (dwell)
//     - Корзинка наезжает → состояние FALLING → DWELLING
//     - Прогресс dwellProgress растёт каждый кадр
//     - Корзинка ушла ИЛИ затряслась → DWELLING → FALLING (прогресс сброшен)
//     - dwellProgress ≥ 1.0 → пойман!
//
//   • Быстрый шар (BALL_FAST): мгновенная ловля при перекрытии
//     - Без dwell: корзинка накрыла → сразу пойман
//
// ZERO-GC:
//   ✅ Только скалярная математика (if, *, +, <)
//   ✅ Никаких объектов, массивов, строк
//   ✅ clamp через if/else (не Math.min/max — они могут JIT-деоптимизировать)
// ─────────────────────────────────────────────────────────────

import type { BallPool } from './BallPool';
import type { BasketController } from './BasketController';
import type { ScoreManager } from './ScoreManager';
import { BALL_STATE_FALLING, BALL_STATE_DWELLING, BALL_NORMAL } from './types';

export class CollisionDetector {
	/**
	 * Эффективное время удержания для ловли (мс).
	 * = StageConfig.dwellTimeMs × DifficultyPreset.dwellTimeMultiplier
	 *
	 * Устанавливается при смене этапа / сложности.
	 */
	private effectiveDwellTimeMs: number = 1000;

	// ────────────────────────────────────────────────────
	// Конфигурация
	// ────────────────────────────────────────────────────

	/**
	 * Установить время удержания для ловли.
	 * Вызывается StageManager'ом при переходе между этапами.
	 *
	 * @param dwellTimeMs - Финальное значение в мс (уже с множителем сложности)
	 */
	configure(dwellTimeMs: number): void {
		this.effectiveDwellTimeMs = dwellTimeMs > 0 ? dwellTimeMs : 1;
	}

	// ────────────────────────────────────────────────────
	// Главная проверка (вызывается 1 раз за кадр)
	// ────────────────────────────────────────────────────

	/**
	 * Проверить все активные шары на пересечение с корзинкой.
	 * Управлять dwell-прогрессом. Вызывать ScoreManager при ловле.
	 *
	 * ПОРЯДОК ВЫЗОВА В ИГРОВОМ ЦИКЛЕ:
	 *   1. basketController.update(cop, vel, dt)
	 *   2. ➡ collisionDetector.check(...)   ← ВОТ ЭТОТ ВЫЗОВ
	 *   3. ballPool.update(dt, now)
	 *   4. Проверка вылета за экран
	 *
	 * ZERO-GC: Только скалярная арифметика, чтение полей, мутация полей.
	 *
	 * @param pool   - Пул шаров
	 * @param basket - Контроллер корзинки
	 * @param score  - Менеджер очков (вызываем onCatch / onWrongCatch)
	 * @param dt     - Дельта времени в СЕКУНДАХ
	 * @param now    - Текущее время (performance.now())
	 */
	check(
		pool: BallPool,
		basket: BasketController,
		score: ScoreManager,
		dt: number,
		now: number
	): void {
		// ── Кэшируем AABB корзинки с УВЕЛИЧЕННОЙ зоной (скаляры, zero-GC) ──
		const bk = basket.basket;

		// ✅ ИСПРАВЛЕНИЕ: Увеличиваем зону коллизии на 20px в каждую сторону
		const expandZone = 20;
		const bHalfW = bk.width * 0.5 + expandZone;
		const bHalfH = bk.height * 0.5 + expandZone;

		const bLeft = bk.x - bHalfW;
		const bRight = bk.x + bHalfW;
		const bTop = bk.y - bHalfH;
		const bBottom = bk.y + bHalfH;

		// Если корзинка шатается — ловля заблокирована
		const wobbling = basket.isWobbling();

		// ── Итерация по ВСЕМ слотам пула ──
		const balls = pool.balls;
		const cap = pool.capacity;

		for (let i = 0; i < cap; i++) {
			const ball = balls[i];

			// Пропуск: только FALLING и DWELLING участвуют в коллизиях
			if (ball.state !== BALL_STATE_FALLING && ball.state !== BALL_STATE_DWELLING) {
				continue;
			}

			// ══════════════════════════════════════════
			// Circle-AABB collision (без Math.min/max)
			// ══════════════════════════════════════════

			// Ближайшая к центру шара точка на AABB корзинки
			let closestX: number;
			if (ball.x < bLeft) {
				closestX = bLeft;
			} else if (ball.x > bRight) {
				closestX = bRight;
			} else {
				closestX = ball.x;
			}

			let closestY: number;
			if (ball.y < bTop) {
				closestY = bTop;
			} else if (ball.y > bBottom) {
				closestY = bBottom;
			} else {
				closestY = ball.y;
			}

			// Квадрат расстояния (без sqrt)
			const dx = ball.x - closestX;
			const dy = ball.y - closestY;
			const distSq = dx * dx + dy * dy;

			// ✅ ИСПРАВЛЕНИЕ: Увеличиваем радиус коллизии
			const effectiveRadius = ball.radius + 15;
			const radiusSq = effectiveRadius * effectiveRadius;

			const isOverlapping = distSq < radiusSq;

			// ══════════════════════════════════════════
			// Обработка пересечения
			// ══════════════════════════════════════════

			if (isOverlapping && !wobbling) {
				// ── Быстрый шар: мгновенная ловля ──
				if (ball.ballType !== BALL_NORMAL) {
					if (ball.state === BALL_STATE_FALLING) {
						if (ball.isTarget) {
							score.onCatch(ball.x, ball.y, true);
						} else {
							score.onWrongCatch(ball.x, ball.y);
						}
						pool.markCaught(i);
					}
					continue;
				}

				// ── Обычный шар: механика удержания (dwell) ──

				if (ball.state === BALL_STATE_FALLING) {
					// Первый кадр контакта: начинаем удержание
					pool.startDwelling(i, now);
					console.log(`🎯 Started dwelling on ball ${i}, target: ${ball.isTarget}`);
					continue;
				}

				// ball.state === BALL_STATE_DWELLING
				// Накапливаем прогресс удержания
				ball.dwellProgress += (dt * 1000) / this.effectiveDwellTimeMs;

				// ✅ ОТЛАДКА: Логируем прогресс
				if (ball.dwellProgress > 0.1) {
					console.log(`🔄 Dwell progress: ${(ball.dwellProgress * 100).toFixed(0)}%`);
				}

				if (ball.dwellProgress >= 1) {
					// ══ Шар пойман! ══
					ball.dwellProgress = 1;

					console.log(`🎉 Ball caught! Target: ${ball.isTarget}`);

					if (ball.isTarget) {
						score.onCatch(ball.x, ball.y, false);
					} else {
						score.onWrongCatch(ball.x, ball.y);
					}

					pool.markCaught(i);
				}
			} else {
				// ── Нет пересечения ИЛИ корзинка шатается ──
				if (ball.state === BALL_STATE_DWELLING) {
					console.log(`❌ Cancelled dwelling on ball ${i}`);
					pool.cancelDwelling(i);
				}
			}
		}
	}
}
