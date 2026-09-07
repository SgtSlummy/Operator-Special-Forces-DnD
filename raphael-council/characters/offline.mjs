// Preloaded in the OCR subprocess AND its worker threads. Only the bot downloads
// authenticated Discord attachments; PDF parsing/recognition must be offline.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('Network is disabled in the PDF/OCR worker.'); };
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = dgram.createSocket = deny;
net.Socket.prototype.connect = deny;
globalThis.fetch = async () => deny();
globalThis.WebSocket = class { constructor() { deny(); } };
syncBuiltinESMExports();
