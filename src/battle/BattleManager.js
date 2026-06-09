// ════════════════════════════════════════════════════════════════════════════
// BattleManager.js — 전투 상태 머신 (전투 두뇌)
//
//   커맨드/스킬/적턴/각 방어 페이즈/보스 등 전투 상태 전환을 총괄(로직 전용).
//   각 전투 매니저를 호출하고 HP/결과를 관리. 렌더링은 BattleRenderer가 담당.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// § 3  BattleManager — 전투 상태 머신 (로직만, 렌더링 없음)
//
//   command → skillSelect → playerCasting → result
//                                         ↘ enemyTurn → defendCasting → result
// ════════════════════════════════════════════════════════════════════════════

const BattleManager = {
  data: { // 전투의 모든 현재 상태 저장소
    playerHp: 100, playerMaxHp: 100,
    enemyHp:  100, enemyMaxHp:  100,

    state: 'command', // command|skillSelect|playerCasting|enemyTurn|aimDefend|aimSuccess|result
    selectedSkill: null,

    // 플레이어 캐스팅
    castIndex: 0, castTimer: 0, holdTimer: 0,
    // 적 턴
    enemyTimer: 0, pendingDmg: 0,
    // 조준 방어
    aimSuccessTimer: 0,
    // 스킬 효과 누적 상태
    bonusDmg: 0,    // 다음 공격에 더할 추가 데미지 (카운트다운 등)
    shielded: false, // 이번 적 공격을 완전 차단 (충전된 블라스트 등)
    // 결과 표시
    resultMsg: '', resultTimer: 0, resultNext: 'command',
  },
// ════════════════════════════════════════════════════════════════════════════
  init() { //(7)
    const d = this.data;
    Object.assign(d, {
      playerHp: d.playerMaxHp, enemyHp: d.enemyMaxHp,
      state: 'command', selectedSkill: null, // (8) -> battleRenderer.js
      castIndex: 0, castTimer: 0, holdTimer: 0,
      enemyTimer: 0, pendingDmg: 0,
      aimSuccessTimer: 0,
      bonusDmg: 0, shielded: false,
      resultMsg: '', resultTimer: 0, resultNext: 'command',
    });
  },
// ════════════════════════════════════════════════════════════════════════════
  update() {
    EffectManager.update();
    const d = this.data;
    const stateHandlers = {
      playerCasting:  () => this._updateGestureCasting(), // (14)
      enemyTurn:      () => this._updateEnemyTurn(), // (20)
      aimDefend:      () => this._updateAimDefend(),
      barrageDefend:  () => this._updateDefendPhase(BarrageManager),
      ringDefend:     () => this._updateDefendPhase(RingBarrageManager), // (21)
      aimSuccess:     () => this._updateAimSuccess(),
      boss:           () => this._updateBoss(),
      result:         () => this._updateResult(), // (18)
    };
    stateHandlers[d.state]?.();
  },
// ════════════════════════════════════════════════════════════════════════════
  handleClick() { // (10)
    const d = this.data;
    const clickHandlers = {
      command:     () => this._handleCommandClick(), // (11)
      skillSelect: () => this._handleSkillSelectClick(), // (13)
    };
    clickHandlers[d.state]?.();
  },
// ════════════════════════════════════════════════════════════════════════════
  // ── 적 턴: 연출 종료 후 적별 방어 페이즈로 전환 ─────────────────────────
  _updateEnemyTurn() { // (20)
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

  // ── 탄막/원형 방어 공통: 15초 생존 시 성공 연출 ─────────────────────────
  _updateDefendPhase(mgr) { // (21)
    const d = this.data;
    mgr.update(); // (22)
    const dmg = mgr.takeDamage();
    if (dmg > 0) {
      d.playerHp = max(0, d.playerHp - dmg);
      EffectManager.triggerHit('player');
      if (sndDamage) sndDamage.play();
      if (d.playerHp <= 0) { mgr.reset(); this._showResult('패배...', 'lose'); return; }
    }
    if (mgr.isDone()) { mgr.reset(); d.aimSuccessTimer = 90; d.state = 'aimSuccess'; }
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

  _updateResult() { // (18)
    if (--this.data.resultTimer <= 0) this._applyResultTransition(); // (19)
  },

  // ── 캐스팅: 손동작 ID로 비교 (GestureClassifier 기준) ──────────────────
  _updateGestureCasting() { // (14)
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
        if (d.castIndex >= d.selectedSkill.pattern.length) this._resolveSkill(); // 전부 성공했을떄 (15)
      }
    } else {
      d.holdTimer = 0;
    }
  },

  // ── 클릭 핸들러 ────────────────────────────────────────────────────────
  _handleCommandClick() { // (11)
    const py = CANVAS_H * 0.72;
    if (mouseY <= py) return;

    if (mouseX < CANVAS_W / 2) { // 공격하기 누른거임
      this.data.state = 'skillSelect';
    } else { // 도망치기 누른거임.
      gPlayerHp      = this.data.playerHp; // 도망쳐도 체력 유지
      this.init();
      battleEnemy    = null;
      escapeCooldown = 90;
      if (bgm) bgm.stop();
      state          = 'game';
    }
  },

  _handleSkillSelectClick() { // (13)
    const d = this.data;
    const py   = CANVAS_H * 0.65;
    const rowH = (CANVAS_H - py) / (SKILL_DEFS.length + 1);

    for (let i = 0; i < SKILL_DEFS.length; i++) {
      if (mouseY >= py + i * rowH && mouseY < py + (i + 1) * rowH) {
        Object.assign(d, {
          selectedSkill: SKILL_DEFS[i],
          state: 'playerCasting', // (14)
          castTimer: CAST_TOTAL, castIndex: 0, holdTimer: 0,
        });
        HandTracker.resetGestureBuffer();
        return;
      }
    }
    if (mouseY >= py + SKILL_DEFS.length * rowH) d.state = 'command';
  },

  // ── 스킬 판정: SkillEffectResolver 에 위임 (if/switch 없음) ─────────────
  _resolveSkill() { // (15)
    const d   = this.data;
    const sk  = d.selectedSkill;
    const msg = SkillEffectResolver.resolve(sk, d); // (16) -> SkillSystem.js

    const won = d.enemyHp <= 0;
    this._showResult( // (17)
      sk.name + ' 발동!\n' + msg + (won ? '\n적 처치! ★ 승리!' : ''),
      won ? 'win' : 'enemyTurn'
    );
  },

  // ── 결과 표시 & 전환 ──────────────────────────────────────────────────
  _showResult(msg, nextState) { // (17)
    Object.assign(this.data, {
      resultMsg: msg, resultNext: nextState,
      resultTimer: RESULT_WAIT, state: 'result',
    });
  },

  _applyResultTransition() { //(19)
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

    (transitions[nx] ?? (() => { d.state = nx; }))(); // 이게 널 병합이랑 IIFE합쳐놓은 개 어려운 코드
  },
};


