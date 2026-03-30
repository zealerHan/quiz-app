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
try { db.exec('ALTER TABLE staff ADD COLUMN avatar TEXT'); } catch(e) {}
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
  const startStr = cycleStart.toISOString().slice(0,10);
  const endDate = new Date(cycleStart); endDate.setDate(endDate.getDate()+2);
  const endStr = endDate.toISOString().slice(0,10);
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
  const base = qCount * 6; // 每题6基础分，3题=18
  let bonus = 0;
  if (avgScore >= 85) bonus += qCount * 4;   // 优秀每题+4，3题满分30
  else if (avgScore >= 70) bonus += qCount * 2; // 良好每题+2
  return { base, bonus, total: base + bonus };
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
  res.json(db.prepare('SELECT id, real_name, phone_tail, is_exempt, is_tester, created_at FROM staff ORDER BY created_at DESC').all());
});

// 单条添加
app.post('/api/staff', adminAuth, (req, res) => {
  const { id, real_name, phone_tail, is_exempt, is_tester } = req.body;
  if (!id?.trim() || !real_name?.trim()) return res.status(400).json({ error: '工号和姓名不能为空' });
  const staffId = id.trim().replace(/^Y/i, '');
  db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester) VALUES (?,?,?,?,?,?)')
    .run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt ? 1 : 0, is_tester ? 1 : 0);
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
  const { real_name, phone_tail, is_exempt, is_tester } = req.body;
  if (!real_name?.trim()) return res.status(400).json({ error: '姓名不能为空' });
  db.prepare('UPDATE staff SET name=?, real_name=?, phone_tail=?, is_exempt=?, is_tester=? WHERE id=?')
    .run(real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt ? 1 : 0, is_tester ? 1 : 0, req.params.id);
  logAdmin('编辑人员', `工号${req.params.id} ${real_name.trim()}`);
  res.json({ ok: true });
});

// ─── Questions API ─────────────────────────────────────────────────────────
app.get('/api/questions', (req, res) => {
  const bankId = req.query.bank_id;
  const examMode = getSetting('exam_mode') === '1';
  let activeBankId;

  if (examMode) {
    activeBankId = parseInt(getSetting('exam_bank_id'));
  } else if (bankId) {
    activeBankId = parseInt(bankId);
  } else {
    const activeBank = db.prepare('SELECT id FROM question_banks WHERE is_active=1 LIMIT 1').get();
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
async function scoreWithQwen(question, reference, answer) {
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY || !answer?.trim()) return null;
  try {
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content:
          `你是武汉地铁乘务培训考核专家，评估乘务员的故障处理口述答题。只返回JSON，不含任何其他内容。

【题目】${question}

【标准处置步骤】（顺序为递进排除法，不可颠倒）
${reference}

【乘务员口述】（来自语音识别，可能含口语化表达、停顿词、同音字错误）
${answer||'（未作答）'}

【评分说明】
- "然后""就是""那个""嗯"等停顿词忽略不计
- 同音字/近音字（如"隔离"识别成"格里"）按语义理解，不算错
- 意思相近、表达不同的步骤（如"通知列车长"说成"报告车长"）视为正确
- 核心判断：是否按顺序说出了各关键步骤，完全遗漏才算缺失
- 步骤顺序严格评判，颠倒不得分；含糊但方向正确给一半分

只返回如下JSON，不要加任何解释或markdown：
{"score":0-100,"level":"优秀|合格|需加强","summary":"一句话总体评价","correct_points":["已正确说出的步骤"],"missing_points":["完全遗漏的步骤"],"order_errors":["顺序颠倒说明，没有则空数组"],"suggestion":"具体改进建议","encouragement":"鼓励语"}` }],
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
  let result = await scoreWithQwen(q.text, q.reference, answer);
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
      AND COALESCE(is_practice,0)=0
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
      AND COALESCE(is_practice,0)=0
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
  const todayComplete = db.prepare("SELECT COUNT(DISTINCT staff_id) as c FROM sessions WHERE date(created_at)=date('now','localtime') AND completed=1").get().c;
  const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff WHERE is_exempt=0").get().c;
  const catAvg = db.prepare("SELECT category, ROUND(AVG(score),0) as avg FROM answers GROUP BY category ORDER BY avg").all();
  const topWeak = catAvg.slice(0,2);
  const cycleStats = cycle ? db.prepare(`
    SELECT staff_id, staff_name, SUM(total_points) as pts, ROUND(AVG(total_score),1) as avg, COUNT(*) as sessions
    FROM sessions WHERE cycle_id=? AND completed=1 AND COALESCE(hidden,0)=0 GROUP BY staff_id ORDER BY pts DESC
  `).all(cycle.id) : [];
  res.json({ todayComplete, totalStaff, catAvg, topWeak, cycle, cycleStats });
});

