import Aedes from 'aedes';
import { createServer } from 'node:net';

const PORT = Number(process.env.MQTT_PORT) || 1883;
const aedes = new Aedes();
const server = createServer(aedes.handle);

aedes.on('client', (client) => console.log(`[broker] conectado: ${client.id}`));
aedes.on('clientDisconnect', (client) => console.log(`[broker] desconectado: ${client.id}`));
aedes.on('publish', (packet, client) => {
  if (client && packet.topic.startsWith('motor/')) {
    console.log(`[broker] ${packet.topic} <- ${packet.payload.toString()}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[broker] MQTT escuchando en 127.0.0.1:${PORT}`);
});
