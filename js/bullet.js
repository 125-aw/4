/* ============================================================
   bullet.js — 子弹系统（含对象池）
   类型：normal(普通) / pierce(穿甲) / enemy(敌方) / boss / laser
   owner: 'player' | 'enemy' | 'boss'
   ============================================================ */

class Bullet {
    constructor() {
        this.active = false;
        this.reset();
    }

    reset() {
        this.x = 0; this.y = 0;
        this.vx = 0; this.vy = 0;
        this.dir = 0;
        this.speed = 7;
        this.damage = 1;
        this.size = CONFIG.BULLET.size;
        this.owner = 'player';
        this.type = 'normal';
        this.life = CONFIG.BULLET.lifetime;
        this.color = '#ffe600';
        this.pierceLeft = 0;   // 穿甲剩余穿透次数
        this.canBreakSteel = false;
        this.trailTimer = 0;
        this.trail = [];       // 位置历史，用于绘制渐变拖尾
    }

    init(opts) {
        this.active = true;
        this.x = opts.x; this.y = opts.y;
        this.dir = opts.dir;
        const v = Utils.dirVec(this.dir);
        this.speed = opts.speed;
        this.vx = v.x * this.speed;
        this.vy = v.y * this.speed;
        this.damage = opts.damage || 1;
        this.owner = opts.owner || 'player';
        this.type = opts.type || 'normal';
        this.life = opts.life || CONFIG.BULLET.lifetime;
        this.size = opts.size || CONFIG.BULLET.size;
        this.pierceLeft = opts.pierceLeft || 0;
        this.canBreakSteel = Boolean(opts.canBreakSteel);
        this.color = opts.color || (this.owner === 'player' ? '#ffe600' : '#ff2a5a');
        this.trailTimer = 0;
        this.trail = [];
        return this;
    }

    update(dt, game) {
        if (!this.active) return;
        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }

        this.x += this.vx * dt * 0.06;
        this.y += this.vy * dt * 0.06;

