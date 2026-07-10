const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, PHOTO_DIR } = require('../db');
const { adminAuth, workshopEditAuth, logAdmin, LEADER_ROTATION } = require('../middleware');
const { getTrainingPlanForDate, getSetting } = require('../helpers');
const { fmtDate, sendGroupPush, getPlanMemberNames } = require('../push');

const router = express.Router();

// ─── 培训小组 API（GET 必须在 catch-all 之前）──────────────────────────────────
// 全局固定培训人员列表
router.get('/api/admin/training-fixed-members', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT staff_id FROM training_fixed_members').all();
  res.json(rows.map(r => r.staff_id));
});

router.put('/api/admin/training-fixed-members', adminAuth, (req, res) => {
  const { staff_ids } = req.body;
  if (!Array.isArray(staff_ids)) return res.status(400).json({ error: 'staff_ids 必须是数组' });
  db.transaction(() => {
    db.prepare('DELETE FROM training_fixed_members').run();
    const ins = db.prepare('INSERT INTO training_fixed_members (staff_id) VALUES (?)');
    staff_ids.forEach(id => ins.run(String(id)));
  })();
  logAdmin('固定人员更新', `共${staff_ids.length}人: ${staff_ids.join(',')}`, req.adminName);
  res.json({ ok: true, count: staff_ids.length });
});

