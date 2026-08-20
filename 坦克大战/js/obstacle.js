/* ============================================================
   obstacle.js — 场景障碍物
   类型：wall(可摧毁墙壁) / grass(草丛隐身) / water(减速水域)
   每个障碍物按网格对齐
   ============================================================ */

class Obstacle {
    constructor(gridX, gridY, type) {
        this.gx = gridX;
        this.gy = gridY;
        this.type = type === 'wall' ? 'brick' : type;
        this.size = CONFIG.GRID;
        this.x = gridX * this.size;  // 左上角坐标
        this.y = gridY * this.size;
        this.w = this.size;
        this.h = this.size;
        // 中心点
        this.cx = this.x + this.w / 2;
        this.cy = this.y + this.h / 2;

        // 砖墙可被普通弹摧毁，钢墙仅接受最高火力伤害；桥梁架于水域上可破坏
        this.maxHp = this.type === 'brick'
            ? CONFIG.OBSTACLE.brickHp
            : this.type === 'steel' ? CONFIG.OBSTACLE.steelHp
            : this.type === 'bridge' ? CONFIG.OBSTACLE.bridgeHp : 0;
        this.hp = this.maxHp;
        this.dead = false;
        // 草丛摇曳动画相位
        this.sway = Math.random() * Math.PI * 2;
    }

    // 是否阻挡坦克移动
    blocksTank() {
        return (this.type === 'brick' || this.type === 'steel') && !this.dead;
    }

    // 是否阻挡子弹（草丛/水域/桥梁不挡子弹，桥梁可被子弹打掉但子弹继续飞行）
    blocksBullet() {
        return (this.type === 'brick' || this.type === 'steel') && !this.dead;
    }

    // 受到子弹伤害
    takeDamage(dmg, particles) {
        if (this.type !== 'brick' && this.type !== 'steel' && this.type !== 'bridge') return;
        if (this.dead) return;
        // 钢墙需最高火力
        if (this.type === 'steel') {
            // 由调用方判断 canBreakSteel，这里仅扣血
        }
        this.hp -= dmg;
        if (this.hp <= 0) {
            this.hp = 0;
            this.dead = true;
            // 墙体破碎特效
            const col = this.type === 'steel' ? '#d9f7ff'
                : this.type === 'bridge' ? '#a0703a' : '#7a8a9a';
            particles.explode(this.cx, this.cy, col, 0.5);
        } else {
            const col = this.type === 'steel' ? '#00d4ff'
                : this.type === 'bridge' ? '#c98a3a' : '#9aa';
            particles.hitSpark(this.cx, this.cy, col);
        }
    }

    update(dt) {
        if (this.type === 'grass') this.sway += dt * 0.003;
    }

