const { db } = require('./db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888';
// 班组长固定轮转顺序（韩颖→艾凌风→胡鑫），与数据库字节序无关
const LEADER_ROTATION = ['韩颖', '艾凌风', '胡鑫'];
// 管理员身份映射：密码 → 姓名
const _adminMap = (() => {
  const map = {};
  const named = [
    [process.env.ADMIN1_PASSWORD, '韩颖'],
    [process.env.ADMIN2_PASSWORD, '艾凌风'],
    [process.env.ADMIN3_PASSWORD, '胡鑫'],
  ];
  for (const [pwd, name] of named) { if (pwd) map[pwd] = name; }
  if (!map[ADMIN_PASSWORD]) map[ADMIN_PASSWORD] = '韩颖';
  return map;
})();

function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  const name = _adminMap[pwd];
  if (!name) return res.status(401).json({ error: '密码错误' });
  req.adminName = name;
  next();
}
// 培训计划编辑权限：管理员密码 或 教员身份
function workshopEditAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  const name = _adminMap[pwd];
  if (name) { req.adminName = name; return next(); }
  const instructorId = req.headers['x-instructor-id'];
  if (instructorId) {
    const s = db.prepare('SELECT is_instructor FROM staff WHERE id=?').get(instructorId);
    if (s?.is_instructor) { req.instructorId = instructorId; return next(); }
    // 也检查是否在小组中担任教员
    const inGroup = db.prepare('SELECT 1 FROM training_groups WHERE instructor_id=? LIMIT 1').get(instructorId);
    if (inGroup) { req.instructorId = instructorId; return next(); }
  }
  return res.status(401).json({ error: '需要管理员密码或教员身份' });
}
const _logStmt = db.prepare("INSERT INTO admin_logs (action, detail, operator) VALUES (?,?,?)");
function logAdmin(action, detail='', operator='admin') {
  try { _logStmt.run(action, String(detail), operator); } catch(e) {}
}

module.exports = { adminAuth, workshopEditAuth, logAdmin, _adminMap, LEADER_ROTATION };
