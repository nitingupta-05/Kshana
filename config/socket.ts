import { io, Socket } from 'socket.io-client';

import { getApiOrigins, getToken } from '@/config/api';

let _socket: Socket | null = null;

export const getChatSocket = (): Socket | null => _socket;

const connectSocket = (origin: string, token: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = io(origin, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    const timer = setTimeout(() => {
      s.removeAllListeners('connect');
      s.removeAllListeners('connect_error');
      s.disconnect();
      reject(new Error('Socket connect timeout'));
    }, 6000);

    s.once('connect', () => {
      clearTimeout(timer);
      s.removeAllListeners('connect_error');
      resolve(s);
    });

    s.once('connect_error', (err: any) => {
      clearTimeout(timer);
      s.removeAllListeners('connect');
      s.disconnect();
      reject(err instanceof Error ? err : new Error('Socket connect error'));
    });
  });

export const createChatSocket = async (): Promise<Socket> => {
  // Disconnect stale socket
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }

  const token = await getToken();
  if (!token) throw new Error('No auth token available');

  const origins = Array.from(new Set(getApiOrigins()));
  let lastError: Error | null = null;

  for (const origin of origins) {
    try {
      const s = await connectSocket(origin, token);
      _socket = s;
      return s;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Unable to connect chat socket');
};

export const destroyChatSocket = () => {
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }
};
