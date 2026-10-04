'use strict';
/**
 * 100 TB institutional storage vault.
 * Real files on disk; every byte reported is measured with fs.statSync — nothing is simulated.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, nowISO, VAULT, getSetting } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();
const quota = () => Number(getSetting('vault_quota', 100 * 1024 ** 4));

function usedBytes() {
  const r = db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM vault_files').get();
  return Number(r.n);
}

function diskFree() {
  try {
    const st = fs.statfsSync(VAULT);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch { return { free: null, total: null }; }
}

/** Vault is restricted to the super admin, the DG/CEO and anyone explicitly toggled in. */
function vaultGate(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'DG_CEO' || C.can(req.user, 'vault.access')) return next();
  return res.status(403).json({ error: 'The storage vault is restricted to the Super Administrator and the DG/CEO' });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, VAULT),
    filename: (_r, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 ** 3 }, // 5 GB per file
}).array('files', 20);

router.get('/', C.requireAuth, vaultGate, (req, res) => {
  const files = db.prepare(`SELECT v.*, u.full_name AS uploader, u.uid AS uploader_uid
                            FROM vault_files v LEFT JOIN users u ON u.id=v.uploaded_by
                            ORDER BY v.created_at DESC LIMIT 500`).all();
  const folders = db.prepare('SELECT folder, COUNT(*) n, COALESCE(SUM(size),0) bytes FROM vault_files GROUP BY folder ORDER BY folder').all();
  const used = usedBytes();
  const q = quota();
  res.json({
    files, folders,
    usage: {
      used, quota: q, free: q - used,
      percent: q ? Math.round((used / q) * 1e8) / 1e6 : 0,
      file_count: files.length,
      host_disk: diskFree(),
    },
  });
});

router.post('/upload', C.requireAuth, vaultGate, (req, res) => {
  const incoming = Number(req.headers['content-length'] || 0);
  if (usedBytes() + incoming > quota()) return res.status(507).json({ error: 'Upload exceeds the 100 TB vault quota' });
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const folder = String((req.body && req.body.folder) || 'General').trim() || 'General';
    const saved = [];
    for (const f of req.files || []) {
      const realSize = fs.statSync(path.join(VAULT, f.filename)).size; // measured, not reported
      const info = db.prepare('INSERT INTO vault_files (name,stored_name,mime,size,folder,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(f.originalname, f.filename, f.mimetype, realSize, folder, req.user.id, nowISO());
      saved.push({ id: info.lastInsertRowid, name: f.originalname, size: realSize, folder });
    }
    if (!saved.length) return res.status(400).json({ error: 'No file received' });
    C.audit(req.user, 'VAULT_UPLOAD', 'vault', { files: saved.length, bytes: saved.reduce((a, s) => a + s.size, 0), folder }, req.ip);
    const used = usedBytes();
    rt.broadcast('vault:changed', { used, quota: quota(), file_count: db.prepare('SELECT COUNT(*) n FROM vault_files').get().n }, { roles: ['SUPER_ADMIN', 'DG_CEO'] });
    res.status(201).json({ saved, usage: { used, quota: quota() } });
  });
});

router.get('/:id/download', C.requireAuth, vaultGate, (req, res) => {
  const f = db.prepare('SELECT * FROM vault_files WHERE id=?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'File not found' });
  const p = path.join(VAULT, f.stored_name);
  if (!fs.existsSync(p)) return res.status(410).json({ error: 'The stored object is missing from disk' });
  C.audit(req.user, 'VAULT_DOWNLOAD', 'vault:' + f.id, { name: f.name }, req.ip);
  res.download(p, f.name);
});

router.delete('/:id', C.requireAuth, vaultGate, (req, res) => {
  const f = db.prepare('SELECT * FROM vault_files WHERE id=?').get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'File not found' });
  try { fs.unlinkSync(path.join(VAULT, f.stored_name)); } catch {}
  db.prepare('DELETE FROM vault_files WHERE id=?').run(f.id);
  C.audit(req.user, 'VAULT_DELETE', 'vault:' + f.id, { name: f.name, size: f.size }, req.ip);
  rt.broadcast('vault:changed', { used: usedBytes(), quota: quota(), file_count: db.prepare('SELECT COUNT(*) n FROM vault_files').get().n }, { roles: ['SUPER_ADMIN', 'DG_CEO'] });
  res.json({ ok: true });
});

module.exports = router;