app.get('/api/admin/members', adminAuth, (req, res) => {
  const members = db.prepare(`
    SELECT s.id, s.real_name, s.phone_tail, s.is_exempt, s.is_tester,
           COUNT(DISTINCT date(ss.created_at)) as answer_days,
           ROUND(AVG(ss.total_score),1) as avg_score,
           MAX(ss.total_score) as best_score,
           SUM(ss.total_points) as total_points,
           MAX(ss.created_at) as last_at
    FROM staff s
    LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1
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
      AND COALESCE(s.hidden,0)=0
    ORDER BY s.created_at ASC
  `).all();

  const threshold = 5;
  res.json({
    date: today,
    completedCount: completed.length,
    completed: completed.map(r => r.name),
    threshold,
    reached: completed.length >= threshold,
    missing: Math.max(0, threshold - completed.length)
  });
});

// ─── Batch: delete today's sessions ────────────────────────────────────────
app.delete('/api/admin/sessions/today', adminAuth, (req, res) => {
  const info = db.prepare("DELETE FROM sessions WHERE date(created_at)=date('now','localtime')").run();
  logAdmin('清除今日数据', `删除 ${info.changes} 条答题记录`);
  res.json({ ok: true, deleted: info.changes });
});

// ─── Batch: update staff identity ──────────────────────────────────────────
app.put('/api/admin/staff/batch-identity', adminAuth, (req, res) => {
  const { ids, is_tester, is_exempt } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择人员' });
  const stmt = db.prepare('UPDATE staff SET is_tester=?, is_exempt=? WHERE id=?');
  const run = db.transaction(() => ids.forEach(id => stmt.run(is_tester ? 1 : 0, is_exempt ? 1 : 0, id)));
  run();
  logAdmin('批量修改身份', `${ids.length}人 → 测试:${is_tester?'是':'否'} 免答:${is_exempt?'是':'否'}`);
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
  db.prepare('DELETE FROM answers WHERE session_id=?').run(req.params.id);
  db.prepare('DELETE FROM sessions WHERE id=?').run(req.params.id);
  logAdmin('删除成绩', `session_id=${req.params.id} ${sess?.staff_name||''}`);
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

// ─── Alltime leaderboard full list (admin) ─────────────────────────────────
app.get('/api/admin/leaderboard/cycle', adminAuth, (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json([]);
  const rows = db.prepare(`
    SELECT s.id, s.staff_id, s.staff_name, s.total_score, s.total_points, s.q_count, s.created_at, s.hidden, s.tab_switch_count
    FROM sessions s WHERE s.cycle_id=? AND s.completed=1 ORDER BY s.total_points DESC, s.created_at DESC
  `).all(cycle.id);
  res.json({ cycle, rows });
});
app.get('/api/admin/leaderboard/alltime', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.staff_id, s.staff_name, s.total_score, s.total_points, s.q_count, s.created_at, s.hidden, s.tab_switch_count
    FROM sessions s WHERE s.completed=1 ORDER BY s.total_points DESC, s.created_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

// ─── Excel Export ──────────────────────────────────────────────────────────
app.get('/api/export', adminAuth, async (req, res) => {
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

  const answers = db.prepare("SELECT a.*,s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id ORDER BY a.created_at DESC").all();
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
  const members = db.prepare("SELECT s.id,s.name,COUNT(DISTINCT date(ss.created_at)) as days,SUM(ss.total_points) as pts,ROUND(AVG(ss.total_score),1) as avg,MAX(ss.created_at) as last FROM staff s LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1 GROUP BY s.id ORDER BY pts DESC NULLS LAST").all();
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

  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''%E7%AD%94%E9%A2%98%E8%AE%B0%E5%BD%95_${date}.xlsx`);
  await wb.xlsx.write(res); res.end();
});

// ─── QR Code ──────────────────────────────────────────────────────────────
app.get('/api/qrcode', async (req, res) => {
  const nets = os.networkInterfaces(); let ip='localhost';
  for(const n of Object.values(nets)) for(const i of n) if(i.family==='IPv4'&&!i.internal){ip=i.address;break;}
  const url=`http://${ip}:${PORT}`;
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
          speech_noise_threshold: 0.5,
          max_sentence_silence: 500,
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
        }
      } catch(e) {}
    } else {
      // 二进制音频数据，直接转发
      if (aliWs.readyState === WebSocket.OPEN) aliWs.send(data);
    }
  });

  clientWs.on('close', () => {
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
      business: {language:'zh_cn', domain:'iat', accent:'mandarin', dwa:'wpgs', vad_eos:1500,ptt:0,nunum:1},
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
