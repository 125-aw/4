/* ============================================================
   tank.js — 玩家坦克
   操控：WASD/方向键移动（四方向），空格/J 开火，Shift 加速
   属性：HP、护盾、能量、武器等级、激活道具
   ============================================================ */

class PlayerTank {
    constructor(x, y, charConfig) {
        this.charCfg = charConfig || CONFIG.CHARACTERS[0];
        this.x = x; this.y = y;
        this.size = CONFIG.PLAYER.size;
        this.dir = Utils.DIR.UP;
        this.hp = this.charCfg.hp;
        this.maxHp = this.charCfg.hp;
        this.alive = true;
        this.bodyColor = this.charCfg.color;
        this.accentColor = this.charCfg.accent;

        this.boost = CONFIG.PLAYER.boostMax;
        this.boosting = false;
        this._speed = this.charCfg.speed;
        this._boostSpeed = this.charCfg.boostSpeed;
        this._fireInterval = this.charCfg.fireInterval;
        this._baseDamage = this.charCfg.bulletDamage;

        this.lastFire = 0;
        this.weaponLevel = 1;   // 1~3
        this.maxWeaponLevel = CONFIG.FIREPOWER.maxLevel;

        // 激活的限时道具（持续时间计时）
        this.shieldTime = 0;
        this.rapidTime = 0;
        this.pierceTime = 0;
        this.speedTime = 0;   // 加速道具(💨)：临时提升移速

        this.invincibleTime = 0;

        this.trackPhase = 0;
        this.moving = false;

        // 超频系统（Overclock）
        this.ocEnergy = 0;       // 0~maxEnergy
        this.ocActive = 0;       // 超频剩余 ms
        this.ocCooldown = 0;     // 冷却剩余 ms

        // 技能背包：1护盾 / 2速射 / 3穿甲 / 4地雷 / 5清屏
        this.skills = Object.assign({ shield:0, rapid:0, pierce:0, mine:0, clear:0 },
            this.charCfg.startSkills || {});

        this.input = { up:false, down:false, left:false, right:false, fire:false };

        // 车体/炮塔分离：车体朝移动方向，炮塔朝射击方向
        this.bodyAngle = 0;       // 车体当前角度（弧度）
        this.turretAngle = 0;     // 炮塔当前角度（弧度）
        this._barrelRecoil = 0;   // 炮管后缩动画剩余 ms
    }

    /* 超频是否就绪（能量满 且 不在冷却 且 未激活） */
    overclockReady() {
        const c = CONFIG.OVERCLOCK;
        return this.ocEnergy >= c.maxEnergy && this.ocCooldown <= 0 && this.ocActive <= 0;
    }

    /* 激活超频 */
    activateOverclock(game) {
        if (!this.overclockReady()) return false;
        const c = CONFIG.OVERCLOCK;
        this.ocActive = c.duration;
        this.ocEnergy = 0;
        game.toast('⚡ 超 频 启 动');
        game.screenShake(10, 'large');
        game.flashLevelUp();
        game.sound('powerup');
        game.particles.explode(this.x, this.y, '#00ffcc', 1.2);
        return true;
    }

    /* 超频是否激活中 */
    isOverclocking() { return this.ocActive > 0; }

    /* 按槽位使用技能 (0~4 → 1~5键) */
    useSkill(slotIndex, game) {
        const slotName = CONFIG.SKILLS.slot[slotIndex];
        if (!slotName) return false;
        if (!this.skills[slotName] || this.skills[slotName] <= 0) {
            game.toast('技能不足');
            return false;
        }
        const cfg = CONFIG.POWERUP.types[slotName] || {};
        switch (slotName) {
            case 'shield':
                this.shieldTime = cfg.duration;
                game.toast('护盾展开');
                this.flashSkill(game, 's1');
                break;
            case 'rapid':
                this.rapidTime = cfg.duration;
                game.toast('速射模式');
                this.flashSkill(game, 's2');
                break;
            case 'pierce':
                this.pierceTime = cfg.duration;
                game.toast('穿甲装填');
                this.flashSkill(game, 's3');
                break;
            case 'mine':
                game.mines.push(new Mine(this.x, this.y, 'player'));
                game.toast('地雷已布');
                this.flashSkill(game, 's4');
                break;
            case 'clear':
                this.skillClearScreen(game);
                this.flashSkill(game, 's5');
                break;
        }
        this.skills[slotName]--;
        game.sound('powerup');
        game.updateHUD();
        // 成就统计：单局技能使用次数
        if (game._runSkillUses !== undefined) {
            game._runSkillUses++;
            if (game._runSkillUses >= 20) game.checkAchievements();
        }
        return true;
    }

