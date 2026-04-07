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
db.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  operator TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// 兼容旧 cycle_id NOT NULL 约束（某些记录可能缺失）
try { db.exec("UPDATE sessions SET cycle_id='' WHERE cycle_id IS NULL"); } catch(e) {}

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

// 默认设置
[
  ['exam_mode', '0'],
  ['exam_bank_id', '1'],
  ['exam_q_count', '10'],
  ['shift_label', '白班'],
].forEach(([k,v]) => db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run(k,v));

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));

// ─── Helpers ───────────────────────────────────────────────────────────────
function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
}
function getCurrentCycle() {
  return ensureCurrentCycle();
}
function calcPoints(avgScore, qCount) {
  // 每题33分，按得分比例折算，qCount题满分 qCount*33
  const base = Math.round(avgScore / 100 * 33 * qCount);
  return { base, bonus: 0, total: base };
}
function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误' });
  next();
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
  res.json({ ok: true, staffId: s.id, realName: s.real_name || s.name, phoneTail: s.phone_tail || '', isExempt: !!s.is_exempt, isTester: !!s.is_tester });
});

app.get('/api/staff', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT id, real_name, phone_tail, is_exempt, is_tester, COALESCE(is_cp,0) as is_cp, created_at FROM staff ORDER BY created_at DESC').all());
});

