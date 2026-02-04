// ==================== GAME CONFIGURATION ====================
const CONFIG = {
    gravity: 0.6,
    jumpForce: -15,
    groundY: 0.8,
    dinoWidth: 44,
    dinoHeight: 47,
    dinoX: 50,
    minObstacleGap: 300,
    maxObstacleGap: 600,
    obstacleSpeed: 6,
    maxSpeed: 16,
    speedIncrement: 0.001,
    jumpDurationFrames: 50,
    jumpDeviationThreshold: 4,
    jumpCooldown: 400,
    baselineWindowSize: 30,
    baselineUpdateRate: 0.05,
    orientationChangeThreshold: 5,
    graphHistorySize: 100,
    graphMaxValue: 15,
    groundLineHeight: 2,
    cloudCount: 4,
};

// ==================== LEVEL SYSTEM ====================
const LEVELS = [
    { name: "DESERT DAY", score: 0, bg: ["#f7f7f7", "#e8e8e8"], ground: "#c4a574", dino: "#535353", obstacle: "#2d5a27", cloud: "#e0e0e0", pteroChance: 0 },
    { name: "SUNSET RUN", score: 300, bg: ["#ffecd2", "#fcb69f"], ground: "#8b6914", dino: "#4a3728", obstacle: "#3d1f0d", cloud: "#ffd89b", pteroChance: 0.1 },
    { name: "TWILIGHT DASH", score: 600, bg: ["#2c3e50", "#4a69bd"], ground: "#1e3c72", dino: "#ecf0f1", obstacle: "#2c3e50", cloud: "#5d6d7e", pteroChance: 0.2 },
    { name: "NEON NIGHT", score: 1000, bg: ["#0f0f23", "#1a1a2e"], ground: "#e94560", dino: "#00ff88", obstacle: "#ff006e", cloud: "#16213e", pteroChance: 0.25, neon: true },
    { name: "CYBER STORM", score: 1500, bg: ["#0a0a1a", "#1a0a2e"], ground: "#00f5ff", dino: "#ff00ff", obstacle: "#ffff00", cloud: "#1a1a3e", pteroChance: 0.3, neon: true },
    { name: "INFERNO", score: 2000, bg: ["#1a0000", "#3d0000"], ground: "#ff4500", dino: "#ffd700", obstacle: "#8b0000", cloud: "#4a0000", pteroChance: 0.35, particles: true },
];

// ==================== GAME STATE ====================
let gameState = {
    isPlaying: false, isGameOver: false, hasStarted: false,
    score: 0, highScore: parseInt(localStorage.getItem('dinoHighScore')) || 0,
    speed: CONFIG.obstacleSpeed, jumpCount: 0, useMotion: true,
    lastJumpTime: 0, canJump: true, gameOverTime: 0, restartDelay: 1000,
    currentLevel: 0, levelTransition: 0, combo: 0, lastObstacleTime: 0,
    shieldActive: false, slowMoActive: false, slowMoTimer: 0,
    screenShake: 0, particles: [], powerups: [], stars: [],
};

