// 登录设备留痕（2026-11-26）
//
// 为什么要这个：账号只靠「工号 + 手机尾号」认人，登录后所有请求都只是
// 前端声称「我是谁」（x-staff-id / body.staffId），服务器全程不验。
// 结果就是有人可以用别人的工号答题，成绩记在别人名下，系统里零痕迹。
//
// 这一层不加验证，只做留痕 —— 让「替人答」变得可发现。
// 班组是熟人社会，「会被看到」比「技术上做不到」更有效。
//
// 同时记一条同账号多设备的判定：同一个 staff_id 在 N 台不同设备登录，
// 后台就能标出来。

const loginDevices = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id TEXT NOT NULL,
      staff_name TEXT,
      device_id TEXT,            -- 前端生成的设备指纹（localStorage 里的 UUID）
      ip TEXT,                   -- 真实客户端 IP（cf-connecting-ip / x-forwarded-for 首段）
      ua TEXT,                   -- User-Agent 原样（截断 300 字）
      ua_short TEXT,             -- 解析后的可读设备描述，如「iPhone · Safari」
      action TEXT,               -- login / answer_start
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_login_devices_staff ON login_devices(staff_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_login_devices_time ON login_devices(created_at);
  `);
};

/**
 * 从 UA 粗解析设备描述。
 * 目的不是精确识别机型（UA 可以随便伪造），而是给班长一个一眼能看懂的标签：
 * 「iPhone · Safari」「Android · Chrome」「Windows · Chrome」。
 */
function describeUA(ua) {
  const s = String(ua || '');
  if (!s) return '(未知设备)';

  let os = '未知系统';
  if (/iPhone|iPad|iPod/i.test(s)) os = /iPad/i.test(s) ? 'iPad' : 'iPhone';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(s)) os = 'Mac';
  else if (/Linux/i.test(s)) os = 'Linux';

  let br = '未知浏览器';
  if (/MicroMessenger/i.test(s)) br = '微信';            // 微信内置浏览器最常见
  else if (/DingTalk/i.test(s)) br = '钉钉';
  else if (/EdgA?\/|Edg\//i.test(s)) br = 'Edge';
  else if (/CriOS|Chrome/i.test(s)) br = 'Chrome';
  else if (/FxiOS|Firefox/i.test(s)) br = 'Firefox';
  else if (/Safari/i.test(s)) br = 'Safari';

  return `${os} · ${br}`;
}

/**
 * 取真实客户端 IP。
 * 线上链路是 Cloudflare → cloudflared 隧道 → 容器，
 * req.ip 只会是隧道内网地址，必须读 cf-connecting-ip 或 x-forwarded-for 首段。
 */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { loginDevices, describeUA, clientIp };
