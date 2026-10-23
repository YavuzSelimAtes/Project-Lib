import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
const app = await buildApp();
try {
  await app.listen({ port, host: process.env.HOST || '0.0.0.0' });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
for (const ip of ips) app.log.info(`Aile aginda: http://${ip}:${port}`);
const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
