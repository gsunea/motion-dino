// ==================== GAME CONFIGURATION ====================
const CONFIG = {
    // Physics
    gravity: 0.6,
    jumpForce: -15,
    groundY: 0.8, // 80% from top

    // Dino
    dinoWidth: 44,
    dinoHeight: 47,
    dinoX: 50,

    // Obstacles - Smart placement
    minObstacleGap: 300,
    maxObstacleGap: 600,
    obstacleSpeed: 6,
    maxSpeed: 14,
    speedIncrement: 0.001,
    jumpDurationFrames: 50,

    // Jump Detection (from phone)
    jumpDeviationThreshold: 4,
    jumpCooldown: 400,
    baselineWindowSize: 30,
    baselineUpdateRate: 0.05,
    orientationChangeThreshold: 5,

    // Sensor Graph
    graphHistorySize: 100,
    graphMaxValue: 15,

    // Visual
    groundLineHeight: 2,
    cloudCount: 3,
};

// ==================== GAME STATE ====================
let gameState = {
    isPlaying: false,
    isGameOver: false,
    hasStarted: false,
    score: 0,
    highScore: parseInt(localStorage.getItem('dinoHighScore')) || 0,
    speed: CONFIG.obstacleSpeed,
    jumpCount: 0,

    useMotion: true,

    lastJumpTime: 0,
    canJump: true,

    gameOverTime: 0,
    restartDelay: 1000,
};

// ==================== GAME OBJECTS ====================
let dino = {
    x: CONFIG.dinoX,
    y: 0,
    vy: 0,
    width: CONFIG.dinoWidth,
    height: CONFIG.dinoHeight,
    isJumping: false,
    isDucking: false,
    frameIndex: 0,
    frameTimer: 0,
};

let obstacles = [];
let clouds = [];
let groundOffset = 0;

// ==================== CANVAS SETUP ====================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    dino.y = canvas.height * CONFIG.groundY - dino.height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ==================== AUDIO SYSTEM ====================
let audioCtx = null;
let lastFootstepTime = 0;
const FOOTSTEP_INTERVAL = 180;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playJumpSound() {
    if (!audioCtx) initAudio();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
}

function playFootstepSound() {
    if (!audioCtx) initAudio();

    const now = performance.now();
    if (now - lastFootstepTime < FOOTSTEP_INTERVAL) return;
    lastFootstepTime = now;

    const bufferSize = audioCtx.sampleRate * 0.03;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800 + Math.random() * 400;
    filter.Q.value = 1;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    noise.start(audioCtx.currentTime);
    noise.stop(audioCtx.currentTime + 0.05);
}

function playGameOverSound() {
    if (!audioCtx) initAudio();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
}

// ==================== PEERJS CONNECTION ====================
let peer = null;
let connection = null;
let roomId = null;

// Baseline detection (receives processed data from phone)
let sensorZ = 0;
let currentDeviation = 0;
let isCalibrating = true;

// For local baseline (backup if phone doesn't send deviation)
let baseline = 0;
let baselineBuffer = [];
let baselineSum = 0;
let deviationHistory = [];
let deviationIndex = 0;

