// ─── 休假模块 API（独立路由，不侵入现有 admin/quiz/workshop）──────────
// 鉴权约定（2026-11-23 加固）：
//   · 前端登录后把 staffId 存 localStorage，请求时放 x-staff-id 头
//   · /api/leave/my、/api/leave/summary 只认该头，**忽略 query 传参**，
//     防止改 URL 参数查别人
//   · /api/leave/all 是全员数据，必须管理员密码
const express = require('express');
const { calcDeductFromShifts } = require('../leaveDays');
const router = express.Router();
const { db } = require('../db');
const { adminAuth } = require('../middleware');
const { sendGroupPush, sendToChannel } = require('../push');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ── 留言图片上传：内存收，sharp 压，落盘 data/wall-images ──
const WALL_IMG_DIR = path.join(__dirname, '..', '..', 'data', 'wall-images');
// 下周休假申报图（钉钉 markdown 嵌图用，需公网可访问）
const CHART_DIR = path.join(__dirname, '..', '..', 'data', 'leave-charts');
// 公网地址：钉钉嵌图必须是公网匿名可访问的 URL
const PUBLIC_BASE = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
const wallUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },   // 12MB 原图上限
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('只能传图片'));
    cb(null, true);
  },
});

const YEAR = new Date().getFullYear();

// ══════════════════════════════════════════════════════════════
// 北京时间工具（2026-11-25 统一）
//
// 为什么需要：容器跑在 UTC，直接 new Date().getHours()/getDay() 取到的是 UTC 值，
// 比北京时间慢 8 小时。后果：
//   · 北京时间 00:00-08:00 期间，UTC 还是前一天 → 「本周」算成上一周，日历整周错位
//   · 17:00 截止判断在 09:00-17:00 全程失效（以为窗口还开着）
//
// 踩过的坑：new Date(now.toLocaleString('en-US',{timeZone:'Asia/Shanghai'}))
//   toLocaleString 产出字符串，再喂给 Date 构造器会按「容器本地时区」重新解析，
//   等于把上海时间当成 UTC，仍然差 8 小时 —— 看起来"转过了"其实没转。
//   正解：用 Intl.DateTimeFormat.formatToParts 直接取各字段，拼字符串。
// ══════════════════════════════════════════════════════════════

/** 北京时间的 'YYYY-MM-DD HH:mm' */
function cstNow() {
  return cstParts(new Date());
}

/** 任意 Date → 北京时间各字段 */
function cstParts(d) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => (p.find(x => x.type === t) || {}).value || '00';
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    time: `${g('hour')}:${g('minute')}:${g('second')}`,
    dt: `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`,
  };
}

/** 北京时间今天 'YYYY-MM-DD' */
function cstToday() {
  return cstParts(new Date()).date;
}

// ── ISO 周 key（须在使用前定义，函数声明会提升，这里放前面便于阅读）──
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ── 内部：算某人某年的额度与已用 ─────────────────────────────
function buildQuota(staffId, year = YEAR) {
  const q = db.prepare('SELECT * FROM leave_quota WHERE staff_id=? AND year=?').get(staffId, year);
  if (!q) return null;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  // 已休口径（老韩 2026-11-26 统一）：
  // 批准了就算扣，不管有没有休到 —— 因为批了就是定下来的事，余额不该还留着。
  //   ① 已发生且已验证/锁版 → 计入 used
  //   ② 已批准但还没到日期     → 也计入 used，另外单独标在 upcoming（即将休）
  //   ③ 还在审批中(submitted)  → 不计入 used，标在 pending（待审批）
  //   ④ 作废/驳回              → 一律不算
  // 旧口径是「end_date <= 今天才算已休」，导致谢安达
  // 11-29~12-01 批了、余额却还显示 2.5，跟管理页总览对不上。
  const rows = db.prepare(
    `SELECT leave_type, days, status, start_date, end_date
     FROM leave_records
     WHERE staff_id=? AND quota_year=? AND status NOT IN ('cancelled','rejected','draft')
     ORDER BY start_date`
  ).all(staffId, year);

  const used = {};        // 已批准（含已休完 + 还没休到的）
  const upcoming = {};    // 其中「还没开始休」的部分
  const pending = {};     // 待审批
  const ACTIVE = ['verified','locked','reported','released'];
  for (const r of rows) {
    const t = r.leave_type;
    if (ACTIVE.includes(r.status)) {
      used[t] = Math.round(((used[t] || 0) + r.days) * 10) / 10;
      if (r.end_date > today) {   // 还没休完 → 记进即将休
        upcoming[t] = Math.round(((upcoming[t] || 0) + r.days) * 10) / 10;
      }
    } else if (r.status === 'submitted' || r.status === 'cancel_pending') {
      pending[t] = Math.round(((pending[t] || 0) + r.days) * 10) / 10;
    }
  }

  const pack = (type, totalKey) => {
    const total = q[totalKey] || 0;
    const u = used[type] || 0;
    return {
      total,
      used: u,
      left: Math.round((total - u) * 10) / 10,
      upcoming: upcoming[type] || 0,   // 其中已批未休
      pending: pending[type] || 0,     // 待审批（不扣）
    };
  };

  return {
    year,
    annual_total: q.annual_total || 0,
    annual_used: used['年休'] || 0,
    marriage_total: q.marriage_total || 0,
    marriage_used: used['婚假'] || 0,
    paternity_total: q.paternity_total || 0,
    paternity_used: used['陪产假'] || 0,
    parental_total: q.parental_total || 0,
    parental_used: used['育儿假'] || 0,
    work_years_note: q.work_years_note || '',
    // 结构化明细：前端按假别渲染「已休X/剩Y」时直接取这里
    detail: {
      年休:   pack('年休', 'annual_total'),
      婚假:   pack('婚假', 'marriage_total'),
      陪产假: pack('陪产假', 'paternity_total'),
      育儿假: pack('育儿假', 'parental_total'),
    },
  };
}

// ── 取请求者工号：只认请求头，不认 query ───────────────────────
// 工号容错（老韩 2026-11-26）：库存的是补零 5 位（03743），但老前端缓存的
// localStorage 里可能是旧写法（3743），直接把 3743 丢给 SQL 会查不到人。
// 所以这里统一按「数字部分 + 补零到5位」归一，匹配不到再退回原值。
function reqStaffId(req) {
  const raw = String(req.headers['x-staff-id'] || '').trim();
  if (!raw) return '';
  // 已经能在 staff 表里精确查到，直接用
  if (db.prepare('SELECT 1 FROM staff WHERE id=?').get(raw)) return raw;
  // 否则尝试归一：去 Y / 去空格 / 只留数字
  const digits = raw.replace(/^[Yy]/, '').replace(/\s/g, '').replace(/[^0-9]/g, '');
  if (!digits) return raw;
  const padded = digits.padStart(5, '0');
  if (db.prepare('SELECT 1 FROM staff WHERE id=?').get(padded)) return padded;
  // 工号位数不足 5 位也可能本来就存在（历史数据），退回原值交给下游报错
  return raw;
}

// ── 主页卡片用的摘要（必须轻量，主页每次加载都会调）────────────
router.get('/api/leave/summary', (req, res) => {
  const staffId = reqStaffId(req);
  // 年份：?year=2027 可查指定年度，默认当年
  const qYear = Number(req.query.year) || YEAR;
  if (!staffId) {
    return res.json({
      annual_left: '—', marriage_left: '—', paternity_left: '—', parental_left: '—',
      total_left: '—', breakdown: '—',
      next_week_reported: true, month_reported: true, need_login: true,
    });
  }
  try {
    const q = buildQuota(staffId, qYear);
    const d = new Date();
    const nextMon = new Date(d);
    nextMon.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    const wk = isoWeekKey(nextMon);
    const b = db.prepare('SELECT reported_at FROM leave_batches WHERE week_key=?').get(wk);
    const f = n => (n == null ? '—' : (n % 1 === 0 ? n : n.toFixed(1)));
    // 各假别剩余
    // ⚠️ 负数不能直接显示（老韩 2026-11-25：年休用完了就显示「额度已用完」，
    //    不要显示 -0.5 这种虚数）。额度被置 0 但历史有休假记录时，
    //    直接相减会得到 -6 / -5.5 这种负数，这里钳到 0。
    //    但超支事实仍记在 leave_quota.work_years_note 里，管理端能看到。
    const clamp = (n) => (n > 0 ? n : 0);
    const annualLeft  = q ? clamp(q.annual_total - q.annual_used) : 0;
    const marriageLeft= q ? clamp(q.marriage_total - q.marriage_used) : 0;
    const paternityLeft=q ? clamp(q.paternity_total - q.paternity_used) : 0;
    const parentalLeft= q ? clamp(q.parental_total - q.parental_used) : 0;

    // 是否「额度用完但休过」：用来显示「额度已用完」而不是什么都不显示
    const annualUsedUp = q && q.annual_used > 0 && annualLeft <= 0;

    // 总额 = 所有假别剩余相加（老韩：除了年休还有育儿假等，一共能休的天数）
    const totalLeft = Math.round((annualLeft + marriageLeft + paternityLeft + parentalLeft) * 10) / 10;

    // 小字只列 >0 的假别；额度为 0 但实际休过 → 显示「已用完」
    const parts = [];
    if (annualLeft > 0) parts.push(`年休${f(annualLeft)}天`);
    else if (annualUsedUp) parts.push('年休已用完');
    if (paternityLeft > 0) parts.push(`陪产假${f(paternityLeft)}天`);
    if (marriageLeft > 0) parts.push(`婚假${f(marriageLeft)}天`);
    if (parentalLeft > 0) parts.push(`育儿假${f(parentalLeft)}天`);
    const hasParentalRecord = !!db.prepare(`
      SELECT 1 FROM leave_records WHERE staff_id=? AND leave_type='育儿假'
        AND status NOT IN ('cancelled','rejected','draft') LIMIT 1
    `).get(staffId);
    if (parentalLeft <= 0 && hasParentalRecord) parts.push('育儿假额度待核');

    res.json({
      annual_left: q ? f(annualLeft) : '—',
      marriage_left: q ? f(marriageLeft) : '—',
      paternity_left: q ? f(paternityLeft) : '—',
      parental_left: q ? f(parentalLeft) : '—',
      total_left: q ? f(totalLeft) : '—',
      breakdown: q ? parts.join('｜') : '—',
      next_week_reported: !!(b && b.reported_at),
      // 本月是否已报：看本月内有没有任何一周报过（reported_at 落在本月）
      month_reported: !!db.prepare(`
        SELECT 1 FROM leave_batches
        WHERE reported_at IS NOT NULL
          AND substr(reported_at, 1, 7) = ?
        LIMIT 1
      `).get(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7)),
      week_key: wk,
    });
  } catch (e) {
    res.json({ annual_left: '—', marriage_left: '—', paternity_left: '—', parental_left: '—', total_left: '—', breakdown: '—', next_week_reported: true, month_reported: true, error: String(e.message) });
  }
});

// ── 我的额度 + 记录（休假页用）────────────────────────────────
router.get('/api/leave/my', (req, res) => {
  const staffId = reqStaffId(req);
  const qYear = Number(req.query.year) || YEAR;
  if (!staffId) return res.status(401).json({ error: '未登录，请重新登录' });
  const staff = db.prepare('SELECT id, real_name, name FROM staff WHERE id=?').get(staffId);
  if (!staff) return res.status(404).json({ error: '工号不存在' });
  res.json({
    staff: { id: staff.id, name: staff.real_name || staff.name },
    year: qYear,
    quota: buildQuota(staffId, qYear),
    records: db.prepare(
      `SELECT id, leave_type, start_date, end_date, days, status, source
       FROM leave_records WHERE staff_id=? AND quota_year=? ORDER BY start_date DESC`
    ).all(staffId, qYear),
  });
});

// ─── 假期权益维护（老韩 2026-11-26）──────────────────────────────
// 婚假/陪产假/育儿假的额度不再手填死数字，而是录入「事件日期」由规则算。
// 规则与出处见 server/leaveRights.js 顶部注释（育儿假按武汉官方自然年度切）。
const RIGHTS = require('../leaveRights');

const KIND_LABEL = { marriage: '婚假', paternity: '陪产假', parental: '育儿假' };
// 每类权益的默认天数与周期规则，新增时前端不用手工选
const KIND_DEFAULT = {
  marriage:  { total_days: 15, cycle_kind: 'year365',       label: '婚假' },
  paternity: { total_days: 15, cycle_kind: 'month3',        label: '陪产假' },
  parental:  { total_days: 10, cycle_kind: 'calendar_year', label: '育儿假' },
};

// leave.js 里没有统一的 logAdmin，现有接口都是直接 INSERT admin_logs，这里保持一致
function writeAdminLog(action, detail, operator) {
  try {
    db.prepare('INSERT INTO admin_logs (action, detail, operator) VALUES (?,?,?)')
      .run(action, detail, operator || '');
  } catch (e) { console.warn('[leave] 写日志失败:', e.message); }
}

// 列出某人的全部权益（带实时计算结果）
function buildRightsView(staffId, today) {
  const rows = db.prepare(
    'SELECT * FROM leave_rights WHERE staff_id=? ORDER BY kind, event_date'
  ).all(staffId);
  const out = [];
  for (const kind of ['marriage', 'paternity', 'parental']) {
    const mine = rows.filter(r => r.kind === kind);
    if (!mine.length) continue;
    // 已休：只算生效状态，作废/驳回不算
    const typeName = KIND_LABEL[kind];
    const used = db.prepare(
      `SELECT COALESCE(SUM(days),0) d FROM leave_records
       WHERE staff_id=? AND leave_type=? AND status IN ('verified','locked','reported','released')`
    ).get(staffId, typeName).d;
    out.push({ ...RIGHTS.summarizeRights(mine, used, today), kind_label: typeName });
  }
  return out;
}

