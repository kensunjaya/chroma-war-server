// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});



app.use(cors({
  origin: 'http://localhost:3000', // or your frontend port
  methods: ['GET', 'POST']
}));

// In-memory game rooms
const rooms = {}; // { roomId: { grid: Cell[][], players: [], turn: 'R' | 'B' } }

// Helper to create an empty 6x6 grid
const createGrid = () => {
  return Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () => ({ val: 0, color: 'N' }))
  );
};

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('create-room', (_, callback) => {
    const roomId = randomUUID();
    rooms[roomId] = {
      grid: createGrid(),
      players: [socket.id],
      turn: 'R'
    };
    socket.join(roomId);
    callback(roomId);
  });

  socket.on('join-room', (roomId, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ error: 'Room not found' });
    if (room.players.length >= 2) return callback({ error: 'Room full' });

    room.players.push(socket.id);
    socket.join(roomId);
    callback({ success: true, grid: room.grid });

    io.to(roomId).emit('player-joined', room.players);
  });

  socket.on('make-move', ({ roomId, row, col }) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerColor = room.players.indexOf(socket.id) === 0 ? 'R' : 'B';
    if (room.turn !== playerColor) return;

    const cell = room.grid[row][col];
    if ((cell.color !== playerColor && !(cell.color === 'N' && cell.val === 0)) || cell.val >= 4) return;

    applyMove(room.grid, row, col, playerColor);
    room.turn = playerColor === 'R' ? 'B' : 'R';

    io.to(roomId).emit('state-update', {
      grid: room.grid,
      turn: room.turn
    });
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [roomId, room] of Object.entries(rooms)) {
      room.players = room.players.filter(p => p !== socket.id);
      if (room.players.length === 0) delete rooms[roomId];
    }
  });
});

// Recursive chain reaction logic
function applyMove(grid, row, col, color) {
  if (!grid[row] || !grid[row][col]) return;

  const cell = grid[row][col];
  if (cell.val >= 4) return;

  cell.val++;
  cell.color = color;

  if (cell.val >= 4) {
    cell.val = 0;
    cell.color = 'N';
    const dirs = [
      [0, 1], [1, 0], [0, -1], [-1, 0]
    ];
    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (grid[nr]?.[nc]) applyMove(grid, nr, nc, color);
    }
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Game server listening on port ${PORT}`);
});
