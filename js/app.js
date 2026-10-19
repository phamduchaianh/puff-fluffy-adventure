// =====================================================
// PET WALKER - side-scrolling platformer
// A / D move, W / Space jump. Click sends the pup.
// Goal: reach the flag at the end of the level.
// =====================================================

// ---------- 1. Setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startBtn = document.getElementById("start-btn");

// Numbers we may want to tweak
const CONFIG = {
    gravity: 1800,
    moveSpeed: 240,
    jumpSpeed: 640,        // jump height is about 114px, jump length about 170px
    maxFall: 900,
    coyoteTime: 0.1,       // can still jump a moment after leaving a ledge
    jumpBuffer: 0.1,       // jump pressed just before landing still counts
    playerW: 28,
    playerH: 40,
    petSpeed: 650,
    petFollowSpeed: 420,
    petRadius: 16,
    petRange: 380,         // how far from the player the pup can be sent
    enemyPoints: 30,
    startLives: 3,
    invincibleTime: 1.5
};

const GROUND_Y = 420;    // top of the ground
const WORLD_W = 3600;    // total level width

const ITEM_TYPES = {
    bone: { emoji: "🦴", points: 10 },
    ball: { emoji: "🎾", points: 25 },
    star: { emoji: "⭐", points: 50 }
};

// ---------- 2. Level data ----------
// Rules used to keep the level fair:
// - gaps are at most 140px wide (the player can jump about 170px)
// - platforms are at most 90px higher than the previous one (jump height is 114px)
// - enemies patrol inside one platform, so they never walk off the edge
const LEVEL = {
    ground: [[0, 700], [830, 500], [1460, 600], [2190, 510], [2830, 770]],  // [x, width]
    platforms: [                                                             // [x, y, width]
        [300, 330, 140], [520, 270, 120], [900, 340, 160], [1150, 290, 120],
        [1560, 330, 150], [1800, 260, 140], [2300, 340, 160], [2520, 280, 120],
        [2950, 330, 140], [3180, 270, 140]
    ],
    cacti: [560, 1000, 2000, 2600, 3050, 3350],       // x of each spiky cactus on the ground
    checkpoints: [860, 1490, 2220, 2860],             // respawn points after falling
    goalX: 3500,
    items: [                                          // [x, y, type]
        [150, 395, "bone"], [220, 395, "bone"], [350, 300, "bone"], [400, 300, "bone"],
        [580, 240, "ball"], [765, 340, "bone"], [940, 310, "bone"], [1010, 310, "ball"],
        [1210, 260, "bone"], [1395, 330, "star"], [1600, 300, "bone"], [1640, 300, "bone"],
        [1680, 300, "ball"], [1870, 230, "star"], [2125, 350, "bone"], [2380, 310, "ball"],
        [2580, 250, "star"], [2765, 340, "bone"], [3020, 300, "ball"], [3070, 300, "bone"],
        [3250, 240, "star"]
    ],
    walkers: [                                        // [min x, max x, floor y]
        [380, 520, 420], [900, 1040, 340], [1600, 1900, 420], [1800, 1940, 260],
        [2250, 2450, 420], [3100, 3300, 420]
    ],
    flyers: [[1250, 1500, 300], [2680, 2900, 320]]    // [min x, max x, height]
};

// ---------- 3. Game state ----------
let player, pet, items, enemies, popups, marker, game, camX;
let ground = [], floating = [], cacti = [];
const keys = {};

function resetGame() {
    // Build solid ground blocks, one-way floating platforms and cacti from the level data
    ground = LEVEL.ground.map(([x, w]) => ({ x, y: GROUND_Y, w, h: 100, solid: true }));
    floating = LEVEL.platforms.map(([x, y, w]) => ({ x, y, w, h: 16, solid: false }));
    cacti = LEVEL.cacti.map((x) => ({ x, y: GROUND_Y - 30, w: 28, h: 30 }));

    items = LEVEL.items.map(([x, y, type]) => ({ x, y, r: 14, type: ITEM_TYPES[type] }));
    enemies = [
        ...LEVEL.walkers.map(([min, max, floor]) => makeEnemy(min, max, floor - 30, false)),
        ...LEVEL.flyers.map(([min, max, y]) => makeEnemy(min, max, y, true))
    ];
    popups = [];
    marker = null;
    camX = 0;

    game = { running: false, score: 0, lives: CONFIG.startLives, invincible: 0, jumpBuffer: 0, respawnX: 40, time: 0 };
    player = { x: 40, y: GROUND_Y - CONFIG.playerH, w: CONFIG.playerW, h: CONFIG.playerH, vx: 0, vy: 0, onGround: false, coyote: 0 };

    // Pet states: "idle" (hovers near player), "going" (flies to target), "returning"
    pet = { x: 0, y: 0, r: CONFIG.petRadius, state: "idle", target: null, carrying: null };
    placePetNearPlayer();
    updateHud();
}

