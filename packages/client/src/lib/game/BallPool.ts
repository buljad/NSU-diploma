// packages/client/src/lib/game/BallPool.ts
//
// Object Pool шаров. Все экземпляры создаются ОДИН РАЗ при конструировании.
// В render loop (60-144 Гц) — ТОЛЬКО мутация существующих полей.
//
// ╔══════════════════════════════════════════════════════╗
// ║  ZERO-GC ГАРАНТИЯ:                                  ║
// ║  • Никаких new, [], {} в spawn / update / deactivate ║
// ║  • Массив balls[] фиксированного размера             ║
// ║  • Итерация — только for(i) по индексу               ║
// ║  • Состояние шара — числовой флаг (state)            ║
// ╚══════════════════════════════════════════════════════╝
//
// Жизненный цикл шара:
//   INACTIVE → spawn() → FALLING ⇄ DWELLING → markCaught() → CAUGHT → [anim] → INACTIVE
//                           ↓                    markMissed() → MISSED → [anim] → INACTIVE
//                       deactivate()
//                           ↓
//                       INACTIVE
// ─────────────────────────────────────────────────────

import type { Ball } from './types';
import {
	BALL_STATE_INACTIVE,
	BALL_STATE_FALLING,
	BALL_STATE_DWELLING,
	BALL_STATE_CAUGHT,
	BALL_STATE_MISSED
} from './types';
import { MAX_BALLS, BALL_FADE_IN_MS, BALL_CATCH_ANIM_MS, BALL_MISS_ANIM_MS } from './constants';

export class BallPool {
	// ── Прямой доступ для zero-GC итерации в render loop ──
	// Читайте как:
	//   for (let i = 0; i < pool.capacity; i++) {
	//     const b = pool.balls[i];
	//     if (b.state === BALL_STATE_INACTIVE) continue;
	//     // ... работа с b
	//   }
	readonly balls: Ball[];
	readonly capacity: number;

	private _activeCount: number = 0;

	constructor(capacity: number = MAX_BALLS) {
		this.capacity = capacity;
		this.balls = new Array(capacity);

		// ── Предаллокация всех объектов ──
		for (let i = 0; i < capacity; i++) {
			this.balls[i] = this.createEmptyBall();
		}
	}

	// ────────────────────────────────────────────────────
	// Геттеры
	// ────────────────────────────────────────────────────

	get activeCount(): number {
		return this._activeCount;
	}

	// ────────────────────────────────────────────────────
	// Спавн
	// ────────────────────────────────────────────────────

	/**
	 * Активировать шар из пула.
	 *
	 * Находит первый INACTIVE слот и заполняет его переданными параметрами.
	 * Все параметры — примитивы (zero-GC).
	 *
	 * @returns Индекс активированного шара, или -1 если пул исчерпан.
	 */
	spawn(
		x: number,
		y: number,
		vx: number,
		vy: number,
		colorIndex: number,
		radius: number,
		ballType: number,
		isTarget: boolean,
		symbolIndex: number,
		now: number
	): number {
		for (let i = 0; i < this.capacity; i++) {
			if (this.balls[i].state !== BALL_STATE_INACTIVE) continue;

			const b = this.balls[i];
			b.x = x;
			b.y = y;
			b.vx = vx;
			b.vy = vy;
			b.colorIndex = colorIndex;
			b.radius = radius;
			b.symbolIndex = symbolIndex;
			b.opacity = 0; // Начнёт fade-in
			b.state = BALL_STATE_FALLING;
			b.ballType = ballType;
			b.isTarget = isTarget;
			b.dwellProgress = 0;
			b.dwellTimestamp = 0;
			b.spawnTime = now;
			b.animProgress = 0;

			this._activeCount++;
			return i;
		}
		return -1; // Пул исчерпан
	}

	// ────────────────────────────────────────────────────
	// Переходы состояний
	// ────────────────────────────────────────────────────

	/**
	 * Вернуть шар в пул (мгновенно, без анимации).
	 * Используется для нецелевых шаров, улетевших за экран.
	 */
	deactivate(index: number): void {
		if (index < 0 || index >= this.capacity) return;
		const b = this.balls[index];
		if (b.state === BALL_STATE_INACTIVE) return;

		b.state = BALL_STATE_INACTIVE;
		this._activeCount--;
		// Защита от underflow (на случай бага в вызывающем коде)
		if (this._activeCount < 0) this._activeCount = 0;
	}

	/**
	 * Начать анимацию «пойман» (scale up + fade out).
	 * Вызывается CollisionDetector'ом когда dwell заполнен.
	 */
	markCaught(index: number): void {
		if (index < 0 || index >= this.capacity) return;
		const b = this.balls[index];
		if (b.state === BALL_STATE_INACTIVE) return;

		b.state = BALL_STATE_CAUGHT;
		b.animProgress = 0;
	}

	/**
	 * Начать анимацию «пропущен» (shrink + red flash).
	 * Вызывается игровым циклом когда целевой шар улетел за экран.
	 */
	markMissed(index: number): void {
		if (index < 0 || index >= this.capacity) return;
		const b = this.balls[index];
		if (b.state === BALL_STATE_INACTIVE) return;

		b.state = BALL_STATE_MISSED;
		b.animProgress = 0;
	}

