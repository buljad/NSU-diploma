import {
	WEBSOCKET_PORT,
	WEBSOCKET_HOST,
	type StabilogramSample,
	type AxisConfiguration,
	type CalibrationData,
	type PortInfo
} from '@stabilometer/shared';

// Тип для нашего стора (чтобы TS не ругался)
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

	// Храним обработчики событий
	private eventHandlers = new Map<string, ((data: unknown) => void)[]>();

	// Метод для внедрения зависимости стора
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

	private handleMessage(data: string): void {
		try {
			const msg = JSON.parse(data);
			if (!msg.type) return;

			switch (msg.type) {
				case 'DATA':
					const sample = { ...msg.data, clientTime: performance.now() };
					this.store?.processSample(sample);
					break;
				case 'CALIBRATION_COMPLETE':
					this.store?.setCalibration(msg.calibration);
					break;
				case 'PORTS_LIST':
					this.emit('PORTS_LIST', msg.ports);
					break;
				case 'SERIAL_CONNECTED':
					console.log('✅ Device Connected:', msg.port || 'Test Mode');
					this.store?.setDeviceConnected(true);
					break;
				case 'SERIAL_DISCONNECTED':
					console.log('❌ Device Disconnected');
					this.store?.setDeviceConnected(false);
					break;
				case 'CONNECTED':
					this.store?.setDeviceConnected(!!msg.serialConnected);
					break;
				case 'ERROR':
					console.error('Server error:', msg.error);
					break;
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

		// Явное приведение к объекту для надежности
		const message = JSON.stringify({
			type,
			...payload
		});

		this.ws.send(message);
	}

	// Публичные методы API
	connectToPort(portPath: string, baudRate = 115200, testMode = false) {
		this.send('CONNECT', { portPath, baudRate, testMode });
	}

	disconnectFromPort() {
		this.send('DISCONNECT');
	}

	calibrateZero() {
		this.send('CALIBRATE_ZERO');
	}

	requestPorts() {
		this.send('LIST_PORTS');
	}

	configureAxes(config: AxisConfiguration) {
		this.send('CONFIGURE_AXES', config);
		this.store?.setAxisConfig(config);
	}

	// Простая система событий
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
}

export const wsClient = new StabilogramClient();