function makeEnemy(min, max, y, flying) {
    const speed = flying ? 90 : 60;
    return { x: min, y, w: 30, h: 30, min, max, vx: speed, flying, baseY: y };
}

// ---------- 4. Helper functions ----------
function hit(a, b) {   // do two rectangles overlap?
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

// Move an object toward a target point. Returns true when it arrives.
function moveToward(obj, target, speed, dt) {
    const dx = target.x - obj.x, dy = target.y - obj.y;
    const d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { obj.x = target.x; obj.y = target.y; return true; }
    obj.x += (dx / d) * step;
    obj.y += (dy / d) * step;
    return false;
}

function addPopup(x, y, text) { popups.push({ x, y, text, life: 1 }); }

function updateHud() {
    scoreEl.textContent = game.score;
    livesEl.textContent = "❤️".repeat(Math.max(game.lives, 0));
}

function placePetNearPlayer() {
    const c = center(player);
    pet.x = c.x - 40;
    pet.y = c.y - 20;
}

// ---------- 5. Input ----------
const JUMP_KEYS = ["KeyW", "ArrowUp", "Space"];

window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (JUMP_KEYS.includes(e.code) && !e.repeat) game.jumpBuffer = CONFIG.jumpBuffer;
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

// Click: send the pup to that spot (only if it is free, and only within range)
canvas.addEventListener("mousedown", (e) => {
    if (!game.running || pet.state !== "idle") return;

    // Screen position -> world position (canvas scaling + camera scroll)
    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) * (canvas.width / rect.width) + camX;
    let y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Keep the target inside the pup's range
    const c = center(player);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d > CONFIG.petRange) {
        x = c.x + ((x - c.x) / d) * CONFIG.petRange;
        y = c.y + ((y - c.y) / d) * CONFIG.petRange;
    }
    pet.target = { x, y };
    pet.state = "going";
    marker = { x, y };
    });

    startBtn.addEventListener("click", () => {
    resetGame();
    game.running = true;
    overlay.classList.add("hidden");
});

// ---------- 6. Player ----------
function updatePlayer(dt) {
    const left = keys.KeyA || keys.ArrowLeft;
    const right = keys.KeyD || keys.ArrowRight;
    const jumpHeld = JUMP_KEYS.some((k) => keys[k]);

    player.vx = ((right ? 1 : 0) - (left ? 1 : 0)) * CONFIG.moveSpeed;

    // Jump (with a small grace time before and after touching the ground)
    game.jumpBuffer -= dt;
    player.coyote = player.onGround ? CONFIG.coyoteTime : player.coyote - dt;
    if (game.jumpBuffer > 0 && player.coyote > 0) {
        player.vy = -CONFIG.jumpSpeed;
        player.coyote = 0;
        game.jumpBuffer = 0;
    }

    // Gravity (stronger when jump is released early, so short taps = short hops)
    const gravityScale = player.vy < 0 && !jumpHeld ? 2.2 : 1;
    player.vy = Math.min(player.vy + CONFIG.gravity * gravityScale * dt, CONFIG.maxFall);

    movePlayerAndCollide(dt);
    player.x = clamp(player.x, 0, WORLD_W - player.w);

    // Remember the newest checkpoint we passed
    for (const cp of LEVEL.checkpoints) if (player.x > cp) game.respawnX = Math.max(game.respawnX, cp);

    // Fell into a pit
    if (player.y > canvas.height + 60) loseLife(true);

    // Reached the flag
    if (player.x + player.w >= LEVEL.goalX) endGame(true);
}

