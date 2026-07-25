const express = require('express');
const { db } = require('../db');
const { adminAuth, logAdmin } = require('../middleware');
const { getSetting, getCurrentCycle, calcPoints, backfillQuestionTypes, getTrainingPlanForDate, getShiftInfo } = require('../helpers');

const router = express.Router();

// 服务端评分缓存：key = `${questionId}:${answerText前200字}`，20分钟TTL
const scoreCache = new Map();
const SCORE_CACHE_TTL = 20 * 60 * 1000;

// ─── Questions API ─────────────────────────────────────────────────────────
router.get('/api/questions', (req, res) => {
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
              const pool = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders}) AND active=1`).all(...pinned.ids);
              // 题池 > count 时随机抽取，确保每人顺序不同
              for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
              qs = pool.slice(0, count);
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

router.post('/api/questions', adminAuth, (req, res) => {
  const { text, reference, keywords, category, difficulty, bank_id } = req.body;
  if (!text?.trim() || !reference?.trim()) return res.status(400).json({ error: '题目和参考答案不能为空' });
  const r = db.prepare('INSERT INTO questions (bank_id,text,reference,keywords,category,difficulty) VALUES (?,?,?,?,?,?)')
    .run(bank_id || 1, text.trim(), reference.trim(), keywords || '', category || '业务知识', difficulty || '中等');
  res.json({ id: r.lastInsertRowid });
});

router.delete('/api/questions/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE questions SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/api/questions/:id', adminAuth, (req, res) => {
  const { text, reference, keywords, category } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '题目不能为空' });
  db.prepare('UPDATE questions SET text=?,reference=?,keywords=?,category=? WHERE id=?')
    .run(text.trim(), reference||'', keywords||'', category||'业务知识', req.params.id);
  res.json({ ok: true });
});

// ─── Banks API ─────────────────────────────────────────────────────────────
router.get('/api/banks', (req, res) => {
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

const VALID_BANK_TYPES = new Set(['emergency','event','knowledge','compliance','theory']);
router.post('/api/banks', adminAuth, (req, res) => {
  const { name, q_type, default_count, bank_type } = req.body;
  const type = VALID_BANK_TYPES.has(bank_type) ? bank_type : 'knowledge';
  const r = db.prepare('INSERT INTO question_banks (name,q_type,default_count,bank_type) VALUES (?,?,?,?)').run(name, q_type || '简答', default_count || 3, type);
  res.json({ id: r.lastInsertRowid });
});

router.put('/api/banks/:id', adminAuth, (req, res) => {
  const { name, bank_type } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '题库名不能为空' });
  const type = VALID_BANK_TYPES.has(bank_type) ? bank_type : null;
  if (type) {
    db.prepare('UPDATE question_banks SET name=?,bank_type=? WHERE id=?').run(name.trim(), type, req.params.id);
  } else {
    db.prepare('UPDATE question_banks SET name=? WHERE id=?').run(name.trim(), req.params.id);
  }
  logAdmin('修改题库', `ID=${req.params.id} → ${name.trim()}${type?' ['+type+']':''}`, req.adminName);
  res.json({ ok: true });
});

router.delete('/api/banks/:id', adminAuth, (req, res) => {
  const bank = db.prepare('SELECT name FROM question_banks WHERE id=?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: '题库不存在' });
  const { c } = db.prepare('SELECT COUNT(*) as c FROM questions WHERE bank_id=? AND active=1').get(req.params.id);
  if (c > 0) return res.status(400).json({ error: `题库中还有 ${c} 道题目，请先删除后再删除题库` });
  db.prepare('DELETE FROM questions WHERE bank_id=? AND active=0').run(req.params.id);
  db.prepare('DELETE FROM question_banks WHERE id=?').run(req.params.id);
  logAdmin('删除题库', bank.name, req.adminName);
  res.json({ ok: true });
});

router.put('/api/banks/:id/activate', adminAuth, (req, res) => {
  db.prepare('UPDATE question_banks SET is_active=0').run();
  db.prepare('UPDATE question_banks SET is_active=1 WHERE id=?').run(req.params.id);
  const b = db.prepare('SELECT name FROM question_banks WHERE id=?').get(req.params.id);
  logAdmin('启用题库', b?.name || `ID=${req.params.id}`, req.adminName);
  res.json({ ok: true });
});

// 头像上传（答题结束时由本人设备提交，无需 admin 鉴权）
router.put('/api/staff/:id/avatar', (req, res) => {
  const { avatar } = req.body;
  if (!avatar || !avatar.startsWith('data:image/')) return res.status(400).json({ error: '无效图片' });
  if (avatar.length > 200000) return res.status(413).json({ error: '图片过大' }); // ~150KB base64 上限
  db.prepare('UPDATE staff SET avatar=? WHERE id=?').run(avatar, req.params.id);
  res.json({ ok: true });
});

// ─── Practice API ──────────────────────────────────────────────────────────
router.get('/api/practice/questions', (req, res) => {
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

router.get('/api/practice/monthly-status/:staffId', (req, res) => {
  const monthStr = new Date().toISOString().slice(0, 7); // YYYY-MM
  const used = db.prepare(`
    SELECT COUNT(*) as c FROM sessions
    WHERE staff_id=? AND is_practice=1 AND practice_bonus=1
    AND strftime('%Y-%m', created_at)=?
  `).get(req.params.staffId, monthStr);
  res.json({ used: used.c, max: 3 });
});

// ─── Session & Scoring ─────────────────────────────────────────────────────
router.post('/api/session/start', (req, res) => {
  const { staffId, staffName, isPractice } = req.body;
  if (!staffId || !staffName) return res.status(400).json({ error: '缺少工号或姓名' });
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';

  let isRemediation = false;

  // 非练习模式校验
  if (!isPractice) {
    // 检查是否有有效复查授权（影响后续所有截止判断）
    const remGrant = db.prepare(`
      SELECT expires_at FROM remediation_grants
      WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
    `).get(staffId, cycleId);
    if (remGrant) isRemediation = true;

    // 1. 早班截止：早班日 09:30 后不允许开始正式答题（有补答授权或复查授权则豁免）
    const shiftInfo = getShiftInfo(new Date());
    if (shiftInfo.phase === 2) { // 2 = 早班
      const now = new Date();
      const bjNow = new Date(now.getTime() + 8*3600000);
      const bjHour = parseInt(bjNow.toISOString().slice(11,13));
      const bjMin  = parseInt(bjNow.toISOString().slice(14,16));
      if (bjHour > 9 || (bjHour === 9 && bjMin >= 30)) {
        if (!isRemediation) {
          const grant = db.prepare(`
            SELECT expires_at FROM makeup_grants
            WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
          `).get(staffId, cycleId);
          if (!grant) {
            return res.status(400).json({ error: '早班答题已截止（09:30）', shiftDeadline: true });
          }
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

    // 3. 本轮已完成过正式答题（复查授权时允许重答）
    const done = db.prepare(`
      SELECT id FROM sessions
      WHERE staff_id=? AND cycle_id=? AND completed=1
        AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
      LIMIT 1
    `).get(staffId, cycleId);
    if (done && !isRemediation) return res.status(400).json({ error: '本轮已完成答题，无需重复作答', alreadyDone: true });
  }

  const r = db.prepare('INSERT INTO sessions (staff_id,staff_name,cycle_id,is_practice,is_remediation) VALUES (?,?,?,?,?)')
    .run(staffId, staffName, cycleId, isPractice ? 1 : 0, isRemediation ? 1 : 0);
  res.json({ sessionId: r.lastInsertRowid, cycleId: cycle?.id, isRemediation });
});

// AI scoring (DashScope Qwen or keyword fallback)
function buildScoringPrompt(question, reference, answer, category) {
  const isIncident = category && (category.includes('安全') || category.includes('事件') || category.includes('事故') || category.includes('分析'));
  const ansText = answer || '（未作答）';

  // 模式3：得分点格式（参考答案包含【得分点】标记，优先匹配）
  if (reference && reference.includes('【得分点')) {
    const allRequired = reference.includes('均需答出');
    const threshMatch = reference.match(/答出(\d+)[点类]/);
    const threshold = threshMatch ? parseInt(threshMatch[1]) : null;
    const thresholdNote = allRequired
      ? '所有得分点均需覆盖方可满分'
      : threshold
        ? `答出 ${threshold} 个及以上得分点即可得满分，未达到按比例给分`
        : '尽量覆盖更多得分点，按覆盖比例给分';

    return `你是武汉地铁乘务培训考核专家，评估乘务员的口述答题。只返回JSON，不含任何其他内容。

