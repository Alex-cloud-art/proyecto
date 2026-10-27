// Referencia base: limites fijos por variable
export const LIMITS = {
  corriente: 1.5,
  vibracion: 0.6,
  temperatura: 42,
};

export function thresholdDetect(readings) {
  const vars = Object.keys(LIMITS).filter((name) => readings[name] > LIMITS[name]);
  return { anomaly: vars.length > 0, vars };
}

// Desviacion minima para no dividir entre casi cero
const MIN_SD = { corriente: 0.03, vibracion: 0.02, temperatura: 0.3 };

// Puntuacion estadistica en ventana movil (z-score)
export class ZScoreDetector {
  constructor({ windowSize = 30, minSamples = 15, zLimit = 3.5 } = {}) {
    this.windowSize = windowSize;
    this.minSamples = minSamples;
    this.zLimit = zLimit;
    this.windows = {};
  }

  detect(readings) {
    const scores = {};
    const vars = [];
    let ready = true;

    Object.keys(readings).forEach((name) => {
      const win = this.windows[name] ?? [];
      this.windows[name] = win;
      if (win.length < this.minSamples) {
        ready = false;
        return;
      }
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.max(Math.sqrt(variance), MIN_SD[name] ?? 0.01);
      const z = (readings[name] - mean) / sd;
      scores[name] = Number(z.toFixed(2));
      if (Math.abs(z) > this.zLimit) vars.push(name);
    });

    const anomaly = vars.length > 0;
    // solo las muestras normales actualizan la linea base
    if (!anomaly) {
      Object.keys(readings).forEach((name) => {
        this.windows[name].push(readings[name]);
        if (this.windows[name].length > this.windowSize) this.windows[name].shift();
      });
    }
    return { anomaly, vars, scores, ready };
  }
}