    /* 一键清屏：对全场所有敌人造成大量伤害，并清除敌方子弹 */
    skillClearScreen(game) {
        game.toast('全 屏 核 洗！');
        game.screenShake(14, 'huge');
        game.flashLevelUp();
        // 对所有敌人造成伤害（跳过 dying 状态的敌人）
        for (const e of game.enemies) {
            if (!e.alive || e.dying) continue;
            game.particles.explode(e.x, e.y, e.color, 1.2);
            e.takeDamage(CONFIG.SKILLS.clearDamage, game, null);
        }
        // 对 Boss 也造成伤害
        if (game.boss && game.boss.alive) {
            game.boss.takeDamage(Math.ceil(CONFIG.SKILLS.clearDamage * 1.5), game);
        }
        // 清除所有敌方子弹
        const all = game.bullets.active();
        for (const b of all) if (b.owner !== 'player') b.active = false;
        // 全屏粒子特效
        for (let i = 0; i < 18; i++) {
            setTimeout(() => {
                game.particles.explode(
                    Utils.rand(40, CONFIG.CANVAS_W - 40),
                    Utils.rand(40, CONFIG.CANVAS_H - 40),
                    Utils.pick(['#ffe600','#ff7a00','#ff2a5a']),
                    1.2
                );
                game.screenShake(4, 'small');
            }, i * 60);
        }
    }