function movePlayerAndCollide(dt) {
    // Horizontal: ground blocks are solid walls
    player.x += player.vx * dt;
    for (const g of ground) {
        if (hit(player, g)) player.x = player.vx > 0 ? g.x - player.w : g.x + g.w;
    }

    // Vertical: land on top of ground and platforms
    const previousBottom = player.y + player.h;
    player.y += player.vy * dt;
    player.onGround = false;
    for (const s of [...ground, ...floating]) {
        if (!hit(player, s)) continue;
        if (player.vy >= 0 && previousBottom <= s.y + 1) {        // landing from above
        player.y = s.y - player.h;
        player.vy = 0;
        player.onGround = true;
        } else if (s.solid && player.vy < 0) {                      // bumping a solid ceiling
        player.y = s.y + s.h;
        player.vy = 0;
    }
  }
}

function loseLife(fellInPit) {
    game.lives--;
    updateHud();
    if (game.lives <= 0) { endGame(false); return; }
    game.invincible = CONFIG.invincibleTime;
    if (fellInPit) {                       // go back to the last checkpoint
        player.x = game.respawnX;
        player.y = GROUND_Y - player.h - 1;
        player.vx = player.vy = 0;
        pet.state = "idle";
        pet.carrying = null;
        placePetNearPlayer();
    } else {
        player.vy = -350;                    // small hop when hurt
  }
}

// ---------- 7. Enemies and obstacles ----------
function updateEnemies(dt) {
    for (const e of enemies) {
        // Patrol back and forth between min and max
        e.x += e.vx * dt;
        if (e.x < e.min) { e.x = e.min; e.vx = Math.abs(e.vx); }
        if (e.x + e.w > e.max) { e.x = e.max - e.w; e.vx = -Math.abs(e.vx); }
        if (e.flying) e.y = e.baseY + Math.sin(game.time * 2) * 25;   // bees float up and down
    }

    if (game.invincible > 0) game.invincible -= dt;
    if (game.invincible > 0) return;

    // Cactus: always hurts
    const body = { x: player.x + 4, y: player.y + 4, w: player.w - 8, h: player.h - 4 };
    if (cacti.some((c) => hit(body, c))) { loseLife(false); return; }

    // Enemy: jump on top to defeat it, otherwise you get hurt
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!hit(body, e)) continue;
        const stomping = player.vy > 0 && player.y + player.h - e.y < 24;
        if (stomping) {
        enemies.splice(i, 1);
        player.vy = -420;
        game.score += CONFIG.enemyPoints;
        addPopup(e.x, e.y, "+" + CONFIG.enemyPoints);
        updateHud();
        } else {
        loseLife(false);
        }
        return;
  }
}

// ---------- 8. Pet ----------
function updatePet(dt) {
    const pc = center(player);

    if (pet.state === "idle") {
        // Hover just behind the player
        const anchor = { x: pc.x - 40, y: pc.y - 25 };
        if (dist(pet, anchor) > 6) moveToward(pet, anchor, CONFIG.petFollowSpeed, dt);

    } else if (pet.state === "going") {
        const arrived = moveToward(pet, pet.target, CONFIG.petSpeed, dt);
        checkPetHits();
        if (arrived && pet.state === "going") pet.state = "returning";

    } else if (pet.state === "returning") {
        if (dist(pet, pc) < 30) {
        deliver();
        } else {
        moveToward(pet, pc, CONFIG.petSpeed, dt);
    }
  }
}

// While flying, the pup grabs the first item or hits the first enemy it touches
function checkPetHits() {
    for (let i = 0; i < items.length; i++) {
        if (dist(pet, items[i]) < pet.r + items[i].r) {
        pet.carrying = items[i];
        items.splice(i, 1);
        pet.state = "returning";
        return;
        }
    }
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (dist(pet, center(e)) < pet.r + 15) {
        enemies.splice(i, 1);
        game.score += CONFIG.enemyPoints;
        addPopup(e.x, e.y, "+" + CONFIG.enemyPoints);
        updateHud();
        pet.state = "returning";
        return;
    }
  }
}

// The pup is back: give the item to the player
function deliver() {
    if (pet.carrying) {
        game.score += pet.carrying.type.points;
        addPopup(player.x, player.y - 10, "+" + pet.carrying.type.points);
        pet.carrying = null;
        updateHud();
    }
    pet.state = "idle";
    pet.target = null;
    }

    function updatePopups(dt) {
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);
}