// ==================== GAME OBJECTS ====================
let dino = { x: CONFIG.dinoX, y: 0, vy: 0, width: CONFIG.dinoWidth, height: CONFIG.dinoHeight, isJumping: false, isDucking: false, frameIndex: 0, frameTimer: 0 };
let obstacles = [], clouds = [], pteros = [], groundOffset = 0;

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
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(type) {
    if (!audioCtx) initAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const t = audioCtx.currentTime;
    switch (type) {
        case 'jump':
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(400, t + 0.1);
            gain.gain.setValueAtTime(0.15, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            osc.start(t); osc.stop(t + 0.15);
            break;
        case 'gameOver':
            osc.type = 'square';
            osc.frequency.setValueAtTime(300, t);
            osc.frequency.exponentialRampToValueAtTime(80, t + 0.3);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
            osc.start(t); osc.stop(t + 0.4);
            break;
        case 'levelUp':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.exponentialRampToValueAtTime(800, t + 0.1);
            osc.frequency.exponentialRampToValueAtTime(1200, t + 0.2);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.start(t); osc.stop(t + 0.3);
            break;
        case 'star':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            osc.start(t); osc.stop(t + 0.1);
            break;
        case 'powerup':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, t);
            osc.frequency.exponentialRampToValueAtTime(1000, t + 0.15);
            gain.gain.setValueAtTime(0.15, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
            osc.start(t); osc.stop(t + 0.2);
            break;
    }
}

function playFootstepSound() {
    if (!audioCtx) initAudio();
    const now = performance.now();
    if (now - lastFootstepTime < FOOTSTEP_INTERVAL) return;
    lastFootstepTime = now;
    const bufferSize = audioCtx.sampleRate * 0.03;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800 + Math.random() * 400;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(audioCtx.currentTime);
    noise.stop(audioCtx.currentTime + 0.05);
}

// ==================== PEERJS CONNECTION ====================
let peer = null, connection = null, roomId = null;
let sensorZ = 0, currentDeviation = 0, isCalibrating = true;
let baseline = 0, baselineBuffer = [], baselineSum = 0;
let deviationHistory = [], deviationIndex = 0;
let sensorValueElement = null;

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'DINO-';
    for (let i = 0; i < 4; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
}

function initPeerConnection() {
    roomId = generateRoomId();
    document.getElementById('roomCode').textContent = roomId;
    const basePath = window.location.pathname.replace(/\/[^\/]*$/, '/');
    const controllerUrl = `${window.location.origin}${basePath}controller.html#${roomId}`;
    document.getElementById('controllerUrl').textContent = controllerUrl;
    const qrContainer = document.getElementById('qrCode');
    const qrLoading = document.getElementById('qrLoading');
    try {
        if (typeof QRCode !== 'undefined') {
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, { text: controllerUrl, width: 180, height: 180, colorDark: '#1a1a2e', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
            qrLoading.classList.add('hidden');
        }
    } catch (e) { qrLoading.textContent = 'Use URL below'; }

    try {
        peer = new Peer(roomId);
        peer.on('open', () => updateStatus('waiting', 'Waiting for phone...'));
        peer.on('connection', (conn) => {
            connection = conn;
            conn.on('open', () => { updateStatus('connected', 'Phone connected!'); setTimeout(() => startGame(), 500); });
            conn.on('data', handleMotionData);
            conn.on('close', () => updateStatus('error', 'Phone disconnected'));
        });
        peer.on('error', (err) => {
            if (err.type === 'unavailable-id') { roomId = generateRoomId(); document.getElementById('roomCode').textContent = roomId; initPeerConnection(); }
            else updateStatus('error', 'Connection error: ' + err.type);
        });
    } catch (e) { updateStatus('error', 'PeerJS failed to load'); }
}

function handleMotionData(data) {
    if (data.type === 'motion') {
        sensorZ = data.z;
        isCalibrating = data.isCalibrating;
        currentDeviation = data.deviation;
        if (sensorValueElement) sensorValueElement.textContent = isCalibrating ? '...' : (currentDeviation >= 0 ? '+' : '') + currentDeviation.toFixed(1);
        updateSensorGraph(sensorZ, currentDeviation);
        detectJump(currentDeviation);
    }
}

function detectJump(deviation) {
    if (isCalibrating) return;
    const now = Date.now();
    if (Math.abs(deviation) > CONFIG.jumpDeviationThreshold && now - gameState.lastJumpTime > CONFIG.jumpCooldown) {
        triggerJump();
        triggerJumpFlash();
        gameState.lastJumpTime = now;
    }
}

function updateStatus(state, message) {
    const indicator = document.getElementById('statusIndicator');
    indicator.className = 'status-indicator ' + state;
    indicator.querySelector('.status-text').textContent = message;
}

// ==================== SENSOR GRAPH ====================
const sensorGraphCanvas = document.getElementById('sensorGraph');
const sensorGraphCtx = sensorGraphCanvas.getContext('2d');
let sensorHistory = [], jumpFlashTimer = 0, lastGraphRenderTime = 0;
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
    if (now - lastGraphRenderTime >= GRAPH_RENDER_INTERVAL) { lastGraphRenderTime = now; renderSensorGraph(); }
}

function renderSensorGraph() {
    const w = sensorGraphCanvas.width, h = sensorGraphCanvas.height;
    const level = LEVELS[gameState.currentLevel];
    sensorGraphCtx.fillStyle = level.neon ? 'rgba(15, 15, 35, 0.9)' : 'rgba(247, 247, 247, 0.9)';
    sensorGraphCtx.fillRect(0, 0, w, h);
    const centerY = h / 2, halfH = h / 2;
    const threshY1 = centerY - (CONFIG.jumpDeviationThreshold / CONFIG.graphMaxValue) * halfH;
    const threshY2 = centerY + (CONFIG.jumpDeviationThreshold / CONFIG.graphMaxValue) * halfH;
    sensorGraphCtx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
    sensorGraphCtx.lineWidth = 1;
    sensorGraphCtx.setLineDash([4, 4]);
    sensorGraphCtx.beginPath();
    sensorGraphCtx.moveTo(0, threshY1); sensorGraphCtx.lineTo(w, threshY1);
    sensorGraphCtx.moveTo(0, threshY2); sensorGraphCtx.lineTo(w, threshY2);
    sensorGraphCtx.stroke();
    sensorGraphCtx.setLineDash([]);
    sensorGraphCtx.strokeStyle = level.neon ? level.dino : '#535353';
    sensorGraphCtx.lineWidth = 2;
    sensorGraphCtx.beginPath();
    const xStep = w / (deviationHistory.length - 1);
    for (let i = 0; i < deviationHistory.length; i++) {
        const idx = (deviationIndex + i) % deviationHistory.length;
        const x = i * xStep;
        const y = Math.max(2, Math.min(h - 2, centerY - (deviationHistory[idx] / CONFIG.graphMaxValue) * halfH));
        i === 0 ? sensorGraphCtx.moveTo(x, y) : sensorGraphCtx.lineTo(x, y);
    }
    sensorGraphCtx.stroke();
    if (jumpFlashTimer > 0) { sensorGraphCtx.fillStyle = `rgba(233, 69, 96, ${jumpFlashTimer * 0.3})`; sensorGraphCtx.fillRect(0, 0, w, h); jumpFlashTimer -= 0.1; }
}

function triggerJumpFlash() { jumpFlashTimer = 1; }

// ==================== GAME CONTROLS ====================
function triggerJump() {
    initAudio();
    if (!gameState.hasStarted) { gameState.hasStarted = true; gameState.isPlaying = true; document.getElementById('startOverlay').classList.remove('visible'); return; }
    if (gameState.isGameOver) { if (Date.now() - gameState.gameOverTime >= gameState.restartDelay) resetGame(); return; }
    if (!dino.isJumping && gameState.isPlaying) {
        dino.vy = CONFIG.jumpForce;
        dino.isJumping = true;
        gameState.jumpCount++;
        playSound('jump');
        spawnJumpParticles();
    }
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); triggerJump(); }
    if (e.code === 'ArrowDown') { e.preventDefault(); dino.isDucking = true; }
});
document.addEventListener('keyup', (e) => { if (e.code === 'ArrowDown') dino.isDucking = false; });

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
    document.getElementById('highScoreValue').textContent = String(gameState.highScore).padStart(5, '0');
    initClouds();
    initSensorGraph();
    requestAnimationFrame(gameLoop);
}

