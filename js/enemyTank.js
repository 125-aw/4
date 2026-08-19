/* ============================================================
   enemyTank.js — 敌方坦克 AI（有限状态机）
   类型：light(普通/巡逻) / mid(快速/追踪) / heavy(装甲/穿甲) / smart(智能/预判)
   状态：PATROL → CHASE → SHOOT → DODGE → SMART
   生成采用工厂模式，便于新增类型
   ============================================================ */

const ENEMY_STATE = { PATROL: 0, CHASE: 1, SHOOT: 2, DODGE: 3, SMART: 4 };

class EnemyTank {
    constructor(x, y, type, waveLevel) {
        const cfg = CONFIG.ENEMIES[type];
        this.type = type;
        this.config = cfg;
        // 难度随波数提升
        const waveScale = 1 + (waveLevel - 1) * 0.08;
        this.hp = Math.ceil(cfg.hp * waveScale);
        this.maxHp = this.hp;
        this.speed = cfg.speed * (1 + (waveLevel - 1) * 0.03);
        this.size = cfg.size;
        this.color = cfg.color;
        this.score = cfg.score;
        this.ai = cfg.ai;
        this.canPierce = !!cfg.pierce;
        this.bulletDamage = cfg.bulletDamage;

        this.x = x; this.y = y;
        this.dir = Utils.DIR.DOWN;
        this.state = this.ai === 'chase' ? ENEMY_STATE.CHASE
                   : this.ai === 'smart' ? ENEMY_STATE.SMART
                   : ENEMY_STATE.PATROL;
        this.alive = true;

        this.lastFire = Utils.now() + Utils.rand(0, cfg.fireInterval);
        this.fireInterval = cfg.fireInterval;

        // 巡逻计时
        this.patrolTimer = Utils.randInt(800, 2000);
        this.targetDir = this.dir;

        // 躲避计时
        this.dodgeTimer = 0;

        // 智能型：预判/扫射计时
        this.strafeTimer = 0;
        this.strafeDir = Utils.randInt(0, 1) ? 1 : -1;

        this.trackPhase = 0;
        this.spawnFade = 0; // 出生淡入

        // 嘲讽气泡
        this.tauntCooldown = Utils.randInt(2000, 6000);
        this.tauntText = null;
        this.tauntTime = 0;

        // 延迟爆炸死亡动画：dying=true 时进入濒死序列
        // 0~100ms 炮管飞起 → 100~300ms 车体闪烁 → 300~500ms 闪烁加剧 → 500ms 剧烈爆炸
        this.dying = false;
        this._deathAnim = 0;
        this._barrelFly = 0;   // 飞起的炮管动画偏移

        // 智能型预判射击可视化：瞄准圈预警
        // _aimTarget = {x,y} 时正在瞄准玩家，_aimTimer 倒计时到 0 后开火
        this._aimTarget = null;
        this._aimTimer = 0;
        this._aimFireDir = -1;
    }

    /* ---------- 受伤 ---------- */
    takeDamage(dmg, game, bullet) {
        if (!this.alive || this.dying) return;
        this.hp -= dmg;
        game.particles.hitSpark(this.x, this.y, this.color);
        if (this.hp <= 0) {
            // ===== 进入延迟爆炸死亡序列（不立即消失）=====
            this.dying = true;
            this._deathAnim = 0;
            // 立即结算击杀奖励/掉落/连杀统计（保持原有节奏）
            game.onEnemyKilled(this, bullet);
            // 轻微爆炸 + 中震作为"起手"
            game.particles.explode(this.x, this.y, this.color, 0.6);
            game.screenShake(2, 'small');
        } else {
            // 受击有概率进入躲避 + 嘲讽（被打了嘴贱）
            if (Utils.chance(0.25)) {
                this.state = ENEMY_STATE.DODGE;
                this.dodgeTimer = 600;
            }
            if (Utils.chance(0.25)) this.sayTaunt('hit');
        }
    }

    /* ---------- 说一句嘲讽（事件：born / shoot / hit / chase） ---------- */
    sayTaunt(event) {
        if (this.tauntTime > 0) return; // 正在显示中，不叠加
        const pool = CONFIG.TAUNTS[this.type] || CONFIG.TAUNTS.light;
        // 不同事件选不同倾向文案
        this.tauntText = Utils.pick(pool);
        this.tauntTime = 2400; // 与 CSS 动画时长匹配
    }

