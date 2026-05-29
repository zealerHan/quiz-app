require('dotenv').config();
const multer = require("multer");
const upload = multer({storage: multer.memoryStorage()});
const fs = require("fs");
const { spawn } = require("child_process");
const express = require('express');
const WebSocket = require('ws');
const https = require('https');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const crypto = require('crypto');
const os = require('os');
const QRCode = require('qrcode');
const mammoth = require('mammoth');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888';
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || 'monitor_quiz_5line';

// ─── Database ──────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'quiz.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  -- 人员表（工号+姓名，班组长标记免答）
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_exempt INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 题库表
  CREATE TABLE IF NOT EXISTS question_banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    q_type TEXT DEFAULT '简答',
    default_count INTEGER DEFAULT 3,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 题目表
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_id INTEGER DEFAULT 1,
    text TEXT NOT NULL,
    reference TEXT NOT NULL,
    keywords TEXT DEFAULT '',
    category TEXT DEFAULT '业务知识',
    difficulty TEXT DEFAULT '中等',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(bank_id) REFERENCES question_banks(id)
  );

  -- 答题会话
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    total_score REAL,
    base_points INTEGER DEFAULT 0,
    bonus_points INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    q_count INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 答题记录
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    question_id INTEGER,
    question_text TEXT,
    category TEXT,
    answer_text TEXT,
    score INTEGER DEFAULT 0,
    level TEXT DEFAULT '需加强',
    summary TEXT,
    correct_points TEXT DEFAULT '[]',
    missing_points TEXT DEFAULT '[]',
    suggestion TEXT,
    score_method TEXT DEFAULT 'keyword',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );

  -- 班组周期表（一套班 = 白夜早，对应同一cycle_id）
  CREATE TABLE IF NOT EXISTS cycles (
    id TEXT PRIMARY KEY,
    label TEXT,
    start_date TEXT,
    end_date TEXT,
    is_current INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 班次设置
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Migrations ────────────────────────────────────────────────────────────
try { db.exec('ALTER TABLE sessions ADD COLUMN is_practice INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN practice_bonus INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN hidden INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN tab_switch_count INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN real_name TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN phone_tail TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN is_tester INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN is_cp INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN avatar TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN is_deleted INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE questions ADD COLUMN options TEXT'); } catch(e) {} // 选择题选项 JSON: {A:"...",B:"...",C:"...",D:"..."}
try { db.exec('ALTER TABLE questions ADD COLUMN type TEXT'); } catch(e) {} // 题型: choice_single|choice_multi|true_false|fill_blank|short_answer
db.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  operator TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// 兼容旧 cycle_id NOT NULL 约束（某些记录可能缺失）
try { db.exec("UPDATE sessions SET cycle_id='' WHERE cycle_id IS NULL"); } catch(e) {}

// ─── Makeup Grant Table（早班逾期补答授权）──────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS makeup_grants (
  staff_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  granted_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (staff_id, cycle_id)
)`);

// ─── Training Tables（车间任务模块）──────────────────────────────────────────
try { db.exec('ALTER TABLE staff ADD COLUMN is_instructor INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN is_leader INTEGER DEFAULT 0'); } catch(e) {}

db.exec(`CREATE TABLE IF NOT EXISTS training_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  instructor_id TEXT,
  sort_order INTEGER DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS training_group_members (
  group_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  is_fixed INTEGER DEFAULT 0,
  PRIMARY KEY (group_id, staff_id)
)`);
try { db.exec('ALTER TABLE training_group_members ADD COLUMN is_fixed INTEGER DEFAULT 0'); } catch(e) {}

// 全局固定培训人员（出现在所有小组末尾）
db.exec(`CREATE TABLE IF NOT EXISTS training_fixed_members (
  staff_id TEXT PRIMARY KEY
)`);

// 月度培训计划
db.exec(`CREATE TABLE IF NOT EXISTS monthly_training_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  location TEXT,
  plan_type TEXT DEFAULT '培训',
  group_id INTEGER,
  leader_name TEXT,
  is_type_custom INTEGER DEFAULT 0,
  safety_date_custom TEXT,
  notes TEXT,
  UNIQUE(year_month, shift_date)
)`);
try { db.exec('ALTER TABLE monthly_training_plans ADD COLUMN leader_name TEXT'); } catch(e) {}
// 安全分析会日期可自定义（每月一条）
db.exec(`CREATE TABLE IF NOT EXISTS training_plan_settings (
  year_month TEXT PRIMARY KEY,
  safety_date TEXT,
  start_group_id INTEGER,
  start_leader_idx INTEGER DEFAULT 0
)`);
try { db.exec('ALTER TABLE training_plan_settings ADD COLUMN start_group_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE training_plan_settings ADD COLUMN start_leader_idx INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec("ALTER TABLE monthly_training_plans ADD COLUMN completed_items TEXT DEFAULT '[]'"); } catch(e) {}
try { db.exec("ALTER TABLE monthly_training_plans ADD COLUMN instructor_id_override TEXT"); } catch(e) {}

// 数据修复：2026-04-13 第三小组已有评价但 completed_items 未设置
try {
  const p0413 = db.prepare("SELECT id, completed_items FROM monthly_training_plans WHERE shift_date='2026-04-13' AND year_month='2026-04'").get();
  if (p0413) {
    const ci = JSON.parse(p0413.completed_items || '[]');
    if (ci.length === 0) {
      const evalCount = db.prepare('SELECT COUNT(*) as c FROM training_evaluations WHERE plan_id=?').get(p0413.id);
      if (evalCount.c > 0) {
        db.prepare("UPDATE monthly_training_plans SET completed_items=? WHERE id=?")
          .run('["人工介入","线路异物侵限处置办法"]', p0413.id);
        console.log('[Migration] 已修复 2026-04-13 培训计划 completed_items');
      }
    }
  }
} catch(e) {}

// 打卡 & 教员确认
db.exec(`CREATE TABLE IF NOT EXISTS training_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  checked_in INTEGER DEFAULT 0,
  checkin_time TEXT,
  checkin_lat REAL,
  checkin_lng REAL,
  instructor_confirmed INTEGER DEFAULT 0,
  confirm_time TEXT,
  confirmed_by TEXT,
  UNIQUE(plan_id, staff_id)
)`);

// 现场照片
db.exec(`CREATE TABLE IF NOT EXISTS training_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now','localtime')),
  uploaded_by TEXT
)`);

// 培训点评
db.exec(`CREATE TABLE IF NOT EXISTS training_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT,
  comment TEXT,
  evaluated_by TEXT,
  evaluated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(plan_id, staff_id)
)`);

// 确保照片目录存在
const PHOTO_DIR = path.join(__dirname, '..', 'data', 'training-photos');
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ─── 一次性初始化：班组长标记（is_leader）───────────────────────────────────
{
  const cnt = db.prepare('SELECT COUNT(*) as c FROM staff WHERE is_leader=1').get().c;
  if (cnt === 0) {
    // 艾凌风 07512、韩颖 3743、胡鑫 17341 — 按实际工号设置
    db.prepare("UPDATE staff SET is_leader=1 WHERE id IN ('07512','3743','17341')").run();
  }
}

// ─── 一次性初始化：2026-04 培训计划设置（中旬会 → Apr 17，起始教员 idx=1）──────
{
  const s = db.prepare('SELECT safety_date FROM training_plan_settings WHERE year_month=?').get('2026-04');
  if (!s || s.safety_date !== '2026-04-17') {
    db.prepare('INSERT OR REPLACE INTO training_plan_settings (year_month,safety_date,start_group_id,start_leader_idx) VALUES (?,?,?,?)').run('2026-04','2026-04-17',2,2);
    db.prepare('DELETE FROM monthly_training_plans WHERE year_month=?').run('2026-04');
  }
}

// ─── Shift Calendar Table ──────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS shift_calendar (
  date TEXT PRIMARY KEY,
  shift TEXT NOT NULL
)`);

// 导入 shift_calendar_2026.json（仅首次，已有数据则跳过）
{
  const existing = db.prepare('SELECT COUNT(*) as c FROM shift_calendar').get().c;
  if (existing === 0) {
    const calPath = path.join(__dirname, '..', 'data', 'shift_calendar_2026.json');
    if (fs.existsSync(calPath)) {
      const cal = JSON.parse(fs.readFileSync(calPath, 'utf-8'));
      const ins = db.prepare('INSERT OR IGNORE INTO shift_calendar (date, shift) VALUES (?, ?)');
      const insertMany = db.transaction(entries => { for (const [d, s] of entries) ins.run(d, s); });
      insertMany(Object.entries(cal));
      console.log(`[shift_calendar] 已导入 ${Object.keys(cal).length} 条排班数据`);
    }
  }
}

// 获取今日班次
function getTodayShift() {
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  const row = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(today);
  return row ? row.shift : null;
}

// ─── Seed initial data ─────────────────────────────────────────────────────
const bankCount = db.prepare('SELECT COUNT(*) as c FROM question_banks').get();
if (bankCount.c === 0) {
  db.prepare(`INSERT INTO question_banks (name,is_default,is_active,q_type,default_count,sort_order) VALUES (?,?,?,?,?,?)`)
    .run('救命稻草·15种异常处置', 1, 1, '简答', 3, 0);
  db.prepare(`INSERT INTO question_banks (name,is_default,is_active,q_type,default_count,sort_order) VALUES (?,?,?,?,?,?)`)
    .run('理论考试题库', 0, 0, '选择/判断', 10, 1);

  const ins = db.prepare(`INSERT INTO questions (bank_id,text,reference,keywords,category,difficulty) VALUES (?,?,?,?,?,?)`);
  [
    [1,'列车运行中旅客突发心脏病失去意识，乘务员应如何处置？',
     '立即通知列车长；广播寻找医务人员；使用车载AED或急救箱；联系前方站接应；告知旅客家属；保持气道畅通',
     'AED,急救,通知车长,广播,前方站,气道','应急处置','中等'],
    [1,'旅客遗失车票要求补票但坚称已购票，如何处理？',
     '耐心听取说明；核实身份；系统查验购票记录；能核实则协助；无法核实按规定补票出具凭证；全程礼貌耐心',
     '核实,查验,补票,凭证,耐心','票务处理','简单'],
    [1,'列车紧急制动停车后乘务员处置流程？',
     '广播稳定旅客情绪；通知列车长了解原因；逐节检查车厢安全；禁止旅客下车；保持联系按指令行动；持续安抚',
     '广播,稳定情绪,通知车长,检查,禁止下车,安抚','应急处置','中等'],
    [1,'发现车厢内可疑遗留物品如何处理？',
     '不得触碰；通知列车长和安保；疏散周边旅客；禁止任何人靠近；等待专业人员；做好记录',
     '不触碰,通知,安保,疏散,禁止靠近,记录','安全规程','困难'],
    [1,'旅客要求在非停靠站下车如何应对？',
     '告知不能中途停车；说明规定；紧急情况通知列车长；协助在下一站处理；做好安抚解释',
     '不能停车,规定,列车长,下一站,安抚','旅客服务','简单'],
  ].forEach(args => ins.run(...args));
}

// ─── 轮班自动推算 ────────────────────────────────────────────────────────────
// 基准：2026-03-22 = 白班（四班倒：白→夜→早→休，4天一循环）
// 轮班榜周期 = 白班当天开始，连续3天（白+夜+早），休息日不计
const SHIFT_BASE = new Date('2026-03-22T00:00:00+08:00');
const SHIFT_NAMES = ['白班','夜班','早班','休息'];

function getShiftInfo(date) {
  const d = new Date(date);
  // 转北京时间取日期
  const bjOffset = 8 * 60;
  const local = new Date(d.getTime() + (bjOffset - (-d.getTimezoneOffset())) * 60000);
  const dayDiff = Math.floor((local - new Date('2026-03-22T00:00:00')) / 86400000);
  const phase = ((dayDiff % 4) + 4) % 4; // 0=白 1=夜 2=早 3=休
  // 本轮白班开始日
  const cycleStart = new Date(local);
  cycleStart.setDate(cycleStart.getDate() - phase);
  // 使用本地时间格式化日期，避免 UTC 偏移导致 cycle_id 差一天（北京时间00:00-08:00时段）
  const fmtLocal = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  const endDate = new Date(cycleStart); endDate.setDate(endDate.getDate()+2);
  const startStr = fmtLocal(cycleStart);
  const endStr = fmtLocal(endDate);
  const m1 = cycleStart.getMonth()+1, d1 = cycleStart.getDate();
  const m2 = endDate.getMonth()+1, d2 = endDate.getDate();
  const label = `${m1}月${d1}日—${m2}月${d2}日`;
  const cycleId = `cycle_${startStr}`;
  return { cycleId, startStr, endStr, label, phase };
}

function ensureCurrentCycle() {
  const info = getShiftInfo(new Date());
  // 检查是否已有此cycle
  const existing = db.prepare("SELECT * FROM cycles WHERE id=?").get(info.cycleId);
  if (!existing) {
    // 关闭旧的current
    db.prepare("UPDATE cycles SET is_current=0 WHERE is_current=1").run();
    db.prepare("INSERT OR IGNORE INTO cycles (id,label,start_date,is_current) VALUES (?,?,?,1)")
      .run(info.cycleId, info.label, info.startStr);
  } else if (!existing.is_current) {
    db.prepare("UPDATE cycles SET is_current=0 WHERE is_current=1").run();
    db.prepare("UPDATE cycles SET is_current=1 WHERE id=?").run(info.cycleId);
  }
  return db.prepare("SELECT * FROM cycles WHERE id=?").get(info.cycleId);
}

// 启动时初始化
ensureCurrentCycle();
// 每小时检查一次是否需要切换轮次
setInterval(ensureCurrentCycle, 60 * 60 * 1000);

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

// 每分钟检查一次时间，在 12:30 和 16:30 各推送培训进度；11:00 和 17:30 检查抽问设置
let lastEvalPushDate = { '12:30': '', '16:30': '' };
let lastNoQuizReminderDate = { '11:00': '', '17:30': '' };
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
}, 60 * 1000);

// 默认设置
[
  ['exam_mode', '0'],
  ['exam_bank_id', '1'],
  ['exam_q_count', '10'],
  ['shift_label', '白班'],
].forEach(([k,v]) => db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run(k,v));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use('/training-photos', express.static(path.join(__dirname, '..', 'data', 'training-photos')));

// ─── Helpers ───────────────────────────────────────────────────────────────
function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
}
function getCurrentCycle() {
  return ensureCurrentCycle();
}
function calcPoints(avgScore, qCount) {
  // 总分100分，3题各33.33分，总分=平均分四舍五入
  const base = Math.round(avgScore);
  return { base, bonus: 0, total: base };
}

// 根据题目内容判定题型
// 返回 'choice_single'|'choice_multi'|'true_false'|'fill_blank'|'short_answer'
function detectQuestionType(q) {
  let options = null;
  if (q.options) {
    try { options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options; } catch {}
  }
  const ref = String(q.reference || '').trim();
  const text = String(q.text || '');

  if (options && Object.keys(options).length >= 2) {
    const optVals = Object.values(options).map(v => String(v).trim());
    const optCount = Object.keys(options).length;
    // 判断题：2 个选项 + 选项内容是 对/错 / 正确/错误 / 是/否 / T/F / Yes/No
    const tfWords = ['对','错','正确','错误','是','否','true','false','t','f','yes','no'];
    const allTF = optCount === 2 && optVals.every(v => tfWords.includes(v.toLowerCase()));
    if (allTF) return 'true_false';
    // 答案多个字母 → 多选；单个字母 → 单选
    const letters = ref.toUpperCase().replace(/[^A-F]/g,'');
    if (letters.length >= 2) return 'choice_multi';
    return 'choice_single';
  }
  // 无选项：填空 vs 简答
  // 填空特征：题目里有 ____ 或 （）/(  )/【】 占位 且 参考答案较短（≤30字）
  const hasBlank = /_{2,}|（\s*）|\(\s*\)|【\s*】/.test(text);
  if (hasBlank && ref.length > 0 && ref.length <= 30 && !ref.includes('；') && !ref.includes(';')) {
    return 'fill_blank';
  }
  return 'short_answer';
}
const TYPE_LABEL = {
  choice_single: '单选',
  choice_multi:  '多选',
  true_false:    '判断',
  fill_blank:    '填空',
  short_answer:  '简答',
};

// 回填 NULL 题型（启动时跑一次；新增/修改题目后随时调用）
function backfillQuestionTypes() {
  try {
    const rows = db.prepare("SELECT id, text, reference, options FROM questions WHERE type IS NULL OR type=''").all();
    if (rows.length === 0) return 0;
    const upd = db.prepare('UPDATE questions SET type=? WHERE id=?');
    let n = 0;
    db.transaction(() => {
      for (const r of rows) { upd.run(detectQuestionType(r), r.id); n++; }
    })();
    return n;
  } catch(e) { console.error('[type-backfill] 失败:', e.message); return 0; }
}
const _bf = backfillQuestionTypes();
if (_bf > 0) console.log(`[type-backfill] 启动回填 ${_bf} 道题`);
function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误' });
  next();
}
// 培训计划编辑权限：管理员密码 或 教员身份
function workshopEditAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  if (pwd === ADMIN_PASSWORD) return next();
  const instructorId = req.headers['x-instructor-id'];
  if (instructorId) {
    const s = db.prepare('SELECT is_instructor FROM staff WHERE id=?').get(instructorId);
    if (s?.is_instructor) { req.instructorId = instructorId; return next(); }
    // 也检查是否在小组中担任教员
    const inGroup = db.prepare('SELECT 1 FROM training_groups WHERE instructor_id=? LIMIT 1').get(instructorId);
    if (inGroup) { req.instructorId = instructorId; return next(); }
  }
  return res.status(401).json({ error: '需要管理员密码或教员身份' });
}
const _logStmt = db.prepare("INSERT INTO admin_logs (action, detail, operator) VALUES (?,?,?)");
function logAdmin(action, detail='', operator='admin') {
  try { _logStmt.run(action, String(detail), operator); } catch(e) {}
}

// ─── Staff API ─────────────────────────────────────────────────────────────
// 登录验证：工号 + 手机尾号 → 返回真实姓名
app.post('/api/login', (req, res) => {
  const { staffId, phoneTail } = req.body;
  if (!staffId || !phoneTail) return res.status(400).json({ error: '缺少工号或手机尾号' });
  // 规范化：去掉Y前缀后提取纯数字，转为整数再比较，兼容03743/3743/Y03743/673/00673
  const normalize = id => parseInt(id.replace(/^Y/i, ''), 10);
  const inputNum = normalize(staffId);
  const all = db.prepare('SELECT * FROM staff').all();
  const s = all.find(r => normalize(r.id) === inputNum);
  if (!s) return res.status(404).json({ error: '工号不存在，请联系班组长' });
  if (s.phone_tail && s.phone_tail !== phoneTail) return res.status(401).json({ error: '手机尾号不匹配' });
  // 检查是否有编辑权限：staff.is_instructor=1 或 在training_groups担任教员
  const isInstructor = !!s.is_instructor || !!db.prepare('SELECT 1 FROM training_groups WHERE instructor_id=? LIMIT 1').get(s.id);
  res.json({ ok: true, staffId: s.id, realName: s.real_name || s.name, phoneTail: s.phone_tail || '', isExempt: !!s.is_exempt, isTester: !!s.is_tester, isInstructor, isLeader: !!s.is_leader });
});

app.get('/api/staff', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT id, real_name, phone_tail, is_exempt, is_tester, COALESCE(is_cp,0) as is_cp, COALESCE(is_leader,0) as is_leader, COALESCE(is_instructor,0) as is_instructor, created_at FROM staff ORDER BY created_at DESC').all());
});

// 单条添加
app.post('/api/staff', adminAuth, (req, res) => {
  const { id, real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor } = req.body;
  if (!id?.trim() || !real_name?.trim()) return res.status(400).json({ error: '工号和姓名不能为空' });
  const staffId = id.trim().replace(/^Y/i, '');
  db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0, is_leader?1:0, is_instructor?1:0);
  logAdmin('添加人员', `工号${staffId} ${real_name.trim()}`);
  res.json({ ok: true });
});

// 批量导入 [{id, real_name, phone_tail}]
app.post('/api/staff/batch', adminAuth, (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: '需要数组' });
  const ins = db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester) VALUES (?,?,?,?,?,?)');
  const run = db.transaction(() => list.forEach(({ id, real_name, phone_tail, is_exempt, is_tester }) => {
    const staffId = (id||'').toString().trim().replace(/^Y/i, '');
    if (!staffId || !real_name) return;
    ins.run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt ? 1 : 0, is_tester ? 1 : 0);
  }));
  run();
  logAdmin('批量导入人员', `共${list.length}条`);
  res.json({ ok: true, count: list.length });
});

app.delete('/api/staff/:id', adminAuth, (req, res) => {
  const s = db.prepare('SELECT name FROM staff WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM staff WHERE id=?').run(req.params.id);
  logAdmin('删除人员', `工号${req.params.id} ${s?.name||''}`);
  res.json({ ok: true });
});
// 编辑人员
app.put('/api/staff/:id', adminAuth, (req, res) => {
  const { real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor } = req.body;
  if (!real_name?.trim()) return res.status(400).json({ error: '姓名不能为空' });
  db.prepare('UPDATE staff SET name=?, real_name=?, phone_tail=?, is_exempt=?, is_tester=?, is_cp=?, is_leader=?, is_instructor=? WHERE id=?')
    .run(real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0, is_leader?1:0, is_instructor?1:0, req.params.id);
  logAdmin('编辑人员', `工号${req.params.id} ${real_name.trim()}`);
  res.json({ ok: true });
});

// ─── Questions API ─────────────────────────────────────────────────────────
app.get('/api/questions', (req, res) => {
  const bankId = req.query.bank_id;
  const examMode = getSetting('exam_mode') === '1';

  // 手动选题优先（仅在非考试模式、无指定bank_id时生效）
  if (!examMode && !bankId) {
    const pinnedVal = getSetting('pinned_questions');
    if (pinnedVal) {
      try {
        const pinned = JSON.parse(pinnedVal);
        const todayStr = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
        const cycle = getCurrentCycle();
        // 跨套班失效：发布日早于本套班开始日 → 视为未发布
        const inCurrentCycle = !cycle?.start_date || !pinned.created_date || pinned.created_date >= cycle.start_date;
        const active = inCurrentCycle && ((pinned.scope === 'today' && pinned.created_date === todayStr) || pinned.scope === 'shift');
        if (active) {
          const count = pinned.count || 3;
          const mode = pinned.mode || (pinned.ids?.length > 0 ? 'manual' : 'emergency');
          const hasContent = (pinned.ids?.length > 0) || (mode === 'random' && (pinned.bank_id || pinned.bank_ids?.length > 0)) || mode === 'emergency';
          if (!hasContent) return res.json({ questions: [], bankId: 'pinned', count, examMode: false, pinned: true });
          let qs = [];

          if (mode === 'emergency') {
            qs = db.prepare('SELECT * FROM questions WHERE bank_id=1 AND active=1 ORDER BY RANDOM() LIMIT ?').all(count);
          } else if (mode === 'random') {
            if (pinned.bank_ids?.length > 0) {
              // 多题库混合随机
              const placeholders = pinned.bank_ids.map(() => '?').join(',');
              qs = db.prepare(`SELECT * FROM questions WHERE bank_id IN (${placeholders}) AND active=1 ORDER BY RANDOM() LIMIT ?`).all(...pinned.bank_ids, count);
            } else if (pinned.bank_id) {
              qs = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY RANDOM() LIMIT ?').all(pinned.bank_id, count);
            } else if (pinned.ids?.length > 0) {
              const placeholders = pinned.ids.map(() => '?').join(',');
              const pool = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders}) AND active=1`).all(...pinned.ids);
              // 从池中随机取 count 题
              for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
              qs = pool.slice(0, count);
            }
          } else if (mode === 'manual') {
            if (pinned.ids?.length > 0) {
              const placeholders = pinned.ids.map(() => '?').join(',');
              qs = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders}) AND active=1`).all(...pinned.ids);
            }
          }

          if (qs.length > 0) return res.json({ questions: qs, bankId: 'pinned', count: qs.length, examMode: false, pinned: true });
        }
      } catch(e) { /* fall through */ }
    }
  }

  let activeBankId;
  if (examMode) {
    activeBankId = parseInt(getSetting('exam_bank_id'));
  } else if (bankId) {
    activeBankId = parseInt(bankId);
  } else {
    const activeBank = db.prepare('SELECT id FROM question_banks WHERE is_default=1 LIMIT 1').get()
                    || db.prepare('SELECT id FROM question_banks WHERE is_active=1 LIMIT 1').get();
    activeBankId = activeBank?.id || 1;
  }

  const count = examMode
    ? parseInt(getSetting('exam_q_count'))
    : (db.prepare('SELECT default_count FROM question_banks WHERE id=?').get(activeBankId)?.default_count || 3);

  const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY RANDOM() LIMIT ?')
    .all(activeBankId, count);
  res.json({ questions: rows, bankId: activeBankId, count, examMode });
});

