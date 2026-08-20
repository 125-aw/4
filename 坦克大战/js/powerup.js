/* ============================================================
   powerup.js — 道具系统
   道具类型：shield / rapid / pierce / mine / heal / upgrade
   玩家拾取后由 PlayerTank 应用效果
   ============================================================ */

class PowerUp {
    constructor(x, y, type) {
        this.x = x; this.y = y;
        this.type = type;
        this.size = CONFIG.POWERUP.size;
        const cfg = CONFIG.POWERUP.types[type];
        this.color = cfg.color;
        this.label = cfg.label;
        this.duration = cfg.duration;
        this.life = CONFIG.POWERUP.lifetime;
        this.dead = false;
        this.bob = Math.random() * Math.PI * 2;
        this.rot = 0;
    }

    update(dt) {
        if (this.dead) return;
        this.life -= dt;
        if (this.life <= 0) { this.dead = true; return; }
        this.bob += dt * 0.005;
        this.rot += dt * 0.002;
    }

    // 拾取碰撞（玩家坦克中心点距离）
    hitPickup(px, py, psize) {
        return Utils.dist(this.x, this.y, px, py) < this.size + psize / 2;
    }

    draw(ctx) {
        if (this.dead) return;
        const blink = this.life < 3000 ? (Math.sin(this.life * 0.02) > 0 ? 1 : 0.3) : 1;
        const yo = Math.sin(this.bob) * 3;
        ctx.save();
        ctx.globalAlpha = blink;
        ctx.translate(this.x, this.y + yo);

        // 外发光环
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.stroke();

        // 内填充
        ctx.fillStyle = this.color;
        ctx.globalAlpha = blink * 0.35;
        ctx.beginPath();
        ctx.arc(0, 0, this.size - 3, 0, Math.PI * 2);
        ctx.fill();

        // 旋转图标
        ctx.globalAlpha = blink;
        ctx.rotate(this.rot);
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 0;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const icon = this.iconChar();
        ctx.fillText(icon, 0, 0);

        ctx.restore();
    }

    // 图标字符（简单文字/符号图标）
    iconChar() {
        switch (this.type) {
            case 'shield': return '🛡';
            case 'rapid': return '⚡';
            case 'pierce': return '🏹';
            case 'mine': return '💣';
            case 'heal': return '❤';
            case 'upgrade': return '⭐';
            case 'clear': return '💥';
            case 'speed': return '💨';
            case 'base': return '🏠';
            case 'life': return '1UP';
            default: return '?';
        }
    }

    static randomType() {
        // 升级/生命/清屏更稀有；技能类与回复类常掉
        const weighted = [
            'shield', 'shield', 'rapid', 'rapid', 'pierce', 'pierce',
            'mine', 'mine', 'heal', 'heal', 'upgrade',
            'speed', 'speed', 'base', 'clear', 'life',
        ];
        return Utils.pick(weighted);
    }
}
