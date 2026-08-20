/* ============================================================
   audioManager.js — 程序化背景音乐 + 音效合成（Web Audio API）
   不依赖外部音频文件，所有音乐/音效用振荡器+噪声+滤波器实时合成
   风格：赛博朋克电子（致敬《创战纪》）
   场景：menu(低沉氛围) / battle(快节奏) / boss(史诗厚重) / victory / gameover
   ============================================================ */

const AudioManager = {
    ctx: null,                // AudioContext
    masterGain: null,         // 主增益（全局音量）
    musicGain: null,          // 音乐总线增益
    sfxGain: null,            // 音效总线增益

    // 状态
    isMusicOn: true,
    isSoundOn: true,
    volume: 0.7,

    // 当前 BGM 状态
    currentBGM: null,         // 'menu' | 'battle' | 'boss' | 'victory' | 'gameover' | null
    bgmNodes: [],             // 当前 BGM 的所有节点（切换时全部断开）
    bgmScheduler: null,       // BGM 循环调度器（setInterval 句柄）
    bgmTempo: 120,            // 当前 BGM 节拍 BPM
    bgmStep: 0,               // 当前节拍步进
    bgmPlaybackRate: 1.0,     // 播放速率（Boss 30% 血量时提升至 1.1）

    // 心跳声效（低血量时叠加）
    heartbeatTimer: null,

    /* ---------- 初始化（必须在用户交互后调用，避免自动播放策略）---------- */
    init() {
        if (this.ctx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.volume;
            this.masterGain.connect(this.ctx.destination);

            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = this.isMusicOn ? 0.45 : 0;
            this.musicGain.connect(this.masterGain);

            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = this.isSoundOn ? 0.6 : 0;
            this.sfxGain.connect(this.masterGain);

            // 从 localStorage 读取设置
            try {
                this.isMusicOn = localStorage.getItem('iron_torrent_music') !== '0';
                this.isSoundOn = localStorage.getItem('iron_torrent_sound') !== '0';
                const v = parseFloat(localStorage.getItem('iron_torrent_volume'));
                if (!isNaN(v)) this.setVolume(v);
            } catch (e) {}
            this.musicGain.gain.value = this.isMusicOn ? 0.45 : 0;
            this.sfxGain.gain.value = this.isSoundOn ? 0.6 : 0;
        } catch (e) {
            console.warn('AudioManager 初始化失败：', e);
        }
    },

    /* ---------- 恢复 AudioContext（被浏览器策略挂起时）---------- */
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    },

    /* ============================================================
       背景音乐：程序化合成
       每种 BGM 由"低音线 + 旋律线 + 鼓点"三层构成
       切换时停止旧节点，启动新调度器
       ============================================================ */
    playBGM(type) {
        if (!this.ctx) return;
        if (this.currentBGM === type) return;
        this.stopBGM();
        this.currentBGM = type;
        this.bgmStep = 0;
        this.bgmPlaybackRate = 1.0;

        // 不同场景的参数
        const presets = {
            menu:   { tempo: 90,  root: 110.00, scale: [0,3,5,7,10],  drums: false, lead: 'sine',     bassWave: 'sine' },
            battle: { tempo: 150, root: 146.83, scale: [0,2,3,7,8],   drums: true,  lead: 'sawtooth', bassWave: 'square' },
            boss:   { tempo: 130, root: 98.00,  scale: [0,1,3,6,7],   drums: true,  lead: 'sawtooth', bassWave: 'sawtooth' },
            victory:{ tempo: 120, root: 130.81, scale: [0,4,7,12,16], drums: false, lead: 'triangle', bassWave: 'triangle' },
            gameover:{tempo: 70,  root: 92.50,  scale: [0,1,3,8,11],  drums: false, lead: 'sine',     bassWave: 'sine' },
        };
        const p = presets[type];
        if (!p) return;
        this.bgmTempo = p.tempo;
        this.bgmPreset = p;

        // 启动节拍调度器（每 16 分音符触发一次）
        const stepMs = (60000 / p.tempo / 4) ; // 16分音符
        this.bgmScheduler = setInterval(() => this._bgmTick(), stepMs);
    },

    // 停止当前 BGM（断开所有节点 + 清除调度器）
    stopBGM() {
        if (this.bgmScheduler) {
            clearInterval(this.bgmScheduler);
            this.bgmScheduler = null;
        }
        for (const node of this.bgmNodes) {
            try { node.stop && node.stop(); } catch (e) {}
            try { node.disconnect(); } catch (e) {}
        }
        this.bgmNodes = [];
        this.currentBGM = null;
    },

    // 每个节拍步进：触发低音/旋律/鼓点
    _bgmTick() {
        if (!this.ctx || !this.bgmPreset) return;
        const p = this.bgmPreset;
        const step = this.bgmStep % 16; // 16 步循环
        const t = this.ctx.currentTime;

        // ===== 低音线（每 4 步一次根音）=====
        if (step % 4 === 0) {
            const bassFreq = p.root * (step % 8 === 0 ? 1 : step % 8 === 4 ? 0.75 : 1);
            this._playTone(bassFreq, 0.35, p.bassWave, 0.35, this.musicGain, t);
        }

        // ===== 旋律线（按 scale 取音）=====
        if (p.tempo > 100 ? (step % 2 === 0) : (step % 4 === 0)) {
            const noteIdx = p.scale[(this.bgmStep * 7) % p.scale.length];
            const octave = (this.bgmStep % 32 < 16) ? 2 : 4; // 高低八度交替
            const freq = p.root * octave * Math.pow(2, noteIdx / 12) * this.bgmPlaybackRate;
            this._playTone(freq, 0.18, p.lead, 0.12, this.musicGain, t, true);
        }

        // ===== 鼓点（战斗/Boss）=====
        if (p.drums) {
            if (step % 4 === 0) this._playKick(t);             // 底鼓
            if (step % 4 === 2) this._playSnare(t);            // 军鼓
            if (step % 2 === 1) this._playHihat(t);            // 踩镲
        }

        // ===== 胜利/失败特殊处理 =====
        if (this.currentBGM === 'victory' && step === 0) {
            // 上升琶音
            [0, 4, 7, 12].forEach((n, i) => {
                this._playTone(p.root * 4 * Math.pow(2, n/12), 0.3, 'triangle', 0.15, this.musicGain, t + i * 0.12);
            });
        }
        if (this.currentBGM === 'gameover' && step === 0) {
            // 下降小调
            [0, -1, -3, -5].forEach((n, i) => {
                this._playTone(p.root * 2 * Math.pow(2, n/12), 0.4, 'sine', 0.18, this.musicGain, t + i * 0.18);
            });
        }

        this.bgmStep++;
    },

    // 播放一个振荡器音符（带 ADSR 包络）
    _playTone(freq, duration, wave, gainVal, dest, when, withFilter = false) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = wave;
        osc.frequency.value = freq;
        // ADSR
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(gainVal, when + 0.01);
        gain.gain.exponentialRampToValueAtTime(gainVal * 0.4, when + duration * 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, when + duration);

        let last = osc;
        if (withFilter) {
            // 低通滤波器：营造柔和电子感
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 2000;
            filter.Q.value = 1.5;
            osc.connect(filter);
            last = filter;
        }
        last.connect(gain);
        gain.connect(dest);
        osc.start(when);
        osc.stop(when + duration + 0.05);
        this.bgmNodes.push(osc, gain);
        // 清理已结束节点，避免内存堆积
        osc.onended = () => {
            const i1 = this.bgmNodes.indexOf(osc);
            if (i1 >= 0) this.bgmNodes.splice(i1, 1);
        };
    },

    // 底鼓：低频正弦快速衰减
    _playKick(when) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, when);
        osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
        gain.gain.setValueAtTime(0.5, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.15);
        osc.connect(gain); gain.connect(this.musicGain);
        osc.start(when); osc.stop(when + 0.18);
        this.bgmNodes.push(osc, gain);
    },
    // 军鼓：噪声 + 带通滤波
    _playSnare(when) {
        if (!this.ctx) return;
        const noise = this._noiseBuffer(0.12);
        const src = this.ctx.createBufferSource();
        src.buffer = noise;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1800;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
        src.connect(filter); filter.connect(gain); gain.connect(this.musicGain);
        src.start(when); src.stop(when + 0.13);
        this.bgmNodes.push(src, gain);
    },
    // 踩镲：高频噪声短促
    _playHihat(when) {
        if (!this.ctx) return;
        const noise = this._noiseBuffer(0.05);
        const src = this.ctx.createBufferSource();
        src.buffer = noise;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7000;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.12, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
        src.connect(filter); filter.connect(gain); gain.connect(this.musicGain);
        src.start(when); src.stop(when + 0.06);
        this.bgmNodes.push(src, gain);
    },

    // 生成白噪声 Buffer（鼓点/爆炸用）
    _noiseBuffer(duration) {
        const len = Math.floor(this.ctx.sampleRate * duration);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buf;
    },

    /* ============================================================
       音效（SFX）：短促合成音
       ============================================================ */
    playSFX(name, panX = 0) {
        if (!this.ctx || !this.isSoundOn) return;
        const t = this.ctx.currentTime;
        // 立体声相位（基于玩家相对位置，-1 全左 ~ +1 全右）
        let panner = null;
        try {
            panner = this.ctx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, panX));
            panner.connect(this.sfxGain);
        } catch (e) {
            panner = this.sfxGain; // 不支持时直连
        }

        switch (name) {
            case 'shoot':
                this._sfxShoot(t, panner); break;
            case 'explosion':
                this._sfxExplosion(t, panner); break;
            case 'pickup':
                this._sfxPickup(t, panner); break;
            case 'boost':
            case 'powerup':
                this._sfxBoost(t, panner); break;
            case 'hit':
                this._sfxHit(t, panner); break;
            case 'skill':
                this._sfxSkill(t, panner); break;
            case 'bossAlert':
                this._sfxBossAlert(t, panner); break;
            case 'clear':
                this._sfxClear(t, panner); break;
            case 'bossDead':
                this._sfxBossDead(t, panner); break;
            default: break;
        }
    },

    _sfxShoot(t, dest) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.08);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + 0.11);
    },
    _sfxExplosion(t, dest) {
        const noise = this._noiseBuffer(0.4);
        const src = this.ctx.createBufferSource();
        src.buffer = noise;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, t);
        filter.frequency.exponentialRampToValueAtTime(60, t + 0.4);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        src.connect(filter); filter.connect(gain); gain.connect(dest);
        src.start(t); src.stop(t + 0.42);
    },
    _sfxPickup(t, dest) {
        [659.25, 880].forEach((f, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = f;
            gain.gain.setValueAtTime(0, t + i * 0.06);
            gain.gain.linearRampToValueAtTime(0.18, t + i * 0.06 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.15);
            osc.connect(gain); gain.connect(dest);
            osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.16);
        });
    },
    _sfxBoost(t, dest) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(1760, t + 0.3);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + 0.36);
    },
    _sfxHit(t, dest) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + 0.13);
    },
    _sfxSkill(t, dest) {
        [440, 554, 659, 880].forEach((f, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = f;
            gain.gain.setValueAtTime(0, t + i * 0.04);
            gain.gain.linearRampToValueAtTime(0.14, t + i * 0.04 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.2);
            osc.connect(gain); gain.connect(dest);
            osc.start(t + i * 0.04); osc.stop(t + i * 0.04 + 0.21);
        });
    },
    _sfxBossAlert(t, dest) {
        // 三声低频警报
        for (let i = 0; i < 3; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 110;
            gain.gain.setValueAtTime(0, t + i * 0.4);
            gain.gain.linearRampToValueAtTime(0.25, t + i * 0.4 + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.4 + 0.35);
            osc.connect(gain); gain.connect(dest);
            osc.start(t + i * 0.4); osc.stop(t + i * 0.4 + 0.36);
        }
    },
    _sfxClear(t, dest) {
        // 上扫 + 爆炸
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.exponentialRampToValueAtTime(2000, t + 0.5);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + 0.52);
        this._sfxExplosion(t + 0.1, dest);
    },
    _sfxBossDead(t, dest) {
        // 长爆炸 + 下降音
        this._sfxExplosion(t, dest);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.8);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + 0.9);
    },

    /* ============================================================
       心跳声效（玩家 HP <= 1 时启动，叠加在 BGM 上）
       ============================================================ */
    startHeartbeat() {
        if (this.heartbeatTimer) return;
        const beat = () => {
            if (!this.ctx || !this.isSoundOn) return;
            const t = this.ctx.currentTime;
            // 两声"咚咚"
            [0, 0.18].forEach(offset => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(60, t + offset);
                osc.frequency.exponentialRampToValueAtTime(30, t + offset + 0.15);
                gain.gain.setValueAtTime(0.4, t + offset);
                gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.18);
                osc.connect(gain); gain.connect(this.sfxGain);
                osc.start(t + offset); osc.stop(t + offset + 0.2);
            });
        };
        beat();
        this.heartbeatTimer = setInterval(beat, 1100);
    },
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    },

    /* ============================================================
       设置项联动
       ============================================================ */
    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.masterGain) this.masterGain.gain.value = this.volume;
        try { localStorage.setItem('iron_torrent_volume', String(this.volume)); } catch (e) {}
    },
    toggleMusic() {
        this.isMusicOn = !this.isMusicOn;
        if (this.musicGain) this.musicGain.gain.value = this.isMusicOn ? 0.45 : 0;
        try { localStorage.setItem('iron_torrent_music', this.isMusicOn ? '1' : '0'); } catch (e) {}
        return this.isMusicOn;
    },
    toggleSound() {
        this.isSoundOn = !this.isSoundOn;
        if (this.sfxGain) this.sfxGain.gain.value = this.isSoundOn ? 0.6 : 0;
        try { localStorage.setItem('iron_torrent_sound', this.isSoundOn ? '1' : '0'); } catch (e) {}
        return this.isSoundOn;
    },

    // Boss 30% 血量时音乐加速 10%
    setBgmPlaybackRate(rate) {
        this.bgmPlaybackRate = rate;
    },
};
