// ════════════════════════════════════════════════════════════════════════════
// BattleRenderer.js — 전투 화면 렌더링 & 공용 UI 헬퍼 (UI)
//
//   BattleManager 상태에 맞춘 모든 전투 화면 그리기(순수 렌더, 상태 변경 없음).
//   체력바·메뉴·제스처박스·그림자 등 공용 UI 헬퍼도 포함.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// § 9  전투 화면 (순수 렌더링)
//
//   규칙: BattleManager.update() 가 로직을 끝낸 뒤에만 draw 함수가 호출된다.
//         draw* 함수는 상태를 절대 변경하지 않는다.
// ════════════════════════════════════════════════════════════════════════════

function drawBattle() { // (9)
  AimStabilizer.update(); // 안정화 파이프라인 — 매 프레임 최상단 실행

  // 보스: 실시간 복합 전투 (전용 렌더링 분기)
  if (BattleManager.data.state === 'boss') {
    BattleManager.update();
    drawBossBattle();
    return; // return은 함수까지 나가진다.
  }

  drawBattleScene(); // 방어인지 아닌지 확인해서 적이랑 플레이어 그리기
  drawBattleHPPanels(); // HP패널 그리기

  BattleManager.update();

  const d = BattleManager.data;
  const panelDrawers = {
    command:       () => drawCommandMenu(), //커맨드 선택 화면. "공격", "스킬", "방어" 버튼 표시 (8)
    skillSelect:   () => drawSkillMenu(), // 스킬 선택 화면. 배운 스킬 목록 버튼 표시 (12)
    playerCasting: () => drawGestureCasting(), // 플레이어가 손동작으로 스킬 시전하는 화면. 타이머/제스처 인식 UI 표시
    enemyTurn:     () => drawEnemyTurn(), // 적 공격 턴. 적이 공격하는 연출 표시 // (20)
    aimDefend:     () => drawAimDefend(), // 조준 방어 미니게임. 손으로 특정 구역을 가리켜 막는 방어
    barrageDefend: () => drawBarrageDefend(), // 탄막 방어 미니게임. 날아오는 투사체를 손으로 피하는/막는 방어
    ringDefend:    () => drawRingDefend(), // 링 방어 미니게임. 링 타이밍에 맞춰 손동작하는 방어
    aimSuccess:    () => drawAimSuccess(), // 방어 성공 연출 화면
    result:        () => drawResultScreen(), // 전투 결과 화면. 승리/패배 메시지 + 계속하기 버튼
  };
  //현재 전투 상태에 맞는 UI 그리기 함수 호출
  panelDrawers[d.state]?.();
  if (d.state !== 'aimDefend' && d.state !== 'barrageDefend'
      && d.state !== 'ringDefend' && d.state !== 'aimSuccess')
    HandTracker.drawUI();

  // 전투 화면 비네트
  drawVignette();
  
  // 손 조준 동그라미 — 회피 방어 단계에서 표시
  if (d.state === 'aimDefend' || d.state === 'barrageDefend' || d.state === 'ringDefend')
    drawHandCrosshair();

  // 성공 글로우 — aimSuccess 단계에서 플레이어 위치에 표시
  if (d.state === 'aimSuccess') drawAimSuccessGlow();

  // (디버그) 마우스 좌표 표시.
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

  // 원래는 여기에서 안정화된 픽셀을 반환하는 거였는데 안정화 기능이 폐기 되면서 그냥 원본 값을 가져온다.
  const op = AimStabilizer.opacity();          // 0.0 ~ 1.0
  const cx = AimStabilizer.x() * CANVAS_W;    // 안정화된 x 픽셀( 조준점 위치 )
  const cy = AimStabilizer.y() * CANVAS_H;    // 안정화된 y 픽셀


  // 뭐 여기서 부터는 그냥 그리는 거니까.
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
// ========================================================================================
// ── 배경 + 발판 + 스프라이트 (이펙트 적용) ───────────────────────────
function drawBattleScene() { // (10)
  imageMode(CORNER);
  image(imgCombat, 0, 0, CANVAS_W, CANVAS_H);

  imageMode(CENTER);
  const enemyFrame = imgEnemyFrames[floor(frameCount / 8) % 4];
  const battleImg  = battleEnemy?.isBoss      ? imgBoss // 보스냐 적 1,3이냐 판단해서 이미지 적용
                   : battleEnemy?.img === 'enemy2' ? imgEnemy2
                   : battleEnemy?.img === 'enemy3' ? imgEnemy3
                   : (enemyFrame ?? imgEnemy); // 적2(애니메이션 있음) 이미지 적용
  const enemySize  = battleEnemy?.isBoss ? 634 : 262; // 일반 적: 374→262 (30% 축소)

  //숨 쉬는 효과 구현.
  const bEBreathe  = 1 + sin(frameCount * 0.04) * 0.04;
  const bEDrawSize = enemySize * bEBreathe;
  const bEX = 676, bEY = 313;

  // 전투 적 그림자
  drawEllipseShadow(bEX + 5, bEY + enemySize * 0.45 - 10, enemySize * 0.825, enemySize * 0.21);

  // 결정된 적 이미지를 실제로 그리는 함수.
  drawCombatant(battleImg, bEX, bEY, bEDrawSize, 'enemy');

  // 플레이어 (회피 방어·성공 연출에서는 숨김 — 적 단독 표시)
  const _bst = BattleManager.data.state;
  if (_bst !== 'aimDefend' && _bst !== 'barrageDefend' && _bst !== 'ringDefend' && _bst !== 'aimSuccess') { // 방어 상태가 !아니다 체크
    const pSize = 250; // 전투 플레이어: 2배 크기
    const pImg  = imgChar.front;
    drawEllipseShadow(290 + 5, 525 + pSize * 0.45 - 10, pSize * 0.825, pSize * 0.21); // 그림자
    drawCombatant(pImg, 290, 525, pSize, 'player');
  }
}
// ============================================================================
function drawCombatant(img, x, y, baseSize, target) {
  const s = baseSize * EffectManager.getScale(target); // 실제로 그릴 크기
  const c = EffectManager.getFlashColor(target); // 피격 됐을 때 색상
  if (c) tint(c[0], c[1], c[2], c[3]);
  image(img, x, y, s, s);
  noTint();
}

// ── HP 패널 ───────────────────────────────────────────────────────────
function drawBattleHPPanels() { //(완)
  const d = BattleManager.data;
  drawHPPanel(871, 210, '적', d.enemyHp,  d.enemyMaxHp,  'enemy');
  // aimSuccess 연출 중에는 HP바 숨김 (그 외에는 항상 표시 — 방어 중 피격 피드백)
  if (d.state !== 'aimSuccess') {
    drawHPPanel(290 + 120, 525 - 30, '나', d.playerHp, d.playerMaxHp, 'player', 0.8);
  }
}

function drawHPPanel(x, y, label, hp, maxHp, effectTarget, scale = 1.0) { // (완)
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
function drawCommandMenu() { // (8)
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
    image(imgAttack, CANVAS_W * 0.25, CANVAS_H * 0.86, 432, 144); // 공격 버튼 만들기
    image(imgEscape, CANVAS_W * 0.75, CANVAS_H * 0.86, 432, 144); // 도망 버튼 만들기
  });
}

