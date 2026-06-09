// ════════════════════════════════════════════════════════════════════════════
// BossManager.js — Stage2 실시간 복합 보스전 (전투)
//
//   플레이어 지속 레이저로 보스 딜 + 투사체/레이저/촉수 복합 패턴 회피.
//   체력 40% 이하 최종 페이즈. 승/패 결과를 BattleManager가 읽어 전환한다.
// ════════════════════════════════════════════════════════════════════════════

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
  // 실시간 생태값들
  let _bossHp, _playerHp, _playerMaxHp;
  let _fireCd, _hitCd, _result, _bossFlash, _enraged, _enrageFlash;
  let _projs, _projMode, _projModeTimer, _projBurstCd;
  let _blasers, _blaserCd;
  let _tents, _tentCd;
  let _sparks, _dmg2Playing;
  let _introTimer;
// ════════════════════════════════════════════════════════════════════════════
  function _angDiffAbs(a, b) { // 보스전에서 플레이어가 피격 범위에 들어왔나 각도 구하기.
    let d = (a - b) % TWO_PI;
    if (d >  PI) d -= TWO_PI;
    if (d < -PI) d += TWO_PI;
    return abs(d);
  }
// ════════════════════════════════════════════════════════════════════════════
  // 적1 투사체 스폰: 보스에서 하단 임의 지점으로
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