// Performance: Cache DOM elements
let sensorValueElement = null;

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'DINO-';
    for (let i = 0; i < 4; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

function initPeerConnection() {
    roomId = generateRoomId();

    // Display room code
    document.getElementById('roomCode').textContent = roomId;

    // Build controller URL (works for both local and deployed)
    const basePath = window.location.pathname.replace(/\/[^\/]*$/, '/');
    const controllerUrl = `${window.location.origin}${basePath}controller.html#${roomId}`;
    document.getElementById('controllerUrl').textContent = controllerUrl;

    // Generate QR code with qrcodejs library
    const qrContainer = document.getElementById('qrCode');
    const qrLoading = document.getElementById('qrLoading');

    try {
        if (typeof QRCode !== 'undefined') {
            // Clear any existing QR code
            qrContainer.innerHTML = '';

            // Create QR code (qrcodejs API)
            new QRCode(qrContainer, {
                text: controllerUrl,
                width: 180,
                height: 180,
                colorDark: '#1a1a2e',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });

            qrLoading.classList.add('hidden');
        } else {
            console.error('QRCode library not loaded');
            qrLoading.textContent = 'Use URL below';
        }
    } catch (e) {
        console.error('QR Code error:', e);
        qrLoading.textContent = 'Use URL below';
    }

    // Create peer with the room ID (so phone can connect to it)
    try {
        peer = new Peer(roomId);

        peer.on('open', (id) => {
            console.log('Game peer ready, ID:', id);
            updateStatus('waiting', 'Waiting for phone...');
        });

        peer.on('connection', (conn) => {
            console.log('Phone connected!');
            connection = conn;

            conn.on('open', () => {
                updateStatus('connected', 'Phone connected!');
                setTimeout(() => {
                    startGame();
                }, 500);
            });

            conn.on('data', (data) => {
                handleMotionData(data);
            });

            conn.on('close', () => {
                console.log('Phone disconnected');
                updateStatus('error', 'Phone disconnected');
            });
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (err.type === 'unavailable-id') {
                // Room ID already taken, regenerate
                roomId = generateRoomId();
                document.getElementById('roomCode').textContent = roomId;
                initPeerConnection();
            } else {
                updateStatus('error', 'Connection error: ' + err.type);
            }
        });
    } catch (e) {
        console.error('Failed to create peer:', e);
        updateStatus('error', 'PeerJS failed to load');
    }
}

function handleMotionData(data) {
    if (data.type === 'motion') {
        sensorZ = data.z;
        isCalibrating = data.isCalibrating;

        // Use deviation from phone (already calculated with adaptive baseline)
        currentDeviation = data.deviation;

        // Update display
        if (sensorValueElement) {
            sensorValueElement.textContent = isCalibrating ? '...' :
                (currentDeviation >= 0 ? '+' : '') + currentDeviation.toFixed(1);
        }

        // Update graph
        updateSensorGraph(sensorZ, currentDeviation);

        // Detect jump
        detectJump(currentDeviation);
    }
}

function detectJump(deviation) {
    if (isCalibrating) return;

    const now = Date.now();

    if (Math.abs(deviation) > CONFIG.jumpDeviationThreshold &&
        now - gameState.lastJumpTime > CONFIG.jumpCooldown) {

        triggerJump();
        triggerJumpFlash();
        gameState.lastJumpTime = now;
    }
}

function updateStatus(state, message) {
    const indicator = document.getElementById('statusIndicator');
    const text = indicator.querySelector('.status-text');

    indicator.className = 'status-indicator ' + state;
    text.textContent = message;
}

// ==================== SENSOR GRAPH ====================
const sensorGraphCanvas = document.getElementById('sensorGraph');
const sensorGraphCtx = sensorGraphCanvas.getContext('2d');
let sensorHistory = [];
let jumpFlashTimer = 0;
let lastGraphRenderTime = 0;
const GRAPH_RENDER_INTERVAL = 33;

function initSensorGraph() {
    deviationHistory = new Array(CONFIG.graphHistorySize).fill(0);
    sensorHistory = new Array(CONFIG.graphHistorySize).fill(0);
    deviationIndex = 0;
    sensorValueElement = document.getElementById('sensorZValue');
}

function updateSensorGraph(zValue, deviation) {
    deviationHistory[deviationIndex] = deviation;
    sensorHistory[deviationIndex] = zValue;
    deviationIndex = (deviationIndex + 1) % CONFIG.graphHistorySize;

    const now = performance.now();
    if (now - lastGraphRenderTime >= GRAPH_RENDER_INTERVAL) {
        lastGraphRenderTime = now;
        renderSensorGraph();
    }
}

function renderSensorGraph() {
    const canvas = sensorGraphCanvas;
    const ctx = sensorGraphCtx;
    const width = canvas.width;
    const height = canvas.height;
    const maxVal = CONFIG.graphMaxValue;
    const threshold = CONFIG.jumpDeviationThreshold;
    const centerY = height / 2;
    const halfHeight = height / 2;
    const len = deviationHistory.length;

    ctx.fillStyle = 'rgba(247, 247, 247, 0.9)';
    ctx.fillRect(0, 0, width, height);

    const thresholdY1 = centerY - (threshold / maxVal) * halfHeight;
    const thresholdY2 = centerY + (threshold / maxVal) * halfHeight;

    ctx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, thresholdY1);
    ctx.lineTo(width, thresholdY1);
    ctx.moveTo(0, thresholdY2);
    ctx.lineTo(width, thresholdY2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(83, 83, 83, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    ctx.strokeStyle = '#535353';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const xStep = width / (len - 1);
    for (let i = 0; i < len; i++) {
        const bufferIndex = (deviationIndex + i) % len;
        const x = i * xStep;
        const normalizedValue = deviationHistory[bufferIndex] / maxVal;
        const y = Math.max(2, Math.min(height - 2, centerY - normalizedValue * halfHeight));

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    if (jumpFlashTimer > 0) {
        ctx.fillStyle = `rgba(233, 69, 96, ${jumpFlashTimer * 0.3})`;
        ctx.fillRect(0, 0, width, height);
        jumpFlashTimer -= 0.1;
    }

    const lastIndex = (deviationIndex + len - 1) % len;
    const lastDeviation = deviationHistory[lastIndex];
    const lastY = Math.max(4, Math.min(height - 4, centerY - (lastDeviation / maxVal) * halfHeight));

    ctx.fillStyle = Math.abs(lastDeviation) > threshold ? '#e94560' : '#535353';
    ctx.beginPath();
    ctx.arc(width - 2, lastY, 4, 0, Math.PI * 2);
    ctx.fill();

    if (isCalibrating) {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.8)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Calibrating...', width / 2, centerY + 4);
    }
}

function triggerJumpFlash() {
    jumpFlashTimer = 1;
}

// ==================== GAME CONTROLS ====================
function triggerJump() {
    initAudio();

    if (!gameState.hasStarted) {
        gameState.hasStarted = true;
        gameState.isPlaying = true;
        document.getElementById('startOverlay').classList.remove('visible');
        return;
    }

    if (gameState.isGameOver) {
        const timeSinceGameOver = Date.now() - gameState.gameOverTime;
        if (timeSinceGameOver >= gameState.restartDelay) {
            resetGame();
        }
        return;
    }

    if (!dino.isJumping && gameState.isPlaying) {
        dino.vy = CONFIG.jumpForce;
        dino.isJumping = true;
        gameState.jumpCount++;
        playJumpSound();
    }
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        triggerJump();
    }

    if (e.code === 'ArrowDown') {
        e.preventDefault();
        dino.isDucking = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowDown') {
        dino.isDucking = false;
    }
});