    /* 技能栏按钮闪烁提示 */
    flashSkill(game, cls) {
        const el = document.querySelector(`.skill-slot[data-slot="${CONFIG.SKILLS.slot.indexOf(cls==='s1'?'shield':cls==='s2'?'rapid':cls==='s3'?'pierce':cls==='s4'?'mine':'clear')}"]`);
        if (!el) return;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 400);
    }

    /* ---------- 受伤 ---------- */
    takeDamage(dmg, game) {
        if (!this.alive) return;
        if (this.invincibleTime > 0) return;
        if (this.shieldTime > 0) {
            // 护盾吸收一次伤害
            this.shieldTime = 0;
            game.particles.hitSpark(this.x, this.y, '#00d4ff');
            game.screenShake(4, 'small');
            game.flashShield();
            return;
        }
        this.hp -= dmg;
        this.invincibleTime = CONFIG.PLAYER.invincibleTime;
        game.particles.hitSpark(this.x, this.y, '#ff2a5a');
        game.screenShake(8, 'large');
        game.flashDamage();
        // 成就统计：玩家受到伤害，本局不再算"一命通关"
        if (game._runNoDeath !== undefined) game._runNoDeath = false;
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            game.particles.explode(this.x, this.y, '#00d4ff', 1.6);
            game.screenShake(14, 'huge');
        }
    }

    /* ---------- 拾取道具：主动技能存入背包，恢复/升级即时生效 ---------- */
    applyPowerUp(type, game) {
        const cfg = CONFIG.POWERUP.types[type];
        switch (type) {
            case 'shield':
                this.skills.shield = (this.skills.shield || 0) + 1;
                game.toast('护盾 +1');
                break;
            case 'rapid':
                this.skills.rapid = (this.skills.rapid || 0) + 1;
                game.toast('速射 +1');
                break;
            case 'pierce':
                this.skills.pierce = (this.skills.pierce || 0) + 1;
                game.toast('穿甲 +1');
                break;
            case 'mine':
                this.skills.mine = (this.skills.mine || 0) + 1;
                game.toast('地雷 +1');
                break;
            case 'clear':
                this.skills.clear = (this.skills.clear || 0) + 1;
                game.toast('清屏技能 +1');
                break;
            case 'heal':
                this.hp = Math.min(this.maxHp, this.hp + 1);
                game.toast('+1 HP');
                break;
            case 'upgrade':
                if (this.weaponLevel < this.maxWeaponLevel) {
                    this.weaponLevel++;
                    game.toast('LEVEL UP!');
                    game.flashLevelUp();
                } else {
                    game.score += 500;
                    game.toast('+500 SCORE');
                }
                break;
            case 'speed':
                this.speedTime = cfg.duration;
                game.toast('💨 加速激活');
                break;
            case 'base':
                // 基地加固：为鹰巢开启限时无敌护盾
                if (game.base && game.base.alive) {
                    game.base.shieldTime = CONFIG.BASE.shieldDuration;
                    game.toast('🏠 基地加固');
                } else {
                    game.score += 300;
                    game.toast('+300 SCORE');
                }
                break;
            case 'life':
                // 奖励生命：上限+1 并恢复 1 点
                this.maxHp += 1;
                this.hp = Math.min(this.maxHp, this.hp + 1);
                game.toast('1UP 奖励生命!');
                break;
            case 'drone':
                // 护卫机副机：召唤一台自动攻击无人机（最多 2 台）
                if (!game.drones) game.drones = [];
                if (game.drones.length < CONFIG.DRONE.maxCount) {
                    game.drones.push(new WingmanDrone(this));
                    game.toast('🛰 护卫机已部署');
                } else {
                    game.score += 300;
                    game.toast('+300 SCORE (护卫机已满)');
                }
                break;
            case 'emp':
                // EMP：瘫痪全场敌机数秒（停止移动与射击）
                game.toast('⚡ EMP 脉冲!');
                game.screenShake(8, 'mid');
                game.flashLevelUp();
                for (const e of game.enemies) {
                    if (!e.alive) continue;
                    e.empTime = (e.empTime || 0) + (cfg.duration || 3000);
                    game.particles.hitSpark(e.x, e.y, '#b44dff');
                }
                if (game.boss && game.boss.alive) {
                    game.boss.empTime = (game.boss.empTime || 0) + (cfg.duration || 3000) * 0.5;
                }
                break;
        }
        game.particles.floatText(this.x, this.y - 20, cfg.label, cfg.color);
        game.updateHUD();
    }

    /* ---------- 开火 ---------- */
    fire(game) {
        const now = Utils.now();
        let interval = this.rapidTime > 0
            ? CONFIG.PLAYER.rapidInterval
            : this._fireInterval;
        // 超频：射速翻倍（间隔减半）
        if (this.isOverclocking()) interval *= CONFIG.OVERCLOCK.fireRateMult;
        if (now - this.lastFire < interval) return;
        this.lastFire = now;

        // 超频/非冷却状态下射击积累能量
        if (this.ocCooldown <= 0 && !this.isOverclocking()) {
            this.ocEnergy = Math.min(CONFIG.OVERCLOCK.maxEnergy, this.ocEnergy + CONFIG.OVERCLOCK.fireGain);
        }

        const v = Utils.dirVec(this.dir);
        const bx = this.x + v.x * (this.size / 2 + 6);
        const by = this.y + v.y * (this.size / 2 + 6);

        const firepower = CONFIG.FIREPOWER.levels[this.weaponLevel];
        const isPierce = this.pierceTime > 0;
        const isOC = this.isOverclocking();
        const dmg = this._baseDamage + firepower.damageBonus;
        const bulletSpeed = CONFIG.PLAYER.bulletSpeed * firepower.speedMult;

        // 武器等级决定子弹数：1级=1发，2级=2发（并行），3级=3发（扇形）
        if (firepower.shots === 1) {
            this.spawnBullet(game, bx, by, this.dir, dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
        } else if (firepower.shots === 2) {
            // 两发并排（垂直于方向偏移）
            const perp = this.perp(v);
            this.spawnBullet(game, bx + perp.x * 6, by + perp.y * 6, this.dir, dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
            this.spawnBullet(game, bx - perp.x * 6, by - perp.y * 6, this.dir, dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
        } else {
            // 三发扇形
            this.spawnBullet(game, bx, by, this.dir, dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
            this.spawnBullet(game, bx, by, this.rotateDir(this.dir, -1), dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
            this.spawnBullet(game, bx, by, this.rotateDir(this.dir, 1), dmg, isPierce, bulletSpeed, firepower.canBreakSteel, isOC);
        }

        // 炮口火焰
        game.particles.muzzleFlash(bx, by, v);
        // 超频时额外电弧粒子
        if (isOC) game.particles.hitSpark(bx, by, '#00ffcc');
        // 射击后坐力：微震 + 炮管回缩动画
        game.screenShake(1, 'micro');
        this._barrelRecoil = 120; // 炮管后缩动画时长 ms
    }

    spawnBullet(game, x, y, dir, dmg, pierce, speed, canBreakSteel, chain) {
        game.bullets.spawn({
            x, y, dir,
            speed,
            damage: dmg,
            owner: 'player',
            type: pierce ? 'pierce' : 'normal',
            pierceLeft: pierce ? 3 : 0,
            canBreakSteel,
            chain: !!chain,   // 超频子弹附带连锁闪电
            color: chain ? '#00ffcc' : (pierce ? '#b44dff' : '#ffe600'),
            size: chain ? 6 : (pierce ? 5 : CONFIG.BULLET.size),
        });
    }

    perp(v) { return { x: -v.y, y: v.x }; }
    rotateDir(dir, delta) { return (dir + delta + 4) % 4; }

    /* ---------- 移动 ---------- */
    // dir(0=UP,1=RIGHT,2=DOWN,3=LEFT) → 弧度
    // 炮管原始画在 (0, -barrelLen) 即朝上，需旋转到目标方向：
    // UP=0(不转) / RIGHT=π/2 / DOWN=π / LEFT=-π/2
    _dirToAngle(dir) {
        const map = [ 0, Math.PI/2, Math.PI, -Math.PI/2 ];
        return map[dir] !== undefined ? map[dir] : 0;
    }
    // 角度最短路径插值
    _lerpAngle(from, to, t) {
        let diff = to - from;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return from + diff * t;
    }

    update(dt, game) {
        if (!this.alive) return;

        // 计时器衰减
        if (this.shieldTime > 0) this.shieldTime -= dt;
        if (this.rapidTime > 0) this.rapidTime -= dt;
        if (this.pierceTime > 0) this.pierceTime -= dt;
        if (this.speedTime > 0) this.speedTime -= dt;
        if (this.invincibleTime > 0) this.invincibleTime -= dt;
        if (this._barrelRecoil > 0) this._barrelRecoil -= dt;

        // ===== 车体/炮塔角度平滑插值 =====
        // 车体朝移动方向，炮塔朝射击方向（dir）
        const targetBody = this._dirToAngle(this.dir);
        const targetTurret = this._dirToAngle(this.dir);
        // 角度插值（最短路径）
        this.bodyAngle = this._lerpAngle(this.bodyAngle, targetBody, 0.25);
        this.turretAngle = this._lerpAngle(this.turretAngle, targetTurret, 0.35);

        // 超频计时
        const oc = CONFIG.OVERCLOCK;
        if (this.ocActive > 0) {
            this.ocActive -= dt;
            if (this.ocActive <= 0) {
                this.ocActive = 0;
                this.ocCooldown = oc.cooldown; // 进入冷却
                game.toast('超频结束');
            }
        } else if (this.ocCooldown > 0) {
            this.ocCooldown -= dt;
        }

        // 确定移动方向（四方向，按下时取最新方向）
        let moveDir = -1;
        // 优先级：最后按下的方向；这里简化为按优先级取一个
        if (this.input.up)        moveDir = Utils.DIR.UP;
        else if (this.input.down) moveDir = Utils.DIR.DOWN;
        else if (this.input.left) moveDir = Utils.DIR.LEFT;
        else if (this.input.right)moveDir = Utils.DIR.RIGHT;

        this.moving = moveDir !== -1;
        if (this.moving) this.dir = moveDir;

        // 超频激活时禁用普通加速冲刺（超频本身已提供 2x 速度）
        this.boosting = !this.isOverclocking() && this.input.boost && this.boost > 0 && this.moving;
        if (this.boosting) {
            this.boost = Math.max(0, this.boost - CONFIG.PLAYER.boostCost);
        } else {
            this.boost = Math.min(CONFIG.PLAYER.boostMax, this.boost + CONFIG.PLAYER.boostRegen);
        }

        if (this.moving) {
            let speed = this.boosting ? this._boostSpeed : this._speed;
            // 超频：移速翻倍
            if (this.isOverclocking()) speed *= oc.speedMult;
            // 加速道具(💨)：临时提升移速 1.5 倍
            if (this.speedTime > 0) speed *= 1.5;
            // 水域减速
            const slow = game.obstacles.waterSlowAt(this.x, this.y);
            speed *= slow;

            const v = Utils.dirVec(this.dir);
            const dx = v.x * speed * dt * 0.06;
            const dy = v.y * speed * dt * 0.06;

            // 分轴移动 + 碰撞检测（避免卡墙）
            this.tryMove(dx, 0, game);
            this.tryMove(0, dy, game);

            // 履带动画
            this.trackPhase += speed * dt * 0.01;
            // 履带尘土粒子（间歇性喷出，转向时更密集）
            this._dustTimer = (this._dustTimer || 0) - dt;
            if (this._dustTimer <= 0) {
                // 转向检测：方向与车体角度差异大时增加密度
                const turning = Math.abs(this._lastMoveDir - this.dir) > 0 ? 0.8 : 0.4;
                this._dustTimer = Utils.rand(80, 160) / turning;
                const back = { x: this.x - v.x * this.size/2, y: this.y - v.y * this.size/2 };
                game.particles.trackDust(back.x, back.y, v, turning);
                this._lastMoveDir = this.dir;
            }
            // 尾焰
            if ((this.boosting || this.isOverclocking()) && Math.random() < 0.6) {
                game.particles.exhaust(this.x - v.x * this.size/2, this.y - v.y * this.size/2,
                    this.isOverclocking() ? '#00ffcc' : '#b44dff');
            }
            // 超频/非冷却状态下移动积累能量
            if (this.ocCooldown <= 0 && !this.isOverclocking()) {
                this.ocEnergy = Math.min(oc.maxEnergy, this.ocEnergy + oc.moveGain);
            }
        }

        // 开火
        if (this.input.fire) this.fire(game);

        // 边界限制
        const half = this.size / 2;
        this.x = Utils.clamp(this.x, half, CONFIG.CANVAS_W - half);
        this.y = Utils.clamp(this.y, half, CONFIG.CANVAS_H - half);

        // 单向传送门：踩到入口则瞬移到出口
        if (game.obstacles && game.obstacles.portals && game.obstacles.portals.length) {
            const portal = game.obstacles.portalAt(this.x, this.y);
            if (portal) {
                this.x = portal.exit.x;
                this.y = portal.exit.y;
                portal.cooldown = CONFIG.PORTAL.cooldown;
                game.particles.explode(this.x, this.y, portal.color, 0.8);
                game.particles.explode(portal.entry.x, portal.entry.y, portal.color, 0.5);
                game.sound('powerup');
                game.toast('⚡ 传送！');
            }
        }
    }

    // 单轴移动尝试，撞墙则停止该轴
    tryMove(dx, dy, game) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        const rect = Utils.rect(nx, ny, this.size, this.size);
        // 与墙碰撞
        if (game.obstacles.collidesWithTank(rect)) return;
        // 与敌方坦克碰撞（跳过 dying 状态的敌人，避免将死敌人阻挡玩家）
        for (const e of game.enemies) {
            if (!e.alive || e.dying) continue;
            if (Utils.aabb(rect, Utils.rect(e.x, e.y, e.size, e.size))) return;
        }
        // 与 Boss 碰撞
        if (game.boss && Utils.aabb(rect, Utils.rect(game.boss.x, game.boss.y, game.boss.size, game.boss.size))) return;
        this.x = nx; this.y = ny;
    }

    /* ---------- 渲染（车体与炮塔分离绘制，各自独立旋转）---------- */
    draw(ctx) {
        if (!this.alive) return;
        const half = this.size / 2;
        const bodyColor = this.bodyColor;
        const accent = this.accentColor;

        // 无敌闪烁（全局透明度，影响车体+炮塔）
        let alpha = 1;
        if (this.invincibleTime > 0 && Math.floor(this.invincibleTime / 70) % 2 === 0) {
            alpha = 0.3;
        }

        // ===== 1. 车体（朝移动方向，bodyAngle）=====
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.bodyAngle);

        // === 履带（带侧裙） ===
        const trackW = 7;
        ctx.fillStyle = '#0d1820';
        ctx.fillRect(-half, -half + 2, trackW, this.size - 4);
        ctx.fillRect(half - trackW, -half + 2, trackW, this.size - 4);
        // 履带纹理（滚动）
        ctx.fillStyle = '#2a4a60';
        const off = (this.trackPhase % 1) * 7;
        for (let i = -half + 2 + off; i < half - 2; i += 7) {
            ctx.fillRect(-half + 1, i, trackW - 2, 3);
            ctx.fillRect(half - trackW + 1, i, trackW - 2, 3);
        }
        // 侧裙装甲
        ctx.fillStyle = '#152838';
        ctx.fillRect(-half - 1, -half + 4, trackW + 2, this.size * 0.35);
        ctx.fillRect(half - trackW - 1, -half + 4, trackW + 2, this.size * 0.35);
        ctx.strokeStyle = bodyColor + '60';
        ctx.lineWidth = 1;
        ctx.strokeRect(-half - 1, -half + 4, trackW + 2, this.size * 0.35);
        ctx.strokeRect(half - trackW - 1, -half + 4, trackW + 2, this.size * 0.35);

        // === 车身（斜切八边形装甲） ===
        const bw = this.size - trackW * 2;
        const bx = -bw / 2;
        const by = -half + 3;
        const bh = this.size - 6;
        const cut = 5;
        ctx.fillStyle = '#0a2a3e';
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
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 车身装甲板纹理
        ctx.strokeStyle = bodyColor + '30';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by + bh * 0.35);
        ctx.lineTo(bx + bw - 2, by + bh * 0.35);
        ctx.moveTo(bx + 2, by + bh * 0.65);
        ctx.lineTo(bx + bw - 2, by + bh * 0.65);
        ctx.stroke();

        // 前装甲倾斜面高光
        ctx.fillStyle = bodyColor + '18';
        ctx.beginPath();
        ctx.moveTo(bx + cut, by);
        ctx.lineTo(bx + bw - cut, by);
        ctx.lineTo(bx + bw - cut - 2, by + 4);
        ctx.lineTo(bx + cut + 2, by + 4);
        ctx.closePath();
        ctx.fill();

        // 通风口/散热栅格（车身后部）
        ctx.strokeStyle = bodyColor + '50';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            const ly = by + bh - 8 - i * 4;
            ctx.beginPath();
            ctx.moveTo(bx + 4, ly);
            ctx.lineTo(bx + bw - 4, ly);
            ctx.stroke();
        }
        ctx.restore();

        // ===== 2. 炮塔（朝射击方向，turretAngle）=====
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.turretAngle);

        // 后坐力偏移（开火瞬间炮管后缩）
        const recoilOffset = this._barrelRecoil > 0 ? (this._barrelRecoil / 120) * 4 : 0;

        // 外环
        ctx.fillStyle = '#0e3850';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.52, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 内环
        ctx.fillStyle = '#1a5070';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = accent + '80';
        ctx.lineWidth = 1;
        ctx.stroke();

        // === 炮管（带炮口制退器，后坐力时后缩）===
        const barrelW = 5;
        const barrelLen = half + 6 - recoilOffset; // 后缩
        ctx.fillStyle = '#1a3050';
        ctx.fillRect(-barrelW/2 - 1, -barrelLen, barrelW + 2, barrelLen - 6);
        ctx.fillStyle = bodyColor;
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = 8;
        ctx.fillRect(-barrelW/2, -barrelLen, barrelW, barrelLen - 6);
        ctx.shadowBlur = 0;
        // 炮口制退器
        ctx.fillStyle = '#0a2030';
        ctx.fillRect(-barrelW/2 - 3, -barrelLen - 2, barrelW + 6, 7);
        ctx.strokeStyle = bodyColor + 'a0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-barrelW/2 - 3, -barrelLen - 2, barrelW + 6, 7);
        // 炮口孔
        ctx.fillStyle = '#000';
        ctx.fillRect(-1.5, -barrelLen, 3, 3);
        // 开火瞬间炮口闪光
        if (this._barrelRecoil > 80) {
            ctx.fillStyle = '#ffe600';
            ctx.shadowColor = '#ffe600';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.arc(0, -barrelLen - 4, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // === 能量核心（脉冲呼吸） ===
        const pulse = 0.7 + 0.3 * Math.sin(Utils.now() * 0.006);
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 12 * pulse;
        ctx.beginPath();
        ctx.arc(0, 0, 4 * pulse, 0, Math.PI * 2);
        ctx.fill();
        // 核心外圈
        ctx.strokeStyle = accent + '40';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 6 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // ===== 3. 不随旋转的特效（护盾/加速/超频）=====
        // 护盾光环
        if (this.shieldTime > 0) {
            ctx.save();
            const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.01);
            ctx.globalAlpha = 0.4 + pulse * 0.3;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.85, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 加速喷射光
        if (this.boosting) {
            ctx.save();
            ctx.globalAlpha = 0.7;
            const v = Utils.dirVec(this.dir);
            ctx.fillStyle = '#b44dff';
            ctx.shadowColor = '#b44dff';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(this.x - v.x * half, this.y - v.y * half, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 超频激活光环
        if (this.isOverclocking()) {
            ctx.save();
            const pulse = 0.6 + 0.4 * Math.sin(Utils.now() * 0.02);
            ctx.globalAlpha = 0.35 + pulse * 0.25;
            ctx.strokeStyle = '#00ffcc';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#00ffcc';
            ctx.shadowBlur = 22;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.95 + pulse * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

/* ============================================================
   WingmanDrone — 护卫机（副机）
   拾取稀有道具召唤，自动跟随玩家并攻击最近敌人，最多 2 台
   ============================================================ */
class WingmanDrone {
    constructor(owner) {
        this.owner = owner;
        this.x = owner ? owner.x : 0;
        this.y = owner ? owner.y - 40 : 0;
        this.size = 18;
        this.alive = true;
        this.lastFire = 0;
        this.orbit = Utils.rand(0, Math.PI * 2);
        this.angle = 0;
    }

    update(dt, game) {
        if (!this.alive || !this.owner || !this.owner.alive) {
            // 主人死了，护卫机撤离
            if (this.alive) {
                this.alive = false;
                game.particles.explode(this.x, this.y, '#00d4ff', 0.5);
            }
            return;
        }
        // 环绕玩家飞行
        this.orbit += dt * 0.003;
        const r = CONFIG.DRONE.followDist;
        const tx = this.owner.x + Math.cos(this.orbit) * r;
        const ty = this.owner.y + Math.sin(this.orbit) * r;
        this.x += (tx - this.x) * 0.12;
        this.y += (ty - this.y) * 0.12;

        // 寻找最近敌人/Boss
        let target = null, bestD = 320 * 320;
        for (const e of game.enemies) {
            if (!e.alive) continue;
            const dx = e.x - this.x, dy = e.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; target = e; }
        }
        if (game.boss && game.boss.alive) {
            const dx = game.boss.x - this.x, dy = game.boss.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; target = game.boss; }
        }
        if (target) {
            this.angle = Math.atan2(target.y - this.y, target.x - this.x);
            const now = Utils.now();
            if (now - this.lastFire > CONFIG.DRONE.fireInterval) {
                this.lastFire = now;
                const v = { x: Math.cos(this.angle), y: Math.sin(this.angle) };
                const b = game.bullets.spawn({
                    x: this.x + v.x * 10, y: this.y + v.y * 10,
                    dir: 0, speed: CONFIG.DRONE.bulletSpeed,
                    damage: CONFIG.DRONE.bulletDamage,
                    owner: 'player', type: 'normal',
                    color: '#00d4ff', size: 4,
                });
                if (b) { b.vx = v.x * b.speed; b.vy = v.y * b.speed; b.dir = null; }
            }
        } else {
            this.angle = this.orbit + Math.PI / 2;
        }
    }

    draw(ctx) {
        if (!this.alive) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + Math.PI / 2);
        // 机身（小三角）
        ctx.fillStyle = '#0a2030';
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(8, 8);
        ctx.lineTo(-8, 8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 10;
        ctx.stroke();
        // 核心
        ctx.fillStyle = '#00ffcc';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}
