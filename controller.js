// ==================== CONTROLLER FOR MOTION DINO ====================
// This runs on the phone and sends motion data to the game via WebRTC

// Get room ID from URL hash (preferred) or query parameter (fallback)
const urlParams = new URLSearchParams(window.location.search);
let roomId = window.location.hash.slice(1) || urlParams.get('room');

// DOM Elements
const permissionScreen = document.getElementById('permissionScreen');
const connectingScreen = document.getElementById('connectingScreen');
const connectedScreen = document.getElementById('connectedScreen');
const noRoomScreen = document.getElementById('noRoomScreen');
const enableMotionBtn = document.getElementById('enableMotionBtn');
const errorMessage = document.getElementById('errorMessage');
const jumpIndicator = document.getElementById('jumpIndicator');
const deviationValue = document.getElementById('deviationValue');
const connectingRoom = document.getElementById('connectingRoom');
const instructions = document.getElementById('instructions');

// State
let peer = null;
let connection = null;
let isConnected = false;

// Adaptive baseline detection
let baseline = 0;
let baselineBuffer = [];
let baselineSum = 0;
let isCalibrating = true;
let calibrationSamples = 0;
const CONFIG = {
    baselineWindowSize: 30,
    baselineUpdateRate: 0.05,
    jumpDeviationThreshold: 4,
    orientationChangeThreshold: 5
};

// ==================== SCREEN MANAGEMENT ====================
function showScreen(screenId) {
    [permissionScreen, connectingScreen, connectedScreen, noRoomScreen].forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

// ==================== BASELINE DETECTION ====================
function updateBaseline(zValue) {
    if (baselineBuffer.length >= CONFIG.baselineWindowSize) {
        baselineSum -= baselineBuffer.shift();
    }

    baselineBuffer.push(zValue);
    baselineSum += zValue;

    if (isCalibrating) {
        calibrationSamples++;
        if (calibrationSamples >= CONFIG.baselineWindowSize) {
            baseline = baselineSum / baselineBuffer.length;
            isCalibrating = false;
        }
        return;
    }

    const currentAvg = baselineSum / baselineBuffer.length;
    const baselineShift = Math.abs(currentAvg - baseline);

    if (baselineShift > CONFIG.orientationChangeThreshold) {
        baseline = currentAvg;
        return;
    }

    baseline += (currentAvg - baseline) * CONFIG.baselineUpdateRate;
}

function getDeviation(zValue) {
    return zValue - baseline;
}

// ==================== MOTION HANDLING ====================
function handleMotion(event) {
    if (!isConnected) return;

    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.z === null) return;

    const zValue = acc.z;
    updateBaseline(zValue);
    const deviation = isCalibrating ? 0 : getDeviation(zValue);

    // Update display
    if (deviationValue) {
        deviationValue.textContent = isCalibrating ? '...' :
            (deviation >= 0 ? '+' : '') + deviation.toFixed(1);
    }

    // Visual feedback for jump
    if (Math.abs(deviation) > CONFIG.jumpDeviationThreshold) {
        jumpIndicator.classList.add('active');
        setTimeout(() => jumpIndicator.classList.remove('active'), 100);
    }

    // Send data to game
    if (connection && connection.open) {
        connection.send({
            type: 'motion',
            z: zValue,
            deviation: deviation,
            isCalibrating: isCalibrating
        });
    }
}

// ==================== PERMISSION REQUEST ====================
async function requestMotionPermission() {
    // iOS 13+ requires explicit permission request
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Motion permission denied');
        }
        return true;
    }
    // Android/others - permission granted automatically
    return true;
}

// ==================== PEERJS CONNECTION ====================
function connectToGame() {
    showScreen('connectingScreen');
    connectingRoom.textContent = roomId;

    peer = new Peer();

    peer.on('open', () => {
        connection = peer.connect(roomId, { reliable: true });

        connection.on('open', () => {
            isConnected = true;
            showScreen('connectedScreen');
            instructions.classList.add('hidden');

            // Start listening for motion events
            window.addEventListener('devicemotion', handleMotion);

            // Heartbeat
            setInterval(() => {
                if (connection && connection.open) {
                    connection.send({ type: 'heartbeat' });
                }
            }, 1000);
        });

        connection.on('close', () => {
            isConnected = false;
            showError('Connection lost. Refresh to retry.');
        });

        connection.on('error', (err) => {
            showError('Connection error: ' + err.message);
        });
    });

    peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
            showError('Game not found. Is the game open on your PC?');
        } else {
            showError('Connection error: ' + err.type);
        }
    });
}

function showError(message) {
    showScreen('permissionScreen');
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

// ==================== INITIALIZATION ====================
function init() {
    // Enable motion button
    enableMotionBtn.addEventListener('click', async () => {
        enableMotionBtn.disabled = true;
        enableMotionBtn.innerHTML = '<span>⏳</span> Connecting...';

        try {
            await requestMotionPermission();
            connectToGame();
        } catch (e) {
            showError(e.message);
            enableMotionBtn.disabled = false;
            enableMotionBtn.innerHTML = '<span>🚀</span> Enable Motion';
        }
    });

    // Manual connect button
    const manualConnectBtn = document.getElementById('manualConnectBtn');
    const manualRoomInput = document.getElementById('manualRoomCode');

    if (manualConnectBtn) {
        manualConnectBtn.addEventListener('click', async () => {
            const code = manualRoomInput.value.trim().toUpperCase();
            if (code) {
                roomId = code;
                manualConnectBtn.disabled = true;
                try {
                    await requestMotionPermission();
                    connectToGame();
                } catch (e) {
                    showError(e.message);
                    manualConnectBtn.disabled = false;
                }
            }
        });
    }

    // Show appropriate initial screen
    if (!roomId) {
        showScreen('noRoomScreen');
    } else {
        showScreen('permissionScreen');
    }
}

init();
