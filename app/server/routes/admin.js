const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const multer = require('multer');
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const mammoth = require('mammoth');
const QRCode = require('qrcode');
const WebSocket = require('ws');
const { db, PHOTO_DIR, getTodayShift } = require('../db');
const { adminAuth, workshopEditAuth, logAdmin, _adminMap } = require('../middleware');
const { getSetting, getCurrentCycle, detectQuestionType, TYPE_LABEL, backfillQuestionTypes, getTrainingPlanForDate, getShiftInfo } = require('../helpers');
const { generateMagicToken, formatTrainingLines, sendDingTalkCard, fmtDate } = require('../push');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || 'monitor_quiz_5line';
const PORT = process.env.PORT || 3000;

// ─── Staff API ─────────────────────────────────────────────────────────────
// 登录验证：工号 + 手机尾号 → 返回真实姓名
router.post('/api/login', (req, res) => {
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

router.get('/api/staff', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT id, real_name, phone_tail, is_exempt, is_tester, COALESCE(is_cp,0) as is_cp, COALESCE(is_leader,0) as is_leader, COALESCE(is_instructor,0) as is_instructor, created_at FROM staff ORDER BY created_at DESC').all());
});

// 单条添加
router.post('/api/staff', adminAuth, (req, res) => {
  const { id, real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor } = req.body;
  if (!id?.trim() || !real_name?.trim()) return res.status(400).json({ error: '工号和姓名不能为空' });
  const staffId = id.trim().replace(/^Y/i, '');
  db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0, is_leader?1:0, is_instructor?1:0);
  logAdmin('添加人员', `工号${staffId} ${real_name.trim()}`, req.adminName);
  res.json({ ok: true });
});

// 批量导入 [{id, real_name, phone_tail}]
router.post('/api/staff/batch', adminAuth, (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: '需要数组' });
  const ins = db.prepare('INSERT OR REPLACE INTO staff (id, name, real_name, phone_tail, is_exempt, is_tester) VALUES (?,?,?,?,?,?)');
  const run = db.transaction(() => list.forEach(({ id, real_name, phone_tail, is_exempt, is_tester }) => {
    const staffId = (id||'').toString().trim().replace(/^Y/i, '');
    if (!staffId || !real_name) return;
    ins.run(staffId, real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt ? 1 : 0, is_tester ? 1 : 0);
  }));
  run();
  logAdmin('批量导入人员', `共${list.length}条`, req.adminName);
  res.json({ ok: true, count: list.length });
});

router.delete('/api/staff/:id', adminAuth, (req, res) => {
  const s = db.prepare('SELECT name FROM staff WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM staff WHERE id=?').run(req.params.id);
  logAdmin('删除人员', `工号${req.params.id} ${s?.name||''}`, req.adminName);
  res.json({ ok: true });
});
// 编辑人员
router.put('/api/staff/:id', adminAuth, (req, res) => {
  const { real_name, phone_tail, is_exempt, is_tester, is_cp, is_leader, is_instructor } = req.body;
  if (!real_name?.trim()) return res.status(400).json({ error: '姓名不能为空' });
  db.prepare('UPDATE staff SET name=?, real_name=?, phone_tail=?, is_exempt=?, is_tester=?, is_cp=?, is_leader=?, is_instructor=? WHERE id=?')
    .run(real_name.trim(), real_name.trim(), (phone_tail||'').toString().trim().slice(-4), is_exempt?1:0, is_tester?1:0, is_cp?1:0, is_leader?1:0, is_instructor?1:0, req.params.id);
  if (is_cp) {
    db.prepare('DELETE FROM training_group_members WHERE staff_id=?').run(req.params.id);
    db.prepare('DELETE FROM training_fixed_members WHERE staff_id=?').run(req.params.id);
  }
  logAdmin('编辑人员', `工号${req.params.id} ${real_name.trim()}`, req.adminName);
  res.json({ ok: true });
});

