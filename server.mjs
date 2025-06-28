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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: 'https://chroma-war.vercel.app',
  methods: ['GET', 'POST']
}));


const rooms = {};

const createGrid = () => {
  return Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () => ({ val: 0, color: 'white' }))
  );
};

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.emit('rooms-list', Object.keys(rooms));

  socket.on('create-room', (_, callback) => {
    if (Object.values(rooms).some(room => room.players.includes(socket.id))) {
      return callback({ error: 'You already have a room' });
    }
    const roomId = randomUUID();
    rooms[roomId] = {
      grid: createGrid(),
      players: [socket.id],
      nRestartRequest: 0,
      turn: 0,
      isProcessing: false // Flag to indicate if the room is processing a move
    };
    socket.join(roomId);
    console.log(`Room created: ${roomId} by ${socket.id}`);
    io.to(roomId).emit('room-created', roomId);
    callback(roomId);
  });

  socket.on('get-rooms', () => {
    socket.emit('rooms-list', Object.keys(rooms));
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

  socket.on('join-room', (roomId, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ error: 'Room not found' });
    if (room.players.length >= 2) return callback({ error: 'Room full' });

    room.players.push(socket.id);
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
    if (room.isProcessing) return;

    const playerColor = room.players.indexOf(socket.id) === 0 ? 'blue-400' : 'red-400';
    const currentTurn = room.turn % 2 === 0 ? 'blue-400' : 'red-400';
    if (currentTurn !== playerColor) return;

    const cell = room.grid[row][col];
    if ((cell.color !== playerColor && !(cell.color === 'white' && cell.val === 0)) || cell.val >= 4) {
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
      room.players = room.players.filter(p => p !== socket.id);
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
      if (cell.color === 'red-400') redCount += cell.val;
      if (cell.color === 'blue-400') blueCount += cell.val;
    }
  }
  if (redCount === 0) return 'blue-400';
  if (blueCount === 0) return 'red-400';
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
      grid[row][col].color = 'white';

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


const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Game server listening on port ${PORT}`);
});
