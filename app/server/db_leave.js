// ─── 休假模块表结构（独立文件，不侵入 db.js 现有逻辑）──────────────���────────
// 设计原则：全部新建表，零改动现有表结构。
// 出问题可 DROP 这些表完全回滚，不留痕迹。
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS leave_quota (
  staff_id        TEXT NOT NULL,
  year            INTEGER NOT NULL,
  annual_total    REAL DEFAULT 0,   -- 年休应得（按工龄 10年以上10天/以下5天）
  marriage_total  REAL DEFAULT 10,  -- 婚假额度（领证起一年内休完）
  paternity_total REAL DEFAULT 15,  -- 陪产假
  parental_total  REAL DEFAULT 0,   -- 育儿假
  work_years_note TEXT,             -- 工龄备注（系统无来源，手工填）
  updated_at      TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (staff_id, year)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS leave_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id     TEXT NOT NULL,
  leave_type   TEXT NOT NULL,        -- 年休/婚假/陪产假/育儿假/病假/事假
  start_date   TEXT NOT NULL,        -- YYYY-MM-DD
  end_date     TEXT NOT NULL,
  days         REAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  -- draft 草稿 / submitted 已提交 / locked 已锁版 / reported 已报车场组
  -- released 已放行 / oa_done 已走OA / verified 已核对 / rejected 驳回 / cancelled 取消
  week_key     TEXT,
  batch_id     INTEGER,
  quota_year   INTEGER,
  oa_checked_by TEXT,
  oa_checked_at TEXT,
  oa_mismatch   TEXT,
  reject_reason TEXT,
  cancel_reason TEXT,                -- 撤销原因（组员填）
  source       TEXT DEFAULT 'app',   -- app 应用内 / import Excel迁移
  created_by   TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
`);

// 幂等补列：已上线的旧库 CREATE TABLE IF NOT EXISTS 会整条跳过，新列进不去
(function ensureLeaveRecordCols() {
  const have = db.prepare('PRAGMA table_info(leave_records)').all().map((c) => c.name);
  const need = [
    ['cancel_reason', 'TEXT'],   // 撤销原因
    ['oa_checked_by', 'TEXT'],
    ['oa_checked_at', 'TEXT'],
    ['oa_mismatch', 'TEXT'],
    ['quota_year', 'INTEGER'],
    // ── 与车场组对接顶班（老韩 2026-11-25）──
    // 背景：申报窗口期内，三个管理员（韩颖/艾凌风/胡鑫）可能各自对接不同的人，
    // 信息不对称 → 12-03 这种两人重叠的日子，可能只向车场组要了 1 个顶班，缺人。
    // 所以每条休假记录要留「谁、什么时候、找车场组对好了」，让别人看得见。
    ['relief_done_by',  'TEXT'],   // 对接人姓名（韩颖/艾凌风/胡鑫）
    ['relief_done_at',  'TEXT'],   // 对接时间
    ['relief_note',     'TEXT'],   // 备注（如车场组安排的顶班人姓名）
  ];
  for (const [name, type] of need) {
    if (!have.includes(name)) {
      db.exec(`ALTER TABLE leave_records ADD COLUMN ${name} ${type}`);
      console.log(`[db_leave] ALTER leave_records ADD COLUMN ${name} ${type}`);
    }
  }
})();

db.exec(`
CREATE TABLE IF NOT EXISTS leave_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  week_key      TEXT UNIQUE NOT NULL,   -- 如 2026-W48
  week_start    TEXT,
  week_end      TEXT,
  deadline      TEXT,                   -- 填报截止时间
  quota_base    INTEGER DEFAULT 1,      -- 保底名额
  quota_actual  INTEGER,                -- 车场组实际给的名额
  released_json TEXT,                   -- 车场组放行名单 JSON
  locked_at     TEXT,
  reported_at   TEXT,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS leave_notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id   TEXT,
  kind       TEXT,
  payload    TEXT,
  dedupe_key TEXT UNIQUE,
  status     TEXT DEFAULT 'pending',
  sent_at    TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_leave_rec_staff ON leave_records(staff_id, start_date)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_leave_rec_status ON leave_records(status, week_key)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_leave_rec_year ON leave_records(quota_year)`);

// ─── 假期权益（老韩 2026-11-26）────────────────────────────────────
// 解决什么问题：婚假/陪产假/育儿假不是「每年固定给一个数」，而是跟着
// 某个日期事件走、并且有有效期。原来的 leave_quota.marriage_total 只是个
// 手填死数字，系统不知道谁哪天领的证、孩子哪天出生，于是：
//   · 婚假 365 天到期了也不知道
//   · 育儿假按自然年度切不了（孩子 5 月出生，首年只剩 7 个月）
//   · 陪产假 3 个月有效期无从判断
//
// 设计：一张表存「事件」，额度由事件 + 规则实时算出来。
//   · 一个员工可以有多个权益（结婚一次、生两胎各一条育儿假）
//   · event_date 是规则的起点（领证日 / 孩子出生日）
//   · 育儿假不按子女数量叠加（鄂卫办通〔2021〕74号），但表里允许存多条，
//     额度计算时取「当前有效且最大」那条，不由条数翻倍。
db.exec(`
CREATE TABLE IF NOT EXISTS leave_rights (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- marriage 婚假 / paternity 陪产假 / parental 育儿假
  event_date  TEXT NOT NULL,        -- 事件日：领证日 / 孩子出生日  YYYY-MM-DD
  total_days  REAL NOT NULL,        -- 该权益总额：婚假15 / 陪产15 / 育儿每年10
  -- 周期规则（决定怎么切分有效期）
  --   marriage  : 1 个周期，event_date 起 365 天
  --   paternity : 1 个周期，event_date 起 3 个月（单位口径，非条例规定）
  --   parental  : 多个周期，按自然年度切，到孩子满 3 岁当年截止
  cycle_kind  TEXT DEFAULT 'none',  -- none / year365 / month3 / calendar_year
  expires_on  TEXT,                 -- 算出来的最终失效日（缓存，便于查询；NULL=永久）
  note        TEXT,                 -- 备注（如「2027年统筹表」「老韩核定」）
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rights_staff ON leave_rights(staff_id, kind)`);

console.log('[leave] 休假模块表已就绪（leave_quota / leave_records / leave_batches / leave_notices / wall_posts / leave_rights）');

// ─── 留言墙 ───────────────────────────────────────────────────────
// 不给审核，直接显示；但留真身，后台可查是谁发的
db.exec(`
CREATE TABLE IF NOT EXISTS wall_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nick       TEXT NOT NULL,          -- 对外显示的署名（自己想叫啥叫啥，如"张飞"）
  content    TEXT NOT NULL,
  staff_id   TEXT,                   -- 真实身份，前台不显示，后台可查
  real_name  TEXT,                   -- 真实姓名快照，后台可查
  image      TEXT,                   -- 图片路径（/wall-images/xxx.jpg），无图则 NULL
  is_hidden  INTEGER DEFAULT 0,      -- 管理员可隐藏（软删除）
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_wall_created ON wall_posts(is_hidden, created_at DESC)`);
// 兼容已存在的旧表：补 image 列
try {
  const cols = db.prepare("PRAGMA table_info(wall_posts)").all().map(c => c.name);
  if (!cols.includes('image')) db.exec('ALTER TABLE wall_posts ADD COLUMN image TEXT');
} catch (e) { console.warn('[wall] 补 image 列失败:', e.message); }

console.log('[leave] 休假模块表已就绪（leave_quota / leave_records / leave_batches / leave_notices / wall_posts）');

module.exports = {};
