import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';
let socket: Socket | null = null;

export const getSocket = (): Socket | null => {
  return socket;
};

export const connectSocket = (token: string): Socket => {
  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: {
      token,
    },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log('Socket.io connected successfully');
  });

  socket.on('disconnect', () => {
    console.log('Socket.io disconnected');
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
