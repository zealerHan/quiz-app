// 休假记录 Excel 导出（管理端）
// 表头照车间台账：序号/工号/申请人/班组/假别/开始日期/结束日期/天数/状态/来源/审批人/备注
//
// 为什么要单独一个模块：导出逻辑涉及列宽、合并、日期格式、状态映射一堆细节，
// 塞进 routes/leave.js 会让那个文件更难读（已 1300+ 行）。
//
// 数据范围：全部记录（历史台账 workshop + 系统申报 app + 手工录入 manual），
// 不做年度过滤 —— 老韩 2026-11-25 定「全部休假记录」。
const ExcelJS = require('exceljs');

// 状态 → 中文
const STATUS_CN = {
  draft: '草稿',
  submitted: '待审批',
  locked: '已批准',
  reported: '已报车场组',
  released: '已放行',
  verified: '已销假',
  rejected: '已驳回',
  cancelled: '已撤销',
  cancel_pending: '撤销待批',
};

// 来源 → 中文
const SOURCE_CN = {
  workshop: '车间月报表',
  app: '组员申报',
  manual: '手工录入',
};

// Excel 里的日期要真实日期类型才能排序/筛选，但库里是 'YYYY-MM-DD' 字符串，
// 直接塞字符串 Excel 会当文本。这里转 Date（UTC 正午避开时区跨天）。
function toExcelDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
}

/**
 * 生成休假记录台账 xlsx
 * @param {Array} rows  leave_records 联 staff 的行
 * @returns {Promise<Buffer>}
 */
async function buildLeaveWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '乘务四组培训系统';
  wb.created = new Date();

  // ── Sheet1：明细台账 ──
  const ws = wb.addWorksheet('休假记录', {
    views: [{ state: 'frozen', ySplit: 1 }], // 冻结表头
  });

  ws.columns = [
    { header: '序号',       key: 'idx',        width: 6  },
    { header: '工号',       key: 'staff_id',   width: 11 },
    { header: '申请人',     key: 'real_name',  width: 10 },
    { header: '班组',       key: 'team',       width: 12 },
    { header: '假别',       key: 'leave_type', width: 10 },
    { header: '开始日期',   key: 'start_date', width: 13 },
    { header: '结束日期',   key: 'end_date',   width: 13 },
    { header: '天数',       key: 'days',       width: 8  },
    { header: '状态',       key: 'status',     width: 13 },
    { header: '来源',       key: 'source',     width: 14 },
    { header: '审批人',     key: 'approver',   width: 10 },
    { header: '备注',       key: 'remark',     width: 28 },
  ];

  // 表头样式
  const head = ws.getRow(1);
  head.font = { bold: true, size: 11 };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  head.height = 22;
  head.eachCell(c => {
    c.border = {
      top: { style: 'thin', color: { argb: 'FFB0BEC5' } },
      left: { style: 'thin', color: { argb: 'FFB0BEC5' } },
      bottom: { style: 'thin', color: { argb: 'FFB0BEC5' } },
      right: { style: 'thin', color: { argb: 'FFB0BEC5' } },
    };
  });

  rows.forEach((r, i) => {
    // 备注：优先撤销原因 → 驳回原因 → 其他
    const remarkParts = [];
    if (r.cancel_reason) remarkParts.push(`撤销：${r.cancel_reason}`);
    if (r.reject_reason) remarkParts.push(`驳回：${r.reject_reason}`);
    if (r.oa_mismatch) remarkParts.push(`OA不符：${r.oa_mismatch}`);
    if (r.created_by && r.source !== 'workshop') remarkParts.push(`录入：${r.created_by}`);

    const row = ws.addRow({
      idx: i + 1,
      staff_id: r.staff_id,
      real_name: r.real_name || r.name || '',
      team: '乘务四组',
      leave_type: r.leave_type,
      start_date: toExcelDate(r.start_date),
      end_date: toExcelDate(r.end_date),
      days: r.days,
      status: STATUS_CN[r.status] || r.status,
      source: SOURCE_CN[r.source] || r.source || '',
      approver: r.approver || '',
      remark: remarkParts.join('；'),
    });

    row.alignment = { vertical: 'middle', horizontal: 'center' };
    // 姓名、备注左对齐更易读
    row.getCell('real_name').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('remark').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    row.height = 19;

    // 日期列按日期格式显示
    ['start_date', 'end_date'].forEach(k => {
      const c = row.getCell(k);
      if (c.value instanceof Date) c.numFmt = 'yyyy-mm-dd';
    });
    // 天数保留一位小数（2.5 天这种）
    row.getCell('days').numFmt = '0.#';

    row.eachCell(c => {
      c.border = {
        top: { style: 'hair', color: { argb: 'FFD0D7DE' } },
        left: { style: 'hair', color: { argb: 'FFD0D7DE' } },
        bottom: { style: 'hair', color: { argb: 'FFD0D7DE' } },
        right: { style: 'hair', color: { argb: 'FFD0D7DE' } },
      };
    });
  });

  ws.autoFilter = { from: 'A1', to: 'L1' };

  // ── Sheet2：按人汇总 ──
  const ws2 = wb.addWorksheet('按人汇总');
  ws2.columns = [
    { header: '工号',   key: 'staff_id',  width: 11 },
    { header: '姓名',   key: 'real_name', width: 10 },
    { header: '假别',   key: 'leave_type', width: 10 },
    { header: '次数',   key: 'cnt',       width: 8  },
    { header: '合计天数', key: 'total',   width: 11 },
  ];
  const h2 = ws2.getRow(1);
  h2.font = { bold: true, size: 11 };
  h2.alignment = { vertical: 'middle', horizontal: 'center' };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  h2.height = 22;

  const agg = new Map();
  rows.forEach(r => {
    const key = `${r.staff_id}|${r.leave_type}`;
    const cur = agg.get(key) || {
      staff_id: r.staff_id,
      real_name: r.real_name || r.name || '',
      leave_type: r.leave_type,
      cnt: 0,
      total: 0,
    };
    // 只统计实际生效的（撤销/驳回不算已休）
    if (!['cancelled', 'rejected', 'draft'].includes(r.status)) {
      cur.cnt += 1;
      cur.total += Number(r.days) || 0;
    }
    agg.set(key, cur);
  });

  [...agg.values()]
    .sort((a, b) => String(a.staff_id).localeCompare(String(b.staff_id)) || a.leave_type.localeCompare(b.leave_type))
    .forEach(a => {
      const row = ws2.addRow(a);
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('total').numFmt = '0.#';
    });

  ws2.autoFilter = { from: 'A1', to: 'E1' };

  return await wb.xlsx.writeBuffer();
}

module.exports = { buildLeaveWorkbook, STATUS_CN, SOURCE_CN };
