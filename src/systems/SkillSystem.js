// ════════════════════════════════════════════════════════════════════════════
// SkillSystem.js — 스킬 정의 & 효과 실행 (시스템)
//
//   SKILL_DEFS: 스킬 데이터(손동작 패턴 + 효과). SkillEffectResolver: 효과 적용기.
//   BattleManager가 스킬 발동 시 resolve()를 호출한다. EffectManager에 의존.
// ════════════════════════════════════════════════════════════════════════════


// ─── 스킬 정의 (순수 데이터) ────────────────────────────────────────────────
//   pattern : 손동작 ID 배열 (§0 GestureClassifier 기준)
//   effect  : SkillEffectResolver 가 해석하는 순수 데이터 객체
// ────────────────────────────────────────────────────────────────────────────
const SKILL_DEFS = [
  {
    id: 'countdown',
    name: '카운트다운',
    pattern: [1, 2, 3],
    desc: '다음 턴 데미지 +30',
    effect: { type: 'nextTurnBonus', bonus: 30 },
  },
  {
    id: 'coinFlip',
    name: '동전 뒤집기',
    pattern: [0, 6],
    desc: '50% 확률 80 / 0 데미지',
    effect: { type: 'gamble', winDmg: 80, lossDmg: 0, chance: 0.5 },
  },
  {
    id: 'pierce',
    name: '관통',
    pattern: [0, 5],
    desc: '40 데미지',
    effect: { type: 'damage', amount: 40 },
  },
  {
    id: 'ultraKill',
    name: '울트라킬',
    pattern: [0, 6, 7],
    desc: '60 데미지',
    effect: { type: 'damage', amount: 60 },
  },
  {
    id: 'warningShot',
    name: '경고사격',
    pattern: [8, 7],
    desc: '20 데미지',
    effect: { type: 'damage', amount: 20 },
  },
  {
    id: 'chargedBlast',
    name: '충전된 블라스트',
    pattern: [4, 8, 9],
    desc: '40 데미지 + 이번 턴 방어',
    effect: { type: 'damageAndShield', amount: 40 },
  },
];

// ─── 스킬 효과 실행기 ────────────────────────────────────────────────────────
//   resolve(skill, battleData) → 결과 메시지 문자열
//   handlers 맵만 수정하면 어떤 효과 타입도 추가·변경 가능 (BattleManager 수정 불필요)
// ────────────────────────────────────────────────────────────────────────────
const SkillEffectResolver = (() => { // 여기 하다가 컴퓨터 다 때려 뿌실뻔 (16) 
  const handlers = {
    damage(eff, d) {
      const total = eff.amount + (d.bonusDmg || 0);
      d.bonusDmg  = 0;
      d.enemyHp   = max(0, d.enemyHp - total);
      EffectManager.triggerHit('enemy');
      return total + ' 데미지!';
    },

    gamble(eff, d) {
      const win  = random() < eff.chance;
      const dmg  = win ? eff.winDmg : eff.lossDmg;
      d.bonusDmg = 0;
      d.enemyHp  = max(0, d.enemyHp - dmg);
      if (dmg > 0) EffectManager.triggerHit('enemy');
      return win ? '🎲 행운! ' + dmg + ' 데미지!' : '🎲 실패... 0 데미지';
    },

    nextTurnBonus(eff, d) {
      d.bonusDmg = (d.bonusDmg || 0) + eff.bonus;
      return '다음 턴 +' + eff.bonus + ' 데미지 충전!';
    },

    damageAndShield(eff, d) {
      const total = eff.amount + (d.bonusDmg || 0);
      d.bonusDmg  = 0;
      d.enemyHp   = max(0, d.enemyHp - total);
      d.shielded  = true;
      EffectManager.triggerHit('enemy');
      return total + ' 데미지 + 이번 턴 방어!';
    },
  };

  return {
    resolve(skill, battleData) {
      const handler = handlers[skill.effect.type];
      return handler ? handler(skill.effect, battleData) : '??? (미등록 효과 타입)';
    },
  };
})();

