// Глобальные переменные для работы с портом
let port; // сам порт, который выбрал пользователь
let reader; // считыватель даных с порта
let keepReading = true; // флаг для остановки чтения

// Получаем элементы со страницы
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const output = document.getElementById('output');
const status = document.getElementById('status');

// Проверяем, поддерживает ли браузер Web Serial API
// без этого ничего не будет работать
if (!("serial" in navigator)) {
    alert('❌ Ваш браузер не поддерживает Web Serial API!\n\nИспользуйте Chrome или Edge (версия 89+)');
    connectBtn.disabled = true;
}

// ПОДКЛЮЧЕНИЕ К ПОРТУ
connectBtn.addEventListener('click', async () => {
    try {
        // браузер открывает окно выбора порта
        port = await navigator.serial.requestPort();
        
        // Открываем порт с настройками
        // baudRate нужно подставить под свое устройство!
        // у меня пока 9600, но может быть 115200 или другое
        await port.open({ 
            baudRate: 9600,  // ВАЖНО: проверить какая скорость у устройства
            dataBits: 8,     // обычно 8
            stopBits: 1,     // обычно 1
            parity: 'none'   // четность обычно выключена
        });

        console.log('✅ Порт открыт успешно');
        
        // Обновляем интерфейс
        updateStatus(true);
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        
        // Убираем текст-заглушку если он есть
        if (output.classList.contains('empty-state')) {
            output.classList.remove('empty-state');
            output.textContent = '';
        }

        // Запускаем чтение данных
        readData();
        
    } catch (error) {
        // Если пользователь закрыл окно выбора порта или произошла ошибка
        console.error('Ошибка при подключении:', error);
        
        // Показываем нормальное сообщение об ошибке
        if (error.name === 'NotFoundError') {
            alert('Вы не выбрали порт');
        } else {
            alert('Не удалось подключиться к порту:\n' + error.message);
        }
    }
});

// ЧТЕНИЕ ДАННЫХ С ПОРТА
// это основная функция которая постоянно читает данные
async function readData() {
    keepReading = true;
    
    // Бесконечный цикл пока порт открыт и флаг true
    while (port.readable && keepReading) {
        reader = port.readable.getReader();
        
        try {
            // Читаем данные пока они приходят
            while (true) {
                const { value, done } = await reader.read();
                
                // Если чтение завершено - выходим
                if (done) {
                    console.log('Чтение завершено');
                    break;
                }
                
                // value это Uint8Array, нужно декодировать в текст
                const text = new TextDecoder().decode(value);
                
                // Выводим полученный текст на экран
                output.textContent += text;
                
                // Автоматически прокручиваем вниз чтобы видеть новые данные
                output.scrollTop = output.scrollHeight;
                
                // Можно раскомментировать для отладки
                // console.log('Получено:', text);
            }
        } catch (error) {
            // Обычно сюда попадаем когда нажимаем "Отключиться"
            console.error('Ошибка при чтении данных:', error);
        } finally {
            // Обязательно освобождаем reader, иначе порт заблокируется
            reader.releaseLock();
        }
    }
    
    console.log('Цикл чтения остановлен');
}

// ОТКЛЮЧЕНИЕ ОТ ПОРТА
disconnectBtn.addEventListener('click', async () => {
    try {
        // Останавливаем цикл чтения
        keepReading = false;
        
        // Отменяем текущее чтение если оно идет
        if (reader) {
            await reader.cancel();
            console.log('Reader отменен');
        }
        
        // Закрываем порт
        if (port) {
            await port.close();
            console.log('Порт закрыт');
        }
        
        // Обновляем интерфейс
        updateStatus(false);
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        
    } catch (error) {
        console.error('Ошибка при отключении:', error);
        // Даже если ошибка - пытаемся вернуть интерфейс в нормальное состояние
        updateStatus(false);
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
    }
});

// ОЧИСТКА ЭКРАНА
// просто стираем весь текст из области вывода
clearBtn.addEventListener('click', () => {
    output.textContent = '';
    console.log('Экран очищен');
});

// ОБНОВЛЕНИЕ СТАТУСА ПОДКЛЮЧЕНИЯ
// меняет цвет и текст индикатора
function updateStatus(connected) {
    const statusText = status.querySelector('span:last-child');
    
    if (connected) {
        status.classList.remove('disconnected');
        status.classList.add('connected');
        statusText.textContent = 'Подключено';
    } else {
        status.classList.remove('connected');
        status.classList.add('disconnected');
        statusText.textContent = 'Не подключено';
    }
}

// Проверка при загрузке страницы - может уже есть разрешенный порт
// (если раньше подключался и дал разрешение)
window.addEventListener('load', async () => {
    try {
        const ports = await navigator.serial.getPorts();
        
        if (ports.length > 0) {
            console.log('Найдены ранее разрешенные порты:', ports.length);
            // TODO: можно добавить кнопку автоподключения к последнему порту
            // пока просто логируем
        }
    } catch (error) {
        console.error('Ошибка при проверке портов:', error);
    }
});

// Обработка случая когда пользователь закрывает страницу
// нужно корректно закрыть порт
window.addEventListener('beforeunload', async (e) => {
    if (port && port.readable) {
        keepReading = false;
        
        if (reader) {
            await reader.cancel();
        }
        
        await port.close();
        console.log('Порт закрыт при выходе');
    }
});