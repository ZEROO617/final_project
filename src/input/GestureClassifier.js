// ════════════════════════════════════════════════════════════════════════════
// GestureClassifier.js — 손동작 ID 판정 (입력)
//
//   손 랜드마크 → 손동작 ID(0~9) 분류. 순수 데이터/계산만 담당.
//   HandTracker가 이 분류기를 호출한다. 외부 상태에 의존하지 않는다.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// § 0  GestureClassifier — 손동작 ID 판정 (데이터 기반, 완전 분리)
//
//   손동작 ID 표:
//     0=주먹  1=검지  2=검지+중지  3=검지+중지+약지  4=엄지제외전체
//     5=보자기  6=엄지  7=엄지+검지  8=엄지+새끼  9=엄지+검지+새끼
//
//   외부 노출:
//     GestureClassifier.classify(landmarks) → ID(0–9) | -1(미인식)
//     GestureClassifier.getName(id)         → 표시용 한글 이름
// ════════════════════════════════════════════════════════════════════════════

const GESTURE_NAMES = [
  '주먹',          // 0
  '검지',          // 1
  '검지+중지',     // 2
  '검지+중지+약지',// 3
  '엄지제외전체',  // 4
  '보자기',        // 5
  '엄지',          // 6
  '엄지+검지',     // 7
  '엄지+새끼',     // 8
  '엄지+검지+새끼',// 9
];

const GestureClassifier = (() => {
  // 비트 레이아웃: [엄지=4, 검지=3, 중지=2, 약지=1, 새끼=0]
  // 해당 비트가 1 = 해당 손가락 펴짐
  const GESTURE_DEFS = [
    { id: 0, mask: 0b00000 }, // 주먹
    { id: 1, mask: 0b01000 }, // 검지
    { id: 2, mask: 0b01100 }, // 검지+중지
    { id: 3, mask: 0b01110 }, // 검지+중지+약지
    { id: 4, mask: 0b01111 }, // 엄지제외전체
    { id: 5, mask: 0b11111 }, // 보자기
    { id: 6, mask: 0b10000 }, // 엄지
    { id: 7, mask: 0b11000 }, // 엄지+검지
    { id: 8, mask: 0b10001 }, // 엄지+새끼
    { id: 9, mask: 0b11001 }, // 엄지+검지+새끼
  ];

  // ─── 기준점을 PIP → MCP 로 변경 ────────────────────────────────────────
  //   PIP(pip·관절)와 tip 사이 거리 < MCP(손허리뼈)와 tip 사이 거리
  //   → MCP 기준일 때 y 차이가 ~3배 커져 잡음에 강해짐
  //   MediaPipe 손 랜드마크:
  //     검지 MCP=5  중지 MCP=9  약지 MCP=13  새끼 MCP=17
  const FINGER_JOINTS = [
    [8,  5],  // 검지: tip vs MCP
    [12, 9],  // 중지: tip vs MCP
    [16, 13], // 약지: tip vs MCP
    [20, 17], // 새끼: tip vs MCP
  ];

  // 비트 차이 개수 (Hamming distance)
  const hammingDist = (a, b) => {
    let x = a ^ b, n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  };

  return {
    classify(lm) {
      // 엄지: x 거리만 검사 (y 조건 제거 → 손 기울기·각도에 덜 민감)
      //   tip(4) 과 MCP(2) 의 x 거리가 0.04 이상이면 폄
      const thumbBit = abs(lm[4].x - lm[2].x) > 0.04 ? 1 : 0;

      // 검지~새끼: tip.y < MCP.y 이면 폄
      const fingerMask = FINGER_JOINTS.reduce(
        (acc, [tip, mcp], i) =>
          acc | (lm[tip].y < lm[mcp].y ? (1 << (3 - i)) : 0),
        0
      );

      const mask = (thumbBit << 4) | fingerMask;

      // 1차: 정확히 일치하는 제스처 반환
      for (const def of GESTURE_DEFS) {
        if (def.mask === mask) return def.id;
      }

      // 2차: 해밍 거리 1 이내(손가락 1개 오차)의 가장 가까운 제스처 반환
      //   → 손가락이 어중간하게 걸쳐 있어도 가장 유사한 제스처로 자동 매핑
      let best = -1, bestDist = 999;
      for (const def of GESTURE_DEFS) {
        const d = hammingDist(mask, def.mask);
        if (d < bestDist) { bestDist = d; best = def.id; }
      }
      return bestDist <= 1 ? best : -1;
    },
    getName: id => GESTURE_NAMES[id] ?? '?',
  };
})();


