import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, convertInchesToTwip, PageOrientation,
  Header, Footer, PageNumber, NumberFormat,
} from 'docx';
import fs from 'fs';
import path from 'path';

const BLUE  = '1E3A5F';
const GOLD  = 'C8A84B';
const GRAY  = '475569';
const LIGHT = 'EFF6FF';
const WHITE = 'FFFFFF';
const BLACK = '07101F';

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    run: { color: BLUE, bold: true, size: 32 },
  });
}
function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 26, color: BLUE })],
    spacing: { before: 280, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD } },
  });
}
function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: BLUE })],
    spacing: { before: 200, after: 60 },
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, color: BLACK, ...opts })],
    spacing: { before: 40, after: 40 },
    indent: { left: opts.indent ? convertInchesToTwip(0.25) : 0 },
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, color: BLACK })],
    bullet: { level },
    spacing: { before: 30, after: 30 },
  });
}
function note(text) {
  return new Paragraph({
    children: [new TextRun({ text: `💡 ${text}`, size: 18, color: GRAY, italics: true })],
    spacing: { before: 40, after: 40 },
    indent: { left: convertInchesToTwip(0.2) },
  });
}
function tip(label, text) {
  return new Paragraph({
    children: [
      new TextRun({ text: `【${label}】`, bold: true, size: 20, color: GOLD }),
      new TextRun({ text: ` ${text}`, size: 20, color: BLACK }),
    ],
    spacing: { before: 40, after: 40 },
  });
}
function divider() {
  return new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
    spacing: { before: 160, after: 160 },
    text: '',
  });
}
function br() { return new Paragraph({ text: '', spacing: { before: 60, after: 60 } }); }

