
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = 3000;

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app); // Create an HTTP server using your Express app
const io = new Server(server, {
    cors: {
        origin: "*", // Allows connections from any frontend (good for testing)
        methods: ["GET", "POST"]
    }
});

// Add Socket.IO Event Handler (New Code Block)
// **********************************************
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // --- CRITICAL ADDITION: Handle the 'joinRoom' event from the frontend ---
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId); // This subscribes the socket to a private channel named 'roomId'
        console.log(`User ${socket.id} joined Socket.IO channel: ${roomId}`);
    });
    // ------------------------------------------------------------------------

    // Example of a basic connection message
    socket.emit('message', { text: 'Welcome to Raja Mantri!' });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

app.use(cors({
    origin: '*', // Allow all origins for simple testing (will allow 127.0.0.1:5501)
    methods: ['GET', 'POST']
}));

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// --- 1. GLOBAL IN-MEMORY STATE ---
const state = {
    rooms: {},
    players: {},
};

// Helper function to shuffle an array (for role assignment)
const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// --- 2. API ENDPOINTS ---

/**
 * Endpoint: POST /room/create
 * Creates a new room and sets the caller as Player 1.
 * Body: { playerName: "Host Name" }
 * Response: { roomId, playerId, playerName }
 */
app.post('/room/create', (req, res) => {
    const { playerName } = req.body;
    if (!playerName) {
        return res.status(400).send({ error: "Player name is required." });
    }

    const roomId = uuidv4();
    const playerId = uuidv4();

    // Create the Player object
    state.players[playerId] = {
        playerId,
        name: playerName,
        roomId,
        role: null,
        cumulativeScore: 0,
    };

    // Create the Room object
    state.rooms[roomId] = {
        roomId,
        status: 'WAITING',
        players: [playerId], // Array of player IDs
        roles: {},
        mantriId: null,
        mantriGuess: null,
        results: null,
    };

    console.log(`Room created: ${roomId} by ${playerName}`);
    res.send({ roomId, playerId, playerName });
});

/**
 * Endpoint: POST /room/join
 * Allows a player to join an existing room.
 * Body: { roomId: "...", playerName: "Guest Name" }
 * Response: { roomId, playerId, playerName }
 */
app.post('/room/join', (req, res) => {
    const { roomId, playerName } = req.body;
    const room = state.rooms[roomId];

    if (!room) {
        return res.status(404).send({ error: "Room not found." });
    }

    if (room.players.length >= 4) {
        return res.status(403).send({ error: "Room is full (max 4 players)." });
    }

    const playerId = uuidv4();

    // Create the Player object
    state.players[playerId] = {
        playerId,
        name: playerName,
        roomId,
        role: null,
        cumulativeScore: 0,
    };

    // Add player to the Room
    room.players.push(playerId);
    const playersInRoom = room.players.map(playerId => state.players[playerId].name);
    io.to(roomId).emit('playerJoined', { 
        players: playersInRoom, 
        count: room.players.length,
        status: room.status
    });

    console.log(`${playerName} joined room ${roomId}. Players: ${room.players.length}/4`);
    res.send({ roomId, playerId, playerName });
});

/**
 * Endpoint: POST /room/assign/:roomId
 * Randomly assigns roles once the room is full.
 * Response: { success: true, status: "PLAYING" }
 */
app.post('/room/assign/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    // ... (Validation code is unchanged) ...

    if (room.players.length !== 4) {
        return res.status(403).send({ error: `Waiting for ${4 - room.players.length} more players.` });
    }
    if (room.status !== 'WAITING') {
        return res.status(400).send({ error: "Roles already assigned or game in progress." });
    }

    // 1. Prepare roles and shuffle them
    const roles = ['Raja', 'Mantri', 'Chor', 'Sipahi'];
    const shuffledRoles = shuffle([...roles]);
    
    let mantriId = null;

    // 2. Assign roles to players
    room.players.forEach((playerId, index) => {
        const role = shuffledRoles[index];
        room.roles[playerId] = role;
        state.players[playerId].role = role;

        if (role === 'Mantri') {
            mantriId = playerId;
        }
    });

    // 3. Update room state
    room.mantriId = mantriId;
    room.status = 'PLAYING';
    
    // --- CRITICAL ADDITION: Broadcast to the room that roles are assigned ---
    io.to(roomId).emit('gameUpdate', { 
        status: room.status, 
        message: "Roles have been assigned. Check your secret role!" 
    });
    // ------------------------------------------------------------------------

    console.log(`Roles assigned in room ${roomId}. Mantri ID: ${mantriId}`);
    res.send({ success: true, status: room.status });
});

/**
 * Endpoint: GET /role/me/:roomId/:playerId
 * Returns the player's assigned role.
 * Response: { role: "..." }
 */
app.get('/role/me/:roomId/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;
    const player = state.players[playerId];
    const room = state.rooms[roomId];

    if (!player || player.roomId !== roomId) {
        return res.status(404).send({ error: "Player not found in this room." });
    }
    if (!room || room.status !== 'PLAYING') {
         return res.status(400).send({ error: "Roles not yet assigned." });
    }

    // This is the private information retrieval
    res.send({ role: player.role });
});

