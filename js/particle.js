/* ============================================================
   particle.js — 粒子特效系统
   使用对象池复用，避免频繁 GC
   类型：火花、火焰、碎片、冲击波、尾焰、飘字
   ============================================================ */

class Particle {
    constructor() {
        this.active = false;
        this.reset();
    }

    reset() {
        this.x = 0; this.y = 0;
        this.x2 = 0; this.y2 = 0;
        this.vx = 0; this.vy = 0;
        this.life = 0;       // 剩余寿命 ms
        this.maxLife = 1;
        this.size = 2;
        this.color = '#fff';
        this.type = 'spark'; // spark | flame | debris | shock | text | trail | lightning
        this.gravity = 0;
        this.text = '';
        this.rotation = 0;
        this.rotSpeed = 0;
        this.growth = 0;     // 冲击波膨胀速度
    }

    /* 初始化一个粒子并激活 */
    init(opts) {
        this.active = true;
        this.x = opts.x; this.y = opts.y;
        this.x2 = opts.x2 !== undefined ? opts.x2 : opts.x;
        this.y2 = opts.y2 !== undefined ? opts.y2 : opts.y;
        this.vx = opts.vx || 0; this.vy = opts.vy || 0;
        this.life = opts.life;
        this.maxLife = opts.life;
        this.size = opts.size || 2;
        this.color = opts.color || '#fff';
        this.type = opts.type || 'spark';
        this.gravity = opts.gravity || 0;
        this.text = opts.text || '';
        this.rotation = opts.rotation || 0;
        this.rotSpeed = opts.rotSpeed || 0;
        this.growth = opts.growth || 0;
        return this;
    }

    update(dt) {
        if (!this.active) return;
        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }
        this.x += this.vx * dt * 0.06;
        this.y += this.vy * dt * 0.06;
        this.vy += this.gravity * dt * 0.06;
        // 尾焰/碎片有摩擦
        if (this.type === 'flame' || this.type === 'debris' || this.type === 'trail') {
            this.vx *= 0.96; this.vy *= 0.96;
        }
        if (this.type === 'shock') {
            this.size += this.growth * dt * 0.06;
        }
        this.rotation += this.rotSpeed * dt * 0.06;
    }

    draw(ctx) {
        if (!this.active) return;
        const t = this.life / this.maxLife; // 0~1
        ctx.save();
        switch (this.type) {
            case 'spark': {
                ctx.globalAlpha = t;
                ctx.fillStyle = this.color;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 8;
                ctx.fillRect(this.x - this.size/2, this.y - this.size/2, this.size, this.size);
                break;
            }
            case 'flame': {
                ctx.globalAlpha = t * 0.9;
                ctx.fillStyle = this.color;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * t, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'debris': {
                ctx.globalAlpha = t;
                ctx.fillStyle = this.color;
                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);
                ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size * 0.6);
                break;
            }
            case 'shock': {
                ctx.globalAlpha = t * 0.5;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case 'trail': {
                ctx.globalAlpha = t * 0.6;
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * t, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'lightning': {
                // 锯齿状闪电：从 (x,y) 到 (x2,y2)
                ctx.globalAlpha = t;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 12;
                const segs = 6;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                for (let i = 1; i < segs; i++) {
                    const f = i / segs;
                    const jx = this.x + (this.x2 - this.x) * f + (Math.random() - 0.5) * 12;
                    const jy = this.y + (this.y2 - this.y) * f + (Math.random() - 0.5) * 12;
                    ctx.lineTo(jx, jy);
                }
                ctx.lineTo(this.x2, this.y2);
                ctx.stroke();
                // 内核白光
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
                break;
            }
            case 'text': {
                ctx.globalAlpha = t;
                ctx.fillStyle = this.color;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 10;
                ctx.font = 'bold 18px Segoe UI, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this.text, this.x, this.y - (1 - t) * 30);
                break;
            }
        }
        ctx.restore();
    }
}

/* ---------- 粒子系统（对象池） ---------- */
class ParticleSystem {
    constructor(max = CONFIG.PARTICLE.maxParticles) {
        this.pool = [];
        for (let i = 0; i < max; i++) this.pool.push(new Particle());
        this.max = max;
    }

