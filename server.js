const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// Enable CORS for both Express and Socket.io
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`CLIENT CONNECTED: ${socket.id}`); // Use backticks for template literals

    socket.on('joinRoom', (roomId) => {
        console.log(`Player ${socket.id} joined room: ${roomId}`);
        socket.join(roomId);
    });

    socket.on('disconnect', () => {
        console.log(`CLIENT DISCONNECTED: ${socket.id}`);
    });
});

// --- 1. GLOBAL IN-MEMORY STATE ---
const state = { rooms: {}, players: {} };

const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// Score constants
const SCORES = { Raja: 1000, Mantri: 800, Sipahi: 500, Chor: 0 };


// --- 2. API ENDPOINTS ---
app.post('/room/create', (req, res) => {
    const { playerName, totalRounds } = req.body;
    if (!playerName) return res.status(400).send({ error: "Player name is required." });

    const roomId = uuidv4();
    const playerId = uuidv4();

    state.players[playerId] = { playerId, name: playerName, roomId, role: null, cumulativeScore: 0, isHost: true }; // Added isHost
    state.rooms[roomId] = {
        roomId, status: 'WAITING', players: [playerId], roles: {}, mantriId: null, mantriGuess: null, results: null,
        currentRound: 1, totalRounds: parseInt(totalRounds) || 3,
    };
    console.log(`Room Created: ${roomId} by ${playerName}`);
    res.send({ roomId, playerId, playerName });
});

app.post('/room/join', (req, res) => {
    const { roomId, playerName } = req.body;
    const room = state.rooms[roomId];

    if (!room) return res.status(404).send({ error: "Room not found." });
    if (room.players.length >= 4) return res.status(403).send({ error: "Room is full (max 4 players)." });

    const playerId = uuidv4();
    state.players[playerId] = { playerId, name: playerName, roomId, role: null, cumulativeScore: 0, isHost: false }; // Added isHost
    room.players.push(playerId);

    console.log(`${playerName} joined room ${roomId}`);
    
    const playersInRoom = room.players.map(pid => state.players[pid].name);
    io.to(roomId).emit('playerJoined', { 
        players: playersInRoom, count: room.players.length, status: room.status, 
        currentRound: room.currentRound, totalRounds: room.totalRounds
    });

    res.send({ roomId, playerId, playerName });
});

app.post('/room/assign/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (room.players.length !== 4) return res.status(403).send({ error: `Waiting for ${4 - room.players.length} more players.` });
    if (room.status !== 'WAITING') return res.status(400).send({ error: "Roles already assigned or game in progress." });

    const roles = ['Raja', 'Mantri', 'Chor', 'Sipahi'];
    const shuffledRoles = shuffle([...roles]);
    let mantriId = null;

    room.players.forEach((playerId, index) => {
        const role = shuffledRoles[index];
        state.players[playerId].role = role;
        if (role === 'Mantri') mantriId = playerId;
    });

    room.mantriId = mantriId;
    room.status = 'PLAYING';
    
    io.to(roomId).emit('gameUpdate', { 
        status: room.status, 
        message: `Round ${room.currentRound}/${room.totalRounds}: Roles have been assigned. Check your secret role!` 
    });
    res.send({ success: true, status: room.status });
});

app.get('/role/me/:roomId/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;
    const player = state.players[playerId];
    const room = state.rooms[roomId];

    if (!player || player.roomId !== roomId) return res.status(404).send({ error: "Player not found in this room." });
    if (!room || room.status !== 'PLAYING') return res.status(400).send({ error: "Roles not yet assigned." });
    res.send({ role: player.role });
});

app.get('/game/candidates/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (!room || room.status !== 'PLAYING') return res.status(400).send({ error: "Game is not in the active guessing phase." });

    const candidates = room.players
        .filter(playerId => {
            const role = state.players[playerId].role;
            return role !== 'Raja' && role !== 'Mantri';
        })
        .map(playerId => ({ id: playerId, name: state.players[playerId].name }));

    const raja = state.players[room.players.find(id => state.players[id].role === 'Raja')].name;
    const mantri = state.players[room.players.find(id => state.players[id].role === 'Mantri')].name;

    res.send({ success: true, candidates, rajaName: raja, mantriName: mantri });
});