// 单条添加
app.post('/api/staff', adminAuth, (req, res) => {
  const { id, real_name, phone_tail, is_exempt, is_tester, is_cp } = req.body;
  if (!id?.trim() || !real_name?.trim()) return res.status(400).json({ error: '工号和姓名不能为空' });
  const staffId = id.trim().replace(/^Y/i, '');
  db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester, is_cp) VALUES (?,?,?,?,?,?,?)')
    .run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0);
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
  const { real_name, phone_tail, is_exempt, is_tester, is_cp } = req.body;
  if (!real_name?.trim()) return res.status(400).json({ error: '姓名不能为空' });
  db.prepare('UPDATE staff SET name=?, real_name=?, phone_tail=?, is_exempt=?, is_tester=?, is_cp=? WHERE id=?')
    .run(real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0, req.params.id);
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
        const todayStr = new Date().toISOString().slice(0, 10);
        const active = (pinned.scope === 'today' && pinned.created_date === todayStr) || pinned.scope === 'shift';
        if (active && pinned.ids?.length > 0) {
          const placeholders = pinned.ids.map(() => '?').join(',');
          let qs = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders}) AND active=1`).all(...pinned.ids);
          // 题目不足3题时用备用题库补全
          if (qs.length < 3 && pinned.bank_fallback_id) {
            const needed = 3 - qs.length;
            const existingIds = qs.map(q => q.id);
            const excl = existingIds.length > 0 ? `AND id NOT IN (${existingIds.map(() => '?').join(',')})` : '';
            const extras = db.prepare(`SELECT * FROM questions WHERE bank_id=? AND active=1 ${excl} ORDER BY RANDOM() LIMIT ?`).all(pinned.bank_fallback_id, ...existingIds, needed);
            qs = [...qs, ...extras];
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

// ─── Banks API ─────────────────────────────────────────────────────────────
app.get('/api/banks', (req, res) => {
  const banks = db.prepare('SELECT b.*, COUNT(q.id) as q_count FROM question_banks b LEFT JOIN questions q ON q.bank_id=b.id AND q.active=1 GROUP BY b.id ORDER BY sort_order').all();
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
  const { mode, count } = req.query;
  const activeBankId = db.prepare('SELECT id FROM question_banks WHERE is_active=1 LIMIT 1').get()?.id || 1;
  if (mode === 'sequential') {
    const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY id ASC').all(activeBankId);
    return res.json({ questions: rows });
  }
  const n = Math.min(parseInt(count) || 3, 20);
  const rows = db.prepare('SELECT * FROM questions WHERE bank_id=? AND active=1 ORDER BY RANDOM() LIMIT ?').all(activeBankId, n);
  res.json({ questions: rows });
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
  const r = db.prepare('INSERT INTO sessions (staff_id,staff_name,cycle_id,is_practice) VALUES (?,?,?,?)')
    .run(staffId, staffName, cycle?.id || 'default', isPractice ? 1 : 0);
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
  try {
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: buildScoringPrompt(question, reference, answer, category) }],
        max_tokens: 800,
        temperature: 0.1
      })
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch(e) { return null; }
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
           (SELECT avatar FROM staff WHERE id=s.staff_id LIMIT 1) as avatar
    FROM sessions s
    WHERE s.id IN (
      SELECT MIN(id) FROM sessions
      WHERE cycle_id=? AND completed=1 AND COALESCE(hidden,0)=0
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      AND staff_id NOT IN (SELECT id FROM staff WHERE is_exempt=1)
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
            AND date(s2.created_at)=date('now','localtime')
            AND s2.completed=1 AND COALESCE(s2.is_practice,0)=0) as attempts
    FROM sessions s
    WHERE s.id IN (
      SELECT MIN(id) FROM sessions
      WHERE date(created_at)=date('now','localtime') AND completed=1 AND COALESCE(hidden,0)=0
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
      AND staff_id NOT IN (SELECT id FROM staff WHERE is_exempt=1)
      GROUP BY staff_id, cycle_id
    )
    SELECT staff_id, staff_name,
           SUM(cycle_pts) as total_points,
           COUNT(DISTINCT cycle_id) as cycle_count,
           (SELECT avatar FROM staff WHERE id=staff_id LIMIT 1) as avatar
    FROM cycle_avg GROUP BY staff_id ORDER BY total_points DESC LIMIT 30
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
    WHERE s.staff_id=? AND s.completed=1
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

  res.json({ staff, streak, catScores, weakCats, trend, recent, stats, cycleRank });
});

// ─── Admin Analytics ───────────────────────────────────────────────────────
app.get('/api/admin/overview', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  const todayComplete = db.prepare(`
    SELECT COUNT(DISTINCT s.staff_id) as c FROM sessions s
    JOIN staff st ON st.id = s.staff_id
    WHERE date(s.created_at)=date('now','localtime') AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.is_deleted,0)=0 AND st.is_exempt=0 AND COALESCE(st.is_cp,0)=0
  `).get().c;
  const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff WHERE is_exempt=0 AND COALESCE(is_cp,0)=0").get().c;
  const catAvg = db.prepare("SELECT category, ROUND(AVG(score),0) as avg FROM answers GROUP BY category ORDER BY avg").all();
  const topWeak = catAvg.slice(0,2);
  const cycleStats = cycle ? db.prepare(`
    SELECT staff_id, staff_name, SUM(total_points) as pts, ROUND(AVG(total_score),1) as avg, COUNT(*) as sessions
    FROM sessions WHERE cycle_id=? AND completed=1 AND COALESCE(hidden,0)=0 AND COALESCE(is_deleted,0)=0 GROUP BY staff_id ORDER BY pts DESC
  `).all(cycle.id) : [];
  const incompleteList = db.prepare(`
    SELECT COALESCE(s.real_name, s.name) as name,
           COALESCE(s.is_tester,0) as is_tester,
           COALESCE(s.is_cp,0) as is_cp,
           COALESCE(s.is_exempt,0) as is_exempt
    FROM staff s
    WHERE s.is_exempt=0 AND COALESCE(s.is_cp,0)=0
      AND s.id NOT IN (
        SELECT DISTINCT staff_id FROM sessions
        WHERE date(created_at)=date('now','localtime') AND completed=1 AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      )
    ORDER BY s.name
  `).all();
  res.json({ todayComplete, totalStaff, catAvg, topWeak, cycle, cycleStats, incompleteList });
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
    SELECT s.id, s.real_name, s.phone_tail, s.is_exempt, s.is_tester, COALESCE(s.is_cp,0) as is_cp,
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
    SELECT question_text, answer_text, score, level, category, created_at
    FROM answers WHERE staff_id=? ORDER BY created_at DESC LIMIT 50
  `).all(req.params.staffId);
  res.json(rows);
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
    WHERE date(s.created_at)=date('now','localtime')
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
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(created_at)=date('now','localtime') AND completed=1 AND COALESCE(is_practice,0)=0 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
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
    WHERE date(s.created_at)=date('now','localtime')
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
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(created_at)=date('now','localtime') AND completed=1 AND COALESCE(is_practice,0)=0 AND q_count>=3 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
      if (!ses) continue;
      const sw = ses.tab_switch_count > 0 ? ` 切屏×${ses.tab_switch_count}` : '';
      lines.push(`• ${r.name} ${ses.total_score}分 +${ses.total_points}积分${sw}`);
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
    WHERE date(s.created_at)=date('now','localtime')
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
      const ses = db.prepare(`SELECT id, total_points, total_score, tab_switch_count FROM sessions WHERE staff_id=? AND date(created_at)=date('now','localtime') AND completed=1 AND COALESCE(is_practice,0)=0 ORDER BY id ASC LIMIT 1`).get(r.staff_id);
      if (!ses) { lines.push(`• ${r.name}`); continue; }
      const sw = ses.tab_switch_count > 0 ? ` 切屏×${ses.tab_switch_count}` : '';
      lines.push(`• ${r.name} ${ses.total_score}分（+${ses.total_points}积分）${sw}`);
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
  const val = getSetting('pinned_questions');
  if (!val) return res.json({ ids: [], scope: 'none', bank_fallback_id: null, questions: [] });
  try {
    const pinned = JSON.parse(val);
    if (pinned.ids?.length > 0) {
      const placeholders = pinned.ids.map(() => '?').join(',');
      const qs = db.prepare(`SELECT id, text, category FROM questions WHERE id IN (${placeholders})`).all(...pinned.ids);
      pinned.questions = pinned.ids.map(id => qs.find(q => q.id === id)).filter(Boolean);
    } else {
      pinned.questions = [];
    }
    res.json(pinned);
  } catch { res.json({ ids: [], scope: 'none', bank_fallback_id: null, questions: [] }); }
});
app.put('/api/admin/pinned-questions', adminAuth, (req, res) => {
  const { ids, scope, bank_fallback_id } = req.body;
  const val = JSON.stringify({ ids: ids || [], scope: scope || 'none', bank_fallback_id: bank_fallback_id || null, created_date: new Date().toISOString().slice(0, 10) });
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('pinned_questions', val);
  logAdmin('设置手动选题', `${ids?.length||0}题 scope=${scope}`);
  res.json({ ok: true });
});

