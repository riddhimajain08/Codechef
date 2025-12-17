// Initialize Socket.IO connection
const socket = io('http://localhost:3000'); 

// Store game state locally
let myPlayerId = null;
let currentRoomId = null;
let isHost = false; 
let myRole = null; 
let roundStatus = { current: 0, total: 0 }; 

// --- HELPER FUNCTIONS ---

function updateStatus(message) {
    document.getElementById('status').innerHTML = message;
}

function resetGameArea() {
    document.getElementById('game-info').innerHTML = '';
    document.getElementById('public-info').innerHTML = '';
}

// Function to display the round scores table
function displayRoundResults(results) {
    resetGameArea();
    document.getElementById('player-list').innerHTML = ''; // Clear player list during results

    // 1. Determine Guess Outcome Message
    let outcomeClass = results.isGuessCorrect ? 'correct-guess' : 'wrong-guess';
    let outcomeText = results.isGuessCorrect ? 'CORRECT' : 'INCORRECT';
    let outcomeMessage = `
        <h2 class="${outcomeClass}">Mantri's Guess: ${outcomeText}!</h2>
        <p>Mantri guessed **${results.mantriGuessName}**. The actual Chor was **${results.actualChorName}**.</p>
    `;
    
    // 2. Build the Score Table
    let tableHTML = `
        <h3 style="margin-top:20px;">Round ${results.round} Scores:</h3>
        <table border="1" style="width:100%; text-align:left; border-collapse: collapse;">
            <tr><th>Player</th><th>Role</th><th>Score</th></tr>
    `;

    // Convert object to array for consistent sorting/display
    const scoresArray = Object.keys(results.roundScores).map(key => results.roundScores[key]);

    scoresArray.forEach(scoreData => {
        tableHTML += `
            <tr>
                <td>${scoreData.name}</td>
                <td>${scoreData.role}</td>
                <td><strong style="color: ${scoreData.score > 0 ? 'green' : 'red'};">${scoreData.score}</strong></td>
            </tr>
        `;
    });
    tableHTML += '</table>';

    // 3. Display Outcome, Table, and Next Round Button (Host Only)
    document.getElementById('game-info').innerHTML = outcomeMessage + tableHTML;
    
    if (isHost) {
        if (roundStatus.current < roundStatus.total) {
            document.getElementById('game-info').innerHTML += `
                <button onclick="handleResetRoom()" style="margin-top: 15px; padding: 10px 20px; background-color: #28a745; color: white;">Start Next Round (${roundStatus.current + 1}/${roundStatus.total})</button>
            `;
        } else {
             document.getElementById('game-info').innerHTML += `
                <button onclick="handleResetRoom()" style="margin-top: 15px; padding: 10px 20px; background-color: #007bff; color: white;">Show Final Results & Winner</button>
            `;
        }
    }
}

// Function to fetch and display the final leaderboard and winner
async function displayFinalResults() {
    updateStatus('Calculating final scores...');
    resetGameArea();
    try {
        const response = await fetch(`http://localhost:3000/leaderboard/${currentRoomId}`);
        const data = await response.json();

        if (data.success && data.leaderboard.length > 0) {
            const winner = data.leaderboard[0];
            
            // 1. Winner Announcement
            let winnerAnnouncement = `<h1 style="color: purple; margin-bottom: 20px;">🏆 GAME OVER! WINNER: ${winner.name} 🏆</h1>`;

            // 2. Build Final Score Table
            let tableHTML = `
                <h3>FINAL LEADERBOARD</h3>
                <table border="1" style="width:100%; text-align:left; border-collapse: collapse;">
                    <tr><th>Rank</th><th>Player</th><th>Total Score</th></tr>
            `;

            data.leaderboard.forEach((player, index) => {
                let rankStyle = index === 0 ? 'font-weight: bold; color: green;' : '';
                tableHTML += `
                    <tr>
                        <td style="${rankStyle}">${index + 1}</td>
                        <td style="${rankStyle}">${player.name}</td>
                        <td style="${rankStyle}">${player.score}</td>
                    </tr>
                `;
            });
            tableHTML += '</table>';
            
            // 3. Display
            document.getElementById('game-info').innerHTML = winnerAnnouncement + tableHTML;
            document.getElementById('status').innerHTML = `Final scores calculated. ${winner.name} is the champion!`;

        } else {
            document.getElementById('game-info').innerHTML = 'Error fetching final results.';
        }
    } catch (error) {
        updateStatus('Network error while fetching final results.');
    }
}


