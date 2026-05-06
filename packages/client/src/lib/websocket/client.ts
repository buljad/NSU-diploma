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

export class StabilogramClient {
	private ws: WebSocket | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectInterval = 2000;
	private intentionallyClosed = false;
	private store: StoreType | null = null;

	private eventHandlers = new Map<string, ((data: unknown) => void)[]>();

	setStore(store: any) {
		this.store = store;
	}

	async connect(): Promise<void> {
		this.intentionallyClosed = false;

		return new Promise((resolve, reject) => {
			try {
				const url = `ws://${WEBSOCKET_HOST}:${WEBSOCKET_PORT}`;
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

				this.ws.onclose = () => {
					console.log('❌ WebSocket closed');
					this.store?.setWsConnected(false);
					if (!this.intentionallyClosed) this.scheduleReconnect();
				};

				this.ws.onerror = (error) => {
					console.error('WebSocket error:', error);
					reject(error);
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	disconnect(): void {
		this.intentionallyClosed = true;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.store?.setWsConnected(false);
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
		this.reconnectAttempts++;
		setTimeout(() => this.connect().catch(console.error), this.reconnectInterval);
	}

	// ✅ ИСПРАВЛЕННЫЙ МЕТОД: Добавлена обработка событий калибровки
	private handleMessage(data: string): void {
		try {
			const msg = JSON.parse(data);
			if (!msg.type) return;

			switch (msg.type) {
				case 'DATA':
					const sample = { ...msg.data, clientTime: performance.now() };
					this.store?.processSample(sample);
					break;
					
				// ✅ ДОБАВЛЕНО: Обработка событий калибровки
				case 'CALIBRATION_STARTED':
					console.log('🔧 Калибровка начата');
					this.emit('CALIBRATION_STARTED', null);
					break;
					
				case 'CALIBRATION_PROGRESS':
					console.log('📊 Прогресс калибровки:', msg.progress, '/', msg.total);
					this.emit('CALIBRATION_PROGRESS', {
						progress: msg.progress,
						total: msg.total
					});
					break;
					
				case 'CALIBRATION_COMPLETE':
					console.log('✅ Калибровка завершена');
					this.store?.setCalibration(msg.calibration);
					this.emit('CALIBRATION_COMPLETE', msg.calibration);
					break;
					
				case 'PORTS_LIST':
					this.emit('PORTS_LIST', msg.ports);
					break;
					
				case 'SERIAL_CONNECTED':
					console.log('✅ Device Connected:', msg.port || 'Test Mode');
					this.store?.setDeviceConnected(true);
					this.emit('SERIAL_CONNECTED', msg);
					break;
					
				case 'SERIAL_DISCONNECTED':
					console.log('❌ Device Disconnected');
					this.store?.setDeviceConnected(false);
					this.emit('SERIAL_DISCONNECTED', null);
					break;
					
				case 'CONNECTED':
					this.store?.setDeviceConnected(!!msg.serialConnected);
					if (msg.axisConfig) {
						this.store?.setAxisConfig(msg.axisConfig);
					}
					this.emit('CONNECTED', msg);
					break;
					
				case 'ERROR':
					console.error('Server error:', msg.error);
					this.emit('ERROR', msg.error);
					break;
					
				default:
					console.log('❓ Неизвестное сообщение:', msg.type);
			}
		} catch (e) {
			console.error('Parse error:', e);
		}
	}

	private send(type: string, payload: any = {}): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('WebSocket not connected');
			return;
		}

		const message = JSON.stringify({
			type,
			...payload
		});

		this.ws.send(message);
	}

	// Публичные методы API
	connectToPort(portPath: string, baudRate = 115200, testMode = false) {
		console.log(`📡 Подключение к ${testMode ? 'тестовому режиму' : 'порту: ' + portPath}`);
		this.send('CONNECT', { portPath, baudRate, testMode });
	}

	disconnectFromPort() {
		console.log('📡 Отключение от устройства');
		this.send('DISCONNECT');
	}

	calibrateZero() {
		console.log('🔧 Запуск калибровки нуля');
		this.send('CALIBRATE_ZERO');
	}

	requestPorts() {
		console.log('📋 Запрос списка портов');
		this.send('LIST_PORTS');
	}

	configureAxes(config: AxisConfiguration) {
		this.send('CONFIGURE_AXES', config);
		this.store?.setAxisConfig(config);
	}

	// ✅ УЛУЧШЕННАЯ система событий
	on(event: string, callback: (data: unknown) => void) {
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

	private emit(event: string, data: unknown) {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.forEach((cb) => cb(data));
		}
	}

	// ✅ ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ
	getConnectionState(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	clearAllEventHandlers(): void {
		this.eventHandlers.clear();
	}
}

export const wsClient = new StabilogramClient();