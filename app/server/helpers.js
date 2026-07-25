const { db } = require('./db');
const { LEADER_ROTATION } = require('./middleware');

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


// 辅助：查某日期的早班培训计划详情（含换人覆盖）
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
        // 用 created_at 精确匹配：remove 和 add 在同一事务里用同一时间戳写入
        const removeSrc = db.prepare(
          'SELECT created_at FROM training_plan_member_overrides WHERE plan_id=? AND staff_id=? AND action=\'remove\''
        ).get(plan.id, rid);
        const dest = removeSrc ? db.prepare(`
          SELECT mtp.shift_date FROM training_plan_member_overrides o
          JOIN monthly_training_plans mtp ON mtp.id = o.plan_id
          WHERE o.staff_id=? AND o.action='add' AND mtp.id != ? AND o.created_at=?
          LIMIT 1
        `).get(rid, plan.id, removeSrc.created_at) : null;
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
    const rawLeaders = allStaff.filter(s => s.is_leader);
    plan.zhxhLeaders = [...LEADER_ROTATION.map(n => rawLeaders.find(l => (l.real_name||l.name)===n)).filter(Boolean),
      ...rawLeaders.filter(l => !LEADER_ROTATION.includes(l.real_name||l.name))];
    plan.zhxhMembers  = allStaff.filter(s => !s.is_leader);
    plan.zhxhTotal    = allStaff.length;
    // 请假名单（notes JSON）
    let leavers = [];
    try { leavers = JSON.parse(plan.notes || '[]').filter(e => e.type === '请假'); } catch(e) {}
    plan.zhxhLeavers = leavers; // [{staffId, staffName}]
  }

  return plan;
}

module.exports = { getShiftInfo, ensureCurrentCycle, getSetting, getCurrentCycle, calcPoints, detectQuestionType, TYPE_LABEL, backfillQuestionTypes, getTrainingPlanForDate };
