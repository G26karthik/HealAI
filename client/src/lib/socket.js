import { io } from 'socket.io-client';

// Same-origin: the Vite proxy forwards /socket.io (including the upgrade) to
// the API. Callers also keep a polling backstop for a dropped websocket.
export const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

export function joinDispatchRoom() {
  socket.emit('subscribe:dispatch');
}

export function subscribeRequest(id) {
  socket.emit('subscribe:request', id);
}