app.post('/api/questions', adminAuth, (req, res) => {
  const { text, reference, keywords, category, difficulty, bank_id } = req.body;
  if (!text?.trim() || !reference?.trim()) return res.status(400).json({ error: '题目和参考答案不能为空' });
  const r = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category,difficulty) VALUES (?,?,?,?,?,?)')
    .run(bank_id || 1, text.trim(), reference.trim(), keywords || '', category || '业务知识', difficulty || '中等');
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/questions/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE questions SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/questions/:id', adminAuth, (req, res) => {
  const { text, reference, keywords, category } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '题目不能为空' });
  db.prepare('UPDATE questions SET text=?,reference=?,keywords=?,category=? WHERE id=?')
    .run(text.trim(), reference||'', keywords||'', category||'业务知识', req.params.id);
  res.json({ ok: true });
});

// ─── Banks API ─────────────────────────────────────────────────────────────
app.get('/api/banks', (req, res) => {
  backfillQuestionTypes(); // 兜底：保证有最新的题型分布
  const banks = db.prepare('SELECT b.*, COUNT(q.id) as q_count FROM question_banks b LEFT JOIN questions q ON q.bank_id=b.id AND q.active=1 GROUP BY b.id ORDER BY sort_order').all();
  // 题型分布
  const distRows = db.prepare(`
    SELECT bank_id, type, COUNT(*) as c FROM questions
    WHERE active=1 AND type IS NOT NULL
    GROUP BY bank_id, type
  `).all();
  const byBank = {};
  for (const r of distRows) {
    (byBank[r.bank_id] = byBank[r.bank_id] || {})[r.type] = r.c;
  }
  for (const b of banks) {
    const d = byBank[b.id] || {};
    b.type_dist = d;
    // 判断"混合"：> 1 种类型 (choice_single+choice_multi 视为同一类"选择")
    const families = new Set();
    for (const t of Object.keys(d)) {
      if (t === 'choice_single' || t === 'choice_multi' || t === 'true_false') families.add('choice');
      else if (t === 'fill_blank') families.add('fill');
      else if (t === 'short_answer') families.add('short');
    }
    b.bank_type_summary = families.size > 1 ? 'mixed' : (families.size === 1 ? [...families][0] : 'empty');
  }
  res.json(banks);
});

app.post('/api/banks', adminAuth, (req, res) => {
  const { name, q_type, default_count } = req.body;
  const r = db.prepare('INSERT INTO question_banks (name,q_type,default_count) VALUES (?,?,?)').run(name, q_type || '简答', default_count || 3);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/banks/:id/activate', adminAuth, (req, res) => {
  db.prepare('UPDATE question_banks SET is_active=0').run();
  db.prepare('UPDATE question_banks SET is_active=1 WHERE id=?').run(req.params.id);
  const b = db.prepare('SELECT name FROM question_banks WHERE id=?').get(req.params.id);
  logAdmin('启用题库', b?.name || `ID=${req.params.id}`);
  res.json({ ok: true });
});

// 头像上传（答题结束时由本人设备提交，无需 admin 鉴权）
app.put('/api/staff/:id/avatar', (req, res) => {
  const { avatar } = req.body;
  if (!avatar || !avatar.startsWith('data:image/')) return res.status(400).json({ error: '无效图片' });
  if (avatar.length > 200000) return res.status(413).json({ error: '图片过大' }); // ~150KB base64 上限
  db.prepare('UPDATE staff SET avatar=? WHERE id=?').run(avatar, req.params.id);
  res.json({ ok: true });
});

// ─── Practice API ──────────────────────────────────────────────────────────
app.get('/api/practice/questions', (req, res) => {
  const { mode, count, bank_id } = req.query;
  // bank_id 显式传入则用之（应急或题库选择）；否则回退当前激活题库
  const targetBankId = bank_id
    ? parseInt(bank_id)
    : (db.prepare('SELECT id FROM question_banks WHERE is_active=1 LIMIT 1').get()?.id || 1);
  if (mode === 'sequential') {
    const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY id ASC').all(targetBankId);
    return res.json({ questions: rows, bankId: targetBankId });
  }
  if (mode === 'random_all') {
    const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY RANDOM()').all(targetBankId);
    return res.json({ questions: rows, bankId: targetBankId });
  }
  const n = Math.min(parseInt(count) || 3, 20);
  const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY RANDOM() LIMIT ?').all(targetBankId, n);
  res.json({ questions: rows, bankId: targetBankId });
});

app.get('/api/practice/monthly-status/:staffId', (req, res) => {
  const monthStr = new Date().toISOString().slice(0, 7); // YYYY-MM
  const used = db.prepare(`
    SELECT COUNT(*) as c FROM sessions
    WHERE staff_id=? AND is_practice=1 AND practice_bonus=1
    AND strftime('%Y-%m', created_at)=?
  `).get(req.params.staffId, monthStr);
  res.json({ used: used.c, max: 3 });
});

// ─── Session & Scoring ─────────────────────────────────────────────────────
app.post('/api/session/start', (req, res) => {
  const { staffId, staffName, isPractice } = req.body;
  if (!staffId || !staffName) return res.status(400).json({ error: '缺少工号或姓名' });
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';

  // 非练习模式校验
  if (!isPractice) {
    // 1. 早班截止：早班日 09:30 后不允许开始正式答题（有补答授权则豁免）
    const shiftInfo = getShiftInfo(new Date());
    if (shiftInfo.phase === 2) { // 2 = 早班
      const now = new Date();
      const bjNow = new Date(now.getTime() + 8*3600000);
      const bjHour = parseInt(bjNow.toISOString().slice(11,13));
      const bjMin  = parseInt(bjNow.toISOString().slice(14,16));
      if (bjHour > 9 || (bjHour === 9 && bjMin >= 30)) {
        // 检查是否有有效补答授权
        const grant = db.prepare(`
          SELECT expires_at FROM makeup_grants
          WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
        `).get(staffId, cycleId);
        if (!grant) {
          return res.status(400).json({ error: '早班答题已截止（09:30）', shiftDeadline: true });
        }
      }
    }
    // 2. 本轮有未完成的中断 session → 必须由管理员重置后才能重答
    const interrupted = db.prepare(`
      SELECT id FROM sessions
      WHERE staff_id=? AND cycle_id=? AND completed=0
        AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      LIMIT 1
    `).get(staffId, cycleId);
    if (interrupted) return res.status(400).json({ error: '答题已中断，请联系管理员重置后再作答', isInterrupted: true });

    // 3. 本轮已完成过正式答题（不限 q_count，避免残次 session 被绕过）
    const done = db.prepare(`
      SELECT id FROM sessions
      WHERE staff_id=? AND cycle_id=? AND completed=1
        AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      LIMIT 1
    `).get(staffId, cycleId);
    if (done) return res.status(400).json({ error: '本轮已完成答题，无需重复作答', alreadyDone: true });
  }

  const r = db.prepare('INSERT INTO sessions (staff_id,staff_name,cycle_id,is_practice) VALUES (?,?,?,?)')
    .run(staffId, staffName, cycleId, isPractice ? 1 : 0);
  res.json({ sessionId: r.lastInsertRowid, cycleId: cycle?.id });
});

// AI scoring (DashScope Qwen or keyword fallback)
function buildScoringPrompt(question, reference, answer, category) {
  const isIncident = category && (category.includes('安全') || category.includes('事件') || category.includes('事故') || category.includes('分析'));
  const ansText = answer || '（未作答）';

  if (isIncident) {
    return `你是武汉地铁乘务安全培训考核专家，评估乘务员对安全事件的复述掌握情况。只返回JSON，不含任何其他内容。

【题目】${question}

【标准事件要点】（每个分号分隔的是一个独立要点，无顺序要求，覆盖即得分）
${reference}

【乘务员口述】（来自语音识别，可能含口语化表达、停顿词、同音字错误）
${ansText}

【评分说明】
- 这是事件复述题，不要求严格顺序，覆盖要点即得分
- 【时间要求极宽松】：无论题目或参考答案中是否出现具体时间，考生只需说出"日期"或"大概事件阶段"（如"动车时""退行过程中"）即可，精确到分钟/秒不是考核要求，绝对不能因为时间不精确扣分
- 参考答案中若含有"HH:MM:SS"格式时间戳，评分时完全忽略这些时间戳，不将其列入missing_points
- "嗯""呃""然后""就是""那个"等停顿词忽略不计
- 同音字/近音字按语义理解（如"阳螺"≈"阳逻"，"B拐1"≈"B01"，"U零二"≈"U02"）
- 意思相近表达视为正确（如"越过信号机"和"冒进信号机"等同，"挤岔"和"道岔挤岔报警"等同）
- 核心要点：事件地点、涉及车辆、关键违规/失误行为、事故后果，这些重点考查
- 能说清事件主要经过（起因→过程→结果）即可合格，遗漏所有细节才算缺失

只返回如下JSON，不要加任何解释或markdown：
{"score":0-100,"level":"优秀|合格|需加强","summary":"一句话总体评价","correct_points":["已正确复述的要点"],"missing_points":["完全未提及的关键要点（仅列主要的，不超过3条）"],"order_errors":[],"suggestion":"具体改进建议","encouragement":"鼓励语"}`;
  }

  // 默认：操作流程题（应急处置等），严格顺序
  return `你是武汉地铁乘务培训考核专家，评估乘务员的故障处理口述答题。只返回JSON，不含任何其他内容。

【题目】${question}

【标准处置步骤】（顺序为递进排除法，不可颠倒）
${reference}

【乘务员口述】（来自语音识别，可能含口语化表达、停顿词、同音字错误）
${ansText}

【评分说明】
- "然后""就是""那个""嗯"等停顿词忽略不计
- 同音字/近音字（如"隔离"识别成"格里"）按语义理解，不算错
- 意思相近、表达不同的步骤（如"通知列车长"说成"报告车长"）视为正确
- 核心判断：是否按顺序说出了各关键步骤，完全遗漏才算缺失
- 步骤顺序严格评判，颠倒不得分；含糊但方向正确给一半分

只返回如下JSON，不要加任何解释或markdown：
{"score":0-100,"level":"优秀|合格|需加强","summary":"一句话总体评价","correct_points":["已正确说出的步骤"],"missing_points":["完全遗漏的步骤"],"order_errors":["顺序颠倒说明，没有则空数组"],"suggestion":"具体改进建议","encouragement":"鼓励语"}`;
}

async function scoreWithQwen(question, reference, answer, category) {
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY || !answer?.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: buildScoringPrompt(question, reference, answer, category) }],
        max_tokens: 800,
        temperature: 0.1
      }),
      signal: controller.signal
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch(e) { return null; } finally { clearTimeout(timer); }
}

function scoreKeyword(reference, keywords, answer) {
  if (!answer?.trim() || answer.trim().length < 3) return { score:0, level:'需加强', summary:'未检测到有效作答', correct_points:[], missing_points:['未作答'], suggestion:'请重新作答', encouragement:'相信你能做到！', score_method:'keyword' };
  const ans = answer.toLowerCase().replace(/\s/g,'');
  const pts = reference.split(/[；;]/).map(s=>s.trim()).filter(Boolean);
  const kws = keywords?.split(',').map(s=>s.trim()).filter(Boolean)||[];
  let hit=0; const correct=[], missing=[];
  pts.forEach(p => {
    const words = p.replace(/[，。、]/g,' ').split(' ').filter(s=>s.length>=2);
    if(words.some(w=>ans.includes(w))){ hit++; correct.push(p.slice(0,14)); }
    else missing.push(p.slice(0,14));
  });
  const base = Math.round(hit/Math.max(pts.length,1)*100);
  const bonus = Math.min(8, Math.round(kws.filter(k=>ans.includes(k)).length/Math.max(kws.length,1)*8));
  const score = Math.min(100, base+bonus);
  const level = score>=85?'优秀':score>=60?'合格':'需加强';
  return { score, level,
    summary: score>=85?'回答全面，核心要点均已覆盖。':score>=60?'基本掌握要点，部分细节待补充。':'回答不够完整，需加强学习。',
    correct_points:correct.slice(0,4), missing_points:missing.slice(0,4),
    suggestion: missing.length?`建议重点复习：${missing.slice(0,2).join('、')}。`:'掌握良好！',
    encouragement: score>=85?'非常棒，继续保持！':score>=60?'继续加油，熟能生巧！':'多复习几遍，一定能掌握！',
    score_method:'keyword' };
}

app.post('/api/score', async (req, res) => {
  const { questionId, answer } = req.body;
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(questionId);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  let result = await scoreWithQwen(q.text, q.reference, answer, q.category);
  if (!result) result = scoreKeyword(q.reference, q.keywords, answer);
  else result.score_method = 'ai';
  result.transcript = answer || "";
  res.json(result);
});

app.post('/api/session/:id/answer', (req, res) => {
  const { staffId, staffName, questionId, questionText, category, answerText, score, level, summary, correctPoints, missingPoints, suggestion, scoreMethod } = req.body;
  db.prepare(`INSERT INTO answers (session_id,staff_id,staff_name,question_id,question_text,category,answer_text,score,level,summary,correct_points,missing_points,suggestion,score_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, staffId, staffName, questionId, questionText, category, answerText, score, level, summary, JSON.stringify(correctPoints||[]), JSON.stringify(missingPoints||[]), suggestion, scoreMethod||'keyword');
  res.json({ ok: true });
});

app.post('/api/session/:id/finish', (req, res) => {
  const sess = db.prepare('SELECT staff_id, is_practice FROM sessions WHERE id=?').get(req.params.id);
  if (sess) {
    const staffRow = db.prepare('SELECT is_tester FROM staff WHERE id=?').get(sess.staff_id);
    if (staffRow?.is_tester) {
      db.prepare("UPDATE sessions SET staff_name = CASE WHEN staff_name NOT LIKE '%(测试)' THEN staff_name || '(测试)' ELSE staff_name END WHERE id=?").run(req.params.id);
    }
  }
  const { totalScore, tabSwitchCount } = req.body;
  const cnt = db.prepare('SELECT COUNT(*) as c FROM answers WHERE session_id=?').get(req.params.id);
  const tabSwitch = parseInt(tabSwitchCount) || 0;

  if (sess?.is_practice) {
    // 练习模式：不计入常规积分，每完成1次给1分奖励（每月最多3次）
    const monthStr = new Date().toISOString().slice(0, 7);
    const usedThisMonth = db.prepare(`
      SELECT COUNT(*) as c FROM sessions
      WHERE staff_id=? AND is_practice=1 AND practice_bonus=1
      AND strftime('%Y-%m', created_at)=?
    `).get(sess.staff_id, monthStr);
    const bonus = usedThisMonth.c < 3 ? 1 : 0;
    db.prepare('UPDATE sessions SET total_score=?,q_count=?,base_points=0,bonus_points=0,total_points=?,practice_bonus=?,tab_switch_count=?,completed=1 WHERE id=?')
      .run(totalScore, cnt.c, bonus, bonus, tabSwitch, req.params.id);
    return res.json({ points: { base: 0, bonus: 0, total: bonus, isPractice: true, practiceBonus: bonus, practiceUsed: usedThisMonth.c + bonus, practiceMax: 3 } });
  }

  const pts = calcPoints(totalScore, cnt.c);
  // 练习加成：本月练习过至少一次的+1分
  const hasPracticed = db.prepare(
    `SELECT COUNT(*) as c FROM sessions WHERE staff_id=? AND is_practice=1 AND completed=1 AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')`
  ).get(sess.staff_id);
  if (hasPracticed.c > 0) { pts.bonus = 1; pts.total += 1; }
  db.prepare('UPDATE sessions SET total_score=?,q_count=?,base_points=?,bonus_points=?,total_points=?,tab_switch_count=?,completed=1 WHERE id=?')
    .run(totalScore, cnt.c, pts.base, pts.bonus, pts.total, tabSwitch, req.params.id);
  res.json({ points: pts });
});

// ─── Leaderboard ───────────────────────────────────────────────────────────
// 轮班榜：每人取本轮第一次正式答题成绩，多次答题标记次数
app.get('/api/leaderboard/cycle', (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json([]);
  const rows = db.prepare(`
    SELECT s.staff_id, s.staff_name, s.total_points, s.total_score as score,
           s.q_count, s.tab_switch_count, s.created_at as last_at,
           (SELECT COUNT(*) FROM sessions s2 WHERE s2.staff_id=s.staff_id AND s2.cycle_id=s.cycle_id
            AND s2.completed=1 AND COALESCE(s2.is_practice,0)=0) as attempts,
           (SELECT avatar FROM staff WHERE id=s.staff_id LIMIT 1) as avatar,
           COALESCE(st.is_exempt,0) as is_exempt,
           COALESCE(st.is_instructor,0) as is_instructor
    FROM sessions s
    LEFT JOIN staff st ON st.id=s.staff_id
    WHERE s.id IN (
      SELECT MIN(id) FROM sessions
      WHERE cycle_id=? AND completed=1 AND COALESCE(hidden,0)=0
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      AND staff_id NOT IN (SELECT id FROM staff WHERE is_leader=1)
      GROUP BY staff_id
    )
    ORDER BY s.total_points DESC LIMIT 30
  `).all(cycle.id);
  res.json({ cycle, rows });
});

// 今日榜：每人取今天第一次正式答题成绩
app.get('/api/leaderboard/today', (req, res) => {
  const rows = db.prepare(`
    SELECT s.staff_id, s.staff_name, s.total_points, s.total_score as score,
           s.q_count, s.tab_switch_count,
           (SELECT COUNT(*) FROM sessions s2 WHERE s2.staff_id=s.staff_id
            AND date(datetime(s2.created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours'))
            AND s2.completed=1 AND COALESCE(s2.is_practice,0)=0) as attempts
    FROM sessions s
    WHERE s.id IN (
      SELECT MIN(id) FROM sessions
      WHERE date(datetime(created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours')) AND completed=1 AND COALESCE(hidden,0)=0
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      GROUP BY staff_id
    )
    ORDER BY s.total_points DESC LIMIT 30
  `).all();
  res.json(rows);
});

// 本月总榜：每人每轮取平均积分，跨轮累加（覆盖本月所有轮班）
app.get('/api/leaderboard/monthly', (req, res) => {
  const rows = db.prepare(`
    WITH cycle_avg AS (
      SELECT staff_id, staff_name, cycle_id,
             ROUND(AVG(total_points), 0) as cycle_pts
      FROM sessions
      WHERE completed=1 AND COALESCE(hidden,0)=0 AND COALESCE(is_practice,0)=0
      AND COALESCE(is_deleted,0)=0
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      AND staff_id NOT IN (SELECT id FROM staff WHERE is_exempt=1)
      GROUP BY staff_id, cycle_id
    )
    SELECT staff_id, staff_name,
           SUM(cycle_pts) as total_points,
           COUNT(DISTINCT cycle_id) as cycle_count,
           (SELECT avatar FROM staff WHERE id=staff_id LIMIT 1) as avatar
    FROM cycle_avg
    GROUP BY staff_id
    ORDER BY total_points DESC LIMIT 30
  `).all();
  res.json(rows);
});

// ─── Leaderboard member detail ─────────────────────────────────────────────
function getSessionsWithAnswers(staffId, whereExtra, params) {
  const sessions = db.prepare(`
    SELECT s.id, s.staff_id, s.staff_name, s.total_score, s.total_points,
           s.q_count, s.tab_switch_count, s.created_at,
           (SELECT avatar FROM staff WHERE id=s.staff_id LIMIT 1) as avatar,
           c.label as cycle_label
    FROM sessions s LEFT JOIN cycles c ON c.id=s.cycle_id
    WHERE s.completed=1 AND COALESCE(s.is_practice,0)=0 AND COALESCE(s.hidden,0)=0
    AND COALESCE(s.is_deleted,0)=0
    AND s.staff_id=? ${whereExtra}
    ORDER BY s.id ASC LIMIT 10
  `).all(staffId, ...params);
  return sessions.map(s => ({
    ...s,
    answers: db.prepare(
      'SELECT question_text, score, level FROM answers WHERE session_id=? ORDER BY id ASC'
    ).all(s.id)
  }));
}

app.get('/api/leaderboard/cycle/member/:staffId', (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ sessions: [] });
  res.json({ sessions: getSessionsWithAnswers(req.params.staffId, 'AND s.cycle_id=?', [cycle.id]) });
});

app.get('/api/leaderboard/alltime/member/:staffId', (req, res) => {
  res.json({ sessions: getSessionsWithAnswers(
    req.params.staffId,
    "AND strftime('%Y-%m', s.created_at)=strftime('%Y-%m','now','localtime')",
    []
  )});
});

// Admin: alltime drill-down — per-cycle breakdown for a staff member (this month)
app.get('/api/admin/leaderboard/alltime/cycles/:staffId', adminAuth, (req, res) => {
  const staffId = req.params.staffId;
  const cycles = db.prepare(`
    SELECT s.cycle_id, c.label as cycle_label,
           SUM(s.total_points) as total_points,
           ROUND(AVG(s.total_score),1) as avg_score,
           COUNT(*) as sessions_count
    FROM sessions s
    LEFT JOIN cycles c ON c.id=s.cycle_id
    WHERE s.staff_id=? AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.is_deleted,0)=0 AND COALESCE(s.hidden,0)=0
      AND strftime('%Y-%m', s.created_at)=strftime('%Y-%m','now','localtime')
    GROUP BY s.cycle_id
    ORDER BY MIN(s.created_at) ASC
  `).all(staffId);
  const result = cycles.map(c => ({
    ...c,
    sessions: getSessionsWithAnswers(staffId, 'AND s.cycle_id=?', [c.cycle_id])
  }));
  res.json({ cycles: result });
});

// Alias: alltime = monthly (home screen compatibility)
app.get('/api/leaderboard/alltime', (req, res) => {
  const rows = db.prepare(`
    WITH cycle_avg AS (
      SELECT staff_id, staff_name, cycle_id,
             ROUND(AVG(total_points), 0) as cycle_pts
      FROM sessions
      WHERE completed=1 AND COALESCE(hidden,0)=0 AND COALESCE(is_practice,0)=0
      AND COALESCE(is_deleted,0)=0
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      AND staff_id NOT IN (SELECT id FROM staff WHERE is_leader=1)
      GROUP BY staff_id, cycle_id
    )
    SELECT ca.staff_id, ca.staff_name,
           SUM(ca.cycle_pts) as total_points,
           COUNT(DISTINCT ca.cycle_id) as cycle_count,
           COALESCE(st.is_exempt,0) as is_exempt,
           COALESCE(st.is_instructor,0) as is_instructor
    FROM cycle_avg ca LEFT JOIN staff st ON st.id=ca.staff_id
    GROUP BY ca.staff_id ORDER BY total_points DESC LIMIT 30
  `).all();
  res.json(rows);
});

// ─── Personal Analytics ────────────────────────────────────────────────────
app.get('/api/me/:staffId', (req, res) => {
  const sid = req.params.staffId;
  const staff = db.prepare('SELECT * FROM staff WHERE id=?').get(sid);

  // Streak: consecutive days answered
  const days = db.prepare(`SELECT DISTINCT date(created_at) as d FROM sessions WHERE staff_id=? AND completed=1 ORDER BY d DESC`).all(sid);
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i = 0; i < days.length; i++) {
    const d = new Date(days[i].d); d.setHours(0,0,0,0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === i || diff === i+1) streak++; else break;
  }

  // Category scores
  const catScores = db.prepare(`
    SELECT category, ROUND(AVG(score),0) as avg FROM answers WHERE staff_id=? GROUP BY category
  `).all(sid);

  // Weak points (categories below 80)
  const weakCats = catScores.filter(c=>c.avg<80).sort((a,b)=>a.avg-b.avg).slice(0,3);

  // Recent 12 sessions trend
  const trend = db.prepare(`
    SELECT ROUND(total_score,0) as score, created_at FROM sessions WHERE staff_id=? AND completed=1 ORDER BY created_at DESC LIMIT 12
  `).all(sid).reverse();

  // Recent sessions detail
  const recent = db.prepare(`
    SELECT s.id, s.total_score, s.total_points, s.q_count, s.created_at,
           GROUP_CONCAT(a.category) as cats
    FROM sessions s
    LEFT JOIN answers a ON a.session_id=s.id
    WHERE s.staff_id=? AND s.completed=1 AND COALESCE(s.is_practice,0)=0
    GROUP BY s.id ORDER BY s.created_at DESC LIMIT 10
  `).all(sid);

  // Total stats
  const stats = db.prepare(`
    SELECT COUNT(*) as total_sessions, SUM(total_points) as total_points,
           ROUND(AVG(total_score),1) as avg_score,
           COUNT(DISTINCT date(created_at)) as total_days
    FROM sessions WHERE staff_id=? AND completed=1
  `).get(sid);

  // Cycle rank
  const cycle = getCurrentCycle();
  let cycleRank = null;
  if (cycle) {
    const rank = db.prepare(`
      SELECT staff_id, RANK() OVER (ORDER BY SUM(total_points) DESC) as rnk
      FROM sessions WHERE cycle_id=? AND completed=1 GROUP BY staff_id
    `).all(cycle.id);
    cycleRank = rank.find(r=>r.staff_id===sid)?.rnk || null;
  }

  // 当前轮次是否有未完成的正式 session（中断状态）
  const cycleId = cycle?.id || 'default';
  const interruptedSession = db.prepare(`
    SELECT id FROM sessions
    WHERE staff_id=? AND cycle_id=? AND completed=0
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
    LIMIT 1
  `).get(sid, cycleId);
  const isInterrupted = !!interruptedSession;

  res.json({ staff, streak, catScores, weakCats, trend, recent, stats, cycleRank, isInterrupted });
});