// ─── 题库 Excel/CSV 导入 ────────────────────────────────────────────────────
app.post('/api/admin/banks/import', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
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
      const headers = [];
      ws.getRow(1).eachCell(c => headers.push(String(c.value || '').trim()));
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const obj = {};
        headers.forEach((h, j) => obj[h] = String(row.getCell(j + 1).value || '').trim());
        if (Object.values(obj).some(v => v)) rows.push(obj);
      });
    }
  } catch(e) { return res.status(400).json({ error: '文件解析失败: ' + e.message }); }

  const getF = (obj, ...keys) => { for(const k of keys) if(obj[k]) return obj[k]; return ''; };
  let targetBankId = parseInt(bank_id) || 1;
  if (bank_name?.trim()) {
    const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count) VALUES (?,?,?)').run(bank_name.trim(), '简答', 3);
    targetBankId = r.lastInsertRowid;
    logAdmin('新建题库', bank_name.trim());
  }
  const ins = db.prepare('INSERT INTO questions (bank_id, text, reference, keywords, category, difficulty) VALUES (?,?,?,?,?,?)');
  let count = 0;
  db.transaction(() => {
    rows.forEach(obj => {
      const text = getF(obj, '题目', '问题', 'text', 'question');
      const ref = getF(obj, '参考答案', '标准答案', '答案', 'reference', 'answer');
      if (!text || !ref) return;
      ins.run(targetBankId, text, ref, getF(obj, '关键词', 'keywords'), getF(obj, '分类', '类别', 'category') || '业务知识', getF(obj, '难度', 'difficulty') || '中等');
      count++;
    });
  })();
  logAdmin('导入题库', `题库ID=${targetBankId} 导入${count}题`);
  res.json({ ok: true, count, bankId: targetBankId });
});

