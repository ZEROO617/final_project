// ════════════════════════════════════════════════════════════════════════════
// GameScreens.js — 오버월드 화면 & 스테이지 관리 (UI)
//
//   타이틀/보정/일시정지/게임(맵 이동) 화면 렌더 + 스테이지 전환/충돌 로직.
//   initStage·updateGameInput으로 적과 만나면 BattleManager 전투로 넘긴다.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// § 7.5  스테이지 관리
// ════════════════════════════════════════════════════════════════════════════

// 플레이어가 포털 반경 안에 들어왔는지 판정 (한 곳에서만 dist 호출)
function isNearPortal(portal) {
  return dist(player.x, player.y, portal.x, portal.y) < portal.r;
}
// ===================================================================================================================
function isInBlockedZone(x, y) {
  return STAGE1_BLOCKED.some(z => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
}
// ===================================================================================================================
// 지정 스테이지로 초기화: 적 생성 · 플레이어 중앙 복귀 · 상태 리셋
function initStage(id) {
  currentStage   = id;
  enemies        = STAGE_DEFS[id - 1].spawnEnemies(); // STAGE_DEFS는 배열이니까 스테이지가 1이라면 [0]을 호출해 줘야함.
  battleEnemy    = null; // 꼬이는거 방지로 전투 중인 적이 없다고 초기화 해주는거
  gPlayerHp      = 100; // 스테이지 시작/보스 진입 시 체력 풀회복

  if (id === 1) { // 스테이지 별로 플레이어 위치 설정
    player.x = 536;
    player.y = 2116;
    fadeAlpha = 255;
  } else {
    player.x = MAP_W / 2;
    player.y = MAP_H / 2 + 100;
  }

  escapeCooldown = 0; // 적과 도망쳤을 때 다시 바로 전투가 되지 않도록 하는 쿨다운을 초기화 해주기
}


// ════════════════════════════════════════════════════════════════════════════
// 화면들 (타이틀 / 보정 / 일시정지 / 게임)
// ════════════════════════════════════════════════════════════════════════════

function drawTitle() { // 타이틀 화면 그리기(이미지로) (2)
  imageMode(CORNER); 
  image(imgMain, 0, 0, CANVAS_W, CANVAS_H); 
}
// ════════════════════════════════════════════════════════════════════════════
function drawTvOff() { // (5)
  // 타이틀 배경 유지
  imageMode(CORNER);
  image(imgMain, 0, 0, CANVAS_W, CANVAS_H);

  const prog    = 1 - tvOffTimer / 60;          // 0→1 진행도
  const stripH  = CANVAS_H * pow(1 - prog, 2);  // 점점 얇아지는 세로 폭
  const centerY = CANVAS_H / 2;


  // 중앙 흰색 빛줄기 (Tv효과) - 딸깍
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
// ════════════════════════════════════════════════════════════════════════════
function drawCalibration() { // 조정 창. 그리기 (4)
  background(20, 20, 35);
  if (--calTimer <= 0) { // 조정 시간이 끝났을때.
    HandTracker.calibration.isCalibrated = true;
    // TV 꺼짐 연출 → initStage(1) + 페이드인 순서로 진행
    state      = 'tvOff';
    tvOffTimer = 60;
    return;
  }

  // 웹캠 좌우 반전 보정(중요X)
  const vw = 480, vh = 360;
  const vx = CANVAS_W / 2 - vw / 2, vy = 140;
  if (HandTracker.video && HandTracker.video.readyState >= 2) {
    drawingContext.save();
    drawingContext.translate(vx + vw, vy); drawingContext.scale(-1, 1);
    drawingContext.drawImage(HandTracker.video, 0, 0, vw, vh);
    drawingContext.restore();
  }
  noFill(); stroke(80, 200, 120); strokeWeight(3); rect(vx, vy, vw, vh, 8);

  // 인식 화면에서 텍스트를 띄워주기
  textAlign(CENTER, CENTER); textFont('monospace'); noStroke();
  fill(255); textSize(28); text('동적 인식 범위 보정', CANVAS_W / 2, 70);
  fill(160, 190, 255); textSize(18);
  text('손을 상/하/좌/우 최대한 크고 넓게 움직이세요', CANVAS_W / 2, vy + vh + 50);

  // 보정 진행도를 표시해주는거
  const prog = calTimer / CALIBRATION_TOTAL;
  const bw = 480, bx = CANVAS_W / 2 - bw / 2, by = vy + vh + 100;
  fill(40, 40, 60); rect(bx, by, bw, 16, 8);
  fill(80, 210, 130); rect(bx, by, bw * prog, 16, 8);
}
// ════════════════════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════════════════════
// 게임 상태일때 호출됨
function drawGame() { // (6)
  if (state === 'game') updateGameInput(); // esc눌렀을 때는 작동 안되고 게임상태일때만 작동하도록. (6-1)

  const stageDef = STAGE_DEFS[currentStage - 1];
  const { mapW, mapH } = stageDef;

  // 플레이어를 카메라 중앙에 오도록
  camX = constrain(player.x - CANVAS_W / 2, 0, mapW - CANVAS_W);
  camY = constrain(player.y - CANVAS_H / 2, 0, mapH - CANVAS_H);

  push();
    translate(-camX, -camY);
    imageMode(CORNER);

    if (currentStage === 1) { // 스테이지1일 때 이미지 가져오기
      image(imgStage1, 0, 0);
    } else { // 스테이지가 2 혹은 그 이상일 때 이미지 가져오기
      image(stageDef.getBg(), 0, 0, CANVAS_W, CANVAS_H);
    }

    imageMode(CENTER);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.active === false) continue; // 디버그: 비활성 적은 렌더 제외
      const breathe   = 1 + sin(frameCount * 0.04 + i * 1.3) * 0.04; // sin으로 숨쉬듯이 세로를 조절
      const drawW     = e.size;
      const drawH     = e.size * breathe;

      drawEllipseShadow(e.x + 5, e.y + e.size * 0.45 - 10, e.size * 0.825, e.size * 0.21);

      const enemyImg = e.isBoss      ? imgBoss // 적 종류에 따라서 이미지를 선택 해서 그림
                    : e.img === 'enemy1' ? imgEnemy1
                    : e.img === 'enemy2' ? imgEnemy2
                    : e.img === 'enemy3' ? imgEnemy3
                    : imgEnemy;
      image(enemyImg, e.x, e.y, drawW, drawH);
    }

    // 그림자
    drawEllipseShadow(player.x + 5, player.y + player.size * 0.45, player.size * 0.55, player.size * 0.14);

    // 플레이어 위치에 애니메이션 그리기.
    const charFrames = imgChar[lastDir] ?? imgChar.idle;
    const playerImg  = isMoving ? charFrames[0] : charFrames[floor(animTick / 20) % 2];
    image(playerImg, player.x, player.y, player.size, player.size);
  pop();

  drawVignette();

  if (fadeAlpha > 0) { // 스테이지 진입시 나타나는 페이드 효과.
    noStroke(); fill(0, 0, 0, fadeAlpha);
    rect(0, 0, CANVAS_W, CANVAS_H);
    fadeAlpha = max(0, fadeAlpha - 3);
  }

  drawHUD();
}
// ===================================================================================================================
function drawVignette() { // 비네트 효과 주기
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
// ===================================================================================================================
// 캐릭터 움직임을 계산
function updateGameInput() { // (6-1)
  isMoving = false;
  const oldX = player.x, oldY = player.y; // 제한구역에서 플레이어를 롤백 시키기 위해서 있음
  // 플레이어 이덩( 이건 당연하지 )
  if (keyIsDown(87) || keyIsDown(UP_ARROW))    { player.y -= SPEED; isMoving = true; lastDir = 'back'; }
  if (keyIsDown(83) || keyIsDown(DOWN_ARROW))  { player.y += SPEED; isMoving = true; lastDir = 'idle'; }
  if (keyIsDown(65) || keyIsDown(LEFT_ARROW))  { player.x -= SPEED; isMoving = true; lastDir = 'left'; }
  if (keyIsDown(68) || keyIsDown(RIGHT_ARROW)) { player.x += SPEED; isMoving = true; lastDir = 'right'; }
  animTick++;

  const { mapW: curMapW, mapH: curMapH } = STAGE_DEFS[currentStage - 1]; // STAGE_DEFS에서 mapW랑 mapH를 가져와서 curMapW랑 cupMapH에 저장하기.
  player.x = constrain(player.x, player.size / 2, curMapW - player.size / 2);
  player.y = constrain(player.y, player.size / 2, curMapH - player.size / 2);

  // 제한 구역 구현(중요X)
  if (currentStage === 1 && isInBlockedZone(player.x, player.y)) {
    if (isInBlockedZone(oldX, player.y)) player.y = oldY;
    if (isInBlockedZone(player.x, oldY)) player.x = oldX;
    if (isInBlockedZone(player.x, player.y)) { player.x = oldX; player.y = oldY; }
  }

  // 적 충돌 쿨타임
  if (escapeCooldown > 0) { escapeCooldown--; return; }

  // 스테이지 전환: 적 3기 모두 처치(enemies 비었음) + 포털 반경 진입 시만 처리
  // 적이 하나라도 남아 있으면 포털 잠금 (테스트용 STAGE2 버튼은 예외)
  const curDef = STAGE_DEFS[currentStage - 1];
  if (curDef.portal && curDef.nextStage && enemies.length === 0 && isNearPortal(curDef.portal)) { // 스테이지에 포탈이 존재하고, 다음 스테이지가 있고, 현재 적이 0기이고 근처에 포탈이 있으면
    initStage(curDef.nextStage); // initStage는 스테이지를 그리는 함수고  curDef 즉 STAGE_DEFS[currentStage - 1]현재 스테이지에 해당하는 딕셔너리에 있는 next stage 번호를 받아오는 거네
    return;                      // 사실 그냥 2로 해도 되긴하는데(왜냐하면 포탈을 1->2로 넘어가는 거밖에 없으니까.) 나중에 스테이지가 늘어날 가능성을 염두해 두어서 이렇게 확장 가능하게 코딩했네.
  }

    for (const e of enemies) { // for(const OO of OO) {} 자체가 특정 배열을 돌면서 값을 꺼내 쓴다는 for문임.
      if (e.active === false) continue; // 디버그: 비활성 적은 충돌 제외
      if (dist(player.x, player.y, e.x, e.y) < (player.size + e.size) / 2) { // 플레이어 적 충돌 즉 전투 시작
        battleEnemy = e; BattleManager.init(); // (7)
        BattleManager.data.playerHp = gPlayerHp; // 영속 체력 이어받기

        if (e.isBoss) BattleManager.startBoss();  // 보스: 실시간 전투 진입

        state = 'battle';
        // 전투시에는 bgm전환.
        if (bgm) { bgm.setVolume(0.25); bgm.loop(); }
        return;
      }
    }
}
// ===================================================================================================================
function drawHUD() {
  fill(0, 0, 0, 140); noStroke(); rect(12, 12, 240, 44, 8);
  fill(180, 200, 220); textSize(14); textFont('monospace'); textAlign(LEFT, CENTER);
  text('player : (' + round(player.x) + ', ' + round(player.y) + ')', 22, 34);

  if (currentStage === 1) { // 2스테이지 이동 버튼
    const bw = 120, bh = 36, bx = CANVAS_W - bw - 12, by = 12;
    fill(200, 80, 80, 200); noStroke(); rect(bx, by, bw, bh, 6);
    fill(255); textSize(14); textFont('monospace'); textAlign(CENTER, CENTER);
    text('STAGE 2 →', bx + bw / 2, by + bh / 2);
  }
}