// ─── Admin Analytics ───────────────────────────────────────────────────────
app.get('/api/admin/overview', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || null;
  const todayComplete = cycleId ? db.prepare(`
    SELECT COUNT(DISTINCT s.staff_id) as c FROM sessions s
    JOIN staff st ON st.id = s.staff_id
    WHERE s.cycle_id=? AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.is_deleted,0)=0 AND st.is_exempt=0 AND COALESCE(st.is_cp,0)=0 AND s.q_count>=3
  `).get(cycleId).c : 0;
  const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff WHERE is_exempt=0 AND COALESCE(is_cp,0)=0").get().c;
  const catAvg = db.prepare("SELECT category, ROUND(AVG(score),0) as avg FROM answers GROUP BY category ORDER BY avg").all();
  const topWeak = catAvg.slice(0,2);
  const cycleStats = cycle ? db.prepare(`
    SELECT staff_id, staff_name, SUM(total_points) as pts, ROUND(AVG(total_score),1) as avg, COUNT(*) as sessions
    FROM sessions WHERE cycle_id=? AND completed=1 AND COALESCE(hidden,0)=0 AND COALESCE(is_deleted,0)=0 GROUP BY staff_id ORDER BY pts DESC
  `).all(cycle.id) : [];
  const incompleteList = cycleId ? db.prepare(`
    SELECT COALESCE(s.real_name, s.name) as name,
           COALESCE(s.is_tester,0) as is_tester,
           COALESCE(s.is_cp,0) as is_cp,
           COALESCE(s.is_exempt,0) as is_exempt
    FROM staff s
    WHERE s.is_exempt=0 AND COALESCE(s.is_cp,0)=0
      AND s.id NOT IN (
        SELECT DISTINCT staff_id FROM sessions
        WHERE cycle_id=? AND completed=1 AND q_count>=3 AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      )
    ORDER BY s.name
  `).all(cycleId) : [];
  // Full staff list with cycle completion status for color-coded overview
  const staffRows = cycleId ? db.prepare(`
    SELECT s.id as staff_id,
           COALESCE(s.real_name, s.name) as name,
           COALESCE(s.is_tester, 0) as is_tester,
           MAX(CASE WHEN ss.completed=1 AND COALESCE(ss.q_count,0)>=3
                    AND COALESCE(ss.is_practice,0)=0 AND COALESCE(ss.is_deleted,0)=0
                    THEN 1 ELSE 0 END) as completed_today,
           MAX(CASE WHEN ss.id IS NOT NULL AND COALESCE(ss.is_practice,0)=0
                    AND COALESCE(ss.is_deleted,0)=0
                    THEN 1 ELSE 0 END) as has_session,
           MAX(CASE WHEN ss.id IS NOT NULL AND COALESCE(ss.is_practice,0)=0
                    AND COALESCE(ss.is_deleted,0)=0
                    THEN COALESCE(ss.q_count,0) ELSE 0 END) as max_q,
           MAX(CASE WHEN ss.completed=1 AND COALESCE(ss.q_count,0)>=3
                    AND COALESCE(ss.is_practice,0)=0 AND COALESCE(ss.is_deleted,0)=0
                    THEN ss.total_score ELSE NULL END) as score,
           MAX(CASE WHEN ss.completed=1 AND COALESCE(ss.q_count,0)>=3
                    AND COALESCE(ss.is_practice,0)=0 AND COALESCE(ss.is_deleted,0)=0
                    THEN ss.total_points ELSE NULL END) as points,
           MAX(CASE WHEN ss.completed=1 AND COALESCE(ss.q_count,0)>=3
                    AND COALESCE(ss.is_practice,0)=0 AND COALESCE(ss.is_deleted,0)=0
                    THEN ss.created_at ELSE NULL END) as completed_at,
           MAX(CASE WHEN COALESCE(ss.completed,0)=0 AND COALESCE(ss.is_practice,0)=0
                    AND COALESCE(ss.is_deleted,0)=0 AND ss.id IS NOT NULL
                    THEN COALESCE((SELECT MAX(a.created_at) FROM answers a WHERE a.session_id=ss.id), ss.created_at)
                    ELSE NULL END) as last_active_at
    FROM staff s
    LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.cycle_id=?
    WHERE s.is_exempt=0 AND COALESCE(s.is_cp,0)=0
    GROUP BY s.id
    ORDER BY s.name ASC
  `).all(cycleId) : [];
  // 判断当前是否早班截止后（早班日 09:30+）
  const nowInfo = getShiftInfo(new Date());
  const isAfterMorningDeadline = (() => {
    if (nowInfo.phase !== 2) return false;
    const bjNow = new Date(Date.now() + 8*3600000);
    const h = parseInt(bjNow.toISOString().slice(11,13));
    const m = parseInt(bjNow.toISOString().slice(14,16));
    return h > 9 || (h === 9 && m >= 30);
  })();

  // 最近 10 分钟内有答题动作的视为"正在答题"，避免误判中断
  const ANSWERING_GAP_MS = 10 * 60 * 1000;
  const isRecentlyActive = (ts) => {
    if (!ts) return false;
    const t = new Date(ts.replace(' ', 'T')).getTime();
    return !isNaN(t) && (Date.now() - t) < ANSWERING_GAP_MS;
  };
  const allStaff = staffRows.map(r => {
    let status;
    if (r.completed_today) status = 'done';
    else if (r.has_session && isRecentlyActive(r.last_active_at)) status = 'answering';
    else if (r.has_session && r.max_q > 0) status = 'interrupted';
    else if (r.has_session) status = 'browsed';
    else status = 'none';
    // 早班截止后未完成 → 标记逾期
    const overdue = isAfterMorningDeadline && status === 'none';
    return { staff_id: r.staff_id, name: r.name, is_tester: r.is_tester, status, overdue, score: r.score, points: r.points, completed_at: r.completed_at, last_active_at: r.last_active_at };
  });
  res.json({ todayComplete, totalStaff, catAvg, topWeak, cycle, cycleStats, incompleteList, allStaff });
});

// Reset a staff member's current cycle quiz quota (mark all cycle sessions as deleted)
app.delete('/api/admin/sessions/reset-cycle/:staffId', adminAuth, (req, res) => {
  const staffId = req.params.staffId;
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const staff = db.prepare('SELECT COALESCE(real_name,name) as name FROM staff WHERE id=?').get(staffId);
  const result = db.prepare(`
    UPDATE sessions SET is_deleted=1
    WHERE staff_id=? AND cycle_id=? AND COALESCE(is_deleted,0)=0 AND COALESCE(is_practice,0)=0
  `).run(staffId, cycleId);
  logAdmin('重置套班答题机会', `${staff?.name||staffId}(${staffId}) cycle=${cycleId} affected=${result.changes}`);
  res.json({ ok: true, affected: result.changes });
});

// ─── Makeup Grant（早班逾期补答）──────────────────────────────────────────────
// 管理员授权补答：30分钟有效期
app.post('/api/admin/makeup/grant', adminAuth, (req, res) => {
  const { staffId } = req.body;
  if (!staffId) return res.status(400).json({ error: '缺少 staffId' });
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const staff = db.prepare('SELECT COALESCE(real_name,name) as name FROM staff WHERE id=?').get(staffId);
  // expires_at = 当前北京时间 + 30分钟
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  db.prepare(`INSERT OR REPLACE INTO makeup_grants (staff_id, cycle_id, expires_at) VALUES (?,?,?)`)
    .run(staffId, cycleId, expiresAt);
  logAdmin('补答授权', `${staff?.name||staffId}(${staffId}) 有效至 ${expiresAt}`);
  res.json({ ok: true, staffId, expiresAt });
});

// 用户端查询补答授权状态
app.get('/api/makeup/status/:staffId', (req, res) => {
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const grant = db.prepare(`
    SELECT expires_at FROM makeup_grants
    WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
  `).get(req.params.staffId, cycleId);
  res.json({ granted: !!grant, expiresAt: grant?.expires_at || null });
});

// 本月培训项点完成情况（各计划评价进度）
app.get('/api/admin/month-plan-completion', adminAuth, (req, res) => {
  const month = req.query.month || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
  const plans = db.prepare(
    "SELECT id, shift_date, plan_type, group_id, leader_name, completed_items FROM monthly_training_plans WHERE year_month=? AND plan_type NOT IN ('轮空') ORDER BY shift_date"
  ).all(month);

  const result = plans.map(plan => {
    // 用 override-aware 函数取当前成员名单
    const full = getTrainingPlanForDate(plan.shift_date);
    const fixedIds = new Set((full?.fixedStaff||[]).map(f=>String(f.staff_id)));
    // 组员（排除固定成员和教员）
    const members = (full?.group?.members||[]).filter(m=>!fixedIds.has(String(m.id)));
    // 固定成员也加进来（他们也参与培训）
    const fixedMembers = (full?.fixedStaff||[]).map(f=>({id:String(f.staff_id),name:f.real_name||f.name}));
    const allMembers = [...members.map(m=>({id:String(m.id),name:m.real_name||m.name})), ...fixedMembers];

    // 已评价的成员（含评价内容）
    const evals = db.prepare('SELECT staff_id, comment FROM training_evaluations WHERE plan_id=?').all(plan.id);
    const evalMap = new Map(evals.map(e=>[String(e.staff_id), e.comment||'']));

    const membersWithStatus = allMembers.map(m=>({
      id: m.id, name: m.name, evaluated: evalMap.has(m.id),
      comment: evalMap.get(m.id) || '',
    }));

    const group = full?.group;
    return {
      id: plan.id,
      shift_date: plan.shift_date,
      plan_type: plan.plan_type,
      group_name: group?.name || '',
      completed_items: JSON.parse(plan.completed_items || '[]'),
      total: allMembers.length,
      done: evals.length,
      members: membersWithStatus,
    };
  });

  res.json(result);
});

// 本月成员完成情况（按小组分组，每人显示培训项点完成进度）
app.get('/api/admin/month-member-completion', adminAuth, (req, res) => {
  const month = req.query.month || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
  const [yearStr, monthStr] = month.split('-');

  // 本月年度计划项点总数
  const yearPlanRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?').get(parseInt(yearStr), parseInt(monthStr));
  const monthItems = JSON.parse(yearPlanRow?.sessions_json || '[]');
  const totalItems = monthItems.length; // Y（本月总项点数）

  // 本月所有培训计划（排除轮空，包含中旬会）
  const plans = db.prepare(
    "SELECT id, shift_date, plan_type, completed_items FROM monthly_training_plans WHERE year_month=? AND plan_type NOT IN ('轮空') ORDER BY shift_date"
  ).all(month);

  // 计算每人已完成项点（保留场次/评价）
  const personDone = {}; // staffId -> Map<itemName, {item, shift_date, comment}>
  for (const plan of plans) {
    const completedItems = JSON.parse(plan.completed_items || '[]');
    if (completedItems.length === 0) continue; // 未设置项点，不计入进度

    const full = getTrainingPlanForDate(plan.shift_date);
    if (!full) continue;
    const fixedIds = new Set((full.fixedStaff||[]).map(f=>String(f.staff_id)));

    let allParticipants;
    if (plan.plan_type === '中旬会') {
      // 中旬会：全员参与，取所有小组成员 + 固定成员
      const allGroupMembers = db.prepare(
        'SELECT tgm.staff_id FROM training_group_members tgm WHERE tgm.is_fixed=0'
      ).all();
      allParticipants = [
        ...allGroupMembers.map(m=>String(m.staff_id)).filter(id=>!fixedIds.has(id)),
        ...(full.fixedStaff||[]).map(f=>String(f.staff_id))
      ];
    } else {
      const members = (full.group?.members||[]).filter(m=>!fixedIds.has(String(m.id)));
      allParticipants = [
        ...members.map(m=>String(m.id)),
        ...(full.fixedStaff||[]).map(f=>String(f.staff_id))
      ];
    }

    const evals = db.prepare('SELECT staff_id, comment FROM training_evaluations WHERE plan_id=?').all(plan.id);
    const evalMap = new Map(evals.map(e=>[String(e.staff_id), e.comment||'']));
    for (const sid of allParticipants) {
      if (evalMap.has(sid)) {
        if (!personDone[sid]) personDone[sid] = new Map();
        for (const item of completedItems) {
          // 同一项点出现多次时保留最早的场次
          if (!personDone[sid].has(item)) {
            personDone[sid].set(item, { item, shift_date: plan.shift_date, comment: evalMap.get(sid) });
          }
        }
      }
    }
  }

  // 4个小组及其成员（含教员名，排除豁免/CP人员）
  const groups = db.prepare(
    'SELECT g.*, COALESCE(s.real_name, s.name) as instructor_name FROM training_groups g LEFT JOIN staff s ON s.id=g.instructor_id ORDER BY g.id'
  ).all();
  const groupMembers = db.prepare(
    'SELECT tgm.group_id, tgm.staff_id, s.real_name, s.name, s.is_exempt, COALESCE(s.is_cp,0) as is_cp FROM training_group_members tgm JOIN staff s ON s.id=tgm.staff_id WHERE tgm.is_fixed=0 ORDER BY tgm.group_id, s.id'
  ).all();

  const buildMember = (sid, name) => {
    const doneMap = personDone[String(sid)];
    const doneItems = doneMap ? Array.from(doneMap.values()) : [];
    return { id: String(sid), name, total: totalItems, done: doneItems.length, doneItems };
  };

  const result = groups.map(g => ({
    id: g.id,
    name: g.name,
    instructor_name: g.instructor_name || null,
    members: groupMembers
      .filter(m => m.group_id === g.id && !m.is_cp)
      .map(m => buildMember(m.staff_id, m.real_name || m.name))
  }));

  // 固定成员
  const fixedStaff = db.prepare(
    'SELECT f.staff_id, s.real_name, s.name FROM training_fixed_members f JOIN staff s ON f.staff_id=s.id'
  ).all().map(f => buildMember(f.staff_id, f.real_name || f.name));

  res.json({groups: result, fixed: fixedStaff, totalItems, monthItems});
});

app.get('/api/admin/weak-questions', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json([]);
  const rows = db.prepare(`
    SELECT a.question_text,
           COUNT(*) as total,
           SUM(CASE WHEN a.score < 67 THEN 1 ELSE 0 END) as wrong,
           ROUND(AVG(a.score), 0) as avg_score
    FROM answers a
    JOIN sessions s ON s.id = a.session_id
    WHERE s.cycle_id = ? AND s.completed = 1 AND COALESCE(s.is_practice, 0) = 0 AND COALESCE(s.is_deleted, 0) = 0
    GROUP BY a.question_text
    HAVING total >= 2
    ORDER BY (CAST(wrong AS REAL) / total) DESC, avg_score ASC
    LIMIT 12
  `).all(cycle.id);
  const wrongNamesStmt = db.prepare(`
    SELECT DISTINCT COALESCE(st.real_name, a.staff_name) as name
    FROM answers a
    JOIN sessions s ON s.id = a.session_id
    LEFT JOIN staff st ON st.id = a.staff_id
    WHERE s.cycle_id = ? AND s.completed = 1 AND COALESCE(s.is_practice, 0) = 0 AND COALESCE(s.is_deleted, 0) = 0
      AND a.question_text = ? AND a.score < 67
  `);
  res.json(rows.map(r => ({
    ...r,
    error_rate: Math.round(r.wrong / Math.max(r.total, 1) * 100),
    wrong_names: wrongNamesStmt.all(cycle.id, r.question_text).map(n => n.name)
  })));
});

app.get('/api/admin/members', adminAuth, (req, res) => {
  const members = db.prepare(`
    SELECT s.id, s.real_name, s.phone_tail, s.is_exempt, s.is_tester, COALESCE(s.is_cp,0) as is_cp, COALESCE(s.is_leader,0) as is_leader, COALESCE(s.is_instructor,0) as is_instructor,
           COUNT(DISTINCT date(ss.created_at)) as answer_days,
           ROUND(AVG(ss.total_score),1) as avg_score,
           MAX(ss.total_score) as best_score,
           SUM(ss.total_points) as total_points,
           MAX(ss.created_at) as last_at
    FROM staff s
    LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1 AND COALESCE(ss.is_deleted,0)=0
    GROUP BY s.id ORDER BY total_points DESC NULLS LAST
  `).all();
  res.json(members);
});

app.get('/api/admin/member/:id', adminAuth, (req, res) => {
  const sid = req.params.id;
  const catScores = db.prepare("SELECT category, ROUND(AVG(score),0) as avg FROM answers WHERE staff_id=? GROUP BY category").all(sid);
  const missing = db.prepare(`
    SELECT mp.value as point, COUNT(*) as cnt
    FROM answers a, json_each(a.missing_points) mp
    WHERE a.staff_id=?
    GROUP BY mp.value ORDER BY cnt DESC LIMIT 5
  `).all(sid);
  const sessions = db.prepare("SELECT * FROM sessions WHERE staff_id=? AND completed=1 ORDER BY created_at DESC LIMIT 20").all(sid);
  res.json({ catScores, missing, sessions });
});

app.get('/api/admin/records', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id
    ORDER BY a.created_at DESC LIMIT 500
  `).all();
  res.json(rows);
});

// ─── Cycle management ──────────────────────────────────────────────────────
app.post('/api/admin/cycle/new', adminAuth, (req, res) => {
  const { label } = req.body;
  db.prepare("UPDATE cycles SET is_current=0").run();
  const id = `cycle_${Date.now()}`;
  const lbl = label || `班次_${new Date().toLocaleDateString('zh-CN')}`;
  db.prepare("INSERT INTO cycles (id,label,start_date,is_current) VALUES (?,?,?,1)")
    .run(id, lbl, new Date().toISOString().slice(0,10));
  logAdmin('开启新轮次', lbl);
  res.json({ cycleId: id });
});

// ─── Settings ──────────────────────────────────────────────────────────────
app.get('/api/settings', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.put('/api/settings', adminAuth, (req, res) => {
  const updates = req.body;
  Object.entries(updates).forEach(([k,v]) => db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(k, String(v)));
  logAdmin('修改设置', Object.entries(updates).map(([k,v])=>`${k}=${v}`).join(', '));
  res.json({ ok: true });
});

// ─── Personal Answers History ──────────────────────────────────────────────
app.get('/api/me/:staffId/answers', (req, res) => {
  const rows = db.prepare(`
    SELECT a.question_text, a.answer_text, a.score, a.level, a.category, a.created_at, s.q_count
    FROM answers a JOIN sessions s ON s.id=a.session_id
    WHERE a.staff_id=? ORDER BY a.created_at DESC LIMIT 50
  `).all(req.params.staffId);
  res.json(rows);
});

app.get('/api/me/:staffId/sessions', (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.total_score, s.q_count, s.tab_switch_count, s.is_practice, s.created_at,
           c.label as cycle_label
    FROM sessions s LEFT JOIN cycles c ON c.id=s.cycle_id
    WHERE s.staff_id=? AND s.completed=1 AND COALESCE(s.hidden,0)=0 AND COALESCE(s.is_deleted,0)=0
    ORDER BY s.created_at DESC LIMIT 30
  `).all(req.params.staffId);
  const result = sessions.map(s => ({
    ...s,
    answers: db.prepare(
      'SELECT question_text, answer_text, score, level, category FROM answers WHERE session_id=? ORDER BY id ASC'
    ).all(s.id)
  }));
  res.json(result);
});

