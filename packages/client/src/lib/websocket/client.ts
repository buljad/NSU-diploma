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

// ✅ ИСПРАВЛЕНИЕ: Простая реализация EventEmitter для браузера
class SimpleEventEmitter {
	private eventHandlers = new Map<string, ((data: unknown) => void)[]>();

	on(event: string, callback: (data: unknown) => void): () => void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(callback);
		
		// Возвращаем функцию для отписки
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

	// ════════════════════════════════════════════════
	// Публичные методы для ControlPanel
	// ════════════════════════════════════════════════

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

	// ✅ ИСПРАВЛЕНИЕ: Приведение типа для AxisConfiguration
	public configureAxes(config: AxisConfiguration): void {
		this.send('CONFIGURE_AXES', config as unknown as Record<string, unknown>);
	}

	// ════════════════════════════════════════════════
	// Store integration
	// ════════════════════════════════════════════════

	setStore(store: any): void {
		this.store = store;
	}

	// ════════════════════════════════════════════════
	// Connection management
	// ════════════════════════════════════════════════

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

	// ════════════════════════════════════════════════
	// Private methods
	// ════════════════════════════════════════════════

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
			if (!msg.type) {
				console.warn('⚠️ Message without type:', msg);
				return;
			}

			switch (msg.type) {
				case 'DATA':
					if (msg.data) {
						const sample = { 
							...msg.data, 
							clientTime: performance.now() 
						} as StabilogramSample;
						this.store?.processSample(sample);
					}
					break;

				case 'PORTS_LIST':
					console.log('📋 Ports list received:', msg.ports?.length || 0, 'ports');
					this.emit('PORTS_LIST', { ports: msg.ports || [] });
					break;

				case 'SERIAL_CONNECTED':
					console.log('✅ Device connected:', msg.port || 'Test Mode');
					this.store?.setDeviceConnected(true);
					this.emit('SERIAL_CONNECTED', msg);
					break;

				case 'SERIAL_DISCONNECTED':
					console.log('❌ Device disconnected');
					this.store?.setDeviceConnected(false);
					this.emit('SERIAL_DISCONNECTED', null);
					break;

				case 'CONNECTED':
					console.log('🔗 Connection status:', msg);
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
					console.log('🔧 Calibration started');
					this.emit('CALIBRATION_STARTED', null);
					break;

				case 'CALIBRATION_PROGRESS':
					console.log('📊 Calibration progress:', msg.progress, '/', msg.total);
					this.emit('CALIBRATION_PROGRESS', {
						progress: msg.progress || 0,
						total: msg.total || 200
					});
					break;

				case 'CALIBRATION_COMPLETE':
					console.log('✅ Calibration completed');
					if (msg.calibration) {
						this.store?.setCalibration(msg.calibration);
					}
					this.emit('CALIBRATION_COMPLETE', msg.calibration);
					break;

				case 'ERROR':
					console.error('❌ Server error:', msg.error);
					this.emit('ERROR', { error: msg.error });
					break;

				default:
					console.log('❓ Unknown message type:', msg.type, msg);
					break;
			}
		} catch (error) {
			console.error('❌ Message parse error:', error, 'Raw data:', data);
		}
	}

	// ✅ ИСПРАВЛЕНИЕ: Изменили тип payload для большей гибкости
	private send(type: string, payload: any = {}): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('⚠️ WebSocket not connected, cannot send:', type);
			return;
		}

		try {
			const message = JSON.stringify({
				type,
				...payload
			});

			this.ws.send(message);
			console.log(`📤 Sent: ${type}`, payload);
		} catch (error) {
			console.error('❌ Send error:', error);
		}
	}

	// ════════════════════════════════════════════════
	// Utility methods
	// ════════════════════════════════════════════════

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

// ✅ Singleton instance
export const wsClient = new StabilogramClient();