/**
 * A tiny holder for the Socket.IO instance.
 *
 * Routes need to broadcast, and index.js needs to mount routes. Importing the
 * server from a route would make that a cycle, so the instance is registered
 * here once at boot and read from here everywhere else.
 */
let io = null;

export const setIo = (instance) => {
  io = instance;
};

export const emitDispatch = (event, payload) => io?.to('dispatch').emit(event, payload);

export const emitRequest = (requestId, event, payload) =>
  io?.to(`request:${requestId}`).emit(event, payload);
