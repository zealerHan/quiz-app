#!/usr/bin/env node
// 乘务四组 ATP驾驶 培训 签到/签退二维码发放
// 用法：node send_atp_qr.js checkin|checkout
// 目标群：DINGTALK_WEBHOOK（乘务四组班组群）
require('dotenv').config();
const crypto = require('crypto');
const { db } = require('./server/db');

const which = (process.argv[2] || '').toLowerCase();
const BASE = process.env.PUBLIC_URL || 'https://peixun.zealerhan.cn';

const CONF = {
  checkin: {
    title: '✅ 签到开始',
    img: `${BASE}/atp-checkin-20261107.jpg`,
    label: '签到二维码',
    window: '10:00 ~ 11:15',
    tail: '请抓紧时间扫码签到，签到窗口 10:00~11:15。',
    logDetail: 'ATP驾驶-签到码发放',
  },
  checkout: {
    title: '🔚 签退开始',
    img: `${BASE}/atp-checkout-20261107.jpg`,
    label: '签退二维码',
    window: '11:00 ~ 12:15',
    tail: '培训结束请扫码签退，签退窗口 11:00~12:15。',
    logDetail: 'ATP驾驶-签退码发放',
  },
};

const c = CONF[which];
if (!c) {
  console.error('用法: node send_atp_qr.js checkin|checkout');
  process.exit(2);
}

const md = [
  `## ${c.title}`,
  `**课程**：乘务四班组ATP驾驶`,
  `**日期**：2026年11月7日（周六）`,
  `**${c.label}有效期**：${c.window}`,
  '',
  `![${c.label}](${c.img})`,
  '',
  `<font color="#999999">仅限任务范围内的人员参与</font>`,
  '',
  c.tail,
].join('\n');

(async () => {
  const webhook = process.env.DINGTALK_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET;
  if (!webhook || !secret) { console.error('钉钉 webhook/secret 未配置'); process.exit(1); }

  const ts = Date.now();
  const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
  const url = `${webhook}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { title: c.title, text: md },
    }),
  });
  const json = await res.json().catch(() => ({ raw: '非JSON响应' }));
  console.log(`[${which}] 钉钉返回:`, JSON.stringify(json));

  if (json.errcode === 0) {
    try {
      db.prepare("INSERT INTO admin_logs (action, detail, operator, created_at) VALUES (?,?,?,datetime('now','localtime'))")
        .run('钉钉通知', c.logDetail, '自动任务');
    } catch (e) { console.error('写日志失败:', e.message); }
    console.log('✅ 已发送');
  } else {
    console.error('❌ 发送失败');
    process.exit(1);
  }
})();