// ─── 智能出题：Word/PDF/图片 → AI识别 → 生成题目 ────────────────────────────
async function callQwenText(KEY, prompt, maxTokens = 3000) {
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3
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
  return `你是武汉地铁乘务安全培训专家。以下是一份地铁安全事件/事故分析报告。请生成 1 道考核题目。

【题目格式】
根据报告内容，提炼出该事件的简短名称（格式：线路/地点+事件类型，如"1号线越信号事件"、"三金潭车辆段脱轨事件"），生成如下题目：
"请简要概述[事件简短名称]，口述事件简要经过、乘务员存在问题、整改措施及反思。"

【答案要点要求】
按以下顺序，每条用分号分隔：
1. 简要经过：日期（年月日）+ 线路/地点 + 车号（不写人名）+ 一句话概括发生了什么（不要写精确时分秒，只写日期即可）
2. 乘务员存在的问题：从报告提取违规操作/失误行为，逐条列出（每条一个分号，不要包含具体时间戳）
3. 整改措施及反思：从报告整改/反思部分提取，逐条列出（每条一个分号）

【重要】答案要点中不要出现任何"HH:MM:SS"格式的精确时间，时间信息只需保留到日期或事件阶段（如"动车时"、"退行中"）

只返回JSON数组（只有1个元素），格式：
[{"text":"题目内容","reference":"要点1;要点2;要点3","keywords":"关键词1,关键词2","category":"安全事件"}]

报告内容：
${text.slice(0, 4000)}`;
}

function buildGeneralPrompt(text, count) {
  return `你是武汉地铁乘务培训专家，根据以下文本内容生成 ${count} 道业务考核题目。每道题必须是简答题（口述操作步骤或要点）。只返回JSON数组，格式：[{"text":"题目内容","reference":"参考答案，各步骤用分号分隔","keywords":"关键词1,关键词2","category":"分类名称"}]

文本内容：
${text.slice(0, 4000)}`;
}

