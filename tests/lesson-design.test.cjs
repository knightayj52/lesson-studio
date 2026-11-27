// Run with node --test tests/lesson-design.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const ctx = vm.createContext({});
for (const file of ["design.js", "examples.js"])
  vm.runInContext(readFileSync(join(__dirname, "..", file), "utf8"), ctx);
const { examples, defaultDesign, materialCards, validDesign, kinds } =
  vm.runInContext(
    "({examples,defaultDesign,materialCards,validDesign,kinds})",
    ctx,
  );
for (const project of examples)
  test(project.title, () => {
    const lesson = { title: project.title, detail: project.plan };
    const design = defaultDesign(project, lesson, 0);
    design.stages = project.rows.map(
      ([name, time, action, prompt, evidence, example], i) => ({
        ...design.stages[i],
        name,
        time,
        action,
        prompt,
        evidence,
        example,
      }),
    );
    assert.ok(validDesign(design));
    assert.equal(
      design.stages.reduce((n, s) => n + s.time, 0),
      Number(project.minutes),
    );
    const refs = {
      kind: "전체",
      date: "fixture",
      record: {
        "성취기준 코드": "[예시]",
        "성취수준 A (상)": "가상의 원문",
        "성취수준 B (중)": "",
      },
    };
    const all = kinds.map((_, k) =>
      materialCards(k, { ...project, sources: [refs] }, lesson, design, 0),
    );
    for (const cards of all)
      design.stages.forEach((s, i) => {
        assert.ok(cards[i].title.includes("L1-A" + (i + 1)));
        assert.ok(cards[i].title.includes(s.time + "분"));
      });
    assert.ok(all[0][1].notes.includes(design.stages[1].prompt));
    assert.ok(all[4][1].body.includes(design.stages[1].example));
    assert.ok(!all[2].some((c) => c.body.includes(design.stages[1].example)));
    assert.ok(all[5].at(-1).body.some((line) => line.includes("가상의 원문")));
    assert.ok(!all[5].at(-1).body.some((line) => line.includes("성취수준 B")));
  });
test("labeled goals in imported lesson detail are retained", () => {
  const d = defaultDesign(
    { grade: "초등", title: "자료 읽기" },
    { detail: "학습목표: 관찰값을 비교한다.\n준비물: 관찰 카드" },
    0,
  );
  assert.equal(d.goal, "관찰값을 비교한다.");
  assert.equal(d.supplies, "관찰 카드");
});

test("each standard uses only its designated evidence at the current lesson position", () => {
  const project = examples[1];
  const lesson = { evidenceLinks: { first: [1], second: [3] } };
  const design = defaultDesign(project, lesson, 1);
  const sources = ["first", "second", "third"].map(key => ({
    key, kind: "전체", record: { "성취기준 코드": key, "성취수준 A": "수준 " + key },
  }));
  const cards = materialCards(5, { ...project, sources }, lesson, design, 1).slice(4);
  assert.deepEqual(Array.from(cards, card => card.body.join(" ").match(/L2-A\d/g) || []).flat(), ["L2-A2", "L2-A4"]);
  assert.ok(cards[2].body.some(line => line.includes("연결한 활동 증거가 없습니다")));
  cards.forEach((card, i) => assert.ok(card.body.some(line => line.includes("수준 " + sources[i].key))));
});
