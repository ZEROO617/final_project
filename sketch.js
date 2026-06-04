// ════════════════════════════════════════════════════════════════════════════
// sketch.js  –  "I am" RPG  (1280×960 고정 월드 / 이미지 배경 / 공간 방어)
//
//  § 0  GestureClassifier   — 손동작 판정 (순수 데이터 + 분류)       ← 신설
//  § 1  상수 & 스킬 데이터  — SKILL_DEFS + SkillEffectResolver       ← 전면 교체
//  § 2  EffectManager       — 피격/방어 시각 이펙트
//  § 3  BattleManager       — 전투 상태 머신 (로직 전용)              ← 부분 수정
//  § 4  HandTracker         — MediaPipe 래퍼 + 사분면 인식            ← 부분 수정
//  § 5  전역 상태
//  § 6  p5 라이프사이클
//  § 7  입력 핸들러
//  § 8  화면들 (타이틀 / 보정 / 일시정지 / 게임)
//  § 9  전투 화면 (순수 렌더링)                                       ← 부분 수정
//  § 10 공용 UI 헬퍼
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// § 0  GestureClassifier — 손동작 ID 판정 (데이터 기반, 완전 분리)
//
//   손동작 ID 표:
//     0=주먹  1=검지  2=검지+중지  3=검지+중지+약지  4=엄지제외전체
//     5=보자기  6=엄지  7=엄지+검지  8=엄지+새끼  9=엄지+검지+새끼
//
//   외부 노출:
//     GestureClassifier.classify(landmarks) → ID(0–9) | -1(미인식)
//     GestureClassifier.getName(id)         → 표시용 한글 이름
// ════════════════════════════════════════════════════════════════════════════

const GESTURE_NAMES = [
  '주먹',          // 0
  '검지',          // 1
  '검지+중지',     // 2
  '검지+중지+약지',// 3
  '엄지제외전체',  // 4
  '보자기',        // 5
  '엄지',          // 6
  '엄지+검지',     // 7
  '엄지+새끼',     // 8
  '엄지+검지+새끼',// 9
];