app.post('/api/admin/banks/parse-doc', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY) return res.status(503).json({ error: '未配置DASHSCOPE_API_KEY' });

  const { bank_id, bank_name, count = 5 } = req.body;
  const ext = (req.file.originalname || '').toLowerCase();
  const mime = req.file.mimetype || '';
  const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(ext);

  try {
    let extractedText = '';
    let rawJson = '';

    if (isImage) {
      // 图片：直接用视觉模型识别内容并出题
      const base64 = req.file.buffer.toString('base64');
      const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg';
      const imgPrompt = `你是武汉地铁乘务安全培训专家。请识别图片中的文字内容，判断是否为安全事件/事故分析报告。

如果是安全事件报告，只生成1道题：
- 题目格式："请简要概述[线路/地点+事件类型]，口述事件简要经过、乘务员存在问题、整改措施及反思。"
- 答案要点按顺序用分号分隔：①简要经过（日期年月日+线路/地点+车号+一句话概括）②乘务员存在的问题（逐条）③整改措施及反思（逐条）
- docType填"incident"。

如果是普通培训材料，生成 ${count} 道业务操作考核题目，docType填"general"。

只返回JSON数组，格式：[{"text":"题目","reference":"参考答案（各要点用分号分隔）","keywords":"关键词1,关键词2","category":"分类名称","docType":"incident或general"}]`;
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
    } else {
      return res.status(400).json({ error: '不支持的文件格式，请上传 Word(.docx)、PDF、或图片' });
    }

    if (!isImage) {
      if (!extractedText?.trim()) return res.status(400).json({ error: '文件内容为空或无法提取文本' });
      const isIncident = isIncidentReport(extractedText);
      const prompt = isIncident
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
    const docType = questions[0]?.docType || (isIncidentReport(extractedText || '') ? 'incident' : 'general');
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
  if (!cycle) return res.json([]);
  const rows = db.prepare(`
    SELECT s.id, s.staff_id, s.staff_name, s.total_score, s.total_points, s.q_count, s.created_at, s.hidden, s.tab_switch_count,
           COALESCE(st.is_tester,0) as is_tester, COALESCE(st.is_cp,0) as is_cp, COALESCE(st.is_exempt,0) as is_exempt
    FROM sessions s LEFT JOIN staff st ON st.id=s.staff_id
    WHERE s.cycle_id=? AND s.completed=1 AND s.q_count>=3
      AND COALESCE(s.is_deleted,0)=0 AND COALESCE(s.is_practice,0)=0
    ORDER BY s.total_points DESC, s.created_at DESC
  `).all(cycle.id);
  res.json({ cycle, rows });
});
app.get('/api/admin/leaderboard/alltime', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.staff_id, s.staff_name, s.total_score, s.total_points, s.q_count, s.created_at, s.hidden, s.tab_switch_count,
           COALESCE(st.is_tester,0) as is_tester, COALESCE(st.is_cp,0) as is_cp, COALESCE(st.is_exempt,0) as is_exempt
    FROM sessions s LEFT JOIN staff st ON st.id=s.staff_id
    WHERE s.completed=1 AND s.q_count>=3
      AND COALESCE(s.is_deleted,0)=0 AND COALESCE(s.is_practice,0)=0
    ORDER BY s.total_points DESC, s.created_at DESC LIMIT 100
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
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','dist','index.html')));


// ─── 讯飞 IAT 鉴权URL生成 ────────────────────────────────────────────────────
// ─── 讯飞 IAT 文件上传识别 ───────────────────────────────────────────────────
app.post('/api/iat', upload.single('audio'), async (req, res) => {
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({error:'讯飞未配置'});
  const iatStart = Date.now(); console.log('[IAT REQ] 收到请求，文件大小:', req.file?.size, '类型:', req.file?.mimetype);
  if (!req.file) return res.status(400).json({error:'no audio'});
  require('fs').writeFileSync('/tmp/last_upload.bin', req.file.buffer);
  console.log('[IAT] 已保存到/tmp/last_upload.bin');

  // 生成鉴权URL
  const host = 'iat-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signStr = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
  const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('base64');
  const auth = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sign}"`).toString('base64');
  const wsUrl = `wss://${host}/v2/iat?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;

  // 把webm音频转为PCM（16k单声道）
  const ts = Date.now();
  const tmpIn = `/tmp/iat_in_${ts}`;
  const tmpOut = `/tmp/iat_out_${ts}.raw`;
  fs.writeFileSync(tmpIn, req.file.buffer);

  // WAV格式直接跳过ffmpeg，其他格式才转换
  const isWav = req.file.mimetype === 'audio/wav' || req.file.originalname?.endsWith('.wav');
  let audioBuffer;
  if(isWav){
    // WAV文件：跳过文件头（44字节），直接取PCM数据
    audioBuffer = req.file.buffer.slice(44);
    console.log('[IAT] WAV直接使用PCM，大小:', audioBuffer.length);
    try { fs.unlinkSync(tmpIn); } catch(e){}
  } else {
    // 其他格式：ffmpeg转换
    audioBuffer = await new Promise((resolve) => {
      const ff = spawn('/opt/homebrew/bin/ffmpeg', ['-y','-i',tmpIn,'-vn','-ar','16000','-ac','1','-f','s16le',tmpOut], {stdio:'pipe'});
      ff.on('close', (code) => {
        try { fs.unlinkSync(tmpIn); } catch(e){}
        if(code === 0 && fs.existsSync(tmpOut)){
          resolve(fs.readFileSync(tmpOut));
        } else {
          console.log('[IAT] ffmpeg失败code:', code, '用原始buffer');
          resolve(req.file.buffer);
        }
      });
      ff.on('error', () => {
        try { fs.unlinkSync(tmpIn); } catch(e){}
        resolve(req.file.buffer);
      });
      setTimeout(() => { ff.kill(); resolve(req.file.buffer); }, 10000);
    });
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let fullText = '';
    const sentences = {};
    let timer = setTimeout(() => {
      ws.close();
      try { fs.unlinkSync(tmpOut); } catch(e){}
      console.log('[IAT TIMEOUT] 耗时:', Date.now()-iatStart, 'ms'); res.json({text: fullText || '', error: 'timeout'});
      resolve();
    }, 15000);

    ws.on('open', () => {
      // 分帧发送音频
      const frameSize = 8192;
      let offset = 0;
      const sendFrame = () => {
        if (offset >= audioBuffer.length) {
          ws.send(JSON.stringify({data:{status:2,format:'audio/L16;rate=16000',encoding:'raw',audio:''}}));
          return;
        }
        const frame = audioBuffer.slice(offset, offset + frameSize);
        const status = offset === 0 ? 0 : 1;
        if (offset === 0) {
          ws.send(JSON.stringify({
            common:{app_id:appId},
            business:{language:'zh_cn',domain:'iat',accent:'mandarin',dwa:'wpgs',ptt:0,nunum:1,vad_eos:5000},
            data:{status:0,format:'audio/L16;rate=16000',encoding:'raw',audio:frame.toString('base64')}
          }));
        } else {
          ws.send(JSON.stringify({data:{status:1,format:'audio/L16;rate=16000',encoding:'raw',audio:frame.toString('base64')}}));
        }
        offset += frameSize;
        setTimeout(sendFrame, 40);
      };
      sendFrame();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        console.log('[IAT]', JSON.stringify({code:msg.code,status:msg.data?.status,has_result:!!msg.data?.result,ws_len:msg.data?.result?.ws?.length,ls:msg.data?.result?.ls}));
        if (msg.code !== 0) { console.log('[IAT ERROR]', msg.message, msg.code); return; }
        const result = msg.data?.result;
        if (!result) return;
        console.log('[IAT WS]', JSON.stringify(result.ws));
        const sn = result.sn;
        const pgs = result.pgs;
        const ws_arr = result.ws || [];
        const text = ws_arr.map(w => w.cw?.[0]?.w || '').join('');
        if (pgs === 'rpl') { const rg = result.rg||[]; for(let i=rg[0];i<=rg[1];i++) delete sentences[i]; }
        sentences[sn] = text;
        fullText = Object.keys(sentences).sort((a,b)=>a-b).map(k=>sentences[k]).join('');
        if (result.ls) { clearTimeout(timer); ws.close();
          clearTimeout(timer);
          ws.close();
          try { fs.unlinkSync(tmpOut); } catch(e){}
          res.json({text: fullText});
          resolve();
        }
      } catch(e){}
    });

    ws.on('error', (e) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpOut); } catch(e){}
      res.json({text:'', error: e.message});
      resolve();
    });
  });
});

app.get('/api/iat-token', (req, res) => {
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({error:'讯飞未配置'});
  const host = 'iat-api.xfyun.cn';
  const date = new Date().toUTCString();
  const signStr = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
  const sign = crypto.createHmac('sha256', apiSecret).update(signStr).digest('base64');
  const auth = Buffer.from(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sign}"`).toString('base64');
  const wsUrl = `wss://${host}/v2/iat?authorization=${auth}&date=${encodeURIComponent(date)}&host=${host}`;
  res.json({url: wsUrl, appId});
});

