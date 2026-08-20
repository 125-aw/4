/* ============================================================
   bossTank.js — Boss 坦克（多阶段、多武器）
   阶段1 (HP>60%)：缓慢移动 + 主炮普通弹 + 偶尔地雷
   阶段2 (HP 30~60%)：加速 + 周期性护盾 + 散弹
   阶段3 (HP<30%)：狂暴 + 全屏激光扫描 + 召唤小兵
   ============================================================ */

const BOSS_PHASE = { P1: 1, P2: 2, P3: 3 };

class BossTank {
    constructor(x, y, type = 'siege') {
        this.bossType = type; // 'siege' | 'carrier'
        const tcfg = CONFIG.BOSS.types[type] || CONFIG.BOSS.types.siege;
        this.x = x; this.y = y;
        this.size = CONFIG.BOSS.size;
        this.hp = tcfg.hp;
        this.maxHp = tcfg.hp;
        this.speed = CONFIG.BOSS.speed;
        this.score = tcfg.score;
        this.color = tcfg.color;
        this.alive = true;

        this.phase = BOSS_PHASE.P1;
        this.dir = Utils.DIR.DOWN;

        // 主炮射击
        this.lastFire = 0;

        // 护盾（阶段2）
        this.shieldActive = false;
        this.shieldTimer = 0;     // 护盾剩余时间
        this.shieldCooldown = 0;  // 护盾冷却（脆弱窗口）
        this.shieldDuration = 3000;
        this.shieldCooldownDuration = 2500;

        // 激光（阶段3）
        this.laserState = 'idle'; // idle | charging | active
        this.laserTimer = 0;
        this.laserAngle = 0;      // 激光朝向（弧度）
        this.laserSweepDir = 1;

        // 召唤小兵（阶段3）
        this.lastSummon = 0;

        // 移动方向计时
        this.moveTimer = 0;
        this.targetDir = Utils.DIR.DOWN;

        this.trackPhase = 0;
        this.turretAngle = 0;     // 主炮塔独立旋转，瞄准玩家
        this.spawnFade = 0;

        this.hitFlash = 0;

        // 嘲讽气泡（Boss 嘴更贱）
        this.tauntCooldown = Utils.randInt(2500, 5000);
        this.tauntText = null;
        this.tauntTime = 0;

        // 无人机母舰：无人机编队
        this.drones = [];
        this.lastMissile = 0;
    }

    /* ---------- 嘲讽 ---------- */
    sayTaunt(event) {
        if (this.tauntTime > 0) return;
        const pool = CONFIG.TAUNTS.boss || CONFIG.TAUNTS.heavy;
        this.tauntText = Utils.pick(pool);
        this.tauntTime = 2800;
    }