/**
 * Endpoint: POST /guess/:roomId
 * Allows the Mantri to submit their guess for the Chor.
 * Body: { playerId: "Mantri's ID", guessedPlayerId: "ID of the person they think is Chor" }
 * Response: { success: true, message: "Guess submitted." }
 */
app.post('/guess/:roomId', (req, res) => {
    const { roomId } = req.params;
    const { playerId, guessedPlayerId } = req.body;
    const room = state.rooms[roomId];

    // ... (Validation code is unchanged) ...

    // 3. Store the Guess and Update State
    room.mantriGuess = guessedPlayerId;
    room.status = 'RESULTS'; 

    // --- CRITICAL ADDITION: Broadcast to the room that results are ready ---
    io.to(roomId).emit('gameUpdate', { 
        status: room.status, 
        message: "Mantri has guessed. Results are ready!" 
    });
    // ------------------------------------------------------------------------

    console.log(`Mantri (${state.players[playerId].name}) guessed player ID: ${guessedPlayerId}`);
    res.send({ success: true, message: "Guess submitted. Results are ready." });
});

/**
 * Endpoint: POST /room/reset/:roomId
 * Resets the room status and roles to start a new round.
 * Response: { success: true, status: "WAITING" }
 */
app.post('/room/reset/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    // ... (Validation code is unchanged) ...

    // Reset the necessary state variables for a new round
    room.status = 'WAITING'; 
    room.roles = {};
    room.mantriId = null;
    room.mantriGuess = null;
    room.results = null;

    // Also reset the role for each player object
    room.players.forEach(playerId => {
        state.players[playerId].role = null;
    });

    // --- CRITICAL ADDITION: Broadcast to the room that the game has reset ---
    io.to(roomId).emit('gameUpdate', { 
        status: room.status, 
        message: "Game has been reset! Waiting for roles to be assigned." 
    });
    // ------------------------------------------------------------------------

    console.log(`Room ${roomId} reset for a new round.`);
    res.send({ success: true, status: room.status });
});

// Score constants (Ensure this is at the top level, or include it here if you didn't before)
const SCORES = { Raja: 1000, Mantri: 800, Sipahi: 500, Chor: 0 };

/**
 * Endpoint: GET /result/:roomId
 * Reveals roles and calculates points for the round.
 * Response: { success: true, results: { playerName: { role, score } } }
 */
app.get('/result/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (!room) {
        return res.status(404).send({ error: "Room not found." });
    }
    if (room.status !== 'RESULTS') {
        return res.status(400).send({ error: "Results are not ready. Mantri must submit a guess." });
    }
    
    const results = {};
    let actualChorId = null;

    // 1. Find the actual Chor
    for (const playerId of room.players) {
        if (room.roles[playerId] === 'Chor') {
            actualChorId = playerId;
            break;
        }
    }

    const isGuessCorrect = room.mantriGuess === actualChorId;

    // 2. Calculate scores for each player
    room.players.forEach(playerId => {
        const role = room.roles[playerId];
        let score = SCORES[role]; // Start with base score

        if (role === 'Mantri') {
            // Raja only gets points if the guess is CORRECT
            score = isGuessCorrect ? SCORES.Mantri : 0;
        } 
        
        if (role === 'Chor') {
            // Chor gets the Raja's points (1000) if the guess is INCORRECT
            score = isGuessCorrect ? SCORES.Chor : SCORES.Mantri;
        }
        
        // Mantri and Sipahi scores (800 and 500) are guaranteed regardless of guess outcome.

        results[state.players[playerId].name] = {
            role: role,
            score: score
        };

        // Update cumulative score (optional)
        state.players[playerId].cumulativeScore += score;
    });

    console.log(`Room ${roomId} results calculated. Mantri was ${isGuessCorrect ? 'CORRECT' : 'INCORRECT'}.`);
    res.send({ success: true, results: results });
});

/**
 * Endpoint: GET /leaderboard/:roomId
 * Returns the cumulative scores for all players in the room, sorted high to low.
 * Response: { success: true, leaderboard: [{ name, score }] }
 */
app.get('/leaderboard/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = state.rooms[roomId];

    if (!room) {
        return res.status(404).send({ error: "Room not found." });
    }

    // 1. Map player IDs to name and score
    const leaderboard = room.players.map(playerId => {
        const player = state.players[playerId];
        return {
            name: player.name,
            score: player.cumulativeScore // Uses the score updated in /result
        };
    });

    // 2. Sort the leaderboard (highest score first)
    leaderboard.sort((a, b) => b.score - a.score);

    res.send({ success: true, leaderboard: leaderboard });
});


// --- 3. START THE SERVER --- (Modified)
server.listen(PORT, () => { // Use 'server' instead of 'app' to listen
    console.log(`Raja Mantri backend running on http://localhost:${PORT}`);
});