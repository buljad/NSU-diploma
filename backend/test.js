import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8081 });

console.log('✅ Тестовый WebSocket сервер запущен на порту 8081');

wss.on('connection', (ws) => {
  console.log('✅ Клиент подключился');
  ws.send('Привет от сервера!');
});