// ── 기술 선택 메뉴 ────────────────────────────────────────────────────
function drawSkillMenu() { //(12)
  const py   = CANVAS_H * 0.65;
  const rowH = (CANVAS_H - py) / (SKILL_DEFS.length + 1); // 스킬 선택창 하나의 높이

  fill(14, 14, 26, 245); noStroke(); rect(0, py, CANVAS_W, CANVAS_H - py);

  for (let i = 0; i < SKILL_DEFS.length; i++) {
    const ry    = py + i * rowH; // 해당 스킬이 위치할 높이
    const hover = mouseY >= ry && mouseY < ry + rowH; // hover은 마우스가 해당 스킬 위에 있는지 나타내주는 boolean이다.
    const sk    = SKILL_DEFS[i]; // 현재 스킬

    fill(hover ? color(35, 55, 45) : color(20, 20, 36)); noStroke(); rect(0, ry, CANVAS_W, rowH); // 마우스가 호버하고 있으면 해당 칸 색을 변경
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
function drawEnemyTurn() { // (20)
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
//=========================================================================================================
function drawBtn(label, cx, cy, w, h, base, hover, fontSize) { // 버튼을 만드는 함수( ai가 야무지게 만들어줌 )
  fill(hitBtn(cx, cy, w, h) ? hover : base); noStroke(); rect(cx - w/2, cy - h/2, w, h, 9);
  fill(255); textAlign(CENTER, CENTER); textFont('monospace'); textSize(fontSize || 18);
  text(label, cx, cy);
}

// 제발 잘 되라
