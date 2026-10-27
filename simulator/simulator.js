import mqtt from 'mqtt';

const MODE = process.argv[2] === 'anomalo' ? 'anomalo' : 'normal';
const BROKER_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const DEVICE_ID = process.env.DEVICE_ID || 'bomba-01';
const PERIOD_MS = 1000;
const RUN_ID = `${MODE}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const TOPIC = `motor/${DEVICE_ID}/telemetria`;

// ruido gaussiano aproximado (Box-Muller)
function gauss(mean, sd) {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

let seq = 0;

function readings() {
  let corriente = gauss(1.2, 0.05);
  let vibracion = gauss(0.3, 0.03);
  let temperatura = gauss(38, 0.4);
  if (MODE === 'anomalo' && seq > 20) {
    const k = Math.min((seq - 20) / 20, 1);
    corriente += 0.5 * k;
    vibracion += 0.6 * k;
    temperatura += 6 * k;
  }
  return {
    corriente: Number(corriente.toFixed(3)),
    vibracion: Number(vibracion.toFixed(3)),
    temperatura: Number(temperatura.toFixed(2)),
  };
}

const client = mqtt.connect(BROKER_URL, { clientId: `sim-${DEVICE_ID}`, reconnectPeriod: 2000 });
client.on('connect', () => console.log(`[sim] conectado a ${BROKER_URL} | modo=${MODE} | corrida=${RUN_ID}`));
client.on('close', () => console.warn('[sim] conexion cerrada, reintentando...'));
client.on('error', (err) => console.error(`[sim] error: ${err.message}`));

setInterval(() => {
  seq += 1;
  if (!client.connected) return;
  const msg = {
    deviceId: DEVICE_ID,
    runId: RUN_ID,
    ts: new Date().toISOString(),
    seq,
    simulated: true,
    readings: readings(),
    units: { corriente: 'A', vibracion: 'g', temperatura: 'C' },
  };
  client.publish(TOPIC, JSON.stringify(msg));
}, PERIOD_MS);
