/* ============================================================
   game.js — 主游戏控制器
   职责：状态机、主循环、输入、波次、碰撞分发、HUD、音效、渲染
   状态：MENU → PLAYING → PAUSED → GAME_OVER → VICTORY
   ============================================================ */

const STATE = {
    MENU: 'menu', ABOUT: 'about',
    CHAR_SELECT: 'char', LEVEL_SELECT: 'level',
    PLAYING: 'playing', PAUSED: 'paused',
    GAME_OVER: 'over', VICTORY: 'victory',
};

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.state = STATE.MENU;
        this.testMode = new URLSearchParams(window.location.search).get('test') === 'steel';
        this.testSteelWall = null;
        this.steelTestPassed = false;

        // ===== 设置（画质 / 音效 / 音量），提前初始化供粒子池等使用 =====
        this.settings = Object.assign({}, CONFIG.SETTINGS);
        try {
            const s = localStorage.getItem('iron_torrent_settings');
            if (s) Object.assign(this.settings, JSON.parse(s));
        } catch (e) {}
        // ===== 触屏检测（移动端自动降画质，保证 30fps）=====
        this.isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        if (this.isTouchDevice) {
            document.body.classList.add('touch-device');
            try {
                // 从未手动设置过画质 → 默认中画质
                if (!localStorage.getItem('iron_torrent_settings')) {
                    this.settings.quality = 'mid';
                }
            } catch (e) {}
        }
        this.muted = !this.settings.sound;
        this.masterGain = null; // 音量控制节点（首次播放时创建）

        // 实体集合
        this.player = null;
        this.enemies = [];
        this.boss = null;
        this.base = null;          // 鹰巢基地（失败条件之一）
        this.bullets = new BulletPool(220);
        this.particles = new ParticleSystem(this._qualityParticles());
        this.obstacles = new ObstacleManager();
        this.powerups = [];
        this.mines = [];

        // 角色选择
        this.selectedCharId = CONFIG.CHARACTERS[0].id;

        // 关卡解锁（localStorage 存档）
        this.unlockedLevel = 1;
        this.selectedLevel = 1;
        try {
            // 优先读取新键，回退到旧键（兼容旧存档）
            let s = localStorage.getItem('iron_torrent_unlocked');
            if (!s) s = localStorage.getItem('steel_storm_unlocked');
            if (s) this.unlockedLevel = Utils.clamp(parseInt(s, 10) || 1, 1, CONFIG.TOTAL_WAVES);
        } catch (e) {}

        // ===== 成就系统：累计统计 + 已解锁列表（localStorage）=====
        // stats 为累计统计；achvUnlocked 为 Set（id），二者均持久化
        this.stats = this._loadStats();
        this.achvUnlocked = this._loadAchievements();
        this._runStartTime = 0;     // 单局开始时间戳（用于速通判定）
        this._runStartKills = 0;    // 单局开始时累计击杀（用于单局统计）
        this._runSkillUses = 0;     // 单局技能使用次数
        this._runOcKills = 0;       // 单局超频击杀数
        this._runNoDeath = true;    // 单局是否未死亡
        this._runBossNoHit = false; // 单局是否满血击杀任一 Boss
        this._bossEngagedHp = 0;    // 与 Boss 交战时玩家 HP（用于满血判定）
        this._clearChars = this._loadClearChars(); // 通关过的坦克 id 集合

        // 每日挑战模式（关闭 Math.random 锁定，仅关卡布局固定）
        this.dailyMode = false;

        // 开发者控制台（~ 键开关）：显示 FPS / 实体数 / 碰撞框
        this.debugMode = false;
        this._fps = 0;            // 平滑 FPS
        this._fpsAccum = 0;       // 帧时间累加
        this._fpsFrames = 0;      // 帧数计数

        // 波次
        this.wave = 1;
        this.waveEnemiesTotal = 0;   // 本波要生成的敌人总数
        this.waveEnemiesSpawned = 0; // 已生成
        this.spawnTimer = 0;
        this.spawnInterval = CONFIG.SPAWN.baseInterval;
        this.waveCleared = false;
        this.waveBreakTimer = 0;     // 波间休息

        // 统计
        this.score = 0;
        this.kills = 0;

        // 屏幕特效
        this.shakeAmount = 0;
        this.shakeTime = 0;

        // 动态环境系统：每5关切换氛围
        // 1~5: normal(清晰星空) | 6~10: storm(电磁风暴) | 11~15: night(暗夜突袭)
        this.environment = 'normal';
        this._stormArcTimer = 0;        // 电磁风暴电弧闪烁计时
        this._stormFlicker = 0;         // 屏幕闪烁强度

        // 关卡过渡动画：光圈扩散/收缩
        // state: 'none' | 'expand'(CLEAR) | 'contract'(START)
        this._waveTransition = { state: 'none', t: 0, duration: 1200, text: '' };

        // 动态难度：连续未受伤/连续死亡计数（跨局持久化）
        // 连续3关无伤 → 下一关敌人 +20%（挑战升级）
        // 连续2关死亡 → 下一关敌人 -30%（避免劝退）
        this._noDamageStreak = 0;
        this._deathStreak = 0;
        try {
            this._noDamageStreak = parseInt(localStorage.getItem('iron_torrent_nodmg') || '0', 10) || 0;
            this._deathStreak = parseInt(localStorage.getItem('iron_torrent_death') || '0', 10) || 0;
        } catch (e) {}

        // 音频
        this.audioCtx = null;

        // 触屏输入状态
        this.touch = { active: false, dx: 0, dy: 0, fire: false };

        // 录像回放（Replay）：录制玩家输入序列 + 确定性种子
        // 录制：replayRecording = { seed, charId, level, events: [{t,key,down,fire?}] }
        // 回放：replayMode = true 时禁用真实输入，由事件序列驱动
        this.replayRecording = null;     // 录制中累积对象
        this.replayMode = false;         // 是否处于回放模式
        this.replayData = null;          // 已加载的回放数据
        this.replayTime = 0;             // 回放累计 ms
        this.replayEventIdx = 0;         // 下一条待回放事件索引
        this.replayStartFrame = 0;       // 回放起始时间戳
        this._origRandom = Math.random;  // 备份原始 random（回放时替换）

        // 离屏背景画布（静态网格 + 星空，减少重绘）
        this.bgCanvas = document.createElement('canvas');
        this.bgCanvas.width = CONFIG.CANVAS_W;
        this.bgCanvas.height = CONFIG.CANVAS_H;
        this.bgCtx = this.bgCanvas.getContext('2d');
        this.starField = this.generateStars(80);
        this.gridScroll = 0;

        // 时间
        this.lastTime = Utils.now();

        // 固定时间步长（fixed timestep）累加器
        // 每帧以 1/60s (≈16.67ms) 固定步长推进 update，保证回放精度
        this._fixedAccumulator = 0;
        this._FIXED_DT = 1000 / 60;

        // 空间哈希网格（用于碰撞检测优化，避免 O(n²)）
        this._spatial = new SpatialHash(80);

        // 绑定输入与 UI
        this.bindInput();
        this.bindUI();
        if (this.testMode) this.startSteelWallTest();

        // 启动主循环
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    /* ============================================================
       画质控制：粒子数量上限（性能优化，移动端自动降级）
       ============================================================ */
    _qualityParticles(q) {
        const ql = q || this.settings.quality;
        return { low: 120, mid: 240, high: 400 }[ql] || 240;
    }
    applyQuality(q) {
        this.settings.quality = q;
        // 重建粒子池（画质切换后生效；菜单期切换无活动粒子，直接重建）
        if (this.particles) this.particles = new ParticleSystem(this._qualityParticles(q));
        try { localStorage.setItem('iron_torrent_settings', JSON.stringify(this.settings)); } catch (e) {}
    }

    /* ============================================================
       星空背景生成
       ============================================================ */
    generateStars(count) {
        const stars = [];
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * CONFIG.CANVAS_W,
                y: Math.random() * CONFIG.CANVAS_H,
                size: Math.random() * 1.5 + 0.3,
                speed: Math.random() * 0.3 + 0.05,
                twinkle: Math.random() * Math.PI * 2,
            });
        }
        return stars;
    }

    /* ============================================================
       输入绑定：多浏览器兼容
       ============================================================ */
    bindInput() {
        this.keys = {};
        this._pressedOnce = {}; // 用于单帧触发的按键（技能等）
        const preventSet = new Set(['arrowup','arrowdown','arrowleft','arrowright',' ','spacebar','','1','2','3','4','5','shift','escape']);

        const normKey = (e) => {
            // 规范化为单一 key 字符串，兼容 key / code / keyCode
            const key = (e.key || '').toLowerCase();
            const code = (e.code || '').toLowerCase();
            // 空格（最关键的开火键）多重 fallback
            if (e.keyCode === 32 || key === ' ' || code === 'space') return ' ';
            if (e.keyCode === 16 || key === 'shift') return 'shift';
            if (e.keyCode === 37 || key === 'arrowleft') return 'arrowleft';
            if (e.keyCode === 38 || key === 'arrowup') return 'arrowup';
            if (e.keyCode === 39 || key === 'arrowright') return 'arrowright';
            if (e.keyCode === 40 || key === 'arrowdown') return 'arrowdown';
            if (e.keyCode === 27 || key === 'escape') return 'escape';
            // 数字键（含小键盘）
            if (key >= '1' && key <= '5') return key;
            if (e.keyCode >= 97 && e.keyCode <= 101) return String(e.keyCode - 96); // Numpad
            if (e.keyCode >= 49 && e.keyCode <= 53) return String(e.keyCode - 48);
            return key;
        };

        window.addEventListener('keydown', (e) => {
            const k = normKey(e);
            this.keys[k] = true;

            // 调试：在屏幕右下角显示最后按下的键
            this._lastKey = k;
            this._lastKeyTime = Utils.now();

            // 录像回放：记录按键事件（仅录制 PLAYING 状态下的输入）
            if (this.replayRecording && this.state === STATE.PLAYING) {
                if (!e.repeat) {
                    this.replayRecording.events.push({
                        t: Utils.now() - this.replayRecording.startWall,
                        key: k, down: true,
                    });
                }
            }

            // 全局快捷键
            if (k === 'm') {
                this.muted = !this.muted;
                document.getElementById('mute-indicator').classList.toggle('hidden', !this.muted);
                return;
            }
            // Esc：返回菜单 / 关闭关于
            if (k === 'escape') {
                this.handleEscape();
                return;
            }
            // Tab：回放模式下切换速度（1×/2×/4×）；阻止默认 Tab 焦点跳转
            if (e.keyCode === 9 || k === 'tab') {
                e.preventDefault();
                if (this.replayMode) this.cycleReplaySpeed();
                return;
            }
            // ~ 键（Backquote）：开发者控制台开关
            if (k === '`' || e.keyCode === 192) {
                e.preventDefault();
                this.toggleDebug();
                return;
            }

            if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
                if (k === 'p') {
                    this.togglePause();
                } else if (k === 'n') {
                    // 跳关
                    this.skipCurrentWave();
                } else if (k === 'shift') {
                    // 超频：满格能量时按 Shift 边沿触发激活
                    if (!e.repeat && this.player && this.player.alive && this.player.overclockReady()) {
                        this.player.activateOverclock(this);
                    }
                } else if (k >= '1' && k <= '5') {
                    // 技能施放：用 e.repeat 防止按住连发（比 _pressedOnce 更可靠）
                    if (!e.repeat && this.player && this.player.alive) {
                        const slot = parseInt(k, 10) - 1;
                        const ok = this.player.useSkill(slot, this);
                        if (ok) {
                            // 成功反馈：技能槽高亮 + Toast + 屏幕闪光
                            const slotName = CONFIG.SKILLS.slot[slot];
                            const label = ({
                                shield: '🛡 护盾',
                                rapid:  '⚡ 速射',
                                pierce: '🏹 穿甲',
                                mine:   '💣 地雷',
                                clear:  '💥 清屏',
                            })[slotName];
                            if (label) this.toast(`${label}  已激活`);
                            // 技能槽 flash 动画
                            const el = document.querySelector(`.skill-slot[data-slot="${slot}"]`);
                            if (el) {
                                el.classList.remove('skill-flash');
                                void el.offsetWidth;
                                el.classList.add('skill-flash');
                                setTimeout(() => el.classList.remove('skill-flash'), 600);
                            }
                            // 屏幕轻微闪光（清屏技能用强闪光）
                            this.flashForSkill(slotName === 'clear' ? 'rgba(255,77,166,0.45)' : 'rgba(255,255,255,0.18)');
                        }
                    }
                }
            }

            // 防止默认滚动
            if (preventSet.has(k) || (typeof e.keyCode === 'number' && [32,37,38,39,40].includes(e.keyCode))) {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            const k = normKey(e);
            this.keys[k] = false;
            // 录像回放：记录松键事件
            if (this.replayRecording && this.state === STATE.PLAYING) {
                this.replayRecording.events.push({
                    t: Utils.now() - this.replayRecording.startWall,
                    key: k, down: false,
                });
            }
        });

        // 鼠标左键开火（canvas 范围内）
        this.mouseFire = false;
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.mouseFire = true;
                if (this.replayRecording && this.state === STATE.PLAYING) {
                    this.replayRecording.events.push({
                        t: Utils.now() - this.replayRecording.startWall,
                        key: 'mousefire', down: true,
                    });
                }
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.mouseFire = false;
                if (this.replayRecording && this.state === STATE.PLAYING) {
                    this.replayRecording.events.push({
                        t: Utils.now() - this.replayRecording.startWall,
                        key: 'mousefire', down: false,
                    });
                }
            }
        });
        // 鼠标离开窗口时停止开火
        window.addEventListener('blur', () => { this.mouseFire = false; });
    }

    handleEscape() {
        // 回放模式：Esc 直接退出回放
        if (this.replayMode) {
            this.stopReplay();
            this.returnToMenu();
            return;
        }
        if (this.state === STATE.ABOUT) {
            this.showMenu();
        } else if (this.state === STATE.CHAR_SELECT) {
            this.showMenu();
        } else if (this.state === STATE.LEVEL_SELECT) {
            this.showCharSelect();
        } else if (this.state === STATE.PLAYING) {
            this.togglePause();
        } else if (this.state === STATE.PAUSED) {
            this.returnToMenu();
        } else if (this.state === STATE.GAME_OVER || this.state === STATE.VICTORY) {
            this.showMenu();
        }
    }

    // 将按键状态映射到玩家输入（保持按下状态）
    syncPlayerInput() {
        if (!this.player) return;
        const k = this.keys;
        this.player.input.up = k['w'] || k['arrowup'];
        this.player.input.down = k['s'] || k['arrowdown'];
        this.player.input.left = k['a'] || k['arrowleft'];
        this.player.input.right = k['d'] || k['arrowright'];
        // 空格 + J + 鼠标左键 + 触屏开火
        this.player.input.fire = k[' '] || k['space'] || k['j'] || this.mouseFire || this.touch.fire;
        this.player.input.boost = k['shift'];
        // 触屏摇杆：覆盖方向输入（优先级最高；0.2 死区避免漂移）
        if (this.touch.active) {
            const ax = Math.abs(this.touch.dx), ay = Math.abs(this.touch.dy);
            if (ax > 0.2 || ay > 0.2) {
                this.player.input.up = this.touch.dy < -0.2;
                this.player.input.down = this.touch.dy > 0.2;
                this.player.input.left = this.touch.dx < -0.2;
                this.player.input.right = this.touch.dx > 0.2;
            }
        }
        // 清零边沿触发标记
        this._pressedOnce = {};
    }

    /* ============================================================
       UI 按钮绑定
       ============================================================ */
    // 激活音频上下文 + 主音量节点（首次用户手势后调用）
    // 委托给 AudioManager 统一管理（BGM + SFX + 设置联动）
    ensureAudio() {
        if (this.audioCtx) {
            AudioManager.resume();
            return;
        }
        AudioManager.init();
        this.audioCtx = AudioManager.ctx;
        this.masterGain = AudioManager.masterGain;
        // 同步当前设置到 AudioManager
        AudioManager.setVolume(this.settings.volume);
        if (!this.settings.sound) AudioManager.isSoundOn = false;
        if (!this.settings.music) AudioManager.isMusicOn = false;
        if (AudioManager.musicGain) AudioManager.musicGain.gain.value = this.settings.music ? 0.45 : 0;
        if (AudioManager.sfxGain) AudioManager.sfxGain.gain.value = this.settings.sound ? 0.6 : 0;
        // 主菜单 BGM
        if (this.state === STATE.MENU || this.state === undefined) {
            AudioManager.playBGM('menu');
        }
    }

    bindUI() {
        // 点击后立即失焦，避免空格继续触发按钮默认 click；并激活音频上下文
        const blurClick = (el, fn) => {
            if (!el) return;
            el.addEventListener('click', (e) => {
                el.blur && el.blur();
                this.ensureAudio();
                fn && fn(e);
            });
        };
        // 暴露给其它绑定方法（如 bindSettingsUI）复用
        this._blurClick = blurClick;

        // 主菜单
        blurClick(document.getElementById('start-btn'), () => this.showCharSelect());
        blurClick(document.getElementById('about-btn'), () => this.showAbout());
        blurClick(document.getElementById('stats-btn'), () => this.showStats());
        blurClick(document.getElementById('replay-btn'), () => this.startReplay());
        blurClick(document.getElementById('daily-btn'), () => this.startDailyChallenge());
        // 关于
        blurClick(document.getElementById('about-back-btn'), () => this.showMenu());
        // 战报统计
        blurClick(document.getElementById('stats-back-btn'), () => this.showMenu());
        // 开场动画：点击/3秒后自动隐藏
        const intro = document.getElementById('intro-screen');
        if (intro) {
            const hideIntro = () => intro.style.display = 'none';
            intro.addEventListener('click', hideIntro);
            setTimeout(hideIntro, 3500);
        }
        // 角色选择
        this.buildCharSelectUI();
        blurClick(document.getElementById('char-back-btn'), () => this.showMenu());
        blurClick(document.getElementById('char-next-btn'), () => this.showLevelSelect());
        // 关卡选择
        this.buildLevelSelectUI();
        blurClick(document.getElementById('level-back-btn'), () => this.showCharSelect());
        blurClick(document.getElementById('level-start-btn'), () => this.startGame());
        // 战斗中：跳关按钮
        if (document.getElementById('skip-wave-btn')) {
            blurClick(document.getElementById('skip-wave-btn'), () => this.skipCurrentWave());
        }
        // 战斗中：超频按钮（点击触发，等同 Shift）
        if (document.getElementById('oc-btn')) {
            blurClick(document.getElementById('oc-btn'), () => {
                if (this.state === STATE.PLAYING && this.player) {
                    this.player.activateOverclock(this);
                }
            });
        }
        // 暂停界面
        blurClick(document.getElementById('resume-btn'), () => this.togglePause());
        blurClick(document.getElementById('skip-btn-pause'), () => { this.togglePause(); this.skipCurrentWave(); });
        blurClick(document.getElementById('restart-btn-pause'), () => this.startGame());
        blurClick(document.getElementById('exit-btn-pause'), () => this.returnToMenu());
        // 关卡结算面板按钮
        blurClick(document.getElementById('wr-next-btn'), () => this.closeWaveResult(true));
        blurClick(document.getElementById('wr-retry-btn'), () => this.closeWaveResult(false));
        // 结算界面
        blurClick(document.getElementById('restart-btn'), () => this.startGame());
        blurClick(document.getElementById('exit-btn-over'), () => this.showMenu());
        blurClick(document.getElementById('restart-btn-vic'), () => this.startGame());
        blurClick(document.getElementById('exit-btn-vic'), () => this.showMenu());

        // 技能槽点击
        document.querySelectorAll('.skill-slot').forEach((el) => {
            const slot = parseInt(el.getAttribute('data-slot'), 10);
            el.addEventListener('click', () => {
                if (this.state === STATE.PLAYING && this.player && this.player.alive) {
                    this.player.useSkill(slot, this);
                }
            });
        });

        // 设置面板
        this.bindSettingsUI();
        // 触屏控件
        this.bindTouchControls();
    }

    /* ============================================================
       设置面板
       ============================================================ */
    bindSettingsUI() {
        const blurClick = this._blurClick || ((el, fn) => { if (el) el.addEventListener('click', (e) => { el.blur && el.blur(); this.ensureAudio(); fn && fn(e); }); });
        const setBtn = document.getElementById('settings-btn');
        const screen = document.getElementById('settings-screen');
        const backBtn = document.getElementById('settings-back-btn');
        if (setBtn) blurClick(setBtn, () => this.showSettings());
        if (backBtn) blurClick(backBtn, () => this.applySettingsFromUI(() => this.showMenu()));

        // 画质
        document.querySelectorAll('.quality-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
        // 音效/音乐开关：实时联动 AudioManager
        const sToggle = document.getElementById('set-sound-toggle');
        const mToggle = document.getElementById('set-music-toggle');
        if (sToggle) sToggle.addEventListener('click', () => {
            sToggle.classList.toggle('on');
            this.ensureAudio();
            const on = sToggle.classList.contains('on');
            AudioManager.isSoundOn = on;
            if (AudioManager.sfxGain) AudioManager.sfxGain.gain.value = on ? 0.6 : 0;
            try { localStorage.setItem('iron_torrent_sound', on ? '1' : '0'); } catch (e) {}
        });
        if (mToggle) mToggle.addEventListener('click', () => {
            mToggle.classList.toggle('on');
            this.ensureAudio();
            const on = mToggle.classList.contains('on');
            AudioManager.isMusicOn = on;
            if (AudioManager.musicGain) AudioManager.musicGain.gain.value = on ? 0.45 : 0;
            try { localStorage.setItem('iron_torrent_music', on ? '1' : '0'); } catch (e) {}
        });
        // 音量滑条：实时联动
        const vol = document.getElementById('set-vol-slider');
        const volVal = document.getElementById('set-vol-value');
        if (vol) vol.addEventListener('input', () => {
            const v = parseFloat(vol.value);
            if (volVal) volVal.textContent = Math.round(v * 100) + '%';
            this.ensureAudio();
            AudioManager.setVolume(v);
        });
    }

    showSettings() {
        this.state = STATE.MENU; // 设置挂在菜单下
        this.hideAllOverlays();
        // 回填当前设置到 UI
        const s = this.settings;
        document.querySelectorAll('.quality-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.quality === s.quality);
        });
        const sToggle = document.getElementById('set-sound-toggle');
        const mToggle = document.getElementById('set-music-toggle');
        if (sToggle) sToggle.classList.toggle('on', !!s.sound);
        if (mToggle) mToggle.classList.toggle('on', !!s.music);
        const vol = document.getElementById('set-vol-slider');
        const volVal = document.getElementById('set-vol-value');
        if (vol) vol.value = s.volume;
        if (volVal) volVal.textContent = Math.round(s.volume * 100) + '%';
        document.getElementById('settings-screen').classList.remove('hidden');
    }

    // 从 UI 读取并应用设置
    applySettingsFromUI(done) {
        const sel = document.querySelector('.quality-btn.selected');
        if (sel && sel.dataset.quality !== this.settings.quality) this.applyQuality(sel.dataset.quality);
        const sToggle = document.getElementById('set-sound-toggle');
        const mToggle = document.getElementById('set-music-toggle');
        if (sToggle) this.settings.sound = sToggle.classList.contains('on');
        if (mToggle) this.settings.music = mToggle.classList.contains('on');
        const vol = document.getElementById('set-vol-slider');
        if (vol) this.settings.volume = parseFloat(vol.value);
        this.muted = !this.settings.sound;
        if (this.masterGain) this.masterGain.gain.value = this.settings.volume;
        // 持久化
        try { localStorage.setItem('iron_torrent_settings', JSON.stringify(this.settings)); } catch (e) {}
        // 静音指示
        const mi = document.getElementById('mute-indicator');
        if (mi) mi.classList.toggle('hidden', !this.muted);
        done && done();
    }

    /* ============================================================
       触屏控件（虚拟摇杆 + 开火 + 技能 + 超频 + 暂停）
       仅触屏设备生效；控件层由 CSS（body.touch-device.in-game）控制显示
       ============================================================ */
    fitViewport() {
        // 仅触屏设备需要动态适配；桌面保持 contain 布局不变
        if (!this.isTouchDevice) return;
        const c = document.getElementById('game-container');
        if (!c) return;
        // 微信/QQ 内置浏览器：100vh 会包含地址栏导致偏大，用 innerHeight 实测值
        // 内联样式优先级高于 CSS，可压过任何 vh/vw 规则
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w && h) {
            c.style.width = w + 'px';
            c.style.height = h + 'px';
            c.style.top = '0px';
            c.style.left = '0px';
        }
        // 顺带同步 body 高度，防止 iOS 地址栏滚动产生空隙
        document.body.style.height = h + 'px';
        document.documentElement.style.height = h + 'px';
    }

    bindTouchControls() {
        // 触屏检测（构造函数已加 class，这里兜底）
        if (this.isTouchDevice) document.body.classList.add('touch-device');

        // -------- 全屏适配（微信等内置浏览器 100vh 不准确，用 innerHeight 兜底） --------
        this.fitViewport();
        let fitTimer = null;
        const scheduleFit = (delay) => {
            clearTimeout(fitTimer);
            fitTimer = setTimeout(() => this.fitViewport(), delay);
        };
        window.addEventListener('resize', () => scheduleFit(120));
        window.addEventListener('orientationchange', () => scheduleFit(280)); // 等 iOS 旋转过渡完成再量

        const zone = document.getElementById('joystickZone');
        const knob = document.getElementById('joystickKnob');
        const fireBtn = document.getElementById('fireBtn');
        const boostBtn = document.getElementById('boostBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        if (!zone || !knob || !fireBtn || !boostBtn || !pauseBtn) return;

        const radius = 45; // 摇杆最大偏移半径（区半径约 75，旋钮 60，留边距）

        // -------- 摇杆 --------
        const startStick = (clientX, clientY) => {
            this.touch.active = true;
            zone.classList.add('active');
            this._stickCenter = zone.getBoundingClientRect();
            moveStick(clientX, clientY);
        };
        const moveStick = (clientX, clientY) => {
            if (!this._stickCenter) return;
            const r = this._stickCenter;
            let dx = clientX - (r.left + r.width / 2);
            let dy = clientY - (r.top + r.height / 2);
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > radius) { dx = dx / len * radius; dy = dy / len * radius; }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            // 归一化 -1~1，带 10% 死区
            let nx = dx / radius, ny = dy / radius;
            if (Math.abs(nx) < 0.1) nx = 0;
            if (Math.abs(ny) < 0.1) ny = 0;
            this.touch.dx = nx;
            this.touch.dy = ny;
        };
        const endStick = () => {
            this.touch.active = false;
            this.touch.dx = 0; this.touch.dy = 0;
            knob.style.transform = 'translate(0,0)';
            zone.classList.remove('active');
            this._stickCenter = null;
        };
        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const t = e.touches[0]; if (t) startStick(t.clientX, t.clientY);
        }, { passive: false });
        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = e.touches[0]; if (t) moveStick(t.clientX, t.clientY);
        }, { passive: false });
        zone.addEventListener('touchend', (e) => { e.preventDefault(); endStick(); }, { passive: false });
        zone.addEventListener('touchcancel', () => endStick());

        // -------- 开火（按住连发） --------
        const fireDown = (e) => { e.preventDefault(); this.touch.fire = true; };
        const fireUp = (e) => { e.preventDefault(); this.touch.fire = false; };
        fireBtn.addEventListener('touchstart', fireDown, { passive: false });
        fireBtn.addEventListener('touchend', fireUp, { passive: false });
        fireBtn.addEventListener('touchcancel', fireUp);

        // -------- 技能按钮（1~5） --------
        document.querySelectorAll('#skillBar .skill-btn').forEach((btn) => {
            const slot = parseInt(btn.dataset.skill, 10) - 1; // 0~4
            const press = (e) => {
                e.preventDefault();
                btn.classList.add('pressed');
                if (this.state === STATE.PLAYING && this.player && this.player.alive) {
                    const ok = this.player.useSkill(slot, this);
                    if (ok) {
                        // 顶部技能槽闪烁反馈
                        const el = document.querySelector(`.skill-slot[data-slot="${slot}"]`);
                        if (el) {
                            el.classList.remove('skill-flash');
                            void el.offsetWidth;
                            el.classList.add('skill-flash');
                            setTimeout(() => el.classList.remove('skill-flash'), 600);
                        }
                        if (navigator.vibrate) navigator.vibrate(20);
                    } else if (navigator.vibrate) {
                        navigator.vibrate([40, 40, 40]); // 失败提示
                    }
                }
            };
            const release = () => btn.classList.remove('pressed');
            btn.addEventListener('touchstart', press, { passive: false });
            btn.addEventListener('touchend', release, { passive: false });
            btn.addEventListener('touchcancel', release);
        });

        // -------- 超频按钮 --------
        boostBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.state === STATE.PLAYING && this.player && this.player.alive) {
                if (this.player.overclockReady()) {
                    this.player.activateOverclock(this);
                    if (navigator.vibrate) navigator.vibrate(30);
                } else {
                    this.toast('⚡ 超频能量未满');
                }
            }
        }, { passive: false });

        // -------- 暂停按钮 --------
        pauseBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
                this.togglePause();
                pauseBtn.textContent = (this.state === STATE.PAUSED) ? '▶' : '⏸';
            }
        }, { passive: false });

        // -------- 阻止移动端双击缩放 --------
        document.addEventListener('dblclick', (e) => e.preventDefault());
    }

    /* ============================================================
       界面切换
       ============================================================ */
    showMenu() {
        this.state = STATE.MENU;
        document.body.classList.remove('in-game'); // 隐藏触摸控件
        this.hideAllOverlays();
        document.getElementById('menu-screen').classList.remove('hidden');
        // 回到主菜单：切换 BGM + 停止心跳
        AudioManager.playBGM('menu');
        AudioManager.stopHeartbeat();
    }
    showAbout() {
        this.state = STATE.ABOUT;
        this.hideAllOverlays();
        document.getElementById('about-screen').classList.remove('hidden');
    }
    /* ===== 战报统计页：汇总 localStorage 中的累计数据 ===== */
    showStats() {
        this.hideAllOverlays();
        const s = this.stats;
        // 总游玩时间（ms → h:mm:ss）
        const pt = s.totalPlayTime || 0;
        const pth = Math.floor(pt / 3600000);
        const ptm = Math.floor((pt % 3600000) / 60000);
        const pts = Math.floor((pt % 60000) / 1000);
        document.getElementById('st-playtime').textContent =
            `${String(pth).padStart(2,'0')}:${String(ptm).padStart(2,'0')}:${String(pts).padStart(2,'0')}`;
        // 总击毁数
        document.getElementById('st-kills').textContent = (s.totalKills || 0).toLocaleString();
        // 通关次数
        document.getElementById('st-clears').textContent = s.clearCount || 0;
        // Boss 击杀数 / 击杀率
        const bossKills = s.bossKills || 0;
        const bossEnc = s.bossEncounters || 0;
        document.getElementById('st-bosskills').textContent = bossKills;
        document.getElementById('st-bossrate').textContent =
            bossEnc > 0 ? `${Math.round(bossKills / bossEnc * 100)}%` : '0%';
        // 最速通关
        const bt = s.clearTime || 0;
        document.getElementById('st-besttime').textContent =
            bt > 0 ? `${String(Math.floor(bt/60000)).padStart(2,'0')}:${String(Math.floor((bt%60000)/1000)).padStart(2,'0')}` : '--:--';
        // 最常用坦克
        const usage = s.tankUsage || {};
        let favId = null, favCount = 0;
        for (const id in usage) {
            if (usage[id] > favCount) { favCount = usage[id]; favId = id; }
        }
        const favChar = favId ? CONFIG.CHARACTERS.find(c => c.id === favId) : null;
        document.getElementById('st-favtank').textContent =
            favChar ? `${favChar.name}（${favCount} 次）` : '--';
        // 超频击杀 / 录像观看
        document.getElementById('st-ockills').textContent = s.ocKills || 0;
        document.getElementById('st-replays').textContent = s.replayViews || 0;
        document.getElementById('stats-screen').classList.remove('hidden');
    }
    showCharSelect() {
        this.state = STATE.CHAR_SELECT;
        this.hideAllOverlays();
        this.renderCharDetail();
        document.getElementById('char-screen').classList.remove('hidden');
    }
    showLevelSelect() {
        this.state = STATE.LEVEL_SELECT;
        this.hideAllOverlays();
        this.refreshLevelSelectUI();
        document.getElementById('level-screen').classList.remove('hidden');
    }
    returnToMenu() {
        this.player = null;
        this.enemies = [];
        this.boss = null;
        this.base = null;
        this.bullets.clear();
        // 退出回放：恢复 Math.random
        if (this.replayMode) this.stopReplay();
        this.showMenu();
    }

    /* ============================================================
       成就系统：localStorage 持久化 + 解锁检测 + Toast 提示
       ============================================================ */
    _loadStats() {
        try { return JSON.parse(localStorage.getItem('iron_torrent_stats') || '{}'); }
        catch (e) { return {}; }
    }
    _saveStats() {
        try { localStorage.setItem('iron_torrent_stats', JSON.stringify(this.stats)); } catch (e) {}
    }
    _loadAchievements() {
        try {
            const arr = JSON.parse(localStorage.getItem('iron_torrent_achv') || '[]');
            return new Set(arr);
        } catch (e) { return new Set(); }
    }
    _saveAchievements() {
        try { localStorage.setItem('iron_torrent_achv', JSON.stringify([...this.achvUnlocked])); } catch (e) {}
    }
    _loadClearChars() {
        try { return JSON.parse(localStorage.getItem('iron_torrent_clearchars') || '[]'); }
        catch (e) { return []; }
    }
    _saveClearChars() {
        try { localStorage.setItem('iron_torrent_clearchars', JSON.stringify(this._clearChars)); } catch (e) {}
    }

    // 累计统计字段：totalKills / bossKills / replayViews / clearTime / clearChars
    // 调用时机：敌人击杀 / Boss 击杀 / 回放观看 / 通关 / 死亡
    addStat(key, val) {
        this.stats[key] = (this.stats[key] || 0) + (val || 0);
        this._saveStats();
        this.checkAchievements();
    }
    setStat(key, val) {
        this.stats[key] = val;
        this._saveStats();
        this.checkAchievements();
    }

    /* ===== 坦克经验值系统（轻量 RPG，最多 3 级）=====
       存储：localStorage 'iron_torrent_tank_<charId>' = { level, exp }
       升级加成：每级 HP+1，移速+5%
    */
    getTankData(charId) {
        try {
            const raw = localStorage.getItem('iron_torrent_tank_' + charId);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { level: 1, exp: 0 };
    }
    _saveTankData(charId, data) {
        try { localStorage.setItem('iron_torrent_tank_' + charId, JSON.stringify(data)); } catch (e) {}
    }
    // 升级所需经验：1→2 需 100，2→3 需 250
    _expToNext(level) {
        return level === 1 ? 100 : level === 2 ? 250 : Infinity;
    }
    addTankExp(amount) {
        if (!this.selectedCharId || amount <= 0) return;
        const data = this.getTankData(this.selectedCharId);
        if (data.level >= 3) return; // 满级
        data.exp += amount;
        // 检查升级
        while (data.level < 3 && data.exp >= this._expToNext(data.level)) {
            data.exp -= this._expToNext(data.level);
            data.level++;
            this.toast(`★ 战车升级！LV.${data.level}`);
            this.sound('powerup');
            this.flashLevelUp();
        }
        this._saveTankData(this.selectedCharId, data);
    }
    // 应用坦克等级加成到 PlayerTank 实例
    applyTankLevel(player, charId) {
        const data = this.getTankData(charId);
        const lvl = data.level;
        if (lvl <= 1) return; // 1 级无加成
        const bonus = lvl - 1; // 1 或 2
        player.hp += bonus;
        player.maxHp += bonus;
        player._speed *= (1 + bonus * 0.05);
        player._boostSpeed *= (1 + bonus * 0.05);
    }

    // 触发成就检测；新解锁的成就会弹出 Toast
    checkAchievements() {
        // 组装当前快照（含派生字段）
        const snap = Object.assign({
            kills: this.kills || 0,
            totalKills: this.stats.totalKills || 0,
            bossKills: this.stats.bossKills || 0,
            bossNoHit: this._runBossNoHit,
            oneLifeClear: this.stats.oneLifeClear || false,
            ocKills: this.stats.ocKills || 0,
            clearChars: this._clearChars,
            clearTime: this.stats.clearTime || 0,
            baseFullClear: this.stats.baseFullClear || false,
            skillUses: this._runSkillUses,
            dailyWin: this.stats.dailyWin || false,
            replayViews: this.stats.replayViews || 0,
        }, this.stats);
        for (const a of CONFIG.ACHIEVEMENTS) {
            if (this.achvUnlocked.has(a.id)) continue;
            let ok = false;
            try { ok = !!a.check(snap); } catch (e) { ok = false; }
            if (ok) {
                this.achvUnlocked.add(a.id);
                this._saveAchievements();
                this.toast(`🏆 成就解锁：${a.name}`);
                this.sound('powerup');
            }
        }
    }

    // 成就面板 HTML（用于主菜单查看）
    achievementsHTML() {
        return CONFIG.ACHIEVEMENTS.map(a => {
            const unlocked = this.achvUnlocked.has(a.id);
            return `<div class="achv-item ${unlocked ? 'unlocked' : 'locked'}">
                <span class="achv-icon">${unlocked ? '🏆' : '🔒'}</span>
                <div class="achv-info">
                    <div class="achv-name">${a.name}</div>
                    <div class="achv-desc">${a.desc}</div>
                </div>
            </div>`;
        }).join('');
    }

    hideAllOverlays() {
        [
            'menu-screen','pause-screen','gameover-screen','victory-screen',
            'about-screen','char-screen','level-screen','cg-layer','settings-screen',
            'wave-result-screen','stats-screen',
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        // 清空嘲讽层
        const tl = document.getElementById('taunt-layer');
        if (tl) tl.innerHTML = '';
    }

    /* ============================================================
       角色选择 UI 构建
       ============================================================ */
    buildCharSelectUI() {
        const list = document.getElementById('char-list');
        list.innerHTML = '';
        CONFIG.CHARACTERS.forEach((ch, idx) => {
            const card = document.createElement('div');
            card.className = 'char-card' + (ch.id === this.selectedCharId ? ' selected' : '');
            card.dataset.charId = ch.id;
            // 卡片内嵌迷你雷达图 Canvas + 四维属性条
            card.innerHTML = `
                <div class="char-preview">${this.tankSVG(ch.color, ch.accent)}</div>
                <div class="char-card-name">${ch.name}</div>
                <div class="char-card-type">${ch.codeName} · ${ch.type}</div>
                <canvas class="char-radar-canvas" width="120" height="120" data-char="${ch.id}"></canvas>
                <div class="char-card-stats">${this.charStatRows(ch)}</div>
                <div class="char-card-desc">${ch.desc}</div>
            `;
            card.addEventListener('click', () => {
                this.selectedCharId = ch.id;
                document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.renderCharDetail();
            });
            list.appendChild(card);
        });
        // 卡片渲染后绘制所有迷你雷达图
        requestAnimationFrame(() => this.drawAllRadarCharts());
    }

    // 生成卡片内四维属性条 HTML（HP/机动/火力/防御，1~5 星用圆点）
    charStatRows(ch) {
        const r = ch.radar || { hp: 3, mobility: 3, firepower: 3, defense: 3 };
        const dots = (n, color) => {
            let s = '';
            for (let i = 0; i < 5; i++) {
                s += `<span class="dot ${i < n ? 'on' : ''}" style="background:${i < n ? color : 'transparent'};border-color:${color};"></span>`;
            }
            return s;
        };
        return `
            <div class="stat-line"><span class="stat-label">HP</span><span class="stat-dots">${dots(r.hp, '#ff0080')}</span></div>
            <div class="stat-line"><span class="stat-label">机动</span><span class="stat-dots">${dots(r.mobility, '#00ffcc')}</span></div>
            <div class="stat-line"><span class="stat-label">火力</span><span class="stat-dots">${dots(r.firepower, '#ff9a3c')}</span></div>
            <div class="stat-line"><span class="stat-label">防御</span><span class="stat-dots">${dots(r.defense, '#00d4ff')}</span></div>
        `;
    }

    // 绘制所有卡片内的雷达图（四维：HP/机动/火力/防御）
    drawAllRadarCharts() {
        document.querySelectorAll('.char-radar-canvas').forEach(canvas => {
            const ch = CONFIG.CHARACTERS.find(c => c.id === canvas.dataset.char);
            if (!ch) return;
            this.drawRadarChart(canvas, ch);
        });
    }

    // 在指定 Canvas 上绘制四边形雷达图
    drawRadarChart(canvas, ch) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) / 2 - 12;
        ctx.clearRect(0, 0, w, h);
        const r = ch.radar || { hp: 3, mobility: 3, firepower: 3, defense: 3 };
        // 四个维度：上=HP, 右=机动, 下=火力, 左=防御
        const dims = [
            { label: 'HP',   val: r.hp,         color: '#ff0080' },
            { label: '机动', val: r.mobility,   color: '#00ffcc' },
            { label: '火力', val: r.firepower,  color: '#ff9a3c' },
            { label: '防御', val: r.defense,    color: '#00d4ff' },
        ];
        const N = dims.length;
        // 背景网格（4 层）
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.18)';
        ctx.lineWidth = 1;
        for (let layer = 1; layer <= 5; layer++) {
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
                const rr = R * layer / 5;
                const x = cx + Math.cos(a) * rr;
                const y = cy + Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }
        // 轴线
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
        for (let i = 0; i < N; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
            ctx.stroke();
        }
        // 数据多边形
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
            const rr = R * dims[i].val / 5;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        grad.addColorStop(0, 'rgba(0, 255, 204, 0.45)');
        grad.addColorStop(1, 'rgba(180, 77, 255, 0.15)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00ffcc';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 顶点圆点
        for (let i = 0; i < N; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
            const rr = R * dims[i].val / 5;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            ctx.fillStyle = dims[i].color;
            ctx.shadowColor = dims[i].color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        // 标签
        ctx.fillStyle = '#e0f0ff';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < N; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
            const lx = cx + Math.cos(a) * (R + 8);
            const ly = cy + Math.sin(a) * (R + 8);
            ctx.fillStyle = dims[i].color;
            ctx.fillText(dims[i].label, lx, ly);
        }
    }

    tankSVG(body, accent) {
        return `<svg viewBox="-50 -50 100 100" style="color:${body}">
            <g stroke="${body}" stroke-width="3" fill="none" style="filter: drop-shadow(0 0 6px ${body});">
                <rect x="-38" y="-30" width="76" height="60" rx="4" fill="#0a1a2a"/>
                <rect x="-44" y="-30" width="8" height="60" fill="#1a2a3a"/>
                <rect x="36" y="-30" width="8" height="60" fill="#1a2a3a"/>
                <circle cx="0" cy="0" r="20" fill="#1a4a6a"/>
                <rect x="-4" y="-46" width="8" height="32" fill="${body}"/>
                <circle cx="0" cy="0" r="4" fill="${accent}" style="filter: drop-shadow(0 0 4px ${accent});"/>
            </g>
        </svg>`;
    }

    renderCharDetail() {
        const ch = CONFIG.CHARACTERS.find(c => c.id === this.selectedCharId) || CONFIG.CHARACTERS[0];
        // 初始技能描述：仅展示数量>0 的技能
        const sk = ch.startSkills;
        const skList = [
            ['护盾', sk.shield], ['速射', sk.rapid], ['装甲', sk.pierce],
            ['地雷', sk.mine], ['清屏', sk.clear],
        ].filter(([_, n]) => n > 0).map(([n, c]) => `${n}${c}`).join(' · ');
        const dropText = { high: '高', mid: '中', low: '低' }[ch.dropRate] || '中';
        const el = document.getElementById('char-detail');
        el.innerHTML = `
            <div><b>${ch.name}（${ch.codeName}）</b> · ${ch.type} — ${ch.desc}</div>
            <div style="margin-top:6px;font-size:12px;opacity:0.85;">
                初始技能：${skList || '无'} &nbsp;|&nbsp; 掉落概率：<b class="accent-text">${dropText}</b>
            </div>
        `;
    }

    /* ============================================================
       关卡选择 UI 构建
       ============================================================ */
    buildLevelSelectUI() {
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';
        for (let w = 1; w <= CONFIG.TOTAL_WAVES; w++) {
            const cell = document.createElement('div');
            const isBoss = w % CONFIG.BOSS_INTERVAL === 0;
            const locked = w > this.unlockedLevel;
            cell.className = 'level-cell'
                + (isBoss ? ' boss' : '')
                + (locked ? ' locked' : '')
                + (w === this.selectedLevel && !locked ? ' selected' : '');
            cell.dataset.wave = w;
            cell.innerHTML = `
                <div class="level-cell-num">${w}</div>
                <div class="level-cell-tag">${isBoss ? 'BOSS' : 'WAVE'}</div>
                ${locked ? '<div class="level-cell-lock">🔒</div>' : ''}
            `;
            cell.addEventListener('click', () => {
                if (locked) return;
                this.selectedLevel = w;
                document.querySelectorAll('.level-cell').forEach(c => c.classList.remove('selected'));
                cell.classList.add('selected');
            });
            grid.appendChild(cell);
        }
    }
    refreshLevelSelectUI() {
        this.selectedLevel = Math.min(this.selectedLevel, this.unlockedLevel);
        this.buildLevelSelectUI();
    }

    /* ============================================================
       开始战斗（根据所选角色/关卡）
       ============================================================ */
    startGame() {
        this.ensureAudio();
        // 结束可能存在的回放模式
        if (this.replayMode) this.stopReplay();
        const charCfg = CONFIG.CHARACTERS.find(c => c.id === this.selectedCharId) || CONFIG.CHARACTERS[0];

        this.player = new PlayerTank(CONFIG.CANVAS_W / 2, CONFIG.CANVAS_H / 2, charCfg);
        // 应用坦克经验值等级加成（HP+1/级，移速+5%/级）
        this.applyTankLevel(this.player, this.selectedCharId);
        this.enemies = [];
        this.boss = null;
        this.base = new Base();
        this.bullets.clear();
        this.powerups = [];
        this.mines = [];
        this.drones = [];   // 护卫机副机
        this.score = 0;
        this.kills = 0;
        this.wave = this.selectedLevel;

        this.obstacles.generateLevel(this.wave);
        this.startWave(this.wave);
        this.state = STATE.PLAYING;
        document.body.classList.add('in-game'); // 显示触摸控件
        this.hideAllOverlays();
        this.lastTime = Utils.now();

        // 切换至战斗 BGM（Boss 关除外，Boss 出现时再切 boss BGM）
        const isBossWave = (this.wave % CONFIG.BOSS_INTERVAL === 0);
        AudioManager.playBGM(isBossWave ? 'boss' : 'battle');

        // 重置单局成就统计字段
        this._runStartTime = Utils.now();
        this._runStartKills = this.kills;
        this._runSkillUses = 0;
        this._runOcKills = 0;
        this._runNoDeath = true;
        this._runBossNoHit = false;

        // ===== 战报统计：坦克使用次数 +1 =====
        if (this.selectedCharId) {
            this.stats.tankUsage = this.stats.tankUsage || {};
            this.stats.tankUsage[this.selectedCharId] = (this.stats.tankUsage[this.selectedCharId] || 0) + 1;
            this._saveStats();
        }

        // 启动录像录制（仅对正常对局，跳过测试模式）
        if (!this.testMode) {
            this.replayRecording = {
                seed: (Math.random() * 1e9) | 0,
                charId: this.selectedCharId,
                level: this.selectedLevel,
                startWall: Utils.now(),
                events: [],
            };
        }
    }

    /* ============================================================
       录像回放（Replay）
       ============================================================ */
    // mulberry32：确定性 PRNG
    _mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // 从 localStorage 读取上一局录像并启动回放
    startReplay() {
        let data = null;
        try { data = JSON.parse(localStorage.getItem('iron_torrent_replay') || 'null'); } catch (e) {}
        if (!data || !data.events || !data.events.length) {
            this.toast('暂无录像，先打一局');
            return;
        }
        this.replayData = data;
        this.replayMode = true;
        // 回放速度（1× / 2× / 4×），默认 1×；用户可在回放中按 Tab 切换
        this.replaySpeed = 1;
        // 锁定选择角色与关卡为录像中的
        this.selectedCharId = data.charId;
        this.selectedLevel = data.level;
        // 重写 Math.random 为确定性 PRNG（确保敌人/掉落/嘲讽等行为复现）
        Math.random = this._mulberry32(data.seed);
        // 启动对局（不进入录制）
        this.replayRecording = null;
        this.startGame();
        // startGame 内会再次设置 replayRecording，这里强制清空
        this.replayRecording = null;
        this.replayTime = 0;
        this.replayEventIdx = 0;
        // 成就统计：观看回放次数 +1
        this.addStat('replayViews', 1);
        this.toast('▶ 录 像 回 放 中（Esc 返回 · Tab 调速）');
    }

    // 停止回放：恢复 Math.random 并清理状态
    stopReplay() {
        if (!this.replayMode) return;
        Math.random = this._origRandom;
        this.replayMode = false;
        this.replayData = null;
        this.replayTime = 0;
        this.replayEventIdx = 0;
        this.replaySpeed = 1;
    }

    // 切换回放速度（1× → 2× → 4× → 1×）
    cycleReplaySpeed() {
        if (!this.replayMode) return;
        const speeds = [1, 2, 4];
        const i = speeds.indexOf(this.replaySpeed);
        this.replaySpeed = speeds[(i + 1) % speeds.length];
        this.toast(`▶ 回放速度 ${this.replaySpeed}×`);
    }

    /* ============================================================
       每日挑战：当日固定种子生成相同关卡序列，全服玩家同场竞技
       保存今日最高分到 localStorage（按日期键）
       ============================================================ */
    _todayKey() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
    startDailyChallenge() {
        const seedStr = this._todayKey();
        const seed = parseInt(seedStr, 10);
        // 用种子驱动 PRNG，决定今日起始关卡（1~5）与角色
        const rng = this._mulberry32(seed);
        const startLevel = 1 + Math.floor(rng() * 5);
        const charIds = CONFIG.CHARACTERS.map(c => c.id);
        const charId = charIds[Math.floor(rng() * charIds.length)];
        this.selectedLevel = startLevel;
        this.selectedCharId = charId;
        this.dailyMode = true;
        // 锁定 Math.random 为今日种子，确保所有人关卡布局一致
        Math.random = this._mulberry32(seed);
        this.startGame();
        Math.random = this._origRandom; // 战斗内仍可用真随机（仅关卡布局固定）
        const best = this.getDailyBest();
        this.toast(`📅 每日挑战 · 今日最佳 ${best} 分`);
    }
    getDailyBest() {
        try { return parseInt(localStorage.getItem('iron_torrent_daily_' + this._todayKey()) || '0', 10); }
        catch (e) { return 0; }
    }
    saveDailyBest(score) {
        const key = 'iron_torrent_daily_' + this._todayKey();
        const cur = this.getDailyBest();
        if (score > cur) {
            try { localStorage.setItem(key, String(score)); } catch (e) {}
        }
    }

    /* ============================================================
       开发者控制台（~ 键开关）
       显示：FPS / 实体数 / 碰撞框 / 敌人路径
       ============================================================ */
    toggleDebug() {
        this.debugMode = !this.debugMode;
        this.toast(this.debugMode ? '🛠 开发者控制台 ON' : '🛠 开发者控制台 OFF');
    }

    // 在 update() 中调用：根据回放时间触发录像中的输入事件
    // dt 按回放速度倍率放大，实现 2×/4× 快进
    updateReplay(dt) {
        if (!this.replayMode || !this.replayData) return;
        const scaled = dt * (this.replaySpeed || 1);
        this.replayTime += scaled;
        const evs = this.replayData.events;
        while (this.replayEventIdx < evs.length &&
               evs[this.replayEventIdx].t <= this.replayTime) {
            const ev = evs[this.replayEventIdx++];
            if (ev.key === 'mousefire') {
                this.mouseFire = ev.down;
            } else {
                this.keys[ev.key] = ev.down;
            }
        }
    }

    /* ============================================================
       本地钢墙验证靶场：index.html?test=steel
       ============================================================ */
    startSteelWallTest() {
        const charCfg = CONFIG.CHARACTERS[0];
        const grid = CONFIG.GRID;
        const centerCol = Math.floor(CONFIG.CANVAS_W / grid / 2);
        const playerRow = Math.floor(CONFIG.CANVAS_H / grid) - 3;
        const targetRow = playerRow - 6;

        this.player = new PlayerTank(
            centerCol * grid + grid / 2,
            playerRow * grid + grid / 2,
            charCfg
        );
        this.player.dir = Utils.DIR.UP;
        this.player.weaponLevel = this.player.maxWeaponLevel;

        this.enemies = [];
        this.boss = null;
        this.base = null;
        this.bullets.clear();
        this.powerups = [];
        this.mines = [];
        this.obstacles.clear();

        this.testSteelWall = new Obstacle(centerCol, targetRow, 'steel');
        this.obstacles.add(this.testSteelWall);
        this.steelTestPassed = false;

        this.score = 0;
        this.kills = 0;
        this.wave = 1;
        this.waveEnemiesTotal = 0;
        this.waveEnemiesSpawned = 0;
        this.waveCleared = false;
        this.state = STATE.PLAYING;
        this.hideAllOverlays();
        this.lastTime = Utils.now();
        this.updateHUD();

        setTimeout(() => {
            this.toast('钢墙验证靶场：按住空格 / J / 鼠标左键开火');
        }, 100);
    }

    /* ============================================================
       跳关：立即清空当前波敌人 / 击败当前波 Boss
       ============================================================ */
    skipCurrentWave() {
        if (this.state !== STATE.PLAYING) return;
        this.toast('⚠ 跳关 · 强制完成');
        this.sound('boss');
        // 清场
        for (const e of this.enemies) {
            if (!e.alive) continue;
            this.particles.explode(e.x, e.y, e.color, 1);
            this.score += Math.floor((e.score || 50) * 0.5);
            e.alive = false;
        }
        if (this.boss && this.boss.alive) {
            this.particles.explode(this.boss.x, this.boss.y, '#ff2a5a', 2);
            this.score += 2000;
            this.boss.alive = false;
            this.boss = null;
        }
        this.waveEnemiesSpawned = this.waveEnemiesTotal;
        // 强制完成波次（下一波）
        this.waveCleared = false;
        setTimeout(() => this.completeWave(), 200);
        this.screenShake(10, 'large');
    }

    /* ============================================================
       波次管理
       ============================================================ */
    startWave(wave) {
        this.wave = wave;
        this.waveEnemiesTotal = CONFIG.SPAWN.basePerWave + (wave - 1) * CONFIG.SPAWN.perWaveGrowth;

        // ===== 动态难度调整（Dynamic Difficulty）=====
        // 连续3关无伤 → +20%；连续2关死亡 → -30%（仅作用于普通波，不影响 Boss 波）
        if (wave % CONFIG.BOSS_INTERVAL !== 0) {
            let diffMult = 1.0;
            const reasons = [];
            if (this._noDamageStreak >= 3) {
                diffMult *= 1.2;
                reasons.push('挑战升级 +20%');
            }
            if (this._deathStreak >= 2) {
                diffMult *= 0.7;
                reasons.push('难度放宽 -30%');
            }
            if (reasons.length) {
                this.waveEnemiesTotal = Math.max(3, Math.round(this.waveEnemiesTotal * diffMult));
                this.toast(`动态难度：${reasons.join(' / ')}`);
            }
        }

        this.waveEnemiesSpawned = 0;
        this.waveEnemiesKilled = 0;
        this.spawnInterval = Math.max(
            CONFIG.SPAWN.minInterval,
            CONFIG.SPAWN.baseInterval - (wave - 1) * CONFIG.SPAWN.intervalDecPerWave
        );
        this.spawnTimer = 800; // 波开始延迟一点
        this.waveCleared = false;
        this.waveBreakTimer = 0;

        // ===== 每关结算数据跟踪 =====
        this._waveStartKills = this.kills;
        this._waveStartTime = Utils.now();
        this._waveStartHp = this.player ? this.player.hp : 0;
        this._wavePickups = 0;
        this._waveMaxCombo = 0;
        this._waveCombo = 0;
        this._waveLastKillTime = 0;

        // ===== 动态环境：每5关切换氛围 =====
        const prevEnv = this.environment;
        if (wave <= 5) this.environment = 'normal';
        else if (wave <= 10) this.environment = 'storm';
        else this.environment = 'night';
        if (prevEnv !== this.environment) {
            const envNames = { normal: '清晰星空', storm: '⚠ 电磁风暴', night: '🌙 暗夜突袭' };
            this.toast(`环境变化：${envNames[this.environment]}`);
        }

        // 每 BOSS_INTERVAL 波生成 Boss（且不生成普通敌人，纯 Boss 战）
        if (wave % CONFIG.BOSS_INTERVAL === 0) {
            this.spawnBoss();
            this.toast(`WAVE ${wave} - BOSS`);
        } else {
            this.toast(`WAVE ${wave}`);
        }

        // ===== 关卡过渡：光圈收缩动画（"WAVE X START!"）=====
        this._waveTransition = {
            state: 'contract',
            t: 0,
            duration: 1000,
            text: `WAVE ${wave} START!`,
        };
    }

    spawnBoss() {
        // 每 5 关随机抽取一种 Boss（重型攻城炮 / 无人机母舰）
        const types = Object.keys(CONFIG.BOSS.types);
        const t = types[Utils.randInt(0, types.length - 1)];
        this.boss = new BossTank(CONFIG.CANVAS_W / 2, 120, t);
        this.particles.explode(this.boss.x, this.boss.y, this.boss.color, 1.5);
        this.screenShake(12, 'large');
        this.sound('boss');
        // 切换至 Boss 战 BGM
        AudioManager.playBGM('boss');
        const name = CONFIG.BOSS.types[t].name;
        this.toast(`BOSS · ${name}`);
        // ===== 战报统计：Boss 遭遇次数 +1 =====
        this.addStat('bossEncounters', 1);
    }

    // 检查波次是否完成
    checkWaveComplete() {
        // Boss 波：Boss 死亡即完成
        if (this.wave % CONFIG.BOSS_INTERVAL === 0) {
            if (this.boss === null) {
                this.completeWave();
            }
            return;
        }
        // 普通波：所有敌人已生成且场上无活着的敌人（dying 状态的将死敌人不算）
        if (this.waveEnemiesSpawned >= this.waveEnemiesTotal &&
            this.enemies.filter(e => e.alive && !e.dying).length === 0) {
            this.completeWave();
        }
    }

    completeWave() {
        if (this.waveCleared) return;
        this.waveCleared = true;
        this.waveBreakTimer = 2500;
        const clearText = this.wave >= CONFIG.TOTAL_WAVES ? 'FINAL WAVE CLEAR!' : 'WAVE CLEAR!';
        this.toast(clearText);
        this.sound('clear');
        // ===== 关卡过渡：光圈扩散动画 =====
        this._waveTransition = {
            state: 'expand',
            t: 0,
            duration: 1200,
            text: `WAVE ${this.wave} CLEAR!`,
        };

        // ===== 显示战后结算面板（S/A/B/C 评价）=====
        this.showWaveResult();

        // 解锁下一关（持久化）
        const nextLv = Math.min(CONFIG.TOTAL_WAVES, this.wave + 1);
        if (nextLv > this.unlockedLevel) {
            this.unlockedLevel = nextLv;
            try { localStorage.setItem('iron_torrent_unlocked', String(this.unlockedLevel)); } catch (e) {}
        }
    }

    /* 战后结算面板：计算 S/A/B/C 评价并显示 */
    showWaveResult() {
        if (!this.player) return;
        const waveKills = this.kills - (this._waveStartKills || 0);
        const waveTime = Utils.now() - (this._waveStartTime || Utils.now());
        const wavePickups = this._wavePickups || 0;
        const waveMaxCombo = this._waveMaxCombo || 0;
        const hpLost = (this._waveStartHp || 0) - this.player.hp;

        // 评价标准：S(无伤) → A(受伤1~2) → B(3+) → C(死亡复活)
        let grade, gradeColor;
        if (hpLost === 0 && this.player.alive) {
            grade = 'S'; gradeColor = '#ffe600';
        } else if (hpLost <= 2 && this.player.alive) {
            grade = 'A'; gradeColor = '#00ffcc';
        } else if (hpLost <= 4 && this.player.alive) {
            grade = 'B'; gradeColor = '#00d4ff';
        } else {
            grade = 'C'; gradeColor = '#ff2a5a';
        }

        // 时间格式化为 mm:ss
        const secs = Math.floor(waveTime / 1000);
        const mm = String(Math.floor(secs / 60)).padStart(2, '0');
        const ss = String(secs % 60).padStart(2, '0');

        // 填充结算面板
        const panel = document.getElementById('wave-result-screen');
        if (!panel) return;
        document.getElementById('wr-wave').textContent = this.wave;
        document.getElementById('wr-kills').textContent = waveKills;
        document.getElementById('wr-combo').textContent = waveMaxCombo;
        document.getElementById('wr-pickups').textContent = wavePickups;
        document.getElementById('wr-time').textContent = `${mm}:${ss}`;
        const gradeEl = document.getElementById('wr-grade');
        gradeEl.textContent = grade;
        gradeEl.style.color = gradeColor;
        gradeEl.style.textShadow = `0 0 20px ${gradeColor}`;

        // 延迟显示（让光圈动画先播 1.2s）
        setTimeout(() => {
            if (this.state === STATE.PLAYING) {
                panel.classList.remove('hidden');
            }
        }, 1300);

        // ===== 坦克经验值累加 =====
        this.addTankExp(waveKills * 10 + (grade === 'S' ? 50 : grade === 'A' ? 30 : 10));

        // ===== 动态难度计数：完成本关 → 更新连续记录 =====
        // 无伤(S级) → 连续无伤 +1；受伤 → 清零；完成本关 → 连续死亡清零
        if (hpLost === 0) {
            this._noDamageStreak++;
        } else {
            this._noDamageStreak = 0;
        }
        this._deathStreak = 0;
        try {
            localStorage.setItem('iron_torrent_nodmg', String(this._noDamageStreak));
            localStorage.setItem('iron_torrent_death', '0');
        } catch (e) {}
    }

    /* 关闭结算面板 → 进入下一关 */
    closeWaveResult(next) {
        const panel = document.getElementById('wave-result-screen');
        if (panel) panel.classList.add('hidden');
        if (next) {
            // 继续下一关（由 update 中的 waveBreakTimer 自动推进）
            this.waveBreakTimer = 600;
        } else {
            // 重新挑战本关
            this.waveBreakTimer = 0;
            this.waveCleared = false;
            this.startWave(this.wave);
        }
    }

    /* ============================================================
       主循环
       ============================================================ */
    loop(now) {
        let frameTime = Math.min(100, now - this.lastTime); // 限制最大帧时长，避免卡顿穿透（防螺旋死亡）
        this.lastTime = now;

        // FPS 平滑统计（用于开发者控制台显示）
        this._fpsAccum += frameTime;
        this._fpsFrames++;
        if (this._fpsAccum >= 500) {
            this._fps = Math.round(1000 * this._fpsFrames / this._fpsAccum);
            this._fpsAccum = 0;
            this._fpsFrames = 0;
        }

        // 固定时间步长推进：1/60s 一次 update（提升确定性，利于录像回放）
        if (this.state === STATE.PLAYING) {
            this._fixedAccumulator += frameTime;
            // 限制单帧最大步数，避免长时间卡顿后追帧过多
            let steps = 0;
            while (this._fixedAccumulator >= this._FIXED_DT && steps < 5) {
                this.update(this._FIXED_DT);
                this._fixedAccumulator -= this._FIXED_DT;
                steps++;
            }
            // 若仍有积压（罕见），丢弃避免死循环
            if (this._fixedAccumulator > this._FIXED_DT * 5) {
                this._fixedAccumulator = 0;
            }
        }
        // 始终渲染（菜单/暂停时也显示画面）
        this.render(frameTime);
        // 开发者控制台叠加层（最顶层）
        if (this.debugMode) this.drawDebugOverlay();

        // 清理单帧边沿触发标记（确保每帧最多触发一次技能）
        this._pressedOnce = {};

        requestAnimationFrame(this.loop);
    }

    /* ============================================================
       开发者控制台叠加层：FPS / 实体数 / 碰撞框 / 敌人路径
       ============================================================ */
    drawDebugOverlay() {
        const ctx = this.ctx;
        ctx.save();
        // 左上角文字面板
        const x = 8, y = 50;
        const lines = [
            `FPS: ${this._fps}`,
            `ENTITIES: 敌人=${this.enemies.length} 子弹=${this.bullets.active().length} 道具=${this.powerups.length} 粒子=${this.particles.list.length}`,
            `WAVE: ${this.wave}  STATE: ${this.state}`,
            `PLAYER: (${Math.round(this.player ? this.player.x : 0)}, ${Math.round(this.player ? this.player.y : 0)}) HP=${this.player ? this.player.hp : 0}`,
            `SPATIAL HASH CELLS: ${this._spatial.cells.size}`,
        ];
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        const panelW = 360, panelH = lines.length * 16 + 10;
        ctx.fillRect(x, y, panelW, panelH);
        ctx.strokeStyle = '#00ffcc';
        ctx.strokeRect(x, y, panelW, panelH);
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => ctx.fillText(line, x + 8, y + 6 + i * 16));

        // 碰撞框：玩家/敌人/Boss/子弹
        ctx.lineWidth = 1;
        if (this.player && this.player.alive) {
            ctx.strokeStyle = '#00d4ff';
            ctx.strokeRect(this.player.x - this.player.size/2, this.player.y - this.player.size/2, this.player.size, this.player.size);
        }
        ctx.strokeStyle = '#ff6680';
        for (const e of this.enemies) {
            if (!e.alive) continue;
            ctx.strokeRect(e.x - e.size/2, e.y - e.size/2, e.size, e.size);
            // 敌人→玩家 路径线
            if (this.player) {
                ctx.beginPath();
                ctx.moveTo(e.x, e.y);
                ctx.lineTo(this.player.x, this.player.y);
                ctx.strokeStyle = 'rgba(255, 102, 128, 0.25)';
                ctx.stroke();
                ctx.strokeStyle = '#ff6680';
            }
        }
        if (this.boss && this.boss.alive) {
            ctx.strokeStyle = '#ff0080';
            ctx.strokeRect(this.boss.x - this.boss.size/2, this.boss.y - this.boss.size/2, this.boss.size, this.boss.size);
        }
        ctx.strokeStyle = '#ffe600';
        for (const b of this.bullets.active()) {
            if (!b.active) continue;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.stroke();
        }
        // 障碍物碰撞框
        ctx.strokeStyle = 'rgba(100, 120, 140, 0.4)';
        for (const o of this.obstacles.list) {
            if (o.dead || !(o.type === 'brick' || o.type === 'steel')) continue;
            ctx.strokeRect(o.x, o.y, o.w, o.h);
        }
        ctx.restore();
    }

    /* ============================================================
       更新
       ============================================================ */
    update(dt) {
        // 录像回放：根据时间触发输入事件（在 syncPlayerInput 之前）
        this.updateReplay(dt);
        this.syncPlayerInput();

        // 玩家
        if (this.player) this.player.update(dt, this);

        // 生成敌人
        this.updateSpawning(dt);

        // 敌人
        for (const e of this.enemies) e.update(dt, this);
        // 移除死亡敌人
        this.enemies = this.enemies.filter(e => e.alive);

        // Boss
        if (this.boss) {
            this.boss.update(dt, this);
            if (!this.boss.alive) this.boss = null;
        }

        // ===== 动态音频：低血量心跳 + Boss 30% 加速 =====
        this._updateDynamicAudio();

        // ===== 关卡过渡动画推进 =====
        this.updateWaveTransition(dt);

        // 基地（鹰巢）
        if (this.base) this.base.update(dt);

        // 嘲讽气泡 DOM 更新（在敌人/玩家更新之后坐标已最新）
        this.updateTauntLayer();

        // 子弹
        this.bullets.update(dt, this);

        // 碰撞：子弹 vs 坦克
        this.handleBulletCollisions();

        // 道具
        for (const p of this.powerups) p.update(dt);
        this.handlePowerupPickups();
        this.powerups = this.powerups.filter(p => !p.dead);

        // 地雷
        for (const m of this.mines) m.update(dt, this);
        this.mines = this.mines.filter(m => !m.dead);

        // 护卫机副机
        if (this.drones) {
            for (const d of this.drones) d.update(dt, this);
            this.drones = this.drones.filter(d => d.alive);
        }

        // 障碍物动画
        this.obstacles.update(dt);

        // 粒子
        this.particles.update(dt);

        // 屏幕震动衰减
        if (this.shakeTime > 0) {
            this.shakeTime -= dt;
            if (this.shakeTime <= 0) this.shakeAmount = 0;
        }

        // 背景滚动
        this.gridScroll = (this.gridScroll + dt * 0.02) % CONFIG.GRID;

        // 测试靶场不运行波次逻辑
        if (!this.testMode) {
            this.checkWaveComplete();
            if (this.waveCleared) {
                this.waveBreakTimer -= dt;
                if (this.waveBreakTimer <= 0) {
                    if (this.wave >= CONFIG.TOTAL_WAVES) {
                        this.victory();
                    } else {
                        this.startWave(this.wave + 1);
                        // 每波重新生成部分障碍物
                        this.obstacles.generateLevel(this.wave);
                    }
                }
            }
        } else if (this.testSteelWall && this.testSteelWall.dead && !this.steelTestPassed) {
            this.steelTestPassed = true;
            this.toast('PASS：最高火力已摧毁钢墙');
            this.sound('explode');
        }

        // 玩家死亡
        if (this.player && !this.player.alive && this.state === STATE.PLAYING) {
            // 延迟一点显示结束界面
            setTimeout(() => this.gameOver(), 1200);
            this.state = STATE.GAME_OVER; // 防止重复触发
        }

        // 更新 HUD
        this.updateHUD();
    }

    /* 动态音频：低血量心跳 + Boss 30% 加速 + 低血量降低 BGM 音量 */
    _updateDynamicAudio() {
        if (!this.player) {
            AudioManager.stopHeartbeat();
            AudioManager.setBgmPlaybackRate(1.0);
            return;
        }

        // ===== 低血量心跳（HP <= 1 时启动）=====
        const lowHp = this.player.hp <= 1 && this.player.alive && this.state === STATE.PLAYING;
        if (lowHp && !AudioManager.heartbeatTimer) {
            AudioManager.startHeartbeat();
            // 同时降低 BGM 音量，让心跳更突出
            if (AudioManager.musicGain && AudioManager.isMusicOn) {
                AudioManager.musicGain.gain.value = 0.22;
            }
        } else if (!lowHp && AudioManager.heartbeatTimer) {
            AudioManager.stopHeartbeat();
            // 恢复 BGM 音量
            if (AudioManager.musicGain && AudioManager.isMusicOn) {
                AudioManager.musicGain.gain.value = 0.45;
            }
        }

        // ===== Boss 30% 血量时音乐加速 10% =====
        if (this.boss && this.boss.alive && this.boss.maxHp > 0) {
            const ratio = this.boss.hp / this.boss.maxHp;
            if (ratio <= 0.3) {
                if (AudioManager.bgmPlaybackRate !== 1.1) {
                    AudioManager.setBgmPlaybackRate(1.1);
                    // 重启调度器以应用新的节奏
                    if (AudioManager.currentBGM === 'boss' && AudioManager.bgmScheduler) {
                        clearInterval(AudioManager.bgmScheduler);
                        const stepMs = 60000 / AudioManager.bgmTempo / 4 / 1.1;
                        AudioManager.bgmScheduler = setInterval(() => AudioManager._bgmTick(), stepMs);
                    }
                    this.toast('⚠ BOSS 狂暴化');
                }
            } else {
                if (AudioManager.bgmPlaybackRate !== 1.0) {
                    AudioManager.setBgmPlaybackRate(1.0);
                    if (AudioManager.currentBGM === 'boss' && AudioManager.bgmScheduler) {
                        clearInterval(AudioManager.bgmScheduler);
                        const stepMs = 60000 / AudioManager.bgmTempo / 4;
                        AudioManager.bgmScheduler = setInterval(() => AudioManager._bgmTick(), stepMs);
                    }
                }
            }
        } else {
            // 无 Boss 时重置播放速率
            if (AudioManager.bgmPlaybackRate !== 1.0) {
                AudioManager.setBgmPlaybackRate(1.0);
                if (AudioManager.currentBGM && AudioManager.bgmScheduler) {
                    clearInterval(AudioManager.bgmScheduler);
                    const stepMs = 60000 / AudioManager.bgmTempo / 4;
                    AudioManager.bgmScheduler = setInterval(() => AudioManager._bgmTick(), stepMs);
                }
            }
        }
    }

    updateSpawning(dt) {
        // Boss 波不生成普通敌人
        if (this.wave % CONFIG.BOSS_INTERVAL === 0) return;
        if (this.waveEnemiesSpawned >= this.waveEnemiesTotal) return;
        // 限制场上同时存活敌人数量（dying 状态的将死敌人不计入名额）
        if (this.enemies.filter(e => e.alive && !e.dying).length >= CONFIG.SPAWN.maxAlive) return;

        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            const e = EnemyFactory.create(this.wave);
            this.enemies.push(e);
            this.particles.explode(e.x, e.y, e.color, 0.4);
            this.waveEnemiesSpawned++;
            this.spawnTimer = this.spawnInterval;
            this.soundSpatial('spawn', e.x, e.y);
        }
    }

    /* ============================================================
       子弹碰撞分发（使用空间哈希网格优化，避免 O(n²) 复杂度）
       ============================================================ */
    handleBulletCollisions() {
        const bullets = this.bullets.active();

        // 构建空间哈希：把所有可被玩家子弹命中的目标分桶
        // （敌人 / Boss / 无人机母舰的无人机），每帧重建一次
        this._spatial.clear();
        for (const e of this.enemies) {
            // 跳过 dying 状态的敌人：它们不能被子弹击中（避免挡住活着的敌人）
            if (e.alive && !e.dying) this._spatial.insert(e);
        }
        if (this.boss && this.boss.alive) this._spatial.insert(this.boss);
        if (this.boss && this.boss.bossType === 'carrier' && this.boss.drones.length) {
            for (const d of this.boss.drones) {
                if (d.alive) this._spatial.insert({ x: d.x, y: d.y, size: 9, _drone: d });
            }
        }

        for (const b of bullets) {
            if (!b.active) continue;

            if (b.owner === 'player') {
                // 玩家子弹 vs 敌人 / Boss / 无人机（空间哈希候选）
                const candidates = this._spatial.queryNear(b.x, b.y, b.size + 40);
                let hit = false;
                let chainOrigin = null;
                for (const c of candidates) {
                    if (c._drone) {
                        // 无人机母舰的无人机
                        const d = c._drone;
                        if (!d.alive) continue;
                        const dr = Utils.rect(d.x - 9, d.y - 9, 18, 18);
                        if (Utils.circleRect(b.x, b.y, b.size, dr)) {
                            this.boss.damageDrone(d, b.damage, this);
                            hit = true;
                            if (b.pierceLeft > 0) { b.pierceLeft--; }
                            else { b.active = false; break; }
                        }
                    } else if (c === this.boss) {
                        // Boss
                        const br = Utils.rect(this.boss.x, this.boss.y, this.boss.size, this.boss.size);
                        if (Utils.circleRect(b.x, b.y, b.size, br)) {
                            this.boss.takeDamage(b.damage, this);
                            hit = true;
                            if (b.chain && !chainOrigin) chainOrigin = this.boss;
                            if (b.pierceLeft > 0) { b.pierceLeft--; }
                            else { b.active = false; break; }
                        }
                    } else {
                        // 普通敌人
                        const e = c;
                        if (!e.alive) continue;
                        const er = Utils.rect(e.x, e.y, e.size, e.size);
                        if (Utils.circleRect(b.x, b.y, b.size, er)) {
                            e.takeDamage(b.damage, this, b);
                            hit = true;
                            if (b.chain && !chainOrigin) chainOrigin = e;
                            if (b.pierceLeft > 0) {
                                b.pierceLeft--;
                            } else {
                                b.active = false;
                                break;
                            }
                        }
                    }
                }
                // 超频子弹：连锁闪电跳跃到附近敌人
                if (b.chain && chainOrigin) {
                    this.chainLightning(chainOrigin, b.damage);
                }
                if (hit && !b.active) continue;
            } else {
                // 敌方/Boss 子弹 vs 玩家
                const p = this.player;
                if (p && p.alive) {
                    const pr = Utils.rect(p.x, p.y, p.size, p.size);
                    if (Utils.circleRect(b.x, b.y, b.size, pr)) {
                        p.takeDamage(b.damage, this);
                        b.active = false;
                        this.sound('hit');
                        continue;
                    }
                }
                // 敌方/Boss 子弹 vs 基地（鹰巢）
                if (this.base && this.base.alive && this.base.hitBy(b)) {
                    this.base.takeDamage(b.damage, this);
                    b.active = false;
                    this.particles.hitSpark(b.x, b.y, '#ff0080');
                    this.sound('hit');
                }
            }
        }
    }

    /* ============================================================
       超频连锁闪电：从命中目标向附近敌人跳跃，造成递减伤害
       ============================================================ */
    chainLightning(origin, baseDmg) {
        if (!origin) return;
        this.chainLightningFromPoint(origin.x, origin.y, baseDmg);
    }

    chainLightningFromPoint(ox, oy, baseDmg) {
        const oc = CONFIG.OVERCLOCK;
        let cx = ox, cy = oy;
        const hit = new Set();
        let dmg = oc.chainDamage;
        for (let jump = 0; jump < oc.chainJumps; jump++) {
            // 找最近的未命中敌人
            let target = null, bestD = oc.chainRange * oc.chainRange;
            for (const e of this.enemies) {
                if (!e.alive || e.dying || hit.has(e)) continue;
                const dx = e.x - cx, dy = e.y - cy;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestD) { bestD = d2; target = e; }
            }
            if (!target) break;
            hit.add(target);
            // 闪电视觉
            this.particles.lightning(cx, cy, target.x, target.y);
            target.takeDamage(dmg, this, null);
            cx = target.x; cy = target.y;
        }
        this.sound('powerup');
    }

    /* ============================================================
       基地被摧毁 → 失败
       ============================================================ */
    onBaseDestroyed() {
        if (this.state === STATE.GAME_OVER) return;
        this.particles.explode(this.base.x, this.base.y, '#ff0080', 2.2);
        this.screenShake(16, 'huge');
        this.sound('bossDead');
        this.toast('基地沦陷!');
        // 标记玩家死亡以触发失败结算
        if (this.player) this.player.alive = false;
        setTimeout(() => this.gameOver(), 900);
        this.state = STATE.GAME_OVER; // 防止重复触发
    }

    /* ============================================================
       道具拾取
       ============================================================ */
    handlePowerupPickups() {
        if (!this.player || !this.player.alive) return;
        for (const p of this.powerups) {
            if (p.dead) continue;
            if (p.hitPickup(this.player.x, this.player.y, this.player.size)) {
                p.dead = true;
                this.player.applyPowerUp(p.type, this);
                this.particles.explode(p.x, p.y, p.color, 0.6);
                this.sound('powerup');
                // 每关道具拾取计数
                this._wavePickups = (this._wavePickups || 0) + 1;
            }
        }
    }

    /* ============================================================
       击杀回调（由敌人/Boss 调用）
       ============================================================ */
    onEnemyKilled(enemy, bullet) {
        this.kills++;
        this.score += enemy.score;
        this.particles.floatText(enemy.x, enemy.y, `+${enemy.score}`, '#00ffcc');
        this.soundSpatial('explode', enemy.x, enemy.y);
        // 成就统计：累计击杀 + 单局超频击杀
        this.addStat('totalKills', 1);
        if (bullet && bullet.chain) this._runOcKills++;
        if (this.player && this.player.isOverclocking()) this._runOcKills++;
        if (this._runOcKills > 0) this.setStat('ocKills', (this.stats.ocKills || 0) + 0); // 占位：下方汇总
        // ===== 每关连杀统计（2秒内连续击杀计入连杀）=====
        const now = Utils.now();
        if (now - this._waveLastKillTime < 2000) {
            this._waveCombo++;
        } else {
            this._waveCombo = 1;
        }
        if (this._waveCombo > this._waveMaxCombo) this._waveMaxCombo = this._waveCombo;
        this._waveLastKillTime = now;
        // 掉落道具
        if (Utils.chance(CONFIG.SPAWN.powerupDropChance)) {
            this.powerups.push(new PowerUp(enemy.x, enemy.y, PowerUp.randomType()));
        }
    }

    onBossKilled(boss) {
        this.kills++;
        this.score += boss.score;
        this.particles.floatText(boss.x, boss.y, `+${boss.score}`, '#ffe600');
        // Boss 死亡大爆炸
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                this.particles.explode(
                    boss.x + Utils.rand(-40, 40),
                    boss.y + Utils.rand(-40, 40),
                    Utils.pick(['#ff2a5a','#ff7a00','#ffe600']),
                    1.5
                );
                this.screenShake(8, 'mid');
            }, i * 120);
        }
        // 必掉道具
        for (let i = 0; i < 2; i++) {
            this.powerups.push(new PowerUp(
                boss.x + Utils.rand(-30, 30),
                boss.y + Utils.rand(-30, 30),
                PowerUp.randomType()
            ));
        }
        this.sound('bossDead');
        // 成就统计：Boss 击杀 + 满血判定
        this.addStat('bossKills', 1);
        // 满血击杀 Boss：玩家当前 HP == maxHP
        if (this.player && this.player.hp >= this.player.maxHp) {
            this._runBossNoHit = true;
        }
        this.checkAchievements();
    }

    /* ============================================================
       渲染
       ============================================================ */
    render(dt) {
        const ctx = this.ctx;
        ctx.save();

        // 左侧按键提示：仅战斗中显示
        const hint = document.getElementById('controls-hint');
        if (hint) hint.classList.toggle('hidden', this.state !== STATE.PLAYING);

        // 屏幕震动偏移
        if (this.shakeAmount > 0) {
            const sx = Utils.rand(-this.shakeAmount, this.shakeAmount);
            const sy = Utils.rand(-this.shakeAmount, this.shakeAmount);
            ctx.translate(sx, sy);
        }

        // 背景
        this.drawBackground(ctx, dt);

        // 障碍物（草丛/水域在下层）
        this.obstacles.draw(ctx);

        // 基地（鹰巢）—— 在障碍物之上、坦克之下
        if (this.base) this.base.draw(ctx);

        // 道具
        for (const p of this.powerups) p.draw(ctx);

        // 地雷
        for (const m of this.mines) m.draw(ctx);

        // 敌人
        for (const e of this.enemies) e.draw(ctx);

        // Boss
        if (this.boss) this.boss.draw(ctx);

        // 玩家
        if (this.player) this.player.draw(ctx);

        // 子弹（在最上层，显眼）
        this.bullets.draw(ctx);

        // 粒子
        this.particles.draw(ctx);

        // 暗夜突袭视野遮罩（在所有实体之上，UI 之下）
        this.drawNightVignette(ctx);

        // 关卡过渡动画（光圈扩散/收缩，最上层）
        this.drawWaveTransition(ctx);

        ctx.restore();

        // ============ UI 层（屏幕坐标） ============
        // 技能激活屏幕闪光
        if (this._flashStart) {
            const t = (Utils.now() - this._flashStart) / this._flashDuration;
            if (t < 1) {
                ctx.save();
                ctx.globalAlpha = (1 - t) * 1;
                ctx.fillStyle = this._flashColor || 'rgba(255,255,255,0.2)';
                ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
                ctx.restore();
            } else {
                this._flashStart = 0;
            }
        }

        // 雷达小地图
        if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
            this.drawMinimap(ctx);
        }
        if (this.testMode) this.drawSteelWallTest(ctx);

        // 回放模式：左上角红色"REPLAY"徽章 + 进度
        if (this.replayMode && this.replayData) {
            ctx.save();
            const pulse = 0.7 + 0.3 * Math.sin(Utils.now() * 0.005);
            ctx.globalAlpha = 0.85 * pulse;
            ctx.fillStyle = '#ff0080';
            ctx.shadowColor = '#ff0080';
            ctx.shadowBlur = 12;
            ctx.fillRect(14, 14, 130, 26);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`▶ REPLAY ${this.replaySpeed||1}×`, 14 + 65, 14 + 18);
            // 进度条
            const total = this.replayData.duration || 1;
            const prog = Math.min(1, this.replayTime / total);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillRect(14, 44, 130, 4);
            ctx.fillStyle = '#00ffcc';
            ctx.fillRect(14, 44, 130 * prog, 4);
            ctx.restore();
        }

        // === 调试指示器：右下角显示最后按下的键 ===
        if (this._lastKey && this._lastKeyTime) {
            const age = Utils.now() - this._lastKeyTime;
            if (age < 2000) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, 1 - age / 2000);
                ctx.font = 'bold 14px Consolas, monospace';
                ctx.fillStyle = '#00ffcc';
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 6;
                ctx.textAlign = 'right';
                const stateStr = this.state === STATE.PLAYING ? 'PLAYING' : this.state;
                const skillsStr = this.player ? JSON.stringify(this.player.skills) : 'no player';
                ctx.fillText(`[KEY: ${this._lastKey}] [STATE: ${stateStr}]`, CONFIG.CANVAS_W - 12, CONFIG.CANVAS_H - 30);
                ctx.fillText(`[SKILLS: ${skillsStr}]`, CONFIG.CANVAS_W - 12, CONFIG.CANVAS_H - 12);
                ctx.restore();
            }
        }
    }

    /* ---------- 钢墙验证靶场状态 ---------- */
    drawSteelWallTest(ctx) {
        const wall = this.testSteelWall;
        if (!wall || !this.player) return;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 8;

        ctx.fillStyle = 'rgba(5, 12, 24, 0.88)';
        ctx.fillRect(CONFIG.CANVAS_W / 2 - 220, 18, 440, 72);
        ctx.strokeStyle = this.steelTestPassed ? '#00ffcc' : '#00d4ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(CONFIG.CANVAS_W / 2 - 220, 18, 440, 72);

        ctx.font = 'bold 18px Consolas, monospace';
        ctx.fillStyle = this.steelTestPassed ? '#00ffcc' : '#d9f7ff';
        ctx.fillText(
            this.steelTestPassed ? 'PASS · 钢墙已摧毁' : '钢墙破坏验证靶场',
            CONFIG.CANVAS_W / 2,
            45
        );

        ctx.font = '13px Consolas, monospace';
        ctx.fillStyle = '#a9dbea';
        const hpText = wall.dead ? '0' : `${wall.hp}/${wall.maxHp}`;
        ctx.fillText(
            `火力等级 ${this.player.weaponLevel}/${this.player.maxWeaponLevel} · 钢墙耐久 ${hpText} · 空格/J/鼠标开火`,
            CONFIG.CANVAS_W / 2,
            70
        );

        if (!wall.dead) {
            ctx.font = 'bold 12px Consolas, monospace';
            ctx.fillStyle = '#d9f7ff';
            ctx.fillText(`STEEL HP ${wall.hp}/${wall.maxHp}`, wall.cx, wall.y - 10);
        }
        ctx.restore();
    }

    /* ---------- 雷达小地图（右上角） ---------- */
    drawMinimap(ctx) {
        const m = CONFIG.MINIMAP;
        const x = CONFIG.CANVAS_W - m.W - m.marginX;
        const y = CONFIG.CANVAS_H - m.H - m.marginY; // 右下角
        const W = CONFIG.CANVAS_W, H = CONFIG.CANVAS_H;
        const sx = m.W / W; // 世界→雷达 缩放X
        const sy = m.H / H; // 世界→雷达 缩放Y

        ctx.save();

        // 背景面板
        ctx.fillStyle = m.bg;
        ctx.fillRect(x, y, m.W, m.H);
        // 玻璃高光
        const grad = ctx.createLinearGradient(x, y, x, y + m.H);
        grad.addColorStop(0, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, m.W, m.H);
        // 边框发光
        ctx.strokeStyle = m.border;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 6;
        ctx.strokeRect(x + 0.5, y + 0.5, m.W - 1, m.H - 1);
        ctx.shadowBlur = 0;

        // 网格线
        ctx.strokeStyle = m.grid;
        ctx.lineWidth = 1;
        const cols = 5, rows = 4;
        for (let i = 1; i < cols; i++) {
            const gx = x + (m.W / cols) * i;
            ctx.beginPath(); ctx.moveTo(gx, y + 1); ctx.lineTo(gx, y + m.H - 1); ctx.stroke();
        }
        for (let j = 1; j < rows; j++) {
            const gy = y + (m.H / rows) * j;
            ctx.beginPath(); ctx.moveTo(x + 1, gy); ctx.lineTo(x + m.W - 1, gy); ctx.stroke();
        }

        // 障碍物（暗灰色）—— 仅砖墙/钢墙
        if (this.obstacles && this.obstacles.list) {
            ctx.fillStyle = 'rgba(100, 120, 140, 0.45)';
            for (const o of this.obstacles.list) {
                if (o.dead || !(o.type === 'brick' || o.type === 'steel')) continue;
                ctx.fillRect(
                    x + Math.max(1, o.x * sx - 1),
                    y + Math.max(1, o.y * sy - 1),
                    Math.max(2, o.w * sx),
                    Math.max(2, o.h * sy)
                );
            }
        }

        // 传送门入口/出口（彩色小圆点）
        if (this.obstacles && this.obstacles.portals) {
            for (const p of this.obstacles.portals) {
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 4;
                ctx.beginPath();
                ctx.arc(x + p.entry.x * sx, y + p.entry.y * sy, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(x + p.exit.x * sx, y + p.exit.y * sy, 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        // 基地（鹰巢，品红方块）
        if (this.base) {
            const bx = x + (this.base.x - this.base.size / 2) * sx;
            const by = y + (this.base.y - this.base.size / 2) * sy;
            ctx.fillStyle = this.base.alive ? '#00ffcc' : '#ff0080';
            ctx.shadowColor = this.base.alive ? '#00ffcc' : '#ff0080';
            ctx.shadowBlur = 5;
            ctx.fillRect(bx, by, Math.max(3, this.base.size * sx), Math.max(3, this.base.size * sy));
            ctx.shadowBlur = 0;
        }

        // 道具（黄色小点）
        if (this.powerups) {
            ctx.fillStyle = '#ffe600';
            for (const p of this.powerups) {
                if (p.dead) continue;
                const px = x + p.x * sx;
                const py = y + p.y * sy;
                ctx.fillRect(px - 1, py - 1, 2, 2);
            }
        }

        // 敌人（按类型染色）
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const ex = x + e.x * sx;
            const ey = y + e.y * sy;
            ctx.fillStyle = e.color || CONFIG.COLORS.danger;
            ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
        }

        // 护卫机（青色小三角）
        if (this.drones) {
            ctx.fillStyle = '#00d4ff';
            for (const d of this.drones) {
                if (!d.alive) continue;
                ctx.fillRect(x + d.x * sx - 1, y + d.y * sy - 1, 2, 2);
            }
        }

        // Boss（大圆点，闪烁）
        if (this.boss && this.boss.alive) {
            const bx = x + this.boss.x * sx;
            const by = y + this.boss.y * sy;
            const pulse = 0.7 + 0.3 * Math.sin(Utils.now() * 0.012);
            ctx.fillStyle = '#ffe600';
            ctx.shadowColor = '#ffe600';
            ctx.shadowBlur = 6 * pulse;
            ctx.beginPath();
            ctx.arc(bx, by, 4 * pulse + 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 玩家（青色，带方向指示）
        if (this.player && this.player.alive) {
            const px = x + this.player.x * sx;
            const py = y + this.player.y * sy;
            const dirAngles = [0, 90, 180, 270];
            const a = dirAngles[this.player.dir || 0] * Math.PI / 180;
            // 方向箭头
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(a);
            ctx.fillStyle = CONFIG.COLORS.neonCyan;
            ctx.shadowColor = CONFIG.COLORS.neonCyan;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(0, -5);
            ctx.lineTo(-3, 4);
            ctx.lineTo(3, 4);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.shadowBlur = 0;
        }

        // 标题
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(0, 212, 255, 0.7)';
        ctx.textAlign = 'left';
        ctx.fillText('⌖ 雷达', x + 4, y + 11);
        // 数量统计
        if (this.player && this.enemies) {
            const ec = this.enemies.filter(e => e.alive).length;
            const bc = this.boss && this.boss.alive ? 1 : 0;
            ctx.fillStyle = 'rgba(255, 80, 120, 0.85)';
            ctx.textAlign = 'right';
            ctx.fillText(`${ec + bc}`, x + m.W - 4, y + 11);
        }

        ctx.restore();
    }

    drawBackground(ctx, dt) {
        const env = this.environment;

        // 径向渐变底色（按环境调整）
        const grad = ctx.createRadialGradient(
            CONFIG.CANVAS_W / 2, CONFIG.CANVAS_H / 2, 50,
            CONFIG.CANVAS_W / 2, CONFIG.CANVAS_H / 2, CONFIG.CANVAS_W
        );
        if (env === 'storm') {
            grad.addColorStop(0, '#1a1530');
            grad.addColorStop(1, '#080414');
        } else if (env === 'night') {
            grad.addColorStop(0, '#0a0e1a');
            grad.addColorStop(1, '#02030a');
        } else {
            grad.addColorStop(0, '#1a1f33');
            grad.addColorStop(1, '#060912');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);

        // 滚动星空（暗夜时星星更稀疏暗淡）
        ctx.save();
        const starAlphaMult = env === 'night' ? 0.3 : env === 'storm' ? 0.6 : 1;
        for (const s of this.starField) {
            s.y += s.speed * dt * 0.06 * (env === 'storm' ? 1.6 : 1); // 风暴时粒子速度变快
            if (s.y > CONFIG.CANVAS_H) { s.y = 0; s.x = Math.random() * CONFIG.CANVAS_W; }
            s.twinkle += dt * 0.003;
            const a = (0.4 + 0.6 * Math.abs(Math.sin(s.twinkle))) * starAlphaMult;
            ctx.globalAlpha = a;
            ctx.fillStyle = env === 'storm' ? '#a8c' : '#7aa';
            ctx.fillRect(s.x, s.y, s.size, s.size);
        }
        ctx.restore();

        // ===== 电磁风暴：偶发电弧闪烁 =====
        if (env === 'storm') {
            this._stormArcTimer -= dt;
            if (this._stormArcTimer <= 0) {
                this._stormArcTimer = Utils.rand(800, 2200);
                this._stormFlicker = 1;
                // 随机电弧粒子
                const ax = Utils.rand(0, CONFIG.CANVAS_W);
                const ay = Utils.rand(0, CONFIG.CANVAS_H * 0.6);
                const bx = ax + Utils.rand(-200, 200);
                const by = ay + Utils.rand(60, 180);
                this.particles.lightning(ax, ay, bx, by, '#b44dff');
            }
            if (this._stormFlicker > 0) {
                this._stormFlicker = Math.max(0, this._stormFlicker - dt * 0.005);
                ctx.save();
                ctx.globalAlpha = this._stormFlicker * 0.25;
                ctx.fillStyle = '#b44dff';
                ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
                ctx.restore();
            }
        }

        // 滚动网格线（暗夜时几乎不可见）
        ctx.save();
        const gridAlpha = env === 'night' ? 0.03 : env === 'storm' ? 0.06 : 0.08;
        ctx.strokeStyle = `rgba(0, 212, 255, ${gridAlpha})`;
        ctx.lineWidth = 1;
        const G = CONFIG.GRID;
        for (let x = -G + this.gridScroll; x < CONFIG.CANVAS_W; x += G) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, CONFIG.CANVAS_H);
            ctx.stroke();
        }
        for (let y = -G + this.gridScroll; y < CONFIG.CANVAS_H; y += G) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(CONFIG.CANVAS_W, y);
            ctx.stroke();
        }
        ctx.restore();

        // 边缘霓虹边框（风暴时变紫）
        ctx.save();
        const borderColor = env === 'storm' ? 'rgba(180, 77, 255, 0.4)' : 'rgba(0, 212, 255, 0.3)';
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = env === 'storm' ? '#b44dff' : '#00d4ff';
        ctx.shadowBlur = 10;
        ctx.strokeRect(1, 1, CONFIG.CANVAS_W - 2, CONFIG.CANVAS_H - 2);
        ctx.restore();
    }

    /* 暗夜突袭：玩家周围视野明亮，远处黑暗（在所有实体绘制后叠加） */
    drawNightVignette(ctx) {
        if (this.environment !== 'night' || !this.player) return;
        const px = this.player.x, py = this.player.y;
        const innerR = 140;   // 明亮区
        const outerR = 380;   // 完全黑暗
        const grad = ctx.createRadialGradient(px, py, innerR, px, py, outerR);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.55)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
        ctx.restore();
    }

    /* 关卡过渡动画：光圈扩散(CLEAR)/收缩(START) + 文字 */
    updateWaveTransition(dt) {
        const wt = this._waveTransition;
        if (wt.state === 'none') return;
        wt.t += dt;
        if (wt.t >= wt.duration) {
            wt.state = 'none';
        }
    }
    drawWaveTransition(ctx) {
        const wt = this._waveTransition;
        if (wt.state === 'none') return;
        const progress = Math.min(1, wt.t / wt.duration);
        const cx = CONFIG.CANVAS_W / 2;
        const cy = CONFIG.CANVAS_H / 2;
        const maxR = Math.sqrt(cx * cx + cy * cy);
        // expand: 0→maxR（扩散）；contract: maxR→0（收缩）
        const r = wt.state === 'expand' ? progress * maxR : (1 - progress) * maxR;
        const alpha = wt.state === 'expand' ? (1 - progress) : progress;

        ctx.save();
        // 光圈（环）：青绿色发光环
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 6;
        ctx.shadowColor = '#00ffcc';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        // 内圈柔光
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 24;
        ctx.shadowBlur = 50;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // 文字（始终居中，淡入淡出）
        const textAlpha = wt.state === 'expand'
            ? Math.min(1, progress * 2) * (1 - Math.max(0, (progress - 0.6) / 0.4))
            : Math.min(1, progress * 2) * (1 - Math.max(0, (progress - 0.6) / 0.4));
        ctx.globalAlpha = textAlpha;
        ctx.fillStyle = '#00ffcc';
        ctx.shadowColor = '#00ffcc';
        ctx.shadowBlur = 20;
        ctx.font = 'bold 48px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(wt.text, cx, cy);
        ctx.restore();
    }

    /* ============================================================
       HUD 更新
       ============================================================ */
    updateHUD() {
        if (!this.player) return;
        document.getElementById('hp-value').textContent = this.player.hp;
        document.getElementById('shield-bar').style.width =
            (this.player.shieldTime > 0 ? (this.player.shieldTime / CONFIG.POWERUP.types.shield.duration) * 100 : 0) + '%';
        document.getElementById('boost-bar').style.width =
            (this.player.boost / CONFIG.PLAYER.boostMax) * 100 + '%';
        document.getElementById('wave-value').textContent = this.wave;
        document.getElementById('kill-value').textContent = this.kills;
        document.getElementById('score-value').textContent = this.score;

        // 武器等级菱形
        const wl = document.getElementById('weapon-level');
        if (wl.children.length !== this.player.maxWeaponLevel) {
            wl.innerHTML = '';
            for (let i = 0; i < this.player.maxWeaponLevel; i++) {
                const d = document.createElement('div');
                d.className = 'weapon-diamond';
                wl.appendChild(d);
            }
        }
        for (let i = 0; i < this.player.maxWeaponLevel; i++) {
            wl.children[i].classList.toggle('active', i < this.player.weaponLevel);
        }

        // 道具状态
        const ps = document.getElementById('powerup-status');
        const tags = [];
        if (this.player.shieldTime > 0)
            tags.push(`<span class="powerup-tag">SHIELD ${(this.player.shieldTime/1000).toFixed(1)}s</span>`);
        if (this.player.rapidTime > 0)
            tags.push(`<span class="powerup-tag">RAPID ${(this.player.rapidTime/1000).toFixed(1)}s</span>`);
        if (this.player.pierceTime > 0)
            tags.push(`<span class="powerup-tag">PIERCE ${(this.player.pierceTime/1000).toFixed(1)}s</span>`);
        if (this.player.speedTime > 0)
            tags.push(`<span class="powerup-tag">SPEED ${(this.player.speedTime/1000).toFixed(1)}s</span>`);
        if (this.player.isOverclocking())
            tags.push(`<span class="powerup-tag oc-tag">OVERCLOCK ${(this.player.ocActive/1000).toFixed(1)}s</span>`);
        if (this.base && this.base.shieldTime > 0)
            tags.push(`<span class="powerup-tag base-tag">BASE ${(this.base.shieldTime/1000).toFixed(1)}s</span>`);
        ps.innerHTML = tags.join('');

        // 超频能量条
        const ocBar = document.getElementById('oc-bar');
        const ocReady = document.getElementById('oc-ready');
        const ocBtn = document.getElementById('oc-btn');
        if (ocBar) {
            const oc = CONFIG.OVERCLOCK;
            if (this.player.isOverclocking()) {
                ocBar.style.width = (this.player.ocActive / oc.duration) * 100 + '%';
                ocBar.style.background = 'linear-gradient(90deg, #00ffcc, #00d4ff)';
                if (ocReady) ocReady.classList.add('hidden');
            } else if (this.player.ocCooldown > 0) {
                ocBar.style.width = (1 - this.player.ocCooldown / oc.cooldown) * 100 + '%';
                ocBar.style.background = 'linear-gradient(90deg, #555, #888)';
                if (ocReady) ocReady.classList.add('hidden');
            } else {
                ocBar.style.width = (this.player.ocEnergy / oc.maxEnergy) * 100 + '%';
                ocBar.style.background = 'linear-gradient(90deg, #b44dff, #00ffcc)';
                if (ocReady) ocReady.classList.toggle('hidden', this.player.ocEnergy < oc.maxEnergy);
            }
        }
        // 超频按钮状态：就绪时闪烁，激活时高亮，否则禁用
        if (ocBtn) {
            ocBtn.classList.toggle('ready', this.player.overclockReady());
            ocBtn.classList.toggle('active', this.player.isOverclocking());
            ocBtn.disabled = !this.player.overclockReady() && !this.player.isOverclocking();
        }

        // 超频屏幕模糊特效（CSS 滤镜作用于 canvas）
        if (this.canvas) {
            if (this.player.isOverclocking()) this.canvas.classList.add('oc-blur');
            else this.canvas.classList.remove('oc-blur');
        }

        // Boss 血条
        const bossWrap = document.getElementById('boss-bar-wrap');
        const bossBar = document.getElementById('boss-bar');
        const bossLabel = document.getElementById('boss-name');
        if (this.boss && this.boss.alive) {
            bossWrap.classList.remove('hidden');
            bossBar.style.width = (this.boss.hp / this.boss.maxHp) * 100 + '%';
            const c = this.boss.color || '#ff0080';
            bossBar.style.background = `linear-gradient(90deg, ${c}, #ff7a00)`;
            bossBar.style.boxShadow = `0 0 12px ${c}`;
            if (bossLabel) {
                const name = (CONFIG.BOSS.types[this.boss.bossType] || {}).name || 'BOSS';
                bossLabel.textContent = name;
                bossLabel.style.color = c;
                bossLabel.style.textShadow = `0 0 8px ${c}`;
            }
        } else {
            bossWrap.classList.add('hidden');
        }

        // 技能栏：数字 + 激活高亮
        const skillSlots = document.querySelectorAll('.skill-slot');
        CONFIG.SKILLS.slot.forEach((name, i) => {
            const count = this.player.skills[name] || 0;
            const slot = skillSlots[i];
            if (!slot) return;
            const counter = slot.querySelector('.skill-count');
            if (counter) counter.textContent = count;
            slot.classList.toggle('active', count > 0);
            slot.classList.toggle('empty', count <= 0);
            // 触摸技能按钮计数同步
            const tc = document.getElementById('tcount-' + i);
            if (tc) tc.textContent = '×' + count;
            const tbtn = document.querySelector(`#skillBar .skill-btn[data-skill="${i + 1}"]`);
            if (tbtn) tbtn.classList.toggle('empty', count <= 0);
        });
        // 触摸超频按钮状态同步
        const tBoost = document.getElementById('boostBtn');
        if (tBoost) {
            tBoost.classList.toggle('ready', this.player.overclockReady());
            tBoost.classList.toggle('active', this.player.isOverclocking());
        }
    }

    /* ============================================================
       嘲讽气泡层（DOM，跟随敌人坐标）
       ============================================================ */
    updateTauntLayer() {
        const tl = document.getElementById('taunt-layer');
        if (!tl) return;
        // 每 2 帧更新一次，节省开销
        this._tauntTick = (this._tauntTick || 0) + 1;
        if (this._tauntTick % 2 !== 0) return;
        const canvas = this.canvas;
        const CW = canvas.width;
        const CH = canvas.height;

        const entities = [];
        for (const e of this.enemies) if (e.alive && e.tauntText && e.tauntTime > 0) entities.push(e);
        if (this.boss && this.boss.alive && this.boss.tauntText && this.boss.tauntTime > 0) entities.push(this.boss);

        if (entities.length === 0) { tl.innerHTML = ''; return; }

        // 以 id 复用元素（避免每帧重建）
        let html = '';
        for (const e of entities) {
            // 限制在画面内
            const x = Utils.clamp(e.x, 20, CW - 20);
            const y = Utils.clamp(e.y - e.size - 20, 10, CH - 40);
            // 百分比定位适配不同 canvas 显示尺寸
            const leftPct = (x / CW) * 100;
            const topPct = (y / CH) * 100;
            html += `<div class="taunt-bubble" style="left:${leftPct}%;top:${topPct}%;">${Utils.escapeHTML(e.tauntText)}</div>`;
        }
        tl.innerHTML = html;
    }

    /* ============================================================
       特效与提示
       ============================================================ */
    // 分级震动：level = 'micro'|'small'|'mid'|'large'|'huge'
    //   micro  (1px,50ms)  普通射击
    //   small  (2px,80ms)  小事件
    //   mid    (3px,100ms) 敌机爆炸
    //   large  (6px,200ms) Boss 爆炸 + 屏幕闪烁
    //   huge   (10px,300ms) 玩家死亡
    screenShake(amount, level) {
        // 兼容旧调用：未传 level 时按 amount 推断
        if (!level) {
            if (amount <= 2) level = 'micro';
            else if (amount <= 4) level = 'small';
            else if (amount <= 7) level = 'mid';
            else if (amount <= 10) level = 'large';
            else level = 'huge';
        }
        const cfg = {
            micro:  { px: 1, ms: 50 },
            small:  { px: 2, ms: 80 },
            mid:    { px: 3, ms: 100 },
            large:  { px: 6, ms: 200 },
            huge:   { px: 10, ms: 300 },
        }[level] || { px: amount, ms: 250 };
        // Canvas 内部震动（轻量，每帧叠加）
        this.shakeAmount = Math.max(this.shakeAmount, cfg.px);
        this.shakeTime = Math.max(this.shakeTime, cfg.ms);
        this._shakeMaxTime = Math.max(this._shakeMaxTime || 0, cfg.ms);
        // CSS 震动仅对 mid 及以上触发（避免射击连发时频繁 force reflow 导致屏幕抖动）
        if (level === 'micro' || level === 'small') return;
        const c = document.getElementById('game-container');
        c.classList.remove('shake', 'shake-micro', 'shake-small', 'shake-mid', 'shake-large', 'shake-huge');
        void c.offsetWidth;
        c.classList.add('shake', 'shake-' + level);
    }

    flashDamage() {
        let flash = document.querySelector('.damage-flash');
        if (!flash) {
            flash = document.createElement('div');
            flash.className = 'damage-flash';
            document.getElementById('game-container').appendChild(flash);
        }
        flash.classList.add('active');
        setTimeout(() => flash.classList.remove('active'), 120);
        // 受伤红边（独立元素，持续更长）
        let edge = document.querySelector('.damage-edge');
        if (!edge) {
            edge = document.createElement('div');
            edge.className = 'damage-edge';
            document.getElementById('game-container').appendChild(edge);
        }
        edge.classList.add('active');
        setTimeout(() => edge.classList.remove('active'), 400);
    }

    flashShield() {
        // 护盾抵挡的蓝色闪烁
        let flash = document.querySelector('.shield-flash');
        if (!flash) {
            flash = document.createElement('div');
            flash.className = 'damage-flash levelup-flash';
            flash.style.boxShadow = 'inset 0 0 80px #00d4ff';
            document.getElementById('game-container').appendChild(flash);
        }
        flash.classList.add('active');
        setTimeout(() => flash.classList.remove('active'), 120);
    }

    flashLevelUp() {
        let flash = document.querySelector('.levelup-flash');
        if (!flash) {
            flash = document.createElement('div');
            flash.className = 'levelup-flash';
            document.getElementById('game-container').appendChild(flash);
        }
        flash.classList.remove('active');
        void flash.offsetWidth;
        flash.classList.add('active');
    }

    // 中央提示文字
    toast(text) {
        const el = document.getElementById('center-toast');
        el.textContent = text;
        el.classList.remove('hidden');
        // 重启动画
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        // 1.4s 后隐藏
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.add('hidden'), 1400);
    }

    /* 屏幕短暂闪光（用于技能激活反馈） */
    flashForSkill(color) {
        const canvas = this.canvas;
        if (!canvas) return;
        this._flashColor = color;
        this._flashStart = Utils.now();
        this._flashDuration = 220;
    }

    /* ============================================================
       音效（Web Audio API 合成简单音效）
       ============================================================ */
    /* ============================================================
       3D 空间音效：基于事件源与玩家的相对位置实现左右声道定位
       敌人在玩家左侧 → 左声道偏强；右侧 → 右声道偏强
       使用 StereoPannerNode（Web Audio API）实现
       ============================================================ */
    soundSpatial(type, srcX, srcY) {
        if (this.muted || !this.settings.sound) return;
        if (!this.player) { this.sound(type); return; }
        // 计算 pan：基于玩家与声源的相对 X 位置（-1 全左, +1 全右）
        const dx = srcX - this.player.x;
        const maxPanDist = CONFIG.CANVAS_W * 0.5;
        const pan = Utils.clamp(dx / maxPanDist, -1, 1);
        // 类型映射后委托给 AudioManager（内部支持 StereoPanner）
        const map = {
            explode: 'explosion',
            hit: 'hit',
            spawn: 'explosion',
            shoot: 'shoot',
        };
        AudioManager.playSFX(map[type] || type, pan);
    }

    sound(type) {
        if (this.muted || !this.settings.sound) return;
        // 委托给 AudioManager.playSFX（统一合成，无外部文件依赖）
        // 类型映射：游戏内 type → AudioManager SFX name
        const map = {
            explode: 'explosion',
            hit: 'hit',
            powerup: 'pickup',
            boost: 'boost',
            spawn: 'explosion',
            clear: 'clear',
            boss: 'bossAlert',
            bossDead: 'bossDead',
            skill: 'skill',
            shoot: 'shoot',
        };
        AudioManager.playSFX(map[type] || type);
    }

    /* ============================================================
       状态切换
       ============================================================ */
    togglePause() {
        if (this.state === STATE.PLAYING) {
            this.state = STATE.PAUSED;
            document.body.classList.remove('in-game'); // 暂停时隐藏触摸控件
            document.getElementById('pause-screen').classList.remove('hidden');
        } else if (this.state === STATE.PAUSED) {
            this.state = STATE.PLAYING;
            document.body.classList.add('in-game');
            document.getElementById('pause-screen').classList.add('hidden');
            this.lastTime = Utils.now();
        }
    }

    gameOver() {
        // 保存录像（含输入序列与种子）
        this.saveReplay();
        this.state = STATE.GAME_OVER;
        document.body.classList.remove('in-game'); // 隐藏触摸控件
        document.getElementById('final-wave').textContent = this.wave;
        document.getElementById('final-kill').textContent = this.kills;
        document.getElementById('final-score').textContent = this.score;
        // 切换至失败 BGM + 停止心跳
        AudioManager.playBGM('gameover');
        AudioManager.stopHeartbeat();
        // 退出每日挑战模式（失败也视为本次挑战结束）
        this.dailyMode = false;
        // 累计超频击杀（本局，即使失败也统计）
        if (this._runOcKills > 0) {
            this.setStat('ocKills', (this.stats.ocKills || 0) + this._runOcKills);
        }
        // ===== 战报统计：累加总游玩时间 =====
        if (this._runStartTime > 0) {
            this.addStat('totalPlayTime', Utils.now() - this._runStartTime);
        }
        // ===== 动态难度计数：本关死亡 → 连续死亡 +1，连续无伤清零 =====
        this._deathStreak++;
        this._noDamageStreak = 0;
        try {
            localStorage.setItem('iron_torrent_death', String(this._deathStreak));
            localStorage.setItem('iron_torrent_nodmg', '0');
        } catch (e) {}
        this.checkAchievements();
        this.playCG('defeat', () => {
            document.getElementById('gameover-screen').classList.remove('hidden');
        });
    }

    victory() {
        // 保存录像
        this.saveReplay();
        this.state = STATE.VICTORY;
        document.body.classList.remove('in-game'); // 隐藏触摸控件
        document.getElementById('vic-wave').textContent = this.wave;
        document.getElementById('vic-score').textContent = this.score;
        this.sound('clear');
        // 切换至胜利 BGM + 停止心跳
        AudioManager.playBGM('victory');
        AudioManager.stopHeartbeat();

        // ===== 成就统计：通关相关 =====
        const elapsed = this._runStartTime > 0 ? (Utils.now() - this._runStartTime) : 0;
        // ===== 战报统计：累加总游玩时间 + 通关次数 =====
        if (elapsed > 0) this.addStat('totalPlayTime', elapsed);
        this.addStat('clearCount', 1);
        // 速通：保留最快时间
        if (elapsed > 0 && (!this.stats.clearTime || elapsed < this.stats.clearTime)) {
            this.setStat('clearTime', elapsed);
        }
        // 一命通关：本局未死亡
        if (this._runNoDeath) this.setStat('oneLifeClear', true);
        // 基地满血通关
        if (this.base && this.base.alive && this.base.hp >= this.base.maxHp) {
            this.setStat('baseFullClear', true);
        }
        // 全坦克通关：记录所用坦克
        if (!this._clearChars.includes(this.selectedCharId)) {
            this._clearChars.push(this.selectedCharId);
            this._saveClearChars();
        }
        // 累计超频击杀（本局）
        if (this._runOcKills > 0) {
            this.setStat('ocKills', (this.stats.ocKills || 0) + this._runOcKills);
        }
        // 每日挑战：保存今日最高分 + 标记成就
        if (this.dailyMode) {
            this.saveDailyBest(this.score);
            this.setStat('dailyWin', true);
            this.dailyMode = false;
        }
        this.checkAchievements();

        this.playCG('victory', () => {
            document.getElementById('victory-screen').classList.remove('hidden');
        });
    }

    // 保存录像到 localStorage（仅当本局在录制）
    saveReplay() {
        if (this.replayMode) return;       // 回放模式不覆盖
        if (!this.replayRecording) return; // 未在录制
        const rec = this.replayRecording;
        // 截断到当前最新事件，附带结束时间戳
        const data = {
            seed: rec.seed,
            charId: rec.charId,
            level: rec.level,
            duration: Utils.now() - rec.startWall,
            events: rec.events,
            savedAt: Date.now(),
        };
        try { localStorage.setItem('iron_torrent_replay', JSON.stringify(data)); } catch (e) {}
        this.replayRecording = null;
    }

    /* ============================================================
       CG 动画：程序化粒子 + 文案 + 扫光（3s 左右）
       ============================================================ */
    playCG(kind, done) {
        const layer = document.getElementById('cg-layer');
        if (!layer) { done && done(); return; }
        const canvas = document.getElementById('cg-canvas');
        if (!canvas) { done && done(); return; }
        layer.classList.remove('hidden');
        const title = document.getElementById('cg-title');
        const sub = document.getElementById('cg-subtitle');
        title.textContent = kind === 'victory' ? '任 务 完 成' : '全 军 覆 没';
        title.className = 'cg-title cg-' + kind;
        sub.textContent = kind === 'victory'
            ? `VICTORY · SCORE ${this.score}`
            : `DEFEATED · WAVE ${this.wave} KILLS ${this.kills}`;

        const ctx = canvas.getContext('2d');
        const W = canvas.width = layer.clientWidth;
        const H = canvas.height = layer.clientHeight;
        let start = Utils.now();
        const duration = 2400;

        // 产生大量粒子
        const parts = [];
        const n = kind === 'victory' ? 140 : 90;
        const palette = kind === 'victory'
            ? ['#00ffcc', '#00d4ff', '#ffdd00', '#b44dff', '#ffffff']
            : ['#ff2a5a', '#ff6b6b', '#ffaa00', '#4a0000', '#ffffff'];
        for (let i = 0; i < n; i++) {
            parts.push({
                x: W / 2 + (Math.random() - 0.5) * W * 0.3,
                y: H / 2 + (Math.random() - 0.5) * H * 0.3,
                vx: (Math.random() - 0.5) * (kind === 'victory' ? 0.6 : 0.25),
                vy: (Math.random() - 0.5) * (kind === 'victory' ? 0.6 : 0.25) + (kind === 'victory' ? -0.1 : 0.05),
                r: Utils.rand(1, 4),
                life: Utils.rand(800, 2400),
                c: Utils.pick(palette),
            });
        }

        const tick = () => {
            const t = Utils.now() - start;
            // 淡入背景
            ctx.clearRect(0, 0, W, H);
            const alpha = Utils.clamp(t / 400, 0, 1);
            ctx.fillStyle = `rgba(6, 12, 22, ${0.82 * alpha})`;
            ctx.fillRect(0, 0, W, H);

            // 放射光束
            if (t > 300) {
                const sweep = (t - 300) / duration;
                ctx.save();
                ctx.translate(W / 2, H / 2);
                const rot = kind === 'victory' ? sweep * Math.PI * 2 : -sweep * Math.PI * 1.3;
                ctx.rotate(rot);
                const beams = kind === 'victory' ? 8 : 5;
                for (let i = 0; i < beams; i++) {
                    ctx.save();
                    ctx.rotate((i / beams) * Math.PI * 2);
                    const grd = ctx.createLinearGradient(0, 0, 0, Math.max(W, H));
                    grd.addColorStop(0, palette[i % palette.length] + 'cc');
                    grd.addColorStop(1, palette[i % palette.length] + '00');
                    ctx.fillStyle = grd;
                    ctx.globalAlpha = 0.35 * alpha;
                    ctx.beginPath();
                    ctx.moveTo(-30, 0);
                    ctx.lineTo(30, 0);
                    ctx.lineTo(60, Math.max(W, H));
                    ctx.lineTo(-60, Math.max(W, H));
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
                ctx.restore();
            }

            // 粒子
            for (const p of parts) {
                if (t > p.life) continue;
                p.x += p.vx * 16;
                p.y += p.vy * 16;
                const fa = Utils.clamp(1 - (t / p.life), 0, 1);
                ctx.globalAlpha = fa * alpha;
                ctx.fillStyle = p.c;
                ctx.shadowColor = p.c;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;

            // 中央冲击圈
            if (t < 900) {
                const r = 20 + (t / 900) * Math.max(W, H) * 0.55;
                ctx.strokeStyle = (kind === 'victory' ? '#00ffcc' : '#ff2a5a') + Math.floor(255 * (1 - t / 900)).toString(16).padStart(2, '0');
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (t < duration) {
                requestAnimationFrame(tick);
            } else {
                // CG 落幕：淡出动画层
                let f2 = Utils.now();
                const fadeMs = 350;
                const fade = () => {
                    const t2 = Utils.now() - f2;
                    const a2 = Utils.clamp(1 - t2 / fadeMs, 0, 1);
                    ctx.clearRect(0, 0, W, H);
                    ctx.fillStyle = `rgba(6, 12, 22, ${0.82 * a2})`;
                    ctx.fillRect(0, 0, W, H);
                    layer.style.opacity = a2;
                    if (t2 < fadeMs) {
                        requestAnimationFrame(fade);
                    } else {
                        layer.style.opacity = '';
                        done && done();
                    }
                };
                fade();
            }
        };
        tick();
    }
}

/* ---------- 启动 ---------- */
window.addEventListener('load', () => {
    window.game = new Game();
});
