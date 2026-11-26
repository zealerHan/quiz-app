// 休假天数折算的单元测试
// 跑法：npm test
//
// 断言基准来自老韩验证过的真实案例，不是我自己编的数字：
//   韩颖 11-30~12-03「夜早休白」= 2.5 天（1 + 0.5 + 0 + 1）
//   谢安达 11-29~12-01「白夜早」= 2.5 天（1+1 + 0.5，拆成 2 + 0.5）
//   韩思成 12-03~12-10「白夜早休白夜早休」= 5 天（8 个自然日，两个正休不扣）
//
// 班次循环：白 → 夜 → 早 → 休（4 天一轮，2026 全年无例外）

const { test } = require('node:test');
const assert = require('node:assert');
const { calcDeductFromShifts } = require('../server/leaveDays');

// 造班次序列的小工具：给起始日期和班次数组，自动推日期
function mk(startDate, shifts) {
  const d = new Date(startDate + 'T00:00:00Z');
  return shifts.map((shift, i) => {
    const cur = new Date(d);
    cur.setUTCDate(cur.getUTCDate() + i);
    return { date: cur.toISOString().slice(0, 10), shift };
  });
}

// ── 单班次 ────────────────────────────────────────────
test('白班单独 = 1 天', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['白班']));
  assert.strictEqual(r.days, 1);
});

test('夜班单独（后面不是早班）= 1 天', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['夜班']));
  assert.strictEqual(r.days, 1);
});

test('早班单独（前面不是夜班）= 0.5 天', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['早班']));
  assert.strictEqual(r.days, 0.5);
});

test('正休 = 0 天（正休也是休假，但要显示、要销假）', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['休息']));
  assert.strictEqual(r.days, 0);
  assert.strictEqual(r.detail[0].deduct, 0);
});

// ── 连上班 ────────────────────────────────────────────
test('白夜连上 = 2 天', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['白班', '夜班']));
  assert.strictEqual(r.days, 2);
  assert.strictEqual(r.detail[0].pair, '白夜');
  assert.strictEqual(r.detail[1].pair, '白夜');
});

test('夜早连上 = 1.5 天（夜 1 + 早 0.5）', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['夜班', '早班']));
  assert.strictEqual(r.days, 1.5);
  assert.strictEqual(r.detail[0].deduct, 1);
  assert.strictEqual(r.detail[1].deduct, 0.5);
  assert.strictEqual(r.detail[1].pair, '夜早');
});

// ── 真实案例（断言基准来自实际休假单）──────────────────
test('韩颖 11-30~12-03 夜早休白 = 2.5 天', () => {
  // 11-30 夜、12-01 早、12-02 休、12-03 白
  const r = calcDeductFromShifts(mk('2026-11-30', ['夜班', '早班', '休息', '白班']));
  assert.strictEqual(r.days, 2.5, '夜1 + 早0.5 + 休0 + 白1 = 2.5');
});

test('谢安达 11-29~12-01 白夜早 = 2.5 天', () => {
  // 11-29 白、11-30 夜、12-01 早
  const r = calcDeductFromShifts(mk('2026-11-29', ['白班', '夜班', '早班']));
  assert.strictEqual(r.days, 2.5, '白夜连上2 + 早0.5 = 2.5');
});

test('韩思成 12-03~12-10 白夜早休白夜早休 = 5 天（8 个自然日）', () => {
  // 关键案例：早期 bug 按自然日算成 8 天，正确是 5 天
  const r = calcDeductFromShifts(
    mk('2026-12-03', ['白班', '夜班', '早班', '休息', '白班', '夜班', '早班', '休息'])
  );
  assert.strictEqual(r.detail.length, 8, '8 个自然日');
  assert.strictEqual(r.days, 5, '白夜2 + 早0.5 + 休0 + 白夜2 + 早0.5 + 休0 = 5');
});

test('完整一套班 白夜早休 = 2.5 天', () => {
  const r = calcDeductFromShifts(mk('2026-11-23', ['白班', '夜班', '早班', '休息']));
  assert.strictEqual(r.days, 2.5);
});

test('两套班 白夜早休白夜早休 = 5 天', () => {
  const r = calcDeductFromShifts(
    mk('2026-11-23', ['白班', '夜班', '早班', '休息', '白班', '夜班', '早班', '休息'])
  );
  assert.strictEqual(r.days, 5);
});

// ── 边界情况 ──────────────────────────────────────────
test('空数组返回 0 天并带 warning（班表没排到该日期）', () => {
  const r = calcDeductFromShifts([]);
  assert.strictEqual(r.days, 0);
  assert.deepStrictEqual(r.detail, []);
  assert.ok(r.warning, '应该提示没有班次数据');
});

test('全正休 = 0 天（休假条尾部自动吃紧跟正休）', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['休息', '休息', '休息']));
  assert.strictEqual(r.days, 0);
});

test('只截取白班不给配对（区间从夜班开始，前一天的早班不在范围）', () => {
  // 前面没有夜班，早班单独算 0.5
  const r = calcDeductFromShifts(mk('2026-12-01', ['早班', '休息', '白班']));
  assert.strictEqual(r.days, 1.5, '早0.5 + 休0 + 白1');
  assert.strictEqual(r.detail[0].pair, undefined, '早班没配对');
});

test('浮点累加不出 1.9999999999999998（0.5 三次 + 白 0.5）', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['早班', '休息', '早班', '休息', '早班']));
  assert.strictEqual(r.days, 1.5);
  assert.ok(Number.isFinite(r.days));
});

// ── 配对优先级 ────────────────────────────────────────
test('白夜早三连：白夜配对吃掉前两个，早班单独算 0.5', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['白班', '夜班', '早班']));
  assert.strictEqual(r.detail[0].pair, '白夜');
  assert.strictEqual(r.detail[1].pair, '白夜');
  assert.strictEqual(r.detail[2].deduct, 0.5, '早班单独 0.5');
  assert.strictEqual(r.days, 2.5);
});

test('夜早白：夜早先配对，白班后面没夜班就单独算 1', () => {
  const r = calcDeductFromShifts(mk('2026-12-01', ['夜班', '早班', '白班']));
  assert.strictEqual(r.detail[0].pair, '夜早');
  assert.strictEqual(r.detail[1].pair, '夜早');
  assert.strictEqual(r.detail[2].deduct, 1);
  assert.strictEqual(r.days, 2.5);
});

test('detail 的日期必须是升序且和输入一致', () => {
  const input = mk('2026-11-30', ['夜班', '早班', '休息', '白班']);
  const r = calcDeductFromShifts(input);
  assert.deepStrictEqual(r.detail.map(d => d.date), input.map(d => d.date));
});