    draw(ctx) {
        if (this.dead) return;
        const { x, y, size } = this;
        switch (this.type) {
            case 'brick':
            case 'steel': {
                const isSteel = this.type === 'steel';
                const hpRatio = this.hp / this.maxHp;
                ctx.fillStyle = isSteel
                    ? (hpRatio >= 1 ? '#8aa3b7' : '#536a7d')
                    : (hpRatio >= 1 ? '#3a4358' : '#2a3142');
                ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
                // 内部纹理
                ctx.strokeStyle = isSteel ? 'rgba(255,255,255,0.55)' : 'rgba(0,212,255,0.25)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 6, y + 6, size - 12, size - 12);
                if (isSteel) {
                    ctx.beginPath();
                    ctx.moveTo(x + 6, y + size / 2);
                    ctx.lineTo(x + size - 6, y + size / 2);
                    ctx.moveTo(x + size / 2, y + 6);
                    ctx.lineTo(x + size / 2, y + size - 6);
                    ctx.stroke();
                }
                // 损伤裂纹
                if (hpRatio < 1) {
                    ctx.strokeStyle = 'rgba(255,42,90,0.6)';
                    ctx.beginPath();
                    ctx.moveTo(x + 8, y + 8);
                    ctx.lineTo(x + size - 8, y + size - 8);
                    ctx.moveTo(x + size - 8, y + 8);
                    ctx.lineTo(x + 8, y + size - 8);
                    ctx.stroke();
                }
                // 霓虹边框
                ctx.strokeStyle = isSteel ? '#d9f7ff' : '#00d4ff';
                ctx.lineWidth = 1.5;
                ctx.shadowColor = isSteel ? '#bceeff' : '#00d4ff';
                ctx.shadowBlur = 6;
                ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
                ctx.shadowBlur = 0;
                break;
            }
            case 'grass': {
                // 草丛：半透明青绿，坦克进入隐身
                ctx.save();
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = '#0a3a2a';
                ctx.fillRect(x, y, size, size);
                // 摇曳草叶
                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 1;
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 4;
                for (let i = 0; i < 5; i++) {
                    const gx = x + 6 + i * 7;
                    const off = Math.sin(this.sway + i) * 2;
                    ctx.beginPath();
                    ctx.moveTo(gx, y + size - 4);
                    ctx.lineTo(gx + off, y + 6);
                    ctx.stroke();
                }
                ctx.restore();
                break;
            }
            case 'water': {
                // 水域：流动蓝
                ctx.fillStyle = '#0a2440';
                ctx.fillRect(x, y, size, size);
                ctx.strokeStyle = 'rgba(0,212,255,0.4)';
                ctx.lineWidth = 1;
                const t = performance.now() * 0.002;
                for (let i = 0; i < 3; i++) {
                    const wy = y + 10 + i * 10 + Math.sin(t + i + this.gx) * 2;
                    ctx.beginPath();
                    ctx.moveTo(x + 4, wy);
                    ctx.lineTo(x + size - 4, wy);
                    ctx.stroke();
                }
                break;
            }
            case 'bridge': {
                // 桥梁：木质桥面横跨水域，先画水域底色再画桥板
                ctx.fillStyle = '#0a2440';
                ctx.fillRect(x, y, size, size);
                const hpRatio = this.hp / this.maxHp;
                // 桥板（横向铺板）
                ctx.fillStyle = hpRatio > 0.5 ? '#7a5230' : '#5a3a20';
                ctx.fillRect(x + 2, y + 4, size - 4, size - 8);
                // 木板纹理
                ctx.strokeStyle = '#3a2410';
                ctx.lineWidth = 1;
                for (let i = 1; i < 4; i++) {
                    const px = x + 2 + (i * (size - 4) / 4);
                    ctx.beginPath();
                    ctx.moveTo(px, y + 4);
                    ctx.lineTo(px, y + size - 4);
                    ctx.stroke();
                }
                // 损伤裂纹
                if (hpRatio < 1) {
                    ctx.strokeStyle = 'rgba(255,80,40,0.7)';
                    ctx.beginPath();
                    ctx.moveTo(x + 6, y + 6);
                    ctx.lineTo(x + size - 6, y + size - 6);
                    ctx.moveTo(x + size - 6, y + 6);
                    ctx.lineTo(x + 6, y + size - 6);
                    ctx.stroke();
                }
                // 霓虹边框（标识可破坏）
                ctx.strokeStyle = '#c98a3a';
                ctx.lineWidth = 1.2;
                ctx.shadowColor = '#c98a3a';
                ctx.shadowBlur = 5;
                ctx.strokeRect(x + 2, y + 4, size - 4, size - 8);
                ctx.shadowBlur = 0;
                break;
            }
        }
    }
}

/* ---------- 障碍物管理器 ---------- */
class ObstacleManager {
    constructor() {
        this.list = [];
        this.portals = [];   // 单向传送门对：[{ entry, exit, cooldown, color }]
    }

    clear() { this.list = []; this.portals = []; }

    add(o) { this.list.push(o); }

    // 地图单元像素尺寸（13×13 致敬经典，按高度自适应填充画布）
    get MAP_CELL() { return Math.floor(CONFIG.CANVAS_H / 13); }
    get MAP_OFFSET_X() { return Math.floor((CONFIG.CANVAS_W - 14 * this.MAP_CELL) / 2); }
    get MAP_OFFSET_Y() { return Math.floor((CONFIG.CANVAS_H - 13 * this.MAP_CELL) / 2); }

    // 生成关卡布局：优先使用手绘地图（3 张循环），否则回退到伪随机
    generateLevel(level) {
        this.clear();
        const maps = CONFIG.MAPS;
        if (maps && maps.length) {
            const map = maps[(level - 1) % maps.length];
            this.loadMap(map);
            return;
        }
        this.generateRandomLevel(level);
    }