// 表格
function makeTable(headers, rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, color: WHITE })], alignment: AlignmentType.CENTER })],
      shading: { type: ShadingType.SOLID, color: BLUE },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    })),
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: cell, size: 18, color: BLACK })], alignment: AlignmentType.LEFT })],
      shading: { type: ShadingType.SOLID, color: ri % 2 === 0 ? 'F8FAFC' : WHITE },
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Microsoft YaHei', size: 20 },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.1), right: convertInchesToTwip(1.1) },
      },
    },
    children: [

      // ── 封面 ──────────────────────────────────────────────────────────────
      new Paragraph({ text: '', spacing: { before: 800 } }),
      new Paragraph({
        children: [new TextRun({ text: '武汉地铁5号线', size: 56, bold: true, color: BLUE })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '乘务培训管理平台', size: 48, bold: true, color: BLUE })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '操作指南  ·  教员 & 管理员版', size: 26, color: GOLD, bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'peixun.zealerhan.cn', size: 22, color: GRAY })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: '2026年4月', size: 22, color: GRAY })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 800 },
      }),

      divider(),

      // ── 1. 平台概述 ────────────────────────────────────────────────────────
      h1('一、平台概述'),
      p('武汉地铁5号线乘务培训管理平台（以下简称"培训系统"）是面向乘务段/场日常培训管理设计的一体化工具，覆盖以下核心场景：'),
      br(),
      bullet('📋 年度 / 月度培训计划管理（可上传图片/文档，AI自动识别填充）'),
      bullet('🗓 月度日程排班（早班/夜班/休息，自动匹配培训任务）'),
      bullet('👥 小组成员管理（临时换人、延后、固定成员配置）'),
      bullet('✅ 培训出勤打卡与教员确认评价'),
      bullet('📊 培训日志导出（按班次勾选导出Excel）'),
      bullet('🔔 钉钉自动推送（定时通知 + 操作实时推送）'),
      bullet('📱 员工答题抽问、成绩排行、AI智能评分'),
      br(),
      note('系统地址：https://peixun.zealerhan.cn，建议在浏览器中收藏或使用钉钉快捷入口访问。'),

      divider(),

      // ── 2. 账号与登录 ──────────────────────────────────────────────────────
      h1('二、账号与登录'),
      h2('2.1 员工登录'),
      bullet('打开系统首页，输入【工号】（Y开头或纯数字均可）和【手机尾号】（后4位）'),
      bullet('首次登录后系统会记住工号，下次进入自动填充'),
      bullet('登录后进入个人主页，可查看近期培训安排、答题任务、车间月度任务'),

      h2('2.2 教员登录'),
      bullet('使用个人工号 + 手机尾号正常登录'),
      bullet('系统识别教员身份后，进入月度任务板块会自动显示【✎ 编辑】按钮'),
      bullet('教员可直接编辑与自己相关的培训计划（换人、评价、打卡确认）'),
      tip('快捷入口', '进入月度任务板块 → 右上角点击【🔗 快捷入口】→ 生成专属免登链接（48小时有效）→ 复制到钉钉收藏，以后点一下直接跳过登录页直达车间板块。'),

      h2('2.3 管理员登录'),
      bullet('在登录页面点击底部【管理员后台】，输入管理员密码进入'),
      bullet('管理员密码同时可在月度任务板块右上角【解锁】中输入，获得完整编辑权限'),
      bullet('管理员后台可进行：员工管理、小组配置、排班设置、年度计划导入、数据导出、钉钉推送测试等'),

      divider(),

      // ── 3. 月度任务板块（教员日常操作核心）─────────────────────────────────
      h1('三、月度任务板块（教员日常操作）'),
      p('月度任务板块是教员日常最常用的功能区，从主页点击【月度任务】进入。'),

      h2('3.1 日程卡片说明'),
      bullet('页面以卡片形式展示本月全部培训计划'),
      bullet('与登录人相关的日程卡片高亮显示，不相关的默认折叠（点击卡片左侧可展开）'),
      bullet('每张卡片显示：日期、班次类型、小组名、教员、班组长、组员名单'),
      bullet('折叠卡片显示简要信息，点击可展开查看详情'),

      h2('3.2 编辑模式'),
      bullet('点击右上角【✎ 编辑】进入编辑模式，所有卡片全部展开'),
      bullet('编辑模式下可点击卡片字段（▾标记）直接修改：日期、地点、班组长等'),
      bullet('完成后点击【保存】退出编辑模式，页面恢复只显示与登录人相关的卡片'),
      note('教员登录后默认非编辑模式，需主动点击【编辑】才能修改，避免误操作。'),

      h2('3.3 临时换人操作'),
      p('场景：某次培训需要将A换成B（两人所在不同计划间互换）'),
      bullet('进入编辑模式 → 找到对应日期卡片 → 点击组员姓名旁的换人按钮'),
      bullet('选择目标日期和目标成员 → 确认执行互换'),
      bullet('系统自动记录变更，同时向教员群发送钉钉通知（见第六章）'),
      br(),
      p('场景：将某人延后到另一日期（单向调整）'),
      bullet('选择【延后】操作 → 指定目标日期 → 确认'),
      bullet('该人从原计划移出，加入目标日期计划，同样触发钉钉实时推送'),
      tip('消息格式示例',
        '17:32  教员 韩思成\n将 彭涵调整到4月13日培训，谢世成调整到4月21日培训\n\n调整后4月13日培训人员为：蔡一凡、宋典伦、胡斌、程彬、彭涵\n调整后4月21日培训人员为：熊德志、陈双群、胡兆衍、方健羽、刘毅、谢世成'),

      h2('3.4 培训确认与评价'),
      bullet('培训结束后，教员进入对应日期卡片，对每位参训成员点击【确认】并填写评价'),
      bullet('确认后系统向教员群推送完成通知，班组长可在平台查看评价内容'),
      tip('消息格式示例',
        '17:45  教员 韩思成\n已确认 蔡一凡、宋典伦、彭涵 完成4月13日培训\n班组长可进入月度任务板块查看评价'),
      note('每保存一次评价即推送一条，多次评价会累计显示已确认名单。'),

      h2('3.5 培训日志导出'),
      bullet('点击右上角【📊 导出】按钮'),
      bullet('弹窗中选择月份，并勾选需要导出的班次（支持多选，不受整月限制）'),
      bullet('点击导出生成 Excel 文件，包含：日期、班次、小组、成员、出勤状态、评价等字段'),

      h2('3.6 培训照片'),
      bullet('卡片内可上传培训现场照片（支持直接拍照或从相册选取）'),
      bullet('上传为后台压缩处理，不影响当前操作，上传完成后有提示'),
      bullet('右上角【相册】可浏览本月所有培训照片，点击可全屏查看并下载'),

      divider(),

      // ── 4. 管理员后台 ─────────────────────────────────────────────────────
      h1('四、管理员后台'),

      h2('4.1 员工管理'),
      bullet('新增 / 编辑员工：工号、姓名、手机尾号、身份标记'),
      bullet('身份标记说明：'),
      bullet('教员：可进入编辑模式，操作培训计划', 1),
      bullet('班组长：最高权限，免答题，免月度任务', 1),
      bullet('固定成员：每次培训都参与，不受小组换人影响', 1),
      bullet('豁免员工：无需参与答题考核', 1),

      h2('4.2 小组管理'),
      bullet('创建培训小组，指定小组负责人（教员）'),
      bullet('为小组添加/移除成员'),
      bullet('固定成员统一管理，不归属任何小组但每次都参与'),

      h2('4.3 排班设置'),
      bullet('为每一天设置班次（早班 / 夜班 / 休息）'),
      bullet('排班决定定时推送是否触发，以及推送内容'),

      h2('4.4 培训计划管理'),
      bullet('月度培训计划：指定每次培训的日期、类型（实操/理论/中旬会）、地点、小组'),
      bullet('重排：自动按轮班规则重新生成月度计划，支持指定起始小组'),
      bullet('安全培训日期单独设置'),

      h2('4.5 年度计划导入（AI识别）'),
      bullet('在设置板块【导入年度培训计划】区域，上传图片/Excel/PDF/Word文件'),
      bullet('点击【🤖 识别】，系统调用AI自动提取：月份、培训项点、培训方式'),
      bullet('识别完成后填充到下方12个月列表，可手动编辑修改'),
      bullet('保存后首页【月度任务】框内自动显示本月培训项点'),
      note('识别支持手写图片，但字迹清晰度影响识别准确率，建议扫描件或拍照清晰。'),

      h2('4.6 钉钉推送管理'),
      bullet('在管理后台可手动触发：次日培训预告、当天培训提醒'),
      bullet('也可直接在后台测试推送消息，验证钉钉机器人连接状态'),

      divider(),

      // ── 5. 员工首页说明 ───────────────────────────────────────────────────
      h1('五、员工首页功能说明'),
      p('员工登录后看到的主页包含以下区域：'),
      br(),
      makeTable(
        ['区域', '内容说明'],
        [
          ['任务中心', '当前待完成的答题任务、补答提示、截止时间'],
          ['月度任务', '本月年度计划中的培训项点列表（最多显示6条）'],
          ['近期培训', '距下次培训的倒计时、培训日期和轮班周期说明'],
          ['排行榜入口', '答题积分排行，月度 / 季度双榜'],
          ['我的信息', '个人答题历史、分析报告、练习强化'],
        ],
      ),

      divider(),

      // ── 6. 钉钉自动推送机制 ───────────────────────────────────────────────
      h1('六、钉钉自动推送机制'),
      p('系统配置了两类推送，分别用于定时提醒和操作实时通知。'),

      h2('6.1 定时推送（自动触发）'),
      br(),
      makeTable(
        ['推送时机', '触发条件', '推送内容', '格式'],
        [
          ['每天 15:00', '今日为夜班', '次日早班培训预告', 'ActionCard卡片（含按钮）'],
          ['每天 08:30', '今日为早班', '当天培训出发提醒', 'ActionCard卡片（含按钮）'],
        ],
      ),
      br(),
      p('卡片消息包含：日期、小组、培训类型、地点、教员、组员、调整备注，底部有两个快捷按钮：'),
      bullet('【📅 查看日程】→ 打开平台首页'),
      bullet('【🚂 进入车间】→ 教员专属免登链接，点击直接跳过登录进入月度任务板块（48小时有效）'),
      br(),
      p('消息示例（卡片标题）：🔔 明日早班培训提醒', { bold: true }),
      bullet('📅 4月13日（周一）'),
      bullet('📍 第三小组 · 实操培训 · 青菱车场'),
      bullet('👨‍🏫 小组负责人：韩思成'),
      bullet('🎖 班组长：艾凌风'),
      bullet('👥 组员：蔡一凡、宋典伦、胡斌、程彬、彭涵'),
      bullet('📌 固定成员：曹枝满、贺子涵'),
      bullet('📝 人员调整：彭涵（调整至4月13日），谢世成（调整至4月21日）'),
      bullet('⚠️ 如需请假，请在今晚 18:00 前联系教员调整。'),
      note('定时推送在非对应班次日自动跳过，无需手动关闭。'),

      h2('6.2 操作实时推送（行为触发）'),
      p('以下操作完成后立即推送到教员群，无延迟：'),
      br(),
      makeTable(
        ['触发操作', '推送内容'],
        [
          ['教员互换两人', '操作人、两人姓名、调整去向、调整后各日期完整名单'],
          ['教员将某人延后', '操作人、姓名、从哪天调到哪天、调整后目标日期名单'],
          ['教员确认评价', '教员姓名、已确认成员名单、培训日期、提示班组长查看评价'],
        ],
      ),
      br(),
      p('换人推送格式示例：', { bold: true }),
      new Paragraph({
        children: [new TextRun({ text:
          '17:32  教员 韩思成\n将 彭涵调整到4月13日培训，谢世成调整到4月21日培训\n\n调整后4月13日培训人员为：蔡一凡、宋典伦、胡斌、程彬、彭涵\n调整后4月21日培训人员为：熊德志、陈双群、胡兆衍、方健羽、刘毅、谢世成',
          size: 18, color: GRAY, font: 'Courier New',
        })],
        spacing: { before: 60, after: 60 },
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.THICK, size: 8, color: GOLD } },
      }),
      br(),
      p('评价确认推送格式示例：', { bold: true }),
      new Paragraph({
        children: [new TextRun({ text:
          '17:45  教员 韩思成\n已确认 蔡一凡、宋典伦、彭涵 完成4月13日培训\n班组长可进入月度任务板块查看评价',
          size: 18, color: GRAY, font: 'Courier New',
        })],
        spacing: { before: 60, after: 60 },
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.THICK, size: 8, color: GOLD } },
      }),

      divider(),

      // ── 7. 快速操作流程 ───────────────────────────────────────────────────
      h1('七、常用场景快速操作流程'),

      h2('场景1：培训前一天，确认次日人员并调整'),
      new Paragraph({
        children: [new TextRun({ text: '①', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 进入月度任务板块，找到次日培训卡片', size: 20 })],
        spacing: { before: 40, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '②', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 点击【✎ 编辑】进入编辑模式', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '③', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 如有换人需求，选择换人/延后操作', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '④', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 操作完成后系统自动推送钉钉通知到群', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '⑤', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 当天15:00系统自动发送次日培训预告（含最新名单）', size: 20 })],
        spacing: { before: 20, after: 60 }, indent: { left: convertInchesToTwip(0.1) },
      }),

      h2('场景2：培训结束后确认评价'),
      new Paragraph({
        children: [new TextRun({ text: '①', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 培训结束，教员在月度任务板块找到当天卡片', size: 20 })],
        spacing: { before: 40, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '②', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 逐人点击确认，填写评价内容', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '③', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 每次确认后群内自动推送完成通知', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '④', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 需要查阅历史记录时，点击导出生成 Excel', size: 20 })],
        spacing: { before: 20, after: 60 }, indent: { left: convertInchesToTwip(0.1) },
      }),

      h2('场景3：月初录入年度培训计划'),
      new Paragraph({
        children: [new TextRun({ text: '①', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 管理员进入后台 → 设置 → 导入年度培训计划', size: 20 })],
        spacing: { before: 40, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '②', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 上传车间下发的年度计划图片或文档', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '③', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 点击【🤖 识别】，等待AI识别完成', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '④', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 检查识别结果，按需手动修正，点击保存', size: 20 })],
        spacing: { before: 20, after: 20 }, indent: { left: convertInchesToTwip(0.1) },
      }),
      new Paragraph({
        children: [new TextRun({ text: '⑤', bold: true, color: GOLD, size: 20 }), new TextRun({ text: ' 各员工首页月度任务框自动显示本月计划项点', size: 20 })],
        spacing: { before: 20, after: 60 }, indent: { left: convertInchesToTwip(0.1) },
      }),

      divider(),

      // ── 8. 注意事项 ───────────────────────────────────────────────────────
      h1('八、注意事项'),
      bullet('钉钉快捷入口链接有效期为 48 小时，过期后需重新在月度任务板块生成'),
      bullet('定时推送在15:00（预告）和08:30（提醒）自动触发，非对应班次日跳过，无需手动操作'),
      bullet('评价确认推送和换人推送是两条独立消息，不会合并'),
      bullet('临时换人记录会体现在当天15:00的预告消息中，注明"人员调整"'),
      bullet('系统访问地址为 https://peixun.zealerhan.cn，建议保存到浏览器书签或钉钉收藏'),
      bullet('如遇系统无法访问，可联系管理员检查服务器状态'),
      br(),
      note('本文档与系统同步更新，如有功能变更以实际系统为准。'),

      divider(),

      new Paragraph({
        children: [new TextRun({ text: '武汉地铁5号线乘务段  |  培训管理系统  |  2026年4月', size: 16, color: GRAY })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 120 },
      }),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
const outPath = path.join('/Users/hanying/peixun/app/dist', '培训平台操作指南.docx');
fs.writeFileSync(outPath, buf);
console.log('生成完成：', outPath);
