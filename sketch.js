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

const CANVAS_W = 1280;
const CANVAS_H = 960;
const MAP_W    = 1280;
const MAP_H    = 960;
const SPEED    = 4;

const CALIBRATION_TOTAL  = 300;
const CAST_TOTAL         = 300;
const HOLD_NEEDED        = 55;
const DEFEND_TOTAL       = 240;
const DEFEND_HOLD_NEEDED = 90;
const ENEMY_WAIT         = 100;
const RESULT_WAIT        = 100;
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
    getBg:       () => imgStage1,
    portal:      { x: 640, y: 80, r: 100 },
    nextStage:   2,
    spawnEnemies() {
      return Array.from({ length: 3 }, () => ({
        x: random(200, MAP_W - 200),
        y: random(200, MAP_H - 200),
        size: 96,
      }));
    },
  },
  {
    id: 2,
    getBg:       () => imgStage2,
    portal:      null,
    nextStage:   null,
    spawnEnemies() {
      return [{ x: 640, y: 280, size: 192, isBoss: true }];
    },
  },
];


// ════════════════════════════════════════════════════════════════════════════
// § 2  EffectManager — 피격/방어 시각 이펙트
// ════════════════════════════════════════════════════════════════════════════

const EffectManager = {
  _fx: { player: null, enemy: null },

  triggerHit(target)           { this._fx[target] = { type: 'hit',    flash: 14, scale: 14 }; },
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

    state: 'command', // command | skillSelect | playerCasting | enemyTurn | defendCasting | result
    selectedSkill: null,

    // 플레이어 캐스팅
    castIndex: 0, castTimer: 0, holdTimer: 0,
    // 적 턴
    enemyTimer: 0, pendingDmg: 0,
    // 공간 방어 (4단계)
    defendRound: 0, defendPattern: [], defendTimer: 0, defendHold: 0,
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
      defendCasting:  () => this._updateDefendCasting(),
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

  // ── 적 턴: 연출 종료 후 4방향 랜덤 패턴 생성 → 방어 단계로 ───────────
  //   보스전: { direction, gesture(0-9) }  / 일반전: { direction, gesture: null }
  _updateEnemyTurn() {
    const d = this.data;
    if (--d.enemyTimer > 0) return;

    if (battleEnemy?.isBoss) {
      d.defendPattern = Array.from({ length: 4 }, () => ({
        direction: random(DIRECTIONS),
        gesture:   floor(random(0, 10)),
      }));
    } else {
      d.defendPattern = Array.from({ length: 4 }, () => ({
        direction: random(DIRECTIONS),
        gesture:   null,
      }));
    }

    d.state       = 'defendCasting';
    d.defendRound = 0;
    d.defendTimer = DEFEND_TOTAL;
    d.defendHold  = 0;
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

    if (HandTracker.gestureId === d.selectedSkill.pattern[d.castIndex]) {
      if (++d.holdTimer >= HOLD_NEEDED) {
        d.castIndex++;
        d.holdTimer = 0;
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

  // ── 클릭 핸들러 ────────────────────────────────────────────────────────
  _handleCommandClick() {
    const py = CANVAS_H * 0.72;
    if (mouseY <= py) return;

    if (mouseX < CANVAS_W / 2) {
      this.data.state = 'skillSelect';
    } else {
      this.init();
      battleEnemy    = null;
      escapeCooldown = 90;
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
        const isBoss   = battleEnemy?.isBoss;   // null 되기 전에 먼저 저장
        enemies        = enemies.filter(e => e !== battleEnemy);
        battleEnemy    = null;
        BattleManager.init();
        if (isBoss) {
          state = 'victory';                    // 보스 처치 → 엔딩 화면
        } else {
          escapeCooldown = 60;
          state          = 'game';
        }
      },
      lose() {
        battleEnemy = null;
        BattleManager.init();
        state = 'defeat';                       // 사망 → 패배 화면
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

    let nx = map(rawX, this.calibration.minX, this.calibration.maxX, 0, 1, true);
    let ny = map(rawY, this.calibration.minY, this.calibration.maxY, 0, 1, true);
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

    noFill(); stroke(80, 200, 120, 200); strokeWeight(2);
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
// § 5  전역 상태
// ════════════════════════════════════════════════════════════════════════════

let state        = 'title';
let prevState    = 'title';
let currentStage = 1;

let player         = { x: MAP_W / 2, y: MAP_H / 2, size: 96 };
let enemies        = [];
let battleEnemy    = null;
let escapeCooldown = 0;
let calTimer       = 0;

let imgIdle, imgWalk1, imgWalk2, imgEnemy, imgBoss, imgStage1, imgStage2, imgMain;
let imgHandPose = [];
let animTick = 0, isMoving = false;


// ════════════════════════════════════════════════════════════════════════════
// § 6  p5 라이프사이클
// ════════════════════════════════════════════════════════════════════════════

function preload() {
  imgIdle   = loadImage('Images/idle.png');
  imgWalk1  = loadImage('Images/walk2.png');
  imgWalk2  = loadImage('Images/wlak2.png');
  imgEnemy  = loadImage('Images/enemy.png');
  imgBoss   = loadImage('Images/boss.png');
  imgStage1 = loadImage('Images/stage1.png');
  imgStage2 = loadImage('Images/stage2.png');
  imgMain   = loadImage('Images/main.png');
  for (let i = 0; i <= 9; i++) {
    imgHandPose[i] = loadImage(`Images/HandPose/${i}.png`);
  }
}

function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  randomSeed(99);
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
    if (!hitBtn(CANVAS_W / 2, CANVAS_H / 2 + 80, 220, 64)) return;
    if (!HandTracker.calibration.isCalibrated) {
      state    = 'calibration';
      calTimer = CALIBRATION_TOTAL;
      Object.assign(HandTracker.calibration, { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 });
    } else {
      state = 'game';
    }
  }
  else if (state === 'pause')   { if (hitBtn(CANVAS_W / 2, CANVAS_H / 2 + 10, 260, 56)) state = 'title'; }
  else if (state === 'battle')  BattleManager.handleClick();
  else if (state === 'victory' || state === 'defeat') { initStage(1); state = 'title'; }
}


// ════════════════════════════════════════════════════════════════════════════
// § 7.5  스테이지 관리
// ════════════════════════════════════════════════════════════════════════════

// 플레이어가 포털 반경 안에 들어왔는지 판정 (한 곳에서만 dist 호출)
function isNearPortal(portal) {
  return dist(player.x, player.y, portal.x, portal.y) < portal.r;
}

// 지정 스테이지로 초기화: 적 생성 · 플레이어 중앙 복귀 · 상태 리셋
function initStage(id) {
  currentStage   = id;
  enemies        = STAGE_DEFS[id - 1].spawnEnemies();
  battleEnemy    = null;

  player.x = MAP_W / 2;

  if (id === 2) {
    player.y = MAP_H / 2 + 100;
  } else {
    player.y = MAP_H / 2;
  }

  escapeCooldown = 0;
}


// ════════════════════════════════════════════════════════════════════════════
// § 8  화면들 (타이틀 / 보정 / 일시정지 / 게임)
// ════════════════════════════════════════════════════════════════════════════

function drawTitle() {
  imageMode(CORNER);
  image(imgMain, 0, 0, CANVAS_W, CANVAS_H);

  drawBtn('게임 시작', CANVAS_W / 2, CANVAS_H / 2 + 80, 220, 64,
          color(50, 160, 90), color(70, 200, 120), 22);
}

function drawCalibration() {
  background(20, 20, 35);
  if (--calTimer <= 0) {
    HandTracker.calibration.isCalibrated = true;
    state = 'game';
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

  push();
  const stageDef = STAGE_DEFS[currentStage - 1];

  imageMode(CORNER);
  image(stageDef.getBg(), 0, 0, CANVAS_W, CANVAS_H);

  imageMode(CENTER);
  for (const e of enemies) {
    const enemyImg = e.isBoss ? imgBoss : imgEnemy;
    image(enemyImg, e.x, e.y, e.size, e.size);
  }

  const playerImg = isMoving
    ? (floor(animTick / 10) % 2 === 0 ? imgWalk1 : imgWalk2)
    : imgIdle;
  image(playerImg, player.x, player.y, player.size, player.size);
  pop();

  drawHUD();
}

function updateGameInput() {
  isMoving = false;
  if (keyIsDown(87) || keyIsDown(UP_ARROW))    { player.y -= SPEED; isMoving = true; }
  if (keyIsDown(83) || keyIsDown(DOWN_ARROW))  { player.y += SPEED; isMoving = true; }
  if (keyIsDown(65) || keyIsDown(LEFT_ARROW))  { player.x -= SPEED; isMoving = true; }
  if (keyIsDown(68) || keyIsDown(RIGHT_ARROW)) { player.x += SPEED; isMoving = true; }
  if (isMoving) animTick++;

  player.x = constrain(player.x, player.size / 2, MAP_W - player.size / 2);
  player.y = constrain(player.y, player.size / 2, MAP_H - player.size / 2);

  if (escapeCooldown > 0) { escapeCooldown--; return; }

  // 스테이지 전환: 적 전멸 후 포털 반경 진입 시만 처리 (nextStage 없으면 스킵)
  const curDef = STAGE_DEFS[currentStage - 1];
  if (curDef.portal && curDef.nextStage && enemies.length === 0 && isNearPortal(curDef.portal)) {
    initStage(curDef.nextStage);
    return;
  }

  for (const e of enemies) {
    if (dist(player.x, player.y, e.x, e.y) < (player.size + e.size) / 2) {
      battleEnemy = e; BattleManager.init(); state = 'battle'; return;
    }
  }
}

function drawHUD() {
  fill(0, 0, 0, 140); noStroke(); rect(12, 12, 240, 44, 8);
  fill(180, 200, 220); textSize(14); textFont('monospace'); textAlign(LEFT, CENTER);
  text('player : (' + round(player.x) + ', ' + round(player.y) + ')', 22, 34);
}


// ════════════════════════════════════════════════════════════════════════════
// § 9  전투 화면 (순수 렌더링)
//
//   규칙: BattleManager.update() 가 로직을 끝낸 뒤에만 draw 함수가 호출된다.
//         draw* 함수는 상태를 절대 변경하지 않는다.
// ════════════════════════════════════════════════════════════════════════════

function drawBattle() {
  drawBattleScene();
  drawBattleHPPanels();

  BattleManager.update();

  const d = BattleManager.data;
  const panelDrawers = {
    command:       () => drawCommandMenu(),
    skillSelect:   () => drawSkillMenu(),
    playerCasting: () => drawGestureCasting(),
    enemyTurn:     () => drawEnemyTurn(),
    defendCasting: () => drawSpatialDefend(),
    result:        () => drawResultScreen(),
  };
  panelDrawers[d.state]?.();

  HandTracker.drawUI();
}

// ── 배경 + 발판 + 스프라이트 (이펙트 적용) ───────────────────────────
function drawBattleScene() {
  background(55, 80, 130);
  noStroke();
  fill(70, 120, 60);  rect(0, CANVAS_H * 0.52, CANVAS_W, CANVAS_H * 0.48);
  fill(90, 150, 80);
  ellipse(CANVAS_W * 0.70, CANVAS_H * 0.33, 260, 60);
  ellipse(CANVAS_W * 0.28, CANVAS_H * 0.58, 320, 70);

  imageMode(CENTER);
  const battleImg = battleEnemy?.isBoss ? imgBoss : imgEnemy;
  const enemySize = battleEnemy?.isBoss ? 244 : 144;

  drawCombatant(
    battleImg,
    CANVAS_W * 0.70,
    CANVAS_H * 0.22,
    enemySize,
    'enemy'
  );
  drawCombatant(imgIdle,  CANVAS_W * 0.28, CANVAS_H * 0.48, 288, 'player');
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
  drawHPPanel(CANVAS_W - 360, 14,             '적', d.enemyHp,  d.enemyMaxHp,  'enemy');
  drawHPPanel(CANVAS_W * 0.52, CANVAS_H*0.45, '나', d.playerHp, d.playerMaxHp, 'player');
}

function drawHPPanel(x, y, label, hp, maxHp, effectTarget) {
  const pw = 340, ph = 80;
  fill(18, 18, 30, 230); stroke(90, 90, 120); strokeWeight(1); rect(x, y, pw, ph, 8);

  textFont('monospace'); textAlign(LEFT, TOP); noStroke();
  fill(200, 200, 220); textSize(18); text(label, x + 14, y + 12);
  fill(150, 150, 170); textSize(15); text(hp + ' / ' + maxHp, x + pw - 100, y + 14);

  const bx = x + 14, by = y + 48, bw = pw - 28, bh = 16;
  fill(40, 40, 60); rect(bx, by, bw, bh, 5);
  fill(hp > 50 ? color(70, 210, 90) : hp > 20 ? color(220, 200, 50) : color(210, 60, 60));
  rect(bx, by, bw * (hp / maxHp), bh, 5);

  const flash = EffectManager.getFlashColor(effectTarget);
  if (flash) { fill(flash[0], flash[1], flash[2], flash[3] * 0.35); noStroke(); rect(x, y, pw, ph, 8); }
}

// ── 커맨드 메뉴 (공격 / 도망) ────────────────────────────────────────
function drawCommandMenu() {
  const py = CANVAS_H * 0.72;
  fill(22, 22, 38); stroke(90, 90, 120); strokeWeight(2); rect(0, py, CANVAS_W, CANVAS_H - py);
  stroke(60, 60, 90); line(CANVAS_W / 2, py, CANVAS_W / 2, CANVAS_H);

  noStroke(); textFont('monospace'); textAlign(CENTER, CENTER);
  fill(220, 220, 240); textSize(32);
  text('공  격', CANVAS_W * 0.25, CANVAS_H * 0.86);
  text('도  망', CANVAS_W * 0.75, CANVAS_H * 0.86);
  fill(120, 200, 140); textSize(16); textAlign(LEFT, TOP);
  text('[ 플레이어 턴 ]', 12, py + 8);
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
    imageMode(CENTER);
    for (let j = 0; j < sk.pattern.length; j++) {
      image(imgHandPose[sk.pattern[j]], ipx + imgSz / 2, imgCY, imgSz, imgSz);
      ipx += imgSz + 2;
      if (j < sk.pattern.length - 1) {
        noStroke(); fill(130, 170, 140); textFont('monospace'); textSize(11); textAlign(CENTER, CENTER);
        text('→', ipx + 7, imgCY);
        ipx += 16;
      }
    }
    imageMode(CORNER);

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
    imageMode(CENTER);
    image(imgHandPose[current.gesture], CANVAS_W / 2, py + 140, 80, 80);
    imageMode(CORNER);
  }

  drawTimerBar(d.defendTimer, DEFEND_TOTAL, py, ph,
               color(50, 22, 22), color(195, 135, 135),
               [color(235, 115, 45), color(200, 52, 52), color(200, 52, 52)]);
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


// ── 승리 화면 (보스 처치) ─────────────────────────────────────────────
function drawVictory() {
  background(0);

  // 글자 크기에 맞춰 부드럽게 맥동하는 알파값
  const pulse = map(sin(frameCount * 0.04), -1, 1, 180, 255);

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textFont('Impact, Arial Black, sans-serif');

  // 그림자 효과 (살짝 오프셋으로 입체감)
  fill(120, 90, 0, pulse * 0.4);
  textSize(180);
  text('VICTORY', CANVAS_W / 2 + 6, CANVAS_H / 2 - 60 + 6);

  // 메인 텍스트 — 노란색
  fill(255, 220, 0, pulse);
  text('VICTORY', CANVAS_W / 2, CANVAS_H / 2 - 60);

  // 안내 문구
  textStyle(NORMAL);
  textFont('monospace');
  fill(200, 180, 80, map(sin(frameCount * 0.07), -1, 1, 100, 220));
  textSize(22);
  text('클릭하여 타이틀로', CANVAS_W / 2, CANVAS_H / 2 + 90);
}

// ── 패배 화면 ─────────────────────────────────────────────────────────
function drawDefeat() {
  background(0);

  const pulse = map(sin(frameCount * 0.04), -1, 1, 180, 255);

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textFont('Impact, Arial Black, sans-serif');

  // 그림자 효과
  fill(80, 0, 0, pulse * 0.4);
  textSize(180);
  text('DEFEAT', CANVAS_W / 2 + 6, CANVAS_H / 2 - 60 + 6);

  // 메인 텍스트 — 빨간색
  fill(220, 30, 30, pulse);
  text('DEFEAT', CANVAS_W / 2, CANVAS_H / 2 - 60);

  // 안내 문구
  textStyle(NORMAL);
  textFont('monospace');
  fill(180, 80, 80, map(sin(frameCount * 0.07), -1, 1, 100, 220));
  textSize(22);
  text('클릭하여 타이틀로', CANVAS_W / 2, CANVAS_H / 2 + 90);
}


// ════════════════════════════════════════════════════════════════════════════
// § 10  공용 UI 헬퍼
// ════════════════════════════════════════════════════════════════════════════

function drawGestureBoxRow(gestureIds, currentIndex, holdTimer, theme, panelY) {
  const boxW = 90, boxH = 90, gap = 24;
  const totalW = gestureIds.length * boxW + (gestureIds.length - 1) * gap;
  const bx0 = CANVAS_W / 2 - totalW / 2, bY = panelY + 42;

  imageMode(CENTER);
  for (let i = 0; i < gestureIds.length; i++) {
    const bx        = bx0 + i * (boxW + gap);
    const isDone    = i < currentIndex;
    const isCurrent = i === currentIndex;
    const slot      = isDone ? theme.done : isCurrent ? theme.current : theme.pending;

    fill(slot.bg); stroke(slot.border); strokeWeight(isCurrent ? 3 : 1.2);
    rect(bx, bY, boxW, boxH, 6);

    if (isDone)          tint(100, 255, 120, 210);
    else if (!isCurrent) tint(160, 160, 200, 160);
    image(imgHandPose[gestureIds[i]], bx + boxW / 2, bY + boxH / 2, boxW - 12, boxH - 12);
    noTint();

    if (isDone) {
      noStroke(); fill(100, 255, 130, 220);
      textFont('monospace'); textSize(14); textAlign(RIGHT, TOP);
      text('✓', bx + boxW - 4, bY + 4);
    }

    if (i < gestureIds.length - 1) {
      noStroke(); fill(theme.arrow); textFont('monospace'); textSize(18); textAlign(CENTER, CENTER);
      text('→', bx + boxW + gap / 2, bY + boxH / 2);
    }
  }
  imageMode(CORNER);

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