app.post('/guess/:roomId', (req, res) => {
    const { roomId } = req.params;
    const { playerId, guessedPlayerId } = req.body;
    const room = state.rooms[roomId];

    if (room.mantriId !== playerId) return res.status(403).send({ error: "Only the Mantri can submit a guess." });
    
    console.log(`Mantri in ${roomId} guessed player: ${guessedPlayerId}`);

    room.mantriGuess = guessedPlayerId;
    room.status = 'RESULTS'; 
    
    const results = {};
    let actualChorId = null;
    for (const pid of room.players) {
        if (state.players[pid].role === 'Chor') {
            actualChorId = pid;
            break;
        }
    }
    const isGuessCorrect = room.mantriGuess === actualChorId;
    
    room.players.forEach(pid => {
        const role = state.players[pid].role;
        let score = SCORES[role];

        if (role === 'Raja') score = isGuessCorrect ? SCORES.Raja : 1000;
        if (role === 'Mantri') score = isGuessCorrect ? SCORES.Mantri : 0;
        if (role === 'Chor') score = isGuessCorrect ? SCORES.Chor : SCORES.Mantri;
        if (role === 'Sipahi') score = isGuessCorrect ? SCORES.Sipahi : SCORES.Sipahi; // Sipahi always gets points

        results[state.players[pid].name] = {
            role: role,
            score: score,
        };
        state.players[pid].cumulativeScore += score;
    });

    room.results = {
        round: room.currentRound,
        roundScores: results,
        isGuessCorrect: isGuessCorrect,
        mantriGuessName: state.players[room.mantriGuess].name,
        actualChorName: state.players[actualChorId].name
    };

    io.to(roomId).emit('gameUpdate', { 
        status: room.status, 
        message: `Round ${room.currentRound} Results Ready!`,
        roundResults: room.results
    });

    res.send({ success: true, message: "Guess submitted. Results are ready." });
});

// The /result endpoint is now mostly for fetching the calculated results (optional but kept for robustness)
app.get('/result/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (!room || room.status !== 'RESULTS' || !room.results) return res.status(400).send({ error: "Results are not ready or game state is invalid." });
    res.send({ success: true, results: room.results });
});


app.post('/room/reset/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];
    
    if (!room) return res.status(404).send({ error: "Room not found." });

    if (room.currentRound >= room.totalRounds) {
        room.status = 'FINISHED';
        io.to(roomId).emit('gameUpdate', { status: room.status, message: "GAME OVER! Final scores are ready." });
        return res.send({ success: true, status: room.status });
    }

    room.currentRound += 1;
    room.status = 'WAITING'; 
    room.mantriId = null;
    room.mantriGuess = null;
    room.results = null;

    room.players.forEach(pid => {
        state.players[pid].role = null;
    });

    const playersInRoom = room.players.map(pid => state.players[pid].name);
    io.to(roomId).emit('playerJoined', { // Use playerJoined to refresh status/player list
        players: playersInRoom, count: room.players.length, status: room.status, 
        currentRound: room.currentRound, totalRounds: room.totalRounds
    });

    res.send({ success: true, status: room.status });
});

app.get('/leaderboard/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (!room) return res.status(404).send({ error: "Room not found." });

    const leaderboard = room.players.map(pid => ({
        name: state.players[pid].name,
        score: state.players[pid].cumulativeScore,
        isHost: state.players[pid].isHost // Send host status too
    }));

    leaderboard.sort((a, b) => b.score - a.score);

    res.send({ success: true, leaderboard: leaderboard });
});

// --- 3. START THE SERVER ---
const DEPLOYMENT_PORT = process.env.PORT || PORT;
server.listen(DEPLOYMENT_PORT, () => { 
    console.log(`Raja Mantri backend running on http://localhost:${DEPLOYMENT_PORT}`);
});