// ─── Monitor API（只读，供 OpenClaw cron 调用）─────────────────────────────
app.get('/api/monitor/today', (req, res) => {
  const token = req.headers['x-monitor-token'] || req.query.token;
  if (token !== MONITOR_TOKEN) return res.status(401).json({ error: 'unauthorized' });

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g, '-');
  const completed = db.prepare(`
    SELECT DISTINCT s.staff_id, COALESCE(st.real_name, s.staff_name) as name
    FROM sessions s
    LEFT JOIN staff st ON st.id = s.staff_id
    WHERE date(datetime(s.created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours'))
      AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.hidden,0)=0 AND COALESCE(s.is_deleted,0)=0
    ORDER BY s.created_at ASC
  `).all();

  const threshold = 5;
  const base = {
    date: today,
    completedCount: completed.length,
    completed: completed.map(r => r.name),
    threshold,
    reached: completed.length >= threshold,
    missing: Math.max(0, threshold - completed.length)
  };

  if (req.query.detail === '1') {
    base.detail = completed.map(r => {
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(datetime(created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours')) AND completed=1 AND COALESCE(is_practice,0)=0 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
      if (!ses) return { name: r.name, total_points: 0, answers: [] };
      const answers = db.prepare('SELECT question_text, score FROM answers WHERE session_id=? ORDER BY id ASC').all(ses.id);
      return { name: r.name, total_points: ses.total_points, total_score: ses.total_score, tab_switch_count: ses.tab_switch_count || 0, answers };
    });
  }
  res.json(base);
});

// ─── Monitor Today Text（纯文本，供 AI agent 直接 echo）─────────────────────
app.get('/api/monitor/today/text', (req, res) => {
  const token = req.headers['x-monitor-token'] || req.query.token;
  if (token !== MONITOR_TOKEN) return res.status(401).send('unauthorized');

  const completed = db.prepare(`
    SELECT DISTINCT s.staff_id, COALESCE(st.real_name, s.staff_name) as name
    FROM sessions s
    LEFT JOIN staff st ON st.id = s.staff_id
    WHERE date(datetime(s.created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours'))
      AND s.completed=1 AND s.q_count>=3
      AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.hidden,0)=0 AND COALESCE(s.is_deleted,0)=0
      AND s.staff_id NOT IN (SELECT id FROM staff WHERE is_exempt=1)
    ORDER BY s.created_at ASC
  `).all();

  const threshold = 5;
  const count = completed.length;
  const reached = count >= threshold;
  const missing = Math.max(0, threshold - count);

  // 未完成人员
  const completedIds = completed.map(r => r.staff_id);
  const pendingRows = db.prepare(`
    SELECT id, COALESCE(real_name, name) as name
    FROM staff
    WHERE is_exempt=0 AND COALESCE(is_cp,0)=0
    ORDER BY id
  `).all().filter(s => !completedIds.includes(s.id));
  const total = completedIds.length + pendingRows.length;

  const lines = [];
  const today = new Date().toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'});
  lines.push(`📋 ${today} 答题完成情况（${count}/${total}人）`);
  lines.push('');

  if (count === 0) {
    lines.push('✅ 已完成（0人）');
  } else {
    lines.push(`✅ 已完成（${count}人）`);
    for (const r of completed) {
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(datetime(created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours')) AND completed=1 AND COALESCE(is_practice,0)=0 AND q_count>=3 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
      if (!ses) continue;
      const sw = ses.tab_switch_count > 0 ? ` 切屏×${ses.tab_switch_count}` : '';
      lines.push(`• ${r.name} ${Math.round(ses.total_score)}分${sw}`);
    }
  }

  lines.push('');
  lines.push(`❌ 未完成（${pendingRows.length}人）`);
  if (pendingRows.length === 0) {
    lines.push('• 全员完成！');
  } else {
    lines.push(pendingRows.map(r => r.name).join('、'));
  }

  res.type('text').send(lines.join('\n'));
});

// ─── Monitor Push（手动触发，直接发微信）──────────────────────────────────────
app.get('/api/monitor/push', (req, res) => {
  const token = req.headers['x-monitor-token'] || req.query.token;
  if (token !== MONITOR_TOKEN) return res.status(401).json({ error: 'unauthorized' });

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g, '-');
  const completed = db.prepare(`
    SELECT DISTINCT s.staff_id, COALESCE(st.real_name, s.staff_name) as name
    FROM sessions s
    LEFT JOIN staff st ON st.id = s.staff_id
    WHERE date(datetime(s.created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours'))
      AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.hidden,0)=0 AND COALESCE(s.is_deleted,0)=0
    ORDER BY s.created_at ASC
  `).all();

  const threshold = 5;
  const count = completed.length;
  const reached = count >= threshold;
  const missing = Math.max(0, threshold - count);

  const lines = [];
  if (count === 0) {
    lines.push(`🚨 今日暂无人完成答题！\n📅 ${today}\n请提醒班组成员完成答题！`);
  } else {
    lines.push(reached
      ? `✅ 今日达标，完成 ${count}/${threshold} 人`
      : `⚠️ 今日完成 ${count}/${threshold} 人，还差 ${missing} 人`);
    for (const r of completed) {
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(datetime(created_at,'-6 hours'))=date(datetime('now','localtime','-6 hours')) AND completed=1 AND COALESCE(is_practice,0)=0 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
      if (!ses) { lines.push(`• ${r.name}`); continue; }
      const sw = ses.tab_switch_count > 0 ? ` 切屏×${ses.tab_switch_count}` : '';
      lines.push(`• ${r.name} ${Math.round(ses.total_score)}分${sw}`);
      const answers = db.prepare('SELECT question_text, score FROM answers WHERE session_id=? ORDER BY id ASC').all(ses.id);
      for (const a of answers) {
        const q = a.question_text.length > 12 ? a.question_text.slice(0, 12) + '…' : a.question_text;
        lines.push(`  ${q} ${a.score}分`);
      }
    }
  }
  const msg = lines.join('\n');

  const { exec } = require('child_process');
  const safeMsg = msg.replace(/'/g, "'\\''");
  const cmd = `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin openclaw message send --channel openclaw-weixin --account 045063e165ee-im-bot --target o9cq80yCzBQ87XKtGd0pIm3rGCPM@im.wechat --message '${safeMsg}'`;
  exec(cmd, { timeout: 15000 }, (err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.json({ ok: true });
  });
});

// ─── DingTalk Push ─────────────────────────────────────────────────────────
app.post('/api/admin/dingtalk/push', adminAuth, async (req, res) => {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET;
  if (!webhook || !secret) return res.status(500).json({ error: '未配置钉钉Webhook' });

  // 与进度页保持一致：按当前轮次统计，而非按今日日期
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || null;
  const completed = cycleId ? db.prepare(`
    SELECT DISTINCT s.staff_id, COALESCE(st.real_name, s.staff_name) as name,
      st.is_exempt, st.is_instructor, st.is_leader
    FROM sessions s
    LEFT JOIN staff st ON st.id = s.staff_id
    WHERE s.cycle_id=?
      AND s.completed=1 AND s.q_count>=3
      AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.is_deleted,0)=0
      AND COALESCE(st.is_cp,0)=0
    ORDER BY s.created_at ASC
  `).all(cycleId) : [];

  const completedIds = completed.map(r => r.staff_id);
  // 未完成：只列必答人员（非免答、非班组长、非CP）
  const allRequired = db.prepare(`
    SELECT id, COALESCE(real_name, name) as name
    FROM staff
    WHERE is_exempt=0 AND COALESCE(is_leader,0)=0 AND COALESCE(is_cp,0)=0
    ORDER BY id
  `).all();
  const pendingRows = allRequired.filter(s => !completedIds.includes(s.id));
  const total = allRequired.length; // 分母只算必答人员（不含免答/班组长）
  // 已完成：所有完成者都显示（含免答/班组长），但分子只算必答人员
  const completedRequired = completed.filter(r => !r.is_exempt && !r.is_leader);
  const count = completedRequired.length;

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const todayShift = getTodayShift();
  const shiftLabel = todayShift ? ` · ${todayShift}` : '';
  const lines = [];
  lines.push(`📋 ${dateStr}${shiftLabel} 答题完成情况（${count}/${total}人）`);
  lines.push('');

  if (count === 0) {
    lines.push('✅ 已完成（0人）');
  } else {
    lines.push(`✅ 已完成（${count}人）`);
    for (const r of completed) {
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND cycle_id=? AND completed=1 AND COALESCE(is_practice,0)=0 AND q_count>=3 ORDER BY id ASC LIMIT 1`).get(r.staff_id, cycleId);
      if (!ses) continue;
      const sw = ses.tab_switch_count > 0 ? ` 切屏×${ses.tab_switch_count}` : '';
      lines.push(`• ${r.name} ${Math.round(ses.total_score)}分${sw}`);
    }
  }
  lines.push('');
  lines.push(`❌ 未完成（${pendingRows.length}人）`);
  if (pendingRows.length === 0) {
    lines.push('• 全员完成！');
  } else {
    lines.push(pendingRows.map(r => r.name).join('、'));
  }

  const msgText = lines.join('\n');

  // Sign: timestamp + "\n" + secret, HMAC-SHA256, base64
  const timestamp = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  const url = `${webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: msgText } })
    });
    const data = await resp.json();
    if (data.errcode !== 0) {
      return res.status(500).json({ ok: false, error: data.errmsg });
    }
    logAdmin('钉钉推送', `推送${count}/${total}人完成情况`);
    res.json({ ok: true, count, total });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DingTalk: 抽问开始通知 ────────────────────────────────────────────────
app.post('/api/admin/dingtalk/notify-start', adminAuth, async (req, res) => {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET;
  if (!webhook || !secret) return res.status(500).json({ error: '未配置钉钉Webhook' });

  const { ids, mode, count, bank_id, bank_ids, scope } = req.body;

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const todayShift = getTodayShift();
  const shiftLabel = todayShift ? ` · ${todayShift}` : '';
  const publicUrl = process.env.PUBLIC_URL || '';
  const scopeLabel = scope === 'shift' ? '本套班' : '今日';

  // 答题截止时间描述（早班日 09:30 截止）
  const shiftInfo = getShiftInfo(new Date());
  let deadlineDesc = '';
  if (scope === 'shift') {
    const ed = shiftInfo.endStr; // 早班日日期，如 "2026-05-29"
    deadlineDesc = `${parseInt(ed.slice(5,7))}月${parseInt(ed.slice(8,10))}日 09:30前`;
  } else {
    // 今天生效：若早班则 09:30，否则提示今日内
    const todayShiftNow = getTodayShift();
    deadlineDesc = todayShiftNow === '早班' ? '今日 09:30前' : '今日内完成';
  }

  // 大类辅助
  const bigCatSrv = c => {
    if (c === '故障处置' || c === '应急处置') return '应急';
    if (c === '安全事件') return '安全事件';
    return '隐患排查';
  };
  const catBreakdown = qs => {
    const map = {};
    qs.forEach(q => { const c = bigCatSrv(q.category || ''); map[c] = (map[c] || 0) + 1; });
    return ['应急','安全事件','隐患排查'].filter(k => map[k]).map(k => `${map[k]}题${k}`).join('，');
  };

  // 构建答题范围描述
  let rangeDesc = '';
  let questionLines = []; // 手动选题时逐题列出
  if (mode === 'emergency') {
    rangeDesc = `应急故障处置，随机 ${count || 3} 题`;
  } else if (mode === 'random') {
    if (bank_ids?.length > 0) {
      const placeholders = bank_ids.map(() => '?').join(',');
      const bks = db.prepare(`SELECT name FROM question_banks WHERE id IN (${placeholders})`).all(...bank_ids);
      const names = bks.map(b => b.name);
      rangeDesc = `${names.join('、')}，随机 ${count || 3} 题`;
    } else if (bank_id) {
      const bk = db.prepare('SELECT name FROM question_banks WHERE id=?').get(bank_id);
      rangeDesc = `${bk?.name || '指定题库'}，随机 ${count || 3} 题`;
    } else if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const poolQs = db.prepare(`SELECT category FROM questions WHERE id IN (${placeholders})`).all(...ids);
      const breakdown = catBreakdown(poolQs);
      rangeDesc = `题池：${breakdown}，随机抽 ${count || 3} 题`;
    }
  } else if (mode === 'manual' && Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const qs = db.prepare(`SELECT id, text FROM questions WHERE id IN (${placeholders})`).all(...ids);
    const ordered = ids.map(id => qs.find(q => q.id === id)).filter(Boolean);
    rangeDesc = `指定 ${ordered.length} 道题目`;
    questionLines = ordered.map((q, i) => `  ${i + 1}. ${q.text}`);
  }

  const lines = [];
  lines.push(`📢 管理员已发布${scopeLabel}答题，请大家按时完成！`);
  lines.push('');
  lines.push(`📝 答题范围：${rangeDesc}`);
  if (questionLines.length > 0) {
    questionLines.forEach(l => lines.push(l));
  }
  lines.push(`⏰ 截止时间：${deadlineDesc}`);
  if (publicUrl) {
    lines.push('');
    lines.push(`🔗 答题入口：${publicUrl}`);
  }

  const timestamp = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  const url = `${webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: lines.join('\n') } })
    });
    const data = await resp.json();
    if (data.errcode !== 0) return res.status(500).json({ ok: false, error: data.errmsg });
    logAdmin('钉钉通知', `抽问开始通知已发送，共${questions.length}题`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DingTalk: 培训计划通知（次日预告 / 当天提醒）─────────────────────────────

// 辅助：查某日期的早班培训计划详情（含换人覆盖）
function getTrainingPlanForDate(dateStr) {
  const plan = db.prepare("SELECT * FROM monthly_training_plans WHERE shift_date=? AND plan_type NOT IN ('轮空')").get(dateStr);
  if (!plan) return null;

  if (plan.group_id) {
    const group = db.prepare('SELECT * FROM training_groups WHERE id=?').get(plan.group_id);
    if (group) {
      // 应用 plan.instructor_id_override：有效教员 = override 优先，否则小组默认
      const groupDefaultInstructorId = group.instructor_id;
      const effectiveInstructorId = plan.instructor_id_override || groupDefaultInstructorId;
      if (effectiveInstructorId) {
        const ins = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(effectiveInstructorId);
        group.instructor_id = effectiveInstructorId; // 让下游一并用 override
        group.instructor_name = ins?.real_name || ins?.name || null;
      }

      // 基础组员（同时排除"原默认教员"和"override 后的有效教员"，
      // 避免互换后的另一位教员或被换走的教员仍出现在成员名单中）
      const excludeIds = [groupDefaultInstructorId, effectiveInstructorId]
        .filter(Boolean).map(String);
      const placeholders = excludeIds.length ? excludeIds.map(()=>'?').join(',') : null;
      const baseMembers = placeholders
        ? db.prepare(`
            SELECT s.id, s.real_name, s.name
            FROM training_group_members tgm JOIN staff s ON tgm.staff_id = s.id
            WHERE tgm.group_id = ? AND tgm.staff_id NOT IN (${placeholders})
          `).all(group.id, ...excludeIds)
        : db.prepare(`
            SELECT s.id, s.real_name, s.name
            FROM training_group_members tgm JOIN staff s ON tgm.staff_id = s.id
            WHERE tgm.group_id = ?
          `).all(group.id);

      // 应用换人覆盖
      const overrides = db.prepare(
        'SELECT staff_id, action FROM training_plan_member_overrides WHERE plan_id=?'
      ).all(plan.id);
      const removedIds = new Set(overrides.filter(o=>o.action==='remove').map(o=>String(o.staff_id)));
      const addedIds   = overrides.filter(o=>o.action==='add').map(o=>String(o.staff_id));

      let members = baseMembers.filter(m => !removedIds.has(String(m.id)));
      const addedStaff = [];
      if (addedIds.length > 0) {
        const added = db.prepare(
          `SELECT id, real_name, name FROM staff WHERE id IN (${addedIds.map(()=>'?').join(',')})`
        ).all(...addedIds);
        members = [...members, ...added];
        addedStaff.push(...added);
      }
      group.members = members;

      // 构建人员调整备注：add→调整至本计划日期，remove→查找其被add进的计划日期
      const adjustNotes = [];
      for (const s of addedStaff) {
        adjustNotes.push({ name: s.real_name || s.name, date: dateStr });
      }
      for (const rid of removedIds) {
        const rs = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(rid);
        if (!rs) continue;
        const dest = db.prepare(`
          SELECT mtp.shift_date FROM training_plan_member_overrides o
          JOIN monthly_training_plans mtp ON mtp.id = o.plan_id
          WHERE o.staff_id=? AND o.action='add' AND mtp.id != ?
          ORDER BY mtp.shift_date LIMIT 1
        `).get(rid, plan.id);
        adjustNotes.push({ name: rs.real_name || rs.name, date: dest?.shift_date || null });
      }
      plan.adjustNotes = adjustNotes;
    }
    plan.group = group || null;
  }

  // 固定成员
  plan.fixedStaff = db.prepare(`
    SELECT f.staff_id, s.real_name, s.name
    FROM training_fixed_members f JOIN staff s ON f.staff_id = s.id
  `).all();

  // 中旬会：全员参与（所有非CP非测试人员）+ 请假名单
  if (plan.plan_type === '中旬会') {
    const allStaff = db.prepare(`
      SELECT id, real_name, name, is_leader, is_instructor
      FROM staff
      WHERE COALESCE(is_cp,0)=0 AND (COALESCE(is_tester,0)=0 OR COALESCE(is_leader,0)=1)
      ORDER BY id
    `).all();
    const leaderOrder = ['韩颖', '艾凌风', '胡鑫'];
    const rawLeaders = allStaff.filter(s => s.is_leader);
    plan.zhxhLeaders = [...leaderOrder.map(n => rawLeaders.find(l => (l.real_name||l.name)===n)).filter(Boolean),
      ...rawLeaders.filter(l => !leaderOrder.includes(l.real_name||l.name))];
    plan.zhxhMembers  = allStaff.filter(s => !s.is_leader);
    plan.zhxhTotal    = allStaff.length;
    // 请假名单（notes JSON）
    let leavers = [];
    try { leavers = JSON.parse(plan.notes || '[]').filter(e => e.type === '请假'); } catch(e) {}
    plan.zhxhLeavers = leavers; // [{staffId, staffName}]
  }

  return plan;
}

// 格式化培训计划为钉钉消息行
// ── Magic link ─────────────────────────────────────────────────────────────
function generateMagicToken(staffId, targetScreen = 'home', hoursValid = 48) {
  // 清理过期 token
  db.prepare('DELETE FROM magic_tokens WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(20).toString('hex');
  const expiresAt = Date.now() + hoursValid * 3600 * 1000;
  db.prepare('INSERT INTO magic_tokens (token, staff_id, target_screen, expires_at) VALUES (?,?,?,?)')
    .run(token, String(staffId), targetScreen, expiresAt);
  return token;
}

// 教员生成自己的快捷入口链接
app.post('/api/magic-link', workshopEditAuth, (req, res) => {
  const staffId = req.instructorId || null;
  if (!staffId) return res.status(400).json({ error: '需要教员身份' });
  const target = req.body?.target || 'workshop';
  const token = generateMagicToken(staffId, target);
  const base = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
  res.json({ ok: true, url: `${base}/go?t=${token}` });
});

// 跳转落地页（服务端渲染，写 sessionStorage 后重定向到 SPA）
app.get('/go', (req, res) => {
  const { t } = req.query;
  const fail = () => res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>alert('链接已过期，请重新登录');location.href='/';<\/script></body></html>`);
  if (!t) return res.redirect('/');
  const row = db.prepare('SELECT * FROM magic_tokens WHERE token=?').get(t);
  if (!row || row.expires_at < Date.now()) return fail();
  const staff = db.prepare('SELECT id, real_name, name, is_exempt, is_tester, is_instructor FROM staff WHERE id=?').get(row.staff_id);
  if (!staff) return fail();
  const userData = JSON.stringify({
    staffId: staff.id,
    name: staff.real_name || staff.name || staff.id,
    isExempt: !!staff.is_exempt,
    isTester: !!staff.is_tester,
    isInstructor: !!staff.is_instructor,
  });
  const screen = row.target_screen || 'home';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>跳转中…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#07101f;display:flex;align-items:center;justify-content:center;height:100vh;color:#94a3b8;font-family:sans-serif;font-size:14px;}</style>
</head><body><p>正在跳转…</p>
<script>
  try {
    sessionStorage.setItem('magic_user', ${JSON.stringify(userData)});
    sessionStorage.setItem('magic_nav', ${JSON.stringify(screen)});
    localStorage.setItem('quiz_last_login', JSON.stringify({staffId:${JSON.stringify(staff.id)}}));
  } catch(e){}
  location.replace('/');
<\/script></body></html>`);
});

function formatTrainingLines(plan, dateLabel, mode) {
  const lines = [];
  const g = plan.group;
  const typeMap = { '培训': '实操培训', '理论': '理论培训', '中旬会': '中旬会' };
  const typeText = typeMap[plan.plan_type] || plan.plan_type;
  const location = plan.location || '工人村';
  const isZhxh = plan.plan_type === '中旬会';

  // 1. 日期
  lines.push(`📅 ${dateLabel}`);
  // 2. 小组 + 培训类型 + 地点
  lines.push(`📍 ${isZhxh ? '' : (g?.name || '') + ' · '}${typeText} · ${location}`);

  if (isZhxh) {
    const leaveNames  = new Set((plan.zhxhLeavers || []).map(l => l.staffName));
    const leaderNames = (plan.zhxhLeaders || []).map(l => l.real_name || l.name);
    const memberNames = (plan.zhxhMembers || []).map(m => m.real_name || m.name);
    const total       = plan.zhxhTotal || (leaderNames.length + memberNames.length);
    const attending   = memberNames.filter(n => !leaveNames.has(n));
    const leaderAttending = leaderNames.filter(n => !leaveNames.has(n));
    const actualCount = leaderAttending.length + attending.length;

    if (leaderNames.length > 0) lines.push(`班组长：${leaderNames.join(' ')}`);
    if (attending.length > 0)   lines.push(`👥 ${attending.join('、')}`);
    if (leaveNames.size > 0)    lines.push(`🏖 请假：${[...leaveNames].join('、')}`);
    lines.push(`应到 ${total} 人，实到 ${actualCount} 人`);
  } else if (g) {
    const fixedIds = new Set((plan.fixedStaff || []).map(f => f.staff_id));
    const normalMembers = (g.members || []).filter(m => !fixedIds.has(m.id));
    const fixedNames = (plan.fixedStaff || []).map(f => f.real_name || f.name);

    // 3. 教员 + 班组长 一行
    const roleParts = [];
    if (g.instructor_name) roleParts.push(`教员 ${g.instructor_name}`);
    if (plan.leader_name)  roleParts.push(`班组长 ${plan.leader_name}`);
    if (roleParts.length)  lines.push(roleParts.join('　　'));

    // 4. 组员一行
    if (normalMembers.length > 0) {
      lines.push(`👥 ${normalMembers.map(m => m.real_name || m.name).join('、')}`);
    }
    // 5. 固定成员另起一行
    if (fixedNames.length > 0) {
      lines.push(`📌 固定成员：${fixedNames.join('、')}`);
    }

    // 6. 备注（人员调整）另起一行
    if (plan.adjustNotes && plan.adjustNotes.length > 0) {
      const noteStr = plan.adjustNotes.map(n => {
        if (!n.date) return `${n.name}（调整中）`;
        const [, mo, d] = n.date.split('-');
        return `${n.name}→${parseInt(mo)}月${parseInt(d)}日`;
      }).join('，');
      lines.push(`📝 ${noteStr}`);
    }
  }

  if (mode === 'preview') {
    const leaveContact = isZhxh ? '班组长' : '教员';
    lines.push(`⚠️ 如需请假，请在今晚 18:00 前联系${leaveContact}登记。`);
  } else if (mode === 'reminder') {
    const verb = isZhxh ? '参加中旬会' : `前往${location}参加实操培训`;
    lines.push(`🚀 请以上人员退勤后尽快${verb}！`);
    // 底部追加本月培训项点（中旬会跳过）
    if (!isZhxh) {
      const parts = (plan.shift_date || '').split('-');
      if (parts.length === 3) {
        const itemsRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?')
          .get(parseInt(parts[0]), parseInt(parts[1]));
        const items = JSON.parse(itemsRow?.sessions_json || '[]');
        if (items.length > 0) {
          lines.push(`📚 本月培训项点（共${items.length}项）：`);
          items.forEach(it => {
            const t = it.trainType || '实操';
            lines.push(`  · ${it.item}（${t}）`);
          });
        }
      }
    }
  }
  return lines;
}

// ── 教员群实时推送（纯文本）──────────────────────────────────────────────────
async function sendGroupPush(text) {
  const webhook = process.env.DINGTALK_GROUP_WEBHOOK;
  const secret  = process.env.DINGTALK_GROUP_SECRET;
  if (!webhook || !secret) return;
  try {
    const timestamp = Date.now();
    const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
    const url = `${webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    });
  } catch(e) { /* 推送失败不影响主流程 */ }
}

// 格式化日期为 "4月13日"
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}月${parseInt(d)}日`;
}

// 获取计划的当前成员名单（应用 overrides 后）
function getPlanMemberNames(planId) {
  const plan = db.prepare('SELECT * FROM monthly_training_plans WHERE id=?').get(planId);
  if (!plan) return [];
  const full = getTrainingPlanForDate(plan.shift_date);
  if (!full) return [];
  const fixedIds = new Set((full.fixedStaff||[]).map(f=>String(f.staff_id)));
  const members = (full.group?.members||[]).filter(m=>!fixedIds.has(String(m.id)));
  return members.map(m=>m.real_name||m.name);
}

// 公共：发钉钉 ActionCard 消息
async function sendDingTalkCard({ title, bodyLines, plan, logTag }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret  = process.env.DINGTALK_SECRET;
  if (!webhook || !secret) throw new Error('未配置钉钉Webhook');

  const BASE = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
  const instructorId = plan?.group?.instructor_id;

  // 为教员生成专属免登链接（48h有效）
  const instrToken = instructorId ? generateMagicToken(String(instructorId), 'workshop') : null;
  const workshopUrl = instrToken ? `${BASE}/go?t=${instrToken}` : `${BASE}/?_nav=workshop`;

  const btns = [
    { title: '📱 培训系统', actionURL: `${BASE}/?_nav=home` },
    { title: '📋 月度任务', actionURL: workshopUrl },
  ];

  // 钉钉 actionCard 走 markdown 渲染，单 \n 不换行，必须用双换行分段
  const text = bodyLines.join('\n\n');
  const timestamp = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  const url = `${webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'actionCard',
      actionCard: { title, text, btns, btnOrientation: '1' },
    }),
  });
  const data = await resp.json();
  if (data.errcode !== 0) throw new Error(data.errmsg);
  logAdmin('钉钉通知', logTag);
}