	/**
	 * Перевести шар в состояние удержания (dwell).
	 * Вызывается CollisionDetector'ом когда корзинка начинает
	 * перекрывать шар.
	 */
	startDwelling(index: number, now: number): void {
		if (index < 0 || index >= this.capacity) return;
		const b = this.balls[index];
		if (b.state !== BALL_STATE_FALLING) return;

		b.state = BALL_STATE_DWELLING;
		b.dwellTimestamp = now;
		b.dwellProgress = 0;
	}

	/**
	 * Прервать удержание (корзинка ушла с шара).
	 * Возвращает шар в FALLING.
	 */
	cancelDwelling(index: number): void {
		if (index < 0 || index >= this.capacity) return;
		const b = this.balls[index];
		if (b.state !== BALL_STATE_DWELLING) return;

		b.state = BALL_STATE_FALLING;
		b.dwellProgress = 0;
		b.dwellTimestamp = 0;
	}

	// ────────────────────────────────────────────────────
	// Обновление физики (вызывается 1 раз за кадр)
	// ────────────────────────────────────────────────────

	/**
	 * Обновить все активные шары: движение, fade-in, анимации.
	 *
	 * ОТВЕТСТВЕННОСТЬ:
	 *   ✅ Перемещение (position += velocity × dt)
	 *   ✅ Fade-in (opacity нарастает первые BALL_FADE_IN_MS)
	 *   ✅ Анимации CAUGHT/MISSED (animProgress += dt)
	 *   ✅ Деактивация шаров с завершённой анимацией
	 *
	 * НЕ ОТВЕТСТВЕННОСТЬ (делает игровой цикл):
	 *   ❌ Проверка вылета за экран
	 *   ❌ Проверка коллизий
	 *   ❌ Начисление очков
	 *   ❌ Решение о спавне новых шаров
	 *
	 * ZERO-GC: Только мутация полей. Никаких аллокаций.
	 *
	 * @param dt   - Дельта времени в СЕКУНДАХ
	 * @param now  - Текущее время (performance.now())
	 */
	update(dt: number, now: number): void {
		for (let i = 0; i < this.capacity; i++) {
			const b = this.balls[i];

			// ── Пропуск неактивных ──
			if (b.state === BALL_STATE_INACTIVE) continue;

			// ── Движение (FALLING и DWELLING двигаются одинаково) ──
			if (b.state === BALL_STATE_FALLING || b.state === BALL_STATE_DWELLING) {
				b.x += b.vx * dt;
				b.y += b.vy * dt;

				// Fade-in
				const age = now - b.spawnTime;
				if (age < BALL_FADE_IN_MS) {
					b.opacity = age / BALL_FADE_IN_MS;
				} else if (b.opacity < 1) {
					b.opacity = 1;
				}
			}

			// ── Анимация «пойман» ──
			if (b.state === BALL_STATE_CAUGHT) {
				b.animProgress += dt / (BALL_CATCH_ANIM_MS * 0.001);
				if (b.animProgress >= 1) {
					b.state = BALL_STATE_INACTIVE;
					this._activeCount--;
					if (this._activeCount < 0) this._activeCount = 0;
				}
			}

			// ── Анимация «пропущен» ──
			if (b.state === BALL_STATE_MISSED) {
				b.animProgress += dt / (BALL_MISS_ANIM_MS * 0.001);
				if (b.animProgress >= 1) {
					b.state = BALL_STATE_INACTIVE;
					this._activeCount--;
					if (this._activeCount < 0) this._activeCount = 0;
				}
			}
		}
	}

	// ────────────────────────────────────────────────────
	// Управление пулом
	// ────────────────────────────────────────────────────

	/**
	 * Деактивировать ВСЕ шары. Используется при смене этапа / рестарте.
	 */
	deactivateAll(): void {
		for (let i = 0; i < this.capacity; i++) {
			this.balls[i].state = BALL_STATE_INACTIVE;
		}
		this._activeCount = 0;
	}

	/**
	 * Подсчитать количество активных шаров определённого состояния.
	 * Используется для лимитов спавна (не в render loop — можно итерировать).
	 *
	 * @param state - BALL_STATE_* константа. Если undefined — все не-INACTIVE.
	 */
	countByState(state?: number): number {
		let count = 0;
		for (let i = 0; i < this.capacity; i++) {
			if (state === undefined) {
				if (this.balls[i].state !== BALL_STATE_INACTIVE) count++;
			} else {
				if (this.balls[i].state === state) count++;
			}
		}
		return count;
	}

	// ────────────────────────────────────────────────────
	// Private
	// ────────────────────────────────────────────────────

	/**
	 * Создать пустой объект Ball. Вызывается ТОЛЬКО в конструкторе.
	 */
	private createEmptyBall(): Ball {
		return {
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			colorIndex: 0,
			radius: 0,
			symbolIndex: -1,
			opacity: 0,
			state: BALL_STATE_INACTIVE,
			ballType: 0,
			isTarget: false,
			dwellProgress: 0,
			dwellTimestamp: 0,
			spawnTime: 0,
			animProgress: 0
		};
	}
}
