// test/leaveRights.test.js
//
// 假期权益计算测试（2026-11-27 加）
//
// 为什么这个文件最重要：婚假/陪产假/育儿假的额度算错了不会报错，
// 只会让某个人默默多休或少休几天。这种错没人当场发现，等发现时已经休完了。
//
// 规则来源写在 server/leaveRights.js 头部（武汉市政府官方答复 + 鄂卫办通〔2021〕74号）。
// 下面的用例尽量对齐官方算例，而不是对齐"代码现在的行为"——后者等于自己证明自己。

const { test, describe } = require("node:test");
const assert = require("node:assert");
const R = require("../server/leaveRights.js");

// ─── 基础日期工具 ─────────────────────────────────────────────
describe("日期工具", () => {
  test("addDays 跨月", () => {
    assert.equal(R.addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(R.addDays("2026-03-01", -1), "2026-02-28");
  });

  test("addDays 跨年", () => {
    assert.equal(R.addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(R.addDays("2026-01-01", -1), "2025-12-31");
  });

  test("addDays 闰年 2 月", () => {
    assert.equal(R.addDays("2024-02-28", 1), "2024-02-29"); // 2024 闰年
    assert.equal(R.addDays("2025-02-28", 1), "2025-03-01"); // 2025 平年
  });

  test("addMonths 月末溢出取当月最后一天", () => {
    // 1-31 加一月，2 月没有 31 号 → 取 2-28（平年）
    assert.equal(R.addMonths("2025-01-31", 1), "2025-02-28");
    // 闰年则取 2-29
    assert.equal(R.addMonths("2024-01-31", 1), "2024-02-29");
    // 3-31 加一月 → 4-30
    assert.equal(R.addMonths("2025-03-31", 1), "2025-04-30");
  });

  test("addMonths 负数回退", () => {
    assert.equal(R.addMonths("2026-03-31", -1), "2026-02-28");
    assert.equal(R.addMonths("2026-01-15", -1), "2025-12-15");
  });

  test("daysBetween 含头含尾", () => {
    assert.equal(R.daysBetween("2026-01-01", "2026-01-01"), 1); // 同一天 = 1 天
    assert.equal(R.daysBetween("2026-01-01", "2026-01-02"), 2);
    assert.equal(R.daysBetween("2026-01-01", "2026-12-31"), 365); // 平年
    assert.equal(R.daysBetween("2024-01-01", "2024-12-31"), 366); // 闰年
  });

  test("非法日期返回 null / 0，不抛异常", () => {
    assert.equal(R.addDays("", 1), null);
    assert.equal(R.addDays(null, 1), null);
    assert.equal(R.addDays("abc", 1), null);
    assert.equal(R.daysBetween("bad", "2026-01-01"), 0);
  });
});

// ─── 育儿假：按自然年度切 ────────────────────────────────────
describe("育儿假周期（官方算例：孩子 2020-02-22 出生）", () => {
  const cycles = R.parentalCycles("2020-02-22", 10);

  test("末年截止在满 3 岁当天或前一天（见下方 NOTE）", () => {
    const last = cycles[cycles.length - 1];
    // NOTE: 代码算 2023-02-21（满3岁前一天），但武汉市政府官方算例写的是 2023.2.22。
    // 两种解释：
    //   A. "3岁以下"= 未满3周岁 → 满3岁当天不能用 → 2023-02-21（当前实现）
    //   B. 官方算例字面 → 满3岁当天还能用 → 2023-02-22
    // 这涉及每个人能不能多休一天，等老韩定论。此处先按当前实现断言，
    // 定论后改这一行 + leaveRights.js 的 parentalCycles()。
    assert.equal(last.end, "2023-02-21");
  });

  test("首年从出生日起算", () => {
    assert.equal(cycles[0].start, "2020-02-22");
    assert.equal(cycles[0].is_first, true);
  });

  test("中间整年是 1-1 到 12-31", () => {
    const c2021 = cycles.find(c => c.year === 2021);
    assert.equal(c2021.start, "2021-01-01");
    assert.equal(c2021.end, "2021-12-31");
    const c2022 = cycles.find(c => c.year === 2022);
    assert.equal(c2022.start, "2022-01-01");
    assert.equal(c2022.end, "2022-12-31");
  });

  test("每个周期都是 10 天（不按子女数量叠加）", () => {
    cycles.forEach(c => assert.equal(c.days, 10));
  });

  test("周期之间不重叠、不留缝", () => {
    for (let i = 1; i < cycles.length; i++) {
      const prev = cycles[i - 1], cur = cycles[i];
      // 上一段结束的次日 = 这一段开始
      assert.equal(R.addDays(prev.end, 1), cur.start,
        `第 ${i} 段与前一段之间有空隙或重叠`);
    }
  });

  test("总周期数：2020 出生 → 4 段（2020、2021、2022、2023）", () => {
    assert.equal(cycles.length, 4);
  });

  test("只有最后一段 is_last", () => {
    cycles.forEach((c, i) => {
      assert.equal(c.is_last, i === cycles.length - 1);
    });
  });

  test("出生在年末（12-31）：首年只有 1 天有效期，仍是 10 天额度", () => {
    const c = R.parentalCycles("2020-12-31", 10);
    assert.equal(c[0].start, "2020-12-31");
    assert.equal(c[0].end, "2020-12-31");
    assert.equal(c[0].days, 10); // 额度不减，只是能用的时间窗口短
  });

  test("异常日期不死循环", () => {
    const c = R.parentalCycles("1900-01-01", 10);
    assert.ok(Array.isArray(c));
    assert.ok(c.length < 20, "周期数异常多，可能死循环");
  });

  test("空日期返回空数组", () => {
    assert.deepEqual(R.parentalCycles("", 10), []);
    assert.deepEqual(R.parentalCycles(null, 10), []);
  });
});

// ─── computeRight：三类假的计算 ──────────────────────────────
describe("computeRight — 婚假", () => {
  const right = { kind: "marriage", event_date: "2026-01-01", total_days: 15 };

  test("领证日起 365 天有效（第 365 天是 12-31）", () => {
    const r = R.computeRight(right, "2026-06-01");
    assert.equal(r.cycleStart, "2026-01-01");
    assert.equal(r.cycleEnd, "2026-12-31"); // 1-1 + 364 天
    assert.equal(r.active, true);
    assert.equal(r.expired, false);
  });

  test("最后一天仍有效", () => {
    const r = R.computeRight(right, "2026-12-31");
    assert.equal(r.active, true);
    assert.equal(r.expired, false);
  });

  test("次日过期", () => {
    const r = R.computeRight(right, "2027-01-01");
    assert.equal(r.active, false);
    assert.equal(r.expired, true);
    assert.match(r.expireLabel, /过期/);
  });
});

describe("computeRight — 陪产假", () => {
  const right = { kind: "paternity", event_date: "2026-01-15", total_days: 15 };

  test("出生日起 3 个月（到 4-14）", () => {
    const r = R.computeRight(right, "2026-02-01");
    assert.equal(r.cycleStart, "2026-01-15");
    assert.equal(r.cycleEnd, "2026-04-14"); // 1-15 +3月 -1天 = 4-15 -1 = 4-14
    assert.equal(r.active, true);
  });

  test("月末出生不越界（1-31 出生 → 4-29 截止）", () => {
    const r = R.computeRight({ kind: "paternity", event_date: "2025-01-31", total_days: 15 }, "2025-02-01");
    // 1-31 +3月 = 4-30，-1天 = 4-29
    assert.equal(r.cycleEnd, "2025-04-29");
  });

  test("过期判断", () => {
    assert.equal(R.computeRight(right, "2026-04-14").active, true);
    assert.equal(R.computeRight(right, "2026-04-15").expired, true);
  });
});

describe("computeRight — 育儿假（按今天落在哪个周期）", () => {
  const right = { kind: "parental", event_date: "2024-05-10", total_days: 10 };

  test("首年内可用", () => {
    const r = R.computeRight(right, "2024-08-01");
    assert.equal(r.active, true);
    assert.equal(r.cycleStart, "2024-05-10");
    assert.equal(r.cycleEnd, "2024-12-31");
    assert.equal(r.total, 10);
  });

  test("次年整年", () => {
    const r = R.computeRight(right, "2025-06-01");
    assert.equal(r.cycleStart, "2025-01-01");
    assert.equal(r.cycleEnd, "2025-12-31");
    assert.equal(r.active, true);
  });

  test("满 3 岁后全部过期", () => {
    const r = R.computeRight(right, "2028-01-01");
    assert.equal(r.active, false);
    assert.equal(r.expired, true);
    assert.match(r.reason, /满 3 岁|已结束/);
  });

  test("出生前：未生效", () => {
    const r = R.computeRight(right, "2024-05-09");
    assert.equal(r.active, false);
    // 还没出生，不该算"已过期"
    assert.equal(r.expired, false);
  });
});

describe("computeRight — 边界与异常", () => {
  test("没填事件日期：按无期限处理，不算过期", () => {
    const r = R.computeRight({ kind: "marriage", event_date: null, total_days: 15 }, "2026-06-01");
    assert.equal(r.active, true);
    assert.equal(r.expired, false);
    assert.match(r.reason, /未填/);
  });

  test("未知类型：原样返回，不参与计算", () => {
    const r = R.computeRight({ kind: "unknown_kind", event_date: "2026-01-01", total_days: 5 }, "2026-06-01");
    assert.equal(r.total, 5);
    assert.equal(r.active, true);
  });

  test("total_days 是字符串也能算", () => {
    const r = R.computeRight({ kind: "marriage", event_date: "2026-01-01", total_days: "15" }, "2026-06-01");
    assert.equal(r.total, 15);
  });
});

// ─── summarizeRights：多条权益怎么选 ─────────────────────────
describe("summarizeRights", () => {
  test("无权益返回 null", () => {
    assert.equal(R.summarizeRights([], 0, "2026-06-01"), null);
    assert.equal(R.summarizeRights(null, 0, "2026-06-01"), null);
  });

  test("剩余 = 额度 - 已休", () => {
    const s = R.summarizeRights(
      [{ id: 1, kind: "marriage", event_date: "2026-01-01", total_days: 15 }],
      3,
      "2026-06-01"
    );
    assert.equal(s.total, 15);
    assert.equal(s.used, 3);
    assert.equal(s.left, 12);
  });

  test("已休超过额度时剩余归零，不出现负数", () => {
    const s = R.summarizeRights(
      [{ id: 1, kind: "marriage", event_date: "2026-01-01", total_days: 15 }],
      20,
      "2026-06-01"
    );
    assert.equal(s.left, 0);
  });

  test("半天保留一位小数", () => {
    const s = R.summarizeRights(
      [{ id: 1, kind: "marriage", event_date: "2026-01-01", total_days: 15 }],
      2.5,
      "2026-06-01"
    );
    assert.equal(s.used, 2.5);
    assert.equal(s.left, 12.5);
  });

  test("多条权益不叠加：取当前有效且额度最大的那条", () => {
    // 官方明确「不按子女数量叠加」（鄂卫办通〔2021〕74号）
    const s = R.summarizeRights(
      [
        { id: 1, kind: "parental", event_date: "2024-05-10", total_days: 10 },
        { id: 2, kind: "parental", event_date: "2023-01-01", total_days: 10 }, // 已过期
      ],
      0,
      "2025-06-01"
    );
    assert.equal(s.total, 10, "两条育儿假不能加成 20 天");
  });

  test("全部过期时取最后一条并标记 expired", () => {
    const s = R.summarizeRights(
      [{ id: 1, kind: "marriage", event_date: "2020-01-01", total_days: 15 }],
      0,
      "2026-06-01"
    );
    assert.equal(s.expired, true);
    assert.equal(s.active, false);
  });

  test("rights 明细里带上每条的状态", () => {
    const s = R.summarizeRights(
      [
        { id: 1, kind: "marriage", event_date: "2020-01-01", total_days: 15 }, // 过期
        { id: 2, kind: "marriage", event_date: "2026-01-01", total_days: 15 }, // 有效
      ],
      0,
      "2026-06-01"
    );
    assert.equal(s.rights.length, 2);
    assert.equal(s.rights[0].expired, true);
    assert.equal(s.rights[1].expired, false);
  });
});