// 夜班 15:00：推送次日早班培训预告
app.post('/api/admin/dingtalk/notify-training-preview', adminAuth, async (req, res) => {
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowStr = tomorrow.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const tomorrowShift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(tomorrowStr)?.shift || '';

  if (tomorrowShift !== '早班') {
    return res.json({ ok: true, skipped: true, reason: `明日班次为"${tomorrowShift}"，非早班，不推送` });
  }

  const plan = getTrainingPlanForDate(tomorrowStr);
  if (!plan) return res.json({ ok: true, skipped: true, reason: '明日无培训计划' });

  const dow = ['日','一','二','三','四','五','六'][tomorrow.getDay()];
  const dateLabel = `${tomorrow.getMonth()+1}月${tomorrow.getDate()}日（周${dow}）`;
  const bodyLines = formatTrainingLines(plan, dateLabel, 'preview');

  try {
    await sendDingTalkCard({ title: '🔔 明日早班培训提醒', bodyLines, plan, logTag: `次日培训预告：${tomorrowStr}` });
    res.json({ ok: true, date: tomorrowStr });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 早班 08:30：推送当天培训提醒
app.post('/api/admin/dingtalk/notify-training-reminder', adminAuth, async (req, res) => {
  const forceDate = req.query.force; // 测试用，跳过班次检查
  const todayStr = forceDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const todayShift = forceDate ? '早班' : getTodayShift();
  if (todayShift !== '早班') {
    return res.json({ ok: true, skipped: true, reason: `今日班次为"${todayShift}"，非早班，不推送` });
  }

  const plan = getTrainingPlanForDate(todayStr);
  if (!plan) return res.json({ ok: true, skipped: true, reason: '该日期无培训计划' });

  const d = new Date(todayStr + 'T00:00:00+08:00');
  const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  const dateLabel = `${d.getMonth()+1}月${d.getDate()}日（周${dow}）`;
  const bodyLines = formatTrainingLines(plan, dateLabel, 'reminder');

  try {
    await sendDingTalkCard({ title: '📣 今日早班培训通知', bodyLines, plan, logTag: `当天培训提醒：${todayStr}` });
    res.json({ ok: true, date: todayStr });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Batch: delete today's sessions ────────────────────────────────────────
app.delete('/api/admin/sessions/today', adminAuth, (req, res) => {
  const info = db.prepare("UPDATE sessions SET is_deleted=1 WHERE date(created_at)=date('now','localtime')").run();
  logAdmin('清除今日数据', `软删除 ${info.changes} 条答题记录`);
  res.json({ ok: true, deleted: info.changes });
});

// ─── Batch: update staff identity ──────────────────────────────────────────
app.put('/api/admin/staff/batch-identity', adminAuth, (req, res) => {
  const { ids, is_tester, is_exempt, is_cp } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择人员' });
  const stmt = db.prepare('UPDATE staff SET is_tester=?, is_exempt=?, is_cp=? WHERE id=?');
  const run = db.transaction(() => ids.forEach(id => stmt.run(is_tester?1:0, is_exempt?1:0, is_cp?1:0, id)));
  run();
  logAdmin('批量修改身份', `${ids.length}人 → 测试:${is_tester?'是':'否'} 免答:${is_exempt?'是':'否'} 车峰:${is_cp?'是':'否'}`);
  res.json({ ok: true });
});

// ─── Admin Logs ────────────────────────────────────────────────────────────
app.get('/api/admin/logs', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 300').all();
  res.json(rows);
});

// ─── Session hide / delete ─────────────────────────────────────────────────
app.put('/api/admin/sessions/:id/hide', adminAuth, (req, res) => {
  const { hidden } = req.body;
  db.prepare('UPDATE sessions SET hidden=? WHERE id=?').run(hidden ? 1 : 0, req.params.id);
  logAdmin(hidden ? '隐藏成绩' : '恢复成绩', `session_id=${req.params.id}`);
  res.json({ ok: true });
});
app.delete('/api/admin/sessions/:id', adminAuth, (req, res) => {
  const sess = db.prepare('SELECT staff_name FROM sessions WHERE id=?').get(req.params.id);
  db.prepare('UPDATE sessions SET is_deleted=1 WHERE id=?').run(req.params.id);
  logAdmin('删除成绩', `session_id=${req.params.id} ${sess?.staff_name||''}`);
  res.json({ ok: true });
});

// 删除某人在某套班（cycle）或今日的全部成绩
app.delete('/api/admin/sessions/staff/:staffId', adminAuth, (req, res) => {
  const { staffId } = req.params;
  const { cycle_id, today } = req.query;
  let sessionIds;
  if (today === '1') {
    sessionIds = db.prepare("SELECT id FROM sessions WHERE staff_id=? AND date(created_at)=date('now','localtime')").all(staffId).map(r => r.id);
  } else if (cycle_id) {
    sessionIds = db.prepare('SELECT id FROM sessions WHERE staff_id=? AND cycle_id=?').all(staffId, cycle_id).map(r => r.id);
  } else {
    return res.status(400).json({ error: '请指定 cycle_id 或 today=1' });
  }
  if (sessionIds.length === 0) return res.json({ ok: true, deleted: 0 });
  const staffName = db.prepare('SELECT real_name FROM staff WHERE id=?').get(staffId)?.real_name || staffId;
  db.transaction(() => {
    sessionIds.forEach(id => {
      db.prepare('UPDATE sessions SET is_deleted=1 WHERE id=?').run(id);
    });
  })();
  logAdmin('删除人员套班成绩', `${staffName}(${staffId}) cycle=${cycle_id||'今日'} 共${sessionIds.length}条`);
  res.json({ ok: true, deleted: sessionIds.length });
});

// ─── 搜索所有题目（供手动选题）────────────────────────────────────────────
app.get('/api/admin/questions/all', adminAuth, (req, res) => {
  const { search, bank_id } = req.query;
  let sql = 'SELECT q.id, q.text, q.reference, q.category, q.difficulty, q.bank_id, b.name as bank_name FROM questions q LEFT JOIN question_banks b ON b.id=q.bank_id WHERE q.active=1';
  const params = [];
  if (bank_id) { sql += ' AND q.bank_id=?'; params.push(parseInt(bank_id)); }
  if (search) { sql += ' AND (q.text LIKE ? OR q.category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY q.id DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ─── AI 智能生成题目 ────────────────────────────────────────────────────────
app.post('/api/admin/questions/ai-generate', adminAuth, async (req, res) => {
  const { content, bank_id, count = 3 } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '请提供文本内容' });
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY) return res.status(503).json({ error: '未配置DASHSCOPE_API_KEY' });
  try {
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content:
          `你是武汉地铁乘务培训专家，根据以下文本内容生成 ${count} 道业务考核题目。每道题必须是简答题（口述操作步骤）。只返回JSON数组，格式：[{"text":"题目内容","reference":"参考答案，各步骤用分号分隔","keywords":"关键词1,关键词2","category":"分类名称"}]\n\n文本内容：\n${content.slice(0, 3000)}` }],
        max_tokens: 2000,
        temperature: 0.3
      })
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '[]').replace(/```json|```/g, '').trim();
    const questions = JSON.parse(raw);
    if (bank_id && Array.isArray(questions) && questions.length > 0) {
      const stmt = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category) VALUES (?,?,?,?,?)');
      const ids = [];
      db.transaction(() => { questions.forEach(q => { const r = stmt.run(parseInt(bank_id), q.text, q.reference, q.keywords || '', q.category || '业务知识'); ids.push(r.lastInsertRowid); }); })();
      logAdmin('AI生成题目', `题库ID=${bank_id} 生成${questions.length}题`);
      return res.json({ ok: true, questions, ids });
    }
    res.json({ ok: true, questions, ids: [] });
  } catch(e) { res.status(500).json({ error: 'AI生成失败: ' + e.message }); }
});

// ─── 批量保存题目（智能出题预览确认后调用）────────────────────────────────
app.post('/api/admin/questions/batch-save', adminAuth, (req, res) => {
  const { questions, bank_id, bank_name } = req.body;
  if (!Array.isArray(questions) || questions.length === 0)
    return res.status(400).json({ error: '题目列表为空' });
  let targetBankId = parseInt(bank_id) || null;
  if (bank_name?.trim()) {
    const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count) VALUES (?,?,?)').run(bank_name.trim(), '简答', 3);
    targetBankId = r.lastInsertRowid;
    logAdmin('新建题库', bank_name.trim());
  }
  if (!targetBankId) return res.status(400).json({ error: '请指定题库' });
  const stmt = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category) VALUES (?,?,?,?,?)');
  const ids = [];
  db.transaction(() => {
    questions.forEach(q => {
      const r = stmt.run(targetBankId, q.text, q.reference, q.keywords || '', q.category || '业务知识');
      ids.push(r.lastInsertRowid);
    });
  })();
  logAdmin('批量保存题目', `题库ID=${targetBankId} 保存${ids.length}题`);
  res.json({ ok: true, count: ids.length, ids, bankId: targetBankId });
});

// ─── 手动选题（管理员指定本次答题题目）───────────────────────────────────
app.get('/api/admin/pinned-questions', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  const cycleInfo = cycle ? { id: cycle.id, label: cycle.label, start_date: cycle.start_date } : null;
  const val = getSetting('pinned_questions');
  if (!val) return res.json({ ids: [], scope: 'none', bank_fallback_id: null, questions: [], cycle: cycleInfo });
  try {
    const pinned = JSON.parse(val);
    // 跨套班失效：created_date 早于本套班开始日 → 视为未发布
    if (cycle?.start_date && pinned.created_date && pinned.created_date < cycle.start_date) {
      return res.json({ ids: [], scope: 'none', bank_fallback_id: null, questions: [], cycle: cycleInfo, stale: { created_date: pinned.created_date, mode: pinned.mode, count: pinned.count } });
    }
    pinned.cycle = cycleInfo;
    if (pinned.ids?.length > 0) {
      const placeholders = pinned.ids.map(() => '?').join(',');
      const qs = db.prepare(`SELECT id, text, category FROM questions WHERE id IN (${placeholders})`).all(...pinned.ids);
      pinned.questions = pinned.ids.map(id => qs.find(q => q.id === id)).filter(Boolean);
    } else {
      pinned.questions = [];
    }
    if (pinned.bank_id) {
      const bank = db.prepare('SELECT name FROM question_banks WHERE id=?').get(pinned.bank_id);
      pinned.bank_name = bank?.name || null;
    }
    if (pinned.bank_ids?.length > 0) {
      const placeholders = pinned.bank_ids.map(() => '?').join(',');
      const bks = db.prepare(`SELECT id, name FROM question_banks WHERE id IN (${placeholders})`).all(...pinned.bank_ids);
      pinned.bank_names = bks.map(b => b.name);
    }
    res.json(pinned);
  } catch { res.json({ ids: [], scope: 'none', bank_fallback_id: null, questions: [] }); }
});
app.put('/api/admin/pinned-questions', adminAuth, (req, res) => {
  const { ids, scope, bank_fallback_id, mode, count, bank_id, bank_ids } = req.body;
  const val = JSON.stringify({
    ids: ids || [],
    scope: scope || 'none',
    bank_fallback_id: bank_fallback_id || null,
    mode: mode || 'manual',
    count: count || 3,
    bank_id: bank_id || null,
    bank_ids: bank_ids || [],
    created_date: new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),
    created_at: new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace('T',' ')
  });
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('pinned_questions', val);
  logAdmin('设置手动选题', `${ids?.length||0}题 scope=${scope} bank_ids=${JSON.stringify(bank_ids||[])}`);
  res.json({ ok: true });
});

// ─── 题库 Excel/CSV 导入 ────────────────────────────────────────────────────
app.post('/api/admin/banks/import', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  // 调试用：保留最近一次上传文件到 /tmp 方便排查
  try { require('fs').writeFileSync('/tmp/last-import.xlsx', req.file.buffer); } catch(_) {}
  const { bank_id, bank_name } = req.body;
  const ext = (req.file.originalname || '').toLowerCase();
  let rows = [];
  try {
    if (ext.endsWith('.csv')) {
      const text = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const obj = {};
        headers.forEach((h, j) => obj[h] = cells[j] || '');
        rows.push(obj);
      }
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);
      const ws = wb.worksheets[0];
      // ExcelJS 富文本单元格返回 {richText:[{text:'...'},...]}，公式单元格返回 {formula,result}
      const cellStr = (v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && Array.isArray(v.richText))
          return v.richText.map(rt => rt.text || '').join('');
        if (typeof v === 'object' && v.result !== undefined) return String(v.result);
        return String(v);
      };
      // 规范化表头：去空格、全角转半角
      const normalize = s => cellStr(s).replace(/\s+/g,'').replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0));
      // 找表头行：从第1行开始，往下找第一行能识别题目/答案的（最多扫描 5 行）
      let headerRowIdx = 1, headers = [];
      for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
        const hs = [];
        ws.getRow(r).eachCell({includeEmpty:true}, c => hs.push(normalize(c.value)));
        const has题 = hs.some(h => /题目|问题|试题|题干|^text$|^question$/i.test(h));
        const has答 = hs.some(h => /参考答案|标准答案|正确答案|答案|^reference$|^answer$/i.test(h));
        if (has题 && has答) { headerRowIdx = r; headers = hs; break; }
      }
      if (headers.length === 0) {
        // 没识别到表头，按第1行兜底
        ws.getRow(1).eachCell({includeEmpty:true}, c => headers.push(normalize(c.value)));
      }
      ws.eachRow((row, i) => {
        if (i <= headerRowIdx) return;
        const obj = {};
        headers.forEach((h, j) => {
          // 不能用 `v || ''`，否则数字 0 会被吞掉（答案为 0 起始时会丢题）
          obj[h] = cellStr(row.getCell(j + 1).value).trim();
        });
        if (Object.values(obj).some(v => v)) rows.push(obj);
      });
    }
  } catch(e) { return res.status(400).json({ error: '文件解析失败: ' + e.message }); }

  const getF = (obj, ...keys) => { for(const k of keys) if(obj[k]) return obj[k]; return ''; };

  // 检测 MCQ：识别 A/B/C/D 字母列，或"选项/选择 + 数字/字母/中文"列
  const headerKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const CN_NUM = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
  // 把表头标准化为 序号(整数)，返回 null 表示不是选项列
  const headerToOrder = (h) => {
    const t = h.trim();
    // A-F 单字母
    let m = t.match(/^([A-Fa-f])$/);
    if (m) return m[1].toUpperCase().charCodeAt(0) - 64; // A=1
    // 选项A / A选项 / 选择A / A选择
    m = t.match(/^(?:选项|选择)?([A-Fa-f])(?:选项|选择)?$/);
    if (m) return m[1].toUpperCase().charCodeAt(0) - 64;
    // 选项1 / 选择1 / 1选项 / 1选择
    m = t.match(/^(?:选项|选择)?(\d+)(?:选项|选择)?$/);
    if (m) return parseInt(m[1]);
    // 选项一 / 选择一 / 一选项 / 一选择
    m = t.match(/^(?:选项|选择)?([一二三四五六七八九十])(?:选项|选择)?$/);
    if (m) return CN_NUM[m[1]];
    return null;
  };
  // 找所有选项列并按序号排序，前 6 个对应 A/B/C/D/E/F
  const optionCols = headerKeys
    .map(h => ({ header: h, order: headerToOrder(h) }))
    .filter(x => x.order !== null)
    .sort((a, b) => a.order - b.order);
  // 检查必要字段：题目+答案在白名单里识别；选项列至少 3 个才算 MCQ
  const headerHas题 = headerKeys.some(h => /题目|问题|试题|题干|^text$|^question$/i.test(h));
  const headerHas答 = headerKeys.some(h => /参考答案|标准答案|正确答案|答案|^reference$|^answer$/i.test(h));
  const isMCQ = headerHas题 && headerHas答 && optionCols.length >= 3;
  // 序号最小的选项列对应 A，依次类推
  const optA = optionCols[0]?.header, optB = optionCols[1]?.header, optC = optionCols[2]?.header, optD = optionCols[3]?.header;
  const optE = optionCols[4]?.header, optF = optionCols[5]?.header;
  // 用于答案归一化：用"列名编号的最小值"决定 0 起始还是 1 起始
  // 选择0/1/2/3 → 答案 0 起始；选项1/2/3/4 → 答案 1 起始
  // 纯字母列（A/B/C/D）默认 1 起始
  let answerBase = 1;
  if (isMCQ && optionCols[0]?.order === 0) answerBase = 0;

  let targetBankId = parseInt(bank_id) || 1;
  if (bank_name?.trim()) {
    const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count) VALUES (?,?,?)').run(bank_name.trim(), isMCQ ? '选择/判断' : '简答', isMCQ ? 10 : 3);
    targetBankId = r.lastInsertRowid;
    logAdmin('新建题库', `${bank_name.trim()}${isMCQ?' [选择题]':''}`);
  } else if (isMCQ) {
    // 导入到已有题库时，如果识别为选择题，把题库类型同步过去
    db.prepare("UPDATE question_banks SET q_type='选择/判断' WHERE id=?").run(targetBankId);
  }

  const ins = db.prepare('INSERT INTO questions (bank_id, text, reference, keywords, category, difficulty, options, type) VALUES (?,?,?,?,?,?,?,?)');
  let count = 0;
  const dropped = { noText: 0, noAnswer: 0, fewOptions: 0, answerOutOfRange: 0 };
  db.transaction(() => {
    rows.forEach(obj => {
      const text = getF(obj, '题目', '问题', '试题', '题干', 'text', 'question');
      const refRaw = getF(obj, '参考答案', '标准答案', '正确答案', '答案', 'reference', 'answer');
      if (!text) { dropped.noText++; return; }
      if (!refRaw) { dropped.noAnswer++; return; }

      let optionsJson = null;
      if (isMCQ) {
        const options = {};
        if (optA && obj[optA]) options.A = obj[optA];
        if (optB && obj[optB]) options.B = obj[optB];
        if (optC && obj[optC]) options.C = obj[optC];
        if (optD && obj[optD]) options.D = obj[optD];
        if (optE && obj[optE]) options.E = obj[optE];
        if (optF && obj[optF]) options.F = obj[optF];
        if (Object.keys(options).length < 2) { dropped.fewOptions++; return; }
        optionsJson = JSON.stringify(options);
      }
      // 选择题 reference 规范化为字母 A-F：支持 A/a / 数字（按 answerBase 0或1 起始）/ 一二三四五六
      let ref = refRaw;
      if (isMCQ) {
        const s = String(refRaw).trim();
        const letters = [];
        for (const ch of s) {
          if (/[A-Fa-f]/.test(ch)) letters.push(ch.toUpperCase());
          else if (/\d/.test(ch)) {
            const n = parseInt(ch);
            const letterIdx = answerBase === 0 ? n + 1 : n; // 1→A, 2→B,... 或 0→A, 1→B...
            if (letterIdx >= 1 && letterIdx <= 6) letters.push(String.fromCharCode(64 + letterIdx));
          }
          else if (CN_NUM[ch]) {
            const n = CN_NUM[ch];
            if (n >= 1 && n <= 6) letters.push(String.fromCharCode(64 + n));
          }
        }
        ref = [...new Set(letters)].sort().join('');
        if (!ref) { dropped.answerOutOfRange++; return; }
      }

      const qType = detectQuestionType({ text, reference: ref, options: optionsJson });
      ins.run(targetBankId, text, ref, getF(obj, '关键词', 'keywords'), getF(obj, '分类', '类别', 'category') || '业务知识', getF(obj, '难度', 'difficulty') || '中等', optionsJson, qType);
      count++;
    });
  })();
  const droppedTotal = dropped.noText + dropped.noAnswer + dropped.fewOptions + dropped.answerOutOfRange;
  const dropStr = droppedTotal > 0 ? ` 跳过${droppedTotal}题(无题干${dropped.noText}/无答案${dropped.noAnswer}/选项不足${dropped.fewOptions}/答案越界${dropped.answerOutOfRange})` : '';
  const debugStr = (!isMCQ || count === 0) ? ` headers=[${headerKeys.join('|')}]` : '';
  logAdmin('导入题库', `题库ID=${targetBankId} 导入${count}题${isMCQ?' [选择题]':''}${dropStr}${debugStr} answerBase=${answerBase}`);
  res.json({
    ok: true, count, bankId: targetBankId, isMCQ,
    debug: { headers: headerKeys, totalRows: rows.length, sampleRow: rows[0] || null, detected: { A: !!optA, B: !!optB, C: !!optC, D: !!optD } },
  });
});

// ─── 智能出题：Word/PDF/图片 → AI识别 → 生成题目 ────────────────────────────
async function callQwenText(KEY, prompt, maxTokens = 4000) {
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1
    })
  });
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
}

async function callQwenVision(KEY, imageBase64, mimeType, prompt) {
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt }
      ]}],
      max_tokens: 3000,
      temperature: 0.3
    })
  });
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
}

function isIncidentReport(text) {
  // 强信号：必须有其中之一
  const strongSignals = ['事件经过', '事故经过', '事件分析', '事故分析', '不安全行为', '安全事件报告', '事故报告', '责任认定', '脱轨', '冒进', '越过信号机', '越红灯'];
  const hasStrong = strongSignals.some(k => text.includes(k));
  if (!hasStrong) return false;
  // 弱信号：需至少3个
  const weakSignals = ['整改', '反思', '原因分析', '存在问题', '教训', '违规', '责任', '措施', '时间', '地点'];
  const weakCount = weakSignals.filter(k => text.includes(k)).length;
  return weakCount >= 3;
}

function buildIncidentPrompt(text) {
  return `你是武汉地铁乘务安全培训专家。以下是一份地铁安全事件/事故分析报告原文。请严格依据原文内容生成 1 道考核题目，不得添加原文中没有的信息，不得凭推断或常识补充内容。

【题目格式】
从报告中提炼事件简短名称（格式：线路/地点+事件类型），生成题目：
"请简要概述[事件简短名称]，口述事件简要经过、乘务员存在问题、整改措施及反思。"

【参考答案要求】严格从原文摘取，按以下顺序用分号分隔，每条一个要点：
1. 简要经过：原文中的日期（年月日）+ 线路/地点 + 车号 + 一句话事件概要（不写人名，不写精确时分秒）
2. 乘务员存在的问题：从原文"存在问题"/"不安全行为"等部分逐条摘取，每条一个分号
3. 整改措施及反思：从原文"整改"/"反思"/"措施"部分逐条摘取，每条一个分号

【严格禁止】：① 不得添加原文没有的问题或措施 ② 不得出现"HH:MM:SS"格式时间 ③ 不得写具体人名

只返回JSON数组（1个元素），格式：
[{"text":"题目内容","reference":"要点1;要点2;要点3","keywords":"关键词1,关键词2","category":"安全事件"}]

报告原文：
${text.slice(0, 8000)}`;
}

function buildGeneralPrompt(text, count) {
  return `你是武汉地铁乘务培训专家。以下是一份培训材料原文。请严格依据原文内容生成 ${count} 道简答考核题目，只考查原文中明确出现的知识点和操作步骤，不得添加原文中没有的内容。

【出题要求】
- 每道题考查一个具体操作步骤或知识要点
- 参考答案必须是原文中的原话或直接摘取，不得凭常识补充
- 答案各步骤/要点用分号分隔
- 关键词从原文摘取2~4个核心词

只返回JSON数组，格式：[{"text":"题目内容","reference":"步骤1;步骤2;步骤3","keywords":"关键词1,关键词2","category":"分类名称"}]

培训材料原文：
${text.slice(0, 8000)}`;
}

function buildCustomQuestionsPrompt(text, questions, isIncident) {
  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `你是武汉地铁乘务培训助手。以下是一份原文，以及教员手工指定的题目。请严格依据原文，为每道题目提取参考答案。

【严格要求】
- 参考答案只能来自原文，不得凭推断或常识补充任何内容
- 原文中找不到答案的题目，reference 留空字符串 ""
- 每道题答案各要点用分号分隔，按原文出现顺序
- 关键词从原文摘取 2~4 个核心词
- category 字段：${isIncident ? '"安全事件"' : '根据题目内容选择 "安全事件" / "应急处置" / "业务知识" / "设备操作" / "规章制度" 之一'}
${isIncident ? `- text 字段必须把事件上下文补进题目，避免答题人看到光秃秃的题目不知道在问哪个事件。
  从原文提炼事件简短名称（格式：日期+线路/地点+车号+事件类型，例如"2026年4月30日C05三金潭冒进信号事件"），改写题目时把这个名称嵌入题目主语位置。
  例如：教员题目"请简要描述事件发生的经过" → text 改写为"请简要描述[事件名称]发生的经过"。
  教员题目"乘务员存在哪些问题" → text 改写为"在[事件名称]中，乘务员存在哪些问题"。
- 涉及"事件经过"类问题，答案需包含：日期(年月日)+线路/地点+车号+一句话事件概要，不写人名，不写HH:MM:SS精确时间` : '- text 字段保持教员题目原文，不要改写'}

教员指定的题目（共 ${questions.length} 道，必须按顺序全部返回）：
${numbered}

原文：
${text.slice(0, 8000)}

只返回 JSON 数组（${questions.length} 个元素，顺序与上面题目一一对应），格式：
[{"text":"${isIncident ? '改写后的题目（含事件名称）' : '题目原文'}","reference":"要点1;要点2","keywords":"词1,词2","category":"分类"}]`;
}

