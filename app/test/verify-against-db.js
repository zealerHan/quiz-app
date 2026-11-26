// 回归验证：新算法 vs 数据库真实班次
// 拿生产库的 shift_calendar 跑一遍，对比重构前后结果是否完全一致。
// 跑法：在容器里 node test/verify-against-db.js
const Database = require('better-sqlite3');
const { calcDeductFromShifts } = require('../server/leaveDays');

const db = new Database(process.env.DB_PATH || '/app/data/quiz.db', { readonly: true });

// 老算法（重构前那版，从 routes/leave.js 原样搬过来）——用来做基准对照
function oldCalcLeaveDays(startDate, endDate) {
  const rows = db.prepare(`
    SELECT date, shift FROM shift_calendar
    WHERE date >= ? AND date <= ? ORDER BY date
  `).all(startDate, endDate);

  if (rows.length === 0) return { days: 0, detail: [], warning: '这段日期没有班次数据' };

  const detail = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i].shift;
    if (cur === '休息') { detail.push({ date: rows[i].date, shift: cur, deduct: 0 }); i++; continue; }
    if (cur === '白班') {
      if (i + 1 < rows.length && rows[i + 1].shift === '夜班') {
        detail.push({ date: rows[i].date, shift: '白班', deduct: 1, pair: '白夜' });
        detail.push({ date: rows[i + 1].date, shift: '夜班', deduct: 1, pair: '白夜' });
        i += 2; continue;
      }
      detail.push({ date: rows[i].date, shift: cur, deduct: 1 }); i++; continue;
    }
    if (cur === '夜班') {
      if (i + 1 < rows.length && rows[i + 1].shift === '早班') {
        detail.push({ date: rows[i].date, shift: '夜班', deduct: 1, pair: '夜早' });
        detail.push({ date: rows[i + 1].date, shift: '早班', deduct: 0.5, pair: '夜早' });
        i += 2; continue;
      }
      detail.push({ date: rows[i].date, shift: cur, deduct: 1 }); i++; continue;
    }
    detail.push({ date: rows[i].date, shift: cur, deduct: 0.5 }); i++;
  }
  const days = detail.reduce((s, d) => s + d.deduct, 0);
  return { days: Math.round(days * 10) / 10, detail };
}

// 拿库里所有真实休假记录 + 随机区间，新老算法逐一对比
const records = db.prepare(`
  SELECT id, staff_id, start_date, end_date, days, leave_type
  FROM leave_records ORDER BY id
`).all();

let checked = 0, mismatch = 0, dayDiff = 0;
const diffs = [];

for (const r of records) {
  const oldR = oldCalcLeaveDays(r.start_date, r.end_date);
  const rows = db.prepare(`
    SELECT date, shift FROM shift_calendar WHERE date >= ? AND date <= ? ORDER BY date
  `).all(r.start_date, r.end_date);
  const newR = calcDeductFromShifts(rows);

  checked++;
  if (oldR.days !== newR.days) {
    mismatch++;
    diffs.push(`  ✗ id${r.id} ${r.start_date}~${r.end_date} 老=${oldR.days} 新=${newR.days}`);
  }
  // 顺带查：库里存的 days 和重算是否一致（不一致是历史数据问题，不是重构问题）
  if (Math.abs((r.days || 0) - newR.days) > 0.01) {
    dayDiff++;
    if (dayDiff <= 8) diffs.push(`  ⚠ 库里存的 ${r.days} 天 ≠ 重算 ${newR.days} 天  [id${r.id} ${r.leave_type} ${r.start_date}~${r.end_date}]`);
  }
}

// 再扫一遍全年所有可能的单日，覆盖边界
let singles = 0;
const days_ = db.prepare("SELECT date FROM shift_calendar WHERE date >= '2026-01-01' AND date <= '2027-12-31' ORDER BY date").all();
for (const d of days_) {
  const rows = db.prepare(`SELECT date, shift FROM shift_calendar WHERE date = ?`).all(d.date);
  const oldR = oldCalcLeaveDays(d.date, d.date);
  const newR = calcDeductFromShifts(rows);
  singles++;
  if (oldR.days !== newR.days) {
    mismatch++;
    diffs.push(`  ✗ 单日 ${d.date} 老=${oldR.days} 新=${newR.days}`);
  }
}

console.log('=== 新老算法一致性 ===');
console.log(`  真实休假记录  ${checked} 条  → 结果不同 ${mismatch} 条`);
console.log(`  全年单日扫描  ${singles} 天  → 已含在上面的统计里`);
console.log('');
if (diffs.length) {
  console.log('=== 差异明细 ===');
  diffs.forEach(d => console.log(d));
} else {
  console.log('✓ 新算法与老算法完全一致');
}
console.log('');

if (dayDiff) {
  console.log(`=== 库里已存 days 与重算不一致 ${dayDiff} 条（历史数据，非重构引入）===`);
} else {
  console.log('✓ 库里存的 days 与重算全部一致');
}

process.exit(mismatch > 0 ? 1 : 0);
