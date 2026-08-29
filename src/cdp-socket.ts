/**
 * A minimal RFC 6455 WebSocket client, just enough to speak the Chrome
 * DevTools Protocol over a loopback connection. No dependency is added for
 * this: the handshake and frame format are small and stable, and CDP only
 * ever needs masked text frames out and unmasked text/ping frames in.
 */
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { ToolError } from './errors.js';

const CALL_TIMEOUT_MS = 20_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function maskPayload(payload: Buffer, mask: Buffer): Buffer {
  const out = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index++) {
    out[index] = payload[index] ^ mask[index % 4];
  }
  return out;
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const masked = maskPayload(payload, mask);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

/** A single WebSocket connection to one Chrome DevTools target (tab). */
export class CdpSocket {
  private readonly socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private fragments: Buffer[] = [];
  private fragmentOpcode: number | null = null;
  private closed = false;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('close', () => this.onClosed(new Error('The DevTools connection closed.')));
    this.socket.on('error', (error) => this.onClosed(error));
  }

  static async connect(webSocketUrl: string, timeoutMs = 10_000): Promise<CdpSocket> {
    const url = new URL(webSocketUrl);
    const socket = net.connect({ host: url.hostname, port: Number(url.port) || 80 });
    const key = randomBytes(16).toString('base64');

    const leftover = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new ToolError('TIMEOUT', 'Timed out connecting to the browser DevTools socket.'));
      }, timeoutMs);
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
      socket.once('connect', () => {
        socket.write([
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'));
      });
      let handshake = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        handshake = Buffer.concat([handshake, chunk]);
        const headerEnd = handshake.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        socket.off('data', onData);
        clearTimeout(timer);
        const head = handshake.subarray(0, headerEnd).toString('latin1');
        const statusLine = head.split('\r\n')[0] ?? '';
        if (!/ 101 /.test(statusLine)) {
          socket.destroy();
          reject(new ToolError('INTERNAL', `DevTools handshake failed: ${statusLine || 'no response'}`));
          return;
        }
        resolve(handshake.subarray(headerEnd + 4));
      };
      socket.on('data', onData);
    });

    const cdp = new CdpSocket(socket);
    if (leftover.length) cdp.onData(leftover);
    return cdp;
  }

  private onClosed(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    while (true) {
      if (this.buffer.length < 2) return;
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];
      const fin = (byte0 & 0x80) !== 0;
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let len = byte1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < offset + 2) return;
        len = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buffer.length < offset + 8) return;
        len = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let maskKey: Buffer | undefined;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + len) return;
      let payload: Buffer = Buffer.from(this.buffer.subarray(offset, offset + len));
      if (maskKey) payload = maskPayload(payload, maskKey);
      this.buffer = Buffer.from(this.buffer.subarray(offset + len));
      this.handleFrame(fin, opcode, Buffer.from(payload));
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x9) { // ping -> pong
      this.socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode === 0x8) { // close
      this.onClosed(new Error('The browser closed the DevTools connection.'));
      this.socket.end();
      return;
    }
    if (opcode === 0xa) return; // pong, nothing to do

    if (opcode !== 0x0) this.fragmentOpcode = opcode;
    this.fragments.push(payload);
    if (!fin) return;

    const message = Buffer.concat(this.fragments).toString('utf8');
    this.fragments = [];
    this.fragmentOpcode = null;
    if (this.fragmentOpcode !== 0x1 && this.fragmentOpcode !== null) {
      // Only text frames are expected from CDP; anything else is ignored rather
      // than crashing the connection over a protocol frame we do not use.
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const envelope = parsed as { id?: number; result?: unknown; error?: { message?: string; code?: number } };
    if (typeof envelope.id !== 'number') return; // an event notification; this client does not subscribe to any
    const call = this.pending.get(envelope.id);
    if (!call) return;
    this.pending.delete(envelope.id);
    clearTimeout(call.timer);
    if (envelope.error) call.reject(new ToolError('INTERNAL', `DevTools protocol error: ${envelope.error.message ?? 'unknown error'}`));
    else call.resolve(envelope.result);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new ToolError('INTERNAL', 'The DevTools connection is closed.'));
    const id = this.nextId++;
    const payload = Buffer.from(JSON.stringify({ id, method, params: params ?? {} }), 'utf8');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError('TIMEOUT', `DevTools call "${method}" did not respond in time.`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.write(encodeFrame(0x1, payload));
    });
  }

  close(): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
    } catch {
      // The socket may already be half-closed; onClosed still fires from 'close'/'error'.
    }
    this.socket.end();
    this.onClosed(new Error('The DevTools connection was closed by the client.'));
  }
}