        // 记录位置历史（用于渐变拖尾，最多 8 个点 ≈ 30px 长度）
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 8) this.trail.shift();

        // 出界销毁
        if (this.x < -20 || this.x > CONFIG.CANVAS_W + 20 ||
            this.y < -20 || this.y > CONFIG.CANVAS_H + 20) {
            this.active = false;
            return;
        }

        // 尾焰粒子
        this.trailTimer -= dt;
        if (this.trailTimer <= 0) {
            this.trailTimer = 40;
            game.particles.spawn({
                x: this.x, y: this.y, life: 180, size: this.size * 0.8,
                color: this.color, type: 'trail',
            });
        }

        // 撞墙检测（穿甲弹不破墙，但会被墙阻挡？设计：所有子弹都会被墙阻挡并对墙造成伤害）
        if (game.obstacles.bulletHitWall(this, game.particles)) {
            this.active = false;
            game.particles.hitSpark(this.x, this.y, '#9aa');
            return;
        }
    }

    draw(ctx) {
        if (!this.active) return;
        ctx.save();

        // ===== 渐变拖尾（光剑式）=====
        if (this.trail.length >= 2) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const t = i / this.trail.length; // 0=尾部, 1=头部
                const p1 = this.trail[i];
                const p2 = this.trail[i + 1];
                ctx.globalAlpha = t * 0.6;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = this.size * (0.3 + t * 0.7);
                ctx.lineCap = 'round';
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // ===== 发光光晕（径向渐变）=====
        const glowColor = this._glowColor();
        const glowR = this.size * 3;
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
        grad.addColorStop(0, glowColor + 'cc');
        grad.addColorStop(0.4, glowColor + '55');
        grad.addColorStop(1, glowColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // ===== 子弹主体 =====
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = this.color;

        if (this.type === 'pierce') {
            // 穿甲弹：拉长光束
            const v = Utils.dirVec(this.dir);
            ctx.translate(this.x, this.y);
            ctx.rotate(Math.atan2(v.y, v.x));
            ctx.fillRect(-10, -this.size/2, 20, this.size);
        } else {
            // 普通弹：圆点
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            // 内核高亮
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // 按类型返回光晕颜色：普通=蓝 / 穿甲=紫 / Boss=红
    _glowColor() {
        if (this.owner === 'boss') return '#ff0080';
        if (this.type === 'pierce') return '#b44dff';
        if (this.owner === 'enemy') return '#ff2a5a';
        return '#00d4ff';
    }
}

/* ---------- 子弹管理器（对象池） ---------- */
class BulletPool {
    constructor(max = 200) {
        this.pool = [];
        for (let i = 0; i < max; i++) this.pool.push(new Bullet());
        this.max = max;
    }

    spawn(opts) {
        for (let i = 0; i < this.max; i++) {
            if (!this.pool[i].active) return this.pool[i].init(opts);
        }
        return null;
    }

    update(dt, game) {
        for (let i = 0; i < this.max; i++) this.pool[i].update(dt, game);
    }

    draw(ctx) {
        for (let i = 0; i < this.max; i++) this.pool[i].draw(ctx);
    }

    clear() {
        for (let i = 0; i < this.max; i++) this.pool[i].active = false;
    }

    // 获取所有活跃子弹（用于碰撞检测）
    active() {
        const arr = [];
        for (let i = 0; i < this.max; i++) if (this.pool[i].active) arr.push(this.pool[i]);
        return arr;
    }
}

/* ---------- 地雷 ---------- */
class Mine {
    constructor(x, y, owner = 'player') {
        this.x = x; this.y = y;
        this.owner = owner;
        this.size = 12;
        this.armed = false;     // 是否已激活（放置后短延迟激活）
        this.armTimer = 500;
        this.dead = false;
        this.pulse = 0;
    }

    update(dt, game) {
        if (this.dead) return;
        this.pulse += dt * 0.008;
        if (!this.armed) {
            this.armTimer -= dt;
            if (this.armTimer <= 0) this.armed = true;
            return;
        }
        // 检测附近敌人
        const r = 24;
        if (this.owner === 'player') {
            for (const e of game.enemies) {
                if (Utils.distSq(this.x, this.y, e.x, e.y) < r * r) {
                    this.detonate(game);
                    return;
                }
            }
            if (game.boss && Utils.distSq(this.x, this.y, game.boss.x, game.boss.y) < r * r) {
                this.detonate(game);
                return;
            }
        } else {
            // 敌方地雷炸玩家
            const p = game.player;
            if (p && p.alive && Utils.distSq(this.x, this.y, p.x, p.y) < r * r) {
                this.detonate(game);
            }
        }
    }

    detonate(game) {
        this.dead = true;
        // 爆炸范围伤害
        const radius = 50;
        game.particles.explode(this.x, this.y, '#ff7a00', 1.3);
        game.screenShake(6, 'mid');
        if (this.owner === 'player') {
            for (const e of game.enemies) {
                if (Utils.dist(this.x, this.y, e.x, e.y) < radius) {
                    e.takeDamage(3, game);
                }
            }
            if (game.boss && Utils.dist(this.x, this.y, game.boss.x, game.boss.y) < radius) {
                game.boss.takeDamage(4, game);
            }
        } else {
            const p = game.player;
            if (p && p.alive && Utils.dist(this.x, this.y, p.x, p.y) < radius) {
                p.takeDamage(1, game);
            }
        }
    }

    draw(ctx) {
        if (this.dead) return;
        ctx.save();
        const blink = this.armed ? (0.5 + 0.5 * Math.sin(this.pulse * 4)) : 0.3;
        ctx.globalAlpha = 0.6 + blink * 0.4;
        ctx.fillStyle = '#ff2a5a';
        ctx.shadowColor = '#ff2a5a';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe600';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