app.post('/api/admin/banks/parse-doc', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY) return res.status(503).json({ error: '未配置DASHSCOPE_API_KEY' });

  const { bank_id, bank_name, count = 5, mode = 'auto', custom_questions, paste_text } = req.body;
  let customList = [];
  if (mode === 'custom') {
    try {
      const raw = typeof custom_questions === 'string' ? JSON.parse(custom_questions) : custom_questions;
      customList = Array.isArray(raw) ? raw.map(s => String(s).trim()).filter(Boolean) : [];
    } catch { return res.status(400).json({ error: '自定义题目格式错误' }); }
    if (customList.length === 0) return res.status(400).json({ error: '自定义模式下至少需输入一道题目' });
  }
  // 支持直接粘贴文字（无需上传文件）
  if (!req.file && !paste_text?.trim()) return res.status(400).json({ error: '请上传文件或粘贴内容' });
  const ext = req.file ? (req.file.originalname || '').toLowerCase() : '';
  const mime = req.file ? (req.file.mimetype || '') : '';
  const isImage = req.file && (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(ext));

  try {
    let extractedText = '';
    let rawJson = '';

    if (isImage) {
      // 图片：直接用视觉模型识别内容并出题
      const base64 = req.file.buffer.toString('base64');
      const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg';
      let imgPrompt;
      if (mode === 'custom') {
        const numbered = customList.map((q, i) => `${i + 1}. ${q}`).join('\n');
        imgPrompt = `你是武汉地铁乘务培训助手。请识别图片中的文字内容，然后严格依据图片内容为每道题目提取参考答案。

【严格要求】
- 参考答案只能来自图片原文，不得凭推断或常识补充
- 图片中找不到答案的题目，reference 留空字符串 ""
- 答案各要点用分号分隔
- 关键词从原文摘取 2~4 个核心词
- docType 统一填 "custom"
- 如果图片是安全事件/事故报告：text 字段必须把事件上下文补进题目（格式：日期+线路/地点+车号+事件类型）。
  例如教员题目"请简要描述事件发生的经过" → 改写为"请简要描述[事件名称]发生的经过"。
  教员题目"乘务员存在哪些问题" → 改写为"在[事件名称]中，乘务员存在哪些问题"。
  如果图片不是事件报告，text 保持原文。

教员题目（共 ${customList.length} 道，必须按顺序全部返回）：
${numbered}

只返回 JSON 数组（${customList.length} 个元素），格式：
[{"text":"题目（事件类需含事件名称）","reference":"要点1;要点2","keywords":"词1,词2","category":"分类","docType":"custom"}]`;
      } else {
        imgPrompt = `你是武汉地铁乘务安全培训专家。请识别图片中的文字内容，判断是否为安全事件/事故分析报告。

如果是安全事件报告，只生成1道题：
- 题目格式："请简要概述[线路/地点+事件类型]，口述事件简要经过、乘务员存在问题、整改措施及反思。"
- 答案要点按顺序用分号分隔：①简要经过（日期年月日+线路/地点+车号+一句话概括）②乘务员存在的问题（逐条）③整改措施及反思（逐条）
- docType填"incident"。

如果是普通培训材料，生成 ${count} 道业务操作考核题目，docType填"general"。

只返回JSON数组，格式：[{"text":"题目","reference":"参考答案（各要点用分号分隔）","keywords":"关键词1,关键词2","category":"分类名称","docType":"incident或general"}]`;
      }
      rawJson = await callQwenVision(KEY, base64, imgMime, imgPrompt);
    } else if (ext.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      extractedText = result.value;
    } else if (ext.endsWith('.pdf')) {
      // 用本地 python3 + PyMuPDF 提取PDF文字（更可靠，支持中文）
      const tmpFile = path.join(os.tmpdir(), `quiz_pdf_${Date.now()}.pdf`);
      fs.writeFileSync(tmpFile, req.file.buffer);
      try {
        extractedText = await new Promise((resolve, reject) => {
          execFile('python3', ['-c', `
import fitz, sys
doc = fitz.open(sys.argv[1])
print(''.join(page.get_text() for page in doc))
`, tmpFile], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            fs.unlink(tmpFile, () => {});
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
          });
        });
      } catch (e) {
        fs.unlink(tmpFile, () => {});
        throw e;
      }
    } else if (!req.file && paste_text?.trim()) {
      // 直接使用粘贴内容，跳过文件提取
      extractedText = paste_text.trim();
    } else {
      return res.status(400).json({ error: '不支持的文件格式，请上传 Word(.docx)、PDF、或图片' });
    }

    if (!isImage) {
      if (!extractedText?.trim()) return res.status(400).json({ error: '文件内容为空或无法提取文本' });
      const isIncident = isIncidentReport(extractedText);
      const prompt = mode === 'custom'
        ? buildCustomQuestionsPrompt(extractedText, customList, isIncident)
        : isIncident
          ? buildIncidentPrompt(extractedText, parseInt(count))
          : buildGeneralPrompt(extractedText, parseInt(count));
      rawJson = await callQwenText(KEY, prompt);
    }

    let questions;
    try { questions = JSON.parse(rawJson); }
    catch { return res.status(500).json({ error: 'AI返回格式异常，请重试', raw: rawJson.slice(0, 200) }); }

    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(500).json({ error: 'AI未生成有效题目' });

    // 判断文档类型（用于前端提示）
    const docType = mode === 'custom'
      ? 'custom'
      : (questions[0]?.docType || (isIncidentReport(extractedText || '') ? 'incident' : 'general'));
    questions.forEach(q => delete q.docType);

    // 若指定了题库，直接保存
    let savedIds = [];
    let targetBankId = parseInt(bank_id) || null;
    if (bank_name?.trim()) {
      const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count) VALUES (?,?,?)').run(bank_name.trim(), '简答', 3);
      targetBankId = r.lastInsertRowid;
      logAdmin('新建题库', bank_name.trim());
    }
    if (targetBankId) {
      const stmt = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category) VALUES (?,?,?,?,?)');
      db.transaction(() => {
        questions.forEach(q => {
          const r = stmt.run(targetBankId, q.text, q.reference, q.keywords || '', q.category || '业务知识');
          savedIds.push(r.lastInsertRowid);
        });
      })();
      logAdmin('智能出题保存', `题库ID=${targetBankId} 生成${questions.length}题 docType=${docType}`);
    }

    res.json({ ok: true, questions, docType, ids: savedIds });
  } catch (e) {
    res.status(500).json({ error: '处理失败: ' + e.message });
  }
});

// ─── Alltime leaderboard full list (admin) ─────────────────────────────────
app.get('/api/admin/leaderboard/cycle', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ cycle: null, rows: [] });
  const rows = db.prepare(`
    SELECT s.staff_id, s.staff_name,
           SUM(s.total_points) as total_points,
           ROUND(AVG(s.total_score),1) as avg_score,
           COUNT(*) as sessions_count,
           SUM(s.q_count) as total_q,
           MAX(s.tab_switch_count) as tab_switch_count,
           COALESCE(st.is_tester,0) as is_tester,
           COALESCE(st.is_cp,0) as is_cp,
           COALESCE(st.is_exempt,0) as is_exempt,
           COALESCE(st.is_instructor,0) as is_instructor,
           COALESCE(st.is_leader,0) as is_leader
    FROM sessions s LEFT JOIN staff st ON st.id=s.staff_id
    WHERE s.cycle_id=? AND s.completed=1 AND s.q_count>=3
      AND COALESCE(s.is_deleted,0)=0 AND COALESCE(s.is_practice,0)=0
    GROUP BY s.staff_id ORDER BY total_points DESC
  `).all(cycle.id);
  res.json({ cycle, rows });
});
app.get('/api/admin/leaderboard/alltime', adminAuth, (req, res) => {
  const rows = db.prepare(`
    WITH cycle_avg AS (
      SELECT staff_id, staff_name, cycle_id,
             ROUND(AVG(total_points), 0) as cycle_pts
      FROM sessions
      WHERE completed=1 AND q_count>=3
        AND COALESCE(is_deleted,0)=0 AND COALESCE(is_practice,0)=0
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      GROUP BY staff_id, cycle_id
    )
    SELECT ca.staff_id, ca.staff_name,
           SUM(ca.cycle_pts) as total_points,
           COUNT(DISTINCT ca.cycle_id) as cycle_count,
           (SELECT avatar FROM staff WHERE id=ca.staff_id LIMIT 1) as avatar,
           COALESCE(st.is_tester,0) as is_tester,
           COALESCE(st.is_cp,0) as is_cp,
           COALESCE(st.is_exempt,0) as is_exempt,
           COALESCE(st.is_instructor,0) as is_instructor,
           COALESCE(st.is_leader,0) as is_leader
    FROM cycle_avg ca LEFT JOIN staff st ON st.id=ca.staff_id
    GROUP BY ca.staff_id ORDER BY total_points DESC LIMIT 50
  `).all();
  res.json(rows);
});

// ─── Excel Export ──────────────────────────────────────────────────────────
app.get('/api/export/months', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', created_at) as month
    FROM sessions WHERE completed=1
    ORDER BY month DESC
  `).all();
  res.json(rows.map(r => r.month));
});

app.get('/api/export', adminAuth, async (req, res) => {
  const month = req.query.month; // 格式 YYYY-MM，不传则导出全部
  const wb = new ExcelJS.Workbook();
  wb.creator = '武汉地铁5号线乘务工班组';

  // Sheet1: 答题明细
  const ws1 = wb.addWorksheet('答题明细', { views:[{state:'frozen',ySplit:1}] });
  ws1.columns = [
    {header:'工号',key:'staff_id',width:10},{header:'姓名',key:'staff_name',width:8},
    {header:'时间',key:'created_at',width:18},{header:'题目',key:'question_text',width:38},
    {header:'分类',key:'category',width:10},{header:'作答',key:'answer_text',width:45},
    {header:'得分',key:'score',width:7},{header:'等级',key:'level',width:7},
    {header:'遗漏要点',key:'missing',width:30},{header:'建议',key:'suggestion',width:35},
  ];
  const hStyle = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1B3A6E'}}, font:{color:{argb:'FFFFFFFF'},bold:true,size:11}, alignment:{vertical:'middle',horizontal:'center',wrapText:true} };
  ws1.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws1.getRow(1).height=26;

  const answers = month
    ? db.prepare("SELECT a.*,s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id WHERE strftime('%Y-%m',a.created_at)=? ORDER BY a.created_at DESC").all(month)
    : db.prepare("SELECT a.*,s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id ORDER BY a.created_at DESC").all();
  answers.forEach((a,i)=>{
    let miss=a.missing_points; try{miss=JSON.parse(a.missing_points).join('；');}catch{}
    const row = ws1.addRow({...a,missing:miss});
    row.height=36; row.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};});
    const sc=row.getCell('score');
    sc.fill={type:'pattern',pattern:'solid',fgColor:{argb:a.score>=85?'FFD4EDDA':a.score>=60?'FFFFF3CD':'FFF8D7DA'}};
    sc.font={bold:true};
  });

  // Sheet2: 人员汇总
  const ws2 = wb.addWorksheet('人员汇总');
  ws2.columns=[{header:'姓名',key:'name',width:8},{header:'工号',key:'id',width:10},{header:'答题天数',key:'days',width:10},{header:'总积分',key:'pts',width:10},{header:'平均分',key:'avg',width:10},{header:'最近答题',key:'last',width:18}];
  ws2.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws2.getRow(1).height=26;
  const members = month
    ? db.prepare("SELECT s.id,s.name,COUNT(DISTINCT date(ss.created_at)) as days,SUM(ss.total_points) as pts,ROUND(AVG(ss.total_score),1) as avg,MAX(ss.created_at) as last FROM staff s LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1 AND COALESCE(ss.is_deleted,0)=0 AND strftime('%Y-%m',ss.created_at)=? GROUP BY s.id ORDER BY pts DESC NULLS LAST").all(month)
    : db.prepare("SELECT s.id,s.name,COUNT(DISTINCT date(ss.created_at)) as days,SUM(ss.total_points) as pts,ROUND(AVG(ss.total_score),1) as avg,MAX(ss.created_at) as last FROM staff s LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1 AND COALESCE(ss.is_deleted,0)=0 GROUP BY s.id ORDER BY pts DESC NULLS LAST").all();
  members.forEach(m=>{ const r=ws2.addRow({...m}); r.height=24; r.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'center'}}); });

  // Sheet3: 积分排行
  const ws3 = wb.addWorksheet('本轮积分榜');
  ws3.columns=[{header:'排名',key:'rank',width:7},{header:'姓名',key:'name',width:8},{header:'积分',key:'pts',width:10},{header:'场次',key:'sessions',width:8},{header:'均分',key:'avg',width:8}];
  ws3.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws3.getRow(1).height=26;
  const cycle = getCurrentCycle();
  if(cycle){
    const lb = db.prepare("SELECT staff_name as name,SUM(total_points) as pts,COUNT(*) as sessions,ROUND(AVG(total_score),1) as avg FROM sessions WHERE cycle_id=? AND completed=1 GROUP BY staff_id ORDER BY pts DESC").all(cycle.id);
    lb.forEach((r,i)=>{ const row=ws3.addRow({rank:i+1,...r}); row.height=24; row.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'center'}}); if(i<3)row.getCell('rank').fill={type:'pattern',pattern:'solid',fgColor:{argb:i===0?'FFFFD700':i===1?'FFC0C0C0':'FFCD7F32'}}; });
  }

  const label = month || new Date().toISOString().slice(0,7);
  const encodedLabel = encodeURIComponent(`答题记录_${label}`);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodedLabel}.xlsx`);
  await wb.xlsx.write(res); res.end();
});

// ─── Workshop Excel Export ────────────────────────────────────────────────
app.get('/api/export/workshop/months', adminAuth, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT year_month FROM monthly_training_plans ORDER BY year_month DESC").all();
  res.json(rows.map(r => r.year_month));
});

// 返回所有培训计划列表（用于勾选导出，教员/管理员均可查）
app.get('/api/export/workshop/plans', workshopEditAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.year_month, p.shift_date, p.plan_type,
           tg.name AS group_name,
           s.real_name AS instructor_name
    FROM monthly_training_plans p
    LEFT JOIN training_groups tg ON tg.id = p.group_id
    LEFT JOIN staff s ON s.id = tg.instructor_id
    WHERE p.plan_type != '轮空'
    ORDER BY p.shift_date DESC, p.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/export/workshop', adminAuth, async (req, res) => {
  const month = req.query.month;
  const idsParam = req.query.ids; // 逗号分隔的 plan id 列表
  if (!month && !idsParam) return res.status(400).json({ error: '请指定月份或计划ID' });

  const wb = new ExcelJS.Workbook();
  wb.creator = '武汉地铁5号线乘务工班组';
  const hStyle = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1B3A6E'}}, font:{color:{argb:'FFFFFFFF'},bold:true,size:11}, alignment:{vertical:'middle',horizontal:'center',wrapText:true} };

  // Sheet1: 培训日程
  const ws1 = wb.addWorksheet('培训日程', { views:[{state:'frozen',ySplit:1}] });
  ws1.columns = [
    {header:'日期',key:'shift_date',width:12},{header:'类型',key:'plan_type',width:8},
    {header:'小组',key:'group_name',width:10},{header:'教员',key:'instructor',width:8},
    {header:'班组长',key:'leader',width:8},{header:'地点',key:'location',width:10},
    {header:'变更记录',key:'change_log',width:32},{header:'备注',key:'notes',width:20},
  ];
  ws1.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws1.getRow(1).height=26;

  let plans;
  if (idsParam) {
    const ids = idsParam.split(',').map(Number).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: '无有效ID' });
    plans = db.prepare(`SELECT * FROM monthly_training_plans WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY shift_date`).all(...ids);
  } else {
    plans = db.prepare("SELECT * FROM monthly_training_plans WHERE year_month=? ORDER BY shift_date").all(month);
  }
  const groups = db.prepare("SELECT g.*, s.real_name as ins_name FROM training_groups g LEFT JOIN staff s ON s.id=g.instructor_id").all();
  const groupMap = {}; groups.forEach(g=>{ groupMap[g.id]=g; });

  plans.forEach(p => {
    const g = p.group_id ? groupMap[p.group_id] : null;
    let notesStr = p.notes || '';
    // 中旬会 notes 是 JSON，解析一下
    if (p.plan_type === '中旬会' && notesStr) {
      try { const arr = JSON.parse(notesStr); notesStr = arr.map(e=>`${e.staffName} ${e.type}`).join('；'); } catch(e) {}
    }
    const row = ws1.addRow({
      shift_date: p.shift_date, plan_type: p.plan_type,
      group_name: g?.name || '', instructor: g?.ins_name || '',
      leader: p.leader_name || '', location: p.location || '',
      change_log: p.change_log || '', notes: notesStr,
    });
    row.height = 28; row.eachCell(c=>{ c.alignment={vertical:'middle',wrapText:true}; });
    // 类型色
    const typeColor = p.plan_type==='轮空'?'FFE5E7EB':p.plan_type==='中旬会'?'FFFFF3CD':p.plan_type==='理论'?'FFE0F2FE':'FFD1FAE5';
    row.getCell('plan_type').fill = {type:'pattern',pattern:'solid',fgColor:{argb:typeColor}};
    row.getCell('plan_type').font = {bold:true};
  });

  // Sheet2: 出勤记录
  const ws2 = wb.addWorksheet('出勤签到', { views:[{state:'frozen',ySplit:1}] });
  ws2.columns = [
    {header:'日期',key:'shift_date',width:12},{header:'工号',key:'staff_id',width:10},
    {header:'姓名',key:'staff_name',width:8},
    {header:'教员确认',key:'instructor_confirmed',width:10},{header:'确认时间',key:'confirm_time',width:18},
    {header:'确认人',key:'confirmed_by',width:8},
  ];
  ws2.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws2.getRow(1).height=26;

  const planIds = plans.map(p=>p.id);
  if (planIds.length > 0) {
    const attendance = db.prepare(`
      SELECT a.*, p.shift_date, COALESCE(s.real_name, s.name, a.staff_id) as staff_name
      FROM training_attendance a
      JOIN monthly_training_plans p ON p.id=a.plan_id
      LEFT JOIN staff s ON s.id=a.staff_id
      WHERE a.plan_id IN (${planIds.map(()=>'?').join(',')})
      ORDER BY p.shift_date, a.staff_id
    `).all(...planIds);
    attendance.forEach(a => {
      const row = ws2.addRow({
        shift_date: a.shift_date, staff_id: a.staff_id, staff_name: a.staff_name,
        instructor_confirmed: a.instructor_confirmed ? '已确认' : '待确认',
        confirm_time: a.confirm_time || '', confirmed_by: a.confirmed_by || '',
      });
      row.height = 24; row.eachCell(c=>{ c.alignment={vertical:'middle',horizontal:'center'}; });
      if (a.instructor_confirmed) row.getCell('instructor_confirmed').fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFD1FAE5'}};
    });
  }

  // Sheet3: 培训点评
  const ws3 = wb.addWorksheet('培训点评', { views:[{state:'frozen',ySplit:1}] });
  ws3.columns = [
    {header:'日期',key:'shift_date',width:12},{header:'工号',key:'staff_id',width:10},
    {header:'姓名',key:'staff_name',width:8},{header:'点评内容',key:'comment',width:45},
    {header:'评价人',key:'evaluated_by',width:8},{header:'评价时间',key:'evaluated_at',width:18},
  ];
  ws3.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws3.getRow(1).height=26;

  if (planIds.length > 0) {
    const evals = db.prepare(`
      SELECT e.*, p.shift_date
      FROM training_evaluations e
      JOIN monthly_training_plans p ON p.id=e.plan_id
      WHERE e.plan_id IN (${planIds.map(()=>'?').join(',')})
      ORDER BY p.shift_date, e.staff_id
    `).all(...planIds);
    evals.forEach(e => {
      const row = ws3.addRow({ shift_date: e.shift_date, staff_id: e.staff_id, staff_name: e.staff_name||e.staff_id, comment: e.comment||'', evaluated_by: e.evaluated_by||'', evaluated_at: e.evaluated_at||'' });
      row.height = 28; row.eachCell(c=>{ c.alignment={vertical:'middle',wrapText:true}; });
    });
  }

  // Sheet4: 现场照片
  const ws4 = wb.addWorksheet('现场照片', { views:[{state:'frozen',ySplit:1}] });
  ws4.columns = [
    {header:'日期',key:'shift_date',width:12},{header:'教员',key:'instructor_name',width:10},
    {header:'小组',key:'group_name',width:10},{header:'上传时间',key:'uploaded_at',width:18},
    {header:'现场照片',key:'photo',width:32},
  ];
  ws4.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws4.getRow(1).height=26;

  if (planIds.length > 0) {
    const photos = db.prepare(`
      SELECT tp.filename, tp.uploaded_at, tp.uploaded_by,
             mtp.shift_date, mtp.group_id,
             tg.name AS group_name,
             s.real_name AS instructor_name
      FROM training_photos tp
      JOIN monthly_training_plans mtp ON mtp.id = tp.plan_id
      LEFT JOIN training_groups tg ON tg.id = mtp.group_id
      LEFT JOIN staff s ON s.id = tg.instructor_id
      WHERE tp.plan_id IN (${planIds.map(()=>'?').join(',')})
      ORDER BY mtp.shift_date, tp.uploaded_at
    `).all(...planIds);
    const IMG_W = 220, IMG_H = 165; // 嵌入图片尺寸（像素）
    for (const ph of photos) {
      const row = ws4.addRow({
        shift_date: ph.shift_date, instructor_name: ph.instructor_name||'', group_name: ph.group_name||'',
        uploaded_at: ph.uploaded_at||'',
      });
      row.height = Math.round(IMG_H * 0.75) + 4; // pt ≈ px * 0.75
      row.eachCell(c=>{ c.alignment={vertical:'middle',horizontal:'center'}; });
      // 用 sharp 压缩为 jpeg 后嵌入
      const imgPath = path.join(PHOTO_DIR, ph.filename);
      if (fs.existsSync(imgPath)) {
        try {
          const buf = await sharp(imgPath)
            .resize(IMG_W * 2, IMG_H * 2, { fit:'inside', withoutEnlargement:true })
            .jpeg({ quality: 80 })
            .toBuffer();
          const imgId = wb.addImage({ buffer: buf, extension: 'jpeg' });
          const rowIdx = row.number - 1; // 0-based
          ws4.addImage(imgId, { tl:{ col:4, row:rowIdx }, ext:{ width:IMG_W, height:IMG_H }, editAs:'oneCell' });
        } catch(e) { row.getCell('photo').value = `（图片处理失败: ${ph.filename}）`; }
      } else {
        row.getCell('photo').value = '（文件不存在）';
      }
    }
    if (photos.length === 0) {
      ws4.addRow({shift_date:'（所选计划暂无现场照片）'});
    }
  }

  let fileLabel;
  if (idsParam && plans.length > 0) {
    const dates = plans.map(p=>p.shift_date).sort();
    fileLabel = dates.length===1 ? `车间培训记录_${dates[0]}` : `车间培训记录_${dates[0]}至${dates[dates.length-1]}`;
  } else {
    fileLabel = `车间培训记录_${month}`;
  }
  const encodedLabel = encodeURIComponent(fileLabel);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodedLabel}.xlsx`);
  await wb.xlsx.write(res); res.end();
});

// ─── QR Code ──────────────────────────────────────────────────────────────
app.get('/api/qrcode', async (req, res) => {
  let url = process.env.PUBLIC_URL;
  if (!url) {
    const nets = os.networkInterfaces(); let ip='localhost';
    for(const n of Object.values(nets)) for(const i of n) if(i.family==='IPv4'&&!i.internal){ip=i.address;break;}
    url = `http://${ip}:${PORT}`;
  }
  const qr=await QRCode.toDataURL(url,{width:300,margin:2,color:{dark:'#1b3a6e',light:'#ffffff'}});
  res.json({url,qr});
});