    /* ---------- AI 更新 ---------- */
    update(dt, game) {
        // ===== 濒死序列：推进死亡动画，500ms 后剧烈爆炸并真正死亡 =====
        if (this.dying) {
            this._deathAnim += dt;
            // 炮管飞起偏移（0~100ms 上升，之后继续飞出）
            this._barrelFly = Math.min(40, this._deathAnim * 0.4);
            if (this._deathAnim >= 500) {
                // 剧烈爆炸：分层粒子（火花 + 烟雾 + 闪光）
                game.particles.explode(this.x, this.y, this.color, 1.4);
                game.particles.explode(this.x, this.y, '#ff7a00', 1.0);
                game.particles.hitSpark(this.x, this.y, '#ffe600');
                game.screenShake(4, 'mid');
                game.soundSpatial('explode', this.x, this.y);
                this.alive = false;
                this.dying = false;
            }
            return;
        }
        if (!this.alive) return;
        if (this.spawnFade < 1) this.spawnFade = Math.min(1, this.spawnFade + dt * 0.003);

        // EMP 瘫痪：停止移动与射击
        if (this.empTime && this.empTime > 0) {
            this.empTime -= dt;
            // 闪烁视觉
            if (Math.random() < 0.3) game.particles.hitSpark(this.x, this.y, '#b44dff');
            return;
        }

        // 嘲讽计时
        if (this.tauntTime > 0) this.tauntTime -= dt;
        this.tauntCooldown -= dt;
        if (this.tauntCooldown <= 0) {
            // 随机嘴贱（射击/追踪时概率更高）
            if (this.state === ENEMY_STATE.SHOOT || this.state === ENEMY_STATE.CHASE) {
                if (Utils.chance(0.35)) this.sayTaunt();
            } else if (Utils.chance(0.12)) {
                this.sayTaunt();
            }
            this.tauntCooldown = Utils.randInt(4000, 9000);
        }

        const player = game.player;

        // 玩家在草丛中时无法被追踪/瞄准
        const playerHidden = player && player.alive &&
            game.obstacles.isInGrass(player.x, player.y);

        // 状态切换
        this.updateState(dt, game, playerHidden);

        // 移动
        this.move(dt, game);

        // 射击
        this.tryFire(game, playerHidden);
    }