// GET /api/leave/rights?staffId=  —— 单人权益明细（管理员）
router.get('/api/leave/rights', adminAuth, (req, res) => {
  const staffId = reqStaffId(req) || String(req.query.staffId || '').trim();
  if (!staffId) return res.status(400).json({ error: '缺少 staffId' });
  const s = db.prepare('SELECT COALESCE(real_name,name) nm FROM staff WHERE id=?').get(staffId);
  if (!s) return res.status(404).json({ error: '员工不存在' });
  const today = cstToday();
  res.json({ staff_id: staffId, name: s.nm, today, rights: buildRightsView(staffId, today) });
});

// GET /api/leave/rights/all?year=  —— 全组权益总览（管理员）
// 只列「有权益记录」的人，没录入的不会凭空造数据
router.get('/api/leave/rights/all', adminAuth, (req, res) => {
  const today = cstToday();
  const ids = db.prepare('SELECT DISTINCT staff_id FROM leave_rights').all().map(r => r.staff_id);
  const people = ids.map(id => {
    const s = db.prepare('SELECT COALESCE(real_name,name) nm, COALESCE(is_cp,0) is_cp FROM staff WHERE id=?').get(id);
    if (!s) return null;
    return { staff_id: id, name: s.nm, is_cp: !!s.is_cp, rights: buildRightsView(id, today) };
  }).filter(Boolean).filter(p => p.rights.length > 0);
  // 在编在前、车峰在后
  people.sort((a, b) => (a.is_cp - b.is_cp) || a.name.localeCompare(b.name, 'zh'));
  res.json({ today, people });
});

// POST /api/leave/rights  —— 新增一条权益
// body: { staff_id, kind, event_date, total_days?, note? }
router.post('/api/leave/rights', adminAuth, (req, res) => {
  const { staff_id, kind, event_date, total_days, note } = req.body || {};
  const def = KIND_DEFAULT[kind];
  if (!def) return res.status(400).json({ error: '假别不正确（marriage/paternity/parental）' });
  if (!staff_id) return res.status(400).json({ error: '缺少员工工号' });
  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date))
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const s = db.prepare('SELECT COALESCE(real_name,name) nm FROM staff WHERE id=?').get(staff_id);
  if (!s) return res.status(404).json({ error: '员工不存在' });
  const days = Number(total_days) > 0 ? Number(total_days) : def.total_days;

  // 同类同一天重复录入直接拦掉，避免额度算两遍
  const dup = db.prepare(
    'SELECT id FROM leave_rights WHERE staff_id=? AND kind=? AND event_date=?'
  ).get(staff_id, kind, event_date);
  if (dup) return res.status(409).json({ error: `${s.nm} 已有一条 ${def.label}（事件日 ${event_date}），不要重复录入` });

  const info = db.prepare(
    `INSERT INTO leave_rights (staff_id, kind, event_date, total_days, cycle_kind, note, created_by)
     VALUES (?,?,?,?,?,?,?)`
  ).run(staff_id, kind, event_date, days, def.cycle_kind, note || '', req.adminName || '');

  // 顺手把最终失效日缓存进表，方便直接查
  const calc = RIGHTS.computeRight({ kind, event_date, total_days: days }, cstToday());
  if (calc.cycleEnd) {
    db.prepare('UPDATE leave_rights SET expires_on=? WHERE id=?').run(calc.cycleEnd, info.lastInsertRowid);
  }

  writeAdminLog('假期权益', `${s.nm} ${def.label} 事件日${event_date} 共${days}天`, req.adminName);
  res.json({ ok: true, id: info.lastInsertRowid, computed: calc });
});

// PATCH /api/leave/rights/:id  —— 改事件日期 / 天数 / 备注
router.patch('/api/leave/rights/:id', adminAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leave_rights WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '权益记录不存在' });
  const { event_date, total_days, note } = req.body || {};
  const ev = event_date || row.event_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const days = Number(total_days) > 0 ? Number(total_days) : row.total_days;
  const calc = RIGHTS.computeRight({ kind: row.kind, event_date: ev, total_days: days }, cstToday());
  db.prepare(
    `UPDATE leave_rights SET event_date=?, total_days=?, note=?, expires_on=?,
       updated_at=datetime('now','localtime') WHERE id=?`
  ).run(ev, days, note !== undefined ? note : row.note, calc.cycleEnd, id);
  writeAdminLog('修改假期权益', `#${id} 事件日${ev} 共${days}天`, req.adminName);
  res.json({ ok: true, computed: calc });
});

// DELETE /api/leave/rights/:id  —— 删除（录错了）
router.delete('/api/leave/rights/:id', adminAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leave_rights WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: '权益记录不存在' });
  db.prepare('DELETE FROM leave_rights WHERE id=?').run(id);
  writeAdminLog('删除假期权益', `#${id} ${KIND_LABEL[row.kind] || row.kind} 事件日${row.event_date}`, req.adminName);
  res.json({ ok: true });
});

// ── 全员额度表（班组长用，须管理员密码）────────────────────────
router.get('/api/leave/all', adminAuth, (req, res) => {
  const year = Number(req.query.year) || YEAR;
  const rows = db.prepare('SELECT staff_id FROM leave_quota WHERE year=?').all(year);
  const out = rows.map(r => {
    const q = buildQuota(r.staff_id, year);
    if (!q) return null;
    const s = db.prepare('SELECT real_name, name, roster_seq, is_cp FROM staff WHERE id=?').get(r.staff_id);
    return {
      staff_id: r.staff_id,
      name: s ? (s.real_name || s.name) : r.staff_id,
      // 班组序号（roster_seq，1~41 长期固定，不随排序变化）
      seq: s?.roster_seq != null ? Number(s.roster_seq) : null,
      is_cp: s?.is_cp ? 1 : 0,
      ...q,
      annual_left: q.annual_total - q.annual_used,
    };
  }).filter(Boolean).sort((a, b) => b.annual_left - a.annual_left);
  res.json({ year, rows: out });
});

