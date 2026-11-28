// ─── 留言墙 API（2026-11-28 从 leave.js 拆出）────────────────────────────
//
// 为什么拆：leave.js 原来 2,554 行，把休假、留言墙、班次三个业务域混在一个
// 文件里。留言墙和休假毫无关系，只是当初图省事塞进来的。
//
// 老韩定：不审核、直接显示、后台能查。可以欢乐一点（"张飞：今天想吃牛肉面"）
//
// 现状（2026-11-28）：前台入口和管理后台 tab 都已隐藏（SHOW_WALL = false），
// 因为上线后只有 5 条测试数据，组员没用起来。**接口全部保留**，
// 把 shared.jsx 的 SHOW_WALL 改回 true 即恢复。
//
// 依赖约定：本文件只碰 wall_posts 表和 data/wall-images 目录，
// 不 import leave.js 里的任何东西。

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { adminAuth } = require('../middleware');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// 留言图片：内存收，sharp 压，落盘 data/wall-images
const WALL_IMG_DIR = path.join(__dirname, '..', '..', 'data', 'wall-images');

const wallUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },   // 12MB 原图上限
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('只能传图片'));
    cb(null, true);
  },
});

// 从请求头取 staffId（与 leave.js 的 reqStaffId 同语义，此处独立实现，
// 避免为一个小函数把整个 leave.js 拖成公共依赖）
function reqStaffId(req) {
  const v = req.headers['x-staff-id'];
  return v ? String(v).trim() : '';
}

// ── 取留言（前台，只返回公开字段，不含真实身份）──
router.get('/api/wall/posts', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const rows = db.prepare(`
      SELECT id, nick, content, image, created_at FROM wall_posts
      WHERE is_hidden = 0 ORDER BY id DESC LIMIT ?
    `).all(limit);
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ── 发留言（前台）— 需登录身份，但不对外显示 ──
// 支持纯文字 / 文字+图片（multipart，字段名 image）
router.post('/api/wall/posts', wallUpload.single('image'), async (req, res) => {
  try {
    const sid = reqStaffId(req);
    if (!sid) return res.status(401).json({ error: '请先登录' });
    const { nick, content } = req.body || {};
    const n = String(nick || '').trim();
    const c = String(content || '').trim();
    const hasImg = !!req.file;
    if (!n) return res.status(400).json({ error: '请填名字' });
    if (!c && !hasImg) return res.status(400).json({ error: '写点内容或传张图' });
    if (n.length > 12) return res.status(400).json({ error: '名字最多 12 字' });
    if (c.length > 200) return res.status(400).json({ error: '留言最多 200 字' });

    // 留真身（后台可查）
    const me = db.prepare('SELECT real_name, name FROM staff WHERE id = ? LIMIT 1').get(String(sid));

    // 防刷：同一人 1 分钟只能发 1 条
    const recent = db.prepare(`
      SELECT id FROM wall_posts WHERE staff_id = ?
        AND created_at >= datetime('now','localtime','-1 minute')
    `).get(sid);
    if (recent) return res.status(429).json({ error: '慢一点，1 分钟后再发' });

    // ── 有图就压缩落盘 ──
    let imagePath = null;
    if (hasImg) {
      fs.mkdirSync(WALL_IMG_DIR, { recursive: true });
      const fname = `w${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      try {
        await sharp(req.file.buffer)
          .rotate()                                  // 按 EXIF 摆正（手机竖拍）
          .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(path.join(WALL_IMG_DIR, fname));
        imagePath = '/wall-images/' + fname;
      } catch (e) {
        return res.status(400).json({ error: '图片处理失败，换一张试试' });
      }
    }

    const info = db.prepare(`
      INSERT INTO wall_posts (nick, content, staff_id, real_name, image)
      VALUES (?,?,?,?,?)
    `).run(n, c, String(sid), me ? (me.real_name || me.name) : null, imagePath);

    res.json({ ok: true, id: info.lastInsertRowid, image: imagePath });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ── 管理后台：查留言（含真实身份）──
router.get('/api/wall/admin/posts', adminAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, nick, content, image, real_name, staff_id, is_hidden, created_at
      FROM wall_posts ORDER BY id DESC LIMIT 200
    `).all();
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// ── 管理后台：隐藏/恢复留言 ──
router.post('/api/wall/admin/:id/hide', adminAuth, (req, res) => {
  try {
    const hide = req.body?.hidden ? 1 : 0;
    db.prepare('UPDATE wall_posts SET is_hidden = ? WHERE id = ?').run(hide, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

module.exports = router;
