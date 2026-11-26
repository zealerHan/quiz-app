// 下周休假申报图（钉钉群用）
// 钉钉群机器人 Webhook 不支持 image 消息（官方文档：图片 Image ❌），
// 只有 markdown 能嵌 ![x](URL) —— 所以生成 PNG + 公网 URL 是唯一路径。
//
// 版式沿用 App 里的班表日历（src/ShiftGrid.jsx）：一行 7 格、格子上日期下姓名。
// 老韩 2026-11-25：原来的「每天一行」表格太啰嗦，「就用日历显示下周休假比较简单明了」。
// 图片比手机宽（720px），格子等比放到 ~92px，三字姓名放得下。
const sharp = require('sharp');

const W = 720;
const PAD = 20;
const GAP = 8;
const CELL_W = (W - PAD * 2 - GAP * 6) / 7;      // ≈ 92.6
const CELL_H = 104;
const HEAD_H = 30;                                // 星期行
const TITLE_H = 50;                               // 顶部标题
const FOOT_H = 62;
const H = TITLE_H + HEAD_H + CELL_H + FOOT_H;

// 容器（Debian slim）没有 PingFang，Dockerfile 装了 fonts-noto-cjk。
// 写一串候选让 librsvg 挑第一个存在的：本机开发用 PingFang，线上用 Noto。
// ⚠ 早先只写 "PingFang SC" → 容器里找不到 → 中文全渲染成方块。
const FONT = `'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','PingFang SC','Heiti SC','WenQuanYi Zen Hei',sans-serif`;

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

// 班次配色，与 src/ShiftGrid.jsx 的 SHIFT_STYLE 一致（早=琥珀 白=蓝 夜=紫 休=绿）
const SHIFT_STYLE = {
  早班: { bg: 'rgba(212,175,55,0.20)', border: 'rgba(212,175,55,0.60)', text: '#e4bd48', label: '早' },
  白班: { bg: 'rgba(66,133,244,0.20)', border: 'rgba(66,133,244,0.60)', text: '#6ba5fb', label: '白' },
  夜班: { bg: 'rgba(139,110,247,0.20)', border: 'rgba(139,110,247,0.60)', text: '#a992f7', label: '夜' },
  休息: { bg: 'rgba(76,175,110,0.20)', border: 'rgba(76,175,110,0.60)', text: '#5cc27c', label: '休' },
};

// 假别配色，与申报页 LEAVE_COLOR 一致
const LEAVE_COLOR = {
  年休:   { bg: 'rgba(91,155,250,0.30)',  border: 'rgba(91,155,250,0.90)',  text: '#b6d4fe' },
  陪产假: { bg: 'rgba(232,120,180,0.30)', border: 'rgba(232,120,180,0.90)', text: '#f7bcdb' },
  婚假:   { bg: 'rgba(238,114,104,0.30)', border: 'rgba(238,114,104,0.90)', text: '#f7b8b1' },
  育儿假: { bg: 'rgba(255,167,38,0.30)',  border: 'rgba(255,167,38,0.90)',  text: '#ffd39b' },
  病假:   { bg: 'rgba(160,160,160,0.30)', border: 'rgba(160,160,160,0.85)', text: '#d0d0d0' },
  事假:   { bg: 'rgba(160,160,160,0.30)', border: 'rgba(160,160,160,0.85)', text: '#d0d0d0' },
};

