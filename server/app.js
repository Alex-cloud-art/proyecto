import express from 'express';
import mqtt from 'mqtt';
import { thresholdDetect, ZScoreDetector } from './detectors.js';

const PORT = Number(process.env.PORT) || 3000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const TOPIC = 'motor/+/telemetria';
const VARS = ['corriente', 'vibracion', 'temperatura'];
const MAX_HISTORY = 500;
const MAX_ALERTS = 200;

const history = [];
const alerts = [];
const runs = new Map();
const devices = new Map();
const sseClients = new Set();
const stats = { received: 0, invalid: 0, mqttConnected: false };

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => res.write(frame));
}

// Validacion basica del mensaje
function validate(msg) {
  if (!msg || typeof msg !== 'object') return 'mensaje no es un objeto';
  if (typeof msg.deviceId !== 'string' || !msg.deviceId) return 'deviceId invalido';
  if (typeof msg.runId !== 'string' || !msg.runId) return 'runId invalido';
  if (Number.isNaN(Date.parse(msg.ts))) return 'ts invalido';
  if (!msg.readings || typeof msg.readings !== 'object') return 'readings ausente';
  const bad = VARS.find((k) => !Number.isFinite(msg.readings[k]));
  if (bad) return `lectura invalida: ${bad}`;
  return null;
}

function handleMessage(topic, payload) {
  stats.received += 1;
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    stats.invalid += 1;
    console.warn(`[api] JSON invalido en ${topic}`);
    return;
  }
  const error = validate(msg);
  if (error) {
    stats.invalid += 1;
    console.warn(`[api] mensaje descartado (${error})`);
    return;
  }

  // cada corrida nueva reinicia el detector del dispositivo
  let dev = devices.get(msg.deviceId);
  if (!dev || dev.runId !== msg.runId) {
    dev = {
      runId: msg.runId,
      zscore: new ZScoreDetector(),
      prev: { threshold: false, zscore: false },
    };
    devices.set(msg.deviceId, dev);
  }

  const readings = Object.fromEntries(VARS.map((k) => [k, msg.readings[k]]));
  const record = {
    deviceId: msg.deviceId,
    runId: msg.runId,
    ts: msg.ts,
    seq: msg.seq ?? null,
    simulated: msg.simulated === true,
    readings,
    units: msg.units ?? {},
    detections: {
      threshold: thresholdDetect(readings),
      zscore: dev.zscore.detect(readings),
    },
  };

  const run = runs.get(msg.runId) ?? {
    runId: msg.runId,
    deviceId: msg.deviceId,
    samples: 0,
    firstAlert: { threshold: null, zscore: null },
  };
  runs.set(msg.runId, run);
  run.samples += 1;

  // alerta solo cuando un detector pasa de normal a anomalo
  ['threshold', 'zscore'].forEach((method) => {
    const det = record.detections[method];
    if (det.anomaly && !dev.prev[method]) {
      const alert = {
        method,
        deviceId: record.deviceId,
        runId: record.runId,
        ts: record.ts,
        seq: record.seq,
        vars: det.vars,
      };
      alerts.unshift(alert);
      if (alerts.length > MAX_ALERTS) alerts.pop();
      if (!run.firstAlert[method]) run.firstAlert[method] = { seq: record.seq, ts: record.ts };
      broadcast('alert', alert);
    }
    dev.prev[method] = det.anomaly;
  });

  history.push(record);
  if (history.length > MAX_HISTORY) history.shift();
  broadcast('telemetry', record);
}

// ---------- MQTT ----------
const client = mqtt.connect(MQTT_URL, { clientId: 'api-motor-monitor', reconnectPeriod: 2000 });
client.on('connect', () => {
  stats.mqttConnected = true;
  console.log(`[api] MQTT conectado a ${MQTT_URL}`);
  client.subscribe(TOPIC, (err) => {
    if (err) console.error(`[api] error al suscribirse: ${err.message}`);
  });
  broadcast('status', { ...stats });
});
client.on('close', () => {
  stats.mqttConnected = false;
  console.warn('[api] MQTT desconectado, reintentando...');
  broadcast('status', { ...stats });
});
client.on('error', (err) => console.error(`[api] error MQTT: ${err.message}`));
client.on('message', handleMessage);

// ---------- HTTP ----------
const app = express();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ...stats, sseClients: sseClients.size });
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, MAX_HISTORY);
  res.json(history.slice(-limit));
});

app.get('/api/alerts', (req, res) => res.json(alerts));
app.get('/api/runs', (req, res) => res.json([...runs.values()]));

// Tiempo real con Server-Sent Events
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: status\ndata: ${JSON.stringify(stats)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

setInterval(() => sseClients.forEach((res) => res.write(': ping\n\n')), 15000);

app.listen(PORT, () => console.log(`[api] escuchando en http://localhost:${PORT}`));
