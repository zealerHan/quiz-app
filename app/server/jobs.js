const { db } = require('./db');
const { getSetting, getCurrentCycle, calcPoints, getTrainingPlanForDate } = require('./helpers');
const { sendGroupPush, fmtDate } = require('./push');

// ─── 早班定时推送：12:30 和 16:30 推送教员确认情况 ────────────────────────────
async function pushTrainingEvalStatus() {
  // 只在早班日推送
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const todayShift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(todayStr)?.shift || '';
  if (todayShift !== '早班') return;

  // 找今日（早班日）的培训计划
  const plan = db.prepare('SELECT * FROM monthly_training_plans WHERE shift_date=?').get(todayStr);
  if (!plan) return;

  // 已确认人员
  const evals = db.prepare(
    'SELECT e.staff_name, e.evaluated_by, e.evaluated_at FROM training_evaluations e WHERE e.plan_id=? ORDER BY e.evaluated_at'
  ).all(plan.id);

  // 计划应参加人员（应用 overrides，中旬会取全员）
  const full = getTrainingPlanForDate(todayStr);
  let allMembers = [];
  if (plan.plan_type === '中旬会') {
    const leaveNames = new Set((full?.zhxhLeavers || []).map(l => l.staffName));
    allMembers = [
      ...(full?.zhxhLeaders || []).map(l => l.real_name || l.name),
      ...(full?.zhxhMembers || []).map(m => m.real_name || m.name),
    ].filter(n => !leaveNames.has(n));
  } else {
    const fixedIds = new Set((full?.fixedStaff || []).map(f => String(f.staff_id)));
    const members = (full?.group?.members || []).filter(m => !fixedIds.has(String(m.id)));
    allMembers = [...members.map(m => m.real_name || m.name), ...(full?.fixedStaff || []).map(f => f.real_name || f.name)];
  }
  const confirmedNames = evals.map(e => e.staff_name);
  const pendingNames = allMembers.filter(n => !confirmedNames.includes(n));

  // 检查照片是否已上传
  const photoCount = db.prepare('SELECT COUNT(*) as cnt FROM training_photos WHERE plan_id=?').get(plan.id)?.cnt || 0;
  const photoStatus = photoCount > 0 ? `✅ 已上传现场照片（${photoCount}张）` : '⚠️ 现场照片还未上传';

  const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  const dateLabel = fmtDate(todayStr);
  const lines = [`📋 ${now}  ${dateLabel}早班培训进度`];

  if (confirmedNames.length > 0) {
    lines.push(`✅ 已确认完成（${confirmedNames.length}人）：${confirmedNames.join('、')}`);
  } else {
    lines.push('✅ 已确认完成（0人）');
  }
  if (pendingNames.length > 0) {
    lines.push(`⏳ 待确认（${pendingNames.length}人）：${pendingNames.join('、')}`);
  } else {
    lines.push('✅ 全员已确认完成');
  }
  lines.push(photoStatus);

  await sendGroupPush(lines.join('\n'));
}

// 检查本套班是否已有有效抽问内容
function hasActiveShiftQuiz() {
  const pinnedVal = getSetting('pinned_questions');
  if (!pinnedVal) return false;
  try {
    const pinned = JSON.parse(pinnedVal);
    const cycle = getCurrentCycle();
    const inCurrentCycle = !cycle?.start_date || !pinned.created_date || pinned.created_date >= cycle.start_date;
    const hasContent = (pinned.ids?.length > 0) ||
      (pinned.mode === 'random' && (pinned.bank_id || pinned.bank_ids?.length > 0)) ||
      pinned.mode === 'emergency';
    return inCurrentCycle && pinned.scope === 'shift' && hasContent;
  } catch { return false; }
}

// 白班 11:00 / 夜班 17:30 未设抽问时向群推提醒
async function checkAndRemindNoQuiz(triggerTime) {
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const todayShift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(todayStr)?.shift || '';
  if (triggerTime === '11:00' && todayShift !== '白班') return;
  if (triggerTime === '17:30' && todayShift !== '夜班') return;
  if (hasActiveShiftQuiz()) return; // 已设置，无需提醒

  const publicUrl = process.env.PUBLIC_URL || '';
  const lines = [
    `⚠️ 提醒：本套班尚未设置抽问题目`,
    `${todayShift}已开始，请管理员及时登录乘务系统设置本套班抽问内容。`,
  ];
  if (publicUrl) lines.push(`🔗 ${publicUrl}`);
  await sendGroupPush(lines.join('\n'));
}