app.post('/api/admin/login',(req,res)=>{ req.body.password===ADMIN_PASSWORD?res.json({ok:true}):res.status(401).json({error:'密码错误'}); });
// ─── 讯飞 TTS ──────────────────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const text = req.body.text || '';
  if (!text) return res.status(400).json({error:'no text'});
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId||!apiKey||!apiSecret) return res.status(500).json({error:'讯飞未配置'});
  // 生成鉴权URL
  const host = 'tts-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signStr = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
  const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('base64');
  const auth = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sign}"`).toString('base64');
  const wsUrl = `wss://${host}/v2/tts?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;
  const chunks = [];
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      common:{app_id:appId},
      business:{aue:'lame',auf:'audio/L16;rate=16000',vcn:'x4_xiaoyan',speed:50,volume:80,pitch:50,tte:'UTF8'},
      data:{status:0,text:Buffer.from(text).toString('base64')}
    }));
  });
  ws.on('message', d => {
    const msg = JSON.parse(d);
    if (msg.data?.audio) chunks.push(Buffer.from(msg.data.audio,'base64'));
    if (msg.data?.status===2) ws.close();
  });
  ws.on('close', () => {
    const audio = Buffer.concat(chunks);
    res.setHeader('Content-Type','audio/mpeg');
    res.send(audio);
  });
  ws.on('error', e => res.status(500).json({error:e.message}));
});
// ─── 培训小组 API（GET 必须在 catch-all 之前）──────────────────────────────────
// 全局固定培训人员列表
app.get('/api/admin/training-fixed-members', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT staff_id FROM training_fixed_members').all();
  res.json(rows.map(r => r.staff_id));
});

// 查询所有培训小组（含成员）
app.get('/api/admin/training-groups', adminAuth, (req, res) => {
  const groups = db.prepare('SELECT * FROM training_groups ORDER BY sort_order, id').all();
  const members = db.prepare(`
    SELECT tgm.group_id, tgm.is_fixed, s.id, s.name, s.real_name, s.is_exempt, s.is_cp
    FROM training_group_members tgm
    JOIN staff s ON tgm.staff_id = s.id
  `).all();
  const membersByGroup = {};
  for (const m of members) {
    if (!membersByGroup[m.group_id]) membersByGroup[m.group_id] = [];
    membersByGroup[m.group_id].push(m);
  }
  res.json(groups.map(g => ({ ...g, members: membersByGroup[g.id] || [] })));
});

// ─── 月度培训计划 API ──────────────────────────────────────────────────────────

function getMonthEarlyShifts(yearMonth) {
  return db.prepare(
    "SELECT date FROM shift_calendar WHERE shift='早班' AND date LIKE ? ORDER BY date"
  ).all(yearMonth + '-%').map(r => r.date);
}

function getWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay(); // 0=日,1=一,...,6=六
}

function getLocation(dateStr) {
  const wd = getWeekday(dateStr);
  // 周一(1)周三(3)周四(4)周六(6) → 青菱；周二(2)周五(5)周日(0) → 工人村
  return [1,3,4,6].includes(wd) ? '青菱车场' : '工人村';
}

function generatePlan(yearMonth) {
  const dates = getMonthEarlyShifts(yearMonth);
  const groups = db.prepare('SELECT * FROM training_groups ORDER BY sort_order, id').all();
  const leaders = db.prepare("SELECT id, real_name, name FROM staff WHERE is_leader=1 ORDER BY real_name, name").all();
  const setting = db.prepare('SELECT safety_date, start_group_id, start_leader_idx FROM training_plan_settings WHERE year_month=?').get(yearMonth);

  // 中旬会日期：自定义 or 默认（11~20日第一个工作日早班）
  let zhongxunDate = setting?.safety_date || null;
  if (!zhongxunDate) {
    const candidates = dates.filter(d => {
      const day = parseInt(d.slice(8));
      const wd = getWeekday(d);
      return day >= 11 && day <= 20 && wd !== 0 && wd !== 6;
    });
    zhongxunDate = candidates[0] || null;
  }

  // 起始小组
  const startGroupId = setting?.start_group_id || (groups[0]?.id || null);
  let groupIdx = groups.length > 0 ? groups.findIndex(g => g.id == startGroupId) : 0;
  if (groupIdx < 0) groupIdx = 0;

  // 起始班组长序号（仅计入"培训"行，中旬会/轮空不消耗）
  const startLeaderIdx = setting?.start_leader_idx ?? 0;
  let leaderPos = 0;

  const rows = [];
  for (const date of dates) {
    const wd = getWeekday(date);
    const isWeekend = wd === 0 || wd === 6;
    const isZhongxun = date === zhongxunDate;
    let planType, groupId, leaderName = null;
    if (isWeekend) {
      planType = '轮空'; groupId = null;
    } else if (isZhongxun) {
      planType = '中旬会'; groupId = null; // 不消耗 groupIdx / leaderPos
    } else {
      planType = '培训';
      groupId = groups.length > 0 ? groups[groupIdx % groups.length].id : null;
      if (leaders.length > 0) {
        const leader = leaders[(startLeaderIdx + leaderPos) % leaders.length];
        leaderName = leader.real_name || leader.name;
      }
      groupIdx++;
      leaderPos++;
    }
    rows.push({ year_month: yearMonth, shift_date: date, location: getLocation(date),
      plan_type: planType, group_id: groupId, leader_name: leaderName, is_type_custom: 0, notes: null });
  }
  return rows;
}

function buildPlanResponse(yearMonth) {
  const plans = db.prepare('SELECT * FROM monthly_training_plans WHERE year_month=? ORDER BY shift_date').all(yearMonth);
  const groups = db.prepare('SELECT * FROM training_groups ORDER BY sort_order, id').all();
  const allStaff = db.prepare('SELECT id, real_name, name, is_instructor, is_leader FROM staff').all();
  const staffMap = {};
  for (const s of allStaff) staffMap[s.id] = { id: s.id, real_name: s.real_name, name: s.name, is_instructor: !!s.is_instructor, is_leader: !!s.is_leader };
  const members = db.prepare('SELECT tgm.group_id, tgm.is_fixed, s.id, s.real_name, s.name FROM training_group_members tgm JOIN staff s ON tgm.staff_id=s.id').all();
  const fixedStaff = db.prepare('SELECT f.staff_id, s.real_name, s.name FROM training_fixed_members f JOIN staff s ON f.staff_id=s.id').all();
  const leaderStaff = db.prepare("SELECT id, real_name, name FROM staff WHERE is_leader=1 ORDER BY real_name, name").all();
  const membersByGroup = {};
  for (const m of members) {
    if (!membersByGroup[m.group_id]) membersByGroup[m.group_id] = [];
    membersByGroup[m.group_id].push(m);
  }
  const groupMap = {};
  for (const g of groups) {
    groupMap[g.id] = {
      ...g,
      instructor_name: g.instructor_id ? ((staffMap[g.instructor_id]?.real_name || staffMap[g.instructor_id]?.name) || null) : null,
      members: membersByGroup[g.id] || []
    };
  }
  // 成员覆盖（替换/延后记录）
  const planIds = plans.map(p => p.id);
  const overrides = planIds.length > 0
    ? db.prepare(`SELECT o.*, s.real_name, s.name FROM training_plan_member_overrides o JOIN staff s ON s.id=o.staff_id WHERE o.plan_id IN (${planIds.map(()=>'?').join(',')})`).all(...planIds)
    : [];
  const overridesByPlan = {};
  for (const o of overrides) {
    if (!overridesByPlan[o.plan_id]) overridesByPlan[o.plan_id] = { added: [], removed: [] };
    overridesByPlan[o.plan_id][o.action === 'add' ? 'added' : 'removed'].push({ id: o.staff_id, real_name: o.real_name, name: o.name, note: o.note });
  }
  // 批量拉取各计划已确认人员，供前端着色
  const evalRows = planIds.length > 0
    ? db.prepare(`SELECT plan_id, staff_id FROM training_evaluations WHERE plan_id IN (${planIds.map(() => '?').join(',')})`).all(...planIds)
    : [];
  const confirmedByPlan = {};
  for (const e of evalRows) {
    if (!confirmedByPlan[e.plan_id]) confirmedByPlan[e.plan_id] = [];
    confirmedByPlan[e.plan_id].push(String(e.staff_id));
  }
  const setting = db.prepare('SELECT safety_date, start_group_id, start_leader_idx FROM training_plan_settings WHERE year_month=?').get(yearMonth);
  return {
    plans: plans.map(p => {
      const baseGroup = p.group_id ? (groupMap[p.group_id] || null) : null;
      let group = baseGroup;
      if (baseGroup && p.instructor_id_override) {
        const ov = staffMap[p.instructor_id_override];
        const baseInstId = baseGroup.instructor_id;
        group = {
          ...baseGroup,
          instructor_id: p.instructor_id_override,
          instructor_name: ov ? (ov.real_name || ov.name) : baseGroup.instructor_name,
          // 原教员不再视为本计划的成员（已去别处上课）
          members: (baseGroup.members || []).filter(m => String(m.id) !== String(baseInstId)),
        };
      }
      return {
        ...p,
        instructor_overridden: !!p.instructor_id_override,
        group,
        memberOverrides: overridesByPlan[p.id] || { added: [], removed: [] },
        confirmedIds: confirmedByPlan[p.id] || [],
      };
    }),
    groups: Object.values(groupMap), // 含 instructor_name 和 members
    fixedStaff,
    leaderStaff,
    allStaff,
    safetyDate: setting?.safety_date || null,
    startGroupId: setting?.start_group_id || null,
    startLeaderIdx: setting?.start_leader_idx ?? 0,
  };
}

// 获取（或自动生成）月度培训计划
app.get('/api/workshop/training-plan', (req, res) => {
  const yearMonth = req.query.month || new Date().toISOString().slice(0, 7);
  const existing = db.prepare('SELECT COUNT(*) as c FROM monthly_training_plans WHERE year_month=?').get(yearMonth).c;
  if (existing === 0) {
    const rows = generatePlan(yearMonth);
    const ins = db.prepare('INSERT OR IGNORE INTO monthly_training_plans (year_month,shift_date,location,plan_type,group_id,leader_name,is_type_custom,notes) VALUES (?,?,?,?,?,?,?,?)');
    db.transaction(() => rows.forEach(r => ins.run(r.year_month,r.shift_date,r.location,r.plan_type,r.group_id,r.leader_name,r.is_type_custom,r.notes)))();
  }
  res.json(buildPlanResponse(yearMonth));
});

// 更新月度设置（中旬会日期 + 起始小组 + 起始班组长）并重新生成
app.put('/api/admin/training-plan/settings', adminAuth, (req, res) => {
  const { month, safety_date, start_group_id, start_leader_idx } = req.body;
  const yearMonth = month || new Date().toISOString().slice(0, 7);
  const existing = db.prepare('SELECT year_month FROM training_plan_settings WHERE year_month=?').get(yearMonth);
  if (existing) {
    const parts = [], vals = [];
    if (safety_date !== undefined) { parts.push('safety_date=?'); vals.push(safety_date); }
    if (start_group_id !== undefined) { parts.push('start_group_id=?'); vals.push(start_group_id); }
    if (start_leader_idx !== undefined) { parts.push('start_leader_idx=?'); vals.push(start_leader_idx); }
    if (parts.length) db.prepare(`UPDATE training_plan_settings SET ${parts.join(',')} WHERE year_month=?`).run(...vals, yearMonth);
  } else {
    db.prepare('INSERT INTO training_plan_settings (year_month,safety_date,start_group_id,start_leader_idx) VALUES (?,?,?,?)').run(yearMonth, safety_date||null, start_group_id||null, start_leader_idx??0);
  }
  db.prepare('DELETE FROM monthly_training_plans WHERE year_month=?').run(yearMonth);
  const rows = generatePlan(yearMonth);
  const ins = db.prepare('INSERT OR IGNORE INTO monthly_training_plans (year_month,shift_date,location,plan_type,group_id,leader_name,is_type_custom,notes) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => rows.forEach(r => ins.run(r.year_month,r.shift_date,r.location,r.plan_type,r.group_id,r.leader_name,r.is_type_custom,r.notes)))();
  res.json({ ok: true });
});

// 重新生成本月计划
app.post('/api/admin/training-plan/regenerate', adminAuth, (req, res) => {
  const yearMonth = (req.body.month) || new Date().toISOString().slice(0, 7);
  db.prepare('DELETE FROM monthly_training_plans WHERE year_month=?').run(yearMonth);
  const rows = generatePlan(yearMonth);
  const ins = db.prepare('INSERT OR IGNORE INTO monthly_training_plans (year_month,shift_date,location,plan_type,group_id,leader_name,is_type_custom,notes) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => rows.forEach(r => ins.run(r.year_month,r.shift_date,r.location,r.plan_type,r.group_id,r.leader_name,r.is_type_custom,r.notes)))();
  res.json({ ok: true });
});

// 互换两行的小组和类型
app.put('/api/admin/training-plan/swap', workshopEditAuth, (req, res) => {
  const { id1, id2 } = req.body;
  const p1 = db.prepare('SELECT id, group_id, plan_type, leader_name FROM monthly_training_plans WHERE id=?').get(id1);
  const p2 = db.prepare('SELECT id, group_id, plan_type, leader_name FROM monthly_training_plans WHERE id=?').get(id2);
  if (!p1 || !p2) return res.status(404).json({ error: '记录不存在' });
  db.transaction(() => {
    db.prepare('UPDATE monthly_training_plans SET group_id=?, plan_type=?, leader_name=?, is_type_custom=1 WHERE id=?').run(p2.group_id, p2.plan_type, p2.leader_name, id1);
    db.prepare('UPDATE monthly_training_plans SET group_id=?, plan_type=?, leader_name=?, is_type_custom=1 WHERE id=?').run(p1.group_id, p1.plan_type, p1.leader_name, id2);
  })();
  res.json({ ok: true });
});

// 修改单行
app.put('/api/admin/training-plan/:id', workshopEditAuth, (req, res) => {
  const { group_id, plan_type, leader_name, notes, location, log_entry, instructor_id_override } = req.body;
  const upParts = [], upVals = [];
  if (group_id !== undefined) { upParts.push('group_id=?'); upVals.push(group_id); }
  if (plan_type !== undefined) { upParts.push('plan_type=?'); upVals.push(plan_type); }
  if (leader_name !== undefined) { upParts.push('leader_name=?'); upVals.push(leader_name || null); }
  if (notes !== undefined) { upParts.push('notes=?'); upVals.push(notes || null); }
  if (location !== undefined) { upParts.push('location=?'); upVals.push(location); }
  if (instructor_id_override !== undefined) { upParts.push('instructor_id_override=?'); upVals.push(instructor_id_override || null); }
  if (log_entry) {
    const existing = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(req.params.id);
    const prev = existing?.change_log || '';
    const lines = prev ? prev.split('\n') : [];
    if (lines.length === 0 || lines[lines.length - 1] !== log_entry) {
      lines.push(log_entry);
    }
    upParts.push('change_log=?'); upVals.push(lines.join('\n'));
  }
  if (!upParts.length) return res.json({ ok: true });
  upParts.push('is_type_custom=1');
  db.prepare(`UPDATE monthly_training_plans SET ${upParts.join(',')} WHERE id=?`).run(...upVals, req.params.id);
  res.json({ ok: true });
});

// 更新计划的已完成项点
app.patch('/api/workshop/training-plan/:id/completed-items', workshopEditAuth, (req, res) => {
  const { items } = req.body; // string[]
  db.prepare('UPDATE monthly_training_plans SET completed_items=? WHERE id=?')
    .run(JSON.stringify(Array.isArray(items)?items:[]), req.params.id);
  res.json({ ok: true });
});

// ─── 成员调换：替换（两人互换）────────────────────────────────────────────────
app.post('/api/admin/training-plan/member-swap', workshopEditAuth, (req, res) => {
  const { staff_id_a, plan_id_a, staff_id_b, plan_id_b, note } = req.body;
  if (!staff_id_a || !plan_id_a || !staff_id_b || !plan_id_b) return res.status(400).json({ error: '参数不完整' });
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO training_plan_member_overrides (plan_id,staff_id,action,note,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(plan_id,staff_id) DO UPDATE SET action=excluded.action,note=excluded.note,created_at=excluded.created_at`);
  db.transaction(() => {
    upsert.run(plan_id_a, staff_id_a, 'remove', note || null, now);
    upsert.run(plan_id_b, staff_id_a, 'add',    note || null, now);
    upsert.run(plan_id_b, staff_id_b, 'remove', note || null, now);
    upsert.run(plan_id_a, staff_id_b, 'add',    note || null, now);
  })();
  // 追加变更日志
  const dateA = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(plan_id_a)?.shift_date || '';
  const dateB = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(plan_id_b)?.shift_date || '';
  const nameA = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(staff_id_a);
  const nameB = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(staff_id_b);
  const na = nameA?.real_name||nameA?.name||''; const nb = nameB?.real_name||nameB?.name||'';
  const today = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
  const logA = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(plan_id_a);
  const logB = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(plan_id_b);
  db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logA?.change_log?logA.change_log+'\n':'')+`${today} ${na}与${nb}互换（${dateB.slice(5)}）`, plan_id_a);
  db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logB?.change_log?logB.change_log+'\n':'')+`${today} ${nb}与${na}互换（${dateA.slice(5)}）`, plan_id_b);
  res.json({ ok: true });

  // 实时推送到教员群
  const opId = req.instructorId;
  const opStaff = opId ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId) : null;
  const opName = opStaff?.real_name || opStaff?.name || '管理员';
  const now2 = new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
  const membersA = getPlanMemberNames(plan_id_a).join('、');
  const membersB = getPlanMemberNames(plan_id_b).join('、');
  const lines2 = [
    `${now2}  教员 ${opName}`,
    `将 ${na}调整到${fmtDate(dateB)}培训，${nb}调整到${fmtDate(dateA)}培训`,
    ``,
    `调整后${fmtDate(dateA)}培训人员为：${membersA}`,
    `调整后${fmtDate(dateB)}培训人员为：${membersB}`,
  ];
  sendGroupPush(lines2.join('\n'));
});

// ─── 成员调换：延后（移到另一日期）──────────────────────────────────────────
app.post('/api/admin/training-plan/member-postpone', workshopEditAuth, (req, res) => {
  const { staff_id, from_plan_id, to_plan_id, note } = req.body;
  if (!staff_id || !from_plan_id || !to_plan_id) return res.status(400).json({ error: '参数不完整' });
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO training_plan_member_overrides (plan_id,staff_id,action,note,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(plan_id,staff_id) DO UPDATE SET action=excluded.action,note=excluded.note,created_at=excluded.created_at`);
  db.transaction(() => {
    upsert.run(from_plan_id, staff_id, 'remove', note || null, now);
    upsert.run(to_plan_id,   staff_id, 'add',    note || null, now);
  })();
  const dateFrom = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(from_plan_id)?.shift_date || '';
  const dateTo   = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(to_plan_id)?.shift_date || '';
  const nm = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(staff_id);
  const n = nm?.real_name||nm?.name||'';
  const today = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
  const logFrom = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(from_plan_id);
  const logTo   = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(to_plan_id);
  db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logFrom?.change_log?logFrom.change_log+'\n':'')+`${today} ${n}延后至${dateTo.slice(5)}`, from_plan_id);
  db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logTo?.change_log?logTo.change_log+'\n':'')+`${today} ${n}从${dateFrom.slice(5)}延后加入`, to_plan_id);
  res.json({ ok: true });

  // 实时推送到教员群
  const opId2 = req.instructorId;
  const opStaff2 = opId2 ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId2) : null;
  const opName2 = opStaff2?.real_name || opStaff2?.name || '管理员';
  const now3 = new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
  const membersTo = getPlanMemberNames(to_plan_id).join('、');
  const lines3 = [
    `${now3}  教员 ${opName2}`,
    `将 ${n} 从${fmtDate(dateFrom)}调整到${fmtDate(dateTo)}培训`,
    ``,
    `调整后${fmtDate(dateTo)}培训人员为：${membersTo}`,
  ];
  sendGroupPush(lines3.join('\n'));
});

// ─── 固定成员取消/恢复本次回段 ──────────────────────────────────────────────────
app.post('/api/admin/training-plan/member-remove', workshopEditAuth, (req, res) => {
  const { plan_id, staff_id, action } = req.body; // action: 'remove'|'restore'
  if (!plan_id || !staff_id) return res.status(400).json({ error: '参数不完整' });
  if (action === 'restore') {
    db.prepare('DELETE FROM training_plan_member_overrides WHERE plan_id=? AND staff_id=?').run(plan_id, staff_id);
  } else {
    db.prepare(`INSERT INTO training_plan_member_overrides (plan_id,staff_id,action,note,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(plan_id,staff_id) DO UPDATE SET action=excluded.action,note=excluded.note,created_at=excluded.created_at`)
      .run(plan_id, staff_id, 'remove', null, new Date().toISOString());
  }
  res.json({ ok: true });

  // 推送到教员群
  const shiftDate = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(plan_id)?.shift_date || '';
  const nm = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(staff_id);
  const memberName = nm?.real_name || nm?.name || String(staff_id);
  const opId = req.instructorId;
  const opStaff = opId ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId) : null;
  const opName = opStaff?.real_name || opStaff?.name || '管理员';
  const nowTime = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  const isRemove = action !== 'restore';
  const members = getPlanMemberNames(plan_id).join('、');
  const lines = [
    `${nowTime}  ${opName}`,
    isRemove
      ? `${memberName} 取消 ${fmtDate(shiftDate)} 回段`
      : `${memberName} 恢复 ${fmtDate(shiftDate)} 回段`,
    members ? `\n当日培训人员：${members}` : '',
  ].filter(Boolean);
  sendGroupPush(lines.join('\n'));
});

// ─── 教员互换：两个计划的有效教员对调 ──────────────────────────────────────────
app.post('/api/admin/training-plan/instructor-swap', workshopEditAuth, (req, res) => {
  const { plan_id_a, plan_id_b } = req.body;
  if (!plan_id_a || !plan_id_b || plan_id_a === plan_id_b) return res.status(400).json({ error: '参数不完整' });
  const pa = db.prepare('SELECT p.*, g.instructor_id AS group_instructor_id FROM monthly_training_plans p LEFT JOIN training_groups g ON g.id=p.group_id WHERE p.id=?').get(plan_id_a);
  const pb = db.prepare('SELECT p.*, g.instructor_id AS group_instructor_id FROM monthly_training_plans p LEFT JOIN training_groups g ON g.id=p.group_id WHERE p.id=?').get(plan_id_b);
  if (!pa || !pb) return res.status(404).json({ error: '记录不存在' });
  // 当前各自有效教员（override 优先，其次小组默认教员）
  const effA = pa.instructor_id_override || pa.group_instructor_id || null;
  const effB = pb.instructor_id_override || pb.group_instructor_id || null;
  if (!effA || !effB) return res.status(400).json({ error: '存在未指定教员的计划' });
  if (String(effA) === String(effB)) return res.status(400).json({ error: '两个计划教员相同，无需互换' });

  // 各自的"目标"应该是对方现有的有效教员
  // 若目标恰好等于该计划小组的默认教员，则清掉 override（恢复默认）；否则写入 override
  const newAOverride = String(effB) === String(pa.group_instructor_id) ? null : String(effB);
  const newBOverride = String(effA) === String(pb.group_instructor_id) ? null : String(effA);

  const today = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
  const sa = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(effA);
  const sb = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(effB);
  const na = sa?.real_name||sa?.name||'';
  const nb = sb?.real_name||sb?.name||'';
  const logA = pa.change_log || '';
  const logB = pb.change_log || '';
  const entryA = `${today} 教员 ${na}↔${nb}（与${pb.shift_date.slice(5)}互换）`;
  const entryB = `${today} 教员 ${nb}↔${na}（与${pa.shift_date.slice(5)}互换）`;

  db.transaction(() => {
    db.prepare('UPDATE monthly_training_plans SET instructor_id_override=?, change_log=? WHERE id=?')
      .run(newAOverride, (logA?logA+'\n':'')+entryA, plan_id_a);
    db.prepare('UPDATE monthly_training_plans SET instructor_id_override=?, change_log=? WHERE id=?')
      .run(newBOverride, (logB?logB+'\n':'')+entryB, plan_id_b);
  })();
  res.json({ ok: true });

  // 实时推送到教员群
  const opId = req.instructorId;
  const opStaff = opId ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId) : null;
  const opName = opStaff?.real_name || opStaff?.name || '管理员';
  const nowT = new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
  const lines = [
    `${nowT}  操作人 ${opName}`,
    `教员调整：${na} 与 ${nb} 互换培训`,
    `${fmtDate(pa.shift_date)} 由 ${nb} 上课`,
    `${fmtDate(pb.shift_date)} 由 ${na} 上课`,
  ];
  sendGroupPush(lines.join('\n'));
});

// ─── 培训计划导入文件 API ──────────────────────────────────────────────────────

db.exec(`CREATE TABLE IF NOT EXISTS training_import_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT,
  uploaded_at TEXT DEFAULT (datetime('now','localtime')),
  parse_status TEXT DEFAULT 'pending',
  parsed_json TEXT
)`);
// 补充字段（兼容旧表）
try { db.exec(`ALTER TABLE training_import_files ADD COLUMN parse_status TEXT DEFAULT 'pending'`); } catch(e) {}
try { db.exec(`ALTER TABLE training_import_files ADD COLUMN parsed_json TEXT`); } catch(e) {}

// 年度培训计划（可编辑，每月一行）
db.exec(`CREATE TABLE IF NOT EXISTS training_year_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  sessions_json TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(year, month)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS magic_tokens (
  token TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  target_screen TEXT DEFAULT 'home',
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

const IMPORT_DIR = path.join(__dirname, '..', 'data', 'training-imports');
if (!fs.existsSync(IMPORT_DIR)) fs.mkdirSync(IMPORT_DIR, { recursive: true });
app.use('/training-imports', express.static(IMPORT_DIR));

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.get('/api/admin/training-imports', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT id,filename,original_name,uploaded_at,parse_status FROM training_import_files ORDER BY uploaded_at DESC').all());
});

app.post('/api/admin/training-imports', adminAuth, importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '无文件' });
  const ext = path.extname(req.file.originalname) || '';
  const filename = `import_${Date.now()}${ext}`;
  fs.writeFileSync(path.join(IMPORT_DIR, filename), req.file.buffer);
  const id = db.prepare('INSERT INTO training_import_files (filename, original_name) VALUES (?,?)').run(filename, req.file.originalname).lastInsertRowid;
  res.json({ ok: true, id, filename, original_name: req.file.originalname, parse_status: 'pending' });
});