// ==================== UI HANDLERS ====================
document.getElementById('keyboardModeBtn').addEventListener('click', () => {
    gameState.useMotion = false;
    startGame();

    const indicator = document.getElementById('controlIndicator');
    indicator.querySelector('.control-icon').textContent = '⌨️';
    indicator.querySelector('.control-text').textContent = 'Keyboard Mode';
});

function startGame() {
    document.getElementById('connectionPanel').classList.add('hidden');
    document.getElementById('gameContainer').classList.add('active');
    document.getElementById('startOverlay').classList.add('visible');

    document.getElementById('highScoreValue').textContent =
        String(gameState.highScore).padStart(5, '0');

    initClouds();
    initSensorGraph();
    requestAnimationFrame(gameLoop);
}

function resetGame() {
    gameState.isGameOver = false;
    gameState.isPlaying = true;
    gameState.hasStarted = true;
    gameState.score = 0;
    gameState.speed = CONFIG.obstacleSpeed;
    gameState.jumpCount = 0;

    dino.y = canvas.height * CONFIG.groundY - dino.height;
    dino.vy = 0;
    dino.isJumping = false;

    obstacles = [];
    lastObstacleType = null;

    document.getElementById('gameOverlay').classList.remove('visible');
    document.getElementById('scoreValue').textContent = '00000';
}

// ==================== GAME OBJECTS ====================
function initClouds() {
    clouds = [];
    for (let i = 0; i < CONFIG.cloudCount; i++) {
        clouds.push({
            x: Math.random() * canvas.width,
            y: 50 + Math.random() * 100,
            width: 46 + Math.random() * 30,
            speed: 0.5 + Math.random() * 0.5,
        });
    }
}

