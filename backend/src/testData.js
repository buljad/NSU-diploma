/**
 * Тестовые данные стабилометра для отладки парсинга
 */

export const testStabilogramData = [
  // Полные валидные пакеты (22 байта)
  "#8L2#.G##=H6#Z91#Y0$#&",
  "#3L2#*G##GH6#P91#\\0$#&",
  "#bK2#$G##=H6#7:1#`0$#&",
  "#<L2#:G##<H6#=:1#c0$#&",
  "#FL2#9G##[G6#5:1#$1$#&",
  "#@L2#:G##*H6#P91#'1$#&",
  "#NL2#5G##_G6#.:1#*1$#&",
  "#BL2#QF##KG6#@:1#-1$#&",
  "#LK2#1%$#XC6#ME1#R'$#&",
  "#CK2#Z$$#EC6#3F1#U'$#&",
  "#%L2#C%$#=C6#)F1#X'$#&",
  "#7K2#D%$#EC6#.F1#['$#&",
  "#WK2#T%$#*D6#aE1#_'$#&",
  "#7K2#Y%$#]C6#SF1#b'$#&",
  "#2K2#G%$#2D6#&G1#$($#&",
  "#PK2#L%$#6D6#BG1#'($#&",
  "#LM2#S($#HE6#`I1#-S'#&",
  "#0M2#H($#QE6#II1#3S'#&",

  // Неполные пакеты (для тестирования обработки ошибок)
  "#(M2#&",
  ")$#TE6#=J1#0S'#&",
  "R'$#&",

  // Пакеты с возможными ошибками
  "#ABC#DEF#GHI#JKL#MNO#&", // Тестовый пакет
  "#123#456#789#012#345#&", // Цифровой пакет
];

/**
 * Функция для симуляции потока данных стабилометра
 * Возвращает данные с задержками как реальное устройство
 */
export function createDataSimulator() {
  let currentIndex = 0;
  let intervalId = null;
  
  return {
    /**
     * Запустить симуляцию
     * @param {Function} callback - функция для получения данных
     * @param {number} interval - интервал в мс (по умолчанию 100мс = 10 Гц)
     */
    start(callback, interval = 100) {
      if (intervalId) {
        this.stop();
      }
      
      intervalId = setInterval(() => {
        if (currentIndex < testStabilogramData.length) {
          const data = testStabilogramData[currentIndex];
          console.log(`🧪 Симулятор отправляет: ${data}`);
          callback(data);
          currentIndex++;
        } else {
          // Зацикливаем данные
          currentIndex = 0;
        }
      }, interval);
      
      console.log(`🧪 Симулятор запущен (интервал: ${interval}мс)`);
    },
    
    /**
     * Остановить симуляцию
     */
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('🧪 Симулятор остановлен');
      }
    },
    
    /**
     * Получить случайный пакет
     */
    getRandomPacket() {
      const validPackets = testStabilogramData.filter(packet => packet.length === 22);
      return validPackets[Math.floor(Math.random() * validPackets.length)];
    }
  };
}

export default {
  testStabilogramData,
  createDataSimulator
};  