// ════════════════════════════════════════════════════════════════════════════
// BarrageManager.js — 적2 촉수 탄막 방어 (전투)
//
//   세로 기둥형 촉수 공격이 겹쳐 내려친다(경고→촉수 애니메이션→판정).
//   조준점을 안전지대로 옮겨 회피. 누적 데미지를 BattleManager가 가져간다.
// ════════════════════════════════════════════════════════════════════════════

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