let lastObstacleType = null;

function spawnObstacle() {
    const groundY = canvas.height * CONFIG.groundY;

    let types = ['small', 'large', 'group'];

    if (lastObstacleType === 'group') {
        types = ['small', 'small', 'large'];
    } else if (lastObstacleType === 'large') {
        types = ['small', 'small', 'group'];
    }

    const type = types[Math.floor(Math.random() * types.length)];
    lastObstacleType = type;

    let width, height;

    switch (type) {
        case 'small':
            width = 17;
            height = 35;
            break;
        case 'large':
            width = 25;
            height = 50;
            break;
        case 'group':
            width = 50;
            height = 35;
            break;
    }

    obstacles.push({
        x: canvas.width + 50,
        y: groundY - height,
        width: width,
        height: height,
        type: type,
        passed: false,
    });
}

function calculateMinSafeGap() {
    const jumpDistance = gameState.speed * CONFIG.jumpDurationFrames;
    const minSafeGap = jumpDistance * 0.4 + CONFIG.dinoWidth + 30;
    return Math.max(minSafeGap, CONFIG.minObstacleGap);
}

function calculateNextObstacleDelay() {
    const minGap = calculateMinSafeGap();
    const maxGap = Math.max(minGap + 200, CONFIG.maxObstacleGap);
    let gap = minGap + Math.random() * (maxGap - minGap);
    const delayMs = (gap / gameState.speed) * (1000 / 60);
    return delayMs;
}

// ==================== GAME LOOP ====================
let lastFrameTime = 0;
let lastObstacleTime = 0;
let nextObstacleDelay = CONFIG.minObstacleGap;

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState.isPlaying && gameState.hasStarted) {
        update(timestamp, deltaTime);
    }

    render();
    requestAnimationFrame(gameLoop);
}

function update(timestamp, deltaTime) {
    if (gameState.speed < CONFIG.maxSpeed) {
        gameState.speed += CONFIG.speedIncrement;
    }

    if (dino.isJumping) {
        dino.vy += CONFIG.gravity;
        dino.y += dino.vy;

        const groundY = canvas.height * CONFIG.groundY - dino.height;
        if (dino.y >= groundY) {
            dino.y = groundY;
            dino.vy = 0;
            dino.isJumping = false;
        }
    }

    dino.frameTimer += deltaTime;
    if (dino.frameTimer > 100) {
        dino.frameIndex = (dino.frameIndex + 1) % 2;
        dino.frameTimer = 0;

        if (!dino.isJumping && gameState.isPlaying) {
            playFootstepSound();
        }
    }

    if (timestamp - lastObstacleTime > nextObstacleDelay) {
        spawnObstacle();
        lastObstacleTime = timestamp;
        nextObstacleDelay = calculateNextObstacleDelay();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= gameState.speed;

        if (!obs.passed && obs.x + obs.width < dino.x) {
            obs.passed = true;
            gameState.score += 10;
            document.getElementById('scoreValue').textContent =
                String(gameState.score).padStart(5, '0');
        }

        if (obs.x + obs.width < 0) {
            obstacles.splice(i, 1);
        }

        if (checkCollision(dino, obs)) {
            gameOver();
        }
    }

    for (const cloud of clouds) {
        cloud.x -= cloud.speed;
        if (cloud.x + cloud.width < 0) {
            cloud.x = canvas.width + Math.random() * 100;
            cloud.y = 50 + Math.random() * 100;
        }
    }

    groundOffset = (groundOffset + gameState.speed) % 24;
}

function checkCollision(dino, obstacle) {
    const padding = 8;
    return (
        dino.x + padding < obstacle.x + obstacle.width - padding &&
        dino.x + dino.width - padding > obstacle.x + padding &&
        dino.y + padding < obstacle.y + obstacle.height &&
        dino.y + dino.height > obstacle.y + padding
    );
}