【题目】${question}

【参考得分点】
${reference}

【乘务员口述】（来自语音识别，可能含口语化、停顿词、同音字错误）
${ansText}

【评分说明】
- ${thresholdNote}
- 无顺序要求，覆盖即得分
- "嗯""然后""就是""那个"等停顿词忽略不计
- 同音字/近音字按语义理解（如"扣一个月工资"≈"扣发1个月绩效"，"撤职降级"≈"撤职降4级"）
- 意思相近表达视为正确
- 涉及具体数字的得分点（限速数值、扣发月数、降级档数等），数字必须正确才算覆盖该点

只返回如下JSON，不要加任何解释或markdown：
{"score":0-100,"level":"优秀|合格|需加强","summary":"一句话总体评价","correct_points":["已覆盖的得分点"],"missing_points":["未覆盖的得分点（仅列核心缺失，不超过3条）"],"order_errors":[],"suggestion":"具体改进建议","encouragement":"鼓励语"}`;
  }

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
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY || !answer?.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: buildScoringPrompt(question, reference, answer, category) }],
        max_tokens: 2000,
        temperature: 0.1
      }),
      signal: controller.signal
    });
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) return null; // API 返回错误体，触发 keyword 兜底
    // deepseek-v4-flash 推理模式下 content 可能为空，从 reasoning_content 提取 JSON
    const src = msg.content || msg.reasoning_content || '';
    const jsonMatch = src.match(/\{[\s\S]*"score"[\s\S]*\}/);
    const raw = jsonMatch ? jsonMatch[0] : '';
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.score !== 'number') return null; // score 字段非法，触发 keyword 兜底
    return parsed;
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

router.post('/api/score', async (req, res) => {
  const { questionId, answer } = req.body;
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(questionId);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  let result = await scoreWithQwen(q.text, q.reference, answer, q.category);
  if (!result) result = scoreKeyword(q.reference, q.keywords, answer);
  else result.score_method = 'ai';
  result.transcript = answer || "";

  // 缓存评分结果，供 /session/:id/answer 使用（防止客户端篡改分数）
  const cacheKey = `${questionId}:${(answer || '').slice(0, 200)}`;
  scoreCache.set(cacheKey, { ...result, cachedAt: Date.now() });

  res.json(result);
});

router.post('/api/session/:id/answer', (req, res) => {
  const { staffId, staffName, questionId, questionText, category, answerText, durationSeconds } = req.body;

  // 从服务端缓存取评分，不信任客户端上传的 score 等字段
  const cacheKey = `${questionId}:${(answerText || '').slice(0, 200)}`;
  const cached = scoreCache.get(cacheKey);
  let r;
  if (cached && Date.now() - cached.cachedAt < SCORE_CACHE_TTL) {
    r = cached;
  } else {
    // 缓存未命中（正常流程不应发生）→ keyword 兜底
    const q = db.prepare('SELECT reference, keywords FROM questions WHERE id=?').get(questionId);
    r = scoreKeyword(q?.reference || '', q?.keywords, answerText);
  }

  // 定期清理过期缓存（约10%概率触发）
  if (Math.random() < 0.1) {
    const now = Date.now();
    for (const [k, v] of scoreCache.entries()) {
      if (now - v.cachedAt > SCORE_CACHE_TTL) scoreCache.delete(k);
    }
  }

  db.prepare(`INSERT INTO answers (session_id,staff_id,staff_name,question_id,question_text,category,answer_text,score,level,summary,correct_points,missing_points,suggestion,score_method,duration_seconds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, staffId, staffName, questionId, questionText, category, answerText,
      r.score, r.level, r.summary,
      JSON.stringify(r.correct_points || []), JSON.stringify(r.missing_points || []),
      r.suggestion, r.score_method || 'keyword', durationSeconds ?? null);
  res.json({ ok: true });
});

