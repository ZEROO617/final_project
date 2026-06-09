// ════════════════════════════════════════════════════════════════════════════
// RingBarrageManager.js — 적3 수축 원형 탄막 (전투)
//
//   가장자리에서 생성된 고리 탄막이 중앙으로 수축(2페이즈: 레이저 추가).
//   고리의 빈 통로로 조준점을 이동해 생존. 데미지를 BattleManager가 가져간다.
// ════════════════════════════════════════════════════════════════════════════

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

    update() { // (22)
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


