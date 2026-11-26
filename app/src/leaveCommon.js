// ─── 休假相关共用逻辑（前端唯一来源）──────────────────────────────
//
// 为什么有这个文件：跨月判断和考勤文本原来在多个地方各抄了一份，
// 改一处必漏另一处 —— 2026-11-26 就漏过一次（后端改了按自然月拆段，
// 前端复制区没动，用户发现界面还在显示整条 11-30~12-03）。
//
// 注：原来的独立申报页 LeaveApplyScreen.jsx 已于 2026-11-27 删除
// （App.jsx 里 screen==="apply" 永不触发，申报表单已内嵌在 LeaveScreen）。
//
// 规矩：以后改跨月规则或考勤文本格式，只改这里。
//
// 与后端 server/routes/leave.js 的 buildAttendanceLine 保持同一口径：
//   · 跨自然月拆段（跨年同样按月切）
//   · 单日写单日，不写「12月1日-12月1日」
//   · 段内「共N天」= 自然日，「实际M天」= 按班次折算后的扣假天数

const ONE = { 白班: '白', 夜班: '夜', 早班: '早', 休息: '休' };

/** 班次逐字连写，如「白夜早休白夜早」；无班次数据时写「休」 */
export function buildShiftText(detail) {
  const s = (detail || []).map(d => ONE[d.shift] || '').join('');
  return s || '休';
}

/** 小数格式化：1 → "1"，1.5 → "1.5" */
export const fmtNum = n => (n % 1 === 0 ? String(n) : n.toFixed(1));

/**
 * 跨自然月切分（跨年同样按月切，没有特殊分支）
 * @returns {Array<{label,start,end,days}>} 每段 = 一个自然月内的交集，days 为自然日数
 */
export function splitByMonth(start, end) {
  if (!start || !end || start > end) return [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const mm = String(m).padStart(2, '0');
    const mStart = `${y}-${mm}-01`;
    const daysInMonth = new Date(y, m, 0).getDate();
    const mEnd = `${y}-${mm}-${String(daysInMonth).padStart(2, '0')}`;
    const s = start > mStart ? start : mStart;
    const e = end < mEnd ? end : mEnd;
    if (s <= e) {
      const n = Math.round((new Date(e + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000) + 1;
      out.push({ label: `${y}年${m}月`, start: s, end: e, days: n });
    }
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length > 24) break;   // 安全阀
  }
  return out;
}

/** 日期文本：单日 → 2026年12月1日；同月 → 11月29日-11月30日；跨年 → 各写各年份 */
function dateTextOf(s, e) {
  const a = s.split('-').map(Number), b = e.split('-').map(Number);
  // 单日一律写单日，不写「12月1日-12月1日」（老韩 2026-11-26 明确否掉起-止写法）
  if (s === e) return `${a[0]}年${a[1]}月${a[2]}日`;
  if (a[0] === b[0]) return `${a[0]}年${a[1]}月${a[2]}日-${b[1]}月${b[2]}日`;
  return `${a[0]}年${a[1]}月${a[2]}日-${b[0]}年${b[1]}月${b[2]}日`;
}

/**
 * 生成考勤员格式文本（供复制）
 *
 * 跨自然月会返回两行（用 \n 分隔），因为考勤员按纸质假单核，
 * 假单是按自然月开的。跨周不拆 —— 考勤按月不按周。
 *
 * 每段独立累计扣假，用的是 preview.detail 里后端算好的 deduct，
 * 不重新配对班次（月末夜班+次月早班的「夜早连上」配对跨月时，
 * 重新配对会算错）。
 *
 * @param {object} p
 * @param {string} p.start       起日 YYYY-MM-DD
 * @param {string} p.end         止日 YYYY-MM-DD
 * @param {string} p.staffName   姓名
 * @param {string} p.staffId     工号（可带 Y，不带也行）
 * @param {string} p.leaveType   假别名
 * @param {object} p.preview     /api/leave/preview 返回体，需含 detail
 * @returns {string} 单段一行；跨月两行，用 \n 分隔
 */
export function buildAttendanceText({ start, end, staffName, staffId, leaveType, preview }) {
  if (!start || !end || !preview) return '';

  const name = staffName || '';
  const raw = String(staffId || '').trim();
  const sidY = /^Y/i.test(raw) ? raw.toUpperCase() : 'Y' + raw;
  const detail = preview.detail || [];

  // 单段
  const segment = (s, e) => {
    const segDetail = detail.filter(d => d.date >= s && d.date <= e);
    const calDays = Math.round(
      (new Date(e + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000
    ) + 1;
    const shiftText = buildShiftText(segDetail);
    // 用后端算好的 deduct，不重算
    const actual = segDetail.reduce((sum, d) => sum + (d.deduct ?? 0), 0);
    return `${name} （乘务四组）${sidY} ${dateTextOf(s, e)} ${s.slice(0, 4)}年${leaveType}（${shiftText}）共${calDays}天，实际${fmtNum(actual)}天。`;
  };

  // 跨月拆段
  const segments = splitByMonth(start, end);
  if (segments.length > 1) {
    return segments.map(m => segment(m.start, m.end)).join('\n');
  }
  return segment(start, end);
}
