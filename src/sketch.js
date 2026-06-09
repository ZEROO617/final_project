// 실행 순서 1

// 변수들 선언(전역 변수만)
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


// 사용하는 모든 이미지를 로드
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
  // for문으로 손동작들 / 적 애니메이션 로드
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

// 캔버스 사이즈 세팅
function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  randomSeed(99);
  if (typeof outputVolume === 'function') outputVolume(0.6); // 전체 마스터 볼륨 60%
  initStage(1);
}


function draw() {
  // 웹캠을 사용하는 화면에 진입할 때만 키도록(리소스 절약) - ai
  const needCam     = (state === 'battle' || state === 'calibration');
  const prevNeedCam = (prevState === 'battle' || prevState === 'calibration');
  if (!prevNeedCam &&  needCam) HandTracker.init();
  if ( prevNeedCam && !needCam) HandTracker.stop();
  prevState = state;

  // screenDrawers이라는 Dictionary를 만들고 거기에다가 화면(상태)별 함수를 넣어놓는다.
  const screenDrawers = {
    title:       () => drawTitle(), //타이틀 화면에서 이미지 로드하기 함수 (1)
    tvOff:       () => drawTvOff(), // (5)
    calibration: () => drawCalibration(), // (4)
    game:        () => drawGame(), // (6)
    pause:       () => { drawGame(); drawPauseMenu(); },
    battle:      () => drawBattle(), // BattleRenderer.js에 있음 (9)
    victory:     () => drawVictory(),
    defeat:      () => drawDefeat(),
  };
  screenDrawers[state]?.(); //현재 상태의 화면 함수를 호출(if, else if 계속 쓰는 것보다 Dictionary가 	코드 가독성, 유지보수에 좋음)
}

// esc를 눌렀을 때 나오는 창.
function keyPressed() {
  if (keyCode === ESCAPE) {
    if      (state === 'game')  state = 'pause';
    else if (state === 'pause') state = 'game';
  }
}


function mousePressed() {
  if (state === 'title') { // (3)
    if (!HandTracker.calibration.isCalibrated) { //손 동작 보정을 하고 있는 상황이 아닐때
      state    = 'calibration'; // 조정으로 바꾸고.
      calTimer = CALIBRATION_TOTAL; // 정해진 프레이 만큼 보정할것임.
      Object.assign(HandTracker.calibration, { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 }); // 손동작 보정 화면을 초기화 해주기(손이 중심에 오게) - ai
    } else { // GameScreens.js의 drawCalibration()에서 자동으로 state를 'tvOff'로 바꾸지만 esc를 눌러서 타이틀로 왔을 때를 대비해서 존재합니당
      state      = 'tvOff'; // Tv꺼지는 효과 재생
      tvOffTimer = 60; // Tv가 나오는 프레임 0으로 설정
    }
  }

  else if (state === 'pause')   { if (hitBtn(CANVAS_W / 2, CANVAS_H / 2 + 10, 260, 56)) state = 'title'; } // 멈춘 상태에서 메뉴가기 버튼이 눌리면 메뉴로 돌아가기
  else if (state === 'battle')  BattleManager.handleClick(); // 전투 상태이면 battlemanager의 hadleclick로 떠넘기기 (10)
  else if (state === 'victory' || state === 'defeat') { initStage(1); state = 'title'; } // 승리 했거나 패배했을 때 타이틀 화면으로 가게 하기 (GameScreen(initStage) -> cinstants(STAGE_DEFS))
  else if ((state === 'game') && currentStage === 1) {

    // 디버그 : 스테이지 2로 이동하는 숏컷 버튼
    const bw = 120, bh = 36, bx = CANVAS_W - bw - 12, by = 12;
    if (mouseX >= bx && mouseX <= bx + bw && mouseY >= by && mouseY <= by + bh) {
      initStage(2); state = 'game';
      return;
    }

    // 디버그: 적 클릭 시 활성/비활성 토글 (월드 좌표로 변환해 판정) - ai
    const wx = mouseX + camX, wy = mouseY + camY;
    for (const e of enemies) {
      if (dist(wx, wy, e.x, e.y) < e.size / 2) {
        e.active = (e.active === false); // false→true, 그 외→false
        break;
      }
    }
  }
}