// 自动补完中断 session：答了 ≥3 题但超过 10 分钟没有 finish 的
function autoCompleteAbandonedSessions() {
  const rows = db.prepare(`
    SELECT s.id, s.staff_id, COUNT(a.id) as q_count,
           ROUND(AVG(a.score), 1) as total_score,
           MAX(a.created_at) as last_answer_at
    FROM sessions s
    JOIN answers a ON a.session_id = s.id
    WHERE s.completed = 0
      AND COALESCE(s.is_practice, 0) = 0
      AND COALESCE(s.is_deleted, 0) = 0
    GROUP BY s.id
    HAVING q_count >= 3
      AND (strftime('%s','now','localtime') - strftime('%s', last_answer_at)) > 600
  `).all();

  for (const row of rows) {
    const pts = calcPoints(row.total_score, row.q_count);
    const hasPracticed = db.prepare(
      `SELECT COUNT(*) as c FROM sessions WHERE staff_id=? AND is_practice=1 AND completed=1 AND strftime('%Y-%m',created_at)=strftime('%Y-%m',?)`
    ).get(row.staff_id, row.last_answer_at);
    if (hasPracticed.c > 0) { pts.bonus = 1; pts.total += 1; }
    db.prepare(
      'UPDATE sessions SET total_score=?,q_count=?,base_points=?,bonus_points=?,total_points=?,completed=1 WHERE id=? AND completed=0'
    ).run(row.total_score, row.q_count, pts.base, pts.bonus, pts.total, row.id);
    console.log(`[autoComplete] session ${row.id} (${row.q_count}题, ${row.total_score}分) 已自动补完`);
  }
}

// 每分钟检查一次时间，在 12:30 和 16:30 各推送培训进度；11:00 和 17:30 检查抽问设置；07:40 月末兜底检查
let lastEvalPushDate = { '12:30': '', '16:30': '' };
let lastNoQuizReminderDate = { '11:00': '', '17:30': '' };
// 月末检查的去重日期存在数据库里，不用内存变量（2026-11-27 改）
// 为什么：内存变量一重建容器就清空，18:00 前后重启会永久错过这次检查且不会补发。
//        存库后，只要当天没发过，重启后还会补发。见 getMonthEndSentDate/setMonthEndSentDate
// 每5分钟自动补完遗漏的 finish
setInterval(() => { autoCompleteAbandonedSessions(); }, 5 * 60 * 1000);

// ─── 待补评记录自动补评（每 10 分钟）──────────────────────────────────────
// AI 评分失败时答案被标记 needs_review=1、分数为 keyword 兜底（可能误判偏低）。
// 后台用 AI 重评覆盖，避免"答对了判 0 分"的结果留在台账里。
const quizRouter = require('./routes/quiz');
setInterval(() => {
  Promise.resolve(quizRouter.recheckPendingScores?.(8)).catch(() => {});
}, 10 * 60 * 1000);
setInterval(() => {
  const now = new Date();
  // ⚠️ 不能用 new Date(now.toLocaleString(...)) —— 字符串会被按容器本地时区(UTC)再解析一次，
  //    结果差 8 小时，导致 12:30/16:30 的推送在 20:30/00:30 才触发（2026-11-25 修复）
  const cst = (() => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const g = (t) => (p.find(x => x.type === t) || {}).value || '00';
    return { hh: g('hour'), mm: g('minute') };
  })();
  const hhmm = `${cst.hh}:${cst.mm}`;
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if ((hhmm === '12:30' || hhmm === '16:30') && lastEvalPushDate[hhmm] !== todayStr) {
    lastEvalPushDate[hhmm] = todayStr;
    pushTrainingEvalStatus().catch(() => {});
  }
  if ((hhmm === '11:00' || hhmm === '17:30') && lastNoQuizReminderDate[hhmm] !== todayStr) {
    lastNoQuizReminderDate[hhmm] = todayStr;
    checkAndRemindNoQuiz(hhmm).catch(() => {});
  }
  if (hhmm === '07:40' && getMonthEndSentDate() !== todayStr) {
    // 只有真的推了才记日期（checkMonthEndIncomplete 返回 true 表示发了）
    checkMonthEndIncomplete(todayStr).then(sent => {
      if (sent) setMonthEndSentDate(todayStr);
    }).catch(() => {});
  }
}, 60 * 1000);

// ── 月末检查去重（存库，容器重启不丢）──────────────────────────────────────
function getMonthEndSentDate() {
  try {
    return getSetting('monthEndLastSent') || '';
  } catch { return ''; }
}
function setMonthEndSentDate(dateStr) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('monthEndLastSent');
    if (row) db.prepare('UPDATE settings SET value=? WHERE key=?').run(dateStr, 'monthEndLastSent');
    else db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('monthEndLastSent', dateStr);
  } catch (e) { console.error('[jobs] 记录月末检查日期失败:', e.message); }
}