router.post('/api/session/:id/finish', (req, res) => {
  const sess = db.prepare('SELECT staff_id, is_practice, cycle_id, COALESCE(is_remediation,0) as is_remediation FROM sessions WHERE id=?').get(req.params.id);
  if (sess) {
    const staffRow = db.prepare('SELECT is_tester FROM staff WHERE id=?').get(sess.staff_id);
    if (staffRow?.is_tester) {
      db.prepare("UPDATE sessions SET staff_name = CASE WHEN staff_name NOT LIKE '%(测试)' THEN staff_name || '(测试)' ELSE staff_name END WHERE id=?").run(req.params.id);
    }
  }
  const { tabSwitchCount } = req.body;
  const cnt = db.prepare('SELECT COUNT(*) as c FROM answers WHERE session_id=?').get(req.params.id);
  const tabSwitch = parseInt(tabSwitchCount) || 0;
  // 从已存储的 answers 重新计算总分，不信任客户端上传的 totalScore
  const scoreRow = db.prepare('SELECT ROUND(AVG(score), 1) as avg FROM answers WHERE session_id=?').get(req.params.id);
  const totalScore = scoreRow?.avg ?? 0;

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

  // 复查 session：不计入常规积分，直接更新 remediation_records
  if (sess.is_remediation) {
    db.prepare('UPDATE sessions SET total_score=?,q_count=?,base_points=0,bonus_points=0,total_points=0,tab_switch_count=?,completed=1 WHERE id=?')
      .run(totalScore, cnt.c, tabSwitch, req.params.id);
    // 更新复查台账
    const result = totalScore >= 60 ? 'pass' : 'fail';
    db.prepare(`
      UPDATE remediation_records
      SET remediation_session_id=?, remediation_score=?, result=?
      WHERE staff_id=? AND cycle_id=? AND result='pending'
    `).run(req.params.id, totalScore, result, sess.staff_id, sess.cycle_id || 'default');
    // 删除已用完的复查授权
    db.prepare('DELETE FROM remediation_grants WHERE staff_id=? AND cycle_id=?').run(sess.staff_id, sess.cycle_id || 'default');
    return res.json({ points: { base: 0, bonus: 0, total: 0, isRemediation: true, remediationResult: result } });
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
router.get('/api/leaderboard/cycle', (req, res) => {
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
router.get('/api/leaderboard/today', (req, res) => {
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
router.get('/api/leaderboard/monthly', (req, res) => {
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

router.get('/api/leaderboard/cycle/member/:staffId', (req, res) => {
  const cycle = getCurrentCycle();
  if (!cycle) return res.json({ sessions: [] });
  res.json({ sessions: getSessionsWithAnswers(req.params.staffId, 'AND s.cycle_id=?', [cycle.id]) });
});

router.get('/api/leaderboard/alltime/member/:staffId', (req, res) => {
  res.json({ sessions: getSessionsWithAnswers(
    req.params.staffId,
    "AND strftime('%Y-%m', s.created_at)=strftime('%Y-%m','now','localtime')",
    []
  )});
});

// Admin: alltime drill-down — per-cycle breakdown for a staff member (this month)
router.get('/api/admin/leaderboard/alltime/cycles/:staffId', adminAuth, (req, res) => {
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
router.get('/api/leaderboard/alltime', (req, res) => {
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
router.get('/api/me/:staffId', (req, res) => {
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

  // Recent sessions detail (exclude deleted sessions)
  const recent = db.prepare(`
    SELECT s.id, s.total_score, s.total_points, s.q_count, s.created_at,
           COALESCE(s.is_remediation,0) as is_remediation,
           GROUP_CONCAT(a.category) as cats
    FROM sessions s
    LEFT JOIN answers a ON a.session_id=s.id
    WHERE s.staff_id=? AND s.completed=1 AND COALESCE(s.is_practice,0)=0
      AND COALESCE(s.is_deleted,0)=0
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

  // 当前轮次最早完成的有效正式 session（含复查）
  const cycleCompletedSession = cycleId ? db.prepare(`
    SELECT id, total_score, COALESCE(is_remediation,0) as is_remediation
    FROM sessions
    WHERE staff_id=? AND cycle_id=? AND completed=1
      AND COALESCE(is_practice,0)=0 AND COALESCE(is_deleted,0)=0
    ORDER BY created_at ASC LIMIT 1
  `).get(sid, cycleId) : null;

  // 复查记录（当前轮次）
  const remRecord = cycleId ? db.prepare(`
    SELECT result, original_score, remediation_score, authorized_at
    FROM remediation_records WHERE staff_id=? AND cycle_id=?
  `).get(sid, cycleId) : null;

  res.json({ staff, streak, catScores, weakCats, trend, recent, stats, cycleRank, isInterrupted, cycleCompletedSession, remRecord });
});

// ─── Admin Analytics ───────────────────────────────────────────────────────
router.get('/api/admin/overview', adminAuth, (req, res) => {
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
  // 复查记录（当前轮次）
  const remRecords = cycleId ? db.prepare(`
    SELECT staff_id, result, original_score, remediation_score FROM remediation_records WHERE cycle_id=?
  `).all(cycleId) : [];
  const remMap = {};
  for (const r of remRecords) remMap[r.staff_id] = r;

  const allStaff = staffRows.map(r => {
    let status;
    if (r.completed_today) status = 'done';
    else if (r.has_session && isRecentlyActive(r.last_active_at)) status = 'answering';
    else if (r.has_session && r.max_q > 0) status = 'interrupted';
    else if (r.has_session) status = 'browsed';
    else status = 'none';
    // 早班截止后未完成 → 标记逾期
    const overdue = isAfterMorningDeadline && status === 'none';
    const remRec = remMap[r.staff_id];
    return {
      staff_id: r.staff_id, name: r.name, is_tester: r.is_tester,
      status, overdue, score: r.score, points: r.points, completed_at: r.completed_at, last_active_at: r.last_active_at,
      has_remediation: !!remRec,
      remediation_result: remRec?.result || null,
      original_score: remRec?.original_score || null,
    };
  });
  res.json({ todayComplete, totalStaff, catAvg, topWeak, cycle, cycleStats, incompleteList, allStaff });
});

// Reset a staff member's current cycle quiz quota (mark all cycle sessions as deleted)
router.delete('/api/admin/sessions/reset-cycle/:staffId', adminAuth, (req, res) => {
  const staffId = req.params.staffId;
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const staff = db.prepare('SELECT COALESCE(real_name,name) as name FROM staff WHERE id=?').get(staffId);
  const result = db.prepare(`
    UPDATE sessions SET is_deleted=1
    WHERE staff_id=? AND cycle_id=? AND COALESCE(is_deleted,0)=0 AND COALESCE(is_practice,0)=0
  `).run(staffId, cycleId);
  logAdmin('重置套班答题机会', `${staff?.name||staffId}(${staffId}) cycle=${cycleId} affected=${result.changes}`, req.adminName);
  res.json({ ok: true, affected: result.changes });
});

// ─── Makeup Grant（早班逾期补答）──────────────────────────────────────────────
// 管理员授权补答：30分钟有效期
router.post('/api/admin/makeup/grant', adminAuth, (req, res) => {
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
  logAdmin('补答授权', `${staff?.name||staffId}(${staffId}) 有效至 ${expiresAt}`, req.adminName);
  res.json({ ok: true, staffId, expiresAt });
});

// 用户端查询补答授权状态
router.get('/api/makeup/status/:staffId', (req, res) => {
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const grant = db.prepare(`
    SELECT expires_at FROM makeup_grants
    WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
  `).get(req.params.staffId, cycleId);
  res.json({ granted: !!grant, expiresAt: grant?.expires_at || null });
});

// 用户端查询复查授权状态
router.get('/api/remediation/status/:staffId', (req, res) => {
  const cycle = getCurrentCycle();
  const cycleId = cycle?.id || 'default';
  const grant = db.prepare(`
    SELECT expires_at FROM remediation_grants
    WHERE staff_id=? AND cycle_id=? AND datetime(expires_at) > datetime('now','localtime')
  `).get(req.params.staffId, cycleId);
  res.json({ granted: !!grant, expiresAt: grant?.expires_at || null });
});

// 本月培训项点完成情况（各计划评价进度）
router.get('/api/admin/month-plan-completion', adminAuth, (req, res) => {
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
router.get('/api/admin/month-member-completion', adminAuth, (req, res) => {
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

router.get('/api/admin/weak-questions', adminAuth, (req, res) => {
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

router.get('/api/admin/members', adminAuth, (req, res) => {
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

router.get('/api/admin/member/:id', adminAuth, (req, res) => {
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

router.get('/api/admin/records', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, s.staff_name FROM answers a JOIN sessions s ON s.id=a.session_id
    ORDER BY a.created_at DESC LIMIT 500
  `).all();
  res.json(rows);
});

// ─── Cycle management ──────────────────────────────────────────────────────
router.post('/api/admin/cycle/new', adminAuth, (req, res) => {
  const { label } = req.body;
  db.prepare("UPDATE cycles SET is_current=0").run();
  const id = `cycle_${Date.now()}`;
  const lbl = label || `班次_${new Date().toLocaleDateString('zh-CN')}`;
  db.prepare("INSERT INTO cycles (id,label,start_date,is_current) VALUES (?,?,?,1)")
    .run(id, lbl, new Date().toISOString().slice(0,10));
  logAdmin('开启新轮次', lbl, req.adminName);
  res.json({ cycleId: id });
});

// ─── Settings ──────────────────────────────────────────────────────────────
router.get('/api/settings', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

router.put('/api/settings', adminAuth, (req, res) => {
  const updates = req.body;
  Object.entries(updates).forEach(([k,v]) => db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(k, String(v)));
  logAdmin('修改设置', Object.entries(updates).map(([k,v])=>`${k}=${v}`).join(', '), req.adminName);
  res.json({ ok: true });
});

// ─── Personal Answers History ──────────────────────────────────────────────
router.get('/api/me/:staffId/answers', (req, res) => {
  const rows = db.prepare(`
    SELECT a.question_text, a.answer_text, a.score, a.level, a.category, a.created_at, s.q_count
    FROM answers a JOIN sessions s ON s.id=a.session_id
    WHERE a.staff_id=? ORDER BY a.created_at DESC LIMIT 50
  `).all(req.params.staffId);
  res.json(rows);
});

router.get('/api/me/:staffId/sessions', (req, res) => {
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


module.exports = router;