// Fetch Candidates and display public roles (Raja/Mantri) and the guess UI for Mantri
async function fetchAndDisplayCandidates() {
    try {
        const response = await fetch(`http://localhost:3000/game/candidates/${currentRoomId}`);
        const data = await response.json();

        if (data.success) {
            // Display public roles (Raja and Mantri) to EVERYONE
            document.getElementById('public-info').innerHTML = `
                <div style="display:flex; justify-content: space-around; padding: 10px; border: 1px solid #ccc;">
                    <h3 style="color:#007bff;">👑 Raja: ${data.rajaName}</h3>
                    <h3 style="color:teal;">👑 Mantri: ${data.mantriName}</h3>
                </div>
            `;
            
            // Only Mantri sees the guessing buttons
            if (myRole === 'Mantri') {
                let guessButtonsHTML = '<h3 style="margin-top: 20px;">Who is the Chor? (Choose one)</h3>';
                
                data.candidates.forEach(player => {
                    guessButtonsHTML += `
                        <button 
                            class="guess-button" 
                            onclick="handleGuess('${player.id}')"
                            style="margin-right: 10px; padding: 10px 15px; background-color: #f0ad4e; color: white; border: none; cursor: pointer;"
                        >
                            Guess ${player.name}
                        </button>
                    `;
                });

                document.getElementById('game-info').innerHTML += guessButtonsHTML;
            }
        }
    } catch (error) {
        updateStatus("Failed to fetch player candidates for guessing.");
    }
}

// Primary function to fetch the player's private role
async function fetchAndDisplayRole() {
    try {
        updateStatus(`Round ${roundStatus.current}/${roundStatus.total}: Fetching your secret role...`);
        resetGameArea(); // Clear previous round messages/buttons
        document.getElementById('player-list').innerHTML = ''; // Clear player list after roles are assigned

        const response = await fetch(`http://localhost:3000/role/me/${currentRoomId}/${myPlayerId}`);
        const data = await response.json();

        if (data.role) {
            myRole = data.role; // Store the role
            
            // Display the role prominently
            document.getElementById('game-info').innerHTML = `
                <h2 class="role-title">Your Secret Role:</h2>
                <h1 class="role-name" style="color: ${myRole === 'Raja' ? '#FFD700' : myRole === 'Mantri' ? '#008080' : myRole === 'Chor' ? '#DC3545' : '#28A745'}; font-size: 2.5em; text-transform: uppercase;">${myRole}</h1>
            `;

            await fetchAndDisplayCandidates(); // Fetch public roles and build Mantri UI

            updateStatus(`Roles Assigned. You are the ${myRole}!`);
        } else {
            updateStatus(`Error fetching role: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        updateStatus('Failed to connect to the server to get role.');
    }
}

// Mantri Guess Handler
async function handleGuess(guessedPlayerId) {
    updateStatus('Submitting guess...');
    // Hide buttons after clicking
    document.getElementById('game-info').innerHTML = '<p>Guess submitted. Waiting for results...</p>';
    
    try {
        const response = await fetch(`http://localhost:3000/guess/${currentRoomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: myPlayerId, guessedPlayerId: guessedPlayerId })
        });
        const data = await response.json();

        if (!data.success) {
            updateStatus(`Guess failed: ${data.error}`);
        }
    } catch (error) {
        updateStatus('Network error while submitting guess.');
    }
}