// 月末兜底提醒：若今天是本月最后一个早班，检查是否有人未完成培训
//
// 时间：07:40（老韩 2026-11-27 定）
//   原来在 18:00，那天班上早结束了，发现了也没法补。
//   改到早班早上 7:40，学员刚上班就能看到，当天还有补救空间。
//
// 返回：true = 已推送；false = 无需推送（全员完成 / 非最后早班 / 无培训项）
async function checkMonthEndIncomplete(todayStr) {
  const todayShift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(todayStr)?.shift;
  if (todayShift !== '早班') return false;

  const [y, mo] = todayStr.split('-');
  const month = `${y}-${mo}`;

  // 本月还有没有更晚的早班
  const laterShift = db.prepare(
    "SELECT date FROM shift_calendar WHERE date > ? AND date LIKE ? AND shift='早班' LIMIT 1"
  ).get(todayStr, `${month}%`);
  if (laterShift) return false; // 不是最后一个早班，不检查

  const yearPlanRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?').get(parseInt(y), parseInt(mo));
  const totalItems = JSON.parse(yearPlanRow?.sessions_json || '[]').length;
  if (totalItems === 0) return false;

  const plans = db.prepare(
    "SELECT id, shift_date, plan_type, completed_items FROM monthly_training_plans WHERE year_month=? AND plan_type NOT IN ('轮空') ORDER BY shift_date"
  ).all(month);

  const personDone = {};
  for (const p of plans) {
    const completedItems = JSON.parse(p.completed_items || '[]');
    if (completedItems.length === 0) continue;
    const full = getTrainingPlanForDate(p.shift_date);
    if (!full) continue;
    const fixedIds = new Set((full.fixedStaff||[]).map(f=>String(f.staff_id)));
    let participants;
    if (p.plan_type === '中旬会') {
      const all = db.prepare('SELECT tgm.staff_id FROM training_group_members tgm WHERE tgm.is_fixed=0').all();
      participants = [...all.map(m=>String(m.staff_id)).filter(id=>!fixedIds.has(id)), ...(full.fixedStaff||[]).map(f=>String(f.staff_id))];
    } else {
      const members = (full.group?.members||[]).filter(m=>!fixedIds.has(String(m.id)));
      participants = [...members.map(m=>String(m.id)), ...(full.fixedStaff||[]).map(f=>String(f.staff_id))];
    }
    const evals = db.prepare('SELECT staff_id FROM training_evaluations WHERE plan_id=?').all(p.id);
    const evalSet = new Set(evals.map(e=>String(e.staff_id)));
    for (const sid of participants) {
      if (!evalSet.has(sid)) continue;
      if (!personDone[sid]) personDone[sid] = new Set();
      for (const item of completedItems) personDone[sid].add(item);
    }
  }

  // 取所有应参加人员
  const groupMembers = db.prepare(
    'SELECT tgm.staff_id, COALESCE(s.real_name, s.name) as name FROM training_group_members tgm JOIN staff s ON s.id=tgm.staff_id WHERE tgm.is_fixed=0 AND COALESCE(s.is_cp,0)=0'
  ).all();
  const fixedMembers = db.prepare(
    'SELECT f.staff_id, COALESCE(s.real_name, s.name) as name FROM training_fixed_members f JOIN staff s ON f.staff_id=s.id'
  ).all();
  const allRequired = [...new Map([...groupMembers, ...fixedMembers].map(m=>[String(m.staff_id), m])).values()];

  const incomplete = allRequired.filter(m => (personDone[String(m.staff_id)]?.size || 0) < totalItems);
  if (incomplete.length === 0) return false; // 全员完成，无需提醒（全员完成通知已由 checkAndNotifyMonthComplete 处理）

  const names = incomplete.map(m => m.name).join('、');
  // 发到四组办事处群（教员群），老韩 2026-11-27 指定
  await sendGroupPush(
    `⚠️ ${parseInt(mo)}月培训月末提醒\n\n` +
    `今天是本月最后一个早班，以下 ${incomplete.length} 人尚未完成本月培训确认：\n${names}\n\n` +
    `请教员确认是否有遗漏，如需补培训请安排在下月完成。`,
    { channel: 'crewOps' }
  );
  return true;
}

function startJobs() {
  // 每小时检查轮次（ensureCurrentCycle 由 index.js 启动调用，这里只负责定时推送）
  // setInterval 已在上方模块加载时注册，此函数保留供显式调用确认
}

module.exports = { startJobs };