    /* ---------- 受伤 ---------- */
    takeDamage(dmg, game) {
        if (!this.alive) return;
        if (this.shieldActive) {
            game.particles.hitSpark(this.x, this.y, '#00d4ff');
            if (Utils.chance(0.3)) this.sayTaunt('shield');
            return;
        }
        this.hp -= dmg;
        this.hitFlash = 100;
        game.particles.hitSpark(this.x, this.y, this.color);
        if (Utils.chance(0.25)) this.sayTaunt('hit');
        // 阶段切换
        const ratio = this.hp / this.maxHp;
        if (this.phase === BOSS_PHASE.P1 && ratio <= CONFIG.BOSS.phase2Threshold) {
            this.enterPhase2(game);
        } else if (this.phase === BOSS_PHASE.P2 && ratio <= CONFIG.BOSS.phase3Threshold) {
            this.enterPhase3(game);
        }
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            game.onBossKilled(this);
        }
    }

    enterPhase2(game) {
        this.phase = BOSS_PHASE.P2;
        this.speed = CONFIG.BOSS.speed * 1.6;
        this.shieldCooldown = 1500; // 先进入脆弱窗口
        this.sayTaunt('phase2');
        game.toast('BOSS PHASE 2');
        game.screenShake(10, 'large');
        game.particles.explode(this.x, this.y, '#b44dff', 1.5);
    }

    enterPhase3(game) {
        this.phase = BOSS_PHASE.P3;
        this.speed = CONFIG.BOSS.speed * 2.2;
        this.shieldActive = false;
        this.sayTaunt('phase3');
        game.toast('BOSS BERSERK!');
        game.screenShake(16, 'huge');
        game.particles.explode(this.x, this.y, this.color, 2);
    }

    /* ---------- 更新 ---------- */
    update(dt, game) {
        if (!this.alive) return;
        if (this.spawnFade < 1) this.spawnFade = Math.min(1, this.spawnFade + dt * 0.002);
        if (this.hitFlash > 0) this.hitFlash -= dt;

        // EMP 瘫痪：减速但不禁用（Boss 抗性）
        const empSlow = (this.empTime && this.empTime > 0);
        if (empSlow) {
            this.empTime -= dt;
            if (Math.random() < 0.2) game.particles.hitSpark(this.x, this.y, '#b44dff');
        }

        // 嘲讽计时
        if (this.tauntTime > 0) this.tauntTime -= dt;
        this.tauntCooldown -= dt;
        if (this.tauntCooldown <= 0) {
            if (this.phase === BOSS_PHASE.P3) {
                if (Utils.chance(0.5)) this.sayTaunt();
            } else if (Utils.chance(0.35)) this.sayTaunt();
            this.tauntCooldown = Utils.randInt(5000, 9000);
        }

        const player = game.player;
        // 主炮塔瞄准玩家
        if (player && player.alive) {
            this.turretAngle = Math.atan2(player.y - this.y, player.x - this.x);
        }

        // 阶段逻辑（按 Boss 类型分发）—— EMP 期间禁用武器
        if (!empSlow) {
            if (this.bossType === 'carrier') {
                switch (this.phase) {
                    case BOSS_PHASE.P1: this.carrierPhase1(dt, game); break;
                    case BOSS_PHASE.P2: this.carrierPhase2(dt, game); break;
                    case BOSS_PHASE.P3: this.carrierPhase3(dt, game); break;
                }
                // 更新无人机编队
                this.updateDrones(dt, game);
            } else {
                switch (this.phase) {
                    case BOSS_PHASE.P1: this.updatePhase1(dt, game); break;
                    case BOSS_PHASE.P2: this.updatePhase2(dt, game); break;
                    case BOSS_PHASE.P3: this.updatePhase3(dt, game); break;
                }
            }
        } else if (this.bossType === 'carrier') {
            this.updateDrones(dt, game); // 无人机仍可运作
        }

        // 移动
        this.move(dt, game);
    }

    /* ---------- 阶段1 ---------- */
    updatePhase1(dt, game) {
        // 移动方向偶尔变换
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
            this.targetDir = Utils.randInt(0, 3);
            this.moveTimer = Utils.randInt(1500, 3000);
        }
        // 主炮射击
        const now = Utils.now();
        if (now - this.lastFire > CONFIG.BOSS.fireIntervalP1) {
            this.lastFire = now;
            this.fireMainCannon(game, CONFIG.BULLET.enemySpeed, 1);
        }
        // 偶尔放地雷
        if (Utils.chance(0.003)) {
            game.mines.push(new Mine(this.x, this.y, 'enemy'));
        }
    }

    /* ---------- 阶段2 ---------- */
    updatePhase2(dt, game) {
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
            this.targetDir = Utils.randInt(0, 3);
            this.moveTimer = Utils.randInt(1000, 2000);
        }
        // 护盾周期
        if (this.shieldActive) {
            this.shieldTimer -= dt;
            if (this.shieldTimer <= 0) {
                this.shieldActive = false;
                this.shieldCooldown = this.shieldCooldownDuration;
            }
        } else {
            this.shieldCooldown -= dt;
            if (this.shieldCooldown <= 0) {
                this.shieldActive = true;
                this.shieldTimer = this.shieldDuration;
            }
        }
        // 散弹
        const now = Utils.now();
        if (now - this.lastFire > CONFIG.BOSS.fireIntervalP2) {
            this.lastFire = now;
            this.fireScatter(game, 5);
        }
    }

    /* ---------- 阶段3 ---------- */
    updatePhase3(dt, game) {
        // 激光循环
        if (this.laserState === 'idle') {
            this.laserTimer = 1200; // 蓄力前等待
            this.laserState = 'charging';
            // ===== Boss 技能预告：屏幕中央文字提示 =====
            game.toast('⚠ 激光扫射警告');
            game.sound('bossAlert');
            // 选取激光初始朝向（朝玩家）
            const p = game.player;
            if (p) this.laserAngle = Math.atan2(p.y - this.y, p.x - this.x);
        } else if (this.laserState === 'charging') {
            this.laserTimer -= dt;
            if (this.laserTimer <= 0) {
                this.laserState = 'active';
                this.laserTimer = CONFIG.BOSS.laserActiveTime;
                game.screenShake(8, 'large');
            }
        } else if (this.laserState === 'active') {
            this.laserTimer -= dt;
            // 扫描
            this.laserAngle += this.laserSweepDir * 0.0015 * dt;
            // 检测玩家是否在激光线上
            this.checkLaserHit(game);
            if (this.laserTimer <= 0) {
                this.laserState = 'idle';
                this.laserSweepDir *= -1;
            }
        }

        // 召唤小兵
        const now = Utils.now();
        if (now - this.lastSummon > CONFIG.BOSS.summonInterval) {
            this.lastSummon = now;
            this.summonMinions(game);
        }

        // 主炮也射击
        if (now - this.lastFire > CONFIG.BOSS.fireIntervalP2) {
            this.lastFire = now;
            this.fireScatter(game, 7);
        }
    }

    /* ============================================================
       无人机母舰（carrier）阶段逻辑
       阶段1：召唤无人机 + 追踪导弹
       阶段2：护盾周期 + 双倍导弹
       阶段3：狂暴 + 旋转扫描激光 + 无人机群
       ============================================================ */
    carrierPhase1(dt, game) {
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
            this.targetDir = Utils.randInt(0, 3);
            this.moveTimer = Utils.randInt(1800, 3200);
        }
        const cfg = CONFIG.BOSS.types.carrier;
        // 召唤无人机
        const now = Utils.now();
        if (now - this.lastSummon > cfg.summonInterval && this.drones.length < cfg.droneMax) {
            this.lastSummon = now;
            this.spawnDrone(game);
        }
        // 追踪导弹
        if (now - this.lastMissile > cfg.missileIntervalP1) {
            this.lastMissile = now;
            this.fireMissile(game);
        }
    }

    carrierPhase2(dt, game) {
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
            this.targetDir = Utils.randInt(0, 3);
            this.moveTimer = Utils.randInt(1200, 2200);
        }
        // 护盾周期
        if (this.shieldActive) {
            this.shieldTimer -= dt;
            if (this.shieldTimer <= 0) {
                this.shieldActive = false;
                this.shieldCooldown = this.shieldCooldownDuration;
            }
        } else {
            this.shieldCooldown -= dt;
            if (this.shieldCooldown <= 0) {
                this.shieldActive = true;
                this.shieldTimer = this.shieldDuration;
            }
        }
        const cfg = CONFIG.BOSS.types.carrier;
        const now = Utils.now();
        // 持续补充无人机
        if (now - this.lastSummon > cfg.summonInterval && this.drones.length < cfg.droneMax) {
            this.lastSummon = now;
            this.spawnDrone(game);
        }
        // 双发导弹
        if (now - this.lastMissile > cfg.missileIntervalP2) {
            this.lastMissile = now;
            this.fireMissile(game);
            this.fireMissile(game);
        }
    }

    carrierPhase3(dt, game) {
        // 旋转扫描激光（复用激光状态机，但持续更久、扫得更快）
        const cfg = CONFIG.BOSS.types.carrier;
        if (this.laserState === 'idle') {
            this.laserTimer = CONFIG.BOSS.laserChargeTime;
            this.laserState = 'charging';
            // ===== Boss 技能预告：屏幕中央文字提示 =====
            game.toast('⚠ 旋转激光警告');
            game.sound('bossAlert');
            const p = game.player;
            if (p) this.laserAngle = Math.atan2(p.y - this.y, p.x - this.x);
        } else if (this.laserState === 'charging') {
            this.laserTimer -= dt;
            if (this.laserTimer <= 0) {
                this.laserState = 'active';
                this.laserTimer = cfg.beamSweepTime;
                game.screenShake(8, 'large');
            }
        } else if (this.laserState === 'active') {
            this.laserTimer -= dt;
            this.laserAngle += this.laserSweepDir * 0.0022 * dt;
            this.checkLaserHit(game);
            if (this.laserTimer <= 0) {
                this.laserState = 'idle';
                this.laserSweepDir *= -1;
            }
        }
        const now = Utils.now();
        // 狂暴：频繁召唤无人机
        if (now - this.lastSummon > cfg.summonInterval * 0.6 && this.drones.length < cfg.droneMax + 2) {
            this.lastSummon = now;
            this.spawnDrone(game);
        }
        // 导弹
        if (now - this.lastMissile > cfg.missileIntervalP2) {
            this.lastMissile = now;
            this.fireMissile(game);
            this.fireMissile(game);
        }
    }

    /* 召唤一架无人机（环绕 Boss，自动射击玩家） */
    spawnDrone(game) {
        const a = Math.random() * Math.PI * 2;
        const r = this.size * 0.8;
        this.drones.push({
            x: this.x + Math.cos(a) * r,
            y: this.y + Math.sin(a) * r,
            angle: a,
            radius: r,
            hp: 2,
            alive: true,
            lastFire: Utils.now() + Utils.rand(0, 1000),
            fireInterval: 1400,
        });
        game.particles.explode(this.x, this.y, this.color, 0.6);
        this.sayTaunt('summon');
    }

    /* 更新无人机编队：环绕飞行 + 射击 */
    updateDrones(dt, game) {
        const p = game.player;
        for (const d of this.drones) {
            if (!d.alive) continue;
            d.angle += dt * 0.0015; // 环绕角速度
            d.x = this.x + Math.cos(d.angle) * d.radius;
            d.y = this.y + Math.sin(d.angle) * d.radius;
            const now = Utils.now();
            if (p && p.alive && now - d.lastFire > d.fireInterval) {
                d.lastFire = now;
                const ang = Math.atan2(p.y - d.y, p.x - d.x);
                const v = { x: Math.cos(ang), y: Math.sin(ang) };
                const b = game.bullets.spawn({
                    x: d.x, y: d.y, dir: this.angleToDir(ang),
                    speed: CONFIG.BULLET.enemySpeed * 0.9, damage: 1,
                    owner: 'boss', type: 'normal',
                    color: this.color, size: 5,
                });
                if (b) { b.vx = v.x * b.speed; b.vy = v.y * b.speed; }
            }
        }
        this.drones = this.drones.filter(d => d.alive);
    }

    /* 无人机受玩家子弹伤害（由 game 调用） */
    damageDrone(d, dmg, game) {
        if (!d.alive) return;
        d.hp -= dmg;
        game.particles.hitSpark(d.x, d.y, this.color);
        if (d.hp <= 0) {
            d.alive = false;
            game.particles.explode(d.x, d.y, this.color, 0.7);
            game.score += 200;
        }
    }

    /* 追踪导弹：朝玩家当前位置发射（带轻微导引） */
    fireMissile(game) {
        const p = game.player;
        if (!p) return;
        const ang = Math.atan2(p.y - this.y, p.x - this.x);
        const v = { x: Math.cos(ang), y: Math.sin(ang) };
        const bx = this.x + v.x * (this.size / 2);
        const by = this.y + v.y * (this.size / 2);
        const b = game.bullets.spawn({
            x: bx, y: by, dir: this.angleToDir(ang),
            speed: CONFIG.BULLET.enemySpeed * 1.1, damage: 1,
            owner: 'boss', type: 'normal',
            color: '#ff7a00', size: 7,
        });
        if (b) { b.vx = v.x * b.speed; b.vy = v.y * b.speed; }
        game.particles.muzzleFlash(bx, by, v);
    }

    /* ---------- 武器 ---------- */
    // 主炮：朝炮塔朝向发射一发
    fireMainCannon(game, speed, dmg) {
        const v = { x: Math.cos(this.turretAngle), y: Math.sin(this.turretAngle) };
        const bx = this.x + v.x * (this.size / 2);
        const by = this.y + v.y * (this.size / 2);
        // 转换为四方向枚举（取最接近）
        const dir = this.angleToDir(this.turretAngle);
        game.bullets.spawn({
            x: bx, y: by, dir,
            speed, damage: dmg,
            owner: 'boss', type: 'normal',
            color: '#ff2a5a', size: 7,
        });
        game.particles.muzzleFlash(bx, by, v);
    }

    // 散弹：朝玩家方向扇形发射 count 发
    fireScatter(game, count) {
        const baseAngle = this.turretAngle;
        const spread = 0.9; // 总扇形角度
        const speed = CONFIG.BULLET.enemySpeed * 0.9;
        for (let i = 0; i < count; i++) {
            const a = baseAngle - spread / 2 + (spread / Math.max(1, count - 1)) * i;
            const v = { x: Math.cos(a), y: Math.sin(a) };
            const bx = this.x + v.x * (this.size / 2);
            const by = this.y + v.y * (this.size / 2);
            // 复用 bullet，但用角度向量覆盖四方向速度
            const b = game.bullets.spawn({
                x: bx, y: by, dir: this.angleToDir(a),
                speed, damage: 1, owner: 'boss', type: 'normal',
                color: '#ff7a00', size: 6,
            });
            if (b) { b.vx = v.x * speed; b.vy = v.y * speed; }
        }
    }

    angleToDir(a) {
        // 将任意角度映射到最接近的四方向
        const deg = ((a * 180 / Math.PI) + 360) % 360;
        if (deg >= 45 && deg < 135) return Utils.DIR.DOWN;
        if (deg >= 135 && deg < 225) return Utils.DIR.LEFT;
        if (deg >= 225 && deg < 315) return Utils.DIR.UP;
        return Utils.DIR.RIGHT;
    }

    // 召唤小兵：在 Boss 周围生成 2 个轻型敌人
    summonMinions(game) {
        this.sayTaunt('summon');
        for (let i = 0; i < 2; i++) {
            const a = Math.random() * Math.PI * 2;
            const sx = this.x + Math.cos(a) * 60;
            const sy = this.y + Math.sin(a) * 60;
            const e = new EnemyTank(
                Utils.clamp(sx, 30, CONFIG.CANVAS_W - 30),
                Utils.clamp(sy, 30, CONFIG.CANVAS_H - 30),
                'light', game.wave
            );
            game.enemies.push(e);
            game.particles.explode(sx, sy, '#ff6680', 0.5);
        }
        game.toast('REINFORCEMENTS!');
    }

    /* ---------- 激光命中检测 ---------- */
    checkLaserHit(game) {
        const p = game.player;
        if (!p || !p.alive) return;
        // 计算玩家到激光射线的距离
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        // 投影到激光方向
        const len = Math.sqrt(dx * dx + dy * dy);
        const proj = dx * Math.cos(this.laserAngle) + dy * Math.sin(this.laserAngle);
        // 垂直距离
        const perp = Math.abs(dx * Math.sin(this.laserAngle) - dy * Math.cos(this.laserAngle));
        if (proj > 0 && perp < 20) {
            p.takeDamage(1, game);
        }
    }

    /* ---------- 移动 ---------- */
    move(dt, game) {
        const v = Utils.dirVec(this.targetDir);
        const slow = game.obstacles.waterSlowAt(this.x, this.y);
        const speed = this.speed * slow;
        const dx = v.x * speed * dt * 0.06;
        const dy = v.y * speed * dt * 0.06;

        const nx = this.x + dx;
        const ny = this.y + dy;
        const rect = Utils.rect(nx, ny, this.size, this.size);
        if (!game.obstacles.collidesWithTank(rect)) {
            this.x = nx; this.y = ny;
        } else {
            this.targetDir = Utils.randInt(0, 3);
        }

        // 不与玩家重叠（Boss 可挤压玩家，造成伤害）
        const p = game.player;
        if (p && p.alive) {
            if (Utils.aabb(rect, Utils.rect(p.x, p.y, p.size, p.size))) {
                p.takeDamage(1, game);
            }
        }

        const half = this.size / 2;
        this.x = Utils.clamp(this.x, half, CONFIG.CANVAS_W - half);
        this.y = Utils.clamp(this.y, half, CONFIG.CANVAS_H - half);
        this.trackPhase += speed * dt * 0.01;
    }

    /* ---------- 渲染 ---------- */
    draw(ctx) {
        if (!this.alive) return;
        // 无人机母舰：独立渲染路径
        if (this.bossType === 'carrier') {
            this.drawCarrier(ctx);
            return;
        }
        const half = this.size / 2;
        const bc = CONFIG.COLORS.boss;
        const flash = this.hitFlash > 0;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalAlpha = this.spawnFade;

        // === 履带（巨型，带侧裙） ===
        const trackW = 14;
        ctx.fillStyle = '#100308';
        ctx.fillRect(-half, -half + 4, trackW, this.size - 8);
        ctx.fillRect(half - trackW, -half + 4, trackW, this.size - 8);
        ctx.fillStyle = '#2a1018';
        const off = (this.trackPhase % 1) * 10;
        for (let i = -half + 4 + off; i < half - 4; i += 10) {
            ctx.fillRect(-half + 2, i, trackW - 4, 4);
            ctx.fillRect(half - trackW + 2, i, trackW - 4, 4);
        }
        // 侧裙装甲
        ctx.fillStyle = '#1a0810';
        ctx.fillRect(-half - 2, -half + 6, trackW + 4, this.size * 0.3);
        ctx.fillRect(half - trackW - 2, -half + 6, trackW + 4, this.size * 0.3);
        ctx.strokeStyle = bc + '40';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-half - 2, -half + 6, trackW + 4, this.size * 0.3);
        ctx.strokeRect(half - trackW - 2, -half + 6, trackW + 4, this.size * 0.3);

        // === 车身（八边形重甲） ===
        const bw = this.size - trackW * 2;
        const bx = -bw / 2;
        const by = -half + 6;
        const bh = this.size - 12;
        const cut = 8;
        ctx.fillStyle = flash ? '#4a1525' : '#1a0610';
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
        ctx.strokeStyle = flash ? '#fff' : bc;
        ctx.lineWidth = 3;
        ctx.shadowColor = bc;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 装甲板分割线
        ctx.strokeStyle = bc + '30';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 4, by + bh * 0.3);
        ctx.lineTo(bx + bw - 4, by + bh * 0.3);
        ctx.moveTo(bx + 4, by + bh * 0.7);
        ctx.lineTo(bx + bw - 4, by + bh * 0.7);
        ctx.stroke();
        // 内框
        ctx.strokeStyle = bc + '20';
        ctx.strokeRect(bx + 6, by + 6, bw - 12, bh - 12);

        // 前装甲高光
        ctx.fillStyle = bc + '12';
        ctx.beginPath();
        ctx.moveTo(bx + cut, by);
        ctx.lineTo(bx + bw - cut, by);
        ctx.lineTo(bx + bw - cut - 3, by + 6);
        ctx.lineTo(bx + cut + 3, by + 6);
        ctx.closePath();
        ctx.fill();

        // === 中心主炮塔（大型双层） ===
        ctx.fillStyle = '#2a0814';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bc;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = bc;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 内环
        ctx.fillStyle = '#3a0e1c';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffe600' + '60';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // === 旋转主炮管（瞄准玩家，带制退器） ===
        ctx.save();
        ctx.rotate(this.turretAngle + Math.PI / 2);
        // 炮管底座
        ctx.fillStyle = '#2a0814';
        ctx.fillRect(-8, -2, 16, 8);
        ctx.strokeStyle = bc + 'a0';
        ctx.lineWidth = 1;
        ctx.strokeRect(-8, -2, 16, 8);
        // 炮管主体
        ctx.fillStyle = '#1a0410';
        ctx.fillRect(-7, -half * 0.75, 14, half * 0.75);
        ctx.fillStyle = bc;
        ctx.shadowColor = bc;
        ctx.shadowBlur = 10;
        ctx.fillRect(-5, -half * 0.75, 10, half * 0.75);
        ctx.shadowBlur = 0;
        // 炮口制退器
        ctx.fillStyle = '#0a0208';
        ctx.fillRect(-9, -half * 0.75 - 4, 18, 8);
        ctx.strokeStyle = bc;
        ctx.lineWidth = 2;
        ctx.strokeRect(-9, -half * 0.75 - 4, 18, 8);
        // 炮口闪光
        ctx.fillStyle = '#ffe600';
        ctx.shadowColor = '#ffe600';
        ctx.shadowBlur = 8;
        ctx.fillRect(-3, -half * 0.75 - 3, 6, 4);
        ctx.shadowBlur = 0;
        ctx.restore();

        // === 四角副炮塔 ===
        const corners = [[-half+22,-half+22],[half-22,-half+22],[-half+22,half-22],[half-22,half-22]];
        for (const [cx, cy] of corners) {
            // 底座
            ctx.fillStyle = '#1a0610';
            ctx.beginPath();
            ctx.arc(cx, cy, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = bc;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // 小炮管
            ctx.fillStyle = bc + 'c0';
            const dir = Math.atan2(-cy, -cx);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(dir + Math.PI / 2);
            ctx.fillRect(-2, -12, 4, 12);
            ctx.fillStyle = '#000';
            ctx.fillRect(-2, -12, 4, 2);
            ctx.restore();
        }

        // === 中心核心（脉冲） ===
        const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.005);
        ctx.fillStyle = '#ffe600';
        ctx.shadowColor = '#ffe600';
        ctx.shadowBlur = 14 * pulse;
        ctx.beginPath();
        ctx.arc(0, 0, 6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        // 核心外环
        ctx.strokeStyle = '#ffe600' + '40';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 9 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // === 散热栅格 ===
        ctx.strokeStyle = bc + '30';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            const ly = by + bh - 10 - i * 5;
            ctx.beginPath();
            ctx.moveTo(bx + 8, ly);
            ctx.lineTo(bx + bw - 8, ly);
            ctx.stroke();
        }

        ctx.restore();

        // 护盾
        if (this.shieldActive) {
            ctx.save();
            const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.01);
            ctx.globalAlpha = 0.3 + pulse * 0.3;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.75, 0, Math.PI * 2);
            ctx.stroke();
            // 六边形护盾纹
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.2;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 + Utils.now() * 0.001;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x + Math.cos(a) * this.size * 0.75, this.y + Math.sin(a) * this.size * 0.75);
                ctx.stroke();
            }
            ctx.restore();
        }

        // 激光（阶段3）
        if (this.laserState === 'charging') {
            // 蓄力预警线
            ctx.save();
            ctx.globalAlpha = 0.4 + 0.4 * Math.sin(Utils.now() * 0.03);
            ctx.strokeStyle = '#ff2a5a';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            ctx.restore();
        } else if (this.laserState === 'active') {
            ctx.save();
            ctx.strokeStyle = '#ff2a5a';
            ctx.lineWidth = 18;
            ctx.shadowColor = '#ff2a5a';
            ctx.shadowBlur = 30;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            // 内核
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 6;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            ctx.restore();
        }
    }

    /* ---------- 无人机母舰渲染 ---------- */
    drawCarrier(ctx) {
        const half = this.size / 2;
        const bc = this.color;
        const flash = this.hitFlash > 0;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalAlpha = this.spawnFade;

        // 六边形悬浮舰体
        ctx.fillStyle = flash ? '#3a1a4a' : '#150525';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * half;
            const py = Math.sin(a) * half;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = flash ? '#fff' : bc;
        ctx.lineWidth = 3;
        ctx.shadowColor = bc;
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 内层六边形（核心舱）
        ctx.fillStyle = '#1a0a30';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * half * 0.55;
            const py = Math.sin(a) * half * 0.55;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = bc + '60';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 四个无人机舱口（菱形）
        const bays = [[0,-half*0.75],[half*0.75,0],[0,half*0.75],[-half*0.75,0]];
        for (const [bx,by] of bays) {
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(Math.PI/4);
            ctx.fillStyle = '#0a0218';
            ctx.fillRect(-8, -8, 16, 16);
            ctx.strokeStyle = bc;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-8, -8, 16, 16);
            ctx.restore();
        }

        // 中央能量核心（脉冲）
        const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.006);
        ctx.fillStyle = '#00ffcc';
        ctx.shadowColor = '#00ffcc';
        ctx.shadowBlur = 16 * pulse;
        ctx.beginPath();
        ctx.arc(0, 0, 7 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#00ffcc40';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 11 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 旋转扫描环
        const sweep = Utils.now() * 0.003;
        ctx.strokeStyle = bc + '80';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.72, sweep, sweep + Math.PI * 0.7);
        ctx.stroke();

        ctx.restore();

        // 护盾（复用）
        if (this.shieldActive) {
            ctx.save();
            const sp = 0.6 + 0.4 * Math.sin(Utils.now() * 0.01);
            ctx.globalAlpha = 0.3 + sp * 0.3;
            ctx.strokeStyle = '#b44dff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#b44dff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.78, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // 无人机编队
        for (const d of this.drones) {
            if (!d.alive) continue;
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(d.angle * 2);
            ctx.fillStyle = bc;
            ctx.shadowColor = bc;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(6, 5);
            ctx.lineTo(-6, 5);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#00ffcc';
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // 激光（阶段3，复用渲染）
        if (this.laserState === 'charging') {
            ctx.save();
            ctx.globalAlpha = 0.4 + 0.4 * Math.sin(Utils.now() * 0.03);
            ctx.strokeStyle = bc;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            ctx.restore();
        } else if (this.laserState === 'active') {
            ctx.save();
            ctx.strokeStyle = bc;
            ctx.lineWidth = 16;
            ctx.shadowColor = bc;
            ctx.shadowBlur = 30;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 5;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x + Math.cos(this.laserAngle) * 1000,
                       this.y + Math.sin(this.laserAngle) * 1000);
            ctx.stroke();
            ctx.restore();
        }
    }
}
