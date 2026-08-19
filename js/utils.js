/* ============================================================
   utils.js — 通用工具：随机数、角度、碰撞检测、矩形构造
   暴露为全局对象 Utils
   ============================================================ */

const Utils = {
    /* ---------- 随机数 ---------- */
    // 返回 [min, max] 之间的整数
    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    // 返回 [min, max) 之间的浮点数
    rand(min, max) {
        return Math.random() * (max - min) + min;
    },
    // 按概率返回 true（p 取值 0~1）
    chance(p) {
        return Math.random() < p;
    },
    // 从数组随机取一个元素
    pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    /* ---------- 角度与方向 ---------- */
    // 角度转弧度
    deg2rad(d) { return d * Math.PI / 180; },
    rad2deg(r) { return r * 180 / Math.PI; },

    // 四方向枚举（坦克大战式移动）
    DIR: { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 },

    // 方向 -> 单位向量
    dirVec(dir) {
        switch (dir) {
            case Utils.DIR.UP:    return { x: 0, y: -1 };
            case Utils.DIR.RIGHT: return { x: 1, y: 0 };
            case Utils.DIR.DOWN:  return { x: 0, y: 1 };
            case Utils.DIR.LEFT:  return { x: -1, y: 0 };
        }
        return { x: 0, y: 0 };
    },

    // 两点间距离
    dist(ax, ay, bx, by) {
        const dx = ax - bx, dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    },

    // 两点间距离平方（避免开方，性能更优）
    distSq(ax, ay, bx, by) {
        const dx = ax - bx, dy = ay - by;
        return dx * dx + dy * dy;
    },

    /* ---------- 矩形辅助 ---------- */
    // 以中心点构造轴对齐矩形（AABB）
    rect(cx, cy, w, h) {
        return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
    },

    /* ---------- 碰撞检测 ---------- */
    // AABB 矩形碰撞（粗略检测，性能高）
    aabb(a, b) {
        return a.x < b.x + b.w &&
               a.x + a.w > b.x &&
               a.y < b.y + b.h &&
               a.y + a.h > b.y;
    },

    // 圆形碰撞（精细检测：子弹通常视为圆形）
    circleHit(ax, ay, ar, bx, by, br) {
        const r = ar + br;
        return Utils.distSq(ax, ay, bx, by) < r * r;
    },

    // 圆 vs 矩形 碰撞（子弹 vs 墙壁/坦克）
    circleRect(cx, cy, cr, rect) {
        const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        const dx = cx - nx, dy = cy - ny;
        return dx * dx + dy * dy < cr * cr;
    },

    /* ---------- 限值 ---------- */
    clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    },

    // 线性插值（用于平滑过渡，如血条）
    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    /* ---------- 时间 ---------- */
    now() { return performance.now(); },

    /* ---------- 文本 ---------- */
    escapeHTML(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
};

// 辅助：将矩形按中心点平移后返回新矩形（不修改原对象）
function moveRect(rect, dx, dy) {
    return {
        x: rect.x + dx, y: rect.y + dy,
        w: rect.w, h: rect.h,
        cx: rect.cx + dx, cy: rect.cy + dy,
    };
}

/* ============================================================
   SpatialHash — 空间哈希网格
   把实体按网格分桶，碰撞查询只检查邻近桶，避免 O(n²) 复杂度
   适用于子弹/敌人/道具等数量较多的实体
   ============================================================ */
class SpatialHash {
    constructor(cellSize = 80) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    // 清空所有桶
    clear() { this.cells.clear(); }

    // 计算坐标所在网格键
    _key(cx, cy) {
        return cx + ',' + cy;
    }

    // 插入一个实体（带 x, y, size 属性）
    insert(entity) {
        const cs = this.cellSize;
        // 实体可能跨多格，插入到所有覆盖格
        const x0 = Math.floor((entity.x - (entity.size || 0)) / cs);
        const x1 = Math.floor((entity.x + (entity.size || 0)) / cs);
        const y0 = Math.floor((entity.y - (entity.size || 0)) / cs);
        const y1 = Math.floor((entity.y + (entity.size || 0)) / cs);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const k = this._key(gx, gy);
                let bucket = this.cells.get(k);
                if (!bucket) { bucket = []; this.cells.set(k, bucket); }
                bucket.push(entity);
            }
        }
    }

    // 批量插入
    insertAll(list) {
        for (const e of list) {
            if (e && (e.alive === undefined || e.alive)) this.insert(e);
        }
    }

    // 查询某点（圆心+半径）附近的候选实体，返回数组（可能含重复，由调用方去重）
    queryNear(x, y, r) {
        const cs = this.cellSize;
        const x0 = Math.floor((x - r) / cs);
        const x1 = Math.floor((x + r) / cs);
        const y0 = Math.floor((y - r) / cs);
        const y1 = Math.floor((y + r) / cs);
        const result = [];
        const seen = new Set();  // 去重
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const bucket = this.cells.get(this._key(gx, gy));
                if (!bucket) continue;
                for (const e of bucket) {
                    if (seen.has(e)) continue;
                    seen.add(e);
                    result.push(e);
                }
            }
        }
        return result;
    }
}