app.delete('/api/admin/training-imports/:id', adminAuth, (req, res) => {
  const row = db.prepare('SELECT filename FROM training_import_files WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '不存在' });
  try { fs.unlinkSync(path.join(IMPORT_DIR, row.filename)); } catch(e) {}
  db.prepare('DELETE FROM training_import_files WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// AI 解析培训计划文件
app.post('/api/admin/training-imports/:id/parse', adminAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM training_import_files WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '不存在' });
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY) return res.status(503).json({ error: '未配置DASHSCOPE_API_KEY' });

  db.prepare("UPDATE training_import_files SET parse_status='processing' WHERE id=?").run(row.id);
  res.json({ ok: true, message: '解析中，请稍后刷新' });

  // 后台异步解析
  (async () => {
    try {
      const filePath = path.join(IMPORT_DIR, row.filename);
      const ext = path.extname(row.filename).toLowerCase();
      let messages;

      const PROMPT = `这是一份年度培训计划表，表格列为：月份、培训项点、课程类型、培训类型、培训课时。
请逐行提取所有内容，返回JSON数组，每条格式：
{"month":1,"item":"培训项点的完整文字内容","trainType":"示范"}
trainType只能是以下之一：示范、实操、理论、实践、其他
month是1到12的数字。item是培训项点列的完整文字，不要省略。
只返回JSON数组，不要任何说明文字，不要markdown代码块。`;

      if (['.jpg','.jpeg','.png','.gif','.webp','.bmp','.heic'].includes(ext)) {
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = ext==='.png'?'image/png':ext==='.gif'?'image/gif':ext==='.webp'?'image/webp':'image/jpeg';
        messages = [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: PROMPT }
        ]}];
      } else if (['.xlsx','.xls'].includes(ext)) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(filePath);
        let text = '';
        wb.eachSheet(ws => { ws.eachRow(r => { text += r.values.slice(1).join('\t') + '\n'; }); });
        messages = [{ role: 'user', content: `${PROMPT}\n\n表格文本：\n${text.slice(0,4000)}` }];
      } else if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buf = fs.readFileSync(filePath);
        const data = await pdfParse(buf);
        messages = [{ role: 'user', content: `${PROMPT}\n\n文档文本：\n${data.text.slice(0,4000)}` }];
      } else if (['.doc','.docx'].includes(ext)) {
        const mammoth = require('mammoth');
        const buf = fs.readFileSync(filePath);
        const result = await mammoth.extractRawText({ buffer: buf });
        messages = [{ role: 'user', content: `${PROMPT}\n\n文档文本：\n${result.value.slice(0,4000)}` }];
      } else {
        db.prepare("UPDATE training_import_files SET parse_status='error',parsed_json=? WHERE id=?").run('不支持的文件格式', row.id);
        return;
      }

      const model = messages[0].content?.[0]?.type === 'image_url' ? 'qwen-vl-plus' : 'qwen-plus';
      const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: 3000, temperature: 0.1 })
      });
      const data = await resp.json();
      const raw = (data.choices?.[0]?.message?.content || '[]').replace(/```json|```/g,'').trim();
      const sessions = JSON.parse(raw);

      if (!Array.isArray(sessions)) throw new Error('返回格式错误');

      // 写入 training_year_plan 表（新格式：item + trainType）
      const byMonth = {};
      sessions.forEach(s => {
        const m = parseInt(s.month);
        if (!m || m < 1 || m > 12) return;
        if (!byMonth[m]) byMonth[m] = [];
        byMonth[m].push({ item: (s.item||'').trim(), trainType: s.trainType||'实操' });
      });
      const upsert = db.prepare(`INSERT INTO training_year_plan (year,month,sessions_json,updated_at) VALUES (?,?,?,datetime('now','localtime'))
        ON CONFLICT(year,month) DO UPDATE SET sessions_json=excluded.sessions_json, updated_at=excluded.updated_at`);
      const year = new Date().getFullYear();
      db.transaction(() => {
        Object.entries(byMonth).forEach(([m, rows]) => upsert.run(year, parseInt(m), JSON.stringify(rows)));
      })();

      db.prepare("UPDATE training_import_files SET parse_status='done',parsed_json=? WHERE id=?").run(JSON.stringify(sessions), row.id);
    } catch(e) {
      db.prepare("UPDATE training_import_files SET parse_status='error',parsed_json=? WHERE id=?").run(e.message, row.id);
    }
  })();
});

// 年度计划 CRUD
app.get('/api/admin/training-year-plan', (req, res) => {  // 只读不鉴权，供首页展示
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM training_year_plan WHERE year=? ORDER BY month').all(year);
  res.json(rows.map(r => ({ ...r, sessions: JSON.parse(r.sessions_json||'[]') })));
});

app.put('/api/admin/training-year-plan/:year/:month', adminAuth, (req, res) => {
  const { year, month } = req.params;
  const { sessions } = req.body;
  db.prepare(`INSERT INTO training_year_plan (year,month,sessions_json,updated_at) VALUES (?,?,?,datetime('now','localtime'))
    ON CONFLICT(year,month) DO UPDATE SET sessions_json=excluded.sessions_json, updated_at=excluded.updated_at`)
    .run(parseInt(year), parseInt(month), JSON.stringify(sessions||[]));
  res.json({ ok: true });
});

// ─── 现场照片 API ─────────────────────────────────────────────────────────────

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 上传照片
app.post('/api/workshop/training-plan/:planId/photos', workshopEditAuth, photoUpload.single('photo'), (req, res) => {
  const planId = parseInt(req.params.planId);
  if (!req.file) return res.status(400).json({ error: '无文件' });
  const ext = req.file.originalname.split('.').pop() || 'jpg';
  const filename = `${planId}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, filename), req.file.buffer);
  const uploadedBy = req.headers['x-instructor-id'] || 'admin';
  db.prepare('INSERT INTO training_photos (plan_id,filename,uploaded_by) VALUES (?,?,?)').run(planId, filename, uploadedBy);
  res.json({ ok: true, filename, url: `/training-photos/${filename}` });
});

// 查询照片列表
app.get('/api/workshop/training-plan/:planId/photos', (req, res) => {
  const planId = parseInt(req.params.planId);
  const photos = db.prepare('SELECT * FROM training_photos WHERE plan_id=? ORDER BY uploaded_at').all(planId);
  res.json(photos.map(p => ({ ...p, url: `/training-photos/${p.filename}` })));
});

// 删除照片
app.delete('/api/workshop/training-plan/photos/:id', workshopEditAuth, (req, res) => {
  const row = db.prepare('SELECT filename FROM training_photos WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '不存在' });
  try { fs.unlinkSync(path.join(PHOTO_DIR, row.filename)); } catch(e) {}
  db.prepare('DELETE FROM training_photos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 相册：所有照片带培训计划信息
app.get('/api/workshop/photos', (req, res) => {
  const rows = db.prepare(`
    SELECT tp.id AS photo_id, tp.plan_id, tp.filename, tp.uploaded_at,
           mtp.shift_date AS plan_date, mtp.plan_type, mtp.group_id,
           tg.name AS group_name,
           s.real_name AS instructor_name
    FROM training_photos tp
    LEFT JOIN monthly_training_plans mtp ON mtp.id = tp.plan_id
    LEFT JOIN training_groups tg ON tg.id = mtp.group_id
    LEFT JOIN staff s ON s.id = tg.instructor_id
    ORDER BY mtp.shift_date DESC, tp.uploaded_at ASC
  `).all();
  res.json(rows.map(r => ({ ...r, url: `/training-photos/${r.filename}` })));
});

// ─── 培训点评 API ─────────────────────────────────────────────────────────────

// 查询某计划的点评
app.get('/api/workshop/training-plan/:planId/evaluations', (req, res) => {
  const planId = parseInt(req.params.planId);
  const rows = db.prepare('SELECT * FROM training_evaluations WHERE plan_id=? ORDER BY evaluated_at').all(planId);
  res.json(rows);
});

// 查询某人某月的培训完成情况（按项点维度）
app.get('/api/workshop/member-month-items', (req, res) => {
  const { staff_id, month } = req.query;
  if (!staff_id || !month) return res.status(400).json({ error: '缺少参数' });
  const yearNum = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  // 本月年度计划项点
  const yearPlanRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?').get(yearNum, monthNum);
  const yearItems = JSON.parse(yearPlanRow?.sessions_json || '[]');
  // 本月所有非轮空/非中旬会日程，关联小组和教员名
  const plans = db.prepare(`
    SELECT p.id, p.shift_date, p.completed_items,
           g.name AS group_name, s.real_name AS instructor_name
    FROM monthly_training_plans p
    LEFT JOIN training_groups g ON p.group_id = g.id
    LEFT JOIN staff s ON g.instructor_id = s.id
    WHERE p.year_month=? AND p.plan_type NOT IN ('轮空','中旬会')
    ORDER BY p.shift_date
  `).all(month);
  // 该人在本月各场次的点评记录
  const evalMap = {};
  for (const p of plans) {
    const ev = db.prepare('SELECT comment, evaluated_at, evaluated_by FROM training_evaluations WHERE plan_id=? AND staff_id=?').get(p.id, staff_id);
    if (ev) evalMap[p.id] = { ...ev, shift_date: p.shift_date, group_name: p.group_name, instructor_name: p.instructor_name };
  }
  // 缓存 evaluated_by (staff_id) → real_name
  const nameCache = {};
  const lookupName = (id) => {
    if (!id || id === 'admin') return null;
    if (nameCache[id] !== undefined) return nameCache[id];
    const s = db.prepare('SELECT real_name FROM staff WHERE id=?').get(id);
    nameCache[id] = s?.real_name || null;
    return nameCache[id];
  };
  // 按项点聚合：找本月最早包含该项点且此人已被确认的场次
  const items = yearItems.map(it => {
    let found = null;
    for (const plan of plans) {
      const completed = JSON.parse(plan.completed_items || '[]');
      if (completed.includes(it.item) && evalMap[plan.id]) {
        found = evalMap[plan.id];
        break;
      }
    }
    if (!found) return { item: it.item, confirmed: false, has_comment: false, comment: '', session_date: null, confirmed_by: null, is_retroactive: false };
    const evalDate = (found.evaluated_at || '').slice(0, 10);
    const isRetroactive = !!(evalDate && evalDate !== found.shift_date);
    let confirmedBy;
    if (isRetroactive) {
      const name = lookupName(found.evaluated_by);
      confirmedBy = name ? `${name}补` : '补录';
    } else {
      confirmedBy = [found.group_name, found.instructor_name].filter(Boolean).join('·');
    }
    return { item: it.item, confirmed: true, has_comment: !!(found.comment), comment: found.comment || '', session_date: found.shift_date, confirmed_by: confirmedBy, is_retroactive: isRetroactive };
  });
  const done = items.filter(i => i.confirmed).length;
  res.json({ items, total: items.length, done });
});

// 保存/更新点评
app.put('/api/workshop/training-plan/:planId/evaluations/:staffId', workshopEditAuth, (req, res) => {
  const planId = parseInt(req.params.planId);
  const staffId = req.params.staffId;
  const { staff_name, comment } = req.body;
  const evaluatedBy = req.headers['x-instructor-id'] || 'admin';
  db.prepare(`INSERT INTO training_evaluations (plan_id,staff_id,staff_name,comment,evaluated_by,evaluated_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(plan_id,staff_id) DO UPDATE SET comment=excluded.comment,evaluated_by=excluded.evaluated_by,evaluated_at=excluded.evaluated_at`)
    .run(planId, staffId, staff_name || staffId, comment || '', evaluatedBy);
  res.json({ ok: true });
});

// 撤销点评（教员误确认后取消）
app.delete('/api/workshop/training-plan/:planId/evaluations/:staffId', workshopEditAuth, (req, res) => {
  const planId = parseInt(req.params.planId);
  const staffId = req.params.staffId;
  const r = db.prepare('DELETE FROM training_evaluations WHERE plan_id=? AND staff_id=?').run(planId, staffId);
  res.json({ ok: true, removed: r.changes });
});

// ─── 打卡 & 教员确认 API ──────────────────────────────────────────────────────

// 查询本人本月打卡状态
app.get('/api/workshop/my-status', (req, res) => {
  const { month, staff_id } = req.query;
  if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
  const yearMonth = month || new Date().toISOString().slice(0,7);
  const plans = db.prepare('SELECT id, shift_date, plan_type, group_id, leader_name, location, completed_items FROM monthly_training_plans WHERE year_month=? ORDER BY shift_date').all(yearMonth);
  const attendance = db.prepare('SELECT plan_id, checked_in, checkin_time, instructor_confirmed, confirm_time FROM training_attendance WHERE staff_id=?').all(staff_id);
  const attMap = {};
  for (const a of attendance) attMap[a.plan_id] = a;
  // 固定成员
  const isFixed = !!db.prepare('SELECT 1 FROM training_fixed_members WHERE staff_id=?').get(staff_id);
  // 我所在的小组
  const myGroup = db.prepare('SELECT group_id FROM training_group_members WHERE staff_id=?').get(staff_id);
  const myGroupId = myGroup?.group_id || null;
  // 我的姓名（用于 leader_name 比对）
  const myStaff = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(staff_id);
  const myName = myStaff?.real_name || myStaff?.name || '';
  const result = plans.map(p => {
    const isLeaderRow = !!(p.leader_name && p.leader_name === myName);
    const relevant = p.plan_type === '中旬会' || isFixed || isLeaderRow ||
      (p.plan_type === '培训' && p.group_id && p.group_id === myGroupId);
    const att = attMap[p.id] || {};
    const completedItems = JSON.parse(p.completed_items || '[]');
    return {
      plan_id: p.id, shift_date: p.shift_date, plan_type: p.plan_type, location: p.location,
      relevant,
      checked_in: !!att.checked_in, checkin_time: att.checkin_time || null,
      instructor_confirmed: !!att.instructor_confirmed, confirm_time: att.confirm_time || null,
      completed_items: completedItems,
    };
  });
  res.json(result);
});

// 打卡
app.post('/api/workshop/checkin', (req, res) => {
  const { plan_id, staff_id, lat, lng } = req.body;
  if (!plan_id || !staff_id) return res.status(400).json({ error: 'plan_id, staff_id required' });
  const plan = db.prepare('SELECT * FROM monthly_training_plans WHERE id=?').get(plan_id);
  if (!plan) return res.status(404).json({ error: '培训记录不存在' });
  const todayLocal = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if (plan.shift_date > todayLocal) return res.status(403).json({ error: `签到时间未到，请于 ${plan.shift_date} 当天签到` });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO training_attendance (plan_id,staff_id,checked_in,checkin_time,checkin_lat,checkin_lng,instructor_confirmed)
    VALUES (?,?,1,?,?,?,0)
    ON CONFLICT(plan_id,staff_id) DO UPDATE SET checked_in=1, checkin_time=excluded.checkin_time, checkin_lat=excluded.checkin_lat, checkin_lng=excluded.checkin_lng`
  ).run(plan_id, staff_id, now, lat||null, lng||null);
  res.json({ ok: true, checkin_time: now });
});

// 教员确认
app.post('/api/workshop/instructor-confirm', (req, res) => {
  const { plan_id, staff_id, confirmed_by } = req.body;
  if (!plan_id || !staff_id) return res.status(400).json({ error: 'plan_id, staff_id required' });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO training_attendance (plan_id,staff_id,checked_in,instructor_confirmed,confirm_time,confirmed_by)
    VALUES (?,?,0,1,?,?)
    ON CONFLICT(plan_id,staff_id) DO UPDATE SET instructor_confirmed=1, confirm_time=excluded.confirm_time, confirmed_by=excluded.confirmed_by`
  ).run(plan_id, staff_id, now, confirmed_by||null);
  res.json({ ok: true, confirm_time: now });
});


// ─── 培训小组 API（POST/PUT/DELETE）──────────────────────────────────────────

// 新建小组
app.post('/api/admin/training-groups', adminAuth, (req, res) => {
  const { name, instructor_id, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: '小组名不能为空' });
  const r = db.prepare('INSERT INTO training_groups (name, instructor_id, sort_order) VALUES (?, ?, ?)').run(name, instructor_id || null, sort_order);
  res.json({ id: r.lastInsertRowid, name, instructor_id, sort_order });
});

// 修改小组（名称/教员/排序）
app.put('/api/admin/training-groups/:id', adminAuth, (req, res) => {
  const { name, instructor_id, sort_order } = req.body;
  const g = db.prepare('SELECT id FROM training_groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '小组不存在' });
  db.prepare('UPDATE training_groups SET name=COALESCE(?,name), instructor_id=?, sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name || null, instructor_id !== undefined ? instructor_id : g.instructor_id, sort_order ?? null, req.params.id);
  res.json({ ok: true });
});

// 删除小组
app.delete('/api/admin/training-groups/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM training_group_members WHERE group_id=?').run(req.params.id);
  db.prepare('DELETE FROM training_groups WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 设置小组成员（全量替换），支持 is_fixed 标记
// 请求体：{ members: [{staff_id, is_fixed}] }
app.put('/api/admin/training-groups/:id/members', adminAuth, (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members)) return res.status(400).json({ error: 'members 须为数组' });
  const del = db.prepare('DELETE FROM training_group_members WHERE group_id=?');
  const ins = db.prepare('INSERT OR REPLACE INTO training_group_members (group_id, staff_id, is_fixed) VALUES (?, ?, ?)');
  db.transaction(() => {
    del.run(req.params.id);
    for (const { staff_id, is_fixed } of members) ins.run(req.params.id, staff_id, is_fixed ? 1 : 0);
  })();
  res.json({ ok: true });
});

// 设置/取消教员标记
app.put('/api/admin/staff/:id/instructor', adminAuth, (req, res) => {
  const { is_instructor } = req.body;
  db.prepare('UPDATE staff SET is_instructor=? WHERE id=?').run(is_instructor ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/staff/:id/leader', adminAuth, (req, res) => {
  const { is_leader } = req.body;
  db.prepare('UPDATE staff SET is_leader=? WHERE id=?').run(is_leader ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ─── DashScope Paraformer-realtime-v2 实时语音识别 ───────────────────────────
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (clientWs) => {
  const taskId = require('crypto').randomUUID().replace(/-/g, '');
  let dashWs = null;
  let finalText = '';
  let audioQueue = [];
  let taskStarted = false;
  let pendingStop = false;
  let stopTimer = null;

  const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
  if (!DASHSCOPE_KEY) {
    clientWs.send(JSON.stringify({ type: 'error', text: '未配置 DASHSCOPE_API_KEY' }));
    clientWs.close();
    return;
  }

  dashWs = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
    headers: { 'Authorization': `bearer ${DASHSCOPE_KEY}` },
  });

  const sendFinishTask = () => {
    dashWs.send(JSON.stringify({
      header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: {} },
    }));
    stopTimer = setTimeout(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
      }
      try { dashWs.close(); } catch(e) {}
    }, 5000);
  };

  dashWs.on('open', () => {
    dashWs.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'paraformer-realtime-v2',
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          sentence_silence_duration: 800,
        },
        input: {},
      },
    }));
  });

  dashWs.on('message', (data) => {
    if (data instanceof Buffer && data[0] !== 123) return; // 非 JSON 二进制帧
    try {
      const msg = JSON.parse(data.toString());
      const event = msg.header?.event;
      if (event === 'task-started') {
        taskStarted = true;
        while (audioQueue.length > 0) dashWs.send(audioQueue.shift());
        if (pendingStop) sendFinishTask();
      } else if (event === 'result-generated') {
        const sentence = msg.payload?.output?.sentence;
        if (!sentence) return;
        if (!sentence.sentence_end) {
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText + (sentence.text || '') }));
        } else {
          finalText += (sentence.text || '');
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText }));
        }
      } else if (event === 'task-finished') {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
        dashWs.close();
      } else if (event === 'task-failed') {
        const errMsg = msg.header?.error_message || '识别失败';
        console.error('[Paraformer] task-failed:', errMsg);
        clientWs.send(JSON.stringify({ type: 'error', text: '识别失败，请纠正模式手动输入' }));
        dashWs.close();
      }
    } catch(e) {}
  });

  dashWs.on('error', (err) => {
    console.error('[Paraformer] WS error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', text: '识别服务异常，请纠正模式手动输入' }));
  });

  dashWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data) => {
    if (!dashWs) return;
    const isJson = typeof data === 'string' || (data instanceof Buffer && data[0] === 123);
    if (isJson) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'stop') {
          if (taskStarted) sendFinishTask();
          else pendingStop = true;
        }
      } catch(e) {}
    } else {
      if (taskStarted && dashWs.readyState === WebSocket.OPEN) {
        dashWs.send(data);
      } else {
        audioQueue.push(data);
      }
    }
  });

  clientWs.on('close', () => {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (dashWs && dashWs.readyState === WebSocket.OPEN) {
      try {
        dashWs.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      } catch(e) {}
    }
  });
});

const httpServer = require('http').createServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/ali-asr') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else if (req.url && req.url.startsWith('/ws/iat')) {
    wssXunfei.handleUpgrade(req, socket, head, ws => wssXunfei.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用，服务器无法启动。请先终止占用端口的进程。\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
httpServer.listen(PORT,'0.0.0.0',()=>{
  const nets=os.networkInterfaces(); let ip='localhost';
  for(const n of Object.values(nets)) for(const i of n) if(i.family==='IPv4'&&!i.internal){ip=i.address;break;}
  const spark=process.env.XFYUN_APP_ID&&process.env.XFYUN_APP_ID!=='你的AppID';
  console.log(`\n🚇 武汉地铁5号线 乘务考核系统 v3\n${'═'.repeat(40)}`);
  console.log(`  本机: http://localhost:${PORT}  内网: http://${ip}:${PORT}`);
  console.log(`  AI评分: ${spark?'✅ 讯飞星火':'⚠  关键词模式（未配置讯飞）'}\n`);
});

// ─── 讯飞 IAT WebSocket 代理 ─────────────────────────────────────────────────
const wssXunfei = new WebSocket.Server({ noServer: true });
wssXunfei.on('connection', (clientWs, req) => {
  console.log('[WSS] 客户端连接 ' + req.socket.remoteAddress);
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  const host = 'iat-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signStr = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
  const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('base64');
  const auth = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sign}"`).toString('base64');
  const xfUrl = `wss://${host}/v2/iat?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;
  
  const xfWs = new WebSocket(xfUrl);
  let started = false;
  let endPending = false;
  let fullText = '';
  const sentences = {};

  xfWs.on('open', () => {
    // 发送第一帧参数
    xfWs.send(JSON.stringify({
      common: {app_id: appId},
      business: {language:'zh_cn', domain:'iat', accent:'mandarin', dwa:'wpgs', vad_eos:4000,ptt:0,nunum:1},
      data: {status:0, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
    }));
    started = true;
    clientWs.send(JSON.stringify({type:'ready'}));
    if (endPending) {
      xfWs.send(JSON.stringify({
        data: {status:2, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
      }));
    }
  });

  xfWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.code !== 0) { clientWs.send(JSON.stringify({type:'error', msg: msg.message})); return; }
      const result = msg.data?.result;
      if (!result) return;
      const sn = result.sn;
      const ls = result.ls;
      const pgs = result.pgs;
      const ws = result.ws || [];
      const text = ws.map(w => w.cw?.[0]?.w || '').join('');
      
      if (pgs === 'rpl') {
        const rg = result.rg || [];
        for (let i = rg[0]; i <= rg[1]; i++) delete sentences[i];
      }
      sentences[sn] = text;
      
      const combined = Object.keys(sentences).sort((a,b)=>a-b).map(k=>sentences[k]).join('');
      clientWs.send(JSON.stringify({type:'result', text: combined, final: ls}));
      
      if (ls) {
        fullText = combined;
        clientWs.send(JSON.stringify({type:'done', text: fullText}));
      }
    } catch(e) {}
  });

  xfWs.on('error', (e) => clientWs.send(JSON.stringify({type:'error', msg: e.message})));
  xfWs.on('close', () => { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(); });

  clientWs.on('message', (data) => {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'end') {
        console.log('[IAT-END] started='+started+' xfWs.readyState='+xfWs.readyState+' endPending='+endPending);
        if (started && xfWs.readyState === WebSocket.OPEN) {
          console.log('[IAT-END] 发送status:2');
          xfWs.send(JSON.stringify({
            data: {status:2, format:'audio/L16;rate=16000', encoding:'raw', audio:''}
          }));
        } else {
          endPending = true;
          console.log('[IAT-END] 标记endPending');
        }
      }
    } else {
      if (!started || xfWs.readyState !== WebSocket.OPEN) return;
      const audioB64 = data.toString('base64');
      xfWs.send(JSON.stringify({
        data: {status:1, format:'audio/L16;rate=16000', encoding:'raw', audio: audioB64}
      }));
    }
  });

  clientWs.on('close', () => {
    if (xfWs.readyState === WebSocket.OPEN) xfWs.close();
  });
});