function gameOver() {
    gameState.isPlaying = false;
    gameState.isGameOver = true;
    gameState.gameOverTime = Date.now();

    playGameOverSound();

    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        localStorage.setItem('dinoHighScore', gameState.highScore);
        document.getElementById('highScoreValue').textContent =
            String(gameState.highScore).padStart(5, '0');
    }

    document.getElementById('finalScore').textContent =
        `Score: ${gameState.score}`;
    document.getElementById('jumpCount').textContent =
        `Jumps: ${gameState.jumpCount}`;
    document.getElementById('gameOverlay').classList.add('visible');
}

// ==================== RENDERING ====================
function render() {
    ctx.fillStyle = '#e0e0e0';
    for (const cloud of clouds) {
        drawCloud(cloud.x, cloud.y, cloud.width);
    }

    const groundY = canvas.height * CONFIG.groundY;
    ctx.fillStyle = '#535353';
    ctx.fillRect(0, groundY, canvas.width, CONFIG.groundLineHeight);

    ctx.fillStyle = '#909090';
    for (let x = -groundOffset; x < canvas.width; x += 24) {
        const seed = Math.abs(Math.floor(x + groundOffset) * 17) % 100;
        const dotY = groundY + 8 + (seed % 10);
        const dotSize = 1 + (seed % 3);
        ctx.fillRect(x, dotY, dotSize, dotSize);
    }

    drawDino();

    ctx.fillStyle = '#535353';
    for (const obs of obstacles) {
        drawCactus(obs);
    }
}

function drawCloud(x, y, width) {
    const height = width * 0.4;
    ctx.beginPath();
    ctx.ellipse(x + width * 0.3, y + height * 0.6, width * 0.25, height * 0.4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + width * 0.5, y + height * 0.4, width * 0.3, height * 0.4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + width * 0.7, y + height * 0.6, width * 0.25, height * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawDino() {
    ctx.fillStyle = '#535353';

    const x = dino.x;
    const y = dino.y;
    const w = dino.width;
    const h = dino.height;

    ctx.fillRect(x + w * 0.5, y, w * 0.5, h * 0.35);
    ctx.fillRect(x + w * 0.55, y + h * 0.08, w * 0.08, h * 0.08);
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(x + w * 0.75, y + h * 0.08, w * 0.12, h * 0.1);
    ctx.fillStyle = '#535353';
    ctx.fillRect(x + w * 0.3, y + h * 0.2, w * 0.4, h * 0.5);
    ctx.fillRect(x + w * 0.1, y + h * 0.25, w * 0.3, h * 0.2);
    ctx.fillRect(x, y + h * 0.3, w * 0.15, h * 0.08);

    if (!dino.isJumping) {
        if (dino.frameIndex === 0) {
            ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.3);
            ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.2);
        } else {
            ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.2);
            ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.3);
        }
    } else {
        ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.25);
        ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.25);
    }
}

function drawCactus(obs) {
    const x = obs.x;
    const y = obs.y;
    const w = obs.width;
    const h = obs.height;

    if (obs.type === 'small' || obs.type === 'large') {
        ctx.fillRect(x + w * 0.3, y, w * 0.4, h);
        ctx.fillRect(x, y + h * 0.3, w * 0.35, h * 0.15);
        ctx.fillRect(x, y + h * 0.3, w * 0.15, h * 0.35);
        ctx.fillRect(x + w * 0.65, y + h * 0.2, w * 0.35, h * 0.15);
        ctx.fillRect(x + w * 0.85, y + h * 0.2, w * 0.15, h * 0.4);
    } else {
        const cactusW = w / 3;
        for (let i = 0; i < 3; i++) {
            const cx = x + i * cactusW;
            ctx.fillRect(cx + cactusW * 0.3, y, cactusW * 0.4, h);
            if (i % 2 === 0) {
                ctx.fillRect(cx, y + h * 0.4, cactusW * 0.35, h * 0.1);
                ctx.fillRect(cx, y + h * 0.4, cactusW * 0.12, h * 0.25);
            } else {
                ctx.fillRect(cx + cactusW * 0.65, y + h * 0.3, cactusW * 0.35, h * 0.1);
                ctx.fillRect(cx + cactusW * 0.88, y + h * 0.3, cactusW * 0.12, h * 0.3);
            }
        }
    }
}

// ==================== INITIALIZATION ====================
initPeerConnection();
