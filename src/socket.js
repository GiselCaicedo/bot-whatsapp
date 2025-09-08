import { Server } from 'socket.io';

let io;

export function initSocket(server) {
  io = new Server(server);
  return io;
}

export function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}
