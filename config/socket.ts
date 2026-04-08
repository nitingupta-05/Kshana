import { io, Socket } from 'socket.io-client';

import { API_ORIGIN, getToken } from '@/config/api';

let _socket: Socket | null = null;

export const getChatSocket = (): Socket | null => _socket;

export const createChatSocket = async (): Promise<Socket> => {
  // Disconnect stale socket
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }

  const token = await getToken();
  if (!token) throw new Error('No auth token available');

  const s = io(API_ORIGIN, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
    // Keep-alive settings
    pingInterval: 25000,
    pingTimeout: 10000,
  });

  _socket = s;
  return s;
};

export const destroyChatSocket = () => {
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }
};