// ─── 阿里云实时语音识别 WebSocket代理 ────────────────────────────────────────
const ALI_APPKEY = process.env.ALI_APPKEY;
const ALI_AK_ID  = process.env.ALI_AK_ID;
const ALI_AK_SEC = process.env.ALI_AK_SEC;

async function getAliToken() {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now()/1000);
    const params = new URLSearchParams({
      AccessKeyId: ALI_AK_ID,
      Action: 'CreateToken',
      Format: 'JSON',
      RegionId: 'cn-shanghai',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: Math.random().toString(36).slice(2),
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2019-02-28',
    });
    const sorted = [...params.entries()].sort(([a],[b])=>a.localeCompare(b));
    const canonicalStr = sorted.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const strToSign = 'GET&%2F&' + encodeURIComponent(canonicalStr);
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha1', ALI_AK_SEC+'&').update(strToSign).digest('base64');
    params.set('Signature', sig);
    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${params.toString()}`;
    https.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.Token?.Id) resolve(j.Token.Id);
          else reject(new Error('Token获取失败: ' + data));
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// 缓存Token，有效期约10分钟
let aliTokenCache = { token: null, expireAt: 0 };
async function getCachedAliToken() {
  if (aliTokenCache.token && Date.now() < aliTokenCache.expireAt) return aliTokenCache.token;
  const token = await getAliToken();
  aliTokenCache = { token, expireAt: Date.now() + 9 * 60 * 1000 };
  return token;
}

const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', async (clientWs) => {
  let aliWs = null;
  let taskId = require('crypto').randomBytes(16).toString('hex');
  let msgId  = () => require('crypto').randomBytes(16).toString('hex');
  let started = false;
  let finalText = '';

  try {
    const token = await getCachedAliToken();
    aliWs = new WebSocket(`wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token=${token}`);

    aliWs.on('open', () => {
      // 发送StartTranscription指令
      aliWs.send(JSON.stringify({
        header: {
          message_id: msgId(),
          task_id: taskId,
          namespace: 'SpeechTranscriber',
          name: 'StartTranscription',
          appkey: ALI_APPKEY,
        },
        payload: {
          format: 'pcm',
          sample_rate: 16000,
          enable_intermediate_result: true,
          enable_punctuation_prediction: true,
          enable_inverse_text_normalization: true,
          speech_noise_threshold: 0.7,
          max_sentence_silence: 800,
        }
      }));
    });

    aliWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const name = msg.header?.name;
        if (name === 'TranscriptionResultChanged') {
          // 中间结果：实时推给前端
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText + (msg.payload?.result || '') }));
        } else if (name === 'SentenceEnd') {
          // 一句话结束：累加
          finalText += (msg.payload?.result || '');
          clientWs.send(JSON.stringify({ type: 'partial', text: finalText }));
        } else if (name === 'TranscriptionCompleted') {
          // 识别完成
          if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
          clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
          aliWs.close();
        } else if (name === 'TaskFailed') {
          clientWs.send(JSON.stringify({ type: 'error', text: '识别失败，请纠正模式手动输入' }));
          aliWs.close();
        }
      } catch(e) {}
    });

    aliWs.on('error', () => {
      clientWs.send(JSON.stringify({ type: 'error', text: '识别服务异常，请纠正模式手动输入' }));
    });

    aliWs.on('close', () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

  } catch(e) {
    clientWs.send(JSON.stringify({ type: 'error', text: 'Token获取失败，请纠正模式手动输入' }));
    clientWs.close();
    return;
  }

  let stopTimer = null;

  // 前端发来的消息
  clientWs.on('message', (data) => {
    if (!aliWs || aliWs.readyState !== WebSocket.OPEN) return;
    if (typeof data === 'string' || data instanceof Buffer && data[0] === 123) {
      // JSON控制指令
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'stop') {
          aliWs.send(JSON.stringify({
            header: {
              message_id: msgId(),
              task_id: taskId,
              namespace: 'SpeechTranscriber',
              name: 'StopTranscription',
              appkey: ALI_APPKEY,
            }
          }));
          // 超时保障：10秒内未收到 TranscriptionCompleted，强制返回已有内容
          stopTimer = setTimeout(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'final', text: finalText }));
            }
            try { aliWs.close(); } catch(e) {}
          }, 10000);
        }
      } catch(e) {}
    } else {
      // 二进制音频数据，直接转发
      if (aliWs.readyState === WebSocket.OPEN) aliWs.send(data);
    }
  });

  clientWs.on('close', () => {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (aliWs && aliWs.readyState === WebSocket.OPEN) {
      try {
        aliWs.send(JSON.stringify({
          header: { message_id: msgId(), task_id: taskId, namespace: 'SpeechTranscriber', name: 'StopTranscription', appkey: ALI_APPKEY }
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
