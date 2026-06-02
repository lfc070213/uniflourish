// 轻量 Webmail API — IMAP 读邮件 + SMTP 发邮件
const express = require('express');
const router = express.Router();
const { requireUser, SECRET } = require('./middleware/auth');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

// 内存中暂存用户密码（仅用于 IMAP 连接，登出/重启清除）
const userPasswords = new Map();

function storePassword(userId, password) {
  userPasswords.set(userId.toString(), { password, time: Date.now() });
}
function getPassword(userId) {
  return userPasswords.get(userId.toString())?.password;
}
function clearPassword(userId) {
  userPasswords.delete(userId.toString());
}

// 定时清理 24h 过期密码
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of userPasswords) { if (v.time < cutoff) userPasswords.delete(k); }
}, 60 * 60 * 1000);

// 在 login 时调用此函数保存密码
const onLogin = (userId, password) => { if (password) storePassword(userId, password); };
const onLogout = (userId) => { clearPassword(userId); };

// IMAP 连接辅助
async function imapConnect(userEmail, password) {
  const client = new ImapFlow({
    host: '127.0.0.1', port: 143, secure: false,
    auth: { user: userEmail, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false }
  });
  await client.connect();
  return client;
}

// ---------- 获取收件箱列表 ----------
router.get('/inbox', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.userId).select('allocatedEmail');
    if (!user?.allocatedEmail) return res.status(400).json({ error: '未分配邮箱' });

    const pwd = getPassword(req.userId);
    if (!pwd) return res.status(401).json({ error: '请重新登录以访问邮箱' });

    const page = parseInt(req.query.page) || 1;
    const pageSize = 30;
    const client = await imapConnect(user.allocatedEmail, pwd);
    const mailbox = await client.mailboxOpen('INBOX');
    const total = mailbox.exists;
    const start = Math.max(1, total - page * pageSize + 1);
    const end = total - (page - 1) * pageSize;
    if (start > total) { await client.logout(); return res.json({ messages: [], total, page }); }

    const messages = [];
    for (let seq = start; seq <= end; seq++) {
      const fetch = await client.fetchOne(String(seq), { source: true, uid: true, flags: true, envelope: true, internalDate: true }, { uid: true });
      const parsed = await simpleParser(fetch.source);
      messages.unshift({
        uid: fetch.uid,
        seen: fetch.flags.has('\\Seen'),
        from: parsed.from?.text || 'Unknown',
        subject: parsed.subject || '(无主题)',
        date: parsed.date || fetch.internalDate,
        hasAttachments: parsed.attachments?.length > 0
      });
    }
    await client.logout();
    res.json({ messages, total, page, pages: Math.ceil(total / pageSize) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 获取单封邮件 ----------
router.get('/message/:uid', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.userId).select('allocatedEmail');
    if (!user?.allocatedEmail) return res.status(400).json({ error: '未分配邮箱' });

    const pwd = getPassword(req.userId);
    if (!pwd) return res.status(401).json({ error: '请重新登录' });

    const client = await imapConnect(user.allocatedEmail, pwd);
    await client.mailboxOpen('INBOX');
    const fetch = await client.fetchOne(req.params.uid, { source: true, flags: true }, { uid: true });
    const parsed = await simpleParser(fetch.source);
    // Mark as seen
    await client.messageFlagsAdd(req.params.uid, ['\\Seen'], { uid: true });
    await client.logout();

    res.json({
      uid: req.params.uid,
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      subject: parsed.subject || '(无主题)',
      date: parsed.date,
      html: parsed.html || '',
      text: parsed.text || '',
      attachments: (parsed.attachments || []).map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 发邮件 ----------
router.post('/send', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.userId).select('allocatedEmail');
    if (!user?.allocatedEmail) return res.status(400).json({ error: '未分配邮箱' });

    const pwd = getPassword(req.userId);
    if (!pwd) return res.status(401).json({ error: '请重新登录' });

    const { to, subject, body } = req.body;
    if (!to || !subject) return res.status(400).json({ error: '收件人和主题不能为空' });

    // 站内邮件走本地 Poste.io，外部邮件走 Resend
    const isInternal = Array.isArray(to) ? to.every(a => a.endsWith('@uniflourish.top')) : to.endsWith('@uniflourish.top');

    const transporter = isInternal
      ? nodemailer.createTransport({ host: '127.0.0.1', port: 587, auth: { user: user.allocatedEmail, pass: pwd } })
      : nodemailer.createTransport({ host: 'smtp.resend.com', port: 587, auth: { user: 'resend', pass: process.env.RESEND_API_KEY || '' } });

    await transporter.sendMail({
      from: user.allocatedEmail,
      to, subject,
      html: body || '', text: body?.replace(/<[^>]*>/g, '') || ''
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 删除/移动到回收站 ----------
router.delete('/message/:uid', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.userId).select('allocatedEmail');
    if (!user?.allocatedEmail) return res.status(400).json({ error: '未分配邮箱' });

    const pwd = getPassword(req.userId);
    if (!pwd) return res.status(401).json({ error: '请重新登录' });

    const client = await imapConnect(user.allocatedEmail, pwd);
    await client.mailboxOpen('INBOX');
    await client.messageMove(req.params.uid, 'Trash', { uid: true });
    await client.logout();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, onLogin, onLogout };
