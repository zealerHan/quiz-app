// test/helpers.test.js
//
// 班次推算 + 题型识别测试（2026-11-27 加）
//
// 为什么重要：
//   - getShiftInfo 算错 → 答题轮次（cycle）错位，一轮答题被拆成两轮，或者两轮并成一轮
//   - detectQuestionType 判错 → 题库题型统计全错，导出报表跟着错
// 两种错都静默发生，不会报错。
//
// ⚠️ 这个文件会 require server/helpers.js，进而 require server/db.js 并打开数据库，
//    所以在 Mac 上跑不了（Mac 的 better-sqlite3 二进制已失效，见 SKILL.md）。
//    必须到飞牛容器里跑：
//      docker exec -w /app peixun node --test test/helpers.test.js
//    容器里读的是生产库，所以下面所有用例都只读不写。

const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  getShiftInfo, calcPoints, detectQuestionType, TYPE_LABEL, isWorkday,
} = require("../server/helpers.js");

// ─── 班次推算 ────────────────────────────────────────────────
describe("getShiftInfo — 四班倒周期", () => {
  // 基准：2026-03-22 = 白班，白→夜→早→休 四天一循环
  const base = new Date("2026-03-22T12:00:00+08:00");

  test("基准日 2026-03-22 是白班（phase 0）", () => {
    const s = getShiftInfo(base);
    assert.equal(s.phase, 0);
    assert.equal(s.startStr, "2026-03-22");
    assert.equal(s.endStr, "2026-03-24");
  });

  test("四天循环：白(0) 夜(1) 早(2) 休(3)", () => {
    const phases = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      phases.push(getShiftInfo(d).phase);
    }
    assert.deepEqual(phases, [0, 1, 2, 3]);
  });

  test("第 5 天回到白班", () => {
    const d = new Date(base.getTime() + 4 * 86400000);
    assert.equal(getShiftInfo(d).phase, 0);
  });

  test("基准日之前也能正确取模（不出现负数 phase）", () => {
    for (let i = 1; i <= 8; i++) {
      const d = new Date(base.getTime() - i * 86400000);
      const s = getShiftInfo(d);
      assert.ok(s.phase >= 0 && s.phase <= 3, `phase 越界: ${s.phase}`);
    }
  });

  test("cycleId 格式为 cycle_YYYY-MM-DD", () => {
    const s = getShiftInfo(base);
    assert.match(s.cycleId, /^cycle_\d{4}-\d{2}-\d{2}$/);
    assert.equal(s.cycleId, "cycle_" + s.startStr);
  });

  test("一轮固定 3 天：startStr + 2 = endStr", () => {
    const dates = ["2026-03-22", "2026-06-15", "2026-11-27", "2027-01-01"];
    for (const ds of dates) {
      const s = getShiftInfo(new Date(ds + "T12:00:00+08:00"));
      const start = new Date(s.startStr + "T00:00:00Z");
      const end = new Date(s.endStr + "T00:00:00Z");
      const diff = (end - start) / 86400000;
      assert.equal(diff, 2, `${ds}: 轮次跨度应为 2 天，实际 ${diff}`);
    }
  });

  test("label 人话格式：M月D日—M月D日", () => {
    const s = getShiftInfo(base);
    assert.match(s.label, /^\d{1,2}月\d{1,2}日—\d{1,2}月\d{1,2}日$/);
  });

  test("跨月的轮次 label 能正确显示两个月", () => {
    // 找一个月末的日子
    const s = getShiftInfo(new Date("2026-03-30T12:00:00+08:00"));
    assert.match(s.label, /月/);
    // startStr 和 endStr 可能不在同一月
    assert.ok(s.startStr && s.endStr);
  });

  test("同一天不同时刻算出的 cycleId 相同（不受小时影响）", () => {
    const a = getShiftInfo(new Date("2026-11-27T09:00:00+08:00"));
    const b = getShiftInfo(new Date("2026-11-27T21:00:00+08:00"));
    assert.equal(a.cycleId, b.cycleId);
  });
});

// ─── 得分计算 ────────────────────────────────────────────────
describe("calcPoints", () => {
  test("四舍五入到整数", () => {
    assert.equal(calcPoints(66.67, 3).total, 67);
    assert.equal(calcPoints(33.33, 3).total, 33);
    assert.equal(calcPoints(0, 3).total, 0);
    assert.equal(calcPoints(100, 3).total, 100);
  });

  test(".5 进位（Math.round 行为）", () => {
    assert.equal(calcPoints(66.5, 3).total, 67);
    assert.equal(calcPoints(66.4, 3).total, 66);
  });

  test("bonus 恒为 0（加分逻辑已废）", () => {
    const p = calcPoints(80, 3);
    assert.equal(p.bonus, 0);
    assert.equal(p.base, p.total);
  });
});