// ---------- 9. Game flow ----------
function endGame(won) {
    game.running = false;
    if (won) {
        const bonus = game.lives * 100;     // bonus for each life left
        game.score += bonus;
        updateHud();
        overlayTitle.textContent = "Level complete!";
        overlayText.textContent = "Final score: " + game.score + " (life bonus " + bonus + ")";
        startBtn.textContent = "Play again";
    } else {
        overlayTitle.textContent = "Game over";
        overlayText.textContent = "Final score: " + game.score;
        startBtn.textContent = "Try again";
    }
    overlay.classList.remove("hidden");
}

function update(dt) {
    if (!game.running) return;
    game.time += dt;
    updatePlayer(dt);
    if (!game.running) return;            // the player may have just won or lost
    updateEnemies(dt);
    updatePet(dt);
    updatePopups(dt);
    // Camera follows the player but stays inside the level
    camX = clamp(player.x + player.w / 2 - 300, 0, WORLD_W - canvas.width);
}

// ---------- 10. Drawing ----------
function drawEmoji(emoji, x, y, size) {
    ctx.font = size + "px 'Segoe UI Emoji','Apple Color Emoji',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, x, y);
}

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#a9dcf5");
    sky.addColorStop(1, "#e8f6ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clouds move slower than the world, which gives a feeling of depth
    for (let i = 0; i < 6; i++) {
        const x = (((i * 320 - camX * 0.4) % 1100) + 1100) % 1100 - 100;
        drawEmoji("☁️", x, 50 + (i % 3) * 40, 56);
  }
}

function drawTerrain() {
    for (const g of ground) {
        ctx.fillStyle = "#b97a4a";
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.fillStyle = "#7cc45a";
        ctx.fillRect(g.x, g.y, g.w, 10);
    }
    for (const p of floating) {
        ctx.fillStyle = "#b97a4a";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "#7cc45a";
        ctx.fillRect(p.x, p.y, p.w, 6);
    }
    for (const c of cacti) drawEmoji("🌵", c.x + c.w / 2, c.y + c.h / 2, 32);

    // Checkpoint flags (faded until reached) and the goal
    for (const cp of LEVEL.checkpoints) {
        ctx.globalAlpha = game.respawnX >= cp ? 1 : 0.4;
        drawEmoji("🚩", cp, GROUND_Y - 16, 30);
    }
    ctx.globalAlpha = 1;
    drawEmoji("🏁", LEVEL.goalX, GROUND_Y - 24, 48);
}

function drawItems() {
    for (const item of items) {
        const bob = Math.sin(game.time * 3 + item.x) * 3;
        drawEmoji(item.type.emoji, item.x, item.y + bob, 28);
        }
    }

function drawEnemies() {
    for (const e of enemies) drawEmoji(e.flying ? "🐝" : "🐛", e.x + e.w / 2, e.y + e.h / 2, 30);
    }

function drawPlayerAndPet() {
    const pc = center(player);

    // Faint circle showing how far the pup can go
    if (pet.state === "idle") {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, CONFIG.petRange, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Leash
    ctx.strokeStyle = "#a0623a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pc.x, pc.y);
    ctx.lineTo(pet.x, pet.y);
    ctx.stroke();

    // Player blinks while invincible
    const blink = game.invincible > 0 && Math.floor(game.invincible * 10) % 2 === 0;
    if (!blink) drawEmoji("🧒", pc.x, pc.y, 40);

    drawEmoji("🐶", pet.x, pet.y + Math.sin(game.time * 6) * 3, 32);
    if (pet.carrying) drawEmoji(pet.carrying.type.emoji, pet.x, pet.y - 24, 20);
}

function drawMarker() {
    if (!marker || pet.state !== "going") return;
    ctx.strokeStyle = "#ff8a5c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(marker.x - 8, marker.y - 8); ctx.lineTo(marker.x + 8, marker.y + 8);
    ctx.moveTo(marker.x + 8, marker.y - 8); ctx.lineTo(marker.x - 8, marker.y + 8);
    ctx.stroke();
}

function drawPopups() {
    for (const p of popups) {
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = "#3b2f2f";
        ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    drawBackground();
    ctx.save();
    ctx.translate(-camX, 0);       // everything below is drawn in world coordinates
    drawTerrain();
    drawMarker();
    drawItems();
    drawEnemies();
    drawPlayerAndPet();
    drawPopups();
    ctx.restore();
}

// ---------- 11. Main loop ----------
let lastTime = 0;

function loop(timestamp) {
    const t = timestamp / 1000;
    const dt = Math.min(t - lastTime, 0.05);   // cap dt so lag does not cause big jumps
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);