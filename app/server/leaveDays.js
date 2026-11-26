// 休假天数折算 —— 纯函数，不碰数据库
//
// 为什么单独拆出来：这段逻辑决定每个人扣几天假，算错就是实际纠纷。
// 但它原来嵌在 routes/leave.js 里，第一个参数是 db 查询，
// 想测只能连真库、造真数据、改完再删 —— 所以一直没人测。
// 现在拆成「输入班次数组 → 输出每天扣几天」，可以脱离数据库直接断言。
//
// 折算口径（老韩 2026-11-25 定，所有假别统一）：
//   白班        1
//   夜班        1
//   早班        0.5
//   白夜连上    2   (白1 + 夜1)
//   夜早连上    1.5 (夜1 + 早0.5)
//   正休(休息)  0
//   一套班 白夜早休 = 2.5 天
//
// 早期版本把非年休按自然日算，韩思成育儿假 8 天被算成 8 天，
// 实际应为 5 天（12-06、12-10 正休不扣）。别再走回自然日口径。

/**
 * 按班次序列计算每天扣几天假
 * @param {Array<{date: string, shift: string}>} rows 按日期升序的班次行
 * @returns {{days: number, detail: Array<{date,shift,deduct,pair?}>, warning?: string}}
 */
function calcDeductFromShifts(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { days: 0, detail: [], warning: '这段日期没有班次数据' };
  }

  const detail = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i].shift;

    if (cur === '休息') {
      detail.push({ date: rows[i].date, shift: cur, deduct: 0 });
      i++;
      continue;
    }

    if (cur === '白班') {
      // 白班后面紧跟夜班 → 白夜连上，各记 1
      if (i + 1 < rows.length && rows[i + 1].shift === '夜班') {
        detail.push({ date: rows[i].date, shift: '白班', deduct: 1, pair: '白夜' });
        detail.push({ date: rows[i + 1].date, shift: '夜班', deduct: 1, pair: '白夜' });
        i += 2;
        continue;
      }
      detail.push({ date: rows[i].date, shift: cur, deduct: 1 });
      i++;
      continue;
    }

    if (cur === '夜班') {
      // 夜班后面紧跟早班 → 夜早连上，夜记 1、早记 0.5
      if (i + 1 < rows.length && rows[i + 1].shift === '早班') {
        detail.push({ date: rows[i].date, shift: '夜班', deduct: 1, pair: '夜早' });
        detail.push({ date: rows[i + 1].date, shift: '早班', deduct: 0.5, pair: '夜早' });
        i += 2;
        continue;
      }
      detail.push({ date: rows[i].date, shift: cur, deduct: 1 });
      i++;
      continue;
    }

    // 早班单独出现（前一天不是夜班，否则上面就配掉了）→ 0.5
    detail.push({ date: rows[i].date, shift: cur, deduct: 0.5 });
    i++;
  }

  // 累加后四舍五入到 1 位：0.5 + 1 + 0.5 这种浮点会出 1.9999999999999998
  const days = detail.reduce((s, d) => s + d.deduct, 0);
  return { days: Math.round(days * 10) / 10, detail };
}

module.exports = { calcDeductFromShifts };