// ─── 题型识别 ────────────────────────────────────────────────
describe("detectQuestionType — 选择题", () => {
  test("2 个选项且是 对/错 → 判断题", () => {
    assert.equal(detectQuestionType({
      text: "ATP 设备断电后应立即重启。",
      options: JSON.stringify({ A: "对", B: "错" }),
      reference: "A",
    }), "true_false");
  });

  test("2 个选项 正确/错误 → 判断题", () => {
    assert.equal(detectQuestionType({
      text: "某题",
      options: JSON.stringify({ A: "正确", B: "错误" }),
      reference: "B",
    }), "true_false");
  });

  test("4 个选项 + 单字母答案 → 单选", () => {
    assert.equal(detectQuestionType({
      text: "某题",
      options: JSON.stringify({ A: "1", B: "2", C: "3", D: "4" }),
      reference: "C",
    }), "choice_single");
  });

  test("4 个选项 + 多字母答案 → 多选", () => {
    assert.equal(detectQuestionType({
      text: "某题",
      options: JSON.stringify({ A: "1", B: "2", C: "3", D: "4" }),
      reference: "AC",
    }), "choice_multi");
  });

  test("答案带标点也能提取字母（A、C → 多选）", () => {
    assert.equal(detectQuestionType({
      text: "某题",
      options: JSON.stringify({ A: "1", B: "2", C: "3" }),
      reference: "A、C",
    }), "choice_multi");
  });

  test("options 传对象而不是字符串也能识别", () => {
    assert.equal(detectQuestionType({
      text: "某题",
      options: { A: "对", B: "错" },
      reference: "A",
    }), "true_false");
  });

  test("只有 1 个选项 → 不算选择题", () => {
    const t = detectQuestionType({
      text: "某题____",
      options: JSON.stringify({ A: "唯一" }),
      reference: "唯一答案",
    });
    assert.notEqual(t, "choice_single");
  });
});

describe("detectQuestionType — 填空 vs 简答", () => {
  test("有下划线占位 + 短答案 → 填空", () => {
    assert.equal(detectQuestionType({
      text: "列车进站前应确认____信号。",
      reference: "出站",
    }), "fill_blank");
  });

  test("有全角括号占位 + 短答案 → 填空", () => {
    assert.equal(detectQuestionType({
      text: "ATP 的中文全称是（　）。",
      reference: "列车自动防护",
    }), "fill_blank");
  });

  test("有【】占位 + 短答案 → 填空", () => {
    assert.equal(detectQuestionType({
      text: "发现异常应【　】处理。",
      reference: "立即停车",
    }), "fill_blank");
  });

  test("无占位 → 简答", () => {
    assert.equal(detectQuestionType({
      text: "请简述 ATP 故障的处置流程。",
      reference: "先报告，再确认，最后按规程处理",
    }), "short_answer");
  });

  test("有占位但答案过长（>30字）→ 简答", () => {
    assert.equal(detectQuestionType({
      text: "请说明____的原因。",
      reference: "这是一段很长的参考答案".repeat(5),
    }), "short_answer");
  });

  test("答案含分号 → 简答（多要点）", () => {
    assert.equal(detectQuestionType({
      text: "应确认____内容。",
      reference: "第一项；第二项",
    }), "short_answer");
  });

  test("空 reference + 有占位 → 简答（没法确认是填空）", () => {
    assert.equal(detectQuestionType({
      text: "请填____内容。",
      reference: "",
    }), "short_answer");
  });
});

describe("TYPE_LABEL", () => {
  test("五种类型都有中文标签", () => {
    const keys = ["choice_single", "choice_multi", "true_false", "fill_blank", "short_answer"];
    for (const k of keys) {
      assert.ok(TYPE_LABEL[k], `${k} 缺标签`);
      assert.equal(typeof TYPE_LABEL[k], "string");
    }
  });

  test("detectQuestionType 的返回值都在 TYPE_LABEL 里", () => {
    const samples = [
      { text: "a", options: JSON.stringify({A:"对",B:"错"}), reference: "A" },
      { text: "a", options: JSON.stringify({A:"1",B:"2",C:"3"}), reference: "A" },
      { text: "a", options: JSON.stringify({A:"1",B:"2",C:"3"}), reference: "AB" },
      { text: "a____", reference: "x" },
      { text: "简述", reference: "很长".repeat(20) },
    ];
    for (const s of samples) {
      const t = detectQuestionType(s);
      assert.ok(TYPE_LABEL[t], `返回值 ${t} 不在 TYPE_LABEL 里`);
    }
  });
});

// ─── 工作日判断（读库，只读）──────────────────────────────────
describe("isWorkday — 调休感知", () => {
  test("普通周三算工作日", () => {
    // 2026-11-25 是周三
    assert.equal(isWorkday("2026-11-25"), true);
  });

  test("普通周六不算工作日", () => {
    // 2026-11-28 是周六
    assert.equal(isWorkday("2026-11-28"), false);
  });

  test("普通周日不算工作日", () => {
    // 2026-11-29 是周日
    assert.equal(isWorkday("2026-11-29"), false);
  });

  test("返回布尔值，不会是 undefined", () => {
    const v = isWorkday("2026-11-25");
    assert.equal(typeof v, "boolean");
  });
});