function resetGame() {
    gameState.isGameOver = false; gameState.isPlaying = true; gameState.hasStarted = true;
    gameState.score = 0; gameState.speed = CONFIG.obstacleSpeed; gameState.jumpCount = 0;
    gameState.currentLevel = 0; gameState.levelTransition = 0; gameState.combo = 0;
    gameState.shieldActive = false; gameState.slowMoActive = false;
    gameState.particles = []; gameState.powerups = []; gameState.stars = [];
    dino.y = canvas.height * CONFIG.groundY - dino.height; dino.vy = 0; dino.isJumping = false;
    obstacles = []; pteros = []; lastObstacleType = null;
    document.getElementById('gameOverlay').classList.remove('visible');
    document.getElementById('scoreValue').textContent = '00000';
    updateLevelDisplay();
}

// ==================== PARTICLES & EFFECTS ====================
function spawnJumpParticles() {
    const level = LEVELS[gameState.currentLevel];
    for (let i = 0; i < 8; i++) {
        gameState.particles.push({
            x: dino.x + dino.width / 2, y: dino.y + dino.height,
            vx: (Math.random() - 0.5) * 4, vy: Math.random() * 2 + 1,
            life: 1, size: Math.random() * 4 + 2, color: level.ground
        });
    }
}

function spawnScorePopup(x, y, text, color) {
    gameState.particles.push({ x, y, vx: 0, vy: -2, life: 1, text, color, isText: true });
}

