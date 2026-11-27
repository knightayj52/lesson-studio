"use strict";
const kinds = [
  "수업 진행 PPT",
  "교수학습 과정안",
  "학생 활동지",
  "판서 가이드",
  "공책 정리 예시",
  "평가·루브릭",
];
const modelsOfTeaching = {
  "IB PYP": [
    "경험에서 질문 찾기",
    "개념을 통해 사례 탐구",
    "관점 연결하기",
    "생활 속 행동 정하기",
  ],
  "개념기반 탐구학습": [
    "사례 관찰",
    "공통 속성 분류",
    "개념 관계 일반화",
    "새 사례에 전이",
  ],
  "질문 중심 수업": [
    "궁금한 점 쓰기",
    "탐구 질문 다듬기",
    "근거를 들어 답하기",
    "후속 질문 만들기",
  ],
  "프로젝트 학습": [
    "해결할 문제 찾기",
    "해결안 설계",
    "시제품 공유",
    "피드백 반영",
  ],
  "토의·토론": ["쟁점 확인", "주장과 근거 준비", "반론 검토", "입장 재구성"],
  "실험·실습": ["예측하기", "조건을 정해 관찰", "결과 해석", "예측과 비교"],
  "일반 교과 수업": ["생각 열기", "자료 탐색", "설명 나누기", "배움 정리"],
};
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
function defaultDesign(project, lesson, index) {
  const level = /고등|고[1-3]/.test(project.grade)
    ? 2
    : /중학|중등|중[1-3]/.test(project.grade)
      ? 1
      : 0;
  const total = Math.max(
    4,
    Math.min(180, Math.round(Number(project.minutes) || [40, 45, 50][level])),
  );
  const topic = lesson.title || project.title || "이번 차시";
  const question = [
    "어떤 점을 보고 그렇게 생각했나요?",
    "두 자료에서 어떤 관계를 찾았으며 그 근거는 무엇인가요?",
    "이 설명이 성립하는 조건과 반례는 무엇인가요?",
  ][level];
  const moves =
    modelsOfTeaching[project.method] || modelsOfTeaching["일반 교과 수업"];
  const proof = [
    "그림이나 말로 관찰한 특징 한 가지를 설명한다.",
    "두 자료를 비교해 관계를 찾고 근거를 들어 설명한다.",
    "자료로 주장을 뒷받침하고 적용 조건이나 한계를 밝힌다.",
  ][level];
  const routines = {
    "IB PYP": [
      "내 경험과 연결되는 사례를 하나 그리고 궁금한 점을 붙인다.",
      "둘 이상의 사례를 관점·원인·책임 중 한 개념으로 살펴본다.",
      "친구의 관점과 내 관점을 비교하고 생각이 달라진 부분을 설명한다.",
      "배운 점을 생활에 적용할 행동 한 가지와 그 이유를 제안한다.",
    ],
    "개념기반 탐구학습": [
      "두 사례를 관찰해 주목한 속성을 표시한다.",
      "사례를 분류하고 분류 기준을 자신의 말로 설명한다.",
      "두 개념이 어떻게 연결되는지 문장으로 쓰고 사례로 점검한다.",
      "처음 보는 사례를 골라 일반화 문장이 적용되는지 검토한다.",
    ],
    "질문 중심 수업": [
      "관찰한 사실과 궁금한 점을 구분해 질문을 적는다.",
      "짝과 질문을 비교하고 탐구 가능한 질문 하나로 고친다.",
      "자료 속 근거를 골라 질문에 대한 잠정적인 답을 작성한다.",
      "친구의 답을 듣고 더 알아보고 싶은 후속 질문을 만든다.",
    ],
    "프로젝트 학습": [
      "사용자의 불편이나 필요를 한 문장으로 정리한다.",
      "해결 아이디어 두 가지를 비교하고 선택 기준을 정한다.",
      "간단한 모형이나 해결안 초안을 만들어 친구에게 설명한다.",
      "친구의 의견 중 한 가지를 반영하고 수정 이유를 기록한다.",
    ],
    "토의·토론": [
      "쟁점을 읽고 자신의 잠정적인 입장을 정한다.",
      "자료를 검토해 주장과 이를 지지하는 근거를 구분한다.",
      "상대 입장을 자신의 말로 요약한 뒤 근거를 들어 질문한다.",
      "토론 전후의 입장을 비교하고 바뀐 점과 남은 쟁점을 기록한다.",
    ],
    "실험·실습": [
      "결과를 예측하고 그렇게 생각한 까닭을 적는다.",
      "교사와 절차·안전을 확인한 뒤 조건을 구분해 관찰값을 기록한다.",
      "예측과 관찰값이 일치하는지 비교하고 차이가 난 이유를 제안한다.",
      "다시 확인하려는 조건 하나를 골라 다음 관찰을 계획한다.",
    ],
  };
  const actions = routines[project.method] || [
    topic + "에 관해 이미 아는 점과 궁금한 점을 한 가지씩 적는다.",
    topic + "에 관한 사례 두 가지를 살펴보고 닮은 점과 다른 점을 표시한다.",
    proof,
    "새로운 사례를 하나 골라 오늘의 설명이 적용되는지 확인한다.",
  ];
  const input = lesson.detail || "";
  const extract = (label) =>
    input
      .match(
        new RegExp("(?:^|\\n)" + label + "[　 \\t]*[:：][　 \\t]*([^\\n]+)"),
      )?.[1]
      ?.trim();
  const times = [0.15, 0.4, 0.3].map((r) => Math.max(1, Math.floor(total * r)));
  times.push(total - times.reduce((a, b) => a + b, 0));
  return {
    goal: extract("학습목표") || topic + "에 대해 " + proof,
    question: extract("탐구질문") || question,
    success: extract("성공기준") || proof,
    supplies: extract("준비물") || "비교할 사례 자료 두 가지, 필기구",
    stages: moves.map((name, i) => ({
      name,
      time: times[i],
      action: actions[i],
      prompt: [
        question,
        "어떤 부분에서 단서를 찾았나요?",
        "다른 설명도 가능할까요?",
        "처음 생각에서 무엇이 달라졌나요?",
      ][i],
      evidence: [
        "처음 질문",
        "탐구 기록",
        "근거를 담은 설명",
        "전이·성찰 기록",
      ][i],
      expected: [
        "기존 경험을 바탕으로 첫 생각을 제시한다.",
        "눈에 띄는 특징 한 가지에 집중할 수 있다.",
        "근거를 제시하거나 주장을 반복할 수 있다.",
        "처음 사례에만 적용하려 할 수 있다.",
      ][i],
      followUp: [
        "그 생각은 어떤 경험에서 나왔나요?",
        "다른 사례에서도 같은 특징이 나타나나요?",
        "그 근거가 설명을 어떻게 뒷받침하나요?",
        "조건이 달라져도 같은 설명이 가능할까요?",
      ][i],
      example: "",
    })),
  };
}
function validDesign(d) {
  return (
    d &&
    ["goal", "question", "success", "supplies"].every(
      (k) => typeof d[k] === "string",
    ) &&
    Array.isArray(d.stages) &&
    d.stages.length === 4 &&
    d.stages.every(
      (s) =>
        s &&
        ["name", "action", "prompt", "evidence"].every(
          (k) => typeof s[k] === "string",
        ) &&
        ["expected", "followUp", "example"].every(
          (k) => s[k] == null || typeof s[k] === "string",
        ) &&
        Number.isInteger(s.time) &&
        s.time >= 1 &&
        s.time <= 180,
    )
  );
}
function materialCards(kind, p, l, d, index) {
  const code = (i) => "L" + (index + 1) + "-A" + (i + 1);
  const cards = d.stages.map((s, i) => {
    const title = code(i) + " · " + s.name + " · " + s.time + "분";
    const notes =
      "교사 발문　" +
      s.prompt +
      "\n확인할 증거　" +
      s.evidence +
      "\n성공기준　" +
      d.success +
      (s.expected ? "\n예상 반응　" + s.expected : "") +
      (s.followUp ? "\n후속 발문　" + s.followUp : "");
    let body;
    switch (kind) {
      case 0:
        body = [s.prompt, s.action];
        break;
      case 1:
        body = [
          "학생 활동　" + s.action,
          "교사 발문　" + s.prompt,
          "평가 증거　" + s.evidence,
          ...(s.expected ? ["예상 반응　" + s.expected] : []),
          ...(s.followUp ? ["후속 발문　" + s.followUp] : []),
          "피드백　근거를 가리키고 자신의 설명을 보완하도록 한다.",
        ];
        break;
      case 2:
        body = [
          s.prompt,
          s.action,
          "내 기록　________________________________",
          "근거　　 ________________________________",
        ];
        break;
      case 3:
        body = [
          "왼쪽 · 질문　" + s.prompt,
          "가운데 · 함께 기록　" + s.evidence,
          "오른쪽 · 남겨 둘 생각　학생의 표현과 근거",
        ];
        break;
      case 4:
        body = [
          "오늘의 질문　" + s.prompt,
          s.example ||
            [
              "처음에는 ___라고 생각했다.",
              "자료에서 ___와 ___를 발견했다.",
              "두 사례를 보고 ___라고 설명했다. 근거는 ___이다.",
              "다음에는 ___인지 알아보고 싶다.",
            ][i],
        ];
        break;
      case 5:
        body = [
          "평가 과제　" + s.action,
          "관찰할 증거　" + s.evidence,
          "판단 기준　" + d.success,
          "독립 수행　활동 기록에서 기준을 스스로 충족한다.",
          "부분 수행　근거 또는 설명을 보완하면 기준에 도달한다.",
          "지원 필요　사례와 질문을 제공해 함께 수행한다.",
        ];
        break;
    }
    return { title, body, notes };
  });
  if (kind === 5)
    for (const src of (p.sources || []).filter((x) => x.kind === "전체")) {
      const levels = Object.entries(src.record || {}).filter(
        ([k, v]) => k.startsWith("성취수준") && v,
      );
      cards.push({
        title: src.record["성취기준 코드"] + " · 원본 성취수준",
        body: [
          "대조할 차시 증거　" +
            code(2) +
            " " +
            d.stages[2].evidence +
            " / " +
            code(3) +
            " " +
            d.stages[3].evidence,
          ...(levels.length
            ? levels.map(([k, v]) => k + "　" + v)
            : ["원본에 성취수준이 기재되지 않았습니다."]),
        ],
        notes: src.date,
      });
    }
  return cards;
}