const GestureClassifier = (() => {
  // 비트 레이아웃: [엄지=4, 검지=3, 중지=2, 약지=1, 새끼=0]
  // 해당 비트가 1 = 해당 손가락 펴짐
  const GESTURE_DEFS = [
    { id: 0, mask: 0b00000 }, // 주먹
    { id: 1, mask: 0b01000 }, // 검지
    { id: 2, mask: 0b01100 }, // 검지+중지
    { id: 3, mask: 0b01110 }, // 검지+중지+약지
    { id: 4, mask: 0b01111 }, // 엄지제외전체
    { id: 5, mask: 0b11111 }, // 보자기
    { id: 6, mask: 0b10000 }, // 엄지
    { id: 7, mask: 0b11000 }, // 엄지+검지
    { id: 8, mask: 0b10001 }, // 엄지+새끼
    { id: 9, mask: 0b11001 }, // 엄지+검지+새끼
  ];

  // ─── 기준점을 PIP → MCP 로 변경 ────────────────────────────────────────
  //   PIP(pip·관절)와 tip 사이 거리 < MCP(손허리뼈)와 tip 사이 거리
  //   → MCP 기준일 때 y 차이가 ~3배 커져 잡음에 강해짐
  //   MediaPipe 손 랜드마크:
  //     검지 MCP=5  중지 MCP=9  약지 MCP=13  새끼 MCP=17
  const FINGER_JOINTS = [
    [8,  5],  // 검지: tip vs MCP
    [12, 9],  // 중지: tip vs MCP
    [16, 13], // 약지: tip vs MCP
    [20, 17], // 새끼: tip vs MCP
  ];

  // 비트 차이 개수 (Hamming distance)
  const hammingDist = (a, b) => {
    let x = a ^ b, n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  };

  return {
    classify(lm) {
      // 엄지: x 거리만 검사 (y 조건 제거 → 손 기울기·각도에 덜 민감)
      //   tip(4) 과 MCP(2) 의 x 거리가 0.04 이상이면 폄
      const thumbBit = abs(lm[4].x - lm[2].x) > 0.04 ? 1 : 0;

      // 검지~새끼: tip.y < MCP.y 이면 폄
      const fingerMask = FINGER_JOINTS.reduce(
        (acc, [tip, mcp], i) =>
          acc | (lm[tip].y < lm[mcp].y ? (1 << (3 - i)) : 0),
        0
      );

      const mask = (thumbBit << 4) | fingerMask;

      // 1차: 정확히 일치하는 제스처 반환
      for (const def of GESTURE_DEFS) {
        if (def.mask === mask) return def.id;
      }

      // 2차: 해밍 거리 1 이내(손가락 1개 오차)의 가장 가까운 제스처 반환
      //   → 손가락이 어중간하게 걸쳐 있어도 가장 유사한 제스처로 자동 매핑
      let best = -1, bestDist = 999;
      for (const def of GESTURE_DEFS) {
        const d = hammingDist(mask, def.mask);
        if (d < bestDist) { bestDist = d; best = def.id; }
      }
      return bestDist <= 1 ? best : -1;
    },
    getName: id => GESTURE_NAMES[id] ?? '?',
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 1  상수 & 스킬 데이터
// ════════════════════════════════════════════════════════════════════════════

const CANVAS_W      = 1280;
const CANVAS_H      = 960;
const MAP_W         = 1280;
const MAP_H         = 960;
const STAGE1_MAP_W  = 1888;
const STAGE1_MAP_H  = 2252;
const STAGE1_BLOCKED = [
  { x1:  63, y1:  446, x2:  499, y2: 2190 },
  { x1: 583, y1:  446, x2: 1143, y2: 1614 },
  { x1: 1315, y1: 458, x2: 1755, y2: 1614 },
  { x1:  63, y1:   63, x2: 1347, y2:  358 },
  { x1: 1531, y1:  63, x2: 1826, y2:  359 },
];
const SPEED         = 4;

const CALIBRATION_TOTAL  = 300;
const CAST_TOTAL         = 300;
const HOLD_NEEDED        = 55;
const DEFEND_TOTAL       = 240;
const DEFEND_HOLD_NEEDED = 90;
const GESTURE_ENABLED    = true;
const ENEMY_WAIT              = 100;
const RESULT_WAIT             = 100;
const GESTURE_DEFEND_ROUNDS   = 4;
const GESTURE_DEFEND_PER_ROUND= 180; // 3초 (60fps 기준)
const ENEMY_DMG          = 20;
const ENEMY_COUNT        = 5;

const HT_X = 12, HT_Y = 12, HT_W = 220, HT_H = 165;
const HT_BUF_SIZE = 15;

const REGION_LO = 0.30;
const REGION_HI = 0.70;

const DIRECTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

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
const SkillEffectResolver = (() => {
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


// ─── 스테이지 정의 ─────────────────────────────────────────────────────────────
//   getBg()        : 배경 이미지 반환 (preload 이후 호출)
//   portal         : { x, y, r } 전환 감지 영역 — null 이면 전환 없음
//   nextStage      : 전환 대상 스테이지 ID   — null 이면 마지막 스테이지
//   spawnEnemies() : 이 스테이지 적 배열을 반환하는 팩토리
// ──────────────────────────────────────────────────────────────────────────────
const STAGE_DEFS = [
  {
    id: 1,
    mapW: 1888, mapH: 2252,
    getBg:       () => imgStage1,
    portal:      { x: 1440, y: 95, r: 100 },
    nextStage:   2,
    spawnEnemies() {
      return [
        { x:  888, y:  430, size: 125, img: 'enemy1' }, // 적1 → 기존 적2 위치
        { x: 1228, y: 1042, size: 125, img: 'enemy2' }, // 적2 → 기존 적3 위치
        { x:  514, y: 1400, size: 125, img: 'enemy3' }, // 적3 → 기존 적1 위치에서 좌로 30
      ];
    },
  },
  {
    id: 2,
    mapW: 1280, mapH: 960,
    getBg:       () => imgStage2,
    portal:      null,
    nextStage:   null,
    spawnEnemies() {
      return [{ x: 640, y: 280, size: 250, isBoss: true }];
    },
  },
];


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


// ════════════════════════════════════════════════════════════════════════════
// § 3  BattleManager — 전투 상태 머신 (로직만, 렌더링 없음)
//
//   command → skillSelect → playerCasting → result
//                                         ↘ enemyTurn → defendCasting → result
// ════════════════════════════════════════════════════════════════════════════

const BattleManager = {
  data: {
    playerHp: 100, playerMaxHp: 100,
    enemyHp:  100, enemyMaxHp:  100,

    state: 'command', // command|skillSelect|playerCasting|enemyTurn|aimDefend|aimSuccess|result
    selectedSkill: null,

    // 플레이어 캐스팅
    castIndex: 0, castTimer: 0, holdTimer: 0,
    // 적 턴
    enemyTimer: 0, pendingDmg: 0,
    // 공간 방어 (4단계) — 레거시, 현재 미사용
    defendRound: 0, defendPattern: [], defendTimer: 0, defendHold: 0,
    // 조준 방어
    aimSuccessTimer: 0,
    // 스킬 효과 누적 상태
    bonusDmg: 0,    // 다음 공격에 더할 추가 데미지 (카운트다운 등)
    shielded: false, // 이번 적 공격을 완전 차단 (충전된 블라스트 등)
    // 결과 표시
    resultMsg: '', resultTimer: 0, resultNext: 'command',
  },

  init() {
    const d = this.data;
    Object.assign(d, {
      playerHp: d.playerMaxHp, enemyHp: d.enemyMaxHp,
      state: 'command', selectedSkill: null,
      castIndex: 0, castTimer: 0, holdTimer: 0,
      enemyTimer: 0, pendingDmg: 0,
      defendRound: 0, defendPattern: [], defendTimer: 0, defendHold: 0,
      aimSuccessTimer: 0,
      bonusDmg: 0, shielded: false,
      resultMsg: '', resultTimer: 0, resultNext: 'command',
    });
  },

  update() {
    EffectManager.update();
    const d = this.data;
    const stateHandlers = {
      playerCasting:  () => this._updateGestureCasting(),
      enemyTurn:      () => this._updateEnemyTurn(),
      aimDefend:      () => this._updateAimDefend(),
      barrageDefend:  () => this._updateBarrageDefend(),
      ringDefend:     () => this._updateRingDefend(),
      aimSuccess:     () => this._updateAimSuccess(),
      boss:           () => this._updateBoss(),
      result:         () => this._updateResult(),
    };
    stateHandlers[d.state]?.();
  },

  handleClick() {
    const d = this.data;
    const clickHandlers = {
      command:     () => this._handleCommandClick(),
      skillSelect: () => this._handleSkillSelectClick(),
    };
    clickHandlers[d.state]?.();
  },

  // ── 적 턴: 연출 종료 후 적별 방어 페이즈로 전환 ─────────────────────────
  _updateEnemyTurn() {
    const d = this.data;
    if (--d.enemyTimer > 0) return;

    if (battleEnemy?.img === 'enemy2') {
      d.state = 'barrageDefend'; // 적2: 촉수 탄막 회피 페이즈
      BarrageManager.init();
    } else if (battleEnemy?.img === 'enemy3') {
      d.state = 'ringDefend';    // 적3: 수축형 원형 탄막 회피 페이즈
      RingBarrageManager.init();
    } else {
      d.state = 'aimDefend';     // 기본: 투사체 요격 페이즈
      ProjectileManager.init();
    }
  },

  // ── 보스: 실시간 복합 전투 진입 ─────────────────────────────────────────
  startBoss() {
    this.data.state = 'boss';
    BossManager.init(gPlayerHp);
  },

  // ── 보스 전투 갱신: 승/패 판정 ─────────────────────────────────────────
  _updateBoss() {
    BossManager.update();
    const r = BossManager.result();
    if (r === 'win') {
      BossManager.reset();
      battleEnemy = null;
      if (bgm) bgm.stop();
      state = 'victory';
    } else if (r === 'lose') {
      BossManager.reset();
      battleEnemy = null;
      if (bgm) bgm.stop();
      state = 'defeat';
    }
  },

  // ── 적2 탄막 방어: 15초간 회피, 종료 시 생존하면 성공 연출 ──────────────
  _updateBarrageDefend() {
    const d = this.data;
    BarrageManager.update();

    const dmg = BarrageManager.takeDamage();
    if (dmg > 0) {
      d.playerHp = max(0, d.playerHp - dmg);
      EffectManager.triggerHit('player');
      if (sndDamage) sndDamage.play();
      if (d.playerHp <= 0) {
        BarrageManager.reset();
        this._showResult('패배...', 'lose');
        return;
      }
    }

    if (BarrageManager.isDone()) {
      BarrageManager.reset();
      d.aimSuccessTimer = 90; // 생존 성공 연출 (흰색 글로우)
      d.state = 'aimSuccess';
    }
  },

  // ── 적3 수축형 원형 탄막 방어: 15초 생존 시 성공 연출 ───────────────────
  _updateRingDefend() {
    const d = this.data;
    RingBarrageManager.update();

    const dmg = RingBarrageManager.takeDamage();
    if (dmg > 0) {
      d.playerHp = max(0, d.playerHp - dmg);
      EffectManager.triggerHit('player');
      if (sndDamage) sndDamage.play();
      if (d.playerHp <= 0) {
        RingBarrageManager.reset();
        this._showResult('패배...', 'lose');
        return;
      }
    }

    if (RingBarrageManager.isDone()) {
      RingBarrageManager.reset();
      d.aimSuccessTimer = 90; // 생존 성공 연출 (흰색 글로우)
      d.state = 'aimSuccess';
    }
  },

  // ── 조준 방어: 투사체 5개 전부 처리될 때까지 유지 ───────────────────────
  //   파괴 → aimSuccess / 피격만 → command 복귀
  _updateAimDefend() {
    const d = this.data;

    // 먼저 투사체를 갱신해야 이번 프레임에 도달한 마지막 공격의 데미지도 누적된다
    ProjectileManager.update();

    // 갱신 후 누적된 명중 데미지 적용 (reset 전에 반드시 처리)
    const dmg = ProjectileManager.takeDamage();
    if (dmg > 0) {
      d.playerHp = max(0, d.playerHp - dmg);
      EffectManager.triggerHit('player');
      if (sndDamage) sndDamage.play();
      if (d.playerHp <= 0) {
        ProjectileManager.reset();
        this._showResult('패배...', 'lose');
        return;
      }
    }

    // 5개 모두 처리됐으면 종료 분기
    if (ProjectileManager.isAllDone()) {
      const allKilled = ProjectileManager.isAllDestroyedByPlayer();
      ProjectileManager.reset();
      if (allKilled) {
        d.aimSuccessTimer = 90; // 1.5초 성공 연출
        d.state = 'aimSuccess';
      } else {
        d.state = 'command';
      }
    }
  },

  // ── 방어 성공 연출: 타이머 후 command 복귀 ──────────────────────────────
  _updateAimSuccess() {
    if (--this.data.aimSuccessTimer <= 0) this.data.state = 'command';
  },

  _updateResult() {
    if (--this.data.resultTimer <= 0) this._applyResultTransition();
  },

  // ── 캐스팅: 손동작 ID로 비교 (GestureClassifier 기준) ──────────────────
  _updateGestureCasting() {
    const d = this.data;
    if (--d.castTimer <= 0) {
      this._showResult('스킬 실패 — 시간 초과!', 'enemyTurn');
      return;
    }

    if (!GESTURE_ENABLED || HandTracker.gestureId === d.selectedSkill.pattern[d.castIndex]) {
      if (++d.holdTimer >= HOLD_NEEDED) {
        d.castIndex++;
        d.holdTimer = 0;
        // 손동작 1개 완성마다 정답음 재생 (다른 소리보다 50% 작게)
        if (sndCorrect) { sndCorrect.setVolume(0.5); sndCorrect.play(); }
        if (d.castIndex >= d.selectedSkill.pattern.length) this._resolveSkill();
      }
    } else {
      d.holdTimer = 0;
    }
  },

  // ── 공간 방어: 손이 목표 구역(+보스전엔 손동작까지)에 머물러야 통과 ──
  //   gesture === null → 방향만 검사 (일반전)
  //   gesture !== null → 방향 AND 손동작 모두 일치해야 게이지 증가 (보스전)
  _updateDefendCasting() {
    const d = this.data;
    if (d.defendRound >= 4)   { this._resolveDefend(true);  return; }
    if (--d.defendTimer <= 0) { this._resolveDefend(false); return; }

    const current = d.defendPattern[d.defendRound];

    const directionOk =
      HandTracker.currentRegion === current.direction;

    const gestureOk =
      !GESTURE_ENABLED ||
      current.gesture === null ||
      HandTracker.gestureId === current.gesture;

    if (directionOk && gestureOk) {
      if (++d.defendHold >= DEFEND_HOLD_NEEDED) {
        d.defendRound++;
        d.defendHold  = 0;
        d.defendTimer = DEFEND_TOTAL;
      }
    } else {
      d.defendHold = 0;
    }
  },

  // ── 적1 전용 제스처 방어: 라운드당 3초, 총 4라운드(12초) ────────────────
  _updateGestureDefend() {
    const d = this.data;
    if (d.gestureRound >= GESTURE_DEFEND_ROUNDS) {
      const dmg = d.gestureDmg;
      d.playerHp = max(0, d.playerHp - dmg);
      if (dmg > 0) EffectManager.triggerHit('player');
      else         EffectManager.triggerDefendSuccess('player');
      const dead = d.playerHp <= 0;
      this._showResult(
        dmg > 0 ? '방어 실패! -' + dmg + ' HP' : '모든 공격 방어 성공!',
        dead ? 'lose' : 'command'
      );
      return;
    }

    if (--d.gestureTimer <= 0) {
      d.gestureDmg  += floor(d.pendingDmg / GESTURE_DEFEND_ROUNDS);
      d.gestureRound++;
      d.gestureTimer = GESTURE_DEFEND_PER_ROUND;
      d.gestureHold  = 0;
      return;
    }

    const required = d.gesturePattern[d.gestureRound];
    const ok = !GESTURE_ENABLED || HandTracker.gestureId === required;
    if (ok) {
      if (++d.gestureHold >= HOLD_NEEDED) {
        d.gestureRound++;
        d.gestureTimer = GESTURE_DEFEND_PER_ROUND;
        d.gestureHold  = 0;
      }
    } else {
      d.gestureHold = 0;
    }
  },

  // ── 클릭 핸들러 ────────────────────────────────────────────────────────
  _handleCommandClick() {
    const py = CANVAS_H * 0.72;
    if (mouseY <= py) return;

    if (mouseX < CANVAS_W / 2) {
      this.data.state = 'skillSelect';
    } else {
      gPlayerHp      = this.data.playerHp; // 도망쳐도 체력 유지
      this.init();
      battleEnemy    = null;
      escapeCooldown = 90;
      if (bgm) bgm.stop();
      state          = 'game';
    }
  },

  _handleSkillSelectClick() {
    const d = this.data;
    const py   = CANVAS_H * 0.65;
    const rowH = (CANVAS_H - py) / (SKILL_DEFS.length + 1);

    for (let i = 0; i < SKILL_DEFS.length; i++) {
      if (mouseY >= py + i * rowH && mouseY < py + (i + 1) * rowH) {
        Object.assign(d, {
          selectedSkill: SKILL_DEFS[i],
          state: 'playerCasting',
          castTimer: CAST_TOTAL, castIndex: 0, holdTimer: 0,
        });
        HandTracker.resetGestureBuffer();
        return;
      }
    }
    if (mouseY >= py + SKILL_DEFS.length * rowH) d.state = 'command';
  },

  // ── 스킬 판정: SkillEffectResolver 에 위임 (if/switch 없음) ─────────────
  _resolveSkill() {
    const d   = this.data;
    const sk  = d.selectedSkill;
    const msg = SkillEffectResolver.resolve(sk, d);

    const won = d.enemyHp <= 0;
    this._showResult(
      sk.name + ' 발동!\n' + msg + (won ? '\n적 처치! ★ 승리!' : ''),
      won ? 'win' : 'enemyTurn'
    );
  },

  // ── 방어 판정: shielded 플래그도 체크 (충전된 블라스트 등) ─────────────
  _resolveDefend(success) {
    const d       = this.data;
    const blocked = success || d.shielded; // 스킬 방어 버프 반영
    d.shielded    = false;

    const dmg = blocked ? 0 : d.pendingDmg;
    d.playerHp    = max(0, d.playerHp - dmg);

    if (blocked) {
      EffectManager.triggerDefendSuccess('player');
      this._showResult('모든 공격 방어 성공! 데미지 무효!', d.playerHp <= 0 ? 'lose' : 'command');
    } else {
      EffectManager.triggerHit('player');
      const msg  = '방어 실패! -' + dmg + ' HP';
      const dead = d.playerHp <= 0;
      this._showResult(dead ? '패배...\n' + msg : msg, dead ? 'lose' : 'command');
    }
  },

  // ── 결과 표시 & 전환 ──────────────────────────────────────────────────
  _showResult(msg, nextState) {
    Object.assign(this.data, {
      resultMsg: msg, resultNext: nextState,
      resultTimer: RESULT_WAIT, state: 'result',
    });
  },

  _applyResultTransition() {
    const d  = this.data;
    const nx = d.resultNext;

    const transitions = {
      win() {
        const isBoss   = battleEnemy?.isBoss;
        gPlayerHp      = d.playerHp; // 승리 후에도 체력 유지 (연속 생존 구간)
        enemies        = enemies.filter(e => e !== battleEnemy);
        battleEnemy    = null;
        BattleManager.init();
        if (bgm) bgm.stop();
        if (isBoss) {
          state = 'victory';
        } else {
          escapeCooldown = 60;
          state          = 'game';
        }
      },
      lose() {
        battleEnemy = null;
        BattleManager.init();
        if (bgm) bgm.stop();
        state = 'defeat';
      },
      enemyTurn() {
        d.state      = 'enemyTurn';
        d.enemyTimer = ENEMY_WAIT;
        d.pendingDmg = ENEMY_DMG;
      },
    };

    (transitions[nx] ?? (() => { d.state = nx; }))();
  },
};


// ════════════════════════════════════════════════════════════════════════════
// § 4  HandTracker — MediaPipe Hands 래퍼 + 사분면 인식
//
//   외부 노출:
//     gestureId      — 손동작 ID (0–9, -1=미인식) ← 신설
//     gesture        — 한글 이름 표시용 문자열    ← 기존 유지
//     currentRegion  — 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CENTER'
//     handPos        — { x, y }  정규화 좌표 (0~1)
//     calibration    — 보정 데이터 (가동 범위)
// ════════════════════════════════════════════════════════════════════════════

const HandTracker = {
  video: null, camera: null, hands: null, landmarks: null,
  gestureId: -1,
  gesture: '손을 보여주세요',
  currentRegion: 'CENTER',
  handPos: { x: 0.5, y: 0.5 },
  useRawAim: false, // true면 보정 무시하고 원시 좌표 사용 (적2 전투)
  resetGestureBuffer() {
    this._bufGesture = [];
  },
  calibration: { isCalibrated: false, minX: 0.4, maxX: 0.6, minY: 0.4, maxY: 0.6 },

  // 제스처/구역 각각 독립 버퍼 (공유 시 두 채널이 서로 오염되는 버그 방지)
  _bufGesture: [],
  _bufRegion:  [],

  init() {
    if (this.video) return;

    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    this.hands = new Hands({ locateFile: f => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f });
    this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0,
                            minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    this.hands.onResults(r => this._onResults(r));

    this.camera = new Camera(this.video, {
      onFrame: async () => { await this.hands.send({ image: this.video }); },
      width: 320, height: 240,
    });
    this.camera.start();
    this._resetState();
  },

  stop() {
    if (this.camera) { this.camera.stop(); this.camera = null; }
    if (this.hands)  { this.hands.close(); this.hands  = null; }
    if (this.video) {
      if (this.video.srcObject) this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.remove(); this.video = null;
    }
    this._resetState();
  },

  _resetState() {
    this.landmarks    = null;
    this.gestureId    = -1;
    this.gesture      = '손을 보여주세요';
    this.currentRegion = 'CENTER';
    this._bufGesture  = [];
    this._bufRegion   = [];
  },

  _onResults(r) {
    if (!r.multiHandLandmarks || r.multiHandLandmarks.length === 0) {
      this.landmarks  = null;
      this.gestureId  = -1;
      this.gesture    = '손을 보여주세요';
      this.currentRegion = 'CENTER';
      return;
    }

    this.landmarks = r.multiHandLandmarks[0];

    // 손동작 분류는 GestureClassifier 에 완전 위임
    const rawId    = GestureClassifier.classify(this.landmarks);
    this.gestureId = this._stabilize(rawId, this._bufGesture);
    this.gesture   = this.gestureId >= 0 ? GestureClassifier.getName(this.gestureId) : '?';

    // 9번 랜드마크(중지 MCP)를 손 중심으로 사용
    const mid  = this.landmarks[9];
    const rawX = 1 - mid.x; // 거울 표시용 X 반전
    const rawY = mid.y;

    // 보정 단계 중 가동 범위 실시간 갱신
    if (state === 'calibration') {
      const c = this.calibration;
      c.minX = min(c.minX, rawX); c.maxX = max(c.maxX, rawX);
      c.minY = min(c.minY, rawY); c.maxY = max(c.maxY, rawY);
    }

    // useRawAim: 보정 무시하고 원시 좌표(전체 카메라 범위) 사용
    let nx, ny;
    if (this.useRawAim) {
      nx = rawX;
      ny = rawY;
    } else {
      nx = map(rawX, this.calibration.minX, this.calibration.maxX, 0, 1, true);
      ny = map(rawY, this.calibration.minY, this.calibration.maxY, 0, 1, true);
    }
    if (isNaN(nx)) nx = 0.5;
    if (isNaN(ny)) ny = 0.5;
    this.handPos.x = nx;
    this.handPos.y = ny;

    // 사분면 판정 — Y 우선, X는 중앙 행에서만
    let rawRegion = 'CENTER';
    if      (ny < REGION_LO) rawRegion = 'UP';
    else if (ny > REGION_HI) rawRegion = 'DOWN';
    else if (nx < REGION_LO) rawRegion = 'LEFT';
    else if (nx > REGION_HI) rawRegion = 'RIGHT';
    this.currentRegion = this._stabilize(rawRegion, this._bufRegion);
  },

  // 제스처·구역 공용 최빈값 안정화 — 버퍼를 외부에서 주입해 채널 격리
  _stabilize(item, buffer) {
    buffer.push(item);
    if (buffer.length > HT_BUF_SIZE) buffer.shift();
    const freq = {};
    let best = item, bestCount = 0;
    for (const g of buffer) {
      freq[g] = (freq[g] || 0) + 1;
      if (freq[g] > bestCount) { best = g; bestCount = freq[g]; }
    }
    return best;
  },

  // ── 전투 중 좌상단 미니뷰 (방어 단계에서는 숨김) ─────────────────────
  drawUI() {
    if (!this.video || this.video.readyState < 2) return;
    if (BattleManager.data.state === 'defendCasting') return;

    drawingContext.save();
    drawingContext.translate(HT_X + HT_W, HT_Y);
    drawingContext.scale(-1, 1);
    drawingContext.drawImage(this.video, 0, 0, HT_W, HT_H);
    drawingContext.restore();

    noFill(); noStroke();
    rect(HT_X, HT_Y, HT_W, HT_H, 4);

    if (this.landmarks) this._drawHandSkeleton();

    const noHand = this.gestureId < 0;
    const labelH = 36;
    fill(0, 0, 0, 170); noStroke(); rect(HT_X, HT_Y + HT_H + 2, HT_W, labelH, 3);
    if (!noHand) {
      imageMode(CENTER);
      image(imgHandPose[this.gestureId],
            HT_X + HT_W / 2, HT_Y + HT_H + 2 + labelH / 2,
            labelH - 4, labelH - 4);
      imageMode(CORNER);
    } else {
      fill(150, 150, 170); textFont('monospace'); textSize(13); textAlign(CENTER, CENTER);
      text(this.gesture, HT_X + HT_W / 2, HT_Y + HT_H + 2 + labelH / 2);
    }
  },

  _drawHandSkeleton() {
    const C = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
               [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
               [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
    const lm = this.landmarks;
    const X  = i => HT_X + (1 - lm[i].x) * HT_W;
    const Y  = i => HT_Y + lm[i].y * HT_H;

    stroke(60, 180, 255, 200); strokeWeight(1.5);
    for (const [a, b] of C) line(X(a), Y(a), X(b), Y(b));
    noStroke(); fill(255, 220, 50);
    for (let i = 0; i < lm.length; i++) circle(X(i), Y(i), 6);
  },
};


// ════════════════════════════════════════════════════════════════════════════
// § 4.5  AimStabilizer — 조준점 안정화 파이프라인
//
//   파이프라인 (매 프레임 drawBattle() 에서 update() 호출):
//     HandTracker.handPos (raw)
//     → ① 유효 영역 보정   (VALID_MARGIN)
//     → ② 이동 평균 스무딩 (SMOOTH_FRAMES)
//     → ③ Dead Zone        (DEAD_ZONE_PX)
//     → ④ 속도 제한        (MAX_SPEED_PX)
//     → ⑤ 끊김 유지·페이드 (GRACE_FRAMES / FADE_FRAMES)
//     → x() / y() / opacity() 출력
//
//   ▼ 튜닝 파라미터 — 수치만 바꾸면 즉시 반영
//   ─────────────────────────────────────────────────────────────────────────
//   SMOOTH_FRAMES   이동 평균 프레임 수               기본 6    (5 ~ 10)
//   DEAD_ZONE_PX    Dead Zone 반경 (픽셀)             기본 15   (10 ~ 25)
//   MAX_SPEED_PX    프레임당 최대 이동 (픽셀)         기본 25   (15 ~ 40)
//   GRACE_FRAMES    끊김 유지 프레임  (~200ms @60fps) 기본 12   (6 ~ 24)
//   FADE_FRAMES     페이드 아웃 프레임 (~500ms)       기본 30   (15 ~ 60)
//   VALID_MARGIN    유효 영역 여백 (정규화 0~1)        기본 0.12 (0.05 ~ 0.20)
// ════════════════════════════════════════════════════════════════════════════
const AimStabilizer = (() => {
  // ── 튜닝 파라미터 ──────────────────────────────────────────────────────
  // ▼ 흔들림 보정 비활성화 (원시 좌표 그대로 사용)
  //   되돌리려면: SMOOTH_FRAMES 6 / DEAD_ZONE_PX 15 / MAX_SPEED_PX 25 / VALID_MARGIN 0.12
  const SMOOTH_FRAMES = 1;     // 이동 평균 off (1프레임 = 원시값)
  const DEAD_ZONE_PX  = 0;     // Dead Zone off
  const MAX_SPEED_PX  = 99999; // 속도 제한 off
  const GRACE_FRAMES  = 12;    // 끊김 유지 (표시 안정성 — 유지)
  const FADE_FRAMES   = 30;    // 페이드 아웃 (표시 안정성 — 유지)
  const VALID_MARGIN  = 0;     // 유효 영역 보정 off

  let _buf       = [];             // 스무딩 버퍼 [{x,y}] (정규화 0~1)
  let _outX      = 0.5;            // 속도 제한 적용 후 최종 x 좌표
  let _outY      = 0.5;            // 속도 제한 적용 후 최종 y 좌표
  let _lostTimer = 999;            // 초기 = 비표시 상태
  let _prevTrack = false;          // 직전 프레임 추적 여부

  return {
    // drawBattle() 최상단에서 매 프레임 호출
    update() {
      const tracking = HandTracker.landmarks !== null;

      // ── 추적 끊김 처리 ─────────────────────────────────────────────
      if (!tracking) {
        if (_prevTrack) _lostTimer = 0; // 방금 끊긴 첫 프레임
        else            _lostTimer++;   // 끊긴 상태 지속 중
        _prevTrack = false;
        return;
      }

      // ── 추적 복귀: 버퍼 초기화(점프 방지) ─────────────────────────
      if (!_prevTrack) _buf = [];
      _prevTrack = true;
      _lostTimer = 0;

      const raw = HandTracker.handPos;

      // ① 유효 영역 보정 ──────────────────────────────────────────────
      //   calibrated 범위의 가장자리 VALID_MARGIN 을 클립 후 0~1 재매핑
      const m  = VALID_MARGIN;
      const nx = map(constrain(raw.x, m, 1 - m), m, 1 - m, 0, 1);
      const ny = map(constrain(raw.y, m, 1 - m), m, 1 - m, 0, 1);

      // ② 이동 평균 스무딩 ─────────────────────────────────────────────
      _buf.push({ x: nx, y: ny });
      if (_buf.length > SMOOTH_FRAMES) _buf.shift();
      const avgX = _buf.reduce((s, p) => s + p.x, 0) / _buf.length;
      const avgY = _buf.reduce((s, p) => s + p.y, 0) / _buf.length;

      // ③ Dead Zone — 스무딩 후에도 미세 떨림이 남으면 무시 ───────────
      const dx = avgX * CANVAS_W - _outX * CANVAS_W;
      const dy = avgY * CANVAS_H - _outY * CANVAS_H;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < DEAD_ZONE_PX) return;

      // ④ 속도 제한 — 순간 튐 방지 ────────────────────────────────────
      const ratio = d > MAX_SPEED_PX ? MAX_SPEED_PX / d : 1;
      _outX += (dx * ratio) / CANVAS_W;
      _outY += (dy * ratio) / CANVAS_H;
    },

    // 조준점을 화면에 표시할지 여부 (Grace + Fade 반영)
    isVisible: () => _lostTimer < GRACE_FRAMES + FADE_FRAMES,

    // 투명도 배수 (1.0 = 불투명, 0.0 = 완전 투명)
    opacity: () => _lostTimer <= GRACE_FRAMES
               ? 1.0
               : Math.max(0, 1 - (_lostTimer - GRACE_FRAMES) / FADE_FRAMES),

    // 최종 조준점 정규화 좌표 (0~1)
    x: () => _outX,
    y: () => _outY,
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 4.6  ProjectileManager — 방어 화면 투사체 시스템
//
//   5개의 enemy1_attack이 회전하며 접근. 조준 2초 유지 시 레이저+폭발 파괴.
//   5초 후 플레이어 도달 → 20 데미지. 5개 전부 파괴 → 방어 성공.
//
//   ▼ 튜닝 파라미터
//   PROJ_COUNT    투사체 수                       기본 5
//   PROJ_DELAYS   각 투사체 출발 딜레이(프레임)   기본 [0,60,120,180,240]
//   PROJ_DURATION 출발→도착 이동 프레임           기본 300 (~5초)
//   START_SIZE    초기 크기(px)                   기본 40
//   MAX_SIZE      도착 시 크기(px)                기본 220
//   ROT_SPEED     회전 속도(라디안/프레임)         기본 0.06
//   HIT_HOLD      파괴 조준 유지 프레임(0.8초)     기본 48
//   WARN_FRAMES   피격 전조 시작 프레임(1초 전)     기본 60
//   EXPLODE_SHOW  폭발 표시 프레임 (~0.2초)        기본 12
//   FADE_FRAMES   페이드 아웃 프레임               기본 18
//   HIT_DAMAGE    플레이어 명중 데미지             기본 20
// ════════════════════════════════════════════════════════════════════════════
const ProjectileManager = (() => {
  const PROJ_COUNT    = 5;
  const PROJ_DELAYS   = [0, 60, 120, 180, 240]; // 1초 간격 스태거
  const PROJ_DURATION = 300;  // 5초 이동 시간 (도달 = 데미지)
  const START_SIZE    = 40;
  const MAX_SIZE      = 220;
  const ROT_SPEED     = 0.07;
  const HIT_HOLD      = 48;  // 0.8초 유지 필요
  const WARN_FRAMES   = 60;  // 피격 1초 전부터 위험 전조
  const EXPLODE_SHOW  = 12;
  const FADE_FRAMES   = 18;
  const HIT_DAMAGE    = 15; // 적1 피해량 (기존 20 → 15)
  const PLAYER_X      = 290;
  const PLAYER_Y      = 525;

  let _projs      = [];
  let _pendingDmg = 0; // 플레이어에게 적중된 누적 데미지

  // 스폰 위치: 화면 안쪽, 플레이어와 일정 거리 이상
  function _spawnPos() {
    let x, y, tries = 0;
    do {
      x = random(180, 1060);
      y = random(70, 580);
      tries++;
    } while (dist(x, y, PLAYER_X, PLAYER_Y) < 280 && tries < 60);
    return { x, y };
  }

  // 목표 위치: 스폰 지점과 일정 거리 이상 떨어진 무작위 지점
  //   (방향이 제각각 다르게 보이도록 스폰에서 멀리 떨어뜨림)
  function _targetPos(spawnX, spawnY) {
    let x, y, tries = 0;
    do {
      x = random(140, 1100);
      y = random(60, 650);
      tries++;
    } while (dist(x, y, spawnX, spawnY) < 420 && tries < 60);
    return { x, y };
  }

  // 노랑-치즈(주황) 혼합 레이저 글로우
  function _drawLaser(x0, y0, x1, y1, alpha) {
    const a = constrain(alpha, 0, 255);
    stroke(255, 165,   0, a * 0.30); strokeWeight(32); line(x0, y0, x1, y1);
    stroke(255, 190,  20, a * 0.45); strokeWeight(18); line(x0, y0, x1, y1);
    stroke(255, 240,  50, a * 0.70); strokeWeight(9);  line(x0, y0, x1, y1);
    stroke(255, 255, 160, a * 0.88); strokeWeight(4);  line(x0, y0, x1, y1);
    stroke(255, 255, 255, a);        strokeWeight(1.5); line(x0, y0, x1, y1);
    noStroke();
  }

  return {
    init() {
      _pendingDmg = 0;
      _projs = Array.from({ length: PROJ_COUNT }, (_, i) => {
        const sp  = _spawnPos();
        const tg  = _targetPos(sp.x, sp.y);
        const dir = random() < 0.5 ? 1 : -1;
        return {
          spawnX:       sp.x, spawnY: sp.y,
          targetX:      tg.x, targetY: tg.y,
          x:            sp.x, y: sp.y,
          delay:        PROJ_DELAYS[i],
          progress:     0,
          size:         START_SIZE,
          rotation:     random(TWO_PI),
          rotSpeed:     ROT_SPEED * dir,
          holdTimer:    0,
          explTimer:    0,
          fadeAlpha:    255,
          laserEndX:    0, laserEndY: 0,
          wasDestroyed: false, // 플레이어가 파괴한 경우 true
          state:        'waiting', // waiting|flying|exploding|fading|done
        };
      });
    },

    update() {
      const aimed = AimStabilizer.isVisible();
      const cx    = aimed ? AimStabilizer.x() * CANVAS_W : -9999;
      const cy    = aimed ? AimStabilizer.y() * CANVAS_H : -9999;

      for (const p of _projs) {
        if (p.state === 'done') continue;

        // ── 대기 ─────────────────────────────────────────────────────────
        if (p.state === 'waiting') {
          if (p.delay-- <= 0) p.state = 'flying';
          continue;
        }

        // ── 이동 + 회전 (비선형: 후반 가속) ─────────────────────────────
        if (p.state === 'flying') {
          p.progress += 1 / PROJ_DURATION;

          // ease-in: 끝으로 갈수록 빨라져 압박감 증가
          const ep = min(1, p.progress);
          const vis = 1 - pow(1 - ep, 1.5);       // 위치용 가속 커브
          const siz = pow(ep, 0.55);               // 사이즈: 초반 빠르게 성장
          p.x    = lerp(p.spawnX, p.targetX, vis); // 무작위 목표 지점을 향해 이동
          p.y    = lerp(p.spawnY, p.targetY, vis);
          p.size = lerp(START_SIZE, MAX_SIZE, siz);
          p.rotation += p.rotSpeed;

          // 조준점 유지 판정 (이미 파괴 중인 경우 스킵)
          const hit = dist(cx, cy, p.x, p.y) < p.size / 2 + 22;
          if (hit) {
            if (++p.holdTimer >= HIT_HOLD) {
              // 파괴 확정 — 제거 우선
              p.wasDestroyed = true;
              p.laserEndX    = p.x;
              p.laserEndY    = p.y;
              p.state        = 'exploding';
              p.explTimer    = EXPLODE_SHOW;
              if (sndExplosion) { sndExplosion.setVolume(0.7); sndExplosion.play(); }
            }
          } else {
            p.holdTimer = 0; // 조준 벗어나면 진행도 초기화
          }

          // 플레이어 도달 → 데미지 (파괴 처리 중이면 제거 우선)
          if (ep >= 1 && p.state === 'flying') {
            _pendingDmg += HIT_DAMAGE;
            p.state = 'done';
          }
          continue;
        }

        // ── 폭발 표시 ────────────────────────────────────────────────────
        if (p.state === 'exploding') {
          if (--p.explTimer <= 0) p.state = 'fading';
          continue;
        }

        // ── 페이드 아웃 ──────────────────────────────────────────────────
        if (p.state === 'fading') {
          p.fadeAlpha -= 255 / FADE_FRAMES;
          if (p.fadeAlpha <= 0) p.state = 'done';
          continue;
        }
      }
    },

    draw() {
      const lx0 = CANVAS_W / 2;
      const ly0 = CANVAS_H;

      // ① 레이저 (폭발 이미지 아래)
      for (const p of _projs) {
        if (p.state === 'exploding') {
          _drawLaser(lx0, ly0, p.laserEndX, p.laserEndY, 255);
        } else if (p.state === 'fading') {
          _drawLaser(lx0, ly0, p.laserEndX, p.laserEndY, max(0, p.fadeAlpha));
        }
      }

      // ② 투사체 · 폭발 이미지 + 조준 홀드 게이지
      for (const p of _projs) {
        if (p.state === 'done' || p.state === 'waiting') continue;

        if (p.state === 'flying') {
          // 피격 전조: 도달 1초 전부터 부드러운 빨간 점멸
          const remain = (1 - min(1, p.progress)) * PROJ_DURATION;
          let warnAmt = 0;
          if (remain <= WARN_FRAMES) {
            const prox = 1 - remain / WARN_FRAMES;         // 0→1 (도달 임박)
            const blink = 0.5 + 0.5 * sin(frameCount * 0.35); // 부드러운 점멸
            warnAmt = prox * blink;                          // 0~1
          }

          // 투사체 이미지 (회전 + 전조 시 빨간 틴트)
          push();
          translate(p.x, p.y);
          rotate(p.rotation);
          imageMode(CENTER);
          if (warnAmt > 0) {
            // 흰색 230 → 붉은색(255,90,90) 으로 부드럽게 보간
            tint(255, lerp(230, 90, warnAmt), lerp(230, 90, warnAmt), 230);
          } else {
            tint(255, 230);
          }
          image(imgEnemy1Attack, 0, 0, p.size, p.size);
          noTint();
          imageMode(CORNER);
          pop();

          // 전조 외곽 붉은 글로우 링 (강하지 않게)
          if (warnAmt > 0) {
            noFill();
            stroke(255, 60, 60, 150 * warnAmt); strokeWeight(4);
            ellipse(p.x, p.y, p.size * 1.15, p.size * 1.15);
            noStroke();
          }

          // 조준 홀드 게이지 (원형 진행 표시 — 크기 축소)
          if (p.holdTimer > 0) {
            const frac = p.holdTimer / HIT_HOLD;
            const ringD = p.size * 1.15; // 1.35 → 1.15 로 축소
            noFill();
            // 배경 링
            stroke(80, 80, 120, 130); strokeWeight(4);
            ellipse(p.x, p.y, ringD, ringD);
            // 진행 arc (노란색)
            stroke(255, 240, 60, 230); strokeWeight(4);
            arc(p.x, p.y, ringD, ringD,
                -HALF_PI, -HALF_PI + TWO_PI * frac, OPEN);
            noStroke();
          }
        } else if (p.state === 'exploding') {
          imageMode(CENTER);
          image(imgExplode, p.x, p.y, MAX_SIZE * 1.6, MAX_SIZE * 1.6);
          imageMode(CORNER);
        } else if (p.state === 'fading') {
          imageMode(CENTER);
          tint(255, max(0, p.fadeAlpha));
          image(imgExplode, p.x, p.y, MAX_SIZE * 1.6, MAX_SIZE * 1.6);
          noTint();
          imageMode(CORNER);
        }
      }
    },

    // 누적 데미지 반환 후 초기화
    takeDamage() { const d = _pendingDmg; _pendingDmg = 0; return d; },

    // 모든 투사체가 처리됐는지 (done)
    isAllDone: () => _projs.length > 0 && _projs.every(p => p.state === 'done'),

    // 모두 플레이어가 파괴했는지 (피격 없음)
    isAllDestroyedByPlayer: () => _projs.length > 0 && _projs.every(p => p.wasDestroyed),

    // 플레이어가 파괴한 수
    destroyedCount: () => _projs.filter(p => p.wasDestroyed).length,

    reset() { _projs = []; _pendingDmg = 0; },
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 4.7  BarrageManager — 적2 탄막 회피 방어 페이즈 (촉수 내려치기)
//
//   ~15초 동안 화면 임의 위치에 세로 기둥형 촉수 공격이 겹쳐가며 반복된다.
//   각 공격: 붉은 경고(점멸) → 촉수 애니메이션(판정+폭발음) → 종료.
//   여러 공격이 동시에 진행되며(최대 MAX_ACTIVE), 새 공격의 경고는 이전
//   공격의 촉수 애니메이션 도중에 시작된다 → 겹침으로 긴장감 상승.
//   오른쪽 기둥은 촉수 애니메이션을 좌우 반전해 바깥→안쪽 내려치는 느낌.
//
//   ▼ 튜닝 파라미터
//   TOTAL_DURATION  전체 지속 프레임(15초)        기본 900
//   WARN_TIME       경고 점멸 프레임(0.55초)       기본 33
//   ANIM_FRAME_DUR  촉수 프레임당 유지 프레임      기본 4
//   ANIM_FRAMES     촉수 프레임 수                 7 (0~6)
//   SPAWN_INTERVAL  새 공격 경고 시작 간격         기본 36
//   MAX_ACTIVE      동시 활성 공격 수 제한         기본 3
//   COL_W           공격 폭 (화면 너비 25%)        CANVAS_W * 0.25
//   HIT_DAMAGE      피격 데미지                    기본 20
//   PILLAR_TOP      기둥 상단 y (적2 하단 위치)    444
// ════════════════════════════════════════════════════════════════════════════
const BarrageManager = (() => {
  const TOTAL_DURATION = 900;
  const WARN_TIME      = 33;
  const ANIM_FRAME_DUR = 2;  // 애니메이션 2배 빠르게
  const ANIM_FRAMES    = 7;
  const FIRE_TIME      = 28; // 표시 지속(고정) — 빠르게 재생 후 마지막 프레임 유지
  const SPAWN_INTERVAL = 36;
  const MAX_ACTIVE     = 3;
  const COL_W          = CANVAS_W * 0.25;
  const HIT_DAMAGE     = 15; // 적2 피해량 (기존 20 → 15)
  const PILLAR_TOP     = 444; // 경고/판정 기둥 상단 (적2 하단)
  const ENEMY_Y        = 113; // 촉수 이미지 시작 위치 (적2 중심 313에서 200 위로)

  let _totalTimer = 0;
  let _spawnTimer = 0;
  let _attacks    = []; // [{ x, flip, phase, timer, anim }]
  let _pendingDmg = 0;

  function _spawnAttack() {
    const x = random(COL_W / 2, CANVAS_W - COL_W / 2); // 기둥 중심 x
    return {
      x,
      flip:  x > CANVAS_W / 2, // 오른쪽이면 촉수 좌우 반전
      phase: 'warning',        // warning | firing | done
      timer: WARN_TIME,
      anim:  0,
    };
  }

  return {
    init() {
      _totalTimer = TOTAL_DURATION;
      _spawnTimer = SPAWN_INTERVAL;
      _pendingDmg = 0;
      _attacks    = [_spawnAttack()];
      HandTracker.useRawAim = true; // 적2 전투: 손 인식 보정 끄기 (원시 좌표 사용)
    },

    update() {
      if (_totalTimer > 0) _totalTimer--;

      // ── 새 공격 스폰 (시간 남고 동시 활성 수 제한 이하일 때) ───────────
      if (_totalTimer > 0 && --_spawnTimer <= 0) {
        if (_attacks.length < MAX_ACTIVE) _attacks.push(_spawnAttack());
        _spawnTimer = SPAWN_INTERVAL;
      }

      for (const a of _attacks) {
        if (a.phase === 'warning') {
          if (--a.timer <= 0) {
            // ── 발동: 판정 + 폭발음 (촉수 애니메이션 시작) ──────────
            a.phase = 'firing';
            a.timer = FIRE_TIME;
            a.anim  = 0;
            if (sndExplosion) { sndExplosion.setVolume(0.7); sndExplosion.play(); }

            const aimed = AimStabilizer.isVisible();
            const cx    = aimed ? AimStabilizer.x() * CANVAS_W : -9999;
            const left  = a.x - COL_W / 2;
            const right = a.x + COL_W / 2;
            if (aimed && cx >= left && cx <= right) _pendingDmg += HIT_DAMAGE;
          }
        } else if (a.phase === 'firing') {
          a.timer--;
          a.anim = min(ANIM_FRAMES - 1, floor((FIRE_TIME - a.timer) / ANIM_FRAME_DUR));
          if (a.timer <= 0) a.phase = 'done';
        }
      }

      // 완료된 공격 제거 (배열 안전 처리)
      _attacks = _attacks.filter(a => a.phase !== 'done');
    },

    draw() {
      for (const a of _attacks) {
        const left = a.x - COL_W / 2;
        const top  = PILLAR_TOP;
        const h    = CANVAS_H - top;

        if (a.phase === 'warning') {
          // 붉은 경고 점멸 (세로 전체)
          const blink = 0.35 + 0.4 * abs(sin(frameCount * 0.32));
          noStroke();
          fill(255, 40, 40, 110 * blink);
          rect(left, 0, COL_W, CANVAS_H);
          stroke(255, 70, 70, 220 * blink); strokeWeight(3); noFill();
          rect(left, 0, COL_W, CANVAS_H);
          noStroke();
        } else if (a.phase === 'firing') {
          // 발동 첫 프레임 흰 섬광
          if (a.anim <= 1) {
            noStroke();
            fill(255, 255, 255, 150);
            rect(left, top, COL_W, h);
          }
          // 촉수 애니메이션 — 적2와 같은 y(ENEMY_Y)에서 시작 (오른쪽이면 좌우 반전)
          const img  = imgEnemy2Attack[a.anim];
          const tTop = ENEMY_Y;
          const tH   = CANVAS_H - tTop;
          if (img) {
            push();
            imageMode(CORNER);
            if (a.flip) {
              translate(left + COL_W, tTop);
              scale(-1, 1);
              image(img, 0, 0, COL_W, tH);
            } else {
              image(img, left, tTop, COL_W, tH);
            }
            pop();
          }
        }
      }
    },

    takeDamage() { const d = _pendingDmg; _pendingDmg = 0; return d; },
    isDone:      () => _totalTimer <= 0 && _attacks.length === 0,
    reset()      {
      _attacks = []; _totalTimer = 0; _spawnTimer = 0; _pendingDmg = 0;
      HandTracker.useRawAim = false; // 보정 복구
    },
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 4.8  RingBarrageManager — 적3 수축형 원형 탄막 (2페이즈 생존 회피)
//
//   [1페이즈] 가장자리에서 생성된 원형(고리) 탄막이 중앙으로 수축. 각 고리의
//             빈 구간(안전 통로)으로 빠져나가야 생존한다.
//   [2페이즈] 1페이즈 종료 시 짧은 전환 섬광 후 진입. 원형 탄막 유지 + 랜덤
//             X 위치 세로 레이저(붉은 경고선 → 발사)가 추가된다.
//   피격 판정은 조준점(에임) 기준 — 고리 벽/레이저에 닿으면 -20 (쿨다운 있음).
//
//   ▼ 튜닝 파라미터
//   TOTAL_DURATION  전체 지속 프레임(15초)         기본 900
//   RING_INTERVAL   새 고리 생성 간격              기본 120 (2초)
//   MAX_RINGS       동시 활성 고리 수 제한         기본 4
//   START_RADIUS    생성 반지름(화면 밖)           기본 820
//   MIN_RADIUS      소멸 반지름(중앙)              기본 46
//   CONTRACT_SPEED  수축 속도(px/frame)            기본 2.0
//   WALL_R          고리 벽 두께(피격 반경)         기본 20
//   GAP_HALF        안전 통로 각 반폭(라디안)       기본 0.42 (~24°)
//   BULLET_COUNT    고리당 탄막 개수(시각)          기본 40
//   HIT_DAMAGE      피격 데미지                    기본 20
//   HIT_COOLDOWN    피격 쿨다운 프레임             기본 30
// ════════════════════════════════════════════════════════════════════════════
const RingBarrageManager = (() => {
  const PHASE_DURATION = 780;
  const RING_INTERVAL  = 120;
  const MAX_RINGS      = 4;
  const START_RADIUS   = 820;
  const MIN_RADIUS     = 46;
  const CONTRACT_SPEED = 2.0;
  const WALL_R         = 20;
  const GAP_HALF       = 0.42;
  const BULLET_COUNT   = 40;
  const HIT_DAMAGE     = 15; // 적3 피해량 (기존 20 → 15)
  const HIT_COOLDOWN   = 30;
  const CX             = CANVAS_W / 2; // 수축 중심
  const CY             = CANVAS_H / 2;
  // 레이저 (2페이즈 전용)
  const LASER_W        = 70;
  const LASER_WARN     = 45;
  const LASER_FIRE     = 30;
  const LASER_INTERVAL = 80;
  const MAX_LASERS     = 2;
  const TRANS_FLASH    = 36; // 페이즈 전환 섬광 프레임

  let _phase      = 1;
  let _totalTimer = 0;
  let _spawnTimer = 0;
  let _rings      = []; // [{ radius, gapAngle, rotDir }]
  let _lasers     = []; // [{ x, phase:'warning'|'firing', timer }]
  let _laserTimer = 0;
  let _transTimer = 0;
  let _pendingDmg = 0;
  let _hitCd      = 0;

  function _spawnRing() {
    return {
      radius:   START_RADIUS,
      gapAngle: random(TWO_PI),
      rotDir:   random() < 0.5 ? 1 : -1, // 회전 방향 (좌/우 무작위)
    };
  }

  function _spawnLaser() {
    return {
      x:     random(LASER_W / 2, CANVAS_W - LASER_W / 2),
      phase: 'warning',
      timer: LASER_WARN,
    };
  }

  // 각도 차이를 -PI~PI 범위로 정규화
  function _angDiff(a, b) {
    let d = (a - b) % TWO_PI;
    if (d >  PI) d -= TWO_PI;
    if (d < -PI) d += TWO_PI;
    return d;
  }

  function _startPhase(p) {
    _phase      = p;
    _totalTimer = PHASE_DURATION;
    _spawnTimer = RING_INTERVAL;
    _laserTimer = LASER_INTERVAL;
    if (p === 2) _transTimer = TRANS_FLASH;
  }

  return {
    init() {
      _pendingDmg = 0;
      _hitCd      = 0;
      _rings      = [_spawnRing()];
      _lasers     = [];
      _transTimer = 0;
      _startPhase(1);
    },

    update() {
      if (_totalTimer > 0) _totalTimer--;
      if (_hitCd > 0) _hitCd--;
      if (_transTimer > 0) _transTimer--;

      // 1페이즈 종료 → 2페이즈 자동 진입 (고리 유지, 짧은 전환 섬광)
      if (_phase === 1 && _totalTimer <= 0) _startPhase(2);

      // 진행도(0→1): 후반일수록 빠르고 회전이 강해짐. 2페이즈는 기본 가속.
      const frac      = constrain((PHASE_DURATION - _totalTimer) / PHASE_DURATION, 0, 1);
      const phaseBase = _phase === 2 ? 0.4 : 0;
      const speedMul  = 1 + phaseBase + 1.2 * frac; // 수축 속도
      const rotSpeed  = 0.013 * frac;               // 통로 회전

      // ── 원형 고리 ────────────────────────────────────────────────────
      if (_totalTimer > 0 && --_spawnTimer <= 0) {
        if (_rings.length < MAX_RINGS) _rings.push(_spawnRing());
        _spawnTimer = RING_INTERVAL;
      }
      for (const r of _rings) {
        r.radius   -= CONTRACT_SPEED * speedMul;
        r.gapAngle += rotSpeed * r.rotDir;
      }
      _rings = _rings.filter(r => r.radius > MIN_RADIUS);

      // ── 세로 레이저 (2페이즈 전용) ───────────────────────────────────
      if (_phase === 2) {
        if (_totalTimer > 0 && --_laserTimer <= 0) {
          if (_lasers.length < MAX_LASERS) _lasers.push(_spawnLaser());
          _laserTimer = LASER_INTERVAL;
        }
        for (const L of _lasers) {
          if (--L.timer <= 0) {
            if (L.phase === 'warning') {
              L.phase = 'firing';
              L.timer = LASER_FIRE;
              if (sndRocket) { sndRocket.setVolume(0.5); sndRocket.play(); } // 레이저 발사음
            } else {
              L.phase = 'done';
            }
          }
        }
        _lasers = _lasers.filter(L => L.phase !== 'done');
      }

      // ── 피격 판정 (조준점 기준, 고리 + 레이저 공용 쿨다운) ───────────
      if (_hitCd <= 0 && AimStabilizer.isVisible()) {
        const ax = AimStabilizer.x() * CANVAS_W;
        const ay = AimStabilizer.y() * CANVAS_H;
        let hit = false;

        // 고리 벽
        const dr = dist(ax, ay, CX, CY);
        const th = atan2(ay - CY, ax - CX);
        for (const r of _rings) {
          if (abs(dr - r.radius) < WALL_R && abs(_angDiff(th, r.gapAngle)) > GAP_HALF) {
            hit = true; break;
          }
        }
        // 레이저 빔 (발사 중)
        if (!hit) {
          for (const L of _lasers) {
            if (L.phase === 'firing' && abs(ax - L.x) < LASER_W / 2) { hit = true; break; }
          }
        }

        if (hit) { _pendingDmg += HIT_DAMAGE; _hitCd = HIT_COOLDOWN; }
      }
    },

    draw() {
      noStroke();

      // ── 세로 레이저 (고리 아래에 배경처럼) ───────────────────────────
      for (const L of _lasers) {
        if (L.phase === 'warning') {
          const blink = 0.35 + 0.4 * abs(sin(frameCount * 0.4));
          noStroke();
          fill(255, 40, 40, 90 * blink);
          rect(L.x - LASER_W / 2, 0, LASER_W, CANVAS_H);
          stroke(255, 60, 60, 230 * blink); strokeWeight(3);
          line(L.x, 0, L.x, CANVAS_H);
          noStroke();
        } else { // firing — 밝은 세로 빔
          const a = L.timer / LASER_FIRE;
          noStroke();
          fill(255, 170, 40, 120 + 100 * a);
          rect(L.x - LASER_W / 2, 0, LASER_W, CANVAS_H);
          fill(255, 240, 120, 150 + 80 * a);
          rect(L.x - LASER_W * 0.28, 0, LASER_W * 0.56, CANVAS_H);
          fill(255, 255, 255, 180 * a);
          rect(L.x - LASER_W * 0.10, 0, LASER_W * 0.20, CANVAS_H);
        }
      }

      // ── 원형 고리 탄막 ───────────────────────────────────────────────
      for (const r of _rings) {
        const closeFrac = 1 - (r.radius - MIN_RADIUS) / (START_RADIUS - MIN_RADIUS);
        for (let i = 0; i < BULLET_COUNT; i++) {
          const ang = (TWO_PI / BULLET_COUNT) * i;
          if (abs(_angDiff(ang, r.gapAngle)) <= GAP_HALF) continue; // 안전 통로
          const bx = CX + cos(ang) * r.radius;
          const by = CY + sin(ang) * r.radius;
          fill(255, 120 - 60 * closeFrac, 90 - 50 * closeFrac, 235);
          circle(bx, by, WALL_R * 1.5);
          fill(255, 220, 180, 150);
          circle(bx, by, WALL_R * 0.7);
        }
      }

      // ── 페이즈 전환 섬광 ─────────────────────────────────────────────
      if (_transTimer > 0) {
        const a = _transTimer / TRANS_FLASH;
        noStroke();
        fill(255, 255, 255, 160 * a);
        rect(0, 0, CANVAS_W, CANVAS_H);
      }
    },

    phase:       () => _phase,
    takeDamage() { const d = _pendingDmg; _pendingDmg = 0; return d; },
    isDone:      () => _phase === 2 && _totalTimer <= 0 && _rings.length === 0 && _lasers.length === 0,
    reset()      {
      _phase = 1; _totalTimer = 0; _spawnTimer = 0; _laserTimer = 0; _transTimer = 0;
      _rings = []; _lasers = []; _pendingDmg = 0; _hitCd = 0;
    },
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 4.9  BossManager — Stage2 실시간 복합 보스전
//
//   플레이어는 조준점(에임)으로만 존재. 조준점을 향해 기관총처럼 레이저를
//   연속 발사해 보스 본체에 누적 딜을 넣는다. 동시에 보스의 복합 공격을 회피.
//     · 패턴 A : 적1식 투사체 — 버스트(난사→휴식 반복), 회피/조준 유지로 파괴
//     · 패턴 B : 보스 세로 레이저 — 투사체 난사 중엔 드물게, 휴식 중엔 잦게
//     · 패턴 C : (체력 30% 이하 최종 페이즈) 적2식 촉수 범위 공격
//   플레이어 레이저가 보스 명중 중이면 damage2 루프 + 작은 스파크 이펙트.
//   승리 = 보스 HP 0 / 패배 = 플레이어 HP 0
//
//   ▼ 주요 튜닝 파라미터
//   BOSS_MAX_HP    보스 체력                      기본 1300 (기존 2600의 50%)
//   PLAYER_DMG     조준 명중 1발 데미지            기본 7
//   FIRE_INTERVAL  플레이어 자동 발사 간격         기본 3
//   HIT_DAMAGE     보스 공격 피격 데미지           기본 15
//   ENRAGE_FRAC    최종 페이즈 진입 체력 비율       기본 0.30
// ════════════════════════════════════════════════════════════════════════════
const BossManager = (() => {
  // 보스 본체
  const BOSS_MAX_HP  = 2600; // 1300의 2배
  const BOSS_X       = 640, BOSS_Y = 235;
  const BOSS_SIZE    = 360;
  const BOSS_HIT_R   = 150;
  // 플레이어 지속 레이저
  const ORIGIN       = { x: CANVAS_W / 2, y: CANVAS_H + 40 };
  const FIRE_INTERVAL = 3;
  const PLAYER_DMG    = 7;
  // 플레이어 피격
  const HIT_DAMAGE    = 15; // 레이저/촉수 피격 데미지
  const PROJ_DAMAGE   = 10; // 투사체 피격 데미지 (보스전 한정 -5)
  const HIT_COOLDOWN  = 24;
  const ENRAGE_FRAC   = 0.40; // 체력 40% 이하 → 최종 페이즈
  const INTRO_DELAY   = 60;   // 전투 시작 전 대기(1초) — 첫 프레임 렉 회피
  // 패턴 A: 적1식 투사체 (버스트: 난사 → 휴식 반복)
  const MAX_PROJS       = 4;   // 동시 최대 (기존 8 → 4)
  const PROJ_DURATION   = 150;
  const PROJ_START      = 44, PROJ_MAX = 150;
  const PROJ_DESTROY    = 4;  // 조준 유지 파괴 프레임 (기존 16 → 4, 0.2초 단축)
  const PROJ_BURST_DUR  = 90;  // 난사 지속
  const PROJ_REST_DUR   = 170; // 휴식 지속 (더 길게)
  const PROJ_BURST_FIRE = 26;  // 난사 중 발사 간격 (기존 11 → 26, 텀 증가)
  // 패턴 B: 보스 세로 레이저 (투사체 상태 따라 빈도 동적)
  const BLASER_W = 95, BLASER_WARN = 55, BLASER_FIRE = 36;
  const MAX_BLASERS         = 2;
  const BLASER_INT_BURST    = 187; // 투사체 난사 중 = 레이저 드물게 (빈도 +50%)
  const BLASER_INT_REST     = 57;  // 투사체 휴식 중 = 레이저 잦게 (빈도 +50%)
  // 패턴 C: 적2식 촉수 (광폭화)
  const TENT_W       = CANVAS_W * 0.25;
  const TENT_INTERVAL = 80;
  const TENT_WARN    = 33, TENT_FRAME_DUR = 2, TENT_FRAMES = 7; // 애니메이션 2배 빠르게
  const TENT_FIRE    = 28; // 표시 지속(고정) — 빠르게 재생 후 마지막 프레임 유지
  const MAX_TENT     = 2;
  const TENT_IMG_TOP = 60;   // 촉수 이미지 상단
  const TENT_HIT_TOP = 360;  // 촉수 판정 기둥 상단
  // 타격 스파크
  const MAX_SPARKS   = 14;

  let _bossHp, _playerHp, _playerMaxHp;
  let _fireCd, _hitCd, _result, _bossFlash, _enraged, _enrageFlash;
  let _projs, _projMode, _projModeTimer, _projBurstCd;
  let _blasers, _blaserCd;
  let _tents, _tentCd;
  let _sparks, _dmg2Playing;
  let _introTimer;

  function _angDiffAbs(a, b) {
    let d = (a - b) % TWO_PI;
    if (d >  PI) d -= TWO_PI;
    if (d < -PI) d += TWO_PI;
    return abs(d);
  }

  // 적1식 투사체 스폰: 보스에서 하단 임의 지점으로
  function _spawnProj() {
    return {
      sx: BOSS_X + random(-120, 120), sy: BOSS_Y + 60,
      tx: random(120, CANVAS_W - 120), ty: random(620, 920),
      progress: 0, size: PROJ_START,
      rot: random(TWO_PI), rotSpeed: (random() < 0.5 ? 1 : -1) * 0.08,
      hold: 0, state: 'flying', // flying|exploding|done
      explT: 0,
    };
  }
  function _spawnBLaser() {
    let x;
    // 70% 확률로 조준점 근처(±130px)에 생성 → 회피 압박 증가
    if (AimStabilizer.isVisible() && random() < 0.7) {
      const aimX = AimStabilizer.x() * CANVAS_W;
      x = constrain(aimX + random(-130, 130), BLASER_W / 2, CANVAS_W - BLASER_W / 2);
    } else {
      x = random(BLASER_W / 2, CANVAS_W - BLASER_W / 2);
    }
    return { x, phase: 'warning', timer: BLASER_WARN };
  }
  function _spawnTent() {
    const x = random(TENT_W / 2, CANVAS_W - TENT_W / 2);
    return { x, flip: x > CANVAS_W / 2, phase: 'warning', timer: TENT_WARN, anim: 0 };
  }

  return {
    init(playerHp) {
      _bossHp = BOSS_MAX_HP;
      _playerMaxHp = 100;
      _playerHp = playerHp ?? 100;
      _fireCd = 0; _hitCd = 0; _result = null; _bossFlash = 0;
      _enraged = false; _enrageFlash = 0;
      _projs = []; _projMode = 'burst'; _projModeTimer = PROJ_BURST_DUR; _projBurstCd = 0;
      _blasers = []; _blaserCd = BLASER_INT_BURST;
      _tents = []; _tentCd = TENT_INTERVAL;
      _sparks = []; _dmg2Playing = false;
      _introTimer = INTRO_DELAY;
    },

    update() {
      if (_result) return;
      // 전투 시작 전 1초 대기 (첫 프레임 렉 회피 — 공격/발사 없음)
      if (_introTimer > 0) { _introTimer--; return; }
      if (_hitCd > 0) _hitCd--;
      if (_bossFlash > 0) _bossFlash--;
      if (_enrageFlash > 0) _enrageFlash--;

      const aimed = AimStabilizer.isVisible();
      const ax = aimed ? AimStabilizer.x() * CANVAS_W : -9999;
      const ay = aimed ? AimStabilizer.y() * CANVAS_H : -9999;
      let incomingDmg = 0; // 이번 프레임 받을 데미지 (소스별 최대값)

      // ── 최종 페이즈 진입 (체력 30% 이하) ─────────────────────────────
      if (!_enraged && _bossHp <= BOSS_MAX_HP * ENRAGE_FRAC) {
        _enraged = true; _enrageFlash = 60; _tentCd = 30;
        if (sndBass) { sndBass.setVolume(0.3); sndBass.play(); } // 전환 연출 사운드
      }

      // ── 스파크 수명 갱신 ─────────────────────────────────────────────
      for (const s of _sparks) s.life--;
      _sparks = _sparks.filter(s => s.life > 0);

      // ── 플레이어 지속 레이저 (조준점 명중 시 보스 딜) ────────────────
      const hittingBoss = aimed && dist(ax, ay, BOSS_X, BOSS_Y) < BOSS_HIT_R;
      if (--_fireCd <= 0) {
        _fireCd = FIRE_INTERVAL;
        if (hittingBoss) {
          _bossHp = max(0, _bossHp - PLAYER_DMG);
          _bossFlash = 5;
          if (sndShoot) { sndShoot.setVolume(0.3); sndShoot.play(); } // 보스 명중음
          // 타격 스파크 생성 (작은 스파크 느낌)
          if (_sparks.length < MAX_SPARKS) {
            _sparks.push({ x: ax + random(-14, 14), y: ay + random(-14, 14),
                           life: 9, sz: random(22, 38) });
          }
          if (_bossHp <= 0) { _result = 'win'; this._stopLaserSnd(); return; }
        }
      }
      // 명중 중일 때만 damage2 루프 (겹침 없이 단일 루프)
      if (hittingBoss) {
        if (!_dmg2Playing && sndDamage2) { sndDamage2.setVolume(0.1); sndDamage2.loop(); _dmg2Playing = true; }
      } else {
        this._stopLaserSnd();
      }

      // ── 패턴 A: 적1식 투사체 (버스트: 난사 ↔ 휴식) ───────────────────
      if (--_projModeTimer <= 0) {
        if (_projMode === 'burst') { _projMode = 'rest';  _projModeTimer = PROJ_REST_DUR; }
        else                       { _projMode = 'burst'; _projModeTimer = PROJ_BURST_DUR; }
      }
      if (_projMode === 'burst' && --_projBurstCd <= 0) {
        if (_projs.length < MAX_PROJS) _projs.push(_spawnProj());
        _projBurstCd = PROJ_BURST_FIRE;
      }
      for (const p of _projs) {
        if (p.state === 'flying') {
          p.progress = min(1, p.progress + 1 / PROJ_DURATION);
          p.x   = lerp(p.sx, p.tx, p.progress);
          p.y   = lerp(p.sy, p.ty, p.progress);
          p.size = lerp(PROJ_START, PROJ_MAX, p.progress);
          p.rot += p.rotSpeed;
          // 조준 유지 시 파괴
          if (aimed && dist(ax, ay, p.x, p.y) < p.size / 2 + 18) {
            if (++p.hold >= PROJ_DESTROY) {
              p.state = 'exploding'; p.explT = 12;
              if (sndExplosion) { sndExplosion.setVolume(0.5); sndExplosion.play(); }
            }
          } else p.hold = 0;
          // 도달 → 플레이어 피격 (투사체 데미지)
          if (p.progress >= 1 && p.state === 'flying') {
            incomingDmg = max(incomingDmg, PROJ_DAMAGE);
            p.state = 'done';
          }
        } else if (p.state === 'exploding') {
          if (--p.explT <= 0) p.state = 'done';
        }
      }
      _projs = _projs.filter(p => p.state !== 'done');

      // ── 패턴 B: 보스 세로 레이저 (투사체 상태 따라 빈도 동적) ────────
      if (--_blaserCd <= 0) {
        if (_blasers.length < MAX_BLASERS) _blasers.push(_spawnBLaser());
        _blaserCd = _projMode === 'burst' ? BLASER_INT_BURST : BLASER_INT_REST;
      }
      for (const L of _blasers) {
        if (--L.timer <= 0) {
          if (L.phase === 'warning') {
            L.phase = 'firing'; L.timer = BLASER_FIRE;
            if (sndRocket) { sndRocket.setVolume(0.5); sndRocket.play(); } // 레이저 발사음
          } else L.phase = 'done';
        }
        if (L.phase === 'firing' && aimed && abs(ax - L.x) < BLASER_W / 2) incomingDmg = max(incomingDmg, HIT_DAMAGE);
      }
      _blasers = _blasers.filter(L => L.phase !== 'done');

      // ── 패턴 C: 적2식 촉수 (광폭화 전용) ─────────────────────────────
      if (_enraged) {
        if (--_tentCd <= 0) {
          if (_tents.length < MAX_TENT) _tents.push(_spawnTent());
          _tentCd = TENT_INTERVAL;
        }
        for (const t of _tents) {
          if (t.phase === 'warning') {
            if (--t.timer <= 0) {
              t.phase = 'firing'; t.timer = TENT_FIRE; t.anim = 0;
              if (sndExplosion) { sndExplosion.setVolume(0.7); sndExplosion.play(); }
              // 발동 순간 판정
              if (aimed && abs(ax - t.x) < TENT_W / 2) incomingDmg = max(incomingDmg, HIT_DAMAGE);
            }
          } else if (t.phase === 'firing') {
            t.timer--;
            t.anim = min(TENT_FRAMES - 1, floor((TENT_FIRE - t.timer) / TENT_FRAME_DUR));
            if (t.timer <= 0) t.phase = 'done';
          }
        }
        _tents = _tents.filter(t => t.phase !== 'done');
      }

      // ── 플레이어 피격 적용 (공용 쿨다운, 소스별 데미지) ──────────────
      if (incomingDmg > 0 && _hitCd <= 0) {
        _playerHp = max(0, _playerHp - incomingDmg);
        _hitCd = HIT_COOLDOWN;
        if (sndDamage) sndDamage.play();
        if (_playerHp <= 0) { _result = 'lose'; this._stopLaserSnd(); return; }
      }
    },

    _stopLaserSnd() {
      if (_dmg2Playing && sndDamage2) { sndDamage2.stop(); _dmg2Playing = false; }
    },

    draw() {
      // 배경
      imageMode(CORNER);
      image(imgCombat, 0, 0, CANVAS_W, CANVAS_H);

      // 보스 본체 (피격 시 흰 번쩍 / 광폭화 시 붉은 기운)
      imageMode(CENTER);
      const breathe = 1 + sin(frameCount * 0.04) * 0.03;
      if (_bossFlash > 0)      tint(255, 255, 255);
      else if (_enraged)       tint(255, 150, 150);
      image(imgBoss, BOSS_X, BOSS_Y, BOSS_SIZE * breathe, BOSS_SIZE * breathe);
      noTint();

      // 패턴 A: 투사체
      for (const p of _projs) {
        if (p.state === 'flying') {
          push(); translate(p.x, p.y); rotate(p.rot); imageMode(CENTER);
          // 도달 임박 시 붉은 전조
          const warn = p.progress > 0.78 ? (0.5 + 0.5 * sin(frameCount * 0.4)) : 0;
          tint(255, 230 - 140 * warn, 230 - 140 * warn, 235);
          image(imgEnemy1Attack, 0, 0, p.size, p.size);
          noTint(); pop();
          // 조준 유지 게이지
          if (p.hold > 0) {
            noFill(); stroke(255, 240, 80, 220); strokeWeight(3);
            const fr = p.hold / PROJ_DESTROY;
            arc(p.x, p.y, p.size * 1.2, p.size * 1.2, -HALF_PI, -HALF_PI + TWO_PI * fr);
            noStroke();
          }
        } else if (p.state === 'exploding') {
          imageMode(CENTER); image(imgExplode, p.x, p.y, PROJ_MAX * 1.5, PROJ_MAX * 1.5);
        }
      }

      // 패턴 B: 보스 레이저
      noStroke();
      for (const L of _blasers) {
        if (L.phase === 'warning') {
          const bl = 0.35 + 0.4 * abs(sin(frameCount * 0.4));
          fill(255, 40, 40, 90 * bl); rect(L.x - BLASER_W / 2, 0, BLASER_W, CANVAS_H);
          stroke(255, 60, 60, 230 * bl); strokeWeight(3); line(L.x, 0, L.x, CANVAS_H); noStroke();
        } else {
          const a = L.timer / BLASER_FIRE;
          fill(255, 120, 40, 130 + 100 * a); rect(L.x - BLASER_W / 2, 0, BLASER_W, CANVAS_H);
          fill(255, 230, 110, 150 + 80 * a); rect(L.x - BLASER_W * 0.28, 0, BLASER_W * 0.56, CANVAS_H);
          fill(255, 255, 255, 180 * a);      rect(L.x - BLASER_W * 0.10, 0, BLASER_W * 0.20, CANVAS_H);
        }
      }

      // 패턴 C: 촉수
      for (const t of _tents) {
        const left = t.x - TENT_W / 2;
        if (t.phase === 'warning') {
          const bl = 0.35 + 0.4 * abs(sin(frameCount * 0.32));
          noStroke(); fill(255, 40, 40, 110 * bl);
          rect(left, 0, TENT_W, CANVAS_H); // 세로 전체 경고
          stroke(255, 70, 70, 220 * bl); strokeWeight(3); noFill();
          rect(left, 0, TENT_W, CANVAS_H); noStroke();
        } else {
          const img = imgEnemy2Attack[t.anim];
          if (img) {
            push(); imageMode(CORNER);
            const tH = CANVAS_H - TENT_IMG_TOP;
            if (t.flip) { translate(left + TENT_W, TENT_IMG_TOP); scale(-1, 1); image(img, 0, 0, TENT_W, tH); }
            else        { image(img, left, TENT_IMG_TOP, TENT_W, tH); }
            pop();
          }
        }
      }

      // 플레이어 지속 레이저 빔 (기관총 점멸)
      if (AimStabilizer.isVisible() && frameCount % 2 === 0) {
        const ax = AimStabilizer.x() * CANVAS_W;
        const ay = AimStabilizer.y() * CANVAS_H;
        stroke(255, 230, 90, 60);  strokeWeight(14); line(ORIGIN.x, ORIGIN.y, ax, ay);
        stroke(255, 245, 150, 150); strokeWeight(6); line(ORIGIN.x, ORIGIN.y, ax, ay);
        stroke(255, 255, 255, 230); strokeWeight(2); line(ORIGIN.x, ORIGIN.y, ax, ay);
        noStroke();
      }

      // 타격 스파크 (explode.png 아주 작게, 빠르게 사라짐)
      imageMode(CENTER);
      for (const s of _sparks) {
        const a = s.life / 9;
        tint(255, 255 * a);
        image(imgExplode, s.x, s.y, s.sz * (1.2 - 0.4 * a), s.sz * (1.2 - 0.4 * a));
      }
      noTint();

      // 광폭화 진입 섬광
      if (_enrageFlash > 0) {
        noStroke(); fill(255, 60, 60, 150 * (_enrageFlash / 60));
        rect(0, 0, CANVAS_W, CANVAS_H);
      }

      // 전투 시작 전 대기 연출
      if (_introTimer > 0) {
        noStroke(); fill(0, 0, 0, 120); rect(0, 0, CANVAS_W, CANVAS_H);
        textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
        fill(255, 80, 80); textSize(40); text('BOSS', CANVAS_W / 2, CANVAS_H / 2 - 24);
        fill(220); textSize(20); text('전투 준비...', CANVAS_W / 2, CANVAS_H / 2 + 28);
      }
    },

    // 화면 상단 긴 보스 전용 체력바 + 하단 플레이어 HP 미니바
    drawHpBar() {
      const m = 40, bx = m, by = 30, bw = CANVAS_W - m * 2, bh = 26;
      noStroke();
      fill(0, 0, 0, 180); rect(bx - 4, by - 4, bw + 8, bh + 8, 6);
      fill(40, 20, 24);   rect(bx, by, bw, bh, 4);
      const frac = _bossHp / BOSS_MAX_HP;
      fill(_enraged ? color(255, 70, 70) : color(210, 50, 60));
      rect(bx, by, bw * frac, bh, 4);
      fill(255, 255, 255, 60); rect(bx, by, bw * frac, bh * 0.4, 4);
      textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
      fill(255); textSize(15);
      text('B O S S' + (_enraged ? '  — 광폭화!' : ''), CANVAS_W / 2, by + bh / 2);

      // 플레이어 HP 미니바 (하단)
      const pw = 320, ph = 14, px = CANVAS_W / 2 - pw / 2, py = CANVAS_H - 30;
      fill(0, 0, 0, 160); rect(px - 3, py - 3, pw + 6, ph + 6, 4);
      fill(40, 40, 60);   rect(px, py, pw, ph, 3);
      const pf = _playerHp / _playerMaxHp;
      fill(pf > 0.5 ? color(70, 210, 90) : pf > 0.2 ? color(220, 200, 50) : color(210, 60, 60));
      rect(px, py, pw * pf, ph, 3);
      fill(200); textSize(12); text('HP ' + _playerHp, CANVAS_W / 2, py - 12);
    },

    result: () => _result,
    reset() {
      _projs = []; _blasers = []; _tents = []; _sparks = []; _result = null;
      this._stopLaserSnd();
    },
  };
})();


// ════════════════════════════════════════════════════════════════════════════
// § 5  전역 상태
// ════════════════════════════════════════════════════════════════════════════

let state        = 'title';
let prevState    = 'title';
let currentStage = 1;
let camX = 0, camY = 0;

let player         = { x: MAP_W / 2, y: MAP_H / 2, size: 125 };
let enemies        = [];
let battleEnemy    = null;
let escapeCooldown = 0;
let gPlayerHp      = 100; // Stage1 전투 간 이어지는 영속 체력 (보스 진입 시 풀회복)
let calTimer       = 0;

let imgIdle, imgWalk1, imgWalk2, imgEnemy, imgEnemy1, imgEnemy2, imgEnemy3, imgBoss, imgStage1, imgStage2, imgMain, imgCombat, imgAttack, imgEscape;
let imgEnemy1Attack, imgExplode;
let imgEnemyFrames = [];
let imgEnemy2Attack = [];
let bgm, sndDamage, sndExplosion, sndCorrect, sndDamage2, sndBass, sndShoot, sndRocket;
let imgChar = {};
let imgHandPose = [];
let animTick = 0, isMoving = false, lastDir = 'idle';
let fadeAlpha = 0;
let tvOffTimer = 0;
const BATTLE_UI_VISIBLE = true; // 전투 UI 표시 여부


// ════════════════════════════════════════════════════════════════════════════
// § 6  p5 라이프사이클
// ════════════════════════════════════════════════════════════════════════════

function preload() {
  imgIdle   = loadImage('Images/idle.png');
  imgWalk1  = loadImage('Images/walk2.png');
  imgWalk2  = loadImage('Images/wlak2.png');
  imgEnemy  = loadImage('Images/enemy.png');
  imgEnemy1 = loadImage('Images/enemy/enemy1.png');
  imgEnemy2 = loadImage('Images/enemy/enemy2/enemy2.png');
  imgEnemy3 = loadImage('Images/enemy3.png');
  imgBoss   = loadImage('Images/boss.png');
  imgStage1 = loadImage('Images/stage1.png');
  imgStage2 = loadImage('Images/stage2.png');
  imgMain   = loadImage('Images/main.png');
  imgCombat  = loadImage('Images/combat.png');
  imgAttack     = loadImage('Images/attack.png');
  imgEscape     = loadImage('Images/escape.png');
  bgm          = loadSound('Things/bgm.mp3');
  sndDamage    = loadSound('Things/damage1.mp3');
  sndExplosion = loadSound('Things/game_explosion1.mp3');
  sndCorrect   = loadSound('Things/correct_answer2.mp3');
  sndDamage2   = loadSound('Things/damage2.mp3');
  sndBass      = loadSound('Things/deep_bass_vib.mp3');
  sndShoot     = loadSound('Things/shoot1.mp3');
  sndRocket    = loadSound('Things/rolling_rocket.mp3');
  imgEnemy1Attack = loadImage('Images/enemy1_attack.png');
  imgExplode      = loadImage('Images/explode.png');
  imgChar.idle  = [loadImage('Images/character/idle.png'),  loadImage('Images/character/idle2.png')];
  imgChar.back  = [loadImage('Images/character/back.png'),  loadImage('Images/character/back2.png')];
  imgChar.left  = [loadImage('Images/character/left.png'),  loadImage('Images/character/left2.png')];
  imgChar.right = [loadImage('Images/character/right.png'), loadImage('Images/character/right2.png')];
  imgChar.front = loadImage('Images/character/front.png');
  for (let i = 0; i <= 9; i++) {
    imgHandPose[i] = loadImage(`Images/HandPose/${i}.png`);
  }
  for (let i = 0; i <= 3; i++) {
    imgEnemyFrames[i] = loadImage(`Images/enemy/enemy_idle/enemy-${i}.png`);
  }
  for (let i = 0; i <= 6; i++) {
    imgEnemy2Attack[i] = loadImage(`Images/enemy/enemy2/enemy2_attack-${i}.png`);
  }
}

function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  randomSeed(99);
  if (typeof outputVolume === 'function') outputVolume(0.6); // 전체 마스터 볼륨 60%
  initStage(1);
}

function draw() {
  const needCam     = (state === 'battle' || state === 'calibration');
  const prevNeedCam = (prevState === 'battle' || prevState === 'calibration');
  if (!prevNeedCam &&  needCam) HandTracker.init();
  if ( prevNeedCam && !needCam) HandTracker.stop();
  prevState = state;

  const screenDrawers = {
    title:       () => drawTitle(),
    tvOff:       () => drawTvOff(),
    calibration: () => drawCalibration(),
    game:        () => drawGame(),
    pause:       () => { drawGame(); drawPauseMenu(); },
    battle:      () => drawBattle(),
    victory:     () => drawVictory(),
    defeat:      () => drawDefeat(),
  };
  screenDrawers[state]?.();
}


// ════════════════════════════════════════════════════════════════════════════
// § 7  입력 핸들러
// ════════════════════════════════════════════════════════════════════════════

function keyPressed() {
  if (keyCode === ESCAPE) {
    if      (state === 'game')  state = 'pause';
    else if (state === 'pause') state = 'game';
  }
}

function mousePressed() {
  if (state === 'title') {
    if (!HandTracker.calibration.isCalibrated) {
      state    = 'calibration';
      calTimer = CALIBRATION_TOTAL;
      Object.assign(HandTracker.calibration, { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 });
    } else {
      state      = 'tvOff';
      tvOffTimer = 60;
    }
  }
  else if (state === 'pause')   { if (hitBtn(CANVAS_W / 2, CANVAS_H / 2 + 10, 260, 56)) state = 'title'; }
  else if (state === 'battle')  BattleManager.handleClick();
  else if (state === 'victory' || state === 'defeat') { initStage(1); state = 'title'; }
  else if ((state === 'game') && currentStage === 1) {
    const bw = 120, bh = 36, bx = CANVAS_W - bw - 12, by = 12;
    if (mouseX >= bx && mouseX <= bx + bw && mouseY >= by && mouseY <= by + bh) {
      initStage(2); state = 'game';
      return;
    }
    // 디버그: 적 클릭 시 활성/비활성 토글 (월드 좌표로 변환해 판정)
    const wx = mouseX + camX, wy = mouseY + camY;
    for (const e of enemies) {
      if (dist(wx, wy, e.x, e.y) < e.size / 2) {
        e.active = (e.active === false); // false→true, 그 외→false
        break;
      }
    }
  }
}


// ════════════════════════════════════════════════════════════════════════════
// § 7.5  스테이지 관리
// ════════════════════════════════════════════════════════════════════════════

// 플레이어가 포털 반경 안에 들어왔는지 판정 (한 곳에서만 dist 호출)
function isNearPortal(portal) {
  return dist(player.x, player.y, portal.x, portal.y) < portal.r;
}

function isInBlockedZone(x, y) {
  return STAGE1_BLOCKED.some(z => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
}

// 지정 스테이지로 초기화: 적 생성 · 플레이어 중앙 복귀 · 상태 리셋
function initStage(id) {
  currentStage   = id;
  enemies        = STAGE_DEFS[id - 1].spawnEnemies();
  battleEnemy    = null;
  gPlayerHp      = 100; // 스테이지 시작/보스 진입 시 체력 풀회복

  if (id === 1) {
    player.x = 536;
    player.y = 2116;
    fadeAlpha = 255;
  } else {
    player.x = MAP_W / 2;
    player.y = MAP_H / 2 + 100;
  }

  escapeCooldown = 0;
}


// ════════════════════════════════════════════════════════════════════════════
// § 8  화면들 (타이틀 / 보정 / 일시정지 / 게임)
// ════════════════════════════════════════════════════════════════════════════

function drawTitle() {
  imageMode(CORNER);
  image(imgMain, 0, 0, CANVAS_W, CANVAS_H);
}

function drawTvOff() {
  // 타이틀 배경 유지
  imageMode(CORNER);
  image(imgMain, 0, 0, CANVAS_W, CANVAS_H);

  const prog    = 1 - tvOffTimer / 60;          // 0→1 진행도
  const stripH  = CANVAS_H * pow(1 - prog, 2);  // 점점 얇아지는 세로 폭
  const centerY = CANVAS_H / 2;

  // 위아래 검정으로 덮기
  noStroke(); fill(0);
  rect(0, 0, CANVAS_W, centerY - stripH / 2);
  rect(0, centerY + stripH / 2, CANVAS_W, CANVAS_H - (centerY + stripH / 2));

  // 중앙 흰색 빛줄기
  if (stripH > 2) {
    const glowG = drawingContext.createLinearGradient(0, centerY - stripH / 2, 0, centerY + stripH / 2);
    glowG.addColorStop(0,   'rgba(0,0,0,0)');
    glowG.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    glowG.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    glowG.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    glowG.addColorStop(1,   'rgba(0,0,0,0)');
    drawingContext.fillStyle = glowG;
    drawingContext.fillRect(0, centerY - stripH / 2, CANVAS_W, stripH);
  }

  if (--tvOffTimer <= 0) {
    initStage(1);
    state = 'game';
  }
}

function drawCalibration() {
  background(20, 20, 35);
  if (--calTimer <= 0) {
    HandTracker.calibration.isCalibrated = true;
    // TV 꺼짐 연출 → initStage(1) + 페이드인 순서로 진행
    state      = 'tvOff';
    tvOffTimer = 60;
    return;
  }

  const vw = 480, vh = 360;
  const vx = CANVAS_W / 2 - vw / 2, vy = 140;
  if (HandTracker.video && HandTracker.video.readyState >= 2) {
    drawingContext.save();
    drawingContext.translate(vx + vw, vy); drawingContext.scale(-1, 1);
    drawingContext.drawImage(HandTracker.video, 0, 0, vw, vh);
    drawingContext.restore();
  }
  noFill(); stroke(80, 200, 120); strokeWeight(3); rect(vx, vy, vw, vh, 8);

  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(255); textSize(28); text('동적 인식 범위 보정', CANVAS_W / 2, 70);
  fill(160, 190, 255); textSize(18);
  text('손을 상/하/좌/우 최대한 크고 넓게 움직이세요', CANVAS_W / 2, vy + vh + 50);

  const prog = calTimer / CALIBRATION_TOTAL;
  const bw = 480, bx = CANVAS_W / 2 - bw / 2, by = vy + vh + 100;
  fill(40, 40, 60); rect(bx, by, bw, 16, 8);
  fill(80, 210, 130); rect(bx, by, bw * prog, 16, 8);
}

function drawPauseMenu() {
  fill(0, 0, 0, 160); noStroke(); rect(0, 0, CANVAS_W, CANVAS_H);
  const pw = 420, ph = 320;
  const px = CANVAS_W / 2 - pw / 2, py = CANVAS_H / 2 - ph / 2;
  fill(18, 18, 30); stroke(80, 200, 120); strokeWeight(2); rect(px, py, pw, ph, 14);

  textAlign(CENTER, CENTER); textFont('monospace');
  fill(180, 220, 180); noStroke(); textSize(28);
  text('일시정지', CANVAS_W / 2, py + 56);

  drawBtn('메뉴화면으로 나가기', CANVAS_W / 2, CANVAS_H / 2 + 10,  260, 56,
          color(35, 100, 65), color(60, 160, 100), 18);
  drawBtn('세이브',             CANVAS_W / 2, CANVAS_H / 2 + 90,  260, 56,
          color(40, 40, 80),  color(60, 60, 110),  18);

  fill(100, 100, 120); noStroke(); textSize(14);
  text('[ESC] 계속하기', CANVAS_W / 2, py + ph - 22);
}

function drawGame() {
  if (state === 'game') updateGameInput();

  const { mapW, mapH } = STAGE_DEFS[currentStage - 1];

  camX = constrain(player.x - CANVAS_W / 2, 0, mapW - CANVAS_W);
  camY = constrain(player.y - CANVAS_H / 2, 0, mapH - CANVAS_H);

  push();
  translate(-camX, -camY);

  const stageDef = STAGE_DEFS[currentStage - 1];
  imageMode(CORNER);
  if (currentStage === 1) {
    image(imgStage1, 0, 0);
  } else {
    image(stageDef.getBg(), 0, 0, CANVAS_W, CANVAS_H);
  }

  imageMode(CENTER);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.active === false) continue; // 디버그: 비활성 적은 렌더 제외
    const breathe   = 1 + sin(frameCount * 0.04 + i * 1.3) * 0.04;
    const drawW     = e.size;
    const drawH     = e.size * breathe;

    drawEllipseShadow(e.x + 5, e.y + e.size * 0.45 - 10, e.size * 0.825, e.size * 0.21);

    const enemyImg = e.isBoss      ? imgBoss
                   : e.img === 'enemy1' ? imgEnemy1
                   : e.img === 'enemy2' ? imgEnemy2
                   : e.img === 'enemy3' ? imgEnemy3
                   : imgEnemy;
    image(enemyImg, e.x, e.y, drawW, drawH);
  }

  // 그림자
  drawEllipseShadow(player.x + 5, player.y + player.size * 0.45, player.size * 0.55, player.size * 0.14);

  const charFrames = imgChar[lastDir] ?? imgChar.idle;
  const playerImg  = isMoving ? charFrames[0] : charFrames[floor(animTick / 20) % 2];
  image(playerImg, player.x, player.y, player.size, player.size);
  pop();

  drawVignette();

  if (fadeAlpha > 0) {
    noStroke(); fill(0, 0, 0, fadeAlpha);
    rect(0, 0, CANVAS_W, CANVAS_H);
    fadeAlpha = max(0, fadeAlpha - 3);
  }

  drawHUD();
}

function drawVignette() {
  noFill(); noStroke();
  const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
  const r1 = max(CANVAS_W, CANVAS_H) * 0.3;
  const r2 = max(CANVAS_W, CANVAS_H) * 0.85;
  const g = drawingContext.createRadialGradient(cx, cy, r1, cx, cy, r2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  drawingContext.fillStyle = g;
  drawingContext.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function updateGameInput() {
  isMoving = false;
  const oldX = player.x, oldY = player.y;
  if (keyIsDown(87) || keyIsDown(UP_ARROW))    { player.y -= SPEED; isMoving = true; lastDir = 'back'; }
  if (keyIsDown(83) || keyIsDown(DOWN_ARROW))  { player.y += SPEED; isMoving = true; lastDir = 'idle'; }
  if (keyIsDown(65) || keyIsDown(LEFT_ARROW))  { player.x -= SPEED; isMoving = true; lastDir = 'left'; }
  if (keyIsDown(68) || keyIsDown(RIGHT_ARROW)) { player.x += SPEED; isMoving = true; lastDir = 'right'; }
  animTick++;

  const { mapW: curMapW, mapH: curMapH } = STAGE_DEFS[currentStage - 1];
  player.x = constrain(player.x, player.size / 2, curMapW - player.size / 2);
  player.y = constrain(player.y, player.size / 2, curMapH - player.size / 2);

  if (currentStage === 1 && isInBlockedZone(player.x, player.y)) {
    if (isInBlockedZone(oldX, player.y)) player.y = oldY;
    if (isInBlockedZone(player.x, oldY)) player.x = oldX;
    if (isInBlockedZone(player.x, player.y)) { player.x = oldX; player.y = oldY; }
  }

  if (escapeCooldown > 0) { escapeCooldown--; return; }

  // 스테이지 전환: 적 3기 모두 처치(enemies 비었음) + 포털 반경 진입 시만 처리
  //   적이 하나라도 남아 있으면 포털 잠금 (테스트용 STAGE2 버튼은 예외)
  const curDef = STAGE_DEFS[currentStage - 1];
  if (curDef.portal && curDef.nextStage && enemies.length === 0 && isNearPortal(curDef.portal)) {
    initStage(curDef.nextStage);
    return;
  }

  for (const e of enemies) {
    if (e.active === false) continue; // 디버그: 비활성 적은 충돌 제외
    if (dist(player.x, player.y, e.x, e.y) < (player.size + e.size) / 2) {
      battleEnemy = e; BattleManager.init();
      BattleManager.data.playerHp = gPlayerHp; // 영속 체력 이어받기
      if (e.isBoss) BattleManager.startBoss();  // 보스: 실시간 전투 진입
      state = 'battle';
      if (bgm) { bgm.setVolume(0.25); bgm.loop(); }
      return;
    }
  }
}

function drawHUD() {
  fill(0, 0, 0, 140); noStroke(); rect(12, 12, 240, 44, 8);
  fill(180, 200, 220); textSize(14); textFont('monospace'); textAlign(LEFT, CENTER);
  text('player : (' + round(player.x) + ', ' + round(player.y) + ')', 22, 34);

  if (currentStage === 1) {
    const bw = 120, bh = 36, bx = CANVAS_W - bw - 12, by = 12;
    fill(200, 80, 80, 200); noStroke(); rect(bx, by, bw, bh, 6);
    fill(255); textSize(14); textFont('monospace'); textAlign(CENTER, CENTER);
    text('STAGE 2 →', bx + bw / 2, by + bh / 2);
  }
}


// ════════════════════════════════════════════════════════════════════════════
// § 9  전투 화면 (순수 렌더링)
//
//   규칙: BattleManager.update() 가 로직을 끝낸 뒤에만 draw 함수가 호출된다.
//         draw* 함수는 상태를 절대 변경하지 않는다.
// ════════════════════════════════════════════════════════════════════════════

function drawBattle() {
  AimStabilizer.update(); // 안정화 파이프라인 — 매 프레임 최상단 실행

  // 보스: 실시간 복합 전투 (전용 렌더링 분기)
  if (BattleManager.data.state === 'boss') {
    BattleManager.update();
    drawBossBattle();
    return;
  }

  drawBattleScene();
  if (BATTLE_UI_VISIBLE) drawBattleHPPanels();

  BattleManager.update();

  const d = BattleManager.data;
  if (BATTLE_UI_VISIBLE) {
    const panelDrawers = {
      command:       () => drawCommandMenu(),
      skillSelect:   () => drawSkillMenu(),
      playerCasting: () => drawGestureCasting(),
      enemyTurn:     () => drawEnemyTurn(),
      aimDefend:     () => drawAimDefend(),
      barrageDefend: () => drawBarrageDefend(),
      ringDefend:    () => drawRingDefend(),
      aimSuccess:    () => drawAimSuccess(),
      result:        () => drawResultScreen(),
    };
    panelDrawers[d.state]?.();
    if (d.state !== 'aimDefend' && d.state !== 'barrageDefend'
        && d.state !== 'ringDefend' && d.state !== 'aimSuccess')
      HandTracker.drawUI();
  }

  // 전투 화면 비네트
  drawVignette();

  // 손 조준 동그라미 — 회피 방어 단계에서 표시
  if (d.state === 'aimDefend' || d.state === 'barrageDefend' || d.state === 'ringDefend')
    drawHandCrosshair();

  // 성공 글로우 — aimSuccess 단계에서 플레이어 위치에 표시
  if (d.state === 'aimSuccess') drawAimSuccessGlow();

  fill(0, 0, 0, 140); noStroke(); rect(12, 12, 200, 36, 6);
  fill(180, 200, 220); textSize(13); textFont('monospace'); textAlign(LEFT, CENTER);
  text('mouse : (' + mouseX + ', ' + mouseY + ')', 22, 30);
}

// ── 보스 실시간 전투 렌더링 (전용 화면) ──────────────────────────────────
function drawBossBattle() {
  BossManager.draw();      // 배경 + 보스 + 모든 공격 패턴 + 플레이어 레이저
  drawVignette();
  BossManager.drawHpBar(); // 상단 긴 보스 체력바 + 하단 플레이어 HP
  drawHandCrosshair();     // 플레이어 = 조준점
}

function drawHandCrosshair() {
  // AimStabilizer 가 비표시 상태면 그리지 않음 (초기 / 끊김 페이드 완료)
  if (!AimStabilizer.isVisible()) return;

  const op = AimStabilizer.opacity();          // 0.0 ~ 1.0
  const cx = AimStabilizer.x() * CANVAS_W;    // 안정화된 x 픽셀
  const cy = AimStabilizer.y() * CANVAS_H;    // 안정화된 y 픽셀

  // 외곽 링
  noFill(); strokeWeight(2.5);
  stroke(255, 255, 255, 180 * op);
  ellipse(cx, cy, 48, 48);

  // 내부 작은 원
  stroke(255, 80, 80, 220 * op);
  strokeWeight(1.5);
  ellipse(cx, cy, 16, 16);

  // 십자선
  stroke(255, 255, 255, 120 * op);
  strokeWeight(1);
  line(cx - 28, cy, cx - 10, cy);
  line(cx + 10, cy, cx + 28, cy);
  line(cx, cy - 28, cx, cy - 10);
  line(cx, cy + 10, cx, cy + 28);

  noStroke();
}

// ── 배경 + 발판 + 스프라이트 (이펙트 적용) ───────────────────────────
function drawBattleScene() {
  imageMode(CORNER);
  image(imgCombat, 0, 0, CANVAS_W, CANVAS_H);

  imageMode(CENTER);
  const enemyFrame = imgEnemyFrames[floor(frameCount / 8) % 4];
  const battleImg  = battleEnemy?.isBoss      ? imgBoss
                   : battleEnemy?.img === 'enemy2' ? imgEnemy2
                   : battleEnemy?.img === 'enemy3' ? imgEnemy3
                   : (enemyFrame ?? imgEnemy);
  const enemySize  = battleEnemy?.isBoss ? 634 : 262; // 일반 적: 374→262 (30% 축소)
  const bEBreathe  = 1 + sin(frameCount * 0.04) * 0.04;
  const bEDrawSize = enemySize * bEBreathe;
  const bEX = 676, bEY = 313;

  // 전투 적 그림자
  drawEllipseShadow(bEX + 5, bEY + enemySize * 0.45 - 10, enemySize * 0.825, enemySize * 0.21);

  drawCombatant(battleImg, bEX, bEY, bEDrawSize, 'enemy');

  // 플레이어 (회피 방어·성공 연출에서는 숨김 — 적 단독 표시)
  const _bst = BattleManager.data.state;
  if (_bst !== 'aimDefend' && _bst !== 'barrageDefend' && _bst !== 'ringDefend' && _bst !== 'aimSuccess') {
    const pSize = 250; // 전투 플레이어: 2배 크기
    const pImg  = imgChar.front;
    drawEllipseShadow(290 + 5, 525 + pSize * 0.45 - 10, pSize * 0.825, pSize * 0.21);
    drawCombatant(pImg, 290, 525, pSize, 'player');
  }
}

function drawCombatant(img, x, y, baseSize, target) {
  const s = baseSize * EffectManager.getScale(target);
  const c = EffectManager.getFlashColor(target);
  if (c) tint(c[0], c[1], c[2], c[3]);
  image(img, x, y, s, s);
  noTint();
}

// ── HP 패널 ───────────────────────────────────────────────────────────
function drawBattleHPPanels() {
  const d = BattleManager.data;
  drawHPPanel(871, 210, '적', d.enemyHp,  d.enemyMaxHp,  'enemy');
  // aimSuccess 연출 중에는 HP바 숨김 (그 외에는 항상 표시 — 방어 중 피격 피드백)
  if (d.state !== 'aimSuccess') {
    drawHPPanel(290 + 120, 525 - 30, '나', d.playerHp, d.playerMaxHp, 'player', 0.8);
  }
}

function drawHPPanel(x, y, label, hp, maxHp, effectTarget, scale = 1.0) {
  const pw = 340 * scale, ph = 80 * scale;
  fill(18, 18, 30, 230); stroke(90, 90, 120); strokeWeight(1); rect(x, y, pw, ph, 8);

  textFont('monospace'); textAlign(LEFT, TOP); noStroke();
  fill(200, 200, 220); textSize(18 * scale); text(label, x + 14 * scale, y + 12 * scale);
  fill(150, 150, 170); textSize(15 * scale); text(hp + ' / ' + maxHp, x + pw - 100 * scale, y + 14 * scale);

  const bx = x + 14 * scale, by = y + 48 * scale, bw = pw - 28 * scale, bh = 16 * scale;
  fill(40, 40, 60); rect(bx, by, bw, bh, 5);
  fill(hp > 50 ? color(70, 210, 90) : hp > 20 ? color(220, 200, 50) : color(210, 60, 60));
  rect(bx, by, bw * (hp / maxHp), bh, 5);

  const flash = EffectManager.getFlashColor(effectTarget);
  if (flash) { fill(flash[0], flash[1], flash[2], flash[3] * 0.35); noStroke(); rect(x, y, pw, ph, 8); }
}

// ── 커맨드 메뉴 (공격 / 도망) ────────────────────────────────────────
function drawCommandMenu() {
  const py = CANVAS_H * 0.72;

  // 그라데이션 배경 (위쪽 투명 → 아래쪽 진한 검정)
  const gradTop = py - 200;
  const grad = drawingContext.createLinearGradient(0, gradTop, 0, CANVAS_H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.95)');
  drawingContext.fillStyle = grad;
  drawingContext.fillRect(0, gradTop, CANVAS_W, CANVAS_H - gradTop);

  noStroke(); textFont('monospace'); textAlign(CENTER, CENTER);
  withCenterMode(() => {
    image(imgAttack, CANVAS_W * 0.25, CANVAS_H * 0.86, 432, 144);
    image(imgEscape, CANVAS_W * 0.75, CANVAS_H * 0.86, 432, 144);
  });
}

// ── 기술 선택 메뉴 ────────────────────────────────────────────────────
function drawSkillMenu() {
  const py   = CANVAS_H * 0.65;
  const rowH = (CANVAS_H - py) / (SKILL_DEFS.length + 1);

  fill(14, 14, 26, 245); noStroke(); rect(0, py, CANVAS_W, CANVAS_H - py);

  for (let i = 0; i < SKILL_DEFS.length; i++) {
    const ry    = py + i * rowH;
    const hover = mouseY >= ry && mouseY < ry + rowH;
    const sk    = SKILL_DEFS[i];

    fill(hover ? color(35, 55, 45) : color(20, 20, 36)); noStroke(); rect(0, ry, CANVAS_W, rowH);
    stroke(45, 45, 65); strokeWeight(1); noFill(); rect(0, ry, CANVAS_W, rowH);

    // 스킬 이름
    noStroke(); fill(hover ? color(230, 240, 220) : color(210, 210, 235));
    textFont('monospace'); textAlign(LEFT, CENTER); textSize(22);
    text('▶ ' + sk.name, 28, ry + rowH / 2 - 10);

    // 손동작 시퀀스: 이미지로 표시
    const imgSz = min(floor(rowH * 0.48), 24);
    let ipx = 28;
    const imgCY = ry + rowH * 0.75;
    withCenterMode(() => {
      for (let j = 0; j < sk.pattern.length; j++) {
        image(imgHandPose[sk.pattern[j]], ipx + imgSz / 2, imgCY, imgSz, imgSz);
        ipx += imgSz + 2;
        if (j < sk.pattern.length - 1) {
          noStroke(); fill(130, 170, 140); textFont('monospace'); textSize(11); textAlign(CENTER, CENTER);
          text('→', ipx + 7, imgCY);
          ipx += 16;
        }
      }
    });

    // 효과 설명
    fill(220, 190, 70); textAlign(RIGHT, CENTER); textSize(16);
    text(sk.desc, CANVAS_W - 28, ry + rowH / 2);
  }

  const backY   = py + SKILL_DEFS.length * rowH;
  const backHov = mouseY >= backY;
  fill(backHov ? color(45, 25, 25) : color(25, 15, 15)); noStroke(); rect(0, backY, CANVAS_W, rowH);
  fill(170, 130, 130); textAlign(CENTER, CENTER); textFont('monospace'); textSize(20);
  text('← 뒤로', CANVAS_W / 2, backY + rowH / 2);
}

// ── 플레이어 제스처 캐스팅 ───────────────────────────────────────────
function drawGestureCasting() {
  const d  = BattleManager.data;
  const sk = d.selectedSkill;
  if (!sk) return;

  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;
  fill(14, 20, 35, 248); stroke(70, 150, 220); strokeWeight(2); rect(0, py, CANVAS_W, ph);

  textAlign(CENTER, TOP); textFont('monospace');
  fill(90, 190, 255); textSize(18); text('△ ' + sk.name + ' 캐스팅', CANVAS_W / 2, py + 10);

  const theme = {
    done:    { bg: color(22,80,32),  border: color(65,190,85),  text: color(85,240,105) },
    current: { bg: color(58,52, 10 + floor(18 * abs(sin(frameCount * 0.12)))),
               border: color(210,190,45), text: color(245,228,85) },
    pending: { bg: color(22,22,44),  border: color(48,48,76),   text: color(105,105,140) },
    arrow:   color(88,88,115), holdBg: color(32,32,58), holdFill: color(200,178,45),
    holdLabel: color(150,150,185),
  };

  drawGestureBoxRow(sk.pattern, d.castIndex, d.holdTimer, theme, py);
  drawTimerBar(d.castTimer, CAST_TOTAL, py, ph,
               color(30,30,52), color(145,145,180),
               [color(65,195,85), color(205,168,38), color(195,52,52)]);
}

// ── 적 공격 연출 ──────────────────────────────────────────────────────
function drawEnemyTurn() {
  const d = BattleManager.data, py = CANVAS_H * 0.72;
  fill(38, 12, 12, 235); stroke(155, 55, 55); strokeWeight(2); rect(0, py, CANVAS_W, CANVAS_H - py);

  fill(155, 55, 55, 180); noStroke(); rect(0, py, CANVAS_W * (1 - d.enemyTimer / ENEMY_WAIT), 4);

  textAlign(CENTER, CENTER); textFont('monospace');
  fill(240, 95, 95); textSize(32);
  text('적이 공격을 개시합니다!', CANVAS_W / 2, py + 70);
}

// ── 방어 성공 연출: 플레이어 흰 글로우 + 성공 텍스트 ────────────────────
function drawAimSuccessGlow() {
  const d     = BattleManager.data;
  const pulse = 0.55 + 0.45 * sin(frameCount * 0.20);
  const gx = 290, gy = 525, gr = 220;

  // 플레이어 주변 흰색 방사형 글로우
  const glow = drawingContext.createRadialGradient(gx, gy, 0, gx, gy, gr);
  glow.addColorStop(0,    `rgba(255,255,255,${0.80 * pulse})`);
  glow.addColorStop(0.30, `rgba(200,230,255,${0.45 * pulse})`);
  glow.addColorStop(0.65, `rgba(160,200,255,${0.18 * pulse})`);
  glow.addColorStop(1,    'rgba(255,255,255,0)');
  drawingContext.fillStyle = glow;
  drawingContext.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
}

function drawAimSuccess() {
  const d  = BattleManager.data;
  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;
  const pulse = 0.6 + 0.4 * sin(frameCount * 0.18);

  // 하단 패널
  fill(5, 28, 10, 215); stroke(70, 220, 100); strokeWeight(2);
  rect(0, py, CANVAS_W, ph);

  // 성공 텍스트 (글로우 효과)
  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(80, 255, 120, 160 * pulse); textSize(48);
  text('방어 성공!', CANVAS_W / 2 + 3, py + ph * 0.38 + 3);
  fill(200, 255, 210); textSize(48);
  text('방어 성공!', CANVAS_W / 2, py + ph * 0.38);

  fill(140, 220, 150); textSize(16);
  text('공격 턴으로 이동합니다...', CANVAS_W / 2, py + ph * 0.70);
}

// ── 공간 방어 화면 ────────────────────────────────────────────────────
//   보스전: 방향 UI 아래에 요구 손동작 이미지 추가 표시
function drawSpatialDefend() {
  const d = BattleManager.data;
  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;

  drawDefendGuideLines(py);

  const current  = d.defendPattern[d.defendRound];
  const fracGrad = 1 - d.defendTimer / DEFEND_TOTAL;
  drawSpatialGradientWarning(current?.direction, map(fracGrad, 0, 1, 30, 220), py);

  if (HandTracker.landmarks) drawHandCursor(py);

  fill(22, 16, 26, 250); stroke(195, 58, 58); strokeWeight(2); rect(0, py, CANVAS_W, ph);

  const holdFrac = d.defendHold / DEFEND_HOLD_NEEDED;
  const bw = 360, bx = CANVAS_W / 2 - bw / 2, by = py + 80;
  fill(40, 20, 25); noStroke(); rect(bx, by, bw, 14, 6);
  if (holdFrac > 0) { fill(90, 230, 120); rect(bx, by, bw * holdFrac, 14, 6); }

  textAlign(CENTER, TOP); textFont('monospace');
  fill(245, 110, 110); textSize(20);
  text('방어 돌파 시도: ' + (d.defendRound + 1) + ' / 4', CANVAS_W / 2, py + 14);
  fill(160, 160, 180); textSize(14);
  text('구역 점유율: ' + floor(holdFrac * 100) + '%', CANVAS_W / 2, by + 22);

  // 보스전: 요구 손동작 이미지를 방향 UI 아래에 표시
  if (current?.gesture !== null && current?.gesture !== undefined) {
    withCenterMode(() => image(imgHandPose[current.gesture], CANVAS_W / 2, py + 140, 80, 80));
  }

  drawTimerBar(d.defendTimer, DEFEND_TOTAL, py, ph,
               color(50, 22, 22), color(195, 135, 135),
               [color(235, 115, 45), color(200, 52, 52), color(200, 52, 52)]);
}

function drawGestureDefend() {
  const d  = BattleManager.data;
  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;
  const required = d.gesturePattern?.[d.gestureRound];

  fill(14, 20, 40, 252); stroke(100, 80, 200); strokeWeight(2);
  rect(0, py, CANVAS_W, ph);

  // 타이머 바
  const timeFrac = d.gestureTimer / GESTURE_DEFEND_PER_ROUND;
  fill(30, 20, 50); noStroke(); rect(0, py, CANVAS_W, 8);
  fill(timeFrac > 0.4 ? color(80, 160, 255) : color(220, 80, 80));
  rect(0, py, CANVAS_W * timeFrac, 8);

  textAlign(CENTER, TOP); textFont('monospace'); noStroke();
  fill(180, 140, 255); textSize(18);
  text('동작 방어: ' + (d.gestureRound + 1) + ' / ' + GESTURE_DEFEND_ROUNDS, CANVAS_W / 2, py + 16);

  // 요구 손동작 이미지
  if (required !== undefined && imgHandPose[required]) {
    withCenterMode(() => image(imgHandPose[required], CANVAS_W / 2, py + 80, 100, 100));
    fill(255, 220, 80); textSize(16);
    text(GestureClassifier.getName(required), CANVAS_W / 2, py + 138);
  }

  // 홀드 게이지
  const holdFrac = d.gestureHold / HOLD_NEEDED;
  const bw = 360, bx = CANVAS_W / 2 - bw / 2, by = py + 165;
  fill(30, 30, 55); noStroke(); rect(bx, by, bw, 14, 6);
  if (holdFrac > 0) { fill(100, 220, 140); rect(bx, by, bw * holdFrac, 14, 6); }
  fill(160, 160, 200); textSize(13);
  text('유지율: ' + floor(holdFrac * 100) + '%', CANVAS_W / 2, by + 24);

  // 누적 실패 데미지
  if (d.gestureDmg > 0) {
    fill(255, 90, 90); textSize(14);
    text('누적 데미지: -' + d.gestureDmg, CANVAS_W / 2, by + 48);
  }
}

// ── 조준 방어 화면: 투사체 파괴 카운터 + 조준점 ────────────────────────
function drawAimDefend() {
  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;

  // 투사체 렌더링 (패널 오버레이 전에 그려서 게임 영역에 표시)
  ProjectileManager.draw();

  // 하단 그라데이션 오버레이
  const grad = drawingContext.createLinearGradient(0, py - 140, 0, CANVAS_H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.92)');
  drawingContext.fillStyle = grad;
  drawingContext.fillRect(0, py - 140, CANVAS_W, CANVAS_H - (py - 140));

  // 패널 테두리
  noFill(); stroke(100, 80, 200); strokeWeight(2);
  rect(0, py, CANVAS_W, ph);

  // 파괴 진행 아이콘 바 (5칸)
  const TOTAL = 5;
  const killed = ProjectileManager.destroyedCount();
  const iconW  = 38, iconH = 10, iconGap = 10;
  const totalW = TOTAL * iconW + (TOTAL - 1) * iconGap;
  let ix = CANVAS_W / 2 - totalW / 2;
  const iy = py + 10;
  noStroke();
  for (let i = 0; i < TOTAL; i++) {
    fill(i < killed ? color(80, 230, 110) : color(55, 35, 80));
    rect(ix, iy, iconW, iconH, 3);
    ix += iconW + iconGap;
  }

  // 안내 텍스트
  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(240, 200, 255); textSize(22);
  text('적이 공격한다!', CANVAS_W / 2, py + ph * 0.30);
  fill(180, 160, 220); textSize(15);
  text('조준점을 올리고 2초 유지  →  파괴', CANVAS_W / 2, py + ph * 0.55);
  fill(100, 220, 140); textSize(14);
  text('파괴 ' + killed + ' / ' + TOTAL, CANVAS_W / 2, py + ph * 0.78);
}

// ── 적2 탄막 회피 방어 화면 ───────────────────────────────────────────────
//   세로 기둥 탄막은 화면 하단까지 닿으므로 하단 패널은 두지 않는다.
function drawBarrageDefend() {
  // 탄막(경고/발동) 렌더링
  BarrageManager.draw();

  // 상단 안내 배너 (가벼운 반투명)
  noStroke();
  fill(0, 0, 0, 150);
  rect(0, 0, CANVAS_W, 56);

  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(255, 90, 90); textSize(22);
  text('회피하라! 조준점을 안전지대로 이동', CANVAS_W / 2, 28);
}

// ── 적3 수축형 원형 탄막 회피 화면 ─────────────────────────────────────────
function drawRingDefend() {
  // 원형 탄막 렌더링 (전체 화면 영역)
  RingBarrageManager.draw();

  // 상단 안내 배너 (가벼운 반투명)
  noStroke();
  fill(0, 0, 0, 150);
  rect(0, 0, CANVAS_W, 56);

  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(255, 120, 90); textSize(22);
  const ph = RingBarrageManager.phase();
  text(ph === 2 ? 'PHASE 2 — 탄막 + 레이저! 빈 공간을 찾아 생존하라'
                : '수축하는 탄막! 빈 통로를 찾아 생존하라', CANVAS_W / 2, 28);
}

function drawDefendGuideLines(panelY) {
  const arenaH = panelY;
  const xLo = CANVAS_W * REGION_LO, xHi = CANVAS_W * REGION_HI;
  const yLo = arenaH   * REGION_LO, yHi = arenaH   * REGION_HI;

  stroke(255, 255, 255, 40); strokeWeight(1); noFill();
  line(xLo, 0, xLo, arenaH); line(xHi, 0, xHi, arenaH);
  line(0, yLo, CANVAS_W, yLo); line(0, yHi, CANVAS_W, yHi);

  const cur = HandTracker.currentRegion;
  textFont('monospace'); textAlign(CENTER, CENTER); noStroke();
  const labels = [
    { dir: 'UP',    x: CANVAS_W / 2,           y: yLo / 2            },
    { dir: 'DOWN',  x: CANVAS_W / 2,           y: (yHi + arenaH) / 2 },
    { dir: 'LEFT',  x: xLo / 2,                y: arenaH / 2         },
    { dir: 'RIGHT', x: (xHi + CANVAS_W) / 2,   y: arenaH / 2         },
  ];
  for (const L of labels) {
    fill(cur === L.dir ? color(120, 255, 180, 200) : color(255, 255, 255, 40));
    textSize(cur === L.dir ? 36 : 26);
    text(L.dir, L.x, L.y);
  }
}

function drawSpatialGradientWarning(region, maxAlpha, panelY) {
  if (!region) return;
  const arenaH = panelY;

  const gradientSources = {
    UP:    [CANVAS_W/2, 0,       CANVAS_W/2, arenaH * 0.7],
    DOWN:  [CANVAS_W/2, arenaH,  CANVAS_W/2, arenaH * 0.3],
    LEFT:  [0,          arenaH/2, CANVAS_W * 0.45, arenaH/2],
    RIGHT: [CANVAS_W,   arenaH/2, CANVAS_W * 0.55, arenaH/2],
  };
  const src = gradientSources[region];
  if (!src) return;

  const [x0, y0, x1, y1] = src;
  const grad = drawingContext.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, 'rgba(255,0,0,' + (maxAlpha / 255) + ')');
  grad.addColorStop(1, 'rgba(255,0,0,0)');
  drawingContext.save();
  drawingContext.fillStyle = grad;
  noStroke(); rect(0, 0, CANVAS_W, arenaH);
  drawingContext.restore();
}

function drawHandCursor(panelY) {
  const cx = HandTracker.handPos.x * CANVAS_W;
  const cy = HandTracker.handPos.y * panelY;
  noFill(); stroke(90, 255, 160, 200); strokeWeight(3); circle(cx, cy, 40);
  fill(90, 255, 160); noStroke(); circle(cx, cy, 18);
}

// ── 결과 메시지 ──────────────────────────────────────────────────────
function drawResultScreen() {
  const d = BattleManager.data;
  const py = CANVAS_H * 0.72, ph = CANVAS_H - py;
  const isWin  = d.resultNext === 'win';
  const isLose = d.resultNext === 'lose';

  const tone = isWin  ? { box: color(12,28,16,225),  edge: color(70,200,90),
                           bar: color(70,200,90,120),  txt: color(110,240,130) }
             : isLose ? { box: color(28,10,10,225),   edge: color(200,60,60),
                           bar: color(200,60,60,120),  txt: color(240,100,100) }
             :          { box: color(14,18,30,225),   edge: color(80,160,220),
                           bar: color(80,160,220,120), txt: color(200,230,200) };

  fill(tone.box); stroke(tone.edge); strokeWeight(2); rect(0, py, CANVAS_W, ph);
  fill(tone.bar); noStroke(); rect(0, py, CANVAS_W * (1 - d.resultTimer / RESULT_WAIT), 4);

  const lines = d.resultMsg.split('\n');
  textAlign(CENTER, CENTER); textFont('monospace');
  fill(tone.txt); textSize(26);
  for (let i = 0; i < lines.length; i++)
    text(lines[i], CANVAS_W / 2, py + ph / 2 + (i - (lines.length - 1) / 2) * 36);
}


// ── 승리 / 패배 공용 엔딩 화면 ───────────────────────────────────────
function drawEndScreen(label, mainRGB, shadowRGB, labelRGB) {
  background(0);
  const pulse = map(sin(frameCount * 0.04), -1, 1, 180, 255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textFont('Impact, Arial Black, sans-serif');
  fill(shadowRGB[0], shadowRGB[1], shadowRGB[2], pulse * 0.4);
  textSize(180);
  text(label, CANVAS_W / 2 + 6, CANVAS_H / 2 - 60 + 6);
  fill(mainRGB[0], mainRGB[1], mainRGB[2], pulse);
  text(label, CANVAS_W / 2, CANVAS_H / 2 - 60);
  textStyle(NORMAL);
  textFont('monospace');
  fill(labelRGB[0], labelRGB[1], labelRGB[2], map(sin(frameCount * 0.07), -1, 1, 100, 220));
  textSize(22);
  text('클릭하여 타이틀로', CANVAS_W / 2, CANVAS_H / 2 + 90);
}

function drawVictory() { drawEndScreen('VICTORY', [255,220,0],  [120,90,0], [200,180,80]); }
function drawDefeat()  { drawEndScreen('DEFEAT',  [220,30,30],  [80,0,0],   [180,80,80]); }


// ════════════════════════════════════════════════════════════════════════════
// § 10  공용 UI 헬퍼
// ════════════════════════════════════════════════════════════════════════════

// 타원형 그라데이션 그림자 (중심 cx,cy / 가로반경 rw / 세로반경 rh)
function drawEllipseShadow(cx, cy, rw, rh) {
  drawingContext.save();
  drawingContext.scale(1, rh / rw);
  const g = drawingContext.createRadialGradient(
    cx, cy * (rw / rh), 0,
    cx, cy * (rw / rh), rw / 2
  );
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  drawingContext.fillStyle = g;
  drawingContext.beginPath();
  drawingContext.arc(cx, cy * (rw / rh), rw / 2, 0, Math.PI * 2);
  drawingContext.fill();
  drawingContext.restore();
}

// imageMode(CENTER) 블록 래퍼
function withCenterMode(fn) {
  imageMode(CENTER);
  fn();
  imageMode(CORNER);
}

// 제스처 박스 단일 셀 렌더링 (imageMode(CENTER) 블록 내에서 호출)
function drawSingleGestureBox(bx, bY, gestureId, isDone, isCurrent, slot, theme, boxW, boxH, gap, isLast) {
  fill(slot.bg); stroke(slot.border); strokeWeight(isCurrent ? 3 : 1.2);
  rect(bx, bY, boxW, boxH, 6);

  if (isDone)          tint(100, 255, 120, 210);
  else if (!isCurrent) tint(160, 160, 200, 160);
  image(imgHandPose[gestureId], bx + boxW / 2, bY + boxH / 2, boxW - 12, boxH - 12);
  noTint();

  if (isDone) {
    noStroke(); fill(100, 255, 130, 220);
    textFont('monospace'); textSize(14); textAlign(RIGHT, TOP);
    text('✓', bx + boxW - 4, bY + 4);
  }
  if (!isLast) {
    noStroke(); fill(theme.arrow); textFont('monospace'); textSize(18); textAlign(CENTER, CENTER);
    text('→', bx + boxW + gap / 2, bY + boxH / 2);
  }
}

function drawGestureBoxRow(gestureIds, currentIndex, holdTimer, theme, panelY) {
  const boxW = 90, boxH = 90, gap = 24;
  const totalW = gestureIds.length * boxW + (gestureIds.length - 1) * gap;
  const bx0 = CANVAS_W / 2 - totalW / 2, bY = panelY + 42;

  withCenterMode(() => {
    for (let i = 0; i < gestureIds.length; i++) {
      const bx        = bx0 + i * (boxW + gap);
      const isDone    = i < currentIndex;
      const isCurrent = i === currentIndex;
      const slot      = isDone ? theme.done : isCurrent ? theme.current : theme.pending;
      drawSingleGestureBox(bx, bY, gestureIds[i], isDone, isCurrent, slot, theme, boxW, boxH, gap, i === gestureIds.length - 1);
    }
  });

  if (currentIndex < gestureIds.length) {
    const bx   = bx0 + currentIndex * (boxW + gap);
    const barY = bY + boxH + 6, frac = holdTimer / HOLD_NEEDED;
    noStroke();
    fill(theme.holdBg);   rect(bx, barY, boxW, 10, 4);
    fill(theme.holdFill); rect(bx, barY, boxW * frac, 10, 4);
    if (theme.holdLabel) {
      fill(theme.holdLabel); textFont('monospace'); textSize(12); textAlign(CENTER, TOP);
      text(floor(frac * 100) + '%', bx + boxW / 2, barY + 14);
    }
  }
}

function drawTimerBar(current, total, panelY, panelH, bgColor, labelColor, thresholdColors) {
  const frac = current / total, barY = panelY + panelH - 28;
  noStroke();
  fill(bgColor); rect(14, barY, CANVAS_W - 28, 12, 6);
  fill(frac > 0.4 ? thresholdColors[0] : frac > 0.2 ? thresholdColors[1] : thresholdColors[2]);
  rect(14, barY, (CANVAS_W - 28) * frac, 12, 6);
  fill(labelColor); textFont('monospace'); textSize(13); textAlign(RIGHT, CENTER);
  text(nf(current / 60, 1, 1) + 's', CANVAS_W - 18, barY + 6);
}

function hitBtn(cx, cy, w, h) {
  return mouseX > cx - w/2 && mouseX < cx + w/2 && mouseY > cy - h/2 && mouseY < cy + h/2;
}

function drawBtn(label, cx, cy, w, h, base, hover, fontSize) {
  fill(hitBtn(cx, cy, w, h) ? hover : base); noStroke(); rect(cx - w/2, cy - h/2, w, h, 9);
  fill(255); textAlign(CENTER, CENTER); textFont('monospace'); textSize(fontSize || 18);
  text(label, cx, cy);
}

// 제발 잘 되라
