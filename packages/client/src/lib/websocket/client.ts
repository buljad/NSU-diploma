import { WEBSOCKET_PORT } from '@stabilometer/shared';
import type { StabilogramSample, CalibrationData, AxisConfiguration } from '@stabilometer/shared';
type Store = {
	processSample: (s: StabilogramSample) => void;
	setWsConnected: (v: boolean) => void;
	setDeviceConnected: (v: boolean) => void;
	setCalibration: (d: CalibrationData | null) => void;
	setAxisConfig: (c: AxisConfiguration) => void;
	setConnectionDetails: (demo: boolean, port: string) => void;
};
export class StabilogramClient {
	private ws: WebSocket | null = null;
	private store: Store | null = null;
	private handlers = new Map<string, Set<(data: any) => void>>();
	private retry: ReturnType<typeof setTimeout> | null = null;
	private attempts = 0;
	private closed = true;
	private pending: Promise<void> | null = null;
	private lastMessage = 0;
	private total = 0;
	setStore(store: Store) {
		this.store = store;
	}
	on(event: string, callback: (data: any) => void) {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)!.add(callback);
		return () => {
			this.handlers.get(event)?.delete(callback);
		};
	}
	private emit(event: string, data: any) {
		this.handlers.get(event)?.forEach((callback) => callback(data));
	}
	connect(): Promise<void> {
		if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
		if (this.pending) return this.pending;
		this.closed = false;
		if (this.retry) {
			clearTimeout(this.retry);
			this.retry = null;
		}
		this.pending = new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${WEBSOCKET_PORT}`);
			this.ws = ws;
			ws.onopen = () => {
				if (this.ws !== ws) return;
				this.attempts = 0;
				this.store?.setWsConnected(true);
				this.emit('WS_CONNECTED', {});
				resolve();
			};
			ws.onmessage = (event) => {
				if (this.ws === ws) this.handleMessage(event.data);
			};
			ws.onerror = () =>
				reject(new Error('Нет связи с локальным сервером. Запустите приложение через START.'));
			ws.onclose = () => {
				if (this.ws !== ws) return;
				this.ws = null;
				this.pending = null;
				this.store?.setWsConnected(false);
				this.emit('WS_DISCONNECTED', {});
				reject(new Error('Соединение закрыто'));
				if (!this.closed) {
					const delay = Math.min(1000 * 2 ** this.attempts++, 15000);
					this.retry = setTimeout(() => {
						this.retry = null;
						void this.connect().catch(() => {});
					}, delay);
				}
			};
		});
		const promise = this.pending;
		void promise
			.finally(() => {
				if (this.pending === promise) this.pending = null;
			})
			.catch(() => {});
		return promise;
	}
	disconnect() {
		this.closed = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = null;
		this.ws?.close();
		this.ws = null;
		this.pending = null;
		this.store?.setWsConnected(false);
	}
	private acceptSample(value: any, received: number, offset: number) {
		if (
			!value ||
			!value.sensors ||
			!value.centered ||
			!value.mm ||
			!value.raw ||
			!value.filtered ||
			!Number.isFinite(value.deviceTime) ||
			!Number.isFinite(value.packetNumber) ||
			![
				value.mm.x,
				value.mm.y,
				value.raw.x,
				value.raw.y,
				value.raw.z,
				value.raw.f,
				value.centered.x,
				value.centered.y,
				value.centered.z,
				value.centered.f,
				value.filtered.x,
				value.filtered.y,
				value.filtered.z,
				value.filtered.f,
				value.sensors.d1,
				value.sensors.d2,
				value.sensors.d3,
				value.sensors.d4
			].every(Number.isFinite)
		) {
			this.emit('ERROR', { error: 'Получен некорректный пакет измерений' });
			return;
		}
		const sample = { ...value, clientTime: received - offset } as StabilogramSample;
		this.store?.processSample(sample);
	}
	private handleMessage(data: string) {
		try {
			const msg = JSON.parse(data);
			if (!msg || typeof msg.type !== 'string') return;
			this.total++;
			this.lastMessage = performance.now();
			switch (msg.type) {
				case 'DATA':
					this.acceptSample(msg.data, this.lastMessage, 0);
					break;
				case 'DATA_BATCH': {
					if (!Array.isArray(msg.data) || !msg.data.length) break;
					const last = msg.data[msg.data.length - 1];
					const deviceClock = msg.data.every(
						(s: any, i: number) =>
							s &&
							Number.isFinite(s.deviceTime) &&
							(i === 0 || s.deviceTime > msg.data[i - 1].deviceTime)
					);
					for (const sample of msg.data) {
						const latest = deviceClock ? last.deviceTime : (last.serverTime ?? last.clientTime),
							timestamp = deviceClock
								? sample.deviceTime
								: (sample.serverTime ?? sample.clientTime);
						const offset =
							Number.isFinite(latest) && Number.isFinite(timestamp)
								? Math.max(0, latest - timestamp)
								: 0;
						this.acceptSample(sample, this.lastMessage, offset);
					}
					break;
				}
				case 'CONNECTED':
					this.store?.setConnectionDetails(!!msg.testMode, msg.port ?? '');
					this.store?.setDeviceConnected(!!msg.serialConnected);
					this.store?.setCalibration(msg.calibrated && msg.calibration ? msg.calibration : null);
					if (msg.axisConfig) this.store?.setAxisConfig(msg.axisConfig);
					this.emit('CONNECTED', msg);
					break;
				case 'SERIAL_CONNECTED':
					this.store?.setConnectionDetails(!!msg.testMode, msg.port ?? '');
					this.store?.setDeviceConnected(true);
					this.store?.setCalibration(msg.calibrated && msg.calibration ? msg.calibration : null);
					this.emit(msg.type, msg);
					break;
				case 'SERIAL_DISCONNECTED':
					this.store?.setDeviceConnected(false);
					this.emit(msg.type, msg);
					break;
				case 'CALIBRATION_COMPLETE':
					this.store?.setCalibration(msg.calibration);
					this.emit(msg.type, msg.calibration);
					break;
				case 'AXES_CONFIGURED':
					this.store?.setAxisConfig(msg.config);
					this.emit(msg.type, msg.config);
					break;
				case 'PORTS_LIST':
					this.emit(msg.type, { ports: msg.ports ?? [] });
					break;
				default:
					this.emit(msg.type, msg);
			}
		} catch {
			this.emit('ERROR', { error: 'Не удалось прочитать сообщение сервера' });
		}
	}
	private send(type: string, payload: Record<string, unknown> = {}) {
		if (!this.getConnectionState()) {
			this.emit('ERROR', { error: 'Сначала подключитесь к серверу' });
			return;
		}
		this.ws!.send(JSON.stringify({ type, ...payload }));
	}
	listPorts() {
		this.send('LIST_PORTS');
	}
	connectDevice(portPath: string, baudRate = 115200, testMode = false) {
		this.send('CONNECT', { portPath, baudRate, testMode });
	}
	disconnectDevice() {
		this.send('DISCONNECT');
	}
	calibrateZero() {
		this.send('CALIBRATE_ZERO');
	}
	configureAxes(config: AxisConfiguration) {
		this.send('CONFIGURE_AXES', { ...config });
	}
	getConnectionState() {
		return this.ws?.readyState === WebSocket.OPEN;
	}
	getReadyState() {
		return this.ws?.readyState ?? 3;
	}
	getReconnectAttempts() {
		return this.attempts;
	}
	getPerformanceStats() {
		return { totalMessages: this.total, lastMessageTime: this.lastMessage };
	}
	clearAllEventHandlers() {
		this.handlers.clear();
	}
}
export const wsClient = new StabilogramClient();
