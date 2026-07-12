const path = require('path');
const fs = require("fs");
const Database = require('better-sqlite3');

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

// ─── bank_type 列迁移（5分类体系）──────────────────────────────────────────
// 值: emergency | event | knowledge | compliance | theory
try { db.exec("ALTER TABLE question_banks ADD COLUMN bank_type TEXT DEFAULT 'knowledge'"); } catch(e) {}
// 按题库 id 和名称特征一次性打标，仅影响尚未分类（NULL 或默认 'knowledge'）的行
try {
  db.exec(`
    UPDATE question_banks SET bank_type='emergency' WHERE id=1;
    UPDATE question_banks SET bank_type='emergency' WHERE name='风险数据库';
    UPDATE question_banks SET bank_type='theory'    WHERE q_type='选择/判断';
    UPDATE question_banks SET bank_type='compliance' WHERE name LIKE '%违章%' OR name LIKE '%违纪%' OR name LIKE '%法律%' OR name LIKE '%法规%' OR name LIKE '%处罚%';
    UPDATE question_banks SET bank_type='event' WHERE bank_type='knowledge' AND (
      name LIKE '%事件%' OR name LIKE '%事故%' OR name LIKE '%脱轨%' OR
      name LIKE '%冒进%' OR name LIKE '%跳闸%' OR name LIKE '%挤岔%' OR
      name LIKE '%碰撞%' OR name LIKE '%倒灌%' OR name LIKE '%进人%' OR
      name LIKE '%报告%' OR name LIKE '%分析%'
    );
  `);
} catch(e) { console.error('[Migration] bank_type 打标失败', e.message); }

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

// 默认设置
[
  ['exam_mode', '0'],
  ['exam_bank_id', '1'],
  ['exam_q_count', '10'],
  ['shift_label', '白班'],
].forEach(([k,v]) => db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run(k,v));

module.exports = { db, PHOTO_DIR, getTodayShift };