    // 加载字符地图：#砖 S钢 .草 ~水 B桥梁 1/2传送门对 空格=空地
    // 底部中央 cols 6-7 / rows 11-12 为基地格，跳过（由 Base 实体占据）
    loadMap(map) {
        this.clear();
        const cell = this.MAP_CELL;
        const ox = this.MAP_OFFSET_X;
        const oy = this.MAP_OFFSET_Y;
        const rows = map.rows;
        // 先扫一遍传送门入口/出口配对
        const entryCells = []; // [{r,c}]
        const exitCells = [];
        for (let r = 0; r < rows.length; r++) {
            const line = rows[r];
            for (let c = 0; c < line.length; c++) {
                const ch = line[c];
                if (ch === '1') entryCells.push({ r, c });
                else if (ch === '2') exitCells.push({ r, c });
            }
        }
        // 配对：第 i 个入口 → 第 i 个出口
        const portalPairs = Math.min(entryCells.length, exitCells.length);
        for (let i = 0; i < portalPairs; i++) {
            const e = entryCells[i], x = exitCells[i];
            const entry = { x: ox + e.c * cell + cell / 2, y: oy + e.r * cell + cell / 2 };
            const exit = { x: ox + x.c * cell + cell / 2, y: oy + x.r * cell + cell / 2 };
            this.portals.push({
                entry, exit,
                cooldown: 0,
                color: CONFIG.PORTAL.pairColor[i % CONFIG.PORTAL.pairColor.length],
            });
        }
        // 障碍物
        for (let r = 0; r < rows.length; r++) {
            const line = rows[r];
            for (let c = 0; c < line.length; c++) {
                const ch = line[c];
                // 基地保留格（2×2）：跳过
                if (r >= 11 && c >= 6 && c <= 7) continue;
                let type = null;
                if (ch === '#') type = 'brick';
                else if (ch === 'S') type = 'steel';
                else if (ch === '.') type = 'grass';
                else if (ch === '~') type = 'water';
                else if (ch === 'B') type = 'bridge';
                if (!type) continue;
                // 以左上角网格坐标构造（Obstacle 接受 gridX/gridY 但内部按 GRID 计算，这里改用像素版）
                const o = new Obstacle(0, 0, type);
                o.gx = c; o.gy = r;
                o.size = cell;
                o.x = ox + c * cell; o.y = oy + r * cell;
                o.w = cell; o.h = cell;
                o.cx = o.x + cell / 2; o.cy = o.y + cell / 2;
                this.list.push(o);
            }
        }
    }

    // 回退：伪随机布局（保留旧逻辑）
    generateRandomLevel(level) {
        const G = CONFIG.GRID;
        const cols = Math.floor(CONFIG.CANVAS_W / G);
        const rows = Math.floor(CONFIG.CANVAS_H / G);
        const centerX = Math.floor(cols / 2);
        const centerY = Math.floor(rows / 2);
        let seed = level * 9301 + 49297;
        const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        for (let gy = 1; gy < rows - 1; gy++) {
            for (let gx = 1; gx < cols - 1; gx++) {
                if (Math.abs(gx - centerX) <= 2 && Math.abs(gy - centerY) <= 2) continue;
                if ((gy <= 2 && (gx <= 2 || gx >= cols - 3))) continue;
                const r = rng();
                if (r < 0.09) this.list.push(new Obstacle(gx, gy, 'brick'));
                else if (r < 0.12) this.list.push(new Obstacle(gx, gy, 'steel'));
                else if (r < 0.17) this.list.push(new Obstacle(gx, gy, 'grass'));
                else if (r < 0.21) this.list.push(new Obstacle(gx, gy, 'water'));
            }
        }
    }

    update(dt) {
        for (const o of this.list) o.update(dt);
        // 传送门冷却
        for (const p of this.portals) {
            if (p.cooldown > 0) p.cooldown -= dt;
        }
    }

    draw(ctx) {
        // 草丛和水域先画（在坦克下方），桥梁次之（高于水面但低于墙），墙壁后画
        for (const o of this.list) if (o.type === 'grass' || o.type === 'water') o.draw(ctx);
        for (const o of this.list) if (o.type === 'bridge') o.draw(ctx);
        for (const o of this.list) if (o.type === 'brick' || o.type === 'steel') o.draw(ctx);
        // 传送门最后画（在墙上方提供视觉提示）
        this.drawPortals(ctx);
    }

