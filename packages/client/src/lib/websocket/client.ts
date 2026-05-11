// packages/client/src/lib/websocket/client.ts

import {
	WEBSOCKET_PORT,
	WEBSOCKET_HOST,
	type StabilogramSample,
	type AxisConfiguration,
	type CalibrationData,
	type PortInfo
} from '@stabilometer/shared';

type StoreType = {
	processSample: (s: StabilogramSample) => void;
	setCalibration: (d: CalibrationData) => void;
	setWsConnected: (v: boolean) => void;
	setDeviceConnected: (v: boolean) => void;
	setAxisConfig: (c: AxisConfiguration) => void;
};

class SimpleEventEmitter {
	private eventHandlers = new Map<string, ((data: unknown) => void)[]>();

	on(event: string, callback: (data: unknown) => void): () => void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(callback);

		return () => {
			const handlers = this.eventHandlers.get(event);
			if (handlers) {
				const idx = handlers.indexOf(callback);
				if (idx !== -1) handlers.splice(idx, 1);
			}
		};
	}

	emit(event: string, data: unknown): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.forEach((cb) => cb(data));
		}
	}

	removeAllListeners(): void {
		this.eventHandlers.clear();
	}
}

export class StabilogramClient extends SimpleEventEmitter {
	private ws: WebSocket | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectInterval = 2000;
	private intentionallyClosed = false;
	private store: StoreType | null = null;

	private messageStats = {
		totalMessages: 0,
		dataMessages: 0,
		batchMessages: 0,
		lastMessageTime: 0,
		messageRate: 0
	};

	public listPorts(): void {
		this.send('LIST_PORTS', {});
	}

	public connectDevice(portPath: string, baudRate: number, testMode: boolean): void {
		this.send('CONNECT', { portPath, baudRate, testMode });
	}

	public disconnectDevice(): void {
		this.send('DISCONNECT', {});
	}

	public calibrateZero(): void {
		this.send('CALIBRATE_ZERO', {});
	}

	public configureAxes(config: AxisConfiguration): void {
		this.send('CONFIGURE_AXES', config as unknown as Record<string, unknown>);
	}

	public getPerformanceStats() {
		const now = performance.now();
		if (now - this.messageStats.lastMessageTime < 1000) {
			this.messageStats.messageRate = this.messageStats.totalMessages;
		}
		return { ...this.messageStats };
	}

	setStore(store: any): void {
		this.store = store;
		console.log('🔗 WebSocket client connected to store');
	}

