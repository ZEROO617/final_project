// ════════════════════════════════════════════════════════════════════════════
// 게임 전체에서 쓰이는 고정값들을 한 곳에 모아두는 곳이당
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

const CALIBRATION_TOTAL  = 300; // 손 동작 보정을 할 시간(프레임으로)
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


const STAGE_DEFS = [ // 딕셔너리 객체 2개를 품은 배열 ( 스테이지 정보를 담고 있음)
  { // 스테이지 1에 대한 정보들임, id는 나중에 Stage_defs
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
  // 
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