    drawPortals(ctx) {
        const t = performance.now() * 0.004;
        for (const p of this.portals) {
            for (const node of [p.entry, p.exit]) {
                const pulse = 0.7 + 0.3 * Math.sin(t + node.x * 0.01);
                ctx.save();
                ctx.translate(node.x, node.y);
                // 外圈光环
                ctx.globalAlpha = 0.5 * pulse;
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(0, 0, 14 * pulse, 0, Math.PI * 2);
                ctx.fill();
                // 旋转十字
                ctx.globalAlpha = 0.95;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2;
                ctx.rotate(t);
                ctx.beginPath();
                ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
                ctx.moveTo(0, -9); ctx.lineTo(0, 9);
                ctx.stroke();
                ctx.restore();
            }
            // 入口→出口的虚线指示（淡色）
            ctx.save();
            ctx.strokeStyle = p.color;
            ctx.globalAlpha = 0.18;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(p.entry.x, p.entry.y);
            ctx.lineTo(p.exit.x, p.exit.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    // 检测矩形与墙的碰撞，返回是否阻挡
    collidesWithTank(rect) {
        for (const o of this.list) {
            if (!o.blocksTank()) continue;
            if (Utils.aabb(rect, o)) return true;
        }
        return false;
    }

    // 检测子弹（圆）是否撞墙，撞到则对墙造成伤害并返回 true
    // 桥梁可被子弹穿透但会受损（每次穿透扣 1 点）
    bulletHitWall(bullet, particles) {
        let blocked = false;
        for (const o of this.list) {
            if (o.dead) continue;
            if (o.type === 'brick' || o.type === 'steel') {
                if (Utils.circleRect(bullet.x, bullet.y, bullet.size, o)) {
                    if (o.type === 'steel' && !bullet.canBreakSteel) {
                        particles.hitSpark(bullet.x, bullet.y, '#d9f7ff');
                        blocked = true;
                        continue;
                    }
                    o.takeDamage(bullet.damage, particles);
                    blocked = true;
                }
            } else if (o.type === 'bridge') {
                // 子弹穿透桥梁，造成伤害但不阻挡
                if (Utils.circleRect(bullet.x, bullet.y, bullet.size, o)) {
                    o.takeDamage(bullet.damage, particles);
                }
            }
        }
        return blocked;
    }

    // 玩家是否踩在传送门入口上（返回匹配的传送门对象或 null）
    portalAt(x, y) {
        const r = CONFIG.GRID * 0.45;
        for (const p of this.portals) {
            if (p.cooldown > 0) continue;
            const dx = x - p.entry.x, dy = y - p.entry.y;
            if (dx * dx + dy * dy < r * r) return p;
        }
        return null;
    }

    // 返回某点所在格子是否为草丛（隐身）
    isInGrass(x, y) {
        for (const o of this.list) {
            if (o.type === 'grass' &&
                x > o.x && x < o.x + o.w &&
                y > o.y && y < o.y + o.h) return true;
        }
        return false;
    }

    // 返回某点所在格子是否为水域（减速），返回减速倍率
    // 注意：若该格存在尚存活的桥梁，则水域被覆盖，不减速
    waterSlowAt(x, y) {
        let inWater = false;
        for (const o of this.list) {
            if (o.type === 'water' &&
                x > o.x && x < o.x + o.w &&
                y > o.y && y < o.y + o.h) inWater = true;
        }
        if (!inWater) return 1;
        // 检查同格是否有存活桥梁
        for (const o of this.list) {
            if (o.type === 'bridge' && !o.dead &&
                x > o.x && x < o.x + o.w &&
                y > o.y && y < o.y + o.h) return 1;
        }
        return CONFIG.OBSTACLE.waterSlow;
    }
}

/* ============================================================
   Base — 鹰巢基地（必须保护，被摧毁即失败）
   位于地图底部中央 2×2 格；可被敌方子弹摧毁
   基地加固道具激活后获得限时无敌护盾
   ============================================================ */
class Base {
    constructor() {
        const cell = Math.floor(CONFIG.CANVAS_H / 13);
        const ox = Math.floor((CONFIG.CANVAS_W - 14 * cell) / 2);
        const oy = Math.floor((CONFIG.CANVAS_H - 13 * cell) / 2);
        // cols 6-7 / rows 11-12 → 中心
        this.size = cell * 2;
        this.x = ox + 6 * cell + cell;          // 中心 X
        this.y = oy + 11 * cell + cell;         // 中心 Y
        this.hp = CONFIG.BASE.hp;
        this.maxHp = CONFIG.BASE.hp;
        this.alive = true;
        this.shieldTime = 0;                    // 基地加固护盾剩余 ms
        this.dead = false;
        this.flash = 0;                         // 受击闪烁
    }

    takeDamage(dmg, game) {
        if (!this.alive) return;
        if (this.shieldTime > 0) {
            game.particles.hitSpark(this.x, this.y, '#00d4ff');
            return;
        }
        this.hp -= dmg;
        this.flash = 200;
        // ===== 基地受击警报：红色闪烁 + 警报音效 =====
        game.sound('hit');
        game.toast('⚠ 基地受击!');
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            this.dead = true;
            game.onBaseDestroyed();
        }
    }

    update(dt) {
        if (this.shieldTime > 0) this.shieldTime -= dt;
        if (this.flash > 0) this.flash -= dt;
    }

    // 圆形子弹是否命中基地
    hitBy(bullet) {
        if (!this.alive) return false;
        const r = Utils.rect(this.x, this.y, this.size, this.size);
        return Utils.circleRect(bullet.x, bullet.y, bullet.size, r);
    }

    draw(ctx) {
        const half = this.size / 2;
        ctx.save();
        ctx.translate(this.x, this.y);

        if (!this.alive) {
            // 废墟：黑色焦坑
            ctx.fillStyle = '#1a0008';
            ctx.fillRect(-half, -half, this.size, this.size);
            ctx.strokeStyle = '#ff0080';
            ctx.lineWidth = 2;
            ctx.strokeRect(-half + 2, -half + 2, this.size - 4, this.size - 4);
            // 烟雾痕迹
            ctx.strokeStyle = 'rgba(80,80,80,0.6)';
            ctx.beginPath();
            ctx.moveTo(-half + 6, -half + 6); ctx.lineTo(half - 6, half - 6);
            ctx.moveTo(half - 6, -half + 6); ctx.lineTo(-half + 6, half - 6);
            ctx.stroke();
            ctx.restore();
            return;
        }

        // 底座
        const flash = this.flash > 0;
        ctx.fillStyle = flash ? '#3a0a1e' : '#0a1828';
        ctx.fillRect(-half, -half, this.size, this.size);
        ctx.strokeStyle = flash ? '#fff' : '#00d4ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 12;
        ctx.strokeRect(-half + 1, -half + 1, this.size - 2, this.size - 2);
        ctx.shadowBlur = 0;

        // 鹰徽（几何像素风）+ 呼吸发光 / 受击红色闪烁
        const now = Utils.now();
        let accent, accentGlow;
        if (flash) {
            // 受击：快速闪烁红色（频率高）
            const fastBlink = Math.floor(now / 80) % 2;
            accent = fastBlink ? '#ff2a5a' : '#ff6680';
            accentGlow = 14;
        } else {
            // 未受击：缓慢呼吸发光
            const breath = 0.5 + 0.5 * Math.sin(now * 0.003);
            accent = '#00ffcc';
            accentGlow = 6 + breath * 8;
        }
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = accentGlow;
        // 翅膀（左右三角）
        ctx.beginPath();
        ctx.moveTo(-half * 0.6, 4);
        ctx.lineTo(-half * 0.15, -half * 0.25);
        ctx.lineTo(-half * 0.15, 8);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(half * 0.6, 4);
        ctx.lineTo(half * 0.15, -half * 0.25);
        ctx.lineTo(half * 0.15, 8);
        ctx.closePath(); ctx.fill();
        // 身体
        ctx.fillRect(-half * 0.12, -half * 0.3, half * 0.24, half * 0.6);
        // 头
        ctx.beginPath();
        ctx.arc(0, -half * 0.4, half * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 基地护盾
        if (this.shieldTime > 0) {
            const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.01);
            ctx.globalAlpha = 0.35 + pulse * 0.3;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(0, 0, this.size * 0.75, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }
}