function esc(s) {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

/**
 * @param {object} data
 *   week_start / week_end   下周起止（YYYY-MM-DD）
 *   days      [{date, shift}]  7 项，shift 为 早班/白班/夜班/休息
 *   leaves    [{name, type, start_date, end_date, pending}] 与本周有交集的休假
 *   quota     每日名额
 * @returns {Promise<Buffer>} PNG
 */
async function renderLeaveCalendarChart(data) {
  const days = data.days || [];
  const leaves = data.leaves || [];
  const quota = data.quota || 1;
  // 标题可变：催报用「下周休假申报」，窗口关闭后的通知用「下周休假安排」
  const title = data.title || '下周休假申报';
  // 底栏左侧文字可覆盖：催报显示「名额 N 人/天」，窗口关闭后显示「顶班需求」
  const footLeft = data.foot_left || null;
  // 已确定的休假用实线（窗口关闭后不该再出现虚线）
  const forceSolid = data.force_solid === true;

  const md = (ds) => `${parseInt(ds.slice(5, 7))}月${parseInt(ds.slice(8))}日`;
  const onDayOf = (date) => leaves.filter(lv => lv.start_date <= date && lv.end_date >= date);

  let body = `<rect x="0" y="0" width="${W}" height="${H}" fill="#171c26"/>`;

  // ── 标题 ──
  body += `<text x="${PAD}" y="32" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff">${esc(title)}</text>`;
  body += `<text x="${W - PAD}" y="32" text-anchor="end" font-family="${FONT}" font-size="14" fill="#8b96a8">${esc(md(data.week_start))} ~ ${esc(md(data.week_end))}</text>`;

  // ── 星期行 ──
  WEEKDAY.forEach((wd, i) => {
    const cx = PAD + i * (CELL_W + GAP) + CELL_W / 2;
    body += `<text x="${cx.toFixed(1)}" y="${TITLE_H + 18}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" fill="${i >= 5 ? '#8b96a8' : '#6b7688'}">${wd}</text>`;
  });

  // ── 7 个日期格 ──
  days.forEach((d, i) => {
    const x = PAD + i * (CELL_W + GAP);
    const y = TITLE_H + HEAD_H;
    const st = SHIFT_STYLE[d.shift] || SHIFT_STYLE['休息'];
    const onDay = onDayOf(d.date);
    const over = onDay.length > quota;

    // 格子底：超名额 → 红框；否则班次色
    const bg = over ? 'rgba(238,114,104,0.14)' : st.bg;
    const border = over ? 'rgba(238,114,104,0.80)' : st.border;

    body += `<rect x="${x.toFixed(1)}" y="${y}" width="${CELL_W.toFixed(1)}" height="${CELL_H}" rx="10" fill="${bg}" stroke="${border}" stroke-width="1.2"/>`;
    // 日期
    body += `<text x="${(x + CELL_W / 2).toFixed(1)}" y="${y + 27}" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="800" fill="#ffffff">${Number(d.date.slice(8))}</text>`;
    // 班次
    body += `<text x="${(x + CELL_W / 2).toFixed(1)}" y="${y + 44}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${st.text}">${st.label}</text>`;

    // 休假姓名（最多 2 条）
    if (onDay.length === 0) {
      body += `<text x="${(x + CELL_W / 2).toFixed(1)}" y="${y + 74}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#39424f">—</text>`;
    } else {
      onDay.slice(0, 2).forEach((lv, k) => {
        const lc = LEAVE_COLOR[lv.type] || LEAVE_COLOR['年休'];
        const cy = y + 64 + k * 22;
        const dash = (lv.pending && !forceSolid) ? ` stroke-dasharray="4,2.5"` : '';
        body += `<rect x="${(x + 4).toFixed(1)}" y="${cy - 13}" width="${(CELL_W - 8).toFixed(1)}" height="19" rx="4" fill="${lc.bg}" stroke="${lc.border}" stroke-width="1"${dash}/>`;
        body += `<text x="${(x + CELL_W / 2).toFixed(1)}" y="${cy + 1}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${lc.text}">${esc(lv.name)}</text>`;
      });
      if (onDay.length > 2) {
        body += `<text x="${(x + CELL_W / 2).toFixed(1)}" y="${y + 99}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#8b96a8">+${onDay.length - 2}</text>`;
      }
    }
  });

  // ── 底部：名额 / 超名额 / 假别图例 ──
  const fy = TITLE_H + HEAD_H + CELL_H + 24;
  const perDay = days.map(d => onDayOf(d.date).length);
  const overCnt = perDay.filter(n => n > quota).length;
  let foot;
  if (footLeft) {
    // 窗口关闭后的通知：显示每天顶班人数 + 峰值，不再讲「名额」
    const peak = Math.max(...perDay, 0);
    foot = footLeft.replace('{peak}', String(peak));
    // 每天几人的小串，如「1·1·0·1·1·1·1」
    foot += `　（${perDay.join('·')}）`;
  } else {
    foot = `名额 ${quota} 人/天`;
    if (overCnt > 0) foot += `　·　${overCnt} 天超名额`;
  }
  body += `<text x="${PAD}" y="${fy}" font-family="${FONT}" font-size="12.5" fill="${overCnt > 0 ? '#f06b5f' : '#8b96a8'}">${esc(foot)}</text>`;

  // 假别图例（只列出现过的）
  const usedTypes = [...new Set(leaves.map(l => l.type))];
  if (usedTypes.length) {
    let lx = PAD;
    const ly = fy + 22;
    usedTypes.slice(0, 4).forEach(t => {
      const lc = LEAVE_COLOR[t] || LEAVE_COLOR['年休'];
      body += `<rect x="${lx.toFixed(1)}" y="${ly - 10}" width="11" height="11" rx="2" fill="${lc.bg}" stroke="${lc.border}" stroke-width="1"/>`;
      body += `<text x="${(lx + 15).toFixed(1)}" y="${ly}" font-family="${FONT}" font-size="12" fill="#8b96a8">${esc(t)}</text>`;
      lx += 28 + (t.length * 13);
    });
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * 周班版（老韩 2026-11-25 指定：用管理页「周报批清单」那个版式出图）
 *
 * 版式照管理页的三段结构：
 *   ① 汇总行：休假 N 人   日名额 N 人   ⚠ N 天超名额
 *   ② 每日人数条：周一到周日 7 格，格子里是当天休假人数（大数字），下面是日期
 *   ③ 名单：序号 + 姓名 + 起止（假别）+ 天数
 *
 * 为什么重新做一个函数而不是改 renderLeaveCalendarChart：
 * 那个是「日历」——格子里塞姓名，适合人少时看谁哪天休；
 * 这个周班版是「人数条 + 名单」——人多姓名塞不下时更清楚，且与管理页一致。
 *
 * @param {object} data
 *   week_start, week_end, quota
 *   per_day: [{date, label, count}] 7 个
 *   people:  [{real_name, items:[{start,end,leave_type}], total_days}]
 *   total_people
 */
async function renderWeekBatchChart(data) {
  const perDay = data.per_day || [];
  const people = data.people || [];
  const quota = data.quota || 1;
  const totalPeople = data.total_people != null ? data.total_people : people.length;
  const title = data.title || '下周休假安排';
  // 第二行右侧标签：管理页用「日名额 N 人」，大群通知用「最多 N 人顶班」
  // （老韩 2026-11-25：大群里说「顶班」比说「日名额」更贴他们的说话习惯）
  const quotaLabel = data.quota_label || `日名额 ${quota} 人`;

  const RW = 720;                       // 宽
  const RP = 22;                        // 左右内边距
  const DAY_GAP = 6;
  const DAY_W = (RW - RP * 2 - DAY_GAP * 6) / 7;   // ≈ 92
  const DAY_H = 62;                     // 人数格高度
  const ROW_H = 34;                     // 名单每行高
  const HEAD_H = 56;                    // 标题+汇总行
  const DAYS_TOP = HEAD_H + 24;         // 星期文字
  const DAY_BOX = DAYS_TOP + 18;
  const LIST_TOP = DAY_BOX + DAY_H + 34;
  const RH = LIST_TOP + Math.max(people.length, 1) * ROW_H + 22;

  // 「超名额」只在真的配了车间名额上限时才有意义；大群通知里 quota 等于峰值，
  // 永远不会有超名额，所以传 quota_warn=false 关掉这段。
  const overDays = data.quota_warn === false ? 0 : perDay.filter(d => d.count > quota).length;

  let b = `<rect x="0" y="0" width="${RW}" height="${RH}" fill="#171c26"/>`;

  // ── 标题 ──
  b += `<text x="${RP}" y="30" font-family="${FONT}" font-size="19" font-weight="800" fill="#ffffff">${esc(title)}</text>`;
  b += `<text x="${RW - RP}" y="30" text-anchor="end" font-family="${FONT}" font-size="13.5" fill="#8b96a8">${esc(data.range_text || '')}</text>`;

  // ── ① 汇总行 ──
  b += `<text x="${RP}" y="52" font-family="${FONT}" font-size="13" fill="#8b96a8">休假 </text>`;
  b += `<text x="${RP + 31}" y="52" font-family="${FONT}" font-size="15" font-weight="800" fill="#ffffff">${totalPeople}</text>`;
  b += `<text x="${RP + 31 + String(totalPeople).length * 9}" y="52" font-family="${FONT}" font-size="13" fill="#8b96a8"> 人</text>`;
  b += `<text x="${RP + 105}" y="52" font-family="${FONT}" font-size="13" fill="#8b96a8">${esc(quotaLabel)}</text>`;
  if (overDays > 0) {
    b += `<text x="${RP + 210}" y="52" font-family="${FONT}" font-size="13" font-weight="700" fill="#e8723c">⚠ ${overDays} 天超名额</text>`;
  }

  // ── ② 每日人数条 ──
  perDay.forEach((d, i) => {
    const x = RP + i * (DAY_W + DAY_GAP);
    const over = d.count > quota;
    const wk = d.label || ['一', '二', '三', '四', '五', '六', '日'][i];
    const weekend = i >= 5;

    b += `<text x="${(x + DAY_W / 2).toFixed(1)}" y="${DAYS_TOP}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${weekend ? '#8b96a8' : '#6b7688'}">${wk}</text>`;

    const fill = d.count === 0 ? '#1e242f' : over ? 'rgba(232,114,60,0.22)' : 'rgba(91,155,250,0.20)';
    const stroke = d.count === 0 ? '#2b3341' : over ? 'rgba(232,114,60,0.60)' : 'rgba(91,155,250,0.50)';
    const txt = d.count === 0 ? '#5a6472' : over ? '#e8723c' : '#7ec8f0';

    b += `<rect x="${x.toFixed(1)}" y="${DAY_BOX}" width="${DAY_W.toFixed(1)}" height="${DAY_H}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    b += `<text x="${(x + DAY_W / 2).toFixed(1)}" y="${DAY_BOX + 38}" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="800" fill="${txt}">${d.count}</text>`;
    // 日期（只显示日）
    b += `<text x="${(x + DAY_W / 2).toFixed(1)}" y="${DAY_BOX + DAY_H + 16}" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="#6b7688">${Number(d.date.slice(8))}</text>`;
  });

  // ── ③ 名单 ──
  if (people.length === 0) {
    b += `<text x="${RW / 2}" y="${LIST_TOP + 16}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#5a6472">下周无人休假</text>`;
  } else {
    people.forEach((p, i) => {
      const y = LIST_TOP + i * ROW_H;
      // 分隔线
      if (i > 0) {
        b += `<line x1="${RP}" y1="${y - ROW_H / 2 + 3}" x2="${RW - RP}" y2="${y - ROW_H / 2 + 3}" stroke="#232a36" stroke-width="1"/>`;
      }
      b += `<text x="${RP}" y="${y + 6}" font-family="${FONT}" font-size="11" fill="#5a6472">${i + 1}</text>`;
      b += `<text x="${RP + 20}" y="${y + 6}" font-family="${FONT}" font-size="14" font-weight="700" fill="#ffffff">${esc(p.real_name || '')}</text>`;
      // 起止（假别）
      const detail = (p.items || []).map(it => {
        const s = `${parseInt(it.start.slice(5, 7))}.${String(parseInt(it.start.slice(8))).padStart(2, '0')}`;
        const e = `${parseInt(it.end.slice(5, 7))}.${String(parseInt(it.end.slice(8))).padStart(2, '0')}`;
        return `${s}~${e}${it.leave_type ? '（' + it.leave_type + '）' : ''}`;
      }).join('、');
      b += `<text x="${RP + 90}" y="${y + 6}" font-family="${FONT}" font-size="13" fill="#8b96a8">${esc(detail)}</text>`;
      // 天数靠右
      b += `<text x="${RW - RP}" y="${y + 6}" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="800" fill="#ffffff">${p.total_days}天</text>`;
    });
  }

  return await sharp(Buffer.from(`${`<svg width="${RW}" height="${RH}" xmlns="http://www.w3.org/2000/svg">${b}</svg>`}`)).png().toBuffer();
}

/**
 * 自检：图里是不是真有字。
 * 字体缺失时中文变方块/空白，除背景外几乎没有其他颜色；
 * 正常带文字的图有上千种颜色（抗锯齿产生大量中间色）。
 * 早先线上容器没装中文字体，png 只有背景色块，钉钉收到一张空图 —— 从此兜底。
 * @returns {Promise<{ok:boolean, colors:number, reason?:string}>}
 */
async function checkChartHasText(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
  const counts = new Set();
  for (let i = 0; i < data.length; i += info.channels * 7) {
    counts.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  if (counts.size < 12) {
    return { ok: false, colors: counts.size, reason: `颜色数只有 ${counts.size}，疑似字体缺失（中文未渲染）` };
  }
  return { ok: true, colors: counts.size };
}

module.exports = { renderLeaveCalendarChart, renderWeekBatchChart, checkChartHasText };
