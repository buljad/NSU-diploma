import { writable, type Writable } from 'svelte/store';
import type {
  StabilogramState,
  StabilogramDataMessage,
  SerialPortInfo,
  SerialConfig,
  ConnectionStatus
} from '$lib/types/stabilogram';

// ============================================================================
// ТИПЫ WEBSOCKET СООБЩЕНИЙ
// ============================================================================

interface BaseMessage {
  type: string;
  timestamp?: number;
}

interface WelcomeMessage extends BaseMessage {
  type: 'WELCOME';
  message: string;
}

interface ConnectedMessage extends BaseMessage {
  type: 'CONNECTED';
  portInfo?: {
    port: string;
    baudRate: number | string;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    testMode?: boolean;
    description?: string;
  };
}

interface DisconnectedMessage extends BaseMessage {
  type: 'DISCONNECTED';
  message?: string;
  testMode?: boolean;
}

interface PortsListMessage extends BaseMessage {
  type: 'PORTS_LIST';
  ports: SerialPortInfo[];
}

interface ErrorMessage extends BaseMessage {
  type: 'ERROR' | 'SERIAL_ERROR';
  message: string;
}

interface StatusMessage extends BaseMessage {
  type: 'STATUS';
  connected: boolean;
  testMode?: boolean;
}

type WebSocketMessage =
  | WelcomeMessage
  | StabilogramDataMessage
  | ConnectedMessage
  | DisconnectedMessage
  | PortsListMessage
  | ErrorMessage
  | StatusMessage;

// ============================================================================
// WEBSOCKET STORE
// ============================================================================

interface WebSocketStore extends Writable<StabilogramState> {
  connect: (url?: string) => void;
  send: (type: string, payload?: Record<string, unknown>) => void;
  listPorts: () => void;
  connectSerial: (config?: SerialConfig) => void;
  disconnectSerial: () => void;
  disconnect: () => void;
  clearData: () => void;
  clearError: () => void;
}

function createWebSocketStore(): WebSocketStore {
  const { subscribe, set, update } = writable<StabilogramState>({
    connected: false,
    serialConnected: false,
    data: [],
    status: 'disconnected',
    error: null,
    availablePorts: []
  });

  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let currentUrl = '';
  let shouldReconnect = true;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;

  /**
   * Обработка входящих сообщений
   */
  function handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'WELCOME':
        console.log('✅ Приветствие от сервера:', message.message);
        break;

      case 'DATA':
        // ✅ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: сохраняем структурированные данные
        update(state => ({
          ...state,
          data: [...state.data, message]
        }));
        
        // Логируем только в dev режиме
        if (import.meta.env.DEV) {
          console.log('📊 Новые данные:', {
            x: message.parsed?.interpretation.variant2.x,
            y: message.parsed?.interpretation.variant2.y,
            force: message.parsed?.interpretation.variant2.force
          });
        }
        break;

      case 'CONNECTED':
        console.log('✅ Подключение успешно:', message.portInfo);
        update(state => ({
          ...state,
          serialConnected: true,
          error: null
        }));
        break;

      case 'DISCONNECTED':
        console.log('📴 Отключено:', message.message);
        update(state => ({
          ...state,
          serialConnected: false
        }));
        break;

      case 'PORTS_LIST':
        console.log('📋 Список портов получен:', message.ports.length);
        update(state => ({
          ...state,
          availablePorts: message.ports
        }));
        break;

      case 'ERROR':
      case 'SERIAL_ERROR':
        console.error('❌ Ошибка от сервера:', message.message);
        update(state => ({
          ...state,
          error: message.message
        }));
        break;

      case 'STATUS':
        update(state => ({
          ...state,
          serialConnected: message.connected
        }));
        break;

      default:
        const _exhaustiveCheck: never = message;
        console.warn('⚠️ Неизвестный тип сообщения:', _exhaustiveCheck);
    }
  }

  /**
   * Попытка переподключения
   */
  function attemptReconnect(): void {
    if (!shouldReconnect) {
      console.log('🔄 Переподключение отключено');
      return;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Не удалось переподключиться после нескольких попыток');
      update(state => ({
        ...state,
        status: 'error',
        error: 'Не удалось подключиться к серверу'
      }));
      return;
    }

    reconnectAttempts++;
    console.log(`🔄 Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);

    update(state => ({
      ...state,
      status: 'reconnecting'
    }));

    reconnectTimeout = setTimeout(() => {
      connectInternal(currentUrl);
    }, RECONNECT_DELAY);
  }

  /**
   * Внутренняя функция подключения
   */
  function connectInternal(url: string): void {
    if (ws?.readyState === WebSocket.OPEN) {
      console.log('⚠️ WebSocket уже подключен');
      return;
    }

    console.log(`🔌 Подключение к ${url}...`);
    ws = new WebSocket(url);

    ws.onopen = (): void => {
      console.log('✅ WebSocket подключен');
      reconnectAttempts = 0;
      update(state => ({
        ...state,
        connected: true,
        status: 'connected',
        error: null
      }));
    };

    ws.onmessage = (event: MessageEvent): void => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        handleMessage(message);
      } catch (error) {
        console.error('❌ Ошибка парсинга сообщения:', error);
      }
    };

    ws.onclose = (): void => {
      console.log('📴 WebSocket отключен');
      update(state => ({
        ...state,
        connected: false,
        serialConnected: false,
        status: 'disconnected'
      }));

      attemptReconnect();
    };

    ws.onerror = (error: Event): void => {
      console.error('❌ WebSocket ошибка:', error);
      update(state => ({
        ...state,
        status: 'error',
        error: 'Ошибка подключения к серверу'
      }));
    };
  }

  return {
    subscribe,
    set,
    update,

    connect(url: string = 'ws://localhost:8081'): void {
      currentUrl = url;
      shouldReconnect = true;
      reconnectAttempts = 0;
      connectInternal(url);
    },

    send(type: string, payload: Record<string, unknown> = {}): void {
      if (ws?.readyState === WebSocket.OPEN) {
        const message = { type, ...payload };
        ws.send(JSON.stringify(message));
      } else {
        console.error('❌ WebSocket не подключен');
        update(state => ({
          ...state,
          error: 'Нет подключения к серверу'
        }));
      }
    },

    listPorts(): void {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'LIST_PORTS' }));
      }
    },

    connectSerial(config: SerialConfig = {}): void {
      if (ws?.readyState === WebSocket.OPEN) {
        const message = {
          type: 'CONNECT',
          baudRate: config.baudRate ?? 9600,
          portPath: config.portPath ?? null,
          dataBits: config.dataBits,
          stopBits: config.stopBits,
          parity: config.parity,
          testMode: config.testMode ?? false
        };
        
        console.log('📤 Отправка команды подключения:', message);
        ws.send(JSON.stringify(message));
      } else {
        update(state => ({
          ...state,
          error: 'WebSocket не подключен'
        }));
      }
    },

    disconnectSerial(): void {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'DISCONNECT' }));
      }
    },

    disconnect(): void {
      console.log('🔌 Отключение от WebSocket...');
      
      shouldReconnect = false;
      
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      
      if (ws) {
        ws.close();
        ws = null;
      }
      
      reconnectAttempts = 0;
      
      update(state => ({
        ...state,
        connected: false,
        serialConnected: false,
        status: 'disconnected'
      }));
    },

    clearData(): void {
      update(state => ({ ...state, data: [] }));
    },

    clearError(): void {
      update(state => ({ ...state, error: null }));
    }
  };
}

export const wsStore = createWebSocketStore();
export type { StabilogramState };