    updateState(dt, game, playerHidden) {
        const player = game.player;
        switch (this.state) {
            case ENEMY_STATE.PATROL: {
                this.patrolTimer -= dt;
                if (this.patrolTimer <= 0) {
                    // 随机换方向
                    this.targetDir = Utils.randInt(0, 3);
                    this.patrolTimer = Utils.randInt(800, 2000);
                }
                // 轻型偶尔追踪玩家
                if (!playerHidden && player && player.alive &&
                    Utils.dist(this.x, this.y, player.x, player.y) < 200) {
                    this.state = ENEMY_STATE.CHASE;
                }
                break;
            }
            case ENEMY_STATE.CHASE: {
                if (playerHidden || !player || !player.alive) {
                    this.state = ENEMY_STATE.PATROL;
                    this.patrolTimer = 1000;
                    break;
                }
                // 朝玩家方向移动（取较大轴）
                const dx = player.x - this.x;
                const dy = player.y - this.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.targetDir = dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT;
                } else {
                    this.targetDir = dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP;
                }
                // 距离很近时进入射击状态
                if (Utils.dist(this.x, this.y, player.x, player.y) < 150) {
                    this.state = ENEMY_STATE.SHOOT;
                }
                break;
            }
            case ENEMY_STATE.SHOOT: {
                if (playerHidden || !player || !player.alive) {
                    this.state = ENEMY_STATE.PATROL;
                    break;
                }
                const dx = player.x - this.x;
                const dy = player.y - this.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.targetDir = dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT;
                } else {
                    this.targetDir = dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP;
                }
                // 玩家跑远了，回到追踪
                if (Utils.dist(this.x, this.y, player.x, player.y) > 260) {
                    this.state = ENEMY_STATE.CHASE;
                }
                break;
            }
            case ENEMY_STATE.DODGE: {
                this.dodgeTimer -= dt;
                // 横向躲避：垂直于到玩家方向
                if (player && player.alive) {
                    const dx = player.x - this.x;
                    const dy = player.y - this.y;
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.targetDir = dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP;
                    } else {
                        this.targetDir = dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT;
                    }
                }
                if (this.dodgeTimer <= 0) this.state = ENEMY_STATE.CHASE;
                break;
            }
            case ENEMY_STATE.SMART: {
                // 智能型：丢失目标则巡逻
                if (playerHidden || !player || !player.alive) {
                    this.state = ENEMY_STATE.PATROL;
                    this.patrolTimer = 1000;
                    break;
                }
                // 预判玩家位置：以玩家速度向量外推 leadTime
                const pv = this.estimatePlayerVel(game);
                const lead = 12; // 帧
                const predX = player.x + pv.x * lead;
                const predY = player.y + pv.y * lead;
                const dx = predX - this.x;
                const dy = predY - this.y;
                // 周期性横切走位，避免直线送死
                this.strafeTimer -= dt;
                if (this.strafeTimer <= 0) {
                    this.strafeTimer = Utils.randInt(600, 1200);
                    this.strafeDir *= -1;
                }
                // 主轴对准预判点；当已近似对齐时改为横切以保持火力线
                const alignedX = Math.abs(dy) < 24;   // 与玩家同行 → 可横向开火
                const alignedY = Math.abs(dx) < 24;   // 与玩家同列 → 可纵向开火
                if (alignedY) {
                    this.targetDir = dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP;
                } else if (alignedX) {
                    this.targetDir = dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT;
                } else if (Math.abs(dx) > Math.abs(dy)) {
                    // 走主轴，偶尔横切
                    this.targetDir = (this.strafeDir > 0)
                        ? (dy >= 0 ? Utils.DIR.DOWN : Utils.DIR.UP)
                        : (dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT);
                } else {
                    this.targetDir = (this.strafeDir > 0)
                        ? (dx >= 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT)
                        : (dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP);
                }
                break;
            }
        }
        this.dir = this.targetDir;
    }

    /* ---------- 估算玩家速度向量（用于智能型预判） ---------- */
    estimatePlayerVel(game) {
        const p = game.player;
        if (!p) return { x: 0, y: 0 };
        // 玩家面向方向即主流移动方向；加速时速度更大
        const v = Utils.dirVec(p.dir);
        const spd = p.boosting ? (p._boostSpeed || 4) : (p._speed || 2.4);
        // 若玩家未移动（无输入），速度为 0
        if (!p.moving) return { x: 0, y: 0 };
        return { x: v.x * spd, y: v.y * spd };
    }

    move(dt, game) {
        const v = Utils.dirVec(this.dir);
        let speed = this.speed;
        const slow = game.obstacles.waterSlowAt(this.x, this.y);
        speed *= slow;

        const dx = v.x * speed * dt * 0.06;
        const dy = v.y * speed * dt * 0.06;

        // 尝试移动，撞墙则换方向
        const moved = this.tryMove(dx, dy, game);
        if (!moved) {
            // 撞墙换方向
            this.targetDir = Utils.randInt(0, 3);
            this.patrolTimer = Utils.randInt(500, 1500);
        }

        this.trackPhase += speed * dt * 0.01;

        // 边界
        const half = this.size / 2;
        this.x = Utils.clamp(this.x, half, CONFIG.CANVAS_W - half);
        this.y = Utils.clamp(this.y, half, CONFIG.CANVAS_H - half);
    }

    tryMove(dx, dy, game) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        const rect = Utils.rect(nx, ny, this.size, this.size);
        if (game.obstacles.collidesWithTank(rect)) return false;
        // 与其他敌人碰撞（跳过 dying 状态的敌人）
        for (const e of game.enemies) {
            if (e === this || !e.alive || e.dying) continue;
            if (Utils.aabb(rect, Utils.rect(e.x, e.y, e.size, e.size))) return false;
        }
        // 与 Boss 碰撞
        if (game.boss && Utils.aabb(rect, Utils.rect(game.boss.x, game.boss.y, game.boss.size, game.boss.size))) return false;
        // 与玩家碰撞
        if (game.player && game.player.alive &&
            Utils.aabb(rect, Utils.rect(game.player.x, game.player.y, game.player.size, game.player.size))) return false;
        this.x = nx; this.y = ny;
        return true;
    }

    tryFire(game, playerHidden) {
        const now = Utils.now();
        if (now - this.lastFire < this.fireInterval) return;
        // 巡逻状态射击频率低
        if (this.state === ENEMY_STATE.PATROL && Utils.chance(0.6)) {
            this.lastFire = now + 500;
            return;
        }
        // 玩家隐身则不射击
        if (playerHidden) {
            this.lastFire = now;
            return;
        }

        // 智能型：仅在与玩家近似对齐（同行/同列）时开火，且瞄准预判方向
        // ===== 预判圈可视化：先瞄准 0.5s（玩家脚下红圈），再射击 =====
        if (this.ai === 'smart') {
            const player = game.player;
            if (!player || !player.alive) { this._aimTarget = null; this.lastFire = now; return; }
            // 正在瞄准中：倒计时到 0 后开火
            if (this._aimTarget) {
                this._aimTimer -= 16; // 近似 dt（tryFire 每帧调用）
                if (this._aimTimer > 0) return;
                // 倒计时结束 → 发射
                const fireDir = this._aimFireDir;
                this._aimTarget = null;
                this.lastFire = now;
                this.dir = fireDir;
                const v = Utils.dirVec(fireDir);
                const bx = this.x + v.x * (this.size / 2 + 4);
                const by = this.y + v.y * (this.size / 2 + 4);
                game.bullets.spawn({
                    x: bx, y: by, dir: fireDir,
                    speed: CONFIG.BULLET.enemySpeed * 1.15, // 智能型弹速略快
                    damage: this.bulletDamage,
                    owner: 'enemy', type: 'normal',
                    color: '#00ffcc', size: CONFIG.BULLET.size,
                });
                game.particles.muzzleFlash(bx, by, v);
                return;
            }
            // 未在瞄准：检测是否与玩家对齐
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            let fireDir = -1;
            if (Math.abs(dx) < 22 && Math.abs(dy) > 30) {
                fireDir = dy > 0 ? Utils.DIR.DOWN : Utils.DIR.UP;
            } else if (Math.abs(dy) < 22 && Math.abs(dx) > 30) {
                fireDir = dx > 0 ? Utils.DIR.RIGHT : Utils.DIR.LEFT;
            }
            if (fireDir < 0) { this.lastFire = now + 200; return; } // 不在火力线上，稍后再试
            // 开始瞄准：标记玩家位置，500ms 后射击（给玩家走位躲避的时间）
            this._aimTarget = { x: player.x, y: player.y };
            this._aimTimer = 500;
            this._aimFireDir = fireDir;
            this.dir = fireDir; // 转向玩家
            this.lastFire = now;
            return;
        }

        this.lastFire = now;
        const v = Utils.dirVec(this.dir);
        const bx = this.x + v.x * (this.size / 2 + 4);
        const by = this.y + v.y * (this.size / 2 + 4);
        game.bullets.spawn({
            x: bx, y: by, dir: this.dir,
            speed: CONFIG.BULLET.enemySpeed,
            damage: this.bulletDamage,
            owner: 'enemy',
            type: this.canPierce ? 'pierce' : 'normal',
            pierceLeft: this.canPierce ? 2 : 0,
            color: this.canPierce ? '#b44dff' : '#ff6680',
            size: this.canPierce ? 5 : CONFIG.BULLET.size,
        });
        game.particles.muzzleFlash(bx, by, v);
    }

    /* ---------- 渲染 ---------- */
    draw(ctx) {
        if (!this.alive) return;
        const half = this.size / 2;
        const c = this.color;
        ctx.save();
        ctx.translate(this.x, this.y);

        // ===== 濒死序列视觉效果 =====
        // 0~100ms：炮管飞起；100~300ms：车体闪烁；300~500ms：闪烁加剧+变红
        let dyingAlpha = 1;
        let dyingTint = null;   // 濒死后期叠加红色
        if (this.dying) {
            const t = this._deathAnim;
            if (t < 100) {
                // 起手：轻微抖动
                ctx.translate(Utils.rand(-1, 1), Utils.rand(-1, 1));
            } else if (t < 300) {
                // 闪烁（0.5↔1）
                dyingAlpha = (Math.floor(t / 60) % 2) ? 0.5 : 1;
            } else {
                // 闪烁加剧 + 红色染色
                dyingAlpha = (Math.floor(t / 40) % 2) ? 0.3 : 1;
                dyingTint = '#ff2a5a';
            }
        }
        ctx.globalAlpha = this.spawnFade * dyingAlpha;

        const angles = [0, 90, 180, 270];
        ctx.rotate(angles[this.dir] * Math.PI / 180);

        // === 履带 ===
        const trackW = 6;
        ctx.fillStyle = '#1a0a14';
        ctx.fillRect(-half, -half + 2, trackW, this.size - 4);
        ctx.fillRect(half - trackW, -half + 2, trackW, this.size - 4);
        ctx.fillStyle = '#3a1a2a';
        const off = (this.trackPhase % 1) * 6;
        for (let i = -half + 2 + off; i < half - 2; i += 6) {
            ctx.fillRect(-half + 1, i, trackW - 2, 3);
            ctx.fillRect(half - trackW + 1, i, trackW - 2, 3);
        }
        // 侧裙
        ctx.fillStyle = '#200a18';
        ctx.fillRect(-half - 1, -half + 4, trackW + 2, this.size * 0.3);
        ctx.fillRect(half - trackW - 1, -half + 4, trackW + 2, this.size * 0.3);
        ctx.strokeStyle = c + '40';
        ctx.lineWidth = 1;
        ctx.strokeRect(-half - 1, -half + 4, trackW + 2, this.size * 0.3);
        ctx.strokeRect(half - trackW - 1, -half + 4, trackW + 2, this.size * 0.3);

        // === 车身（斜切装甲） ===
        const bw = this.size - trackW * 2;
        const bx = -bw / 2;
        const by = -half + 3;
        const bh = this.size - 6;
        const cut = 4;
        ctx.fillStyle = '#180818';
        ctx.beginPath();
        ctx.moveTo(bx + cut, by);
        ctx.lineTo(bx + bw - cut, by);
        ctx.lineTo(bx + bw, by + cut);
        ctx.lineTo(bx + bw, by + bh - cut);
        ctx.lineTo(bx + bw - cut, by + bh);
        ctx.lineTo(bx + cut, by + bh);
        ctx.lineTo(bx, by + bh - cut);
        ctx.lineTo(bx, by + cut);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.shadowColor = c;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 装甲分割线
        ctx.strokeStyle = c + '25';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by + bh * 0.4);
        ctx.lineTo(bx + bw - 2, by + bh * 0.4);
        ctx.stroke();

        // 前装甲高光
        ctx.fillStyle = c + '15';
        ctx.beginPath();
        ctx.moveTo(bx + cut, by);
        ctx.lineTo(bx + bw - cut, by);
        ctx.lineTo(bx + bw - cut - 2, by + 3);
        ctx.lineTo(bx + cut + 2, by + 3);
        ctx.closePath();
        ctx.fill();

        // === 炮塔（双层） ===
        ctx.fillStyle = '#2a0a1e';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.shadowColor = c;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 内环
        ctx.fillStyle = '#3a1428';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c + '60';
        ctx.lineWidth = 1;
        ctx.stroke();

        // === 炮管 ===
        const bW = 4;
        const bLen = half + 4;
        if (this.dying && this._deathAnim > 80) {
            // 濒死：炮管飞起脱出（向上位移 + 旋转）
            ctx.save();
            ctx.translate(0, -this._barrelFly);
            ctx.rotate(this._deathAnim * 0.01);
            ctx.fillStyle = '#1a0a14';
            ctx.fillRect(-bW/2 - 1, -bLen, bW + 2, bLen - 4);
            ctx.fillStyle = c;
            ctx.shadowColor = c;
            ctx.shadowBlur = 6;
            ctx.fillRect(-bW/2, -bLen, bW, bLen - 4);
            ctx.shadowBlur = 0;
            ctx.restore();
        } else {
            ctx.fillStyle = '#1a0a14';
            ctx.fillRect(-bW/2 - 1, -bLen, bW + 2, bLen - 4);
            ctx.fillStyle = c;
            ctx.shadowColor = c;
            ctx.shadowBlur = 6;
            ctx.fillRect(-bW/2, -bLen, bW, bLen - 4);
            ctx.shadowBlur = 0;
            // 炮口
            ctx.fillStyle = '#0a0010';
            ctx.fillRect(-bW/2 - 2, -bLen - 1, bW + 4, 5);
            ctx.strokeStyle = c + '80';
            ctx.lineWidth = 1;
            ctx.strokeRect(-bW/2 - 2, -bLen - 1, bW + 4, 5);
        }

        // 重型坦克双炮管（侧翼副炮）
        if (this.type === 'heavy') {
            ctx.fillStyle = c + 'a0';
            ctx.fillRect(-half + 3, -half - 1, 3, half * 0.35);
            ctx.fillRect(half - 6, -half - 1, 3, half * 0.35);
            // 副炮口
            ctx.fillStyle = '#000';
            ctx.fillRect(-half + 3, -half - 1, 3, 2);
            ctx.fillRect(half - 6, -half - 1, 3, 2);
        }

        // === 敌方核心（红色"眼睛"） ===
        const eyePulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.008);
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = 8 * eyePulse;
        ctx.beginPath();
        ctx.arc(0, 0, 3 * eyePulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 智能型：扫描雷达环 + 双核心
        if (this.type === 'smart') {
            const sweep = Utils.now() * 0.004;
            ctx.strokeStyle = c + '90';
            ctx.lineWidth = 1.2;
            ctx.shadowColor = c;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(0, 0, half * 0.62, sweep, sweep + Math.PI * 0.8);
            ctx.stroke();
            ctx.shadowBlur = 0;
            // 双核心小点
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(-3, 0, 1.6, 0, Math.PI * 2);
            ctx.arc(3, 0, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }

        // 散热栅格
        ctx.strokeStyle = c + '40';
        ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
            const ly = by + bh - 6 - i * 3;
            ctx.beginPath();
            ctx.moveTo(bx + 3, ly);
            ctx.lineTo(bx + bw - 3, ly);
            ctx.stroke();
        }

        // 濒死后期：红色染色叠加（即将爆炸的预警）
        if (dyingTint) {
            ctx.fillStyle = dyingTint + '60';
            ctx.fillRect(-half, -half, this.size, this.size);
        }

        ctx.restore();

        // 血条（受伤时显示，濒死序列中隐藏）
        if (this.hp < this.maxHp && !this.dying) {
            const w = this.size;
            const ratio = this.hp / this.maxHp;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(this.x - w/2, this.y - half - 8, w, 3);
            ctx.fillStyle = ratio > 0.5 ? '#00ffcc' : (ratio > 0.25 ? '#ffe600' : '#ff2a5a');
            ctx.fillRect(this.x - w/2, this.y - half - 8, w * ratio, 3);
            ctx.restore();
        }

        // ===== 智能型预判圈：在玩家脚下绘制红色瞄准圈（0.5s 倒计时）=====
        if (this._aimTarget) {
            const t = this._aimTimer;
            const progress = 1 - (t / 500); // 0→1 越接近开火
            const r = 18 + progress * 6;
            const alpha = 0.4 + progress * 0.5;
            ctx.save();
            ctx.strokeStyle = `rgba(255, 42, 90, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.shadowColor = '#ff2a5a';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(this._aimTarget.x, this._aimTarget.y, r, 0, Math.PI * 2);
            ctx.stroke();
            // 收缩内圈（倒计时进度）
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this._aimTarget.x, this._aimTarget.y, r * (1 - progress * 0.7),
                    -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
            ctx.stroke();
            // 中心十字准星
            ctx.beginPath();
            ctx.moveTo(this._aimTarget.x - 4, this._aimTarget.y);
            ctx.lineTo(this._aimTarget.x + 4, this._aimTarget.y);
            ctx.moveTo(this._aimTarget.x, this._aimTarget.y - 4);
            ctx.lineTo(this._aimTarget.x, this._aimTarget.y + 4);
            ctx.stroke();
            ctx.restore();
        }
    }
}

/* ---------- 敌人工厂 ---------- */
const EnemyFactory = {
    // 根据波数生成一个敌人（四类型：普通/快速/装甲/智能）
    create(waveLevel) {
        // 波数越高，装甲与智能型越多
        let type;
        const r = Math.random();
        if (waveLevel <= 2) {
            type = r < 0.7 ? 'light' : 'mid';
        } else if (waveLevel <= 5) {
            type = r < 0.45 ? 'light' : (r < 0.8 ? 'mid' : 'heavy');
        } else if (waveLevel <= 9) {
            // 第6波起出现智能型
            type = r < 0.3 ? 'light' : (r < 0.6 ? 'mid' : (r < 0.85 ? 'heavy' : 'smart'));
        } else {
            // 后期智能型占比提升
            type = r < 0.2 ? 'light' : (r < 0.45 ? 'mid' : (r < 0.75 ? 'heavy' : 'smart'));
        }
        // 生成位置：上/左/右边缘
        const side = Utils.randInt(0, 2);
        let x, y;
        const margin = 40;
        if (side === 0) { x = Utils.rand(margin, CONFIG.CANVAS_W - margin); y = margin; }
        else if (side === 1) { x = margin; y = Utils.rand(margin, CONFIG.CANVAS_H/2); }
        else { x = CONFIG.CANVAS_W - margin; y = Utils.rand(margin, CONFIG.CANVAS_H/2); }
        return new EnemyTank(x, y, type, waveLevel);
    },
};
