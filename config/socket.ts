import { io, Socket } from 'socket.io-client';

import { API_ORIGIN, getToken } from '@/config/api';

export const createChatSocket = async (): Promise<Socket> => {
  const token = await getToken();
  if (!token) {
    throw new Error('No auth token available');
  }

  return io(API_ORIGIN, {
    transports: ['websocket'],
    auth: { token },
  });
};