// ══════════════════════════════════════════════════════════════
// 单人休假明细（总览点击某人弹窗用，老韩 2026-11-26）
//
// 需求：总览里点某个人 → 弹窗按时间线列出他的全部休假记录，方便核对与补备注。
//   · 记录按日期倒序（最近的在上面）
//   · 无记录的人前端显示「无相关记录」+ 补录按钮
//   · 休超的部分要能加备注（走 PATCH /api/leave/:id/note）
//
// GET /api/leave/staff/:staffId?year=2026
router.get('/api/leave/staff/:staffId', adminAuth, (req, res) => {
  try {
    const sid = String(req.params.staffId);
    const Y = Number(req.query.year) || YEAR;

    const s = db.prepare('SELECT id, COALESCE(real_name,name) nm, is_cp, roster_seq FROM staff WHERE id=?').get(sid);
    if (!s) return res.status(404).json({ error: '人员不存在' });

    const q = db.prepare('SELECT * FROM leave_quota WHERE staff_id=? AND year=?').get(sid, Y) || {};

    // 全部记录（含作废，管理员要看全貌；前端区分显示）
    const records = db.prepare(`
      SELECT id, leave_type, start_date, end_date, days, status, source,
             relief_note, cancel_reason, reject_reason, created_by, created_at
      FROM leave_records
      WHERE staff_id=? AND quota_year=?
      ORDER BY start_date DESC, id DESC
    `).all(sid, Y);

    const ACTIVE = ['verified','locked','reported','released'];
    const byType = {};
    for (const r of records) {
      if (!ACTIVE.includes(r.status)) continue;
      byType[r.leave_type] = (byType[r.leave_type] || 0) + r.days;
    }

    const LT = [
      { name: '年休',   col: 'annual_total' },
      { name: '育儿假', col: 'parental_total' },
      { name: '陪产假', col: 'paternity_total' },
      { name: '婚假',   col: 'marriage_total' },
    ];
    const lines = LT.map(t => {
      const total = Number(q[t.col] || 0);
      const used = Math.round((byType[t.name] || 0) * 10) / 10;
      return { name: t.name, total, used,
               left: Math.round((total - used) * 10) / 10,   // 负数保留（休超要看真实数）
               // left_show：页面展示用，额度为 0 时不能显示 -5.5（老韩：额度用完就写"已用完"）
               left_show: total > 0 ? Math.max(0, total - used) : 0,
               used_up: total > 0 && used >= total,
               no_quota: total <= 0,
               over: total > 0 && used > total };
    }).filter(x => x.total > 0 || x.used > 0);

    // 缺口提示（老韩 2026-11-26）：
    // 车间总表有额度、但明细记录不够时，前端显示「缺N天记录」并给编辑按钮，
    // 让管理员把漏记的天数补上，而不是让数字凭空对不上。
    // 只对年休做缺口提示——其他假别不一定全部休完，缺是正常的。
    // 2026-11-26 晚补充：非年休假别也要能从这里补（刘雪龙婚假剩2天要补）。
    //   所以 gaps 里除了年休，还带上「有额度但已休未满」的其他假别，
    //   只是标记 kind:'annual' / 'other' 供前端区分措辞。
    const gaps = [];
    for (const l of lines) {
      const lack = Math.round((l.total - l.used) * 10) / 10;
      if (lack > 0) {
        gaps.push({
          leave_type: l.name,
          lack, total: l.total, used: l.used,
          kind: l.name === '年休' ? 'annual' : 'other',
        });
      }
    }

    // 可编辑的假别清单（老韩 2026-11-26）：
    // 编辑面板的假别下拉不能写死，要按这个人实际有的额度动态给。
    // leave_options = 有额度的假别（total>0 或已休>0），前端只列这些。
    // 补录时如果选了一个没额度的假别（比如临时病假），后端也允许——病假事假本来就没额度。
    const leave_options = lines.map(l => ({
      name: l.name, total: l.total, used: l.used, left: l.left, over: l.over,
    }));
    // 无额度的假别也要能补（病假/事假/丧假天数不进额度账，但记录要留）
    for (const t of ['病假','事假','丧假']) {
      if (!leave_options.find(x => x.name === t)) {
        const used = Math.round((byType[t] || 0) * 10) / 10;
        leave_options.push({ name: t, total: 0, used, left: 0, over: false, no_quota: true });
      }
    }

    res.json({
      year: Y,
      staff_id: sid,
      name: s.nm,
      is_cp: !!s.is_cp,
      seq: s.roster_seq,
      lines,
      gaps,
      leave_options,
      records,
    });
  } catch (e) {
    console.error('[leave] staff 明细失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// 给某条记录加/改备注（补录说明、休超原因等）
// PATCH /api/leave/:id/note  { note }
router.patch('/api/leave/:id/note', adminAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = String(req.body?.note ?? '').slice(0, 500);
    const r = db.prepare(`UPDATE leave_records SET relief_note=?, updated_at=datetime('now','+8 hours')
      WHERE id=?`).run(note, id);
    if (!r.changes) return res.status(404).json({ error: '记录不存在' });
    db.prepare(`INSERT INTO admin_logs (action, detail, operator) VALUES
      ('休假备注', ?, ?)`).run(`记录id${id} 备注：${note||'(清空)'}`, req.adminName || '管理员');
    res.json({ ok: true, id, note });
  } catch (e) {
    console.error('[leave] 备注失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// 补录一条休假记录（车间表漏记、历史遗留等人工补登）
// POST /api/leave/supplement  { staff_id, leave_type, start_date, end_date, days, note }
//
// 为什么单独一个接口不走申报流程：补录的是已发生的历史休假，
// 不走审批五步（没必要让别人再批一遍），直接 verified 生效。
// source='supplement' 便于和车间表导入(workshop)、组员申报(app)区分。
router.post('/api/leave/supplement', adminAuth, (req, res) => {
  try {
    const { staff_id, leave_type, start_date, end_date, days, note } = req.body || {};
    if (!staff_id || !leave_type || !start_date || !days) {
      return res.status(400).json({ error: '缺必填项：人员/假别/开始日期/天数' });
    }
    const d = Number(days);
    if (!(d > 0)) return res.status(400).json({ error: '天数必须大于 0' });

    const s = db.prepare('SELECT id, COALESCE(real_name,name) nm FROM staff WHERE id=?').get(String(staff_id));
    if (!s) return res.status(404).json({ error: '人员不存在' });

    const endD = end_date || start_date;
    if (endD < start_date) return res.status(400).json({ error: '结束日期不能早于开始日期' });

    const Y = Number(String(start_date).slice(0, 4)) || YEAR;

    // 同假别同开始日期的重复补录拦一下（防止连点两次）
    const dup = db.prepare(`SELECT id FROM leave_records
      WHERE staff_id=? AND leave_type=? AND start_date=? AND days=? AND status!='cancelled'`).get(String(staff_id), leave_type, start_date, d);
    if (dup) return res.status(409).json({ error: `已有相同记录（id=${dup.id}），未重复补录` });

    // 时间冲突检测（老韩 2026-11-26）：同一人一天只能有一种休假状态，
    // 年休和婚假不能重叠。以前这里不校验，导致王利平出现
    // 「年休 10-28~10-30」和「婚假 10-28~11-04」并存。
    const conflict = findLeaveConflict(staff_id, start_date, endD);
    if (conflict && !req.body?.force) {
      return res.status(409).json({
        error: descConflict(conflict) + '如确实需要并存（特殊情形），请勾选强制补录。',
        conflict: {
          id: conflict.id, leave_type: conflict.leave_type,
          start: conflict.start_date, end: conflict.end_date,
          days: conflict.days, status: conflict.status,
        },
      });
    }

    const info = db.prepare(`INSERT INTO leave_records
      (staff_id, leave_type, start_date, end_date, days, status, source, created_by, quota_year, relief_note)
      VALUES (?,?,?,?,?, 'verified', 'supplement', ?, ?, ?)`)
      .run(String(staff_id), leave_type, start_date, endD, d, req.adminName || '管理员', Y,
           String(note || '').slice(0, 500) || null);

    db.prepare(`INSERT INTO admin_logs (action, detail, operator) VALUES ('休假补录', ?, ?)`)
      .run(`${s.nm} ${leave_type} ${start_date}~${endD} ${d}天${note ? '（' + note + '）' : ''}`, req.adminName || '管理员');

    res.json({ ok: true, id: info.lastInsertRowid, year: Y });
  } catch (e) {
    console.error('[leave] 补录失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// 删除一条休假记录（补错了、录重了的清理入口）
// DELETE /api/leave/:id
router.delete('/api/leave/:id', adminAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const rec = db.prepare(`SELECT r.id, r.leave_type, r.start_date, r.end_date, r.days, r.staff_id,
        COALESCE(s.real_name,s.name) nm
      FROM leave_records r LEFT JOIN staff s ON CAST(s.id AS TEXT)=r.staff_id WHERE r.id=?`).get(id);
    if (!rec) return res.status(404).json({ error: '记录不存在' });

    db.prepare('DELETE FROM leave_records WHERE id=?').run(id);
    db.prepare(`INSERT INTO admin_logs (action, detail, operator) VALUES ('休假删除', ?, ?)`)
      .run(`${rec.nm} ${rec.leave_type} ${rec.start_date}~${rec.end_date} ${rec.days}天（id${id}）`, req.adminName || '管理员');
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[leave] 删除失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// 编辑一条已有记录（改假别/日期/天数/备注）
// PATCH /api/leave/:id
//   与 /note 分开：/note 只动备注，这个动业务字段，必须重做冲突检测。
router.patch('/api/leave/:id', adminAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const rec = db.prepare('SELECT * FROM leave_records WHERE id=?').get(id);
    if (!rec) return res.status(404).json({ error: '记录不存在' });

    const leave_type = req.body?.leave_type ?? rec.leave_type;
    const start_date = req.body?.start_date ?? rec.start_date;
    const end_date = req.body?.end_date ?? rec.end_date;
    const days = req.body?.days != null ? Number(req.body.days) : rec.days;

    if (!(days > 0)) return res.status(400).json({ error: '天数必须大于 0' });
    if (end_date < start_date) return res.status(400).json({ error: '结束日期不能早于开始日期' });

    // 改日期/假别就要重新检冲突（排除自己）
    const conflict = findLeaveConflict(rec.staff_id, start_date, end_date, id);
    if (conflict && !req.body?.force) {
      return res.status(409).json({
        error: descConflict(conflict) + '如确实需要并存（特殊情形），请勾选强制保存。',
        conflict: {
          id: conflict.id, leave_type: conflict.leave_type,
          start: conflict.start_date, end: conflict.end_date,
          days: conflict.days, status: conflict.status,
        },
      });
    }

    db.prepare(`UPDATE leave_records SET leave_type=?, start_date=?, end_date=?, days=?,
        updated_at=datetime('now','+8 hours') WHERE id=?`)
      .run(leave_type, start_date, end_date, days, id);

    db.prepare(`INSERT INTO admin_logs (action, detail, operator) VALUES ('休假修改', ?, ?)`)
      .run(`记录id${id}：${rec.leave_type} ${rec.start_date}~${rec.end_date} ${rec.days}天`
         + ` → ${leave_type} ${start_date}~${end_date} ${days}天`,
         req.adminName || '管理员');

    res.json({ ok: true, id });
  } catch (e) {
    console.error('[leave] 修改失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 休假记录时间冲突检测（老韩 2026-11-26）
//
// 起因：王利平同时存在「年休 10-28~10-30」和「婚假 10-28~11-04」，
// 同一人同一时段两种假别，逻辑上不成立，是管理员手工录入时没有校验造成的。
// 组员申报那条路（POST /api/leave/apply）本来就有重叠检测，
// 但管理员的补录/编辑没有 —— 这里补上，两边共用一套判断。
//
// 规则：同一人的有效记录（非作废/驳回/草稿），日期区间有任何重叠即冲突。
//   · 不区分假别：年休和婚假不能同时休，一天只能有一种状态
//   · excludeId：编辑时排除自己
//
// 返回 null = 无冲突；否则返回冲突记录对象。
// ══════════════════════════════════════════════════════════════
function findLeaveConflict(staffId, start, end, excludeId = null) {
  const sql = `
    SELECT id, leave_type, start_date, end_date, days, status FROM leave_records
    WHERE staff_id=? AND status NOT IN ('cancelled','rejected','draft')
      AND start_date <= ? AND end_date >= ?
      ${excludeId ? 'AND id != ?' : ''}
    ORDER BY start_date LIMIT 1
  `;
  const args = excludeId
    ? [String(staffId), end, start, excludeId]
    : [String(staffId), end, start];
  return db.prepare(sql).get(...args) || null;
}

// 把冲突记录翻译成人能读的一句话
function descConflict(c) {
  const STATUS_TXT = {
    submitted: '待审批', locked: '已批准', reported: '已报车场组',
    released: '已放行', verified: '已销假', cancel_pending: '撤销待批',
  };
  const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
  const st = STATUS_TXT[c.status] || c.status;
  const range = c.start_date === c.end_date ? md(c.start_date) : `${md(c.start_date)}-${md(c.end_date)}`;
  return `该员工已有「${c.leave_type} ${range}（${st}，${c.days}天）」，与本次日期重叠。`;
}

module.exports = router;
module.exports.isoWeekKey = isoWeekKey;
module.exports.buildQuota = buildQuota;

// ── 两周班表 + 休假人员（主页日历用）──────────────────────────
router.get('/api/shift/two-weeks', (req, res) => {
  try {
    // ⚠️ 不能用 new Date().getDay()：容器是 UTC，北京时间 00:00-08:00 期间 UTC 还是前一天，
    //    「本周一」会算成上一周，整个日历错位一周（2026-11-25 修）
    const todayStr = cstToday();
    const monStr = mondayOf(todayStr);
    const mon = new Date(monStr + 'T00:00:00');
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const weeks = [];
    for (let w = 0; w < 2; w++) {
      const weekMon = new Date(mon); weekMon.setDate(mon.getDate() + w * 7);
      const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekMon); d.setDate(weekMon.getDate() + i);
        const ds = fmt(d);
        const s = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds);
        days.push({ date: ds, shift: s ? s.shift : '' });
      }
      // 与本周有交集的所有休假记录（完整字段，前端画休假条）
      const rawLeaves = db.prepare(`
        SELECT l.id, s.real_name, l.leave_type, l.start_date, l.end_date, l.days, l.status
        FROM leave_records l JOIN staff s ON s.id = l.staff_id
        WHERE l.start_date <= ? AND l.end_date >= ?
          AND l.status NOT IN ('cancelled','rejected','draft')
        ORDER BY s.real_name, l.start_date
      `).all(fmt(weekSun), fmt(weekMon));

      // 实线/虚线统一由 computeLeavePending() 判定，与申报页 /api/shift/range 同一函数
      // （老韩 2026-11-25：「首页和申报假期的日历处理成一个」）
      const pendingById = new Map(
        computeLeavePending(rawLeaves).map(r => [r.id, r.pending])
      );
      rawLeaves.forEach(r => { r.pending = pendingById.get(r.id) ?? false; });

      // ── 合并相邻记录：同一人 + 同假别 + 状态相同 + 日期首尾相接/重叠 → 并成一条 ──
      const addDays = (ds, n) => {
        const [y,m,d] = ds.split('-').map(Number);
        const t = new Date(y, m-1, d + n);
        return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
      };
      const wStart = fmt(weekMon), wEnd = fmt(weekSun);
      const leaves = [];
      rawLeaves.forEach(r => {
        const prev = leaves[leaves.length - 1];
        if (prev && prev.real_name === r.real_name && prev.leave_type === r.leave_type
            && prev.pending === r.pending
            && r.start_date <= addDays(prev.end_date, 1)) {
          // 紧挨着（或重叠）→ 延长前一条
          if (r.end_date > prev.end_date) prev.end_date = r.end_date;
          prev.days = (prev.days || 0) + (r.days || 0);
        } else {
          leaves.push({ ...r });
        }
      });
      // ── 裁到本周窗口内：只显示本周和下周，跨周部分切掉 ──
      // ── 尾部延伸：休假结束日之后紧跟的正休，也算休假（正休也是休假）──
      const shiftOf = (ds) => {
        const row = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds);
        return row ? row.shift : '';
      };
      leaves.forEach(lv => {
        lv.full_start = lv.start_date;
        lv.full_end   = lv.end_date;
        // 向后吃掉连续的正休（最多吃 3 天，防跑飞）
        let ext = lv.end_date, n = 0;
        while (n < 3) {
          const nx = addDays(ext, 1);
          if (shiftOf(nx) === '休息') { ext = nx; n++; } else break;
        }
        if (ext !== lv.end_date) {
          lv.end_date = ext;
          lv.restExtended = true;
        }
        const rawEnd = lv.end_date;   // 含正休延伸后的真实结束日
        if (lv.start_date < wStart) { lv.start_date = wStart; lv.clippedStart = true; }
        if (lv.end_date   > wEnd)   { lv.end_date   = wEnd;   lv.clippedEnd   = true; }
        lv.visibleEnd = lv.end_date;  // 窗口内可见的结束日
        lv.trueEnd = rawEnd;          // 真实结束日（可能超出窗口）
      });

      weeks.push({ week_start: wStart, week_end: wEnd, days, leaves });
    }
    res.json({ weeks });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ═══════════════ 留言墙 ═══════════════
// 老韩定：不审核、直接显示、后台能查。可以欢乐一点（"张飞：今天想吃牛肉面"）

// 取留言（前台，只返回公开字段，不含真实身份）
router.get('/api/wall/posts', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const rows = db.prepare(`
      SELECT id, nick, content, image, created_at FROM wall_posts
      WHERE is_hidden = 0 ORDER BY id DESC LIMIT ?
    `).all(limit);
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 发留言（前台）— 需登录身份，但不对外显示
// 支持纯文字 / 文字+图片（multipart，字段名 image）
router.post('/api/wall/posts', wallUpload.single('image'), async (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const { nick, content } = req.body || {};
    const n = String(nick || '').trim();
    const c = String(content || '').trim();
    const hasImg = !!req.file;
    if (!n) return res.status(400).json({ error: '请填名字' });
    if (!c && !hasImg) return res.status(400).json({ error: '写点内容或传张图' });
    if (n.length > 12) return res.status(400).json({ error: '名字最多 12 字' });
    if (c.length > 200) return res.status(400).json({ error: '留言最多 200 字' });

    // 留真身（后台可查）
    const me = db.prepare('SELECT real_name, name FROM staff WHERE id = ? LIMIT 1').get(String(sid));

    // 防刷：同一人 1 分钟只能发 1 条
    const recent = db.prepare(`
      SELECT id FROM wall_posts WHERE staff_id = ?
        AND created_at >= datetime('now','localtime','-1 minute')
    `).get(sid);
    if (recent) return res.status(429).json({ error: '慢一点，1 分钟后再发' });

    // ── 有图就压缩落盘 ──
    let imagePath = null;
    if (hasImg) {
      fs.mkdirSync(WALL_IMG_DIR, { recursive: true });
      const fname = `w${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      try {
        await sharp(req.file.buffer)
          .rotate()                                  // 按 EXIF 摆正（手机竖拍）
          .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(path.join(WALL_IMG_DIR, fname));
        imagePath = '/wall-images/' + fname;
      } catch (e) {
        return res.status(400).json({ error: '图片处理失败，换一张试试' });
      }
    }

    const info = db.prepare(`
      INSERT INTO wall_posts (nick, content, staff_id, real_name, image)
      VALUES (?,?,?,?,?)
    `).run(n, c, String(sid), me ? (me.real_name || me.name) : null, imagePath);

    res.json({ ok: true, id: info.lastInsertRowid, image: imagePath });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 管理后台：查留言（含真实身份）
router.get('/api/wall/admin/posts', adminAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, nick, content, image, real_name, staff_id, is_hidden, created_at
      FROM wall_posts ORDER BY id DESC LIMIT 200
    `).all();
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 管理后台：隐藏/恢复留言
router.post('/api/wall/admin/:id/hide', adminAuth, (req, res) => {
  try {
    const hide = req.body?.hidden ? 1 : 0;
    db.prepare('UPDATE wall_posts SET is_hidden = ? WHERE id = ?').run(hide, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ═══════════════ 休假申请（组员填报）═══════════════
// 老韩 2026-11-23 定：
//   · 组员自己填 → 管理员审
//   · 界面填日历（选起止日期），系统按班次自动算扣几天
// 扣减口径（老韩原话）：白=1、夜=1、夜早连上=1.5、白夜=2、正休=0

// 按起止日期 + 班次表，算出这段休假实际扣几天年休
function calcLeaveDays(startDate, endDate, leaveType) {
  const rows = db.prepare(`
    SELECT date, shift FROM shift_calendar
    WHERE date >= ? AND date <= ? ORDER BY date
  `).all(startDate, endDate);

  // 折算算法本体在 server/leaveDays.js（纯函数，有单测 npm test）。
  // 这里只负责取班次。改折算规则去那边改，别在这个文件里另写一份。
  return calcDeductFromShifts(rows);
}

// 预览：选完日期先看扣几天（不落库）
router.get('/api/leave/preview', (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const { start, end, type } = req.query;
    if (!start || !end) return res.status(400).json({ error: '缺起止日期' });
    if (start > end) return res.status(400).json({ error: '结束日期不能早于开始' });

    const calc = calcLeaveDays(start, end, type || '年休');

    // 顺带告诉前端：本人当前余额够不够
    const q = db.prepare('SELECT annual_total FROM leave_quota WHERE staff_id=? AND year=?')
      .get(String(sid), new Date().getFullYear());
    const used = db.prepare(`
      SELECT COALESCE(SUM(days),0) AS s FROM leave_records
      WHERE staff_id=? AND leave_type='年休' AND quota_year=?
        AND status NOT IN ('cancelled','rejected','draft')
    `).get(String(sid), new Date().getFullYear());

    const total = q ? q.annual_total : 0;
    const left = Math.round((total - used.s) * 10) / 10;

    res.json({
      days: calc.days,
      detail: calc.detail,
      warning: calc.warning || null,
      annual_total: total,
      annual_used: used.s,
      annual_left: left,
      enough: calc.days <= left,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 提交申请
router.post('/api/leave/apply', (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const { start, end, type, note } = req.body || {};
    if (!start || !end) return res.status(400).json({ error: '缺起止日期' });
    if (start > end) return res.status(400).json({ error: '结束日期不能早于开始' });

    // 过去的时间不能申报（前端已拦，这里防绕过）
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    if (start < todayStr) {
      return res.status(400).json({ error: `不能申报过去的日期（今天 ${todayStr}）` });
    }

    const lt = type || '年休';
    const calc = calcLeaveDays(start, end, lt);
    if (calc.days === 0 && lt === '年休') {
      return res.status(400).json({ error: '这段日期全是正休，不用扣年休；换一段吧' });
    }
    if (!calc.days || calc.days <= 0) return res.status(400).json({ error: '这段日期算不出扣假天数' });

    // 年份取开始日期那年
    const year = Number(start.slice(0, 4));

    // 查重：同一人时间重叠的未取消记录
    // 注意：这条规则会挡住「已经报过、又重新报一遍」的情况 —— 这是对的（防重复扣假），
    // 但报错必须说清楚「你已有一条 XX~XX 的记录」，否则组员看不懂，
    // 会以为系统坏了反复重试（2026-11-25 韩思成实例：库里已有拆分的
    // 12-03~12-06 + 12-07~12-10，他重报整段被拒，看不到任何提示）。
    const dup = db.prepare(`
      SELECT id, start_date, end_date, status, days FROM leave_records
      WHERE staff_id=? AND status NOT IN ('cancelled','rejected','draft')
        AND start_date <= ? AND end_date >= ? LIMIT 1
    `).get(String(sid), end, start);
    if (dup) {
      const STATUS_TXT = {
        submitted: '待审批', locked: '已批准', reported: '已报车场组',
        released: '已放行', verified: '已销假', cancel_pending: '撤销待批',
      };
      const st = STATUS_TXT[dup.status] || dup.status;
      const md2 = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
      return res.status(400).json({
        error: `你已有一条休假记录（${md2(dup.start_date)}-${md2(dup.end_date)}，${st}，${dup.days}天），`
             + `与本次申报重叠。如需修改请先撤销那条，或直接找班组长调整。`,
        duplicate: { id: dup.id, start: dup.start_date, end: dup.end_date, status: dup.status },
      });
    }

    // 余额校验（仅年休）
    if (lt === '年休') {
      const q = db.prepare('SELECT annual_total FROM leave_quota WHERE staff_id=? AND year=?').get(String(sid), year);
      const used = db.prepare(`
        SELECT COALESCE(SUM(days),0) AS s FROM leave_records
        WHERE staff_id=? AND leave_type='年休' AND quota_year=?
          AND status NOT IN ('cancelled','rejected','draft')
      `).get(String(sid), year);
      const total = q ? q.annual_total : 0;
      const left = total - used.s;
      if (calc.days > left) {
        return res.status(400).json({
          error: `余额不够：这次要扣 ${calc.days} 天，只剩 ${Math.round(left * 10) / 10} 天`,
        });
      }
    }

    const me = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(String(sid));
    const who = me ? (me.real_name || me.name) : null;

    const info = db.prepare(`
      INSERT INTO leave_records
        (staff_id, leave_type, start_date, end_date, days, status, quota_year, source, created_by, updated_at)
      VALUES (?,?,?,?,?,'submitted',?,'app',?,datetime('now','localtime'))
    `).run(String(sid), lt, start, end, calc.days, year, who);

    // ── 通知「四组办事情」群（老韩 2026-11-25：有人提交申报就在这群提醒）──
    // 不 await，推送失败不能影响提交本身
    notifyLeaveOps('submit', {
      who, leaveType: lt, start, end,
      calendarDays: calc.detail.length, actualDays: calc.days,
    }).catch(e => console.error('[leave] 提交通知失败:', e.message));

    res.json({ ok: true, id: info.lastInsertRowid, days: calc.days, detail: calc.detail });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 我的申请列表（带完整状态进度）
router.get('/api/leave/mine', (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    // 作废/驳回的记录默认不显示（老韩 2026-11-25：组员端不显示作废记录，管理员能看到）。
    // 原因：班组长手工录入又被作废的记录会和新提交的同日期记录并列，
    // 组员看到「已撤销」容易误以为是自己的申请被撤了。
    // ?include_void=1 时仍返回（前端「查看已撤销」用）。
    const includeVoid = String(req.query.include_void || '') === '1';
    const voidFilter = includeVoid ? '' : ` AND status NOT IN ('cancelled','rejected')`;
    const rows = db.prepare(`
      SELECT id, leave_type, start_date, end_date, days, status, source,
             reject_reason, cancel_reason, oa_checked_by, oa_checked_at, oa_mismatch,
             created_at, updated_at
      FROM leave_records WHERE staff_id=?${voidFilter}
      ORDER BY start_date DESC LIMIT 50
    `).all(String(sid));

    // 状态进度定义：每一步 [{key, label, done, current}]
    const STEPS = [
      ['submitted', '已提交'],
      ['locked', '已批准'],
      ['reported', '已报车场组'],
      ['released', '已放行'],
      ['verified', '已销假'],
    ];
    const ORDER = STEPS.map(s => s[0]);

    // 历史数据（车间月报表导入）状态是 verified，但它们不是走过流程的申请，
    // 不该显示进度条和撤销按钮 —— 用 source 区分
    const isAppFlow = (src) => src === 'app' || src === 'manual';

    const records = rows.map(r => {
      const st = r.status;
      let steps = STEPS.map(([key, label]) => ({ key, label, done: false, current: false }));
      let terminal = null;  // rejected / cancelled / cancel_pending

      if (st === 'rejected') {
        terminal = { type: 'rejected', label: '已驳回', reason: r.reject_reason };
      } else if (st === 'cancelled') {
        terminal = { type: 'cancelled', label: '已撤销', reason: r.cancel_reason };
      } else if (st === 'cancel_pending') {
        terminal = { type: 'cancel_pending', label: '撤销待批', reason: r.cancel_reason };
        // 撤销待批时，进度停在已批准那一步
        const idx = ORDER.indexOf('locked');
        steps.forEach((s, i) => { s.done = i <= idx; });
        steps[idx].current = true;
      } else {
        const idx = ORDER.indexOf(st);
        if (idx >= 0) {
          // 走完全流程（verified/released/reported）= 全部点亮，最后一步为当前
          steps.forEach((s, i) => { s.done = i <= idx; });
          steps[idx].current = true;
        }
      }

      return {
        id: r.id,
        leave_type: r.leave_type,
        start_date: r.start_date,
        end_date: r.end_date,
        days: r.days,
        status: st,
        source: r.source,
        is_app_flow: isAppFlow(r.source),      // false = 历史台账，不显示进度/撤销
        steps,
        terminal,
        // 只有走申请流程、且还能撤的状态才给撤销
        can_cancel: isAppFlow(r.source) &&
          ['submitted', 'locked', 'reported', 'released'].includes(st),
        oa_checked: !!r.oa_checked_at,
        oa_mismatch: r.oa_mismatch,
        created_at: r.created_at,
      };
    });

    res.json({ records });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 组员：申请撤销已批准的休假（需管理员再批一次）
router.post('/api/leave/:id/cancel-request', (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const id = Number(req.params.id);
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) return res.status(400).json({ error: '请填写撤销原因' });

    const rec = db.prepare('SELECT * FROM leave_records WHERE id=?').get(id);
    if (!rec) return res.status(404).json({ error: '记录不存在' });
    if (String(rec.staff_id) !== String(sid)) return res.status(403).json({ error: '只能撤销自己的申请' });

    // 已提交未批的直接撤掉
    if (rec.status === 'submitted') {
      db.prepare(`UPDATE leave_records SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(reason, id);
      // 通知「四组办事情」群（留痕，管理员不用处理）
      const me0 = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(String(sid));
      notifyLeaveOps('cancel_direct', {
        who: me0 ? (me0.real_name || me0.name) : null,
        leaveType: rec.leave_type, start: rec.start_date, end: rec.end_date,
      }).catch(e => console.error('[leave] 撤销通知失败:', e.message));
      return res.json({ ok: true, status: 'cancelled', need_approval: false });
    }
    // 已批的走撤销申请
    if (['locked', 'reported', 'released'].includes(rec.status)) {
      db.prepare(`UPDATE leave_records SET status='cancel_pending', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(reason, id);
      // 通知「四组办事情」群（管理员要处理）
      const me = db.prepare('SELECT real_name, name FROM staff WHERE id=?').get(String(sid));
      notifyLeaveOps('cancel', {
        who: me ? (me.real_name || me.name) : null,
        leaveType: rec.leave_type, start: rec.start_date, end: rec.end_date,
        reason,
      }).catch(e => console.error('[leave] 撤销通知失败:', e.message));
      return res.json({ ok: true, status: 'cancel_pending', need_approval: true });
    }
    res.status(400).json({ error: `当前状态（${rec.status}）不能撤销` });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 管理员：待审列表（含余额提示）
router.get('/api/leave/pending', adminAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT l.id, l.staff_id, s.real_name, s.name, l.leave_type,
             l.start_date, l.end_date, l.days, l.status, l.created_at,
             l.cancel_reason, l.quota_year
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.status IN ('submitted','cancel_pending')
      ORDER BY CASE l.status WHEN 'submitted' THEN 0 ELSE 1 END, l.created_at
    `).all();

    // 为每条附上该人当年年休余额（管理员审批参考，不拦截）
    const records = rows.map(r => {
      const year = r.quota_year || Number(String(r.start_date).slice(0, 4));
      let balance = null;
      if (r.leave_type === '年休') {
        const q = db.prepare('SELECT annual_total FROM leave_quota WHERE staff_id=? AND year=?')
          .get(String(r.staff_id), year);
        const usedRow = db.prepare(`
          SELECT COALESCE(SUM(days),0) AS s FROM leave_records
          WHERE staff_id=? AND leave_type='年休' AND quota_year=?
            AND status NOT IN ('cancelled','rejected','draft') AND id != ?
        `).get(String(r.staff_id), year, r.id);
        const total = q ? q.annual_total : 0;
        const used = usedRow.s;
        const left = Math.round((total - used) * 10) / 10;
        balance = {
          total,
          used,
          left,
          need: r.days,
          after: Math.round((left - r.days) * 10) / 10,
          enough: left >= r.days,
        };
      }
      return { ...r, balance };
    });

    res.json({ records });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 管理员：批准 / 驳回 / 撤销批准
router.post('/api/leave/:id/review', adminAuth, (req, res) => {
  try {
    const { action, reason } = req.body || {};
    const id = Number(req.params.id);
    const rec = db.prepare('SELECT * FROM leave_records WHERE id=?').get(id);
    if (!rec) return res.status(404).json({ error: '记录不存在' });

    if (action === 'approve') {
      if (rec.status !== 'submitted') return res.status(400).json({ error: '该记录不是待审状态' });
      db.prepare(`UPDATE leave_records SET status='locked', updated_at=datetime('now','localtime') WHERE id=?`).run(id);
      return res.json({ ok: true, status: 'locked' });
    }

    if (action === 'reject') {
      if (rec.status !== 'submitted') return res.status(400).json({ error: '该记录不是待审状态' });
      db.prepare(`UPDATE leave_records SET status='rejected', reject_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(String(reason || '未说明'), id);
      return res.json({ ok: true, status: 'rejected' });
    }

    // 同意撤销：恢复到休假前（cancelled）
    if (action === 'approve-cancel') {
      if (rec.status !== 'cancel_pending') return res.status(400).json({ error: '该记录没有待批的撤销请求' });
      db.prepare(`UPDATE leave_records SET status='cancelled', updated_at=datetime('now','localtime') WHERE id=?`).run(id);
      return res.json({ ok: true, status: 'cancelled' });
    }

    // 拒绝撤销：恢复到 locked
    if (action === 'reject-cancel') {
      if (rec.status !== 'cancel_pending') return res.status(400).json({ error: '该记录没有待批的撤销请求' });
      db.prepare(`UPDATE leave_records SET status='locked', cancel_reason=NULL, reject_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(String(reason || '撤销未被同意'), id);
      return res.json({ ok: true, status: 'locked' });
    }

    res.status(400).json({ error: 'action 只能是 approve / reject / approve-cancel / reject-cancel' });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 申报窗口（老韩 2026-11-25 定）
//   「下周的申报日期按周一至周三来算，截止时间是周三的17:00截止」
//   即：本周一 00:00 ~ 本周三 17:00 是申报下周休假的时间窗。
//   过点后老韩要联系车场组班组长报下周休假人员名单。
// ══════════════════════════════════════════════════════════════
const APPLY_DEADLINE_HOUR = 17;

function getApplyWindow(todayStr) {
  const today = todayStr || cstToday();
  const monday = mondayOf(today);
  const wednesday = addDaysStr(monday, 2);
  const deadline = `${wednesday} ${String(APPLY_DEADLINE_HOUR).padStart(2, '0')}:00`;
  const nextMon = addDaysStr(monday, 7);
  const nextSun = addDaysStr(nextMon, 6);

  // 当前上海时间：用 formatToParts 直接取，别 new Date(toLocaleString(...))（见文件顶部说明）
  const nowStr = cstNow().dt;

  const open = today <= wednesday && nowStr <= deadline;
  const expired = nowStr > deadline;

  return {
    monday, wednesday, deadline,
    now: nowStr,
    open,               // 窗口是否还开着
    expired,            // 是否已过截止
    target_week_start: nextMon,   // 申报的下周
    target_week_end: nextSun,
    weekday: (new Date(today + 'T00:00:00').getDay() + 6) % 7,  // 0=周一
  };
}

// 申报窗口状态（申报页顶部展示）
router.get('/api/leave/apply-window', (req, res) => {
  try {
    res.json(getApplyWindow());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});


// ══════════════════════════════════════════════════════════════
// 下周休假申报：汇总 + 狗蛋（钉钉群机器人）催报
//   老韩口述流程（2026-11-25）：
//     「周三确认下周休假情况 → 提醒其他人我已经在跟车场组沟通下周休假顶班人员了，
//       还有需要休假的请在这个窗口期跟我联系（用狗蛋在钉钉群发消息提醒并设定截止日期）
//       → 截止后联系车场组班组长告诉他下周的休假人员」
//   所以这里做两件事：
//     1. GET  /api/leave/next-week  —— 生成下周休假名单（发车场组用的底稿）
//     2. POST /api/leave/nudge      —— 让狗蛋在钉钉群发催报消息（带截止时间）
//   只发提醒，不做自动审批；名额/冲突由老韩人工判断。
// ══════════════════════════════════════════════════════════════

// 下周休假名单（管理员）
router.get('/api/leave/next-week', adminAuth, (req, res) => {
  try {
    const win = getApplyWindow();
    const wkStart = req.query.week || win.target_week_start;
    const wkEnd = addDaysStr(wkStart, 6);

    const list = db.prepare(`
      SELECT l.id, l.staff_id, s.real_name, l.leave_type, l.start_date, l.end_date,
             l.days, l.status
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status NOT IN ('cancelled','rejected','draft')
      ORDER BY l.start_date, s.real_name
    `).all(wkEnd, wkStart);

    // 按天统计人数，标出超名额的日期
    const perDay = {};
    for (let i = 0; i < 7; i++) {
      const d = addDaysStr(wkStart, i);
      perDay[d] = list.filter(r => r.start_date <= d && r.end_date >= d);
    }
    const overDays = Object.entries(perDay)
      .filter(([, arr]) => arr.length > DAILY_QUOTA)
      .map(([d, arr]) => ({ date: d, count: arr.length }));

    res.json({
      week_start: wkStart, week_end: wkEnd,
      quota: DAILY_QUOTA,
      records: computeLeavePending(list),
      per_day: Object.entries(perDay).map(([date, arr]) => ({
        date, count: arr.length, names: arr.map(x => x.real_name),
        over: arr.length > DAILY_QUOTA,
        // 班次：管理页日历要显示「周几 + 日期 + 班次」，光看日期分不清白夜早
        shift: db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(date)?.shift || '',
      })),
      over_days: overDays,
      window: win,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 「四组办事情」群通知（老韩 2026-11-25 定）
//   这个群只发【管理员/车场组协调】相关的事，不发全体组员的通知：
//     · 有人提交申报 → 提醒管理员有新的待审
//     · 有人申请撤销 → 提醒管理员要处理
//     · 周二 → 提醒管理员与车场组确认顶班人员
//   周一/周三的申报预告和提醒发「乘务四组」大群（crewMain），不在这里。
// 所有通知都走 sendToChannel('crewOps', ...)，配置缺失时只记日志不报错。
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// 钉钉群 @ 人（官方文档确认 Webhook 方式支持）
//   来源：help.dingtalk.io「消息类型和数据格式」
//   Text 类型：{ "at": { "atMobiles": ["180xxxxxx"], "isAtAll": false }, "text": {...} }
//   ⚠️ 关键：正文里必须也写出 @手机号，只给 at 字段不生效（文档原文：
//      「消息内容 content 中要带上"@手机号"，跟 atMobiles 参数结合使用，才有@效果」）
//   注意：Webhook 不能发图片（图片 Image 类型 Webhook 方式 ❌），
//        但 @ 是 Text/Markdown 消息内部的字段，跟图片限制无关 —— 两件事别混。
//
// 「四组办事情」群是骨干+管理群，通知要 @ 到三位管理人员（老韩 2026-11-25 定）：
//   韩颖、艾凌风、胡鑫。手机号全号，英文逗号分隔填 LEAVE_OPS_AT_MOBILES。
//
// ── 为什么只能靠手机号（2026-11-25 实测封档，别再重试别的路子）──
// 钉钉官方口径：Webhook 方式 @ 人只有两个入口 —— atMobiles（手机号）和 atUserIds（userId）。
// 三条路都试过，只有手机号行：
//   ① atUserIds = 工号（3743）         → 三条测试全部 @ 不到
//   ② atUserIds = 加密串（bo1feun）     → 三条测试全部 @ 不到
//   ③ atMobiles = 手机号               → ✓ 生效（韩颖/艾凌风/胡鑫均已验证）
// 所有失败情况钉钉都返回 errcode:0，静默失败，看不出区别 —— 只能靠群成员肉眼确认。
//
// 背景：公司出于防诈隐藏了组织内手机号，老韩看不到尾号，无法核对。
// 实测艾凌风 `17386147513` @ 不到、`15172380822` 才行，
// 说明「本人告诉你的号码」≠「钉钉绑定的号码」，每次换人必须让本人确认真的被 @ 到。
//
// 结论：手机号配在 LEAVE_OPS_AT_MOBILES，留空则全部不 @（代码自动退化）。
const OPS_AT_MOBILES = String(process.env.LEAVE_OPS_AT_MOBILES || '')
  .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

const AT_TEXT = OPS_AT_MOBILES.map(m => `@${m}`).join(' ');
const AT_OPTS = OPS_AT_MOBILES.length ? { atMobiles: OPS_AT_MOBILES } : null;

async function notifyLeaveOps(kind, info = {}) {
  const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
  // 时间要按北京时间取，不能用 toLocaleString().slice(-5)：
  //   toLocaleString('zh-CN') → "2026/11/25 15:37:10"，取后 5 位是 "37:10"（秒:秒），
  //   曾因此把 15:37 显示成 37:10。必须显式取 hour/minute。
  const nowParts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => (nowParts.find(p => p.type === t) || {}).value || '00';
  const hhmm = `${get('hour')}:${get('minute')}`;

  let text = '';
  // @ 到管理者：正文必须带 "@手机号" 字形，配合 at.atMobiles 才生效
  const atText = AT_TEXT ? `${AT_TEXT} ` : '';
  if (kind === 'submit') {
    text = [
      `【新申报待审】${atText}`,
      `${info.who || '有人'} 提交了休假申报`,
      `${md(info.start)}-${md(info.end)}　${info.leaveType || '年休'}`,
      `共${info.calendarDays}天，实际扣${info.actualDays}天`,
      `提交时间 ${hhmm}`,
    ].join('\n');
  } else if (kind === 'cancel') {
    text = [
      `【撤销待批】${atText}`,
      `${info.who || '有人'} 申请撤销休假`,
      `${md(info.start)}-${md(info.end)}　${info.leaveType || '年休'}`,
      info.reason ? `原因：${info.reason}` : '',
      `申请时间 ${hhmm}`,
    ].filter(Boolean).join('\n');
  } else if (kind === 'cancel_direct') {
    // 未批准的直接撤销，不需要管理员处理，但留个记录
    text = [
      `【已撤销】`,
      `${info.who || '有人'} 撤销了未批准的申报`,
      `${md(info.start)}-${md(info.end)}　${info.leaveType || '年休'}`,
    ].join('\n');
  } else {
    return;
  }

  await sendToChannel('crewOps', text, { title: '休假申报', at: AT_OPTS });
  // 记一条成功日志：之前只有失败才打日志，导致「提交了但群里没收到」
  // 这种静默失败无从排查（推送结果被 catch 吞掉看不到）。
  console.log(`[leave] 已推送「四组办事情群」${kind}: ${info.who || ''} ${info.start || ''}`);
}

// ══════════════════════════════════════════════════════════════
// 周二提醒管理员与车场组确认顶班（老韩 2026-11-25 定）
//   发「四组办事情」群，不发大群。
//   内容：下周三截止后就要报车场组，现在得开始确认顶班人员了 + 当前已报名单。
// ══════════════════════════════════════════════════════════════
router.post('/api/leave/tuesday-confirm', adminAuth, async (req, res) => {
  try {
    const win = getApplyWindow();
    const wkStart = win.target_week_start;
    const wkEnd = addDaysStr(wkStart, 6);

    const list = db.prepare(`
      SELECT s.real_name, l.leave_type, l.start_date, l.end_date, l.status
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status NOT IN ('cancelled','rejected','draft')
      ORDER BY l.start_date
    `).all(wkEnd, wkStart);

    const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
    const lines = [
      `【顶班确认提醒】${AT_TEXT ? `${AT_TEXT} ` : ''}`,
      `下周（${md(wkStart)}-${md(wkEnd)}）休假 ${list.length} 人：`,
    ];
    if (list.length === 0) {
      lines.push(`暂无申报`);
    } else {
      list.forEach(r => {
        const st = r.status === 'submitted' ? '待审' : (r.status === 'cancel_pending' ? '撤销待批' : '已批');
        lines.push(`· ${r.real_name} ${md(r.start_date)}-${md(r.end_date)} ${r.leave_type}（${st}）`);
      });
    }
    lines.push('');
    lines.push(`明天 17:00 申报截止，截止后需报车场组班组长协调顶班，请今天先与车场组确认。`);
    const text = lines.join('\n');

    if (req.body?.dry_run) return res.json({ ok: true, dry_run: true, text, count: list.length });

    const r = await sendToChannel('crewOps', text, { title: '顶班确认', at: AT_OPTS });
    res.json({ ok: r?.errcode === 0 || r?.skipped, text, count: list.length, result: r });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// 让狗蛋在钉钉群发催报消息（带下周休假日历图）
router.post('/api/leave/nudge', adminAuth, async (req, res) => {
  try {
    const win = getApplyWindow();
    const wkStart = req.body?.week || win.target_week_start;
    const wkEnd = addDaysStr(wkStart, 6);
    const withImage = req.body?.with_image !== false;   // 默认带图

    // 下周班次（画日历用）
    const shiftRows = db.prepare(`
      SELECT date, shift FROM shift_calendar WHERE date >= ? AND date <= ? ORDER BY date
    `).all(wkStart, wkEnd);

    // 下周休假
    const rawLeaves = db.prepare(`
      SELECT l.staff_id, s.real_name, l.leave_type, l.start_date, l.end_date, l.status
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status NOT IN ('cancelled','rejected','draft')
      ORDER BY l.start_date, s.real_name
    `).all(wkEnd, wkStart);
    const pendingById = new Map(computeLeavePending(rawLeaves).map((r, i) => [i, r.pending]));
    const leaves = rawLeaves.map((r, i) => ({
      name: r.real_name, type: r.leave_type,
      start_date: r.start_date, end_date: r.end_date,
      pending: pendingById.get(i) ?? false,
    }));

    // ── 消息文案（老韩 2026-11-25 定稿，照抄）──
    //   两次推送，文案不同：
    //   ① 周一预告（mode=preview）：不提小时，只报截止日期
    //      每周申报窗口「周一至周三下午17:00」
    //      下周休假申报截止在11月25日 17:00，请及时报轮值申报。
    //      已申报人员请核对休假日期。
    //   ② 周三提醒（mode=remind）：带实时剩余时长
    //      下周休假申报截止在11月25日 17:00，还剩5小时，请及时报轮值申报。
    //   两条都附乘务系统网址。
    const mode = req.body?.mode === 'preview' ? 'preview' : 'remind';
    const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;

    // 距离截止还剩多久（实时算）
    // 向上取整到小时：宁可多说不少说，避免「显示还剩1小时其实只剩20分钟」
    // 周三 12:00 发时，17:00 − 12:00 = 5小时00分 → 「还剩5小时」
    let remainText = '';
    const nowMs = Date.now();
    const deadlineStr = `${win.wednesday}T${String(APPLY_DEADLINE_HOUR).padStart(2, '0')}:00:00+08:00`;
    const remainMs = new Date(deadlineStr).getTime() - nowMs;
    if (remainMs > 0) {
      const totalMins = Math.ceil(remainMs / 60000);
      const hours = Math.ceil(totalMins / 60);
      if (totalMins <= 1) remainText = `还剩不到1分钟`;
      else if (totalMins < 60) remainText = `还剩${totalMins}分钟`;
      else remainText = `还剩${hours}小时`;
    } else {
      remainText = `已过截止时间`;
    }

    const BASE_URL = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
    const deadlineText = `${md(win.wednesday)} ${APPLY_DEADLINE_HOUR}:00`;
    const lines = [
      `每周申报窗口「周一至周三下午17:00」`,
      mode === 'preview'
        // 周一预告：不提小时（此时距截止还有两天多，说「53小时」没意义）
        ? `下周休假申报截止在${deadlineText}，请及时报轮值申报。`
        : `下周休假申报截止在${deadlineText}，${remainText}，请及时报轮值申报。`,
      `已申报人员请核对休假日期。`,
      BASE_URL,
    ];
    const text = lines.join('\n');

    if (req.body?.dry_run) {
      return res.json({ ok: true, dry_run: true, text, leaves, days: shiftRows });
    }

    // 生成图（钉钉 Webhook 不支持 image 消息，只能 markdown 嵌图）
    let imageUrl = null;
    if (withImage) {
      try {
        const { renderLeaveCalendarChart, checkChartHasText } = require('../leaveChart');
        const png = await renderLeaveCalendarChart({
          week_start: wkStart, week_end: wkEnd,
          days: shiftRows, leaves, quota: DAILY_QUOTA,
        });
        // 自检：容器缺中文字体时会渲染成方格/空白，宁可退回纯文本也不发破图
        const chk = await checkChartHasText(png);
        if (!chk.ok) {
          console.error(`[leave] 申报图自检失败，退回纯文本：${chk.reason}`);
        } else {
          fs.mkdirSync(CHART_DIR, { recursive: true });
          const fname = `leave-${wkStart}.png`;
          fs.writeFileSync(path.join(CHART_DIR, fname), png);
          const BASE = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
          imageUrl = `${BASE}/leave-charts/${fname}?v=${Date.now()}`;
        }
      } catch (e) {
        console.error('[leave] 生成申报图失败，退回纯文本:', e.message);
      }
    }

    // markdown 消息（支持嵌图）；无图则用 text
    // 发到「乘务四组」大群（老韩 2026-11-25：周一/周三申报提醒发全体组员群）
    if (imageUrl) {
      const mdLines = [`![下周休假申报](${imageUrl})`, '', text];
      await sendGroupPush(mdLines.join('\n'), { markdown: true, title: '下周休假申报', channel: 'crewMain' });
    } else {
      await sendGroupPush(text, { channel: 'crewMain' });
    }

    res.json({ ok: true, mode, text, image_url: imageUrl, week_start: wkStart, week_end: wkEnd });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});


// ══════════════════════════════════════════════════════════════
// 休假「实线 / 虚线」判定的唯一来源
//   首页 /api/shift/two-weeks 与 申报页 /api/shift/range 都调它。
//   老韩 2026-11-25：「首页和申报假期的日历处理成一个」——两处各写一份
//   已经导致过两次「改一处漏一处」（班次描述、实线虚线），此函数即收敛点。
//
//   规则（老韩口述的班组休假管理流程）：
//     1. 已批准（locked/reported/released/verified）→ 实线
//     2. 待审批 且 属于本周或下周 且 当日名额没超 → 实线（名额内，正常走审批）
//     3. 待审批 且 更远的周 → 虚线（还没到跟车场组确认顶班人员的时候）
//     4. 待审批 且 当日名额超了 → 虚线
//   DAILY_QUOTA 与周报批默认名额一致（1 人）。
// ══════════════════════════════════════════════════════════════
const DAILY_QUOTA = 1;

function computeLeavePending(records, todayStr) {
  const today = todayStr || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const nearWeekEnd = addDaysStr(addDaysStr(mondayOf(today), 7), 6);   // 下周日

  const loadOn = db.prepare(`
    SELECT COUNT(*) AS n FROM leave_records
    WHERE start_date <= ? AND end_date >= ?
      AND status NOT IN ('cancelled','rejected','draft')
  `);

  return (records || []).map(r => {
    const isPendingStatus = r.status === 'submitted' || r.status === 'cancel_pending';
    if (!isPendingStatus) return { ...r, pending: false };

    // 整段都在「本周或下周」之外 → 要等下周再跟车场组确认
    if (r.end_date > nearWeekEnd) return { ...r, pending: true };

    // 名额：这段里有没有哪天超过 DAILY_QUOTA
    let cur = r.start_date;
    let guard = 0;
    while (cur <= r.end_date && guard++ < 400) {
      if (loadOn.get(cur, cur).n > DAILY_QUOTA) return { ...r, pending: true };
      cur = addDaysStr(cur, 1);
    }
    return { ...r, pending: false };
  });
}

// 班次 + 全组休假查询（申报页用）
router.get('/api/shift/range', (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const from = req.query.from, to = req.query.to;
    if (!from || !to) return res.status(400).json({ error: '缺 from/to' });
    const span = (new Date(to) - new Date(from)) / 86400000;
    if (span < 0 || span > 120) return res.status(400).json({ error: '范围最多 120 天' });

    const rows = db.prepare(`
      SELECT date, shift FROM shift_calendar
      WHERE date >= ? AND date <= ? ORDER BY date
    `).all(from, to);

  // 全组休假（老韩 2026-11-25 定）：申报页要看到别人休了几天，信息透明，
  // 才能自己判断是不是超名额。
  // 实线/虚线统一由 computeLeavePending() 判定（与首页同一函数，单一来源）
  const rawLeaves = db.prepare(`
    SELECT l.id, l.staff_id, s.real_name, l.leave_type, l.start_date, l.end_date,
           l.days, l.status
    FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
    WHERE l.start_date <= ? AND l.end_date >= ?
      AND l.status NOT IN ('cancelled','rejected','draft')
    ORDER BY l.start_date, s.real_name
  `).all(to, from);

  const leaves = computeLeavePending(rawLeaves);

  res.json({ days: rows, leaves });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 周报批清单（管理员用）：汇总下周已批准的休假，一键复制发车场组
// ══════════════════════════════════════════════════════════════

// 计算某天所在周的周一（周一为一周之始）
function mondayOf(ds) {
  const d = new Date(ds + 'T00:00:00');
  const day = d.getDay() || 7;         // 周日=7
  d.setDate(d.getDate() - (day - 1));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDaysStr(ds, n) {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// 一条休假跨周时，归属哪一周：取「天数落在该周最多」的那一周，并列取靠后的。
// 为什么不用 start_date 所在周：谢安达 11-29(周日)~12-01，start 属于 11-23 那周，
// 但 11-30/12-01 两天在 11-30 那周，班组长实际是在 11-30 那周安排顶班的。
// 例：11-29~12-01 → 11-23 那周占 1 天、11-30 那周占 2 天 → 归 11-30 那周。
function pickMainWeek(startDate, endDate) {
  const w1 = mondayOf(startDate);
  const w1End = addDaysStr(w1, 6);
  if (endDate <= w1End) return w1;        // 不跨周
  const w2 = addDaysStr(w1, 7);
  const w2End = addDaysStr(w2, 6);
  // 数各占几天
  const countIn = (ws, we) => {
    let n = 0;
    for (let d = startDate; d <= endDate; d = addDaysStr(d, 1)) {
      if (d >= ws && d <= we) n++;
      if (n > 60) break;                   // 防御：别真跑几千次
    }
    return n;
  };
  const n1 = countIn(w1, w1End);
  const n2 = countIn(w2, w2End);
  return n2 >= n1 ? w2 : w1;               // 并列取靠后
}
// 人数上限（保底名额）默认值，可在 leave_batches.quota_base 覆盖
const DEFAULT_QUOTA = 1;

// 生成「报给考勤员」的单条文本（老韩给的格式）：
//   胡鑫Y17341（乘务四组），2026年11月26-27日年休，班次为夜早班，共2天，实际1.5天。
// 要点：
//   · 工号带 Y 前缀
//   · 班次合成连班名（夜早班/白夜班/夜班/白班/早班/休息）
//   · 「共N天」= 日历天数（自然日）
//   · 「实际M天」= 扣假天数：
//       - 年休 → 按班次折算（夜早 1.5、白夜 2、正休 0…）
//       - 其它假别 → 取库里登记的 days（陪产假 23 天只扣 15 天等）
function buildAttendanceLine(staffId, realName, leaveType, startDate, endDate, recordedDays) {
  // 工号带 Y 前缀（库里存的是纯数字）
  const sid = String(staffId).trim();
  const sidWithY = /^Y/i.test(sid) ? sid.toUpperCase() : 'Y' + sid;
  const dec = (n) => (n % 1 === 0 ? String(n) : n.toFixed(1));

  // 日期格式（老韩 2026-11-25 定）：
  //   同月 → 2026年11月22日-11月28日（月份只在前面写一次，后面仍带「月」）
  //   单日 → 2026年11月26日
  //   跨月 → 2026年11月29日-12月1日；跨年 → 各写各的年份
  const fmtDate = (ds) => {
    const [y, m, d] = ds.split('-').map(Number);
    return { y, m, d };
  };
  // 日期写法（老韩 2026-11-26 最终定）：
  //   单日（不论是不是跨月拆出来的）→ 「2026年12月1日」
  //     之前试过拆出来的单日写成「12月1日-12月1日」，老韩否掉：
  //     「如果单一个白班，日期简化一下，12月1日年休，班次白，共1天，实际1天」
  //   同月多日 → 「2026年11月29日-11月30日」
  //   跨月/跨年 多日 → 各写各的月份（同一自然年）或年份（跨年）
  const dateTextOf = (s, e) => {
    const a = fmtDate(s), b = fmtDate(e);
    if (s === e) return `${a.y}年${a.m}月${a.d}日`;
    if (a.y === b.y) return `${a.y}年${a.m}月${a.d}日-${b.m}月${b.d}日`;
    return `${a.y}年${a.m}月${a.d}日-${b.y}年${b.m}月${b.d}日`;
  };

  // 生成一段的考勤文本（一段 = 不跨自然月的一个区间）
  // 班次描述：逐字连写（老韩 2026-11-25 定，照乘务三组范例）
  //   白夜早休白夜早  ← 7 天假，直接按顺序把班次首字连起来
  //   白夜早          ← 3 天假
  // 扣假天数：所有假别统一按班次折算（calcLeaveDays 已含此口径）。
  // 库里 recordedDays 只作旁证——历史台账可能是旧口径（自然日）录入的，
  // 直接用会让考勤文本与日历预览对不上，所以以实时折算结果为准。
  const buildSegment = (s, e) => {
    const seg = calcLeaveDays(s, e, leaveType);
    const d1 = new Date(s + 'T00:00:00');
    const d2 = new Date(e + 'T00:00:00');
    const calendarDays = Math.round((d2 - d1) / 86400000) + 1;
    const ONE = { 白班: '白', 夜班: '夜', 早班: '早', 休息: '休' };
    const shiftText = (seg.detail || []).map(d => ONE[d.shift] || '').join('') || '休';
    const a = fmtDate(s);
    return `${realName} （乘务四组）${sidWithY} ${dateTextOf(s, e)} ${a.y}年${leaveType || '年休'}` +
           `（${shiftText}）共${calendarDays}天，实际${dec(seg.days)}天。`;
  };

  // ── 跨自然月要拆成两段（老韩 2026-11-26 定）──
  // 为什么：考勤员是拿这个文本去核对纸质休假单的，而休假单按自然月开。
  // 一条 11-29~12-1 的假，如果他手上只有 11 月的单，看到「11月29日-12月1日」整段
  // 就对不上账，得自己拿笔拆。所以系统先拆好：11-29~11-30 一段、12-1 一段。
  // 注意：只按自然月拆，不按周拆（跨周不用拆，考勤按月不按周）。
  const startYm = startDate.slice(0, 7);
  const endYm = endDate.slice(0, 7);
  if (startYm !== endYm) {
    const lines = [];
    let cursor = startDate;
    let guard = 0;
    while (cursor <= endDate && guard++ < 60) {
      const ym = cursor.slice(0, 7);
      const [yy, mm] = ym.split('-').map(Number);
      const lastDayOfMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const monthEnd = `${ym}-${String(lastDayOfMonth).padStart(2, '0')}`;
      const segEnd = monthEnd < endDate ? monthEnd : endDate;
      lines.push(buildSegment(cursor, segEnd));
      // 下一段从次月 1 号开始
      const next = new Date(Date.UTC(yy, mm, 1));   // mm 是 1-based，传给 Date.UTC 当 0-based 下月
      cursor = next.toISOString().slice(0, 10);
    }
    return lines.join('\n');
  }

  return buildSegment(startDate, endDate);
}

// ══════════════════════════════════════════════════════════════
// 导出休假记录 Excel（管理端）
//   GET /api/leave/export?year=2026&type=年休&status=verified
//   参数都可选，不传就是全部（老韩 2026-11-25：要全部记录，含历史台账+系统申报）
//   表头照车间台账：序号/工号/申请人/班组/假别/起止/天数/状态/来源/审批人/备注
//   另附「按人汇总」第二个 sheet
// ══════════════════════════════════════════════════════════════
router.get('/api/leave/export', adminAuth, async (req, res) => {
  try {
    const { year, type, status } = req.query;

    let sql = `
      SELECT l.*, s.real_name, s.name,
             COALESCE(l.created_by, '') AS created_by2
      FROM leave_records l
      LEFT JOIN staff s ON s.id = l.staff_id
      WHERE 1=1
    `;
    const params = [];
    if (year)   { sql += ` AND l.quota_year = ?`;  params.push(Number(year)); }
    if (type)   { sql += ` AND l.leave_type = ?`;  params.push(String(type)); }
    if (status) { sql += ` AND l.status = ?`;      params.push(String(status)); }
    sql += ` ORDER BY l.start_date, s.real_name`;

    const rows = db.prepare(sql).all(...params);

    // 审批人：库里没有专门字段，workshop 来源记「车间月报表」，
    // 系统申报看 created_by（组员自己提交，暂无审批人概念）。
    rows.forEach(r => {
      r.approver = r.source === 'workshop' ? '车间' : (r.status === 'verified' ? '班组长' : '');
    });

    const { buildLeaveWorkbook } = require('../leaveExport');
    const buf = await buildLeaveWorkbook(rows);

    const stamp = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '');
    const fname = `乘务四组休假记录_全部_${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 中文文件名要用 RFC 5987 的 filename*，否则浏览器可能乱码
    res.setHeader('Content-Disposition',
      `attachment; filename="leave-records.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[leave] 导出失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 标记「已与车场组对接顶班」（老韩 2026-11-25）
//
// 为什么需要这个：申报窗口期内（周一~周三），三个管理员（韩颖/艾凌风/胡鑫）
// 各自可能对接不同的人。信息不对称时会出人命：
//   周一 艾凌风 审了谢安达（11-30~12-03）→ 找车场组要 1 个顶班
//   周二 韩颖   审了韩思成（12-03~12-06）→ 又找车场组要 1 个
//   但 12-03 两人重叠，实际需要 2 个人顶班。如果两边都以为「1 个就够了」，
//   或者车场组只记了一次，12-03 就少一个人。
//
// 所以：每条记录单独标记「谁对接的、什么时候」，点完立刻把整周顶班需求全景
// 推到「四组办事情群」，让另外两个管理员看见已经对接过谁、还差几天几个人。
//
// POST /api/leave/:id/relief-done
//   body: { by: '韩颖'|'艾凌风'|'胡鑫'|..., note: '车场组安排某某顶班', undo: false }
//   undo=true 取消标记
// ══════════════════════════════════════════════════════════════
router.post('/api/leave/:id/relief-done', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // 对接人 = 登录人，由密码映射出姓名（middleware.adminAuth 已解析）
    // 不信任前端传的 by —— 三个人各有独立管理员密码，谁登录就是谁，
    // 不需要弹窗问「你是谁」，也不会被冒填。
    const who = String(req.adminName || '管理员').trim().slice(0, 20);
    const note = String(req.body?.note || '').trim().slice(0, 200);
    const undo = req.body?.undo === true;

    const rec = db.prepare(`
      SELECT l.*, s.real_name, s.name FROM leave_records l
      LEFT JOIN staff s ON s.id = l.staff_id WHERE l.id=?
    `).get(id);
    if (!rec) return res.status(404).json({ error: '记录不存在' });
    if (!['locked', 'reported', 'released'].includes(rec.status)) {
      return res.status(400).json({ error: `当前状态「${rec.status}」不能标记对接，需先批准` });
    }

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ').slice(0, 19);

    if (undo) {
      db.prepare(`UPDATE leave_records SET relief_done_by=NULL, relief_done_at=NULL, relief_note=NULL, updated_at=? WHERE id=?`)
        .run(now, id);
      return res.json({ ok: true, undone: true });
    }

    db.prepare(`UPDATE leave_records SET relief_done_by=?, relief_done_at=?, relief_note=?, updated_at=? WHERE id=?`)
      .run(who, now, note || null, now, id);

    // ── 算整周顶班需求全景，推给办事情群 ──
    // 用哪一周：不能简单用 mondayOf(start_date)。
    // 例：谢安达 11-29(周日)~12-01，mondayOf('11-29') = 11-23，会算到上一周去，
    // 但实际他 11-30/12-01 两天在下一周，顶班也是在下一周一起安排的。
    // 规则：取「这条休假天数最多的那一周」；并列时取靠后的一周。
    const weekStart = pickMainWeek(rec.start_date, rec.end_date);
    const weekEnd = addDaysStr(weekStart, 6);

    const weekRows = db.prepare(`
      SELECT l.id, l.staff_id, s.real_name, s.name, l.leave_type,
             l.start_date, l.end_date, l.relief_done_by, l.relief_done_at
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status IN ('locked','reported','released','verified')
      ORDER BY l.start_date
    `).all(weekEnd, weekStart);

    // 逐日：谁休、几人
    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
    const perDay = [];
    for (let i = 0; i < 7; i++) {
      const ds = addDaysStr(weekStart, i);
      const shift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds)?.shift || '';
      // 正休那天不用顶班，报批清单人数按 0 算（老韩 2026-11-26）
      const whoToday = shift === '休息' ? []
        : weekRows.filter(r => r.start_date <= ds && r.end_date >= ds)
            .map(r => r.real_name || r.name || r.staff_id);
      perDay.push({
        date: ds, label: `周${dayNames[i]}`, count: whoToday.length, names: whoToday,
        shift, is_rest: shift === '休息',
      });
    }
    const peak = Math.max(...perDay.map(d => d.count), 0);
    const peakDays = perDay.filter(d => d.count === peak && peak > 0);

    // 已对接 / 未对接
    const done = weekRows.filter(r => r.relief_done_by);
    const todo = weekRows.filter(r => !r.relief_done_by);

    const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
    const lines = [];
    lines.push(`【顶班已对接】${who}`);
    lines.push('');
    lines.push(`${md(weekStart)}-${md(weekEnd)} 顶班需求：`);
    // 只列有人的日子
    for (const d of perDay) {
      if (d.count === 0) continue;
      const isPeak = d.count === peak && peak >= 2;
      lines.push(`· ${d.date.slice(5)} ${d.label}  ${d.count}人（${d.names.join('、')}）${isPeak ? '  ⚠️峰值' : ''}`);
    }
    lines.push('');
    lines.push(`本周最多需要 ${peak} 人顶班${peakDays.length ? `（${peakDays.map(d => md(d.date)).join('、')}）` : ''}`);

    if (done.length) {
      lines.push('');
      lines.push('已对接：');
      for (const r of done) {
        const t = (r.relief_done_at || '').slice(11, 16);
        lines.push(`· ${r.real_name || r.name} ${r.start_date.slice(5)}~${r.end_date.slice(5)} —— ${r.relief_done_by} ${t}`);
      }
    }
    if (todo.length) {
      lines.push('');
      lines.push(`⚠️ 还没对接：${todo.map(r => r.real_name || r.name).join('、')}`);
    }

    const text = lines.join('\n');

    // 推送到「四组办事情群」
    // dry_run=1 时只返回文案不真发 —— 测试用，避免污染群消息
    const dryRun = req.body?.dry_run === true || String(req.query.dry_run || '') === '1';
    if (!dryRun) {
      sendToChannel('crewOps', text, { title: '顶班对接', at: AT_OPTS }).catch(e =>
        console.error('[leave] 顶班对接推送失败:', e.message));
      console.log(`[leave] 顶班对接标记: ${rec.real_name} ${rec.start_date}~${rec.end_date} by ${who}`);
    }

    res.json({
      ok: true,
      relief_done_by: who,
      relief_done_at: now,
      week_start: weekStart,
      week_end: weekEnd,
      peak,
      peak_days: peakDays.map(d => d.date),
      done_count: done.length,
      todo: todo.map(r => r.real_name || r.name),
      text,
    });
  } catch (e) {
    console.error('[leave] relief-done 失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /api/leave/week-relief?week=2026-11-30
//   整周顶班需求全景（管理员页展示，不推送）
router.get('/api/leave/week-relief', adminAuth, (req, res) => {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const weekStart = req.query.week ? mondayOf(req.query.week) : addDaysStr(mondayOf(today), 7);
    const weekEnd = addDaysStr(weekStart, 6);

    const rows = db.prepare(`
      SELECT l.id, l.staff_id, s.real_name, s.name, l.leave_type,
             l.start_date, l.end_date, l.days, l.status,
             l.relief_done_by, l.relief_done_at, l.relief_note
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status IN ('locked','reported','released','verified')
      ORDER BY l.start_date, s.real_name
    `).all(weekEnd, weekStart);

    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
    const perDay = [];
    for (let i = 0; i < 7; i++) {
      const ds = addDaysStr(weekStart, i);
      const shift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds)?.shift || '';
      // 正休（班次=休息）那天不需要顶班，需求一律显示 0（老韩 2026-11-26）
      // 原来只按休假记录算，休息日也会算出「1人」，跟周三的「—」不一致。
      const isRest = shift === '休息';
      const whoToday = isRest ? [] : rows.filter(r => r.start_date <= ds && r.end_date >= ds);
      perDay.push({
        date: ds, label: `周${dayNames[i]}`, count: whoToday.length,
        names: whoToday.map(r => r.real_name || r.name),
        shift,
        is_rest: isRest,
      });
    }
    const peak = Math.max(...perDay.map(d => d.count), 0);

    res.json({
      week_start: weekStart,
      week_end: weekEnd,
      peak,
      per_day: perDay,
      records: rows.map(r => ({
        id: r.id,
        staff_id: r.staff_id,
        real_name: r.real_name || r.name || r.staff_id,
        leave_type: r.leave_type,
        start: r.start_date,
        end: r.end_date,
        days: r.days,
        status: r.status,
        relief_done_by: r.relief_done_by || null,
        relief_done_at: r.relief_done_at || null,
        relief_note: r.relief_note || null,
      })),
      todo: rows.filter(r => !r.relief_done_by).map(r => r.real_name || r.name),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 周三 17:00 申报窗口关闭后的通知（老韩 2026-11-25）
//
// 发「乘务四组大群」（全体组员），三块内容：
//   ① 本周申报已结束
//   ② 本周休假名单 + 顶班已到位
//   ③ 之后想报的：非紧急别改；要报得先找班组长，
//      由班组长去问车场组还有没有多余的人 —— 因为周三车场组已把人员
//      排到每个班组、定表了，临时请假只能协调。
//
// 流程方向在周三 17:00 前后是反的（这点必须让组员知道）：
//   窗口内：提交 → 审批 → 要顶班
//   窗口后：【先问车场组有没有人】→ 有才批
//
// POST /api/leave/window-closed
//   body: { dry_run: true }  只返回文案不发送
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// 周三 17:00 申报窗口关闭后的通知（老韩 2026-11-25）
//
// 三段式流程：
//   16:50 cron 调 /api/leave/window-closed?mode=preview
//          → 只把「文案+日历图」发到「四组办事情群」（三管理员可见）
//   三人中任一位确认（后台点按钮 / 或群里说一声，管理员操作）
//          → POST /api/leave/window-closed?mode=send
//          → 发到「乘务四组大群」（全体组员）
//
// 为什么不让它在 17:00 自动发大群：老韩要「先能看到文案确认」。
// 定表后改口很麻烦，宁可多一次人工确认。
//
// 内容三块：
//   ① 下周申报已截止
//   ② 下周休假名单（日历图，每天格子里是休假人，底栏是顶班需求）
//   ③ 之后想报的：非紧急别改；要报先找班组长，
//      由班组长问车场组还有没有多余的人 —— 周三车场组已定表。
//
// 流程方向在周三 17:00 前后是反的（必须让组员知道）：
//   窗口内：提交 → 审批 → 要顶班
//   窗口后：【先问车场组有没有人】→ 有才批
// ══════════════════════════════════════════════════════════════
async function buildWindowClosedNotice() {
  const win = getApplyWindow();
  // 发的是「刚过去的这个窗口」所申报的那一周，也就是下周
  // getApplyWindow() 返回的字段叫 target_week_start（不是 nextWeekStart）
  const weekStart = win.target_week_start;
  const weekEnd = addDaysStr(weekStart, 6);

  // 这一周所有已批准的休假
  const rows = db.prepare(`
    SELECT l.id, l.staff_id, s.real_name, s.name, l.leave_type,
           l.start_date, l.end_date, l.days, l.status,
           l.relief_done_by, l.relief_done_at
    FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
    WHERE l.start_date <= ? AND l.end_date >= ?
      AND l.status IN ('locked','reported','released','verified')
    ORDER BY l.start_date, s.real_name
  `).all(weekEnd, weekStart);

  // 逐日人数
  const perDayRaw = [];
  for (let i = 0; i < 7; i++) {
    const ds = addDaysStr(weekStart, i);
    const shift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds)?.shift || '';
    // 正休不算顶班需求（老韩 2026-11-26）
    const who = shift === '休息' ? [] : rows.filter(r => r.start_date <= ds && r.end_date >= ds);
    perDayRaw.push({ date: ds, count: who.length, shift, is_rest: shift === '休息' });
  }
  const peak = Math.max(...perDayRaw.map(d => d.count), 0);

  const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
  const lines = [];

  lines.push(`【下周休假申报已截止】`);
  lines.push('');
  lines.push(`下周（${md(weekStart)}-${md(weekEnd)}）休假申报已于周三 17:00 截止。`);

  if (rows.length === 0) {
    lines.push('');
    lines.push('下周无人休假。');
  } else {
    lines.push('');
    lines.push(`下周休假 ${rows.length} 人，顶班已与车场组确认到位（见下方日历）。`);
  }

  lines.push('');
  lines.push('⚠️ 申报截止后的注意事项：');
  lines.push('1. 已申报的同志，非紧急、特殊情况请勿再改计划。');
  lines.push('2. 确实需要新申报的，请先与班组长联系。');
  lines.push('   车场组周三已把人员排到各班组并定表，');
  lines.push('   临时请假需先向车场组确认是否还有可调配人员，');
  lines.push('   有余量才能批准。');

  let text = lines.join('\n');

  // ── 生成周班版图片（版式照管理页「周报批清单」）──
  // 老韩 2026-11-25：不用日历了，改用「休假N人/日名额/每日人数条/名单」这个版式，
  // 跟管理页看到的一致，人多姓名也不会挤。
  let chartUrl = null;
  try {
    // 按人聚合（同一人可能有多条，跨周的裁到本周）
    const byStaff = new Map();
    for (const r of rows) {
      const key = String(r.staff_id);
      if (!byStaff.has(key)) {
        byStaff.set(key, { real_name: r.real_name || r.name || key, items: [], total_days: 0 });
      }
      const o = byStaff.get(key);
      const s = r.start_date > weekStart ? r.start_date : weekStart;
      const e = r.end_date < weekEnd ? r.end_date : weekEnd;
      o.items.push({ start: s, end: e, leave_type: r.leave_type });
      o.total_days = Math.round((o.total_days + (r.days || 0)) * 10) / 10;
    }
    const people = [...byStaff.values()].sort((a, b) => a.real_name.localeCompare(b.real_name, 'zh'));

    const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const perDay = perDayRaw.map((d, i) => ({ date: d.date, label: dayLabels[i], count: d.count }));

    const rangeText = `${md(weekStart)} - ${md(weekEnd)}`;
    const { renderWeekBatchChart, checkChartHasText } = require('../leaveChart');
    const png = await renderWeekBatchChart({
      per_day: perDay,
      people,
      quota: peak,
      quota_label: `最多 ${peak} 人顶班`,   // 大群用「顶班」，不用「日名额」
      quota_warn: false,                    // 大群通知不判「超名额」
      total_people: rows.length,
      title: '下周休假安排',
      range_text: rangeText,
    });
    const chk = await checkChartHasText(png);
    if (!chk.ok) {
      console.error('[leave] 窗口关闭通知配图自检失败:', chk.reason);
    } else {
      const fname = `leave-closed-${weekStart}.png`;
      require('fs').mkdirSync(CHART_DIR, { recursive: true });
      require('fs').writeFileSync(path.join(CHART_DIR, fname), png);
      chartUrl = `${PUBLIC_BASE}/leave-charts/${fname}?v=${Date.now()}`;
    }
  } catch (e) {
    console.error('[leave] 窗口关闭通知配图失败:', e.message);
  }

  if (chartUrl) text += `\n\n![](${chartUrl})`;
  text += `\n\n[乘务四组系统](${PUBLIC_BASE})`;

  return { weekStart, weekEnd, rows, peak, chartUrl, text };
}

// mode=preview（默认）→ 发「四组办事情群」
// mode=send          → 发「乘务四组大群」
router.post('/api/leave/window-closed', adminAuth, async (req, res) => {
  try {
    const dryRun = req.body?.dry_run === true || String(req.query.dry_run || '') === '1';
    const mode = req.body?.mode === 'send' ? 'send' : 'preview';

    const n = await buildWindowClosedNotice();

    if (!dryRun) {
      const channel = mode === 'send' ? 'crewMain' : 'crewOps';
      const title = mode === 'send' ? '下周休假安排' : '【待确认】下周休假安排';
      sendToChannel(channel, n.text, { markdown: !!n.chartUrl, title })
        .catch(e => console.error('[leave] 窗口关闭通知推送失败:', e.message));
      console.log(`[leave] window-closed ${mode} → ${channel}: ${n.weekStart} (图=${!!n.chartUrl})`);
    }

    res.json({
      ok: true,
      dry_run: dryRun,
      mode,
      week_start: n.weekStart,
      week_end: n.weekEnd,
      people_count: n.rows.length,
      peak: n.peak,
      chart_url: n.chartUrl,
      text: n.text,
    });
  } catch (e) {
    console.error('[leave] window-closed 失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// ══════════════════════════════════════════════════════════════
// 全组休假全景预览（老韩 2026-11-25）
//
// 目的：管理员要知道「整体年度休假还剩多少」，而不只是某一周。
// 口径（老韩定）：
//   · 在编 30 人 = staff 全表 − 车峰(is_cp=1)
//     车峰 = 临时调整跑车方式，保留组籍但不在班组，不进在编统计
//   · 每人三列：额度 / 已休 / 剩余
//   · 已休只算生效状态（verified/locked/reported/released），
//     cancelled/rejected 不算 —— 撤销的假不能虚高已休
//
// GET /api/leave/overview?year=2026
function calcOverview(year) {
  const Y = year || YEAR;

  // 在编名单：排除车峰
  const people = db.prepare(`
    SELECT id, COALESCE(real_name,name) nm, is_cp, is_exempt, is_leader, is_instructor, roster_seq
    FROM staff WHERE COALESCE(is_cp,0)=0
    ORDER BY COALESCE(real_name,name)
  `).all();

  // 额度
  const quotaMap = new Map();
  for (const q of db.prepare('SELECT * FROM leave_quota WHERE year=?').all(Y)) {
    quotaMap.set(String(q.staff_id), q);
  }

  // 已休（按假别聚合，只算生效状态）
  const usedMap = new Map();
  const usedRows = db.prepare(`
    SELECT staff_id, leave_type, SUM(days) d
    FROM leave_records
    WHERE status IN ('verified','locked','reported','released') AND quota_year=?
    GROUP BY staff_id, leave_type
  `).all(Y);
  for (const r of usedRows) {
    const k = String(r.staff_id);
    if (!usedMap.has(k)) usedMap.set(k, {});
    usedMap.get(k)[r.leave_type] = r.d;
  }

  // 待审批（submitted / cancel_pending）—— 按月报批时要留意
  const pendMap = new Map();
  for (const r of db.prepare(`
    SELECT staff_id, SUM(days) d FROM leave_records
    WHERE status IN ('submitted','cancel_pending') AND quota_year=?
    GROUP BY staff_id
  `).all(Y)) {
    pendMap.set(String(r.staff_id), r.d);
  }

  const LT = [
    { key: 'annual',    name: '年休',   col: 'annual_total' },
    { key: 'parental',  name: '育儿假', col: 'parental_total' },
    { key: 'paternity', name: '陪产假', col: 'paternity_total' },
    { key: 'marriage',  name: '婚假',   col: 'marriage_total' },
  ];

  const list = people.map(p => {
    const q = quotaMap.get(String(p.id)) || {};
    const u = usedMap.get(String(p.id)) || {};
    const byType = LT.map(t => {
      const total = Number(q[t.col] || 0);
      const used = Number(u[t.name] || 0);
      return {
        name: t.name, total, used,
        left: Math.max(0, Math.round((total - used) * 10) / 10),  // 不显示负数，同 /summary 口径
        // 额度=0 且已休>0 属于「已明确休完」（管理员置 0 拦截再申请），不算超支、不标告警
        over: total > 0 && used > total,
      };
    });
    const total = byType.reduce((s, x) => s + x.total, 0);
    const used = byType.reduce((s, x) => s + x.used, 0);
    // 剩余合计（老韩 2026-11-26 修）：
    // 只能用「各假别正剩余」相加，不能让一个假别超支吃掉别的假别。
    // 反例：韩思成年休 0/已休5.5、育儿假剩5 → 25-25.5=-0.5 → 前端钳0 → 显示"已用完"，
    // 但他实际还有 5 天育儿假可以休。超支是年休的事，不该连累育儿假。
    const leftSum = byType.reduce((s, x) => s + Math.max(0, x.total - x.used), 0);
    return {
      staff_id: String(p.id),
      name: p.nm,
      seq: p.roster_seq ?? null,     // 班组编制序号（2027统筹表序号，长期固定）
      is_leader: !!p.is_leader,
      is_instructor: !!p.is_instructor,
      total: Math.round(total * 10) / 10,
      used: Math.round(used * 10) / 10,
      left: Math.round(leftSum * 10) / 10,
      pending: Math.round((pendMap.get(String(p.id)) || 0) * 10) / 10,
      by_type: byType.filter(x => x.total > 0 || x.used > 0),   // 只显示有数据的假别
    };
  });

  // ── 非在编（车峰）名单：同样算账，但单独列出、不进合计 ──
  // 老韩 2026-11-26：车峰是「临时调整跑车方式」，人还在组里、还有假要算，
  // 只是不计入在编 30 人的额度合计。放总览下方做差异标注。
  const cpPeople = db.prepare(`
    SELECT id, COALESCE(real_name,name) nm, is_cp, roster_seq
    FROM staff WHERE COALESCE(is_cp,0)=1
    ORDER BY COALESCE(roster_seq, 999)
  `).all().map(p => {
    const q = quotaMap.get(String(p.id)) || {};
    const u = usedMap.get(String(p.id)) || {};
    const byType = LT.map(t => {
      const total = Number(q[t.col] || 0);
      const used = Number(u[t.name] || 0);
      return {
        name: t.name, total, used,
        left: Math.max(0, Math.round((total - used) * 10) / 10),
        // 额度=0 且已休>0 属于「已明确休完」，不算超支、不标告警
        over: total > 0 && used > total,
      };
    });
    const total = byType.reduce((s, x) => s + x.total, 0);
    const used = byType.reduce((s, x) => s + x.used, 0);
    // 同在编：剩余只累加各假别正剩余，超支不连累其他假别
    const leftSum = byType.reduce((s, x) => s + Math.max(0, x.total - x.used), 0);
    return {
      staff_id: String(p.id),
      name: p.nm,
      seq: p.roster_seq ?? null,
      total: Math.round(total * 10) / 10,
      used: Math.round(used * 10) / 10,
      left: Math.round(leftSum * 10) / 10,
      pending: Math.round((pendMap.get(String(p.id)) || 0) * 10) / 10,
      by_type: byType.filter(x => x.total > 0 || x.used > 0),
    };
  });

  // 合计
  const sum = list.reduce((a, x) => ({
    total: a.total + x.total, used: a.used + x.used, left: a.left + x.left, pending: a.pending + x.pending,
  }), { total: 0, used: 0, left: 0, pending: 0 });

  return {
    year: Y,
    // 库里已入库的年份（供前端年份切换按钮用）
    // 2026=过渡年（乘务系统统计），2027=正式年（车间统筹表为底座）
    available_years: db.prepare('SELECT DISTINCT year FROM leave_quota ORDER BY year').all().map(r => r.year),
    headcount: list.length,
    cp_excluded: cpPeople.length,
    summary: {
      total: Math.round(sum.total * 10) / 10,
      used: Math.round(sum.used * 10) / 10,
      left: Math.round(sum.left * 10) / 10,
      pending: Math.round(sum.pending * 10) / 10,
    },
    people: list,
    // 非在编（车峰）：单独列出供核对，不进 summary 合计
    cp_people: cpPeople,
  };
}

router.get('/api/leave/overview', adminAuth, (req, res) => {
  try {
    res.json(calcOverview(Number(req.query.year) || YEAR));
  } catch (e) {
    console.error('[leave] overview 失败:', e);
    res.status(500).json({ error: String(e.message) });
  }
});

// GET /api/leave/week-batch?week=2026-12-07&format=attendance|report
//   format=report（默认）= 发车场组的汇总清单
//   format=attendance  = 报给考勤员的逐条格式
router.get('/api/leave/week-batch', adminAuth, (req, res) => {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    let weekStart;
    if (req.query.week) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.week)) return res.status(400).json({ error: 'week 格式应为 YYYY-MM-DD' });
      weekStart = mondayOf(req.query.week);
    } else {
      weekStart = addDaysStr(mondayOf(today), 7);   // 默认下周
    }
    const weekEnd = addDaysStr(weekStart, 6);
    const weekKey = isoWeekKey(new Date(weekStart + 'T00:00:00'));

    // 本周已批准的休假（排除待审/驳回/撤销）
    const rows = db.prepare(`
      SELECT l.id, l.staff_id, s.real_name, s.name, l.leave_type,
             l.start_date, l.end_date, l.days, l.status
      FROM leave_records l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE l.start_date <= ? AND l.end_date >= ?
        AND l.status IN ('locked','reported','released','verified')
      ORDER BY l.start_date, s.real_name
    `).all(weekEnd, weekStart);

    // 按人汇总（同一人可能有多条）
    const byStaff = new Map();
    for (const r of rows) {
      const key = String(r.staff_id);
      if (!byStaff.has(key)) {
        byStaff.set(key, {
          staff_id: key,
          real_name: r.real_name || r.name || key,
          items: [],
          total_days: 0,
        });
      }
      const o = byStaff.get(key);
      // 裁到本周范围内（跨周的只算本周那几天）
      const s = r.start_date > weekStart ? r.start_date : weekStart;
      const e = r.end_date < weekEnd ? r.end_date : weekEnd;
      o.items.push({ id: r.id, leave_type: r.leave_type, start: s, end: e, days: r.days, full_start: r.start_date, full_end: r.end_date });
      o.total_days = Math.round((o.total_days + (r.days || 0)) * 10) / 10;
    }

    // 按天统计每天休几人 + 那天是周几
    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
    const perDay = [];
    for (let i = 0; i < 7; i++) {
      const ds = addDaysStr(weekStart, i);
      const shift = db.prepare('SELECT shift FROM shift_calendar WHERE date=?').get(ds);
      const shiftName = shift ? shift.shift : '';
      const who = [];
      // 正休那天不用顶班，按 0 人算（老韩 2026-11-26）
      if (shiftName !== '休息') {
        for (const o of byStaff.values()) {
          for (const it of o.items) {
            if (it.start <= ds && it.end >= ds) { who.push(o.real_name); break; }
          }
        }
      }
      perDay.push({ date: ds, label: `周${dayNames[i]}`, count: who.length, names: who,
        shift: shiftName, is_rest: shiftName === '休息' });
    }

    // 名额：取 leave_batches 里配置的，没有就用默认
    const batch = db.prepare('SELECT quota_base, quota_actual, reported_at, released_json FROM leave_batches WHERE week_key=?').get(weekKey);
    const quota = (batch && (batch.quota_actual ?? batch.quota_base)) ?? DEFAULT_QUOTA;

    // 生成纯文本（一键复制发车场组）
    const people = [...byStaff.values()].sort((a, b) => a.real_name.localeCompare(b.real_name, 'zh'));
    const lines = [];
    lines.push(`乘务四组 ${weekStart} ~ ${weekEnd} 周休假报批`);
    lines.push('');
    if (people.length === 0) {
      lines.push('本组本周无休假安排。');
    } else {
      lines.push(`合计 ${people.length} 人休假：`);
      people.forEach((p, i) => {
        const seg = p.items.map(it => {
          const tag = it.leave_type ? `（${it.leave_type}）` : '';
          return `${it.start.slice(5)}~${it.end.slice(5)}${tag}`;
        }).join('、');
        lines.push(`${i + 1}. ${p.real_name}  ${seg}  共${p.total_days}天`);
      });
      lines.push('');
      lines.push('每日休假人数：');
      perDay.forEach(d => {
        if (d.count > 0) {
          lines.push(`${d.label} ${d.date.slice(5)}  ${d.count}人${d.count > quota ? ' ⚠超名额' : ''}（${d.names.join('、')}）`);
        }
      });
    }
    lines.push('');
    lines.push(`报批时间：${today}`);
    const text = lines.join('\n');

    // ── 考勤员格式（逐条，一人一行）──
    // 用 leave_records 原始起止（不裁到本周），因为考勤要完整休假区间。
    // 跨自然月时 buildAttendanceLine 会返回两行（"11-29~11-30" + "12-1"），
    // 所以要先按 \n 拆开再拍平，否则数组里会混进带换行的元素，
    // 导出/复制时行数对不上（老韩 2026-11-26）。
    const attendanceLines = rows
      .flatMap(r => buildAttendanceLine(r.staff_id, r.real_name || r.name || r.staff_id,
                                        r.leave_type, r.start_date, r.end_date, r.days)
        .split('\n').filter(Boolean));
    const attendanceText = attendanceLines.length
      ? attendanceLines.join('\n')
      : '本组本周无休假安排。';

    res.json({
      week_key: weekKey,
      week_start: weekStart,
      week_end: weekEnd,
      quota,
      people,
      per_day: perDay,
      total_people: people.length,
      over_quota_days: perDay.filter(d => d.count > quota).map(d => d.date),
      text,
      attendance_text: attendanceText,     // 报给考勤员用
      attendance_lines: attendanceLines,
      reported_at: batch ? batch.reported_at : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// POST /api/leave/week-batch/report   标记已报车场组
router.post('/api/leave/week-batch/report', adminAuth, (req, res) => {
  try {
    const { week_start } = req.body || {};
    if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) return res.status(400).json({ error: '缺 week_start' });
    const weekStart = mondayOf(week_start);
    const weekEnd = addDaysStr(weekStart, 6);
    const weekKey = isoWeekKey(new Date(weekStart + 'T00:00:00'));
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });

    const exists = db.prepare('SELECT id FROM leave_batches WHERE week_key=?').get(weekKey);
    if (exists) {
      db.prepare('UPDATE leave_batches SET reported_at=? WHERE week_key=?').run(now, weekKey);
    } else {
      db.prepare(`INSERT INTO leave_batches (week_key, week_start, week_end, quota_base, reported_at, created_by)
                  VALUES (?,?,?,?,?,?)`).run(weekKey, weekStart, weekEnd, DEFAULT_QUOTA, now, 'admin');
    }

    // 本周已批准的记录推进到 reported
    const upd = db.prepare(`
      UPDATE leave_records SET status='reported', updated_at=datetime('now','localtime')
      WHERE start_date <= ? AND end_date >= ? AND status='locked'
    `).run(weekEnd, weekStart);

    res.json({ ok: true, week_key: weekKey, reported_at: now, advanced: upd.changes });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
