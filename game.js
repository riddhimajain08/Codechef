// Initialize Socket.IO connection
const socket = io('http://localhost:3000'); // Connect to your backend server

// Store game state locally
let myPlayerId = null;
let currentRoomId = null;

// Handle the initial welcome message from the server
socket.on('message', (data) => {
    console.log('Server Message:', data.text);
    document.getElementById('status').innerText = data.text;
});

// Handle the real-time update when another player joins
socket.on('playerJoined', (data) => {
    let playerListHTML = '<h3>Players in Room (' + data.count + '/4)</h3><ul>';
    data.players.forEach(name => {
        playerListHTML += `<li>${name}</li>`;
    });
    playerListHTML += '</ul>';
    document.getElementById('player-list').innerHTML = playerListHTML;

    if (data.count === 4 && data.status === 'WAITING') {
        document.getElementById('status').innerText = "Room is full! Ready to assign roles.";

        document.getElementById('game-info').innerHTML = `
            <button onclick="handleAssignRoles()">Assign Roles</button>
        `;
        // ----------------------------------------------------
    } else if (data.count < 4) {
         // Clear the button if it's not full
         document.getElementById('game-info').innerHTML = '';
        // Show a button to assign roles
    }

    
});

// ... (Rest of the game logic will go here)

function updateStatus(message) {
    document.getElementById('status').innerText = message;
}
// --- Example: Create Room Function ---
async function handleCreateRoom() {
    const playerName = document.getElementById('create-name').value;
    if (!playerName) {
        return updateStatus('Please enter your name to create a room.');
    }

    try {
        const response = await fetch('http://localhost:3000/room/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName })
        });
        const data = await response.json();

        if (data.roomId) {
            currentRoomId = data.roomId;
            myPlayerId = data.playerId;
            
            // Tell Socket.IO to join the room's channel
            socket.emit('joinRoom', currentRoomId); 

            // Update UI to show room ID and hide controls
            document.getElementById('room-controls').innerHTML = `
                <h2>Room Created!</h2>
                <p>Share this Room ID: <strong>${currentRoomId}</strong></p>
            `;
            updateStatus(`Room created. You are ${playerName}. Waiting for 3 more players...`);
        } else {
            updateStatus('Error creating room: ' + (data.error || 'Unknown error.'));
        }
    } catch (error) {
        updateStatus('Network error while creating room.');
    }
}
// You need a function to call this when a button is clicked!

async function handleJoinRoom() {
    const roomId = document.getElementById('join-room-id').value;
    const playerName = document.getElementById('join-name').value;
    
    if (!roomId || !playerName) {
        return updateStatus('Please enter both Room ID and your Name to join.');
    }

    try {
        const response = await fetch('http://localhost:3000/room/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, playerName })
        });
        const data = await response.json();

        if (data.roomId) {
            currentRoomId = data.roomId;
            myPlayerId = data.playerId;

            // Tell Socket.IO to join the room's channel
            socket.emit('joinRoom', currentRoomId); 
            
            // Update UI
            document.getElementById('room-controls').innerHTML = `
                <h2>Joined Room!</h2>
                <p>Room ID: <strong>${currentRoomId}</strong></p>
            `;
            updateStatus(`You joined the room! Waiting for role assignment...`);
        } else {
            updateStatus('Error joining room: ' + (data.error || 'Room is full or does not exist.'));
        }
    } catch (error) {
        updateStatus('Network error while joining room.');
    }
}

// --- 3. HANDLE ASSIGN ROLES ---
async function handleAssignRoles() {
    if (!currentRoomId) {
        return updateStatus('Error: Not currently in a room.');
    }

    try {
        const response = await fetch(`http://localhost:3000/room/assign/${currentRoomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.success) {
            updateStatus('Roles have been assigned! Check your secret role.');
            document.getElementById('game-info').innerHTML = ''; // Hide the button
            
            // NOTE: We don't need to check the role here. The next step (Step 3) will do that.

        } else {
            updateStatus('Error assigning roles: ' + (data.error || 'Room not found.'));
        }
    } catch (error) {
        updateStatus('Network error while assigning roles.');
    }
}