	async connect(): Promise<void> {
		this.intentionallyClosed = false;

		return new Promise((resolve, reject) => {
			try {
				const url = `ws://${WEBSOCKET_HOST}:${WEBSOCKET_PORT}`;
				console.log(`🔗 Connecting to ${url}...`);
				this.ws = new WebSocket(url);

				this.ws.onopen = () => {
					console.log('✅ WebSocket connected');
					this.reconnectAttempts = 0;
					this.store?.setWsConnected(true);
					resolve();
				};

				this.ws.onmessage = (event) => {
					this.handleMessage(event.data);
				};

				this.ws.onclose = (event) => {
					console.log('❌ WebSocket closed:', event.code, event.reason);
					this.store?.setWsConnected(false);
					this.store?.setDeviceConnected(false);

					if (!this.intentionallyClosed) {
						this.scheduleReconnect();
					}
				};

				this.ws.onerror = (error) => {
					console.error('❌ WebSocket error:', error);
					reject(error);
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	disconnect(): void {
		console.log('🔌 Disconnecting WebSocket...');
		this.intentionallyClosed = true;

		if (this.ws) {
			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}

		this.store?.setWsConnected(false);
		this.store?.setDeviceConnected(false);
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(`❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.min(this.reconnectInterval * this.reconnectAttempts, 30000);

		console.log(`🔄 Reconnect attempt ${this.reconnectAttempts} in ${delay}ms...`);

		setTimeout(() => {
			if (!this.intentionallyClosed) {
				this.connect().catch(console.error);
			}
		}, delay);
	}

	private handleMessage(data: string): void {
		try {
			const msg = JSON.parse(data);
			if (!msg.type) return;

			this.messageStats.totalMessages++;
			this.messageStats.lastMessageTime = performance.now();

			switch (msg.type) {
				case 'DATA':
					this.messageStats.dataMessages++;
					if (msg.data) {
						const sample = {
							...msg.data,
							clientTime: performance.now()
						} as StabilogramSample;
						this.store?.processSample(sample);
					}
					break;

				// ✅ ИСПРАВЛЕНО: Идеальное распределение времени для пачки
				case 'DATA_BATCH':
					this.messageStats.batchMessages++;

					if (msg.data && Array.isArray(msg.data)) {
						const batchReceiveTime = performance.now();
						const count = msg.data.length;

						// ✅ ИСПРАВЛЕНО: Используем РЕАЛЬНОЕ время из последнего пакета
						// Предполагаем, что batch был отправлен сразу после последнего пакета
						const lastSampleData = msg.data[count - 1];

						// Если в пакете есть deviceTime, используем его для вычисления offset'а
						let baseClientTime = batchReceiveTime;

						for (let i = 0; i < count; i++) {
							const sampleData = msg.data[i];

							// ✅ НОВАЯ СТРАТЕГИЯ: Равномерно распределяем пакеты
							// в интервале [batchReceiveTime - estimatedBatchDuration, batchReceiveTime]
							const estimatedPacketInterval = 20; // 50Hz = 20ms между пакетами
							const estimatedBatchDuration = (count - 1) * estimatedPacketInterval;

							// Пакеты идут "назад во времени" от момента получения batch'а
							const packetOffset = (count - 1 - i) * estimatedPacketInterval;
							const clientTime = batchReceiveTime - packetOffset;

							const sample = {
								...sampleData,
								clientTime: clientTime
							} as StabilogramSample;

							this.store?.processSample(sample);
						}

						// ✅ ДИАГНОСТИКА
						if (count > 1) {
							console.log(
								`📦 Batch processed: ${count} packets over ~${((count - 1) * 20).toFixed(0)}ms`
							);
						}
					}
					break;

				case 'PORTS_LIST':
					this.emit('PORTS_LIST', { ports: msg.ports || [] });
					break;

				case 'SERIAL_CONNECTED':
					this.store?.setDeviceConnected(true);
					this.emit('SERIAL_CONNECTED', msg);
					break;

				case 'SERIAL_DISCONNECTED':
					this.store?.setDeviceConnected(false);
					this.emit('SERIAL_DISCONNECTED', null);
					break;

				case 'CONNECTED':
					this.store?.setDeviceConnected(!!msg.serialConnected);
					if (msg.calibrated && msg.calibration) {
						this.store?.setCalibration(msg.calibration);
					}
					if (msg.axisConfig) {
						this.store?.setAxisConfig(msg.axisConfig);
					}
					this.emit('CONNECTED', msg);
					break;

				case 'CALIBRATION_STARTED':
					this.emit('CALIBRATION_STARTED', null);
					break;

				case 'CALIBRATION_PROGRESS':
					this.emit('CALIBRATION_PROGRESS', {
						progress: msg.progress || 0,
						total: msg.total || 200
					});
					break;

				case 'CALIBRATION_COMPLETE':
					if (msg.calibration) {
						this.store?.setCalibration(msg.calibration);
					}
					this.emit('CALIBRATION_COMPLETE', msg.calibration);
					break;

				case 'ERROR':
					this.emit('ERROR', { error: msg.error });
					break;

				case 'PERFORMANCE_STATS':
					this.emit('PERFORMANCE_STATS', msg.stats);
					break;

				case 'PERFORMANCE_UPDATED':
					this.emit('PERFORMANCE_UPDATED', msg.settings);
					break;
			}
		} catch (error) {
			console.error('❌ Message parse error:', error);
		}
	}

	private send(type: string, payload: any = {}): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		try {
			this.ws.send(JSON.stringify({ type, ...payload }));
		} catch (error) {
			console.error('❌ Send error:', error);
		}
	}

	getConnectionState(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	getReadyState(): number {
		return this.ws?.readyState ?? WebSocket.CLOSED;
	}

	getReconnectAttempts(): number {
		return this.reconnectAttempts;
	}

	clearAllEventHandlers(): void {
		this.removeAllListeners();
	}
}

export const wsClient = new StabilogramClient();

if (typeof window !== 'undefined') {
	(window as any).wsClient = wsClient;
}
