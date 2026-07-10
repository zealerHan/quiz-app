const { db } = require('./db');
const { getSetting, getCurrentCycle, getTrainingPlanForDate } = require('./helpers');
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
    `${todayShift}已开始，请管理员及时登录培训系统设置本套班抽问内容。`,
  ];
  if (publicUrl) lines.push(`🔗 ${publicUrl}`);
  await sendGroupPush(lines.join('\n'));
}

// 每分钟检查一次时间，在 12:30 和 16:30 各推送培训进度；11:00 和 17:30 检查抽问设置；18:00 月末兜底检查
let lastEvalPushDate = { '12:30': '', '16:30': '' };
let lastNoQuizReminderDate = { '11:00': '', '17:30': '' };
let lastMonthEndCheckDate = '';
setInterval(() => {
  const now = new Date();
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const hh = String(cst.getHours()).padStart(2, '0');
  const mm = String(cst.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if ((hhmm === '12:30' || hhmm === '16:30') && lastEvalPushDate[hhmm] !== todayStr) {
    lastEvalPushDate[hhmm] = todayStr;
    pushTrainingEvalStatus().catch(() => {});
  }
  if ((hhmm === '11:00' || hhmm === '17:30') && lastNoQuizReminderDate[hhmm] !== todayStr) {
    lastNoQuizReminderDate[hhmm] = todayStr;
    checkAndRemindNoQuiz(hhmm).catch(() => {});
  }
  if (hhmm === '18:00' && lastMonthEndCheckDate !== todayStr) {
    lastMonthEndCheckDate = todayStr;
    checkMonthEndIncomplete(todayStr).catch(() => {});
  }
}, 60 * 1000);

// 月末兜底检查：若今天是本月最后一个早班，检查是否有人未完成培训
async function checkMonthEndIncomplete(todayStr) {
  const todayShift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(todayStr)?.shift;
  if (todayShift !== '早班') return;

  const [y, mo] = todayStr.split('-');
  const month = `${y}-${mo}`;

  // 本月还有没有更晚的早班
  const laterShift = db.prepare(
    "SELECT date FROM shift_calendar WHERE date > ? AND date LIKE ? AND shift='早班' LIMIT 1"
  ).get(todayStr, `${month}%`);
  if (laterShift) return; // 不是最后一个早班，不检查

  const yearPlanRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?').get(parseInt(y), parseInt(mo));
  const totalItems = JSON.parse(yearPlanRow?.sessions_json || '[]').length;
  if (totalItems === 0) return;

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
  if (incomplete.length === 0) return; // 全员完成，无需提醒（全员完成通知已由 checkAndNotifyMonthComplete 处理）

  const names = incomplete.map(m => m.name).join('、');
  await sendGroupPush(`⚠️ ${parseInt(mo)}月培训月末提醒\n\n今天是本月最后一个早班，以下 ${incomplete.length} 人尚未完成本月培训确认：\n${names}\n\n请教员确认是否有遗漏，如需补培训请安排在下月完成。`);
}

function startJobs() {
  // 每小时检查轮次（ensureCurrentCycle 由 index.js 启动调用，这里只负责定时推送）
  // setInterval 已在上方模块加载时注册，此函数保留供显式调用确认
}

module.exports = { startJobs };
