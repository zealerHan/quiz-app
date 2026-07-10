const crypto = require('crypto');
const { db } = require('./db');
const { getTrainingPlanForDate } = require('./helpers');
const { logAdmin } = require('./middleware');

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
async function sendDingTalkCard({ title, bodyLines, plan, logTag, operator = 'admin' }) {
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
  logAdmin('钉钉通知', logTag, operator);
}

module.exports = { generateMagicToken, formatTrainingLines, sendGroupPush, fmtDate, getPlanMemberNames, sendDingTalkCard };
