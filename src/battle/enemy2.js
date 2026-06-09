// ════════════════════════════════════════════════════════════════════════════
// ProjectileManager.js — 투사체 요격 방어 (전투)
//
//   적1식 투사체가 플레이어로 접근 → 조준 유지로 파괴하거나 회피.
//   AimStabilizer(조준점)와 충돌 판정. 누적 데미지를 BattleManager가 가져간다.
// ════════════════════════════════════════════════════════════════════════════

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


