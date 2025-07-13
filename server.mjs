import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN || '*',
    methods: ['GET', 'POST'],
  }
});

app.use(cors({
  origin: process.env.ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

const rooms = {};

const createGrid = () => {
  return Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () => ({ val: 0, color: 'N' }))
  );
};

io.on('connection', (socket) => {
  const connectionTime = new Date().toLocaleString();
  console.log(`Socket connected: ${socket.id} at ${connectionTime}`);
  socket.emit('rooms-list', Object.keys(rooms));

  socket.on('create-room', (playerName, callback) => {
    if (Object.values(rooms).some(room => room.players.includes(socket.id))) {
      return callback({ error: 'You already have a room' });
    }
    let roomId = randomUUID().slice(0, 5).toUpperCase();
    while (rooms[roomId]) {
      roomId = randomUUID().slice(0, 5).toUpperCase();
    }
    rooms[roomId] = {
      grid: createGrid(),
      players: [{socketId: socket.id, playerName: playerName, color: 'B'}],
      host: playerName,
      nRestartRequest: 0,
      turn: 0,
      isProcessing: false // Flag to indicate if the room is processing a move
    };
    socket.join(roomId);
    const creationTime = new Date().toLocaleString();
    console.log(`Room created: ${roomId} by ${playerName} (${socket.id}) at ${creationTime}`);
    io.to(roomId).emit('room-created', roomId);
    socket.emit('rooms-list', Object.keys(rooms));
    console.log(Object.keys(rooms));
    callback(roomId);
  });

  socket.on('get-rooms', () => {
    const roomList = Object.entries(rooms).map(([roomId, room]) => ({
      roomId,
      host: room.host,
      players: room.players,
    }));
    socket.emit('rooms-list', roomList);
  });

  socket.on('done-processing', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      console.error(`Room not found: ${roomId}`);
      return;
    }
    room.isProcessing = false; // Mark the room as no longer processing
    io.to(roomId).emit('animation-complete', { roomId });
  });

  socket.on('join-room', (roomId, playerName, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ error: 'Room not found' });
    if (room.players.length >= 2) return callback({ error: 'Room full' });

    room.players.push({socketId: socket.id, playerName: playerName, color: 'R'});
    socket.join(roomId);
    callback({ success: true, grid: room.grid });

    io.to(roomId).emit('player-joined', room);
  });

  socket.on('make-move', ({ roomId, row, col }) => {
    const room = rooms[roomId];
    if (!room) {
      console.error(`Room not found: ${roomId}`);
      return;
    }
    if (room.isProcessing) {
      console.warn(`Room ${roomId} is currently processing a move. Please wait.`);
      return;
    }

    const playerColor = room.players.find(p => p.socketId === socket.id)?.color;
    const currentTurn = room.turn % 2 === 0 ? 'B' : 'R';
    if (currentTurn !== playerColor) {
      console.warn(`Invalid Turn. Current turn: ${currentTurn}`);
      return;
    }

    const cell = room.grid[row][col];
    if ((cell.color !== playerColor && !(cell.color === 'N' && cell.val === 0)) || cell.val >= 4) {
      console.warn(`Invalid move at (${row}, ${col}). Cell color: ${cell.color}, Value: ${cell.val}`);
      return;
    }
    room.isProcessing = true;
    const burstSeq = applyMove(room.grid, row, col, playerColor, room.turn);
    let winner = null;
    if (room.turn >= 2) {
      winner = checkWin(room.grid);
    }
    room.turn += 1;
    io.to(roomId).emit('state-update', {
      grid: room.grid,
      turn: room.turn,
      burstSeq: burstSeq,
      roomId: roomId,
      winner: winner,
    });
  });

  socket.on('restart-game', (roomId, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ error: 'Room not found' });
    room.nRestartRequest += 1;
    if (room.nRestartRequest < 2) return;
    room.grid = createGrid();
    room.turn = 0;
    room.isProcessing = false; // Reset processing flag
    room.nRestartRequest = 0;
    io.to(roomId).emit('game-restarted', room.grid);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [roomId, room] of Object.entries(rooms)) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      io.to(roomId).emit('player-left', room.players);
      if (room.players.length === 0) delete rooms[roomId];
    }
  });
});

const checkWin = (grid) => {
  let redCount = 0;
  let blueCount = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.color === 'R') redCount += cell.val;
      if (cell.color === 'B') blueCount += cell.val;
    }
  }
  if (redCount === 0) return 'B';
  if (blueCount === 0) return 'R';
  return null;
};


const applyMove = (grid, row, col, color, turn = 999) => {
  const trace = [];
  const q = [{ row, col }];
  if (turn < 2) {
    grid[row][col].val += 3;
  } else {
    grid[row][col].val += 1;
  }
  grid[row][col].color = color;

  let wave = 0;
  while (q.length > 0) {
    const nextQueue = [];
    trace[wave] = [];

    for (const { row, col } of q) {
      if (grid[row][col].val < 4) continue;

      // record burst
      trace[wave].push({ row, col });

      grid[row][col].val = 0;
      grid[row][col].color = 'N';

      const neighbors = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];

      for (const [r, c] of neighbors) {
        if (r >= 0 && r < 6 && c >= 0 && c < 6) {
          grid[r][c].val += 1;
          grid[r][c].color = color;
          if (grid[r][c].val >= 4) {
            nextQueue.push({ row: r, col: c });
          }
        }
      }
    }

    if (trace[wave].length > 0) wave++;
    else break;
    q.splice(0, q.length, ...nextQueue);
  }

  return trace;
};

server.listen(process.env.PORT, () => {
  console.log(`Game server started on port ${process.env.PORT}`);
});