function spawnStarCollectEffect(x, y) {
    const level = LEVELS[gameState.currentLevel];
    for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 / 12) * i;
        gameState.particles.push({
            x, y, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3,
            life: 1, size: 3, color: level.neon ? '#ffff00' : '#ffd700'
        });
    }
}

function updateParticles() {
    for (let i = gameState.particles.length - 1; i >= 0; i--) {
        const p = gameState.particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.03;
        if (!p.isText) p.vy += 0.1;
        if (p.life <= 0) gameState.particles.splice(i, 1);
    }
}

function renderParticles() {
    for (const p of gameState.particles) {
        ctx.globalAlpha = p.life;
        if (p.isText) {
            ctx.font = 'bold 16px Inter, sans-serif';
            ctx.fillStyle = p.color;
            ctx.textAlign = 'center';
            ctx.fillText(p.text, p.x, p.y);
        } else {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// ==================== COLLECTIBLES ====================
function spawnStar() {
    const groundY = canvas.height * CONFIG.groundY;
    gameState.stars.push({
        x: canvas.width + 50,
        y: groundY - 80 - Math.random() * 100,
        size: 15, rotation: 0, collected: false
    });
}

function spawnPowerup() {
    const groundY = canvas.height * CONFIG.groundY;
    const types = ['shield', 'slowmo'];
    gameState.powerups.push({
        x: canvas.width + 50,
        y: groundY - 60 - Math.random() * 80,
        type: types[Math.floor(Math.random() * types.length)],
        size: 20, rotation: 0, collected: false
    });
}

function updateCollectibles() {
    const speed = gameState.slowMoActive ? gameState.speed * 0.5 : gameState.speed;
    // Stars
    for (let i = gameState.stars.length - 1; i >= 0; i--) {
        const s = gameState.stars[i];
        s.x -= speed; s.rotation += 0.05;
        if (!s.collected && checkCollectibleCollision(dino, s)) {
            s.collected = true;
            gameState.score += 25;
            gameState.combo++;
            playSound('star');
            spawnStarCollectEffect(s.x, s.y);
            spawnScorePopup(s.x, s.y - 20, '+25', '#ffd700');
        }
        if (s.x < -50 || s.collected) gameState.stars.splice(i, 1);
    }
    // Powerups
    for (let i = gameState.powerups.length - 1; i >= 0; i--) {
        const p = gameState.powerups[i];
        p.x -= speed; p.rotation += 0.03;
        if (!p.collected && checkCollectibleCollision(dino, p)) {
            p.collected = true;
            playSound('powerup');
            if (p.type === 'shield') { gameState.shieldActive = true; spawnScorePopup(p.x, p.y - 20, '🛡️ SHIELD!', '#00ff88'); }
            else if (p.type === 'slowmo') { gameState.slowMoActive = true; gameState.slowMoTimer = 180; spawnScorePopup(p.x, p.y - 20, '🐢 SLOW-MO!', '#00bfff'); }
        }
        if (p.x < -50 || p.collected) gameState.powerups.splice(i, 1);
    }
}

function checkCollectibleCollision(d, c) {
    const dx = (d.x + d.width / 2) - c.x;
    const dy = (d.y + d.height / 2) - c.y;
    return Math.sqrt(dx * dx + dy * dy) < c.size + 20;
}

function renderCollectibles() {
    const level = LEVELS[gameState.currentLevel];
    // Stars
    for (const s of gameState.stars) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rotation);
        ctx.fillStyle = level.neon ? '#ffff00' : '#ffd700';
        drawStar(0, 0, 5, s.size, s.size / 2);
        if (level.neon) { ctx.shadowColor = '#ffff00'; ctx.shadowBlur = 15; drawStar(0, 0, 5, s.size, s.size / 2); ctx.shadowBlur = 0; }
        ctx.restore();
    }
    // Powerups
    for (const p of gameState.powerups) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.font = `${p.size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.type === 'shield' ? '🛡️' : '🐢', 0, 0);
        ctx.restore();
    }
}

function drawStar(cx, cy, spikes, outerR, innerR) {
    let rot = Math.PI / 2 * 3, step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
    ctx.fill();
}

// ==================== LEVEL SYSTEM ====================
function checkLevelUp() {
    const prevLevel = gameState.currentLevel;
    for (let i = LEVELS.length - 1; i >= 0; i--) {
        if (gameState.score >= LEVELS[i].score) { gameState.currentLevel = i; break; }
    }
    if (gameState.currentLevel > prevLevel) {
        gameState.levelTransition = 1;
        playSound('levelUp');
        spawnScorePopup(canvas.width / 2, canvas.height / 2 - 50, LEVELS[gameState.currentLevel].name, LEVELS[gameState.currentLevel].neon ? '#00ff88' : '#e94560');
        updateLevelDisplay();
    }
}

function updateLevelDisplay() {
    const levelEl = document.getElementById('levelDisplay');
    if (levelEl) levelEl.textContent = LEVELS[gameState.currentLevel].name;
}

// ==================== GAME OBJECTS ====================
function initClouds() {
    clouds = [];
    for (let i = 0; i < CONFIG.cloudCount; i++) {
        clouds.push({ x: Math.random() * canvas.width, y: 50 + Math.random() * 100, width: 46 + Math.random() * 30, speed: 0.5 + Math.random() * 0.5 });
    }
}

let lastObstacleType = null;

function spawnObstacle() {
    const groundY = canvas.height * CONFIG.groundY;
    const level = LEVELS[gameState.currentLevel];

    // Maybe spawn pterodactyl instead
    if (Math.random() < level.pteroChance) {
        const highOrLow = Math.random() > 0.5;
        pteros.push({
            x: canvas.width + 50,
            y: highOrLow ? groundY - 120 : groundY - 50,
            width: 46, height: 40, wingPhase: 0, passed: false
        });
        return;
    }

    let types = ['small', 'large', 'group'];
    if (lastObstacleType === 'group') types = ['small', 'small', 'large'];
    else if (lastObstacleType === 'large') types = ['small', 'small', 'group'];
    const type = types[Math.floor(Math.random() * types.length)];
    lastObstacleType = type;
    let width, height;
    switch (type) {
        case 'small': width = 17; height = 35; break;
        case 'large': width = 25; height = 50; break;
        case 'group': width = 50; height = 35; break;
    }
    obstacles.push({ x: canvas.width + 50, y: groundY - height, width, height, type, passed: false });
}

function calculateMinSafeGap() {
    const jumpDist = gameState.speed * CONFIG.jumpDurationFrames;
    return Math.max(jumpDist * 0.4 + CONFIG.dinoWidth + 30, CONFIG.minObstacleGap);
}

function calculateNextObstacleDelay() {
    const minGap = calculateMinSafeGap();
    const maxGap = Math.max(minGap + 200, CONFIG.maxObstacleGap);
    return ((minGap + Math.random() * (maxGap - minGap)) / gameState.speed) * (1000 / 60);
}

// ==================== GAME LOOP ====================
let lastFrameTime = 0, lastObstacleTime = 0, nextObstacleDelay = CONFIG.minObstacleGap;
let starSpawnTimer = 0, powerupSpawnTimer = 0;

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    // Screen shake
    if (gameState.screenShake > 0) {
        ctx.save();
        ctx.translate(Math.random() * gameState.screenShake - gameState.screenShake / 2, Math.random() * gameState.screenShake - gameState.screenShake / 2);
        gameState.screenShake *= 0.9;
        if (gameState.screenShake < 0.5) gameState.screenShake = 0;
    }

    renderBackground();

    if (gameState.isPlaying && gameState.hasStarted) update(timestamp, deltaTime);

    render();
    updateParticles();
    renderParticles();
    renderCollectibles();

    // Level transition effect
    if (gameState.levelTransition > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${gameState.levelTransition * 0.3})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        gameState.levelTransition -= 0.02;
    }

    if (gameState.screenShake > 0) ctx.restore();

    requestAnimationFrame(gameLoop);
}

function renderBackground() {
    const level = LEVELS[gameState.currentLevel];
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, level.bg[0]);
    gradient.addColorStop(1, level.bg[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Speed lines at high speed
    if (gameState.speed > 10 && gameState.isPlaying) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${(gameState.speed - 10) * 0.05})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const y = Math.random() * canvas.height * 0.7;
            ctx.beginPath();
            ctx.moveTo(canvas.width, y);
            ctx.lineTo(canvas.width - 50 - Math.random() * 100, y);
            ctx.stroke();
        }
    }
}

function update(timestamp, deltaTime) {
    const speedMult = gameState.slowMoActive ? 0.5 : 1;
    if (gameState.slowMoActive) {
        gameState.slowMoTimer--;
        if (gameState.slowMoTimer <= 0) gameState.slowMoActive = false;
    }

    if (gameState.speed < CONFIG.maxSpeed) gameState.speed += CONFIG.speedIncrement;

    // Dino physics
    if (dino.isJumping) {
        dino.vy += CONFIG.gravity;
        dino.y += dino.vy * speedMult;
        const groundY = canvas.height * CONFIG.groundY - dino.height;
        if (dino.y >= groundY) { dino.y = groundY; dino.vy = 0; dino.isJumping = false; }
    }

    dino.frameTimer += deltaTime;
    if (dino.frameTimer > 100) {
        dino.frameIndex = (dino.frameIndex + 1) % 2;
        dino.frameTimer = 0;
        if (!dino.isJumping && gameState.isPlaying) playFootstepSound();
    }

    // Spawn obstacles
    if (timestamp - lastObstacleTime > nextObstacleDelay) {
        spawnObstacle();
        lastObstacleTime = timestamp;
        nextObstacleDelay = calculateNextObstacleDelay();
    }

    // Spawn collectibles
    starSpawnTimer += deltaTime;
    powerupSpawnTimer += deltaTime;
    if (starSpawnTimer > 2000 + Math.random() * 2000) { spawnStar(); starSpawnTimer = 0; }
    if (powerupSpawnTimer > 8000 + Math.random() * 5000) { spawnPowerup(); powerupSpawnTimer = 0; }

    // Update obstacles
    const speed = gameState.speed * speedMult;
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= speed;
        if (!obs.passed && obs.x + obs.width < dino.x) {
            obs.passed = true;
            gameState.score += 10;
            document.getElementById('scoreValue').textContent = String(gameState.score).padStart(5, '0');
            checkLevelUp();
        }
        if (obs.x + obs.width < 0) obstacles.splice(i, 1);
        if (checkCollision(dino, obs)) handleCollision();
    }

    // Update pterodactyls
    for (let i = pteros.length - 1; i >= 0; i--) {
        const p = pteros[i];
        p.x -= speed * 1.2;
        p.wingPhase += 0.2;
        if (!p.passed && p.x + p.width < dino.x) {
            p.passed = true;
            gameState.score += 15;
            document.getElementById('scoreValue').textContent = String(gameState.score).padStart(5, '0');
            checkLevelUp();
        }
        if (p.x + p.width < 0) pteros.splice(i, 1);
        if (checkPteroCollision(dino, p)) handleCollision();
    }

    // Update clouds
    for (const cloud of clouds) {
        cloud.x -= cloud.speed;
        if (cloud.x + cloud.width < 0) { cloud.x = canvas.width + Math.random() * 100; cloud.y = 50 + Math.random() * 100; }
    }

    updateCollectibles();
    groundOffset = (groundOffset + speed) % 24;
}

function handleCollision() {
    if (gameState.shieldActive) {
        gameState.shieldActive = false;
        spawnScorePopup(dino.x, dino.y - 20, 'SHIELD BREAK!', '#ff6b6b');
        return;
    }
    gameOver();
}

function checkCollision(d, o) {
    const pad = 8;
    return d.x + pad < o.x + o.width - pad && d.x + d.width - pad > o.x + pad && d.y + pad < o.y + o.height && d.y + d.height > o.y + pad;
}

function checkPteroCollision(d, p) {
    const pad = 10;
    return d.x + pad < p.x + p.width - pad && d.x + d.width - pad > p.x + pad && d.y + pad < p.y + p.height - pad && d.y + d.height - pad > p.y + pad;
}

function gameOver() {
    gameState.isPlaying = false;
    gameState.isGameOver = true;
    gameState.gameOverTime = Date.now();
    gameState.screenShake = 15;
    playSound('gameOver');
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        localStorage.setItem('dinoHighScore', gameState.highScore);
        document.getElementById('highScoreValue').textContent = String(gameState.highScore).padStart(5, '0');
    }
    document.getElementById('finalScore').textContent = `Score: ${gameState.score}`;
    document.getElementById('jumpCount').textContent = `Jumps: ${gameState.jumpCount} | Level: ${LEVELS[gameState.currentLevel].name}`;
    document.getElementById('gameOverlay').classList.add('visible');
}

// ==================== RENDERING ====================
function render() {
    const level = LEVELS[gameState.currentLevel];

    // Clouds
    ctx.fillStyle = level.cloud;
    for (const cloud of clouds) drawCloud(cloud.x, cloud.y, cloud.width);

    // Ground
    const groundY = canvas.height * CONFIG.groundY;
    ctx.fillStyle = level.ground;
    ctx.fillRect(0, groundY, canvas.width, CONFIG.groundLineHeight);
    if (level.neon) { ctx.shadowColor = level.ground; ctx.shadowBlur = 10; ctx.fillRect(0, groundY, canvas.width, CONFIG.groundLineHeight); ctx.shadowBlur = 0; }

    // Ground texture
    ctx.fillStyle = level.neon ? level.ground : '#909090';
    for (let x = -groundOffset; x < canvas.width; x += 24) {
        const seed = Math.abs(Math.floor(x + groundOffset) * 17) % 100;
        ctx.fillRect(x, groundY + 8 + (seed % 10), 1 + (seed % 3), 1 + (seed % 3));
    }

    // Dino
    drawDino(level);

    // Obstacles
    ctx.fillStyle = level.obstacle;
    for (const obs of obstacles) {
        if (level.neon) { ctx.shadowColor = level.obstacle; ctx.shadowBlur = 8; }
        drawCactus(obs);
        ctx.shadowBlur = 0;
    }

    // Pterodactyls
    for (const p of pteros) drawPterodactyl(p, level);

    // Shield indicator
    if (gameState.shieldActive) {
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(dino.x + dino.width / 2, dino.y + dino.height / 2, 35, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawCloud(x, y, w) {
    const h = w * 0.4;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.3, y + h * 0.6, w * 0.25, h * 0.4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.5, y + h * 0.4, w * 0.3, h * 0.4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.7, y + h * 0.6, w * 0.25, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawDino(level) {
    ctx.fillStyle = level.dino;
    if (level.neon) { ctx.shadowColor = level.dino; ctx.shadowBlur = 12; }
    const x = dino.x, y = dino.y, w = dino.width, h = dino.height;
    ctx.fillRect(x + w * 0.5, y, w * 0.5, h * 0.35);
    ctx.fillRect(x + w * 0.55, y + h * 0.08, w * 0.08, h * 0.08);
    const bgCol = level.bg[0];
    ctx.fillStyle = bgCol;
    ctx.fillRect(x + w * 0.75, y + h * 0.08, w * 0.12, h * 0.1);
    ctx.fillStyle = level.dino;
    ctx.fillRect(x + w * 0.3, y + h * 0.2, w * 0.4, h * 0.5);
    ctx.fillRect(x + w * 0.1, y + h * 0.25, w * 0.3, h * 0.2);
    ctx.fillRect(x, y + h * 0.3, w * 0.15, h * 0.08);
    if (!dino.isJumping) {
        if (dino.frameIndex === 0) { ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.3); ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.2); }
        else { ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.2); ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.3); }
    } else { ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.12, h * 0.25); ctx.fillRect(x + w * 0.55, y + h * 0.7, w * 0.12, h * 0.25); }
    ctx.shadowBlur = 0;
}

function drawCactus(obs) {
    const x = obs.x, y = obs.y, w = obs.width, h = obs.height;
    if (obs.type === 'small' || obs.type === 'large') {
        ctx.fillRect(x + w * 0.3, y, w * 0.4, h);
        ctx.fillRect(x, y + h * 0.3, w * 0.35, h * 0.15);
        ctx.fillRect(x, y + h * 0.3, w * 0.15, h * 0.35);
        ctx.fillRect(x + w * 0.65, y + h * 0.2, w * 0.35, h * 0.15);
        ctx.fillRect(x + w * 0.85, y + h * 0.2, w * 0.15, h * 0.4);
    } else {
        const cw = w / 3;
        for (let i = 0; i < 3; i++) {
            const cx = x + i * cw;
            ctx.fillRect(cx + cw * 0.3, y, cw * 0.4, h);
            if (i % 2 === 0) { ctx.fillRect(cx, y + h * 0.4, cw * 0.35, h * 0.1); ctx.fillRect(cx, y + h * 0.4, cw * 0.12, h * 0.25); }
            else { ctx.fillRect(cx + cw * 0.65, y + h * 0.3, cw * 0.35, h * 0.1); ctx.fillRect(cx + cw * 0.88, y + h * 0.3, cw * 0.12, h * 0.3); }
        }
    }
}

function drawPterodactyl(p, level) {
    ctx.fillStyle = level.obstacle;
    if (level.neon) { ctx.shadowColor = level.obstacle; ctx.shadowBlur = 10; }
    const x = p.x, y = p.y, w = p.width, h = p.height;
    // Body
    ctx.fillRect(x + w * 0.2, y + h * 0.4, w * 0.6, h * 0.25);
    // Head
    ctx.fillRect(x + w * 0.7, y + h * 0.35, w * 0.3, h * 0.2);
    // Beak
    ctx.fillRect(x + w * 0.9, y + h * 0.4, w * 0.15, h * 0.1);
    // Wings (animated)
    const wingY = Math.sin(p.wingPhase) * 0.2;
    ctx.fillRect(x, y + h * (0.3 + wingY), w * 0.5, h * 0.12);
    ctx.fillRect(x + w * 0.3, y + h * (0.2 + wingY), w * 0.3, h * 0.15);
    ctx.shadowBlur = 0;
}

// ==================== INITIALIZATION ====================
initPeerConnection();
