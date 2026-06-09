// ════════════════════════════════════════════════════════════════════════════
// HandTracker.js — 카메라 손 추적 + 조준 안정화 (입력)
//
//   MediaPipe Hands 래퍼: 손 위치/사분면/제스처를 매 프레임 갱신.
//   AimStabilizer: 손 좌표 떨림 보정 파이프라인(조준점 안정화).
//   GestureClassifier를 사용하고, 전투/방어 로직이 이 값을 읽어간다.
// ════════════════════════════════════════════════════════════════════════════

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
  useRawAim: false, // true면 보정 무시하고 원시 좌표 사용 (적2 전투)

  resetGestureBuffer() {
    this._bufGesture = [];
  },

  // 이게 타이틀 화면에서 보정할때 상태 체크하기 위해서 쓰는거.
  calibration: { isCalibrated: false, minX: 0.4, maxX: 0.6, minY: 0.4, maxY: 0.6 },

  // 제스처/구역 각각 독립 버퍼 (공유 시 두 채널이 서로 오염되는 버그 방지)
  _bufGesture: [],
  _bufRegion:  [],
  // ════════════════════════════════════════════════════════════════════════════
  init() {
    if (this.video) return;

    // 비디오 관련해서 초기 앨러먼트 생성.
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    // MediaPipe Hands 초기화 + 
    this.hands = new Hands({ locateFile: f => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f });
    this.hands.setOptions({ maxNumHands: 1, modelComplexity: 0,
                            minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    this.hands.onResults(r => this._onResults(r)); // onResult에 전달하는 건 원시 파이프라인 데이터

    // 카메라가 매 프레임 마다 손 동작 인식.
    this.camera = new Camera(this.video, {
      onFrame: async () => { await this.hands.send({ image: this.video }); }, // () =>요따구로 생긴거는 함수 표현식 단축 문법임.
      width: 320, height: 240,
    });
    this.camera.start();
    this._resetState();
  },
  // ════════════════════════════════════════════════════════════════════════════
  stop() {
    if (this.camera) { this.camera.stop(); this.camera = null; }
    if (this.hands)  { this.hands.close(); this.hands  = null; }
    if (this.video) {
      if (this.video.srcObject) this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.remove(); this.video = null;
    }
    this._resetState();
  },
  // ════════════════════════════════════════════════════════════════════════════
  _resetState() {
    this.landmarks    = null;
    this.gestureId    = -1;
    this.gesture      = '손을 보여주세요';
    this.currentRegion = 'CENTER';
    this._bufGesture  = [];
    this._bufRegion   = [];
  },
// ════════════════════════════════════════════════════════════════════════════
  _onResults(r) {
    if (!r.multiHandLandmarks || r.multiHandLandmarks.length === 0) { // 손 인식이 안돼었음
      this.landmarks  = null;
      this.gestureId  = -1;
      this.gesture    = '손을 보여주세요'; // 손 인식이 안될때 보여줄 텍스트
      this.currentRegion = 'CENTER';
      return;
    }

    this.landmarks = r.multiHandLandmarks[0];

    // 손동작 분류는 GestureClassifier 에 완전 위임 (GestureClassifier얘한테 손동작 분류하라고 넘기는 코드)
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

    // useRawAim: 보정 무시하고 원시 좌표(전체 카메라 범위) 사용
    let nx, ny;
    if (this.useRawAim) {
      nx = rawX;
      ny = rawY;
    } else {
      nx = map(rawX, this.calibration.minX, this.calibration.maxX, 0, 1, true);
      ny = map(rawY, this.calibration.minY, this.calibration.maxY, 0, 1, true);
    }
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

  // ════════════════════════════════════════════════════════════════════════════
  // 손 동작을 인식할때 여러 프레임의 평균값을 구해서 인식 안정성을 높이는 코드(버퍼)
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
  drawUI() { // (완)
    // 방어 or 카메라가 준비 안되어 있으면 실행 안되도록
    if (!this.video || this.video.readyState < 2) return;
    if (BattleManager.data.state === 'defendCasting') return;

    //웹캠 영상 좌우 반전.
    drawingContext.save();
    drawingContext.translate(HT_X + HT_W, HT_Y);
    drawingContext.scale(-1, 1);
    drawingContext.drawImage(this.video, 0, 0, HT_W, HT_H);
    drawingContext.restore();

    //미니 웹캠 테두리 지우기
    noFill(); noStroke();
    rect(HT_X, HT_Y, HT_W, HT_H, 4);

    if (this.landmarks) this._drawHandSkeleton(); //관절 스켈레톤 그리기

    // 손 인식 여부 확인
    const noHand = this.gestureId < 0;
    const labelH = 36;
    fill(0, 0, 0, 170); noStroke(); rect(HT_X, HT_Y + HT_H + 2, HT_W, labelH, 3);

    if (!noHand) { // 손이 인식된 경우(gestureId에 해당하는 이미지 보여주기)
      imageMode(CENTER);
      image(imgHandPose[this.gestureId],
            HT_X + HT_W / 2, HT_Y + HT_H + 2 + labelH / 2,
            labelH - 4, labelH - 4);
      imageMode(CORNER);
    } else { // 손이 인식 안된 경우 (이미지 대신 this.gesture에 저장된 텍스트를 표시.)
      fill(150, 150, 170); textFont('monospace'); textSize(13); textAlign(CENTER, CENTER);
      text(this.gesture, HT_X + HT_W / 2, HT_Y + HT_H + 2 + labelH / 2);
    }
  },

  //미니뷰 위에 손 관절 연결선 + 점을 그리는 코드.
  _drawHandSkeleton() {
    const C = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8], //어떤 관절끼리 선으로 이을지 정의한 배열. [0,1]은 0번과 1번 관절을 연결. MediaPipe 21개 관절 번호 기준.
               [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
               [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]]; 
    const lm = this.landmarks;
    
    //MediaPipe 좌표(0~1)를 미니뷰 픽셀 좌표로 변환. X는 거울효과를 위해 반전.
    const X  = i => HT_X + (1 - lm[i].x) * HT_W;
    const Y  = i => HT_Y + lm[i].y * HT_H;

    //C 배열의 쌍마다 선을 그림. 파란색.
    stroke(60, 180, 255, 200); strokeWeight(1.5);
    for (const [a, b] of C) line(X(a), Y(a), X(b), Y(b));
    noStroke(); fill(255, 220, 50);
    for (let i = 0; i < lm.length; i++) circle(X(i), Y(i), 6); //21개 관절 위치에 노란 점을 찍음.
  },
};


// 이게 원래 에임 보정이였는데 반응 속도가 느려지는 문제 때문에 없애놓음(대신 다른 코드들과의 호환성 때문에 변수자체를 없애지는 않음)
const AimStabilizer = {
  update()   {},
  isVisible: () => HandTracker.landmarks !== null,
  opacity:   () => 1.0,
  x:         () => HandTracker.handPos.x,
  y:         () => HandTracker.handPos.y,
};