// ─── Monitor API（只读，供 OpenClaw cron 调用）─────────────────────────────
router.get('/api/monitor/today', (req, res) => {
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
router.get('/api/monitor/today/text', (req, res) => {
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
router.get('/api/monitor/push', (req, res) => {
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

// ─── 扣分点关键词提取 ──────────────────────────────────────────────────────
// 返回 {topic, type}，type 说明问题性质
function extractMissingKeyword(pt) {
  if (pt.includes('扣发') || pt.includes('处分') || pt.includes('开除'))
    return { topic: '处罚标准', type: '' };
  // 规章条款类 "6.15.1总体措施原则"
  const secM = pt.match(/^\d[\d.]*\s*(.{2,10}?)(?:[（(]|$)/);
  if (secM) return { topic: secM[1].replace(/的.*$/, '').trim().slice(0, 6), type: '漏项' };
  // 确定问题类型（前缀即类型）
  let type = '漏提';
  if (/^未明确/.test(pt)) type = '欠清';
  // "的[concept]" 模式 → 最精准（最多6字）
  const deM = pt.match(/的([^的"""''，。；：（(/]{2,6})(?:["""''，。；：（(/]|$)/);
  if (deM) return { topic: deM[1].replace(/^["""''\s]/, '').trim(), type };
  // 末尾5字提取（末尾通常是核心概念，≤6字时保留全部）
  const GENERIC = ['情况', '内容', '要求', '事项', '方面', '程度', '环节', '要点'];
  const stripped = pt.replace(/^未[提说涉明确及到]{0,4}/, '').replace(/["""''（(/].*/g, '').trim();
  let tail = stripped.length <= 6 ? stripped : stripped.slice(-5);
  // 若末尾4字是泛化词，往前移4字
  if (stripped.length > 6 && GENERIC.some(e => tail.slice(-2) === e))
    tail = stripped.slice(0, -2).slice(-5);
  // 去掉非汉字开头（弯引号残留）
  tail = tail.replace(/^[^一-鿿]/, '');
  return { topic: tail, type };
}

function getMissingKeywords(sessionId, maxKeywords = 2) {
  const rows = db.prepare('SELECT missing_points, score_method FROM answers WHERE session_id=?').all(sessionId);
  const allPts = [];
  for (const row of rows) {
    try {
      const pts = JSON.parse(row.missing_points || '[]');
      // score_method=2 为顺序题，有扣分点则标记顺序错
      const forceType = (row.score_method === 2 && pts.length > 0) ? '步骤乱' : null;
      pts.forEach(pt => allPts.push({ pt, forceType }));
    } catch {}
  }
  if (!allPts.length) return '';
  const seen = new Set();
  const keywords = [];
  for (const { pt, forceType } of allPts) {
    if (keywords.length >= maxKeywords) break;
    const { topic, type } = extractMissingKeyword(pt);
    if (!topic || topic.length < 2) continue;
    const finalType = forceType || type;
    const kw = finalType ? `${topic}·${finalType}` : topic;
    if (!seen.has(topic)) { seen.add(topic); keywords.push(kw); }
  }
  return keywords.length ? `（${keywords.join('、')}）` : '';
}

// ─── DingTalk Push ─────────────────────────────────────────────────────────
router.post('/api/admin/dingtalk/push', adminAuth, async (req, res) => {
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
      const mk = getMissingKeywords(ses.id);
      lines.push(`• ${r.name} ${Math.round(ses.total_score)}分${sw}${mk}`);
    }
  }
  lines.push('');
  lines.push(`❌ 未完成（${pendingRows.length}人）`);
  if (pendingRows.length === 0) {
    lines.push('• 全员完成！');
  } else {
    lines.push(pendingRows.map(r => r.name).join('、'));
  }

  // 不合格人员（已完成但分数 < 60，排除复查通过者）
  const failedRows = [];
  for (const r of completed) {
    if (r.is_exempt || r.is_leader) continue;
    const ses = db.prepare(`SELECT id, total_score FROM sessions WHERE staff_id=? AND cycle_id=? AND completed=1 AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0 AND COALESCE(is_remediation,0)=0 ORDER BY id ASC LIMIT 1`).get(r.staff_id, cycleId);
    if (!ses || ses.total_score >= 60) continue;
    // 检查复查结果
    const remRec = db.prepare(`SELECT result, remediation_score FROM remediation_records WHERE staff_id=? AND cycle_id=?`).get(r.staff_id, cycleId);
    failedRows.push({ name: r.name, score: Math.round(ses.total_score), remRec });
  }
  if (failedRows.length > 0) {
    lines.push('');
    lines.push(`⚠️ 不合格需复查（${failedRows.filter(f=>!f.remRec||f.remRec.result==='pending').length}人）`);
    for (const f of failedRows) {
      if (f.remRec?.result === 'pass') {
        lines.push(`• ${f.name} 初试${f.score}分 → 复查${Math.round(f.remRec.remediation_score)}分✅`);
      } else if (f.remRec?.result === 'fail') {
        lines.push(`• ${f.name} 初试${f.score}分 → 复查${Math.round(f.remRec.remediation_score)}分❌`);
      } else {
        lines.push(`• ${f.name} ${f.score}分（待复查）`);
      }
    }
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
    logAdmin('钉钉推送', `推送${count}/${total}人完成情况`, req.adminName);
    res.json({ ok: true, count, total });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── 复查授权 ──────────────────────────────────────────────────────────────
router.post('/api/admin/remediation/grant', adminAuth, (req, res) => {
  const { staffId } = req.body;
  if (!staffId) return res.status(400).json({ error: '缺少 staffId' });
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const staff = db.prepare('SELECT COALESCE(real_name,name) as name FROM staff WHERE id=?').get(staffId);

  // 查找本轮第一次非复查的已完成 session（原始不合格记录）
  const originalSess = db.prepare(`
    SELECT id, total_score FROM sessions
    WHERE staff_id=? AND cycle_id=? AND completed=1
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0 AND COALESCE(is_remediation,0)=0
    ORDER BY id ASC LIMIT 1
  `).get(staffId, cycleId);
  if (!originalSess) return res.status(400).json({ error: '未找到本轮已完成的答题记录' });
  if (originalSess.total_score >= 60) return res.status(400).json({ error: '该人员本轮成绩已合格，无需复查' });

  const nowAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');

  // 写入复查台账（已有则更新）
  const existing = db.prepare('SELECT id FROM remediation_records WHERE staff_id=? AND cycle_id=?').get(staffId, cycleId);
  if (existing) {
    db.prepare(`UPDATE remediation_records SET original_session_id=?, original_score=?, authorized_by=?, authorized_at=?, remediation_session_id=NULL, remediation_score=NULL, result='pending' WHERE id=?`)
      .run(originalSess.id, originalSess.total_score, req.adminName, nowAt, existing.id);
  } else {
    db.prepare(`INSERT INTO remediation_records (staff_id,cycle_id,original_session_id,original_score,authorized_by,authorized_at) VALUES (?,?,?,?,?,?)`)
      .run(staffId, cycleId, originalSess.id, originalSess.total_score, req.adminName, nowAt);
  }

  // 重置本轮 session（原始记录置 is_deleted=1）
  db.prepare(`UPDATE sessions SET is_deleted=1 WHERE staff_id=? AND cycle_id=? AND COALESCE(is_deleted,0)=0 AND COALESCE(is_practice,0)=0 AND COALESCE(is_remediation,0)=0`)
    .run(staffId, cycleId);

  // 写入复查授权（60分钟有效）
  db.prepare(`INSERT OR REPLACE INTO remediation_grants (staff_id,cycle_id,granted_by,expires_at) VALUES (?,?,?,?)`)
    .run(staffId, cycleId, req.adminName, expiresAt);

  logAdmin('复查授权', `${staff?.name||staffId}(${staffId}) 原始分=${originalSess.total_score} 有效至 ${expiresAt}`, req.adminName);
  res.json({ ok: true, staffId, originalScore: originalSess.total_score, expiresAt });
});

// ─── 复查台账查询 ──────────────────────────────────────────────────────────
router.get('/api/admin/remediation/records', adminAuth, (req, res) => {
  const month = req.query.month || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
  const rows = db.prepare(`
    SELECT rr.id, rr.staff_id, COALESCE(s.real_name,s.name) as name,
           rr.cycle_id, rr.original_score, rr.authorized_by, rr.authorized_at,
           rr.remediation_score, rr.result, rr.created_at
    FROM remediation_records rr
    LEFT JOIN staff s ON s.id=rr.staff_id
    WHERE strftime('%Y-%m', rr.created_at)=?
    ORDER BY rr.created_at DESC
  `).all(month);
  res.json(rows);
});

// ─── 复查台账导出 Excel ────────────────────────────────────────────────────
router.get('/api/admin/remediation/export', adminAuth, async (req, res) => {
  const months = req.query.months ? req.query.months.split(',').filter(Boolean) : [];
  if (!months.length) {
    months.push(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7));
  }

  const placeholders = months.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT rr.staff_id, COALESCE(s.real_name,s.name) as name,
           rr.cycle_id, rr.original_score, rr.authorized_by, rr.authorized_at,
           rr.remediation_score, rr.result, rr.created_at
    FROM remediation_records rr
    LEFT JOIN staff s ON s.id=rr.staff_id
    WHERE strftime('%Y-%m', rr.created_at) IN (${placeholders})
    ORDER BY rr.created_at ASC
  `).all(...months);

  const wb = new ExcelJS.Workbook();
  wb.creator = '武汉地铁5号线乘务工班组';
  const hStyle = {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6E' } },
    font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }
  };

  const ws = wb.addWorksheet('复查台账', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '工号',     key: 'staff_id',        width: 10 },
    { header: '姓名',     key: 'name',             width: 8  },
    { header: '套班轮次', key: 'cycle_id',         width: 14 },
    { header: '初试时间', key: 'created_at',       width: 18 },
    { header: '初试分',   key: 'original_score',   width: 8  },
    { header: '授权人',   key: 'authorized_by',    width: 10 },
    { header: '授权时间', key: 'authorized_at',    width: 18 },
    { header: '复查分',   key: 'remediation_score',width: 8  },
    { header: '结果',     key: 'result_label',     width: 10 },
  ];
  ws.getRow(1).eachCell(c => Object.assign(c, hStyle));
  ws.getRow(1).height = 26;

  const resultLabel = r => r === 'pass' ? '合格' : r === 'fail' ? '不合格' : '待复查';
  const resultColor = r => r === 'pass' ? 'FFD4EDDA' : r === 'fail' ? 'FFF8D7DA' : 'FFFFF3CD';

  for (const row of rows) {
    const r = ws.addRow({
      ...row,
      original_score: row.original_score != null ? Math.round(row.original_score) : '—',
      remediation_score: row.remediation_score != null ? Math.round(row.remediation_score) : '—',
      result_label: resultLabel(row.result),
    });
    r.height = 24;
    r.eachCell(c => { c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
    // 初试分：红色背景
    const scoreCell = r.getCell('original_score');
    scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    scoreCell.font = { bold: true, color: { argb: 'FF9B1C1C' } };
    // 结果：颜色区分
    const resCell = r.getCell('result_label');
    resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: resultColor(row.result) } };
    resCell.font = { bold: true };
  }

  const label = months.length === 1 ? months[0] : `${months[0]}至${months[months.length - 1]}`;
  const encodedLabel = encodeURIComponent(`复查台账_${label}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedLabel}.xlsx`);
  await wb.xlsx.write(res); res.end();
});

// ─── DingTalk: 抽问开始通知 ────────────────────────────────────────────────
router.post('/api/admin/dingtalk/notify-start', adminAuth, async (req, res) => {
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
    logAdmin('钉钉通知', `抽问开始通知已发送，共${questions.length}题`, req.adminName);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DingTalk: 培训计划通知（次日预告 / 当天提醒）─────────────────────────────

// 教员生成自己的快捷入口链接
router.post('/api/magic-link', workshopEditAuth, (req, res) => {
  const staffId = req.instructorId || null;
  if (!staffId) return res.status(400).json({ error: '需要教员身份' });
  const target = req.body?.target || 'workshop';
  const token = generateMagicToken(staffId, target);
  const base = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';
  res.json({ ok: true, url: `${base}/go?t=${token}` });
});

// 跳转落地页（服务端渲染，写 sessionStorage 后重定向到 SPA）
router.get('/go', (req, res) => {
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

// 夜班 15:00：推送次日早班培训预告
router.post('/api/admin/dingtalk/notify-training-preview', adminAuth, async (req, res) => {
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
    await sendDingTalkCard({ title: '🔔 明日早班培训提醒', bodyLines, plan, logTag: `次日培训预告：${tomorrowStr}`, operator: req.adminName });
    res.json({ ok: true, date: tomorrowStr });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 早班 08:30：推送当天培训提醒
router.post('/api/admin/dingtalk/notify-training-reminder', adminAuth, async (req, res) => {
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
    await sendDingTalkCard({ title: '📣 今日早班培训通知', bodyLines, plan, logTag: `当天培训提醒：${todayStr}`, operator: req.adminName });
    res.json({ ok: true, date: todayStr });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Batch: delete today's sessions ────────────────────────────────────────
router.delete('/api/admin/sessions/today', adminAuth, (req, res) => {
  const info = db.prepare("UPDATE sessions SET is_deleted=1 WHERE date(created_at)=date('now','localtime')").run();
  logAdmin('清除今日数据', `软删除 ${info.changes} 条答题记录`, req.adminName);
  res.json({ ok: true, deleted: info.changes });
});

// ─── Batch: update staff identity ──────────────────────────────────────────
router.put('/api/admin/staff/batch-identity', adminAuth, (req, res) => {
  const { ids, is_tester, is_exempt, is_cp } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择人员' });
  const stmt = db.prepare('UPDATE staff SET is_tester=?, is_exempt=?, is_cp=? WHERE id=?');
  const delGroup = db.prepare('DELETE FROM training_group_members WHERE staff_id=?');
  const delFixed = db.prepare('DELETE FROM training_fixed_members WHERE staff_id=?');
  const run = db.transaction(() => {
    ids.forEach(id => {
      stmt.run(is_tester?1:0, is_exempt?1:0, is_cp?1:0, id);
      if (is_cp) { delGroup.run(id); delFixed.run(id); }
    });
  });
  run();
  logAdmin('批量修改身份', `${ids.length}人 → 测试:${is_tester?'是':'否'} 免答:${is_exempt?'是':'否'} 车峰:${is_cp?'是':'否'}`, req.adminName);
  res.json({ ok: true });
});

// ─── Admin Logs ────────────────────────────────────────────────────────────
router.get('/api/admin/logs', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 300').all();
  res.json(rows);
});

// ─── Session hide / delete ─────────────────────────────────────────────────
router.put('/api/admin/sessions/:id/hide', adminAuth, (req, res) => {
  const { hidden } = req.body;
  db.prepare('UPDATE sessions SET hidden=? WHERE id=?').run(hidden ? 1 : 0, req.params.id);
  logAdmin(hidden ? '隐藏成绩' : '恢复成绩', `session_id=${req.params.id}`, req.adminName);
  res.json({ ok: true });
});
router.delete('/api/admin/sessions/:id', adminAuth, (req, res) => {
  const sess = db.prepare('SELECT staff_name FROM sessions WHERE id=?').get(req.params.id);
  db.prepare('UPDATE sessions SET is_deleted=1 WHERE id=?').run(req.params.id);
  logAdmin('删除成绩', `session_id=${req.params.id} ${sess?.staff_name||''}`, req.adminName);
  res.json({ ok: true });
});

// 删除某人在某套班（cycle）或今日的全部成绩
router.delete('/api/admin/sessions/staff/:staffId', adminAuth, (req, res) => {
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
  logAdmin('删除人员套班成绩', `${staffName}(${staffId}) cycle=${cycle_id||'今日'} 共${sessionIds.length}条`, req.adminName);
  res.json({ ok: true, deleted: sessionIds.length });
});

// ─── 搜索所有题目（供手动选题）────────────────────────────────────────────
router.get('/api/admin/questions/all', adminAuth, (req, res) => {
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
router.post('/api/admin/questions/ai-generate', adminAuth, async (req, res) => {
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
      logAdmin('AI生成题目', `题库ID=${bank_id} 生成${questions.length}题`, req.adminName);
      return res.json({ ok: true, questions, ids });
    }
    res.json({ ok: true, questions, ids: [] });
  } catch(e) { res.status(500).json({ error: 'AI生成失败: ' + e.message }); }
});

// ─── 批量保存题目（智能出题预览确认后调用）────────────────────────────────
router.post('/api/admin/questions/batch-save', adminAuth, (req, res) => {
  const { questions, bank_id, bank_name, bank_type } = req.body;
  if (!Array.isArray(questions) || questions.length === 0)
    return res.status(400).json({ error: '题目列表为空' });
  const VALID_TYPES = new Set(['emergency','event','knowledge','compliance','theory']);
  const safeType = VALID_TYPES.has(bank_type) ? bank_type : 'knowledge';
  let targetBankId = parseInt(bank_id) || null;
  if (bank_name?.trim()) {
    const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count, bank_type) VALUES (?,?,?,?)').run(bank_name.trim(), '简答', 3, safeType);
    targetBankId = r.lastInsertRowid;
    logAdmin('新建题库', `${bank_name.trim()} [${safeType}]`, req.adminName);
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
  logAdmin('批量保存题目', `题库ID=${targetBankId} 保存${ids.length}题`, req.adminName);
  res.json({ ok: true, count: ids.length, ids, bankId: targetBankId });
});

// ─── 手动选题（管理员指定本次答题题目）───────────────────────────────────
router.get('/api/admin/pinned-questions', adminAuth, (req, res) => {
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
      const qs = db.prepare(`SELECT id, text, reference, category FROM questions WHERE id IN (${placeholders})`).all(...pinned.ids);
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
router.put('/api/admin/pinned-questions', adminAuth, (req, res) => {
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
  logAdmin('设置手动选题', `${ids?.length||0}题 scope=${scope} bank_ids=${JSON.stringify(bank_ids||[])}`, req.adminName);
  res.json({ ok: true });
});

// ─── 题库 Excel/CSV 导入 ────────────────────────────────────────────────────
router.post('/api/admin/banks/import', adminAuth, upload.single('file'), async (req, res) => {
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
    logAdmin('新建题库', `${bank_name.trim()}${isMCQ?' [选择题]':''}`, req.adminName);
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
  logAdmin('导入题库', `题库ID=${targetBankId} 导入${count}题${isMCQ?' [选择题]':''}${dropStr}${debugStr} answerBase=${answerBase}`, req.adminName);
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

// 结构提取模式：以文档标题/条款为题目，对应内容为答案
function buildStructureExtractPrompt(text, maxCount = 8) {
  return `你是武汉地铁乘务培训专家。以下是一份培训材料原文。请识别其中所有有明确标题（条款编号或标题文字）的知识点，将标题改写为简洁问句作为题目，将对应正文内容作为参考答案。

【要求】
- 参考答案只能来自原文，不得添加原文中没有的内容
- 每个知识点独立一道题，最多 ${maxCount} 道，优先选取内容最完整的
- 答案各要点用分号分隔
- 关键词从原文摘取2~4个核心词

只返回JSON数组，格式：[{"text":"题目内容","reference":"要点1;要点2;要点3","keywords":"关键词1,关键词2","category":"业务知识"}]

培训材料原文：
${text.slice(0, 8000)}`;
}

// 安全事件固定3题模板
const EVENT_TEMPLATES = ['请简要描述事件发生的经过', '本次事件中乘务员存在哪些问题？', '针对本次事件，整改措施有哪些？'];

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

router.post('/api/admin/banks/parse-doc', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  const KEY = process.env.DASHSCOPE_API_KEY;
  if (!KEY) return res.status(503).json({ error: '未配置DASHSCOPE_API_KEY' });

  const { bank_id, bank_name, count = 5, mode = 'auto', custom_questions, paste_text, dest_cat } = req.body;
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
      } else if (dest_cat === 'event') {
        imgPrompt = `你是武汉地铁乘务安全培训助手。请识别图片中的文字内容，然后为以下3道固定题目提取参考答案。

固定题目（必须全部返回，共3道）：
1. 请简要描述事件发生的经过
2. 本次事件中乘务员存在哪些问题？
3. 针对本次事件，整改措施有哪些？

【要求】
- text 字段必须把事件名称嵌入题目（从图片提炼：日期+线路/地点+事件类型，如"2026年3月XX日XX站XX事件"）
  例如："请简要描述[事件名称]发生的经过"，"在[事件名称]中，乘务员存在哪些问题？"
- 参考答案只来自图片内容，找不到则留""，答案各要点用分号分隔
- category统一填"安全事件"，docType填"incident"

只返回JSON数组（3个元素），格式：
[{"text":"含事件名称的题目","reference":"要点1;要点2","keywords":"词1,词2","category":"安全事件","docType":"incident"}]`;
      } else {
        imgPrompt = `你是武汉地铁乘务培训专家。请识别图片中的文字内容，提取所有有明确标题或条款编号的知识点，将标题改写为简洁问句作为题目，对应内容作为参考答案。

【要求】
- 参考答案只来自图片内容，答案各要点用分号分隔
- 最多返回8道题，优先选内容完整的知识点
- 关键词从原文摘取2~4个核心词，docType填"general"

只返回JSON数组，格式：[{"text":"题目内容","reference":"要点1;要点2","keywords":"关键词1,关键词2","category":"业务知识","docType":"general"}]`;
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
      let prompt;
      if (mode === 'custom') {
        const isIncident = isIncidentReport(extractedText) || dest_cat === 'event';
        prompt = buildCustomQuestionsPrompt(extractedText, customList, isIncident);
      } else if (dest_cat === 'event') {
        prompt = buildCustomQuestionsPrompt(extractedText, EVENT_TEMPLATES, true);
      } else {
        prompt = buildStructureExtractPrompt(extractedText, Math.min(parseInt(count) || 8, 10));
      }
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

    // 将 AI 自由命名的分类映射到标准分类，避免碎片化
    const STANDARD_CATS_SET = new Set(['安全事件', '应急处置', '故障处置', '业务知识', '设备操作', '规章制度', '隐患排查']);
    const catFallback = (raw) => {
      if (!raw) return '业务知识';
      if (STANDARD_CATS_SET.has(raw)) return raw;
      if (/安全|事故|事件/.test(raw)) return '安全事件';
      if (/应急|故障|处置/.test(raw)) return '应急处置';
      if (/设备|装置|系统|操作/.test(raw)) return '设备操作';
      if (/规章|制度|规定|法规/.test(raw)) return '规章制度';
      if (/隐患|风险|排查/.test(raw)) return '隐患排查';
      return '业务知识';
    };
    questions.forEach(q => { q.category = catFallback(q.category); });

    // 若指定了题库，直接保存
    let savedIds = [];
    let targetBankId = parseInt(bank_id) || null;
    if (bank_name?.trim()) {
      const r = db.prepare('INSERT INTO question_banks (name, q_type, default_count) VALUES (?,?,?)').run(bank_name.trim(), '简答', 3);
      targetBankId = r.lastInsertRowid;
      logAdmin('新建题库', bank_name.trim(), req.adminName);
    }
    if (targetBankId) {
      const stmt = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category) VALUES (?,?,?,?,?)');
      db.transaction(() => {
        questions.forEach(q => {
          const r = stmt.run(targetBankId, q.text, q.reference, q.keywords || '', q.category || '业务知识');
          savedIds.push(r.lastInsertRowid);
        });
      })();
      logAdmin('智能出题保存', `题库ID=${targetBankId} 生成${questions.length}题 docType=${docType}`, req.adminName);
    }

    res.json({ ok: true, questions, docType, ids: savedIds, extractedText: (extractedText||'').slice(0, 3000) });
  } catch (e) {
    res.status(500).json({ error: '处理失败: ' + e.message });
  }
});

// ─── Alltime leaderboard full list (admin) ─────────────────────────────────
router.get('/api/admin/leaderboard/cycle', adminAuth, (req, res) => {
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
router.get('/api/admin/leaderboard/alltime', adminAuth, (req, res) => {
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
router.get('/api/export/months', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', created_at) as month
    FROM sessions WHERE completed=1
    ORDER BY month DESC
  `).all();
  res.json(rows.map(r => r.month));
});

// 多月合并导出（抽问记录）：每个月一个答题明细 Sheet + 一个合并人员汇总 Sheet
router.get('/api/export/multi', adminAuth, async (req, res) => {
  const monthsParam = req.query.months;
  if (!monthsParam) return res.status(400).json({ error: '请指定月份' });
  const months = monthsParam.split(',').filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
  if (!months.length) return res.status(400).json({ error: '无有效月份' });

  const wb = new ExcelJS.Workbook();
  wb.creator = '武汉地铁5号线乘务工班组';
  const hStyle = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1B3A6E'}}, font:{color:{argb:'FFFFFFFF'},bold:true,size:11}, alignment:{vertical:'middle',horizontal:'center',wrapText:true} };
  const answerCols = [
    {header:'工号',key:'staff_id',width:10},{header:'姓名',key:'staff_name',width:8},
    {header:'时间',key:'created_at',width:18},{header:'题目',key:'question_text',width:38},
    {header:'分类',key:'category',width:10},{header:'作答',key:'answer_text',width:45},
    {header:'得分',key:'score',width:7},{header:'等级',key:'level',width:7},
    {header:'遗漏要点',key:'missing',width:30},{header:'建议',key:'suggestion',width:35},
  ];

  for (const month of months) {
    const label = month.slice(5) + '月答题';
    const ws = wb.addWorksheet(label, { views:[{state:'frozen',ySplit:1}] });
    ws.columns = answerCols;
    ws.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws.getRow(1).height=26;

    const answers = db.prepare(
      "SELECT a.*,s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id WHERE strftime('%Y-%m',a.created_at)=? ORDER BY a.created_at DESC"
    ).all(month);
    answers.forEach(a=>{
      let miss=a.missing_points; try{miss=JSON.parse(a.missing_points).join('；');}catch{}
      const row = ws.addRow({...a, missing:miss});
      row.height=36; row.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};});
      const sc=row.getCell('score');
      sc.fill={type:'pattern',pattern:'solid',fgColor:{argb:a.score>=85?'FFD4EDDA':a.score>=60?'FFFFF3CD':'FFF8D7DA'}};
      sc.font={bold:true};
    });
  }

  // 合并人员汇总 Sheet
  const wsSummary = wb.addWorksheet('人员汇总', { views:[{state:'frozen',ySplit:1}] });
  wsSummary.columns=[
    {header:'姓名',key:'name',width:8},{header:'工号',key:'id',width:10},
    {header:'答题天数',key:'days',width:10},{header:'总积分',key:'pts',width:10},
    {header:'平均分',key:'avg',width:10},{header:'最近答题',key:'last',width:18},
  ];
  wsSummary.getRow(1).eachCell(c=>Object.assign(c,hStyle)); wsSummary.getRow(1).height=26;
  const placeholders = months.map(()=>'?').join(',');
  const members = db.prepare(
    `SELECT s.id,s.name,COUNT(DISTINCT date(ss.created_at)) as days,SUM(ss.total_points) as pts,ROUND(AVG(ss.total_score),1) as avg,MAX(ss.created_at) as last
     FROM staff s LEFT JOIN sessions ss ON ss.staff_id=s.id AND ss.completed=1 AND COALESCE(ss.is_deleted,0)=0
       AND strftime('%Y-%m',ss.created_at) IN (${placeholders})
     GROUP BY s.id ORDER BY pts DESC NULLS LAST`
  ).all(...months);
  members.forEach(m=>{ const r=wsSummary.addRow({...m}); r.height=24; r.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'center'};}); });

  const label = months.length===1 ? months[0] : `${months[0]}至${months[months.length-1]}`;
  const encodedLabel = encodeURIComponent(`答题记录_${label}`);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodedLabel}.xlsx`);
  await wb.xlsx.write(res); res.end();
});

router.get('/api/export', adminAuth, async (req, res) => {
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
router.get('/api/export/workshop/months', adminAuth, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT year_month FROM monthly_training_plans ORDER BY year_month DESC").all();
  res.json(rows.map(r => r.year_month));
});

// 返回所有培训计划列表（用于勾选导出，教员/管理员均可查）
router.get('/api/export/workshop/plans', workshopEditAuth, (req, res) => {
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

router.get('/api/export/workshop', adminAuth, async (req, res) => {
  const month = req.query.month;
  const idsParam = req.query.ids; // 逗号分隔的 plan id 列表
  const monthsParam = req.query.months; // 多月合并：逗号分隔 YYYY-MM，每月一个 Sheet
  if (!month && !idsParam && !monthsParam) return res.status(400).json({ error: '请指定月份或计划ID' });

  const wb = new ExcelJS.Workbook();
  wb.creator = '武汉地铁5号线乘务工班组';
  const hStyle = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1B3A6E'}}, font:{color:{argb:'FFFFFFFF'},bold:true,size:11}, alignment:{vertical:'middle',horizontal:'center',wrapText:true} };

  // ── 多月合并模式：每个月一个 Sheet ──────────────────────────────────────────
  if (monthsParam) {
    const selectedMonths = monthsParam.split(',').filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
    if (!selectedMonths.length) return res.status(400).json({ error: '无有效月份' });
    const allGroups = db.prepare("SELECT g.*, s.real_name as ins_name FROM training_groups g LEFT JOIN staff s ON s.id=g.instructor_id").all();
    const groupMap = {}; allGroups.forEach(g=>{ groupMap[g.id]=g; });

    const sheetCols = [
      {header:'日期',key:'shift_date',width:12},{header:'类型',key:'plan_type',width:8},
      {header:'小组',key:'group_name',width:10},{header:'教员',key:'instructor',width:8},
      {header:'班组长',key:'leader',width:8},{header:'地点',key:'location',width:10},
      {header:'应到',key:'total',width:7},{header:'实到',key:'checked',width:7},
      {header:'已完成内容',key:'completed',width:28},{header:'备注',key:'notes',width:20},
    ];
    const typeArgb = t => t==='轮空'?'FFE5E7EB':t==='中旬会'?'FFFFF3CD':t==='理论'?'FFE0F2FE':'FFD1FAE5';

    for (const ym of selectedMonths) {
      const sheetName = ym.slice(5) + '月培训';
      const ws = wb.addWorksheet(sheetName, { views:[{state:'frozen',ySplit:1}] });
      ws.columns = sheetCols;
      ws.getRow(1).eachCell(c=>Object.assign(c,hStyle)); ws.getRow(1).height=26;

      const monthPlans = db.prepare("SELECT * FROM monthly_training_plans WHERE year_month=? ORDER BY shift_date").all(ym);
      const monthPlanIds = monthPlans.map(p=>p.id);

      // 出勤汇总
      const attMap = {};
      if (monthPlanIds.length) {
        db.prepare(`SELECT plan_id, COUNT(*) as total, SUM(instructor_confirmed) as checked FROM training_attendance WHERE plan_id IN (${monthPlanIds.map(()=>'?').join(',')}) GROUP BY plan_id`).all(...monthPlanIds)
          .forEach(r=>{ attMap[r.plan_id]={total:r.total,checked:r.checked||0}; });
      }

      monthPlans.forEach(p => {
        const g = p.group_id ? groupMap[p.group_id] : null;
        let notesStr = p.notes || '';
        if (p.plan_type === '中旬会' && notesStr) {
          try { const arr = JSON.parse(notesStr); notesStr = arr.map(e=>`${e.staffName} ${e.type}`).join('；'); } catch(e) {}
        }
        let completedStr = '';
        try { const arr = JSON.parse(p.completed_items||'[]'); completedStr = arr.join('、'); } catch(e) {}
        const att = attMap[p.id] || {};
        const row = ws.addRow({
          shift_date: p.shift_date, plan_type: p.plan_type,
          group_name: g?.name || '', instructor: g?.ins_name || '',
          leader: p.leader_name || '', location: p.location || '',
          total: att.total || '', checked: att.checked || '',
          completed: completedStr, notes: notesStr,
        });
        row.height = 28; row.eachCell(c=>{ c.alignment={vertical:'middle',wrapText:true}; });
        const tc = row.getCell('plan_type');
        tc.fill = {type:'pattern',pattern:'solid',fgColor:{argb:typeArgb(p.plan_type)}};
        tc.font = {bold:true};
      });
    }

    const ymLabel = selectedMonths.length===1 ? selectedMonths[0] : `${selectedMonths[0]}至${selectedMonths[selectedMonths.length-1]}`;
    const encodedLabel = encodeURIComponent(`车间培训记录_${ymLabel}`);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodedLabel}.xlsx`);
    await wb.xlsx.write(res); return res.end();
  }

  // ── 原有单月 / 按ID导出逻辑 ─────────────────────────────────────────────
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
router.get('/api/qrcode', async (req, res) => {
  let url = process.env.PUBLIC_URL;
  if (!url) {
    const nets = os.networkInterfaces(); let ip='localhost';
    for(const n of Object.values(nets)) for(const i of n) if(i.family==='IPv4'&&!i.internal){ip=i.address;break;}
    url = `http://${ip}:${PORT}`;
  }
  const qr=await QRCode.toDataURL(url,{width:300,margin:2,color:{dark:'#1b3a6e',light:'#ffffff'}});
  res.json({url,qr});
});

router.post('/api/admin/login',(req,res)=>{ _adminMap[req.body.password]?res.json({ok:true}):res.status(401).json({error:'密码错误'}); });
// ─── 讯飞 TTS ──────────────────────────────────────────────────────────────
router.post('/api/tts', async (req, res) => {
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


module.exports = router;