// Host-only button to reset the room and start the next round
async function handleResetRoom() {
    if (!currentRoomId || !isHost) return updateStatus('Error: Only the host can manage the game flow.');
    
    try {
        const response = await fetch(`http://localhost:3000/room/reset/${currentRoomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.status === 'FINISHED') {
            displayFinalResults(); // Trigger final results display
        }
        // No need for 'WAITING' check, the socket.on('playerJoined') handles the refresh.

    } catch (error) {
        updateStatus('Network error while resetting room.');
    }
}


// --- ROOM/LOBBY HANDLERS ---

async function handleCreateRoom() {
    const playerName = document.getElementById('create-name').value;
    const roundsInput = prompt("Enter the total number of rounds you want to play (e.g., 3):", "3");
    const totalRounds = parseInt(roundsInput);

    if (!playerName) return updateStatus('Please enter your name to create a room.');
    if (isNaN(totalRounds) || totalRounds < 1) return updateStatus('Invalid number of rounds. Please enter a number greater than 0.');

    try {
        const response = await fetch('http://localhost:3000/room/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, totalRounds }) 
        });
        const data = await response.json();

        if (data.roomId) {
            currentRoomId = data.roomId;
            myPlayerId = data.playerId;
            isHost = true;
            roundStatus.total = totalRounds;
            roundStatus.current = 1; // Set current round on host side
            
            socket.emit('joinRoom', currentRoomId); 

            document.getElementById('room-controls').innerHTML = `
                <h2>Room Created!</h2>
                <p>Share this Room ID: <strong>${currentRoomId}</strong></p>
            `;
            updateStatus(`Room created for ${totalRounds} rounds. Waiting for 3 more players...`);
        } else {
            updateStatus('Error creating room: ' + (data.error || 'Unknown error.'));
        }
    } catch (error) {
        updateStatus('Network error while creating room.');
    }
}

async function handleJoinRoom() {
    const roomId = document.getElementById('join-room-id').value;
    const playerName = document.getElementById('join-name').value;
    
    if (!roomId || !playerName) return updateStatus('Please enter both Room ID and your Name to join.');

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
            isHost = false;
            
            socket.emit('joinRoom', currentRoomId); 
            
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

async function handleAssignRoles() {
    if (!currentRoomId) return updateStatus('Error: Not currently in a room.');

    try {
        const response = await fetch(`http://localhost:3000/room/assign/${currentRoomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.success) {
            document.getElementById('game-info').innerHTML = ''; // Hide the button
        } else {
            updateStatus('Error assigning roles: ' + (data.error || 'Room not found.'));
        }
    } catch (error) {
        updateStatus('Network error while assigning roles.');
    }
}


// --- SOCKET.IO LISTENERS ---

socket.on('playerJoined', (data) => {
    // This runs when a player joins OR when the host resets the room (status = WAITING)
    let playerListHTML = `<h3>Players in Room (${data.count}/4) - Round ${data.currentRound || 1}/${data.totalRounds || '?'}</h3><ul>`;
    data.players.forEach(name => {
        playerListHTML += `<li>${name}</li>`;
    });
    playerListHTML += '</ul>';
    document.getElementById('player-list').innerHTML = playerListHTML;
    
    // Update global round status variables
    roundStatus.current = data.currentRound || 1;
    roundStatus.total = data.totalRounds || '?';
    
    if (data.status === 'WAITING') {
        resetGameArea();
        if (data.count === 4 && isHost) {
            document.getElementById('status').innerText = `Round ${roundStatus.current}/${roundStatus.total} is ready! Click Assign Roles.`;
            document.getElementById('game-info').innerHTML = `
                <button onclick="handleAssignRoles()" style="padding: 10px 20px; background-color: #28a745; color: white; border: none; cursor: pointer;">Assign Roles</button>
            `;
        } else if (data.count < 4) {
             document.getElementById('status').innerText = `Waiting for ${4 - data.count} more players...`;
        }
    }
});

socket.on('gameUpdate', (data) => {
    // Roles Assigned
    if (data.status === 'PLAYING') {
        fetchAndDisplayRole(); 
    } 
    // Results are ready (Mantri has guessed)
    else if (data.status === 'RESULTS' && data.roundResults) {
        displayRoundResults(data.roundResults); 
    }
    // Game is finished (Host has clicked final button)
    else if (data.status === 'FINISHED') {
        displayFinalResults();
    }
});
