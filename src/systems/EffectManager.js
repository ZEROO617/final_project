// ════════════════════════════════════════════════════════════════════════════
// EffectManager.js — 피격/방어 시각 이펙트 (시스템)
//
//   플레이어/적의 피격 플래시·스케일 펄스 같은 단발 이펙트 상태를 관리.
//   triggerHit/triggerDefendSuccess로 켜고, update/getter로 렌더가 읽는다.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// § 2  EffectManager — 피격/방어 시각 이펙트
// ════════════════════════════════════════════════════════════════════════════

const EffectManager = {
  _fx: { player: null, enemy: null },

  triggerHit(target) {
    this._fx[target] = { type: 'hit', flash: 14, scale: 14 };
    if (target === 'enemy' && sndDamage) sndDamage.play();
  },
  triggerDefendSuccess(target) { this._fx[target] = { type: 'defend', flash: 20, scale: 0  }; },

  update() {
    for (const t of ['player', 'enemy']) {
      const fx = this._fx[t]; if (!fx) continue;
      if (fx.flash > 0) fx.flash--;
      if (fx.scale > 0) fx.scale--;
      if (fx.flash <= 0 && fx.scale <= 0) this._fx[t] = null;
    }
  },

  getFlashColor(target) {
    const fx = this._fx[target];
    if (!fx || fx.flash <= 0) return null;
    const a = (fx.flash / 14) * 200;
    return fx.type === 'hit' ? [255, 60, 60, a] : [210, 225, 255, a];
  },

  getScale(target) {
    const fx = this._fx[target];
    if (!fx || fx.scale <= 0) return 1.0;
    return 1.0 + 0.30 * sin((1 - fx.scale / 14) * PI);
  },
};