// 查询所有培训小组（含成员）
router.get('/api/admin/training-groups', adminAuth, (req, res) => {
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
  const rawLeaders = db.prepare("SELECT id, real_name, name FROM staff WHERE is_leader=1").all();
  const leaders = [
    ...LEADER_ROTATION.map(n => rawLeaders.find(l => (l.real_name||l.name) === n)).filter(Boolean),
    ...rawLeaders.filter(l => !LEADER_ROTATION.includes(l.real_name||l.name))
  ];
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

  // 起始小组 & 班组长：优先读本月设置，无则从上月最后一个"培训"行自动推算
  let groupIdx = 0;
  let startLeaderIdx = 0;

  if (setting?.start_group_id != null) {
    const idx = groups.findIndex(g => g.id == setting.start_group_id);
    groupIdx = idx >= 0 ? idx : 0;
    startLeaderIdx = setting.start_leader_idx ?? 0;
  } else {
    // 从上月末尾自动接续
    const [y, mo] = yearMonth.split('-').map(Number);
    const prevMonth = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
    const lastRow = db.prepare(
      "SELECT group_id, leader_name FROM monthly_training_plans WHERE year_month=? AND plan_type='培训' ORDER BY shift_date DESC LIMIT 1"
    ).get(prevMonth);
    if (lastRow) {
      if (lastRow.group_id && groups.length > 0) {
        const li = groups.findIndex(g => g.id == lastRow.group_id);
        groupIdx = li >= 0 ? (li + 1) % groups.length : 0;
      }
      if (lastRow.leader_name && leaders.length > 0) {
        const li = leaders.findIndex(l => (l.real_name || l.name) === lastRow.leader_name);
        startLeaderIdx = li >= 0 ? (li + 1) % leaders.length : 0;
      }
    }
  }

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
  const rawLeaderStaff = db.prepare("SELECT id, real_name, name FROM staff WHERE is_leader=1").all();
  const leaderStaff = [
    ...LEADER_ROTATION.map(n => rawLeaderStaff.find(l => (l.real_name||l.name) === n)).filter(Boolean),
    ...rawLeaderStaff.filter(l => !LEADER_ROTATION.includes(l.real_name||l.name))
  ];
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
router.get('/api/workshop/training-plan', (req, res) => {
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
router.put('/api/admin/training-plan/settings', adminAuth, (req, res) => {
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
router.post('/api/admin/training-plan/regenerate', adminAuth, (req, res) => {
  const yearMonth = (req.body.month) || new Date().toISOString().slice(0, 7);
  db.prepare('DELETE FROM monthly_training_plans WHERE year_month=?').run(yearMonth);
  const rows = generatePlan(yearMonth);
  const ins = db.prepare('INSERT OR IGNORE INTO monthly_training_plans (year_month,shift_date,location,plan_type,group_id,leader_name,is_type_custom,notes) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => rows.forEach(r => ins.run(r.year_month,r.shift_date,r.location,r.plan_type,r.group_id,r.leader_name,r.is_type_custom,r.notes)))();
  res.json({ ok: true });
});

// 互换两行的小组和类型
router.put('/api/admin/training-plan/swap', workshopEditAuth, (req, res) => {
  const { id1, id2 } = req.body;
  const p1 = db.prepare('SELECT * FROM monthly_training_plans WHERE id=?').get(id1);
  const p2 = db.prepare('SELECT * FROM monthly_training_plans WHERE id=?').get(id2);
  if (!p1 || !p2) return res.status(404).json({ error: '记录不存在' });
  const ov1 = db.prepare('SELECT * FROM training_plan_member_overrides WHERE plan_id=?').all(id1);
  const ov2 = db.prepare('SELECT * FROM training_plan_member_overrides WHERE plan_id=?').all(id2);
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const entryFor1 = `${today} 与${p2.shift_date.slice(5)}整体对调`;
  const entryFor2 = `${today} 与${p1.shift_date.slice(5)}整体对调`;
  const appendLog = (existing, entry) => (existing ? existing + '\n' : '') + entry;
  db.transaction(() => {
    // location 由日期星期决定，不随内容互换，各自保持原日期对应的地点
    db.prepare(`UPDATE monthly_training_plans SET group_id=?,plan_type=?,leader_name=?,location=?,notes=?,instructor_id_override=?,change_log=?,is_type_custom=1 WHERE id=?`)
      .run(p2.group_id, p2.plan_type, p2.leader_name, getLocation(p1.shift_date), p2.notes, p2.instructor_id_override, appendLog(p2.change_log, entryFor1), id1);
    db.prepare(`UPDATE monthly_training_plans SET group_id=?,plan_type=?,leader_name=?,location=?,notes=?,instructor_id_override=?,change_log=?,is_type_custom=1 WHERE id=?`)
      .run(p1.group_id, p1.plan_type, p1.leader_name, getLocation(p2.shift_date), p1.notes, p1.instructor_id_override, appendLog(p1.change_log, entryFor2), id2);
    db.prepare('DELETE FROM training_plan_member_overrides WHERE plan_id IN (?,?)').run(id1, id2);
    const ins = db.prepare(`INSERT INTO training_plan_member_overrides (plan_id,staff_id,action,note,created_at) VALUES (?,?,?,?,?)`);
    for (const o of ov1) ins.run(id2, o.staff_id, o.action, o.note, o.created_at);
    for (const o of ov2) ins.run(id1, o.staff_id, o.action, o.note, o.created_at);
  })();
  const opId = req.instructorId;
  const opStaff = opId ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId) : null;
  const opName = opStaff?.real_name || opStaff?.name || '管理员';
  const nowTime = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  sendGroupPush([`${nowTime}  ${opName}`, `将${fmtDate(p1.shift_date)}与${fmtDate(p2.shift_date)}整体对调`].join('\n'));
  res.json({ ok: true });
});

// ─── 整批延后：把某计划全体组员移到另一日期 ──────────────────────────────────
router.post('/api/admin/training-plan/bulk-postpone', workshopEditAuth, (req, res) => {
  const { from_plan_id, to_plan_id } = req.body;
  if (!from_plan_id || !to_plan_id) return res.status(400).json({ error: '参数不完整' });
  const fromPlan = db.prepare('SELECT * FROM monthly_training_plans WHERE id=?').get(from_plan_id);
  const toPlan   = db.prepare('SELECT shift_date FROM monthly_training_plans WHERE id=?').get(to_plan_id);
  if (!fromPlan || !toPlan) return res.status(404).json({ error: '计划不存在' });
  const fixedIds = new Set(db.prepare('SELECT staff_id FROM training_fixed_members').all().map(f => String(f.staff_id)));
  const group = fromPlan.group_id ? db.prepare('SELECT instructor_id FROM training_groups WHERE id=?').get(fromPlan.group_id) : null;
  const instructorId = group?.instructor_id ? String(group.instructor_id) : null;
  const baseMembers = fromPlan.group_id
    ? db.prepare('SELECT staff_id FROM training_group_members WHERE group_id=?').all(fromPlan.group_id) : [];
  const existOv = db.prepare('SELECT * FROM training_plan_member_overrides WHERE plan_id=?').all(from_plan_id);
  const removedIds = new Set(existOv.filter(o => o.action === 'remove').map(o => String(o.staff_id)));
  const addedIds = existOv.filter(o => o.action === 'add').map(o => o.staff_id);
  const effectiveIds = [
    ...baseMembers.filter(m => !fixedIds.has(String(m.staff_id)) && String(m.staff_id) !== instructorId && !removedIds.has(String(m.staff_id))).map(m => m.staff_id),
    ...addedIds.filter(id => !fixedIds.has(String(id)))
  ];
  if (effectiveIds.length === 0) return res.status(400).json({ error: '该计划无可移动的组员' });
  const names = effectiveIds.map(id => { const s = db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(id); return s?.real_name || s?.name || id; });
  const fromDate = fromPlan.shift_date, toDate = toPlan.shift_date;
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO training_plan_member_overrides (plan_id,staff_id,action,note,created_at) VALUES (?,?,?,?,?) ON CONFLICT(plan_id,staff_id) DO UPDATE SET action=excluded.action,note=excluded.note,created_at=excluded.created_at`);
  db.transaction(() => {
    for (const staffId of effectiveIds) {
      upsert.run(from_plan_id, staffId, 'remove', `${today} 全员延后至${toDate.slice(5)}`, now);
      upsert.run(to_plan_id, staffId, 'add', `${today} 从${fromDate.slice(5)}延后加入`, now);
    }
    const logF = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(from_plan_id);
    const logT = db.prepare('SELECT change_log FROM monthly_training_plans WHERE id=?').get(to_plan_id);
    db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logF?.change_log ? logF.change_log + '\n' : '') + `${today} 全员（${names.join('、')}）延后至${toDate.slice(5)}`, from_plan_id);
    db.prepare('UPDATE monthly_training_plans SET change_log=? WHERE id=?').run((logT?.change_log ? logT.change_log + '\n' : '') + `${today} 从${fromDate.slice(5)}延后加入：${names.join('、')}`, to_plan_id);
  })();
  const opId = req.instructorId;
  const opStaff = opId ? db.prepare('SELECT real_name,name FROM staff WHERE id=?').get(opId) : null;
  const opName = opStaff?.real_name || opStaff?.name || '管理员';
  const nowTime = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  const membersTo = getPlanMemberNames(to_plan_id).join('、');
  sendGroupPush([`${nowTime}  ${opName}`, `将${fmtDate(fromDate)}全组（${names.join('、')}）延后至${fmtDate(toDate)}`, '', `${fmtDate(toDate)}培训人员：${membersTo}`].join('\n'));
  res.json({ ok: true, movedCount: effectiveIds.length });
});

// 修改单行
router.put('/api/admin/training-plan/:id', workshopEditAuth, (req, res) => {
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
router.patch('/api/workshop/training-plan/:id/completed-items', workshopEditAuth, (req, res) => {
  const { items } = req.body; // string[]
  db.prepare('UPDATE monthly_training_plans SET completed_items=? WHERE id=?')
    .run(JSON.stringify(Array.isArray(items)?items:[]), req.params.id);
  res.json({ ok: true });
});

// ─── 成员调换：替换（两人互换）────────────────────────────────────────────────
router.post('/api/admin/training-plan/member-swap', workshopEditAuth, (req, res) => {
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
router.post('/api/admin/training-plan/member-postpone', workshopEditAuth, (req, res) => {
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
router.post('/api/admin/training-plan/member-remove', workshopEditAuth, (req, res) => {
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
router.post('/api/admin/training-plan/instructor-swap', workshopEditAuth, (req, res) => {
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
router.use('/training-imports', express.static(IMPORT_DIR));

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/api/admin/training-imports', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT id,filename,original_name,uploaded_at,parse_status FROM training_import_files ORDER BY uploaded_at DESC').all());
});

router.post('/api/admin/training-imports', adminAuth, importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '无文件' });
  const ext = path.extname(req.file.originalname) || '';
  const filename = `import_${Date.now()}${ext}`;
  fs.writeFileSync(path.join(IMPORT_DIR, filename), req.file.buffer);
  const id = db.prepare('INSERT INTO training_import_files (filename, original_name) VALUES (?,?)').run(filename, req.file.originalname).lastInsertRowid;
  res.json({ ok: true, id, filename, original_name: req.file.originalname, parse_status: 'pending' });
});

router.delete('/api/admin/training-imports/:id', adminAuth, (req, res) => {
  const row = db.prepare('SELECT filename FROM training_import_files WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '不存在' });
  try { fs.unlinkSync(path.join(IMPORT_DIR, row.filename)); } catch(e) {}
  db.prepare('DELETE FROM training_import_files WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// AI 解析培训计划文件
router.post('/api/admin/training-imports/:id/parse', adminAuth, async (req, res) => {
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
router.get('/api/admin/training-year-plan', (req, res) => {  // 只读不鉴权，供首页展示
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM training_year_plan WHERE year=? ORDER BY month').all(year);
  res.json(rows.map(r => ({ ...r, sessions: JSON.parse(r.sessions_json||'[]') })));
});

router.put('/api/admin/training-year-plan/:year/:month', adminAuth, (req, res) => {
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
router.post('/api/workshop/training-plan/:planId/photos', workshopEditAuth, photoUpload.single('photo'), (req, res) => {
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
router.get('/api/workshop/training-plan/:planId/photos', (req, res) => {
  const planId = parseInt(req.params.planId);
  const photos = db.prepare('SELECT * FROM training_photos WHERE plan_id=? ORDER BY uploaded_at').all(planId);
  res.json(photos.map(p => ({ ...p, url: `/training-photos/${p.filename}` })));
});

// 删除照片
router.delete('/api/workshop/training-plan/photos/:id', workshopEditAuth, (req, res) => {
  const row = db.prepare('SELECT filename FROM training_photos WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '不存在' });
  try { fs.unlinkSync(path.join(PHOTO_DIR, row.filename)); } catch(e) {}
  db.prepare('DELETE FROM training_photos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 相册：所有照片带培训计划信息
router.get('/api/workshop/photos', (req, res) => {
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
router.get('/api/workshop/training-plan/:planId/evaluations', (req, res) => {
  const planId = parseInt(req.params.planId);
  const rows = db.prepare('SELECT * FROM training_evaluations WHERE plan_id=? ORDER BY evaluated_at').all(planId);
  res.json(rows);
});

// 查询某人某月的培训完成情况（按项点维度）
router.get('/api/workshop/member-month-items', (req, res) => {
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
router.put('/api/workshop/training-plan/:planId/evaluations/:staffId', workshopEditAuth, (req, res) => {
  const planId = parseInt(req.params.planId);
  const staffId = req.params.staffId;
  const { staff_name, comment } = req.body;
  const evaluatedBy = req.headers['x-instructor-id'] || 'admin';
  db.prepare(`INSERT INTO training_evaluations (plan_id,staff_id,staff_name,comment,evaluated_by,evaluated_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(plan_id,staff_id) DO UPDATE SET comment=excluded.comment,evaluated_by=excluded.evaluated_by,evaluated_at=excluded.evaluated_at`)
    .run(planId, staffId, staff_name || staffId, comment || '', evaluatedBy);
  res.json({ ok: true });
  // 异步检查本月培训是否全员完成
  const plan = db.prepare('SELECT year_month FROM monthly_training_plans WHERE id=?').get(planId);
  if (plan?.year_month) checkAndNotifyMonthComplete(plan.year_month).catch(() => {});
});

// 检查本月全员培训完成并推送（每月只推一次）
async function checkAndNotifyMonthComplete(month) {
  const notifyKey = `training_complete_notified_${month}`;
  if (db.prepare('SELECT value FROM settings WHERE key=?').get(notifyKey)) return; // 已推过

  const [yearStr, monthStr] = month.split('-');
  const yearPlanRow = db.prepare('SELECT sessions_json FROM training_year_plan WHERE year=? AND month=?').get(parseInt(yearStr), parseInt(monthStr));
  const totalItems = JSON.parse(yearPlanRow?.sessions_json || '[]').length;
  if (totalItems === 0) return; // 本月无培训项点配置

  const plans = db.prepare(
    "SELECT id, shift_date, plan_type, completed_items FROM monthly_training_plans WHERE year_month=? AND plan_type NOT IN ('轮空') ORDER BY shift_date"
  ).all(month);

  // 计算每人已完成项点（复用 month-member-completion 逻辑）
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

  // 取所有应参加人员（小组成员 + 固定成员，排除 CP）
  const groupMembers = db.prepare(
    'SELECT tgm.staff_id FROM training_group_members tgm JOIN staff s ON s.id=tgm.staff_id WHERE tgm.is_fixed=0 AND COALESCE(s.is_cp,0)=0'
  ).all().map(m=>String(m.staff_id));
  const fixedMembers = db.prepare('SELECT staff_id FROM training_fixed_members').all().map(f=>String(f.staff_id));
  const allRequired = [...new Set([...groupMembers, ...fixedMembers])];

  if (allRequired.length === 0) return;

  // 检查是否全员完成
  const incomplete = allRequired.filter(sid => (personDone[sid]?.size || 0) < totalItems);
  if (incomplete.length > 0) return;

  // 全员完成 → 记录标记，推送
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(notifyKey, '1');
  const [y, mo] = month.split('-');
  await sendGroupPush(`✅ ${parseInt(y)}年${parseInt(mo)}月培训任务已全部完成！本月所有人员（${allRequired.length}人）均已完成培训确认，感谢各位教员的辛苦付出！🎉`);
}

// 撤销点评（教员误确认后取消）
router.delete('/api/workshop/training-plan/:planId/evaluations/:staffId', workshopEditAuth, (req, res) => {
  const planId = parseInt(req.params.planId);
  const staffId = req.params.staffId;
  const r = db.prepare('DELETE FROM training_evaluations WHERE plan_id=? AND staff_id=?').run(planId, staffId);
  res.json({ ok: true, removed: r.changes });
});

// ─── 打卡 & 教员确认 API ──────────────────────────────────────────────────────

// 查询本人本月打卡状态
router.get('/api/workshop/my-status', (req, res) => {
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
router.post('/api/workshop/checkin', (req, res) => {
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
router.post('/api/workshop/instructor-confirm', (req, res) => {
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
router.post('/api/admin/training-groups', adminAuth, (req, res) => {
  const { name, instructor_id, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: '小组名不能为空' });
  const r = db.prepare('INSERT INTO training_groups (name, instructor_id, sort_order) VALUES (?, ?, ?)').run(name, instructor_id || null, sort_order);
  res.json({ id: r.lastInsertRowid, name, instructor_id, sort_order });
});

// 修改小组（名称/教员/排序）
router.put('/api/admin/training-groups/:id', adminAuth, (req, res) => {
  const { name, instructor_id, sort_order } = req.body;
  const g = db.prepare('SELECT id FROM training_groups WHERE id=?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '小组不存在' });
  db.prepare('UPDATE training_groups SET name=COALESCE(?,name), instructor_id=?, sort_order=COALESCE(?,sort_order) WHERE id=?')
    .run(name || null, instructor_id !== undefined ? instructor_id : g.instructor_id, sort_order ?? null, req.params.id);
  res.json({ ok: true });
});

// 删除小组
router.delete('/api/admin/training-groups/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM training_group_members WHERE group_id=?').run(req.params.id);
  db.prepare('DELETE FROM training_groups WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 设置小组成员（全量替换），支持 is_fixed 标记
// 请求体：{ members: [{staff_id, is_fixed}] }
router.put('/api/admin/training-groups/:id/members', adminAuth, (req, res) => {
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
router.put('/api/admin/staff/:id/instructor', adminAuth, (req, res) => {
  const { is_instructor } = req.body;
  db.prepare('UPDATE staff SET is_instructor=? WHERE id=?').run(is_instructor ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.put('/api/admin/staff/:id/leader', adminAuth, (req, res) => {
  const { is_leader } = req.body;
  db.prepare('UPDATE staff SET is_leader=? WHERE id=?').run(is_leader ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