    // 从池中取一个可用粒子
    spawn(opts) {
        for (let i = 0; i < this.max; i++) {
            if (!this.pool[i].active) {
                return this.pool[i].init(opts);
            }
        }
        return null; // 池满则丢弃
    }

    update(dt) {
        for (let i = 0; i < this.max; i++) {
            this.pool[i].update(dt);
        }
    }

    draw(ctx) {
        for (let i = 0; i < this.max; i++) {
            this.pool[i].draw(ctx);
        }
    }

    /* ---------- 预设特效工厂 ---------- */
    // 爆炸：碎片 + 火焰 + 冲击波
    explode(x, y, color = '#ff7a00', scale = 1) {
        // 碎片
        const debrisCount = Math.floor(10 * scale);
        for (let i = 0; i < debrisCount; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Utils.rand(2, 6) * scale;
            this.spawn({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: Utils.rand(400, 800), size: Utils.rand(3, 6) * scale,
                color: '#5a5a6a', type: 'debris',
                rotation: Math.random() * 6, rotSpeed: Utils.rand(-0.3, 0.3),
            });
        }
        // 火焰
        const flameCount = Math.floor(14 * scale);
        for (let i = 0; i < flameCount; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Utils.rand(1, 4) * scale;
            this.spawn({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: Utils.rand(300, 600), size: Utils.rand(6, 12) * scale,
                color, type: 'flame',
            });
        }
        // 冲击波
        this.spawn({
            x, y, life: 400, size: 10 * scale, color, type: 'shock',
            growth: 1.5 * scale,
        });
        // 火花
        for (let i = 0; i < 8 * scale; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Utils.rand(3, 8) * scale;
            this.spawn({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: Utils.rand(200, 400), size: 2, color: '#ffe600', type: 'spark',
            });
        }
    }

    // 命中火花
    hitSpark(x, y, color = '#ffe600') {
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Utils.rand(1, 4);
            this.spawn({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: Utils.rand(150, 300), size: 2, color, type: 'spark',
            });
        }
    }

    // 炮口火焰
    muzzleFlash(x, y, dirVec) {
        for (let i = 0; i < 5; i++) {
            const spread = Utils.rand(-0.4, 0.4);
            const a = Math.atan2(dirVec.y, dirVec.x) + spread;
            const sp = Utils.rand(2, 5);
            this.spawn({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: Utils.rand(120, 240), size: Utils.rand(3, 6),
                color: '#ffcc33', type: 'flame',
            });
        }
    }

    // 坦克尾焰
    exhaust(x, y, color) {
        this.spawn({
            x, y, vx: Utils.rand(-0.5, 0.5), vy: Utils.rand(-0.5, 0.5),
            life: Utils.rand(150, 300), size: Utils.rand(2, 4),
            color, type: 'trail',
        });
    }

    // 履带尘土：灰色小点，从履带位置喷出并缓慢沉降
    trackDust(x, y, dirVec, intensity = 1) {
        const count = intensity > 0.5 ? 2 : 1;
        for (let i = 0; i < count; i++) {
            // 垂直于行进方向偏移（模拟两侧履带）
            const perpX = -dirVec.y;
            const perpY = dirVec.x;
            const side = Utils.rand(-1, 1) * 6;
            this.spawn({
                x: x + perpX * side,
                y: y + perpY * side,
                vx: -dirVec.x * Utils.rand(0.2, 0.6) + Utils.rand(-0.3, 0.3),
                vy: -dirVec.y * Utils.rand(0.2, 0.6) + Utils.rand(-0.3, 0.3),
                life: Utils.rand(250, 450),
                size: Utils.rand(1.5, 3),
                color: Utils.pick(['#6a6a6a', '#7a7060', '#5a5550']),
                type: 'trail',
            });
        }
    }

    // 飘字（+100 等）
    floatText(x, y, text, color = '#00ffcc') {
        this.spawn({
            x, y, life: 900, size: 18, color, type: 'text', text,
        });
    }

    // 连锁闪电：从 (x1,y1) 到 (x2,y2) 的锯齿电弧
    lightning(x1, y1, x2, y2, color = '#00ffcc') {
        this.spawn({
            x: x1, y: y1, x2, y2, life: 180, size: 2, color, type: 'lightning',
        });
    }
}
