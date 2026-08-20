/* ============================================================
   config.js — 全局配置中心（《钢铁洪流 IRON TORRENT》）
   所有可调平衡数值集中于此，便于统一调整
   ============================================================ */

const CONFIG = {
    // 画布尺寸（与 index.html 中 canvas 一致）
    CANVAS_W: 1120,
    CANVAS_H: 800,
    // 雷达小地图
    MINIMAP: {
        W: 150,
        H: 150,
        marginX: 14,
        marginY: 14,
        bg: 'rgba(6, 12, 24, 0.78)',
        border: 'rgba(0, 212, 255, 0.45)',
        grid: 'rgba(0, 212, 255, 0.1)',
    },

    // 网格大小（用于障碍物对齐与背景绘制）
    GRID: 40,

    // 游戏总波数（通关波数）
    TOTAL_WAVES: 15,
    // 每 N 波出现一次 Boss
    BOSS_INTERVAL: 5,

    // 颜色（与 CSS 变量保持一致；危险/能量采用高饱和品红 #ff0080 与青绿 #00ffcc）
    COLORS: {
        bgDeep: '#0a0e1a',
        bgMid: '#1a1f33',
        neonBlue: '#00d4ff',
        neonPurple: '#b44dff',
        neonCyan: '#00ffcc',
        danger: '#ff0080',     // 品红（危险 / 能量）
        text: '#e0f0ff',
        enemyLight: '#ff6680',
        enemyMid: '#ff9a3c',
        enemyHeavy: '#b44dff',
        enemySmart: '#00ffcc', // 智能型：青绿（高威胁）
        boss: '#ff0080',
        player: '#00d4ff',
    },

    // ===== 玩家坦克 =====
    PLAYER: {
        size: 38,            // 坦克边长（正方形碰撞盒）
        hp: 5,               // 初始生命
        speed: 2.4,          // 基础移动速度 px/帧
        boostSpeed: 4.2,     // 加速速度
        boostMax: 100,       // 能量上限
        boostCost: 0.8,      // 加速每帧消耗
        boostRegen: 0.4,     // 不加速时每帧恢复
        fireInterval: 320,   // 射击间隔 ms（每秒约 3 发）
        rapidInterval: 140,  // 速射道具下射击间隔
        bulletSpeed: 7,
        bulletDamage: 1,
        invincibleTime: 1200,// 受伤后无敌时长 ms
        lives: 3,            // 总生命数（1UP 道具可补充）
    },

    // ===== 永久火力成长（与 1~5 主动技能独立） =====
    FIREPOWER: {
        maxLevel: 3,
        levels: [
            null,
            { shots: 1, damageBonus: 0, speedMult: 1.00, canBreakSteel: false },
            { shots: 2, damageBonus: 1, speedMult: 1.12, canBreakSteel: false },
            { shots: 3, damageBonus: 2, speedMult: 1.25, canBreakSteel: true },
        ],
    },

    // ===== 子弹 =====
    BULLET: {
        size: 6,
        enemySpeed: 4,
        enemyDamage: 1,
        pierceSpeed: 8,      // 穿甲弹
        lifetime: 2000,      // ms 存活上限
    },

    // ===== 敌方坦克配置（工厂模式数据）四类型：普通/快速/装甲/智能 =====
    ENEMIES: {
        // 普通型：标准移动与射击，巡逻为主
        light: {
            name: 'light', hp: 1, speed: 1.8, size: 34,
            fireInterval: 1800, score: 100, color: '#ff6680',
            bulletDamage: 1, ai: 'patrol',
        },
        // 快速型：移速高、血量低
        mid: {
            name: 'mid', hp: 2, speed: 1.3, size: 38,
            fireInterval: 1600, score: 300, color: '#ff9a3c',
            bulletDamage: 1, ai: 'chase',
        },
        // 装甲型：移速慢、需多次攻击、穿甲弹
        heavy: {
            name: 'heavy', hp: 4, speed: 0.9, size: 44,
            fireInterval: 1900, score: 500, color: '#b44dff',
            bulletDamage: 1, ai: 'chase', pierce: true,
        },
        // 智能型：主动追踪玩家并预判射击，最具挑战
        smart: {
            name: 'smart', hp: 3, speed: 1.6, size: 38,
            fireInterval: 1500, score: 700, color: '#00ffcc',
            bulletDamage: 1, ai: 'smart', predict: true,
        },
    },

    // ===== Boss =====
    BOSS: {
        size: 110,
        hp: 60,
        speed: 0.6,
        score: 5000,
        // 阶段血量百分比阈值
        phase2Threshold: 0.6,
        phase3Threshold: 0.3,
        fireIntervalP1: 1500,
        fireIntervalP2: 1100,
        laserChargeTime: 1500, // 阶段3 激光蓄力时间
        laserActiveTime: 800,
        summonInterval: 6000,  // 召唤小兵间隔
        // 第二种 Boss：无人机母舰（carrier）
        types: {
            siege: {   // 重型攻城炮（已有 Boss）
                name: '重型攻城炮', color: '#ff0080', hp: 60, score: 5000,
            },
            carrier: { // 无人机母舰
                name: '无人机母舰', color: '#b44dff', hp: 50, score: 6000,
                summonInterval: 3500,      // 召唤无人机间隔
                droneMax: 4,               // 同屏最多无人机
                missileIntervalP1: 1800,   // 追踪导弹间隔
                missileIntervalP2: 1200,
                beamSweepTime: 1400,       // 阶段3 扫描激光持续
            },
        },
    },

    // ===== 敌人生成节奏 =====
    SPAWN: {
        baseInterval: 1800,   // 第 1 波生成间隔 ms
        minInterval: 600,     // 最快生成间隔
        intervalDecPerWave: 90, // 每波递减
        basePerWave: 6,       // 第 1 波敌人数量
        perWaveGrowth: 2,     // 每波增加数量
        maxAlive: 8,          // 同屏最大敌人
        powerupDropChance: 0.22, // 击毁掉落道具概率
    },

    // ===== 道具（拾取后即时生效或存入背包） =====
    POWERUP: {
        size: 22,
        lifetime: 12000,      // 道具在场上存活时间 ms
        types: {
            shield:  { color: '#00d4ff', label: 'SHIELD',  duration: 10000 }, // 无敌护盾(技能)
            rapid:   { color: '#00ffcc', label: 'RAPID',   duration: 8000 },  // 速射(技能)
            pierce:  { color: '#b44dff', label: 'PIERCE',  duration: 6000 },  // 穿甲(技能)
            mine:    { color: '#ff9a3c', label: 'MINE',    duration: 0 },     // 地雷(技能)
            heal:    { color: '#ff2a5a', label: 'HEAL',    duration: 0 },     // 回血
            upgrade: { color: '#ffe600', label: 'UPGRADE', duration: 0 },     // 火力升级(⭐)
            clear:   { color: '#ff4da6', label: 'CLEAR!',  duration: 0 },     // 全屏清除(技能/💥)
            speed:   { color: '#00ffcc', label: 'SPEED',   duration: 7000 },  // 加速(💨)
            base:    { color: '#00d4ff', label: 'BASE',    duration: 8000 },  // 基地加固(🏠)
            life:    { color: '#ff0080', label: '1UP',     duration: 0 },     // 奖励生命
            emp:     { color: '#b44dff', label: 'EMP',     duration: 3000 },  // EMP：瘫痪敌机
            drone:   { color: '#00d4ff', label: 'DRONE',   duration: 0 },     // 护卫机副机(稀有)
        },
    },

    // ===== 护卫机（副机）配置 =====
    DRONE: {
        maxCount: 2,          // 最多同时 2 台
        fireInterval: 700,    // 射击间隔 ms
        bulletDamage: 1,
        followDist: 56,       // 跟随玩家距离
        bulletSpeed: 7,
    },

    // ===== 障碍物 =====
    OBSTACLE: {
        brickHp: 2,       // 普通砖墙耐久
        steelHp: 4,       // 钢墙耐久，仅最高火力可造成伤害
        wallHp: 2,        // 旧字段兼容
        waterSlow: 0.5,   // 水域减速倍率
        bridgeHp: 3,      // 桥梁耐久（可破坏，被打掉后水域重新阻挡通行）
    },

    // ===== 单向传送门 =====
    PORTAL: {
        cooldown: 1200,   // 同一传送门冷却 ms（防止抖动）
        fadeTime: 600,    // 传送淡入淡出 ms
        pairColor: ['#b44dff', '#00ffcc'], // 两对传送门颜色
    },

    // ===== 基地（鹰巢）=====
    BASE: {
        gridW: 2,         // 基地占 2×2 格
        gridH: 2,
        hp: 1,            // 一击即毁（经典），护盾期间无敌
        shieldDuration: 8000, // 基地加固道具持续时间
    },

    // ===== 粒子 =====
    PARTICLE: {
        maxParticles: 400, // 性能上限
    },

    // 通关条件：完成 TOTAL_WAVES 后即胜利

    // ===== 可选角色（坦克型号） =====
    // 四维雷达图：HP / 机动 / 火力 / 防御（1~5 星）
    CHARACTERS: [
        {
            id: 'standard', name: '标准型', codeName: 'IT-X1',
            color: '#00d4ff', accent: '#00ffcc', type: '平衡型',
            hp: 4, speed: 2.0, boostSpeed: 3.8,
            fireInterval: 320, bulletDamage: 1,
            startSkills: { shield: 1, rapid: 1, pierce: 1, mine: 1, clear: 1 },
            radar: { hp: 4, mobility: 3, firepower: 3, defense: 3 },
            dropRate: 'high',
            desc: '综合性能均衡，适合新手上手。初始每个技能各 1 次，掉落概率高。',
        },
        {
            id: 'scout', name: '侦察型', codeName: 'SC-R3',
            color: '#00ffcc', accent: '#00d4ff', type: '高速型',
            hp: 2, speed: 3.5, boostSpeed: 5.5,
            fireInterval: 260, bulletDamage: 1,
            startSkills: { shield: 1, rapid: 1, pierce: 0, mine: 0, clear: 0 },
            radar: { hp: 2, mobility: 5, firepower: 2, defense: 2 },
            dropRate: 'mid',
            desc: '移动极快，技能冷却缩减。初始护盾1+速射1，以机动换防御，走位为王。',
        },
        {
            id: 'heavy', name: '重装型', codeName: 'HV-H2',
            color: '#b44dff', accent: '#ff9a3c', type: '火力型',
            hp: 6, speed: 1.5, boostSpeed: 3.0,
            fireInterval: 380, bulletDamage: 2,
            startSkills: { shield: 0, rapid: 0, pierce: 1, mine: 1, clear: 0 },
            radar: { hp: 6, mobility: 2, firepower: 5, defense: 4 },
            dropRate: 'low',
            desc: '高血量，高基础伤害。初始装甲1+地雷1，子弹伤害翻倍但笨重。',
        },
    ],

    // ===== 技能 =====
    SKILLS: {
        slot: ['shield', 'rapid', 'pierce', 'mine', 'clear'], // 1~5 顺序
        clearDamage: 4,   // 清屏技能对每个敌人的伤害
    },

    // ===== 超频系统（Overclock）=====
    // 移动/射击积累能量，满格按 Shift 启动；6秒移速射速翻倍 + 连锁闪电；冷却20秒
    OVERCLOCK: {
        maxEnergy: 100,        // 能量上限
        moveGain: 0.12,        // 每帧移动积累（约 60fps → 7.2/秒）
        fireGain: 1.2,         // 每次射击积累
        duration: 6000,        // 超频持续 ms
        cooldown: 20000,       // 冷却 ms（结束后才能再次充能）
        speedMult: 2.0,        // 移速倍率
        fireRateMult: 0.5,     // 射击间隔倍率（越小越快）
        chainRange: 90,        // 连锁闪电范围 px
        chainDamage: 1,        // 闪电跳跃伤害
        chainJumps: 3,         // 最多跳跃次数
    },

    // ===== 嘲讽气泡文案（按类型） =====
    TAUNTS: {
        light: [
            '这么慢？散步呢？',
            '菜！打不中我~',
            '就这啊？哈哈',
            '追不上我吧~',
            '你炮管弯了吗？',
            '新手吧你？',
        ],
        mid: [
            '锁定了哦~',
            '走位预判到位',
            '你还活着？运气不错',
            '乖乖站好！',
            '该结束了',
            '看见你了！',
        ],
        heavy: [
            '杂鱼，跪下！',
            '接我这发穿甲弹！',
            '你那坦克纸糊的？',
            '给我粉碎！',
            '躲？躲得掉？',
            '这就是差距',
        ],
        smart: [
            '弹道已解算！',
            '我预判了你的走位',
            '无处可逃~',
            '热源锁定，清除中',
            '你的下一步是我的算计',
            'AI 永远快你一步',
        ],
        boss: [
            '蚍蜉撼树！',
            '你的挣扎真有趣~',
            '这就是全部？',
            '让我再折磨一会儿',
            '你终将倒下！',
            '跪下！虫子！',
            '这就不行了？',
        ],
    },

    // ===== 手绘地图（3 张，14×13 网格，致敬经典坦克大战）
    // 字符约定：# 砖墙  S 钢墙  . 草丛  ~ 水域  B 桥梁(架于水上,可破坏)  1/2 传送门入口对(单向,1→2)
    // 空格 空地
    // 底部中央 2×2(cols 6-7 / rows 11-12) 为基地（鹰巢），由 Base 实体占据
    // 最后 3 行为统一防御堡垒，玩家需守卫砖墙保护基地
    MAPS: [
        // 地图1：经典对称堡垒（含桥梁横跨水道）
        {
            name: '前线堡垒',
            rows: [
                '##############',
                '#............#',
                '#.##.####.##.#',
                '#.#.....##..#',
                '#.#.~~BB~~..#',
                '#.....SS.....#',
                '#.##......##.#',
                '#.##.####.##.#',
                '#.....SS.....#',
                '#.#.~~BB~~..#',
                '##.########.##',
                '##.###  ###.##',
                '##.###  ###.##',
            ],
        },
        // 地图2：迷宫水道（含一对单向传送门 1→2）
        {
            name: '迷宫水道',
            rows: [
                '##############',
                '#.S........S.#',
                '#.##.####.##.#',
                '#1..........2#',
                '##.##.##.##.##',
                '#..~~....~~..#',
                '#..~~....~~..#',
                '##.##.##.##.##',
                '#............#',
                '#.##.####.##.#',
                '##.########.##',
                '##.###  ###.##',
                '##.###  ###.##',
            ],
        },
        // 地图3：钢铁走廊（桥梁+传送门组合）
        {
            name: '钢铁走廊',
            rows: [
                '##############',
                '#............#',
                '#.SS..1..SS..#',
                '#............#',
                '#.##.####.##.#',
                '#....#BB#....#',
                '#.~~.#..#.~~.#',
                '#....#BB#....#',
                '#.##.####.##.#',
                '#.....2......#',
                '##.########.##',
                '##.###  ###.##',
                '##.###  ###.##',
            ],
        },
    ],

    // ===== 设置项（画质 / 音效 / 音量） =====
    SETTINGS: {
        quality: 'high',     // low | mid | high
        sound: true,         // 音效总开关
        music: true,         // 音乐开关（占位，本作使用合成音效）
        volume: 0.7,         // 0~1
    },

    // ===== 成就系统（≥10 个，解锁后存入 localStorage）=====
    // 每条：id（存档键）/ name / desc / check(stats, game) 返回 boolean
    ACHIEVEMENTS: [
        { id: 'first_blood',  name: '初阵告捷',   desc: '击毁第一辆敌方坦克',         check: s => s.kills >= 1 },
        { id: 'centurion',    name: '百人斩',     desc: '累计击毁 100 辆敌方坦克',    check: s => s.totalKills >= 100 },
        { id: 'boss_slayer',  name: '弑神者',     desc: '击败首个 Boss',             check: s => s.bossKills >= 1 },
        { id: 'boss_no_hit',  name: '无伤 Boss',  desc: '满血击败任一 Boss',          check: s => s.bossNoHit },
        { id: 'one_life',     name: '一命通关',   desc: '未死亡通关 15 关',           check: s => s.oneLifeClear },
        { id: 'oc_killer',    name: '超频猎手',   desc: '超频状态下击杀 50 个敌人',   check: s => s.ocKills >= 50 },
        { id: 'all_tanks',    name: '全坦克通关', desc: '使用三种坦克各通关一次',     check: s => s.clearChars.length >= 3 },
        { id: 'speedrun',     name: '闪电战',     desc: '5 分钟内通关',               check: s => s.clearTime > 0 && s.clearTime <= 300000 },
        { id: 'base_defender',name: '基地守护者', desc: '基地血量满血通关',           check: s => s.baseFullClear },
        { id: 'skill_master', name: '技能大师',   desc: '单局释放 20 次技能',         check: s => s.skillUses >= 20 },
        { id: 'daily_win',    name: '每日勇士',   desc: '完成一次每日挑战',           check: s => s.dailyWin },
        { id: 'replay_view',  name: '复盘大师',   desc: '观看 3 次录像回放',          check: s => s.replayViews >= 3 },
    ],
};
