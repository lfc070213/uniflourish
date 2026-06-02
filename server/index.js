// 项目名: Uniflourish | 版本号: v2.1.0
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const httpProxy = require('http-proxy');
const { exec } = require('child_process');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// ================= ICP 备案域名限制 =================
// uniflourish.top 仅展示 AI 助理 + 词汇学习，其他功能通过 Tailscale 域名访问
app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase();
  if (host !== 'uniflourish.top' && host !== 'www.uniflourish.top') return next();

  // 备案域名允许的路由白名单
  const allowed = ['/vocab', '/uniflourish', '/login', '/account', '/api', '/uploads', '/notice'];
  const isAllowed = allowed.some(p =>
    req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p + '?')
  ) || req.path === '/';

  if (!isAllowed) return res.redirect('/');

  // 首页替换为备案专用精简版
  if (req.path === '/') {
    return res.sendFile(path.join(__dirname, 'yingchao', 'record.html'));
  }

  next();
});

const { requireUser, requireAdmin, optionalAuth, SECRET } = require('./middleware/auth');
const { createMailbox, setMailboxQuota, updateMailboxPassword, sendVerificationCode, sanitizeEmailPrefix, generateCode } = require('./email-helper');

// 验证码存储（5分钟过期）
const verifyCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of verifyCodes) { if (now > v.expires) verifyCodes.delete(k); }
}, 60000);

// ================= 数据库连接与账号注入 =================
mongoose.connect('mongodb://127.0.0.1:27017/lifuchun-platform')
  .then(async () => {
    console.log('✅ lifuchun-platform 数据库连接成功');
    const User = require('./models/User');
    // 确保超级管理员存在
    const existingAdmin = await User.findOne({ username: 'admin' });
    if (!existingAdmin) {
      const hp = await bcrypt.hash('myc200703120213', 10);
      await User.create({ username: 'admin', password: hp, role: 'super_admin' });
      console.log('🌱 初始超级管理员 (admin) 注入成功');
    }
    // 确保低级管理员存在
    const existingPoor = await User.findOne({ username: 'adminpoor' });
    if (!existingPoor) {
      const hp = await bcrypt.hash('myc200703120213', 10);
      await User.create({ username: 'adminpoor', password: hp, role: 'poor_admin' });
      console.log('🌱 初始低级管理员 (adminpoor) 注入成功');
    }
    // 确保默认模型存在
    const DefaultModel = require('./models/DefaultModel');
    const defaultModelCount = await DefaultModel.countDocuments();
    if (defaultModelCount === 0) {
      const defaults = [
        { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite', provider: 'google' },
        { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', provider: 'google' },
        { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview', provider: 'google' },
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', provider: 'deepseek' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', provider: 'deepseek' },
      ];
      await DefaultModel.insertMany(defaults);
      console.log('🌱 默认模型种子数据注入成功');
    }
  })
  .catch(err => console.error('❌ 数据库连接失败:', err.message));

// ================= Schema 定义（仅 index.js 内部使用的） =================
const AdminLogSchema = new mongoose.Schema({
  adminUsername: String,
  action: String,
  targetUser: String,
  timestamp: { type: Date, default: Date.now }
});
const AdminLog = mongoose.model('AdminLog', AdminLogSchema);

const ResetRequestSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const ResetRequest = mongoose.model('ResetRequest', ResetRequestSchema);

const VocabProgressSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  data: { type: Object, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const VocabProgress = mongoose.model('VocabProgress', VocabProgressSchema);

const AnnouncementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: String, required: true },
}, { timestamps: true });
const Announcement = mongoose.model('Announcement', AnnouncementSchema);

const logAction = async (adminUsername, action, targetUser) => {
  try {
    await AdminLog.create({ adminUsername, action, targetUser });
  } catch (e) { console.error("审计日志记录失败", e); }
};

// ================= 中间件（辅助） =================
const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(c => {
    const idx = c.indexOf("=");
    if (idx > 0) cookies[c.substring(0, idx).trim()] = decodeURIComponent(c.substring(idx + 1));
  });
  return cookies;
};

// ================= 登录与注册与同步 =================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const User = require('./models/User');

    if (username === 'admin' && password === 'myc200703120213') {
      const adminUser = await User.findOne({ username: 'admin' });
      const uid = adminUser ? adminUser._id : 'admin_uid';
      const token = jwt.sign({ uid: uid, role: 'super_admin', username: 'admin' }, SECRET);
      const cookieOpts = { httpOnly: true, secure: false, sameSite: 'lax', path: '/' };
      res.cookie('token', token, { ...cookieOpts, maxAge: 30 * 24 * 60 * 60 * 1000 });
      mailOnLogin(uid, password);
      const DefaultModel = require('./models/DefaultModel');
      return res.json({ token, role: 'super_admin', username: 'admin', allocatedEmail: adminUser?.allocatedEmail, defaultModels: await DefaultModel.find().lean() });
    }

    if (!username || !password) return res.status(400).json({ error: "账号或密码不能为空" });
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "用户不存在" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "密码错误" });

    const role = user.role || 'user';
    const token = jwt.sign({ uid: user._id, role: role, username: user.username }, SECRET);

    // 自动分配邮箱（异步，不阻塞登录响应）
    if (!user.allocatedEmail) {
      const prefix = sanitizeEmailPrefix(username);
      const exists = await User.findOne({ allocatedEmail: `${prefix}@uniflourish.top` });
      const finalPrefix = exists ? `${prefix}${Date.now().toString(36)}` : prefix;
      const finalEmail = `${finalPrefix}@uniflourish.top`;
      createMailbox(finalPrefix, password).then(async (result) => {
        if (result.success) {
          await User.findByIdAndUpdate(user._id, { allocatedEmail: finalEmail });
          setMailboxQuota(finalPrefix);
        }
      }).catch(() => {});
      user.allocatedEmail = finalEmail;
      await User.findByIdAndUpdate(user._id, { allocatedEmail: finalEmail });
    }

    // Cookie 登录态
    const rememberMe = req.body.rememberMe;
    const cookieOpts = { httpOnly: true, secure: false, sameSite: 'lax', path: '/' };
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : undefined;
    res.cookie('token', token, { ...cookieOpts, ...(maxAge ? { maxAge } : {}) });

    // 存储密码供 IMAP 使用
    if (password) mailOnLogin(user._id.toString(), password);

    res.json({
      token, role, username: user.username, allocatedEmail: user.allocatedEmail,
      needBind: !user.boundEmail || !user.emailVerified,
      sessionList: (user.sessions || []).map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt })),
      longTermMemory: user.longTermMemory || "",
      geminiKey: user.geminiKey || "", deepseekKey: user.deepseekKey || "",
      doubaoKey: user.doubaoKey || "", kimiKey: user.kimiKey || "",
      claudeKey: user.claudeKey || "", openaiKey: user.openaiKey || "",
      customModels: user.customModels || [],
      defaultModels: await (require('./models/DefaultModel').find().lean())
    });
  } catch (err) { res.status(500).json({ error: "服务器内部错误" }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const User = require('./models/User');
    if (username === 'admin') return res.status(400).json({ error: "保留字，无法注册" });
    if (!username || !password) return res.status(400).json({ error: "账号密码不能为空" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const prefix = sanitizeEmailPrefix(username);
    const email = `${prefix}@uniflourish.top`;
    const exists = await User.findOne({ allocatedEmail: email });
    const finalPrefix = exists ? `${prefix}${Date.now().toString(36)}` : prefix;
    const finalEmail = `${finalPrefix}@uniflourish.top`;

    const user = await User.create({ username, password: hashedPassword, role: 'user', allocatedEmail: finalEmail });
    createMailbox(finalPrefix, password).then(r => {
      if (r.success) { setMailboxQuota(finalPrefix); }
      else { console.error(`[Register] 邮箱创建失败: ${username}`); }
    }).catch(() => {});
    res.json({ success: true, email: finalEmail });
  } catch (e) { res.status(400).json({ error: "用户名已存在" }); }
});

app.post('/api/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send();
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    const User = require('./models/User');

    const user = await User.findById(decoded.uid);
    if (!user) return res.status(404).json({ error: "用户异常" });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(401).json({ error: "原密码验证失败" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    // 同步邮箱密码
    if (user.allocatedEmail) {
      const mailboxUser = user.allocatedEmail.replace('@uniflourish.top', '');
      updateMailboxPassword(mailboxUser, newPassword).catch(() => {});
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "修改失败" }); }
});

app.post('/api/sync', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send();
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role === 'super_admin' || decoded.role === 'poor_admin') return res.status(200).send();
    const User = require('./models/User');

    const { sessions, longTermMemory, geminiKey, deepseekKey, doubaoKey, kimiKey, claudeKey, openaiKey, customModels } = req.body;
    const update = { sessions, longTermMemory, customModels };
    if (geminiKey !== undefined && geminiKey !== '') update.geminiKey = geminiKey;
    if (deepseekKey !== undefined && deepseekKey !== '') update.deepseekKey = deepseekKey;
    if (doubaoKey !== undefined && doubaoKey !== '') update.doubaoKey = doubaoKey;
    if (kimiKey !== undefined && kimiKey !== '') update.kimiKey = kimiKey;
    if (claudeKey !== undefined && claudeKey !== '') update.claudeKey = claudeKey;
    if (openaiKey !== undefined && openaiKey !== '') update.openaiKey = openaiKey;
    await User.findByIdAndUpdate(decoded.uid, update);
    res.json({ success: true });
  } catch (e) { res.status(401).send(); }
});

// 按需加载单个会话的消息
app.get('/api/session/:id', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send();
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    const User = require('./models/User');
    const user = await User.findById(decoded.uid).select('sessions');
    if (!user) return res.status(404).send();
    const session = (user.sessions || []).find(s => s.id === req.params.id);
    if (!session) return res.status(404).json({ error: '会话不存在' });
    res.json({ messages: session.messages || [] });
  } catch (e) { res.status(401).send(); }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "需提供用户名" });
    const User = require('./models/User');

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "该用户不存在" });

    // 如果有绑定外部邮箱，走验证码自助重置
    if (user.boundEmail && user.emailVerified) {
      const code = generateCode();
      verifyCodes.set(`reset:${username}`, { code, expires: Date.now() + 5 * 60 * 1000 });
      const sent = await sendVerificationCode(user.boundEmail, code, 'reset');
      if (sent) {
        return res.json({ emailReset: true, hint: user.boundEmail.replace(/(.{2}).*(@.*)/, '$1***$2'), message: '验证码已发送至您的绑定邮箱' });
      }
      return res.status(500).json({ error: "验证码发送失败，请稍后重试" });
    }

    // 未绑定邮箱，走管理员审批
    const existingRequest = await ResetRequest.findOne({ username });
    if (existingRequest) {
      if (existingRequest.status === 'approved') {
        await ResetRequest.deleteOne({ username });
        return res.json({ approved: true, message: "您的密码已由管理员重置为 123456" });
      }
      return res.json({ pending: true, message: "您的重置申请正在等待管理员审核" });
    }
    await ResetRequest.create({ username });
    return res.json({ success: true, message: "未绑定邮箱，已提交管理员审批" });
  } catch (e) { res.status(500).json({ error: "服务器内部错误" }); }
});

// ================= 邮箱系统 =================
// 发送绑定邮箱验证码
app.post('/api/user/send-bind-code', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.userId);
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "请输入邮箱地址" });

    const code = generateCode();
    verifyCodes.set(`bind:${user.username}`, { email, code, expires: Date.now() + 5 * 60 * 1000 });
    const sent = await sendVerificationCode(email, code, 'bind');
    if (sent) {
      return res.json({ success: true, message: `验证码已发送至 ${email}` });
    }
    res.status(500).json({ error: "验证码发送失败" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 确认绑定邮箱
app.post('/api/user/bind-email', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "缺少参数" });

    const user = await User.findById(req.userId);
    const record = verifyCodes.get(`bind:${user.username}`);
    if (!record || record.email !== email || record.code !== code) {
      return res.status(400).json({ error: "验证码错误或已过期" });
    }

    await User.findByIdAndUpdate(req.userId, { boundEmail: email, emailVerified: true });
    verifyCodes.delete(`bind:${user.username}`);
    res.json({ success: true, message: "邮箱绑定成功" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 通过验证码重置密码
app.post('/api/user/reset-password', async (req, res) => {
  try {
    const User = require('./models/User');
    const { username, code, newPassword } = req.body;
    if (!username || !code || !newPassword) return res.status(400).json({ error: "缺少参数" });

    const record = verifyCodes.get(`reset:${username}`);
    if (!record || record.code !== code) {
      return res.status(400).json({ error: "验证码错误或已过期" });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "用户不存在" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    verifyCodes.delete(`reset:${username}`);

    // 同步邮箱密码
    if (user.allocatedEmail) {
      const mailboxUser = user.allocatedEmail.replace('@uniflourish.top', '');
      updateMailboxPassword(mailboxUser, newPassword).catch(() => {});
    }

    res.json({ success: true, message: "密码重置成功，请使用新密码登录" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 论坛轻量认证（不加载 Uniflourish 数据） =================
app.post('/api/auth', async (req, res) => {
  try {
    const { username, password } = req.body;
    const User = require('./models/User');

    if (username === 'admin' && password === 'myc200703120213') {
      const adminUser = await User.findOne({ username: 'admin' });
      const uid = adminUser ? adminUser._id : 'admin_uid';
      const token = jwt.sign({ uid: uid, role: 'super_admin', username: 'admin' }, SECRET);
      res.cookie('token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.json({ token, role: 'super_admin', username: 'admin' });
    }

    if (!username || !password) return res.status(400).json({ error: "账号或密码不能为空" });
    const user = await User.findOne({ username }).select('username password role allocatedEmail boundEmail emailVerified');
    if (!user) return res.status(401).json({ error: "用户不存在" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "密码错误" });

    const role = user.role || 'user';
    const token = jwt.sign({ uid: user._id, role: role, username: user.username }, SECRET);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
    if (password) mailOnLogin(user._id.toString(), password);
    res.json({ token, role, username: user.username, allocatedEmail: user.allocatedEmail,
      needBind: !user.boundEmail || !user.emailVerified });
  } catch (err) { res.status(500).json({ error: "服务器内部错误" }); }
});

// ================= 登出 =================
app.post('/api/logout', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try { const d = jwt.verify(token, SECRET); mailOnLogout(d.uid); } catch(e) {}
  }
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

// ================= 用户资料更新 =================
app.put('/api/user/profile', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const allowed = ['nickname', 'avatar', 'bio', 'geminiKey', 'deepseekKey', 'doubaoKey', 'kimiKey', 'claudeKey', 'openaiKey', 'customModels'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    await User.findByIdAndUpdate(req.userId, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 当前用户信息 =================
app.get('/api/me', requireUser, async (req, res) => {
  try {
    const User = require('./models/User');
    const Notification = require('./models/Notification');
    const [user, unreadCount] = await Promise.all([
      User.findById(req.userId).select('username role nickname avatar bio friendCount postCount commentCount friends blockedUsers allocatedEmail boundEmail emailVerified geminiKey deepseekKey doubaoKey kimiKey claudeKey openaiKey customModels'),
      Notification.countDocuments({ recipient: req.userId, read: false })
    ]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user, unreadCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =================👑 两级管理员共享 API 👑=================
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const User = require('./models/User');
    const projection = req.adminRole === 'super_admin'
      ? { password: 0 }
      : { username: 1, role: 1, nickname: 1, allocatedEmail: 1, boundEmail: 1 };
    const users = await User.find({ role: { $ne: 'poor_admin' } }, projection).sort({ _id: -1 });
    res.json(users);
  } catch (e) { res.status(500).send(); }
});

app.post('/api/admin/reset-password/:id', requireAdmin, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send();
    const hashedPassword = await bcrypt.hash('123456', 10);
    user.password = hashedPassword;
    await user.save();
    await logAction(req.adminUsername, '强行重置密码', user.username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.delete('/api/admin/user/:id', requireAdmin, async (req, res) => {
  try {
    const User = require('./models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send();
    await User.findByIdAndDelete(req.params.id);
    await logAction(req.adminUsername, '彻底抹除用户数据', user.username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.get('/api/admin/reset-requests', requireAdmin, async (req, res) => {
  try {
    const requests = await ResetRequest.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (e) { res.status(500).send(); }
});

app.put('/api/admin/user/:id', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).json({ error: "仅超级管理员可操作" });
  try {
    const User = require('./models/User');
    const { username, nickname, role, allocatedEmail, boundEmail } = req.body;
    const update = {};
    if (username) update.username = username;
    if (nickname !== undefined) update.nickname = nickname;
    if (role) update.role = role;
    if (allocatedEmail !== undefined) update.allocatedEmail = allocatedEmail;
    if (boundEmail !== undefined) update.boundEmail = boundEmail;
    await User.findByIdAndUpdate(req.params.id, update);
    await logAction(req.adminUsername, `编辑用户信息 (${Object.keys(update).join(',')})`, username || '');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/approve-reset/:username', requireAdmin, async (req, res) => {
  try {
    const User = require('./models/User');
    const username = req.params.username;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).send();

    const hashedPassword = await bcrypt.hash('123456', 10);
    user.password = hashedPassword;
    await user.save();

    await ResetRequest.findOneAndUpdate({ username }, { status: 'approved' });
    await logAction(req.adminUsername, '审核通过了密码重置申请', username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.post('/api/admin/reject-reset/:username', requireAdmin, async (req, res) => {
  try {
    const username = req.params.username;
    await ResetRequest.deleteOne({ username });
    await logAction(req.adminUsername, '驳回并删除了密码重置申请', username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

// =================👑 超级管理员专属：底层管理与日志 =================
app.delete('/api/admin/user/:uid/session/:sid', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).json({ error: "越权操作" });
  try {
    const User = require('./models/User');
    const user = await User.findById(req.params.uid);
    if (!user) return res.status(404).send();
    await User.findByIdAndUpdate(req.params.uid, { $pull: { sessions: { id: req.params.sid } } });
    await logAction(req.adminUsername, `删除非法会话 (ID: ${req.params.sid})`, user.username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.get('/api/admin/poor-admins', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).send();
  const User = require('./models/User');
  const admins = await User.find({ role: 'poor_admin' }, { password: 0 });
  res.json(admins);
});

app.post('/api/admin/poor-admin', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).send();
  try {
    const User = require('./models/User');
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "账号密码不能为空" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ username, password: hashedPassword, role: 'poor_admin' });
    await logAction(req.adminUsername, '创建了新的低级管理员', username);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: "创建失败，账号可能已被占用" }); }
});

app.delete('/api/admin/poor-admin/:id', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).send();
  try {
    const User = require('./models/User');
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).send();
    await User.findByIdAndDelete(req.params.id);
    await logAction(req.adminUsername, '剥夺了低级管理员权限并删除', target.username);
    res.json({ success: true });
  } catch (e) { res.status(500).send(); }
});

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  if (req.adminRole !== 'super_admin') return res.status(403).send();
  const logs = await AdminLog.find().sort({ timestamp: -1 }).limit(150);
  res.json(logs);
});

// ================= 网盘转存接收 API =================
const diskMulter = require('multer');
const diskArchiveStorage = diskMulter.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('/data', 'disk-archive', req.username || 'unknown');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'));
  }
});
const diskReceive = diskMulter({ storage: diskArchiveStorage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.put('/api/disk/receive', requireUser, diskReceive.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  res.json({ success: true, size: req.file.size });
});

// PKU 存储 — 下载文件
app.get('/api/disk/pku-download/:filename', requireUser, (req, res) => {
  const fp = path.join('/data', 'disk-archive', req.username, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
  res.download(fp, req.params.filename);
});

// PKU 存储 — 上传文件
app.post('/api/disk/pku-upload', requireUser, (req, res) => {
  const pkuUpload = diskMulter({ storage: diskArchiveStorage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
  pkuUpload.single('file')(req, res, (err) => {
    if (err) return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件超过 2GB 限制' : err.message });
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    res.json({ success: true, name: req.file.originalname, size: req.file.size });
  });
});

// PKU 存储 — 删除文件
app.delete('/api/disk/pku-delete/:filename', requireUser, (req, res) => {
  const fp = path.join('/data', 'disk-archive', req.username, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

// PKU 存储文件列表
app.get('/api/disk/pku-list', requireUser, (req, res) => {
  const dir = path.join('/data', 'disk-archive', req.username);
  if (!fs.existsSync(dir)) return res.json([]);
  try {
    const files = fs.readdirSync(dir).map(f => {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      return { name: f, size: stat.size, uploadedAt: stat.mtime.toISOString() };
    }).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(files);
  } catch (e) { res.json([]); }
});

// PKU → 阿里云 转存
app.post('/api/disk/pku-transfer/:filename', requireUser, async (req, res) => {
  const fp = path.join('/data', 'disk-archive', req.username, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
  try {
    const fileData = fs.readFileSync(fp);
    const boundary = '----PkuTransfer' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${req.params.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: '100.80.125.20', port: 3001, path: '/api/disk/receive-from-pku', method: 'PUT',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'Authorization': `Bearer ${token}` },
        timeout: 300000
      };
      const hReq = http.request(opts, (hRes) => {
        let data = '';
        hRes.on('data', c => data += c);
        hRes.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ error: data }); } });
      });
      hReq.on('error', reject);
      hReq.on('timeout', () => { hReq.destroy(); reject(new Error('Transfer timeout')); });
      hReq.write(body);
      hReq.end();
    });

    if (result.error) throw new Error(result.error);
    fs.unlinkSync(fp);
    res.json({ success: true, message: '已转存到阿里云（' + Math.round(result.size / 1048576) + 'MB），北大文件已删除' });
  } catch (e) { res.status(500).json({ error: '转存失败：' + e.message }); }
});

// ================= 服务器监控 API =================
const os = require('os');

app.get('/api/admin/monitor', requireAdmin, async (req, res) => {
  try {
    // PKU 本地
    const pkuCpu = os.cpus();
    const cpuModel = pkuCpu[0]?.model || '';
    const cpuLoad = os.loadavg()[0];
    const cpuCores = pkuCpu.length;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const pkuDisks = await new Promise((resolve) => {
      exec('df -h / /data 2>/dev/null', { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split('\n').slice(1);
        resolve(lines.map(l => {
          const p = l.trim().split(/\s+/);
          return { mount: p[5], size: p[1], used: p[2], avail: p[3], usePct: p[4] };
        }));
      });
    });

    const pku = {
      name: 'PKU (北大)',
      cpu: { model: cpuModel.replace(/\s+/g, ' ').substring(0, 40), cores: cpuCores, load: cpuLoad.toFixed(2) },
      mem: {
        total: (totalMem / 1073741824).toFixed(1) + ' GB',
        used: ((totalMem - freeMem) / 1073741824).toFixed(1) + ' GB',
        free: (freeMem / 1073741824).toFixed(1) + ' GB',
        pct: Math.round((totalMem - freeMem) / totalMem * 100)
      },
      disks: pkuDisks
    };

    // 阿里云（HTTP API）
    const ali = await new Promise((resolve) => {
      const opts = { hostname: '100.80.125.20', port: 3001, path: '/api/monitor', method: 'GET', timeout: 5000 };
      const req = http.request(opts, (pres) => {
        let data = '';
        pres.on('data', c => data += c);
        pres.on('end', () => {
          try {
            const d = JSON.parse(data);
            d.name = '阿里云 ECS';
            resolve(d);
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });

    res.json({ pku, ali });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= 邮件配额管理 API =================
app.get('/api/admin/mail-quotas', requireAdmin, async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const stdout = execSync(
      "sudo docker exec mailserver sqlite3 /data/users.db \"SELECT username, domainName, quota, disabled FROM users WHERE domainName = 'uniflourish.top' ORDER BY username;\"",
      { timeout: 5000, encoding: 'utf8' }
    );
    const users = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [username, domainName, quota, disabled] = line.split('|');
      return {
        username,
        domainName,
        quota: parseInt(quota) || 0,
        disabled: parseInt(disabled) || 0,
        email: `${username}@${domainName}`
      };
    });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/mail-quota', requireAdmin, async (req, res) => {
  try {
    const { username, quotaMB } = req.body;
    if (!username || quotaMB === undefined) return res.status(400).json({ error: '缺少参数' });
    const quotaBytes = Math.max(0, parseInt(quotaMB)) * 1048576;
    const { execSync } = require('child_process');
    const safeUser = username.replace(/'/g, "''");
    execSync(
      `sudo docker exec mailserver sqlite3 /data/users.db "UPDATE users SET quota = ${quotaBytes} WHERE username = '${safeUser}' AND domainName = 'uniflourish.top';"`,
      { timeout: 5000 }
    );
    await logAction(req.adminUsername, `修改邮箱配额: ${username} → ${Math.round(quotaBytes / 1048576)}MB`);
    res.json({ success: true, username, quotaMB: Math.round(quotaBytes / 1048576) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= Vocab App =================
app.use('/vocab', express.static(path.join(__dirname, 'vocab-app')));
const requireVocabAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: '请先登录' });
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    req.vocabUserId = decoded.uid || decoded.username;
    next();
  } catch (e) { res.status(401).json({ error: '登录已过期' }); }
};

app.get('/api/vocab-progress', requireVocabAuth, async (req, res) => {
  try {
    const doc = await VocabProgress.findOne({ userId: req.vocabUserId });
    res.json(doc ? doc.data : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vocab-progress', requireVocabAuth, async (req, res) => {
  try {
    await VocabProgress.findOneAndUpdate(
      { userId: req.vocabUserId },
      { userId: req.vocabUserId, data: req.body, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 通知公告 =================
app.get('/api/announcements', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const list = await Announcement.find().sort({ createdAt: -1 }).limit(limit);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements', requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const a = await Announcement.create({ title, content, author: req.adminUsername });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    const a = await Announcement.findByIdAndUpdate(
      req.params.id, { title, content, updatedAt: new Date() }, { new: true }
    );
    if (!a) return res.status(404).json({ error: '通知不存在' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/announcements/:id', requireAdmin, async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =================👑 管理员：管理用户屏蔽列表 =================
app.put('/api/admin/users/:id/blocked', requireAdmin, async (req, res) => {
  try {
    const User = require('./models/User');
    const { add, remove } = req.body;
    const update = {};
    if (add && add.length > 0) update.$addToSet = { blockedUsers: { $each: add } };
    if (remove && remove.length > 0) {
      update.$pull = update.$pull || {};
      update.$pull.blockedUsers = { $in: remove };
    }
    await User.findByIdAndUpdate(req.params.id, update);
    await logAction(req.adminUsername, '修改了用户屏蔽列表', (await User.findById(req.params.id))?.username || req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =================👑 管理员：默认模型管理 =================
app.get('/api/admin/default-models', requireAdmin, async (req, res) => {
  try {
    const DefaultModel = require('./models/DefaultModel');
    const models = await DefaultModel.find().sort({ createdAt: 1 });
    res.json(models);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/default-models', requireAdmin, async (req, res) => {
  try {
    const DefaultModel = require('./models/DefaultModel');
    const { id, name, provider } = req.body;
    if (!id || !provider) return res.status(400).json({ error: 'id 和 provider 不能为空' });
    const model = await DefaultModel.create({ id, name: name || id, provider });
    await logAction(req.adminUsername, '添加默认模型', id);
    res.json(model);
  } catch (e) { res.status(400).json({ error: '模型已存在或参数无效' }); }
});

app.delete('/api/admin/default-models/:id', requireAdmin, async (req, res) => {
  try {
    const DefaultModel = require('./models/DefaultModel');
    const model = await DefaultModel.findOneAndDelete({ id: req.params.id });
    if (!model) return res.status(404).json({ error: '模型不存在' });
    await logAction(req.adminUsername, '删除默认模型', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= 论坛模块 =================
const forumRoutes = require('./forum-routes');
app.use('/api', forumRoutes);
const botRoutes = require('./bot-routes');
app.use('/api', botRoutes);
const { router: mailRoutes, onLogin: mailOnLogin, onLogout: mailOnLogout } = require('./mail-routes');
app.use('/api/mail', mailRoutes);

// Webmail 代理 — 设置超时避免 Funnel 挂起
const fs = require('fs');
const http = require('http');
app.use('/webmail', (req, res) => {
  const opts = {
    hostname: '127.0.0.1', port: 80,
    path: req.originalUrl, method: req.method,
    headers: Object.assign({}, req.headers, { host: '127.0.0.1', connection: 'close' }),
    timeout: 30000
  };
  const preq = http.request(opts, (pres) => {
    res.statusCode = pres.statusCode;
    Object.keys(pres.headers).forEach(k => {
      if (!['transfer-encoding','connection','keep-alive'].includes(k.toLowerCase())) {
        res.setHeader(k, pres.headers[k]);
      }
    });
    pres.pipe(res);
  });
  preq.on('error', () => { if (!res.headersSent) res.status(502).send('Bad Gateway'); });
  preq.on('timeout', () => { preq.destroy(); if (!res.headersSent) res.status(504).send('Gateway Timeout'); });
  req.pipe(preq);
});

// 论坛静态文件
app.use('/forum', express.static(path.join(__dirname, 'forum')));
app.use('/forum', (req, res) => {
  res.sendFile(path.join(__dirname, 'forum', 'index.html'));
});

// 上传文件静态服务（带缓存）
app.use('/uploads', express.static('/data/uploads', { maxAge: '7d', etag: true, lastModified: true }));

// ================= 迎潮 & 子页面 =================
app.use('/shigang', express.static(path.join(__dirname, 'shigang-page')));
app.get('/api/system-info', requireAdmin, (req, res) => {
  const processName = req.query.process;
  exec('pm2 jlist', { timeout: 5000 }, (err, stdout) => {
    const p = err ? '[]' : stdout;
    const logCmd = processName
      ? `pm2 logs ${processName} --nostream --lines 100`
      : 'pm2 logs --nostream --lines 100';
    exec(logCmd, { timeout: 5000 }, (err2, stdout2) => {
      res.json({ processes: p, logs: err2 ? '' : stdout2 });
    });
  });
});
app.get('/admin/status', requireAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'status.html')); });
app.use('/uniflourish', express.static(path.join(__dirname, 'uniflourish-app')));
app.use('/uniflourish', (req, res) => { res.sendFile(path.join(__dirname, 'uniflourish-app', 'index.html')); });
app.get('/notice', (req, res) => res.sendFile(path.join(__dirname, 'yingchao', 'notice.html')));
app.get('/others', (req, res) => res.sendFile(path.join(__dirname, 'yingchao', 'others.html')));

// ================= 史纲 Choice 代理 =================
const choiceProxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:3456', ws: true });
const chaProxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:3457', ws: true });
const webmailProxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:80' });
const diskProxy = httpProxy.createProxyServer({ target: 'http://100.80.125.20:3001' });
choiceProxy.on('proxyReq', (proxyReq, req) => {
  proxyReq.path = req.url.replace(/^\/shigang\/choice/, '') || '/';
});
app.use('/webmail', (req, res) => webmailProxy.web(req, res));
app.use('/shigang/choice', (req, res) => choiceProxy.web(req, res));
app.use('/shigang/cha', (req, res) => chaProxy.web(req, res));
app.use('/api/disk', (req, res) => {
  const opts = {
    hostname: '100.80.125.20', port: 3001,
    path: req.originalUrl, method: req.method,
    headers: Object.assign({}, req.headers, { host: 'disk.uniflourish.top', connection: 'close' }),
    timeout: 600000
  };
  const preq = http.request(opts, (pres) => {
    res.statusCode = pres.statusCode;
    Object.keys(pres.headers).forEach(k => {
      if (!['transfer-encoding','connection','keep-alive'].includes(k.toLowerCase())) {
        res.setHeader(k, pres.headers[k]);
      }
    });
    pres.pipe(res);
  });
  preq.on('error', () => { if (!res.headersSent) res.status(502).send('Bad Gateway'); });
  preq.on('timeout', () => { preq.destroy(); if (!res.headersSent) res.status(504).send('Gateway Timeout'); });
  req.pipe(preq);
});
app.use('/disk', (req, res) => {
  const opts = {
    hostname: '100.80.125.20', port: 3001,
    path: req.originalUrl, method: req.method,
    headers: Object.assign({}, req.headers, { host: 'disk.uniflourish.top', connection: 'close' }),
    timeout: 600000
  };
  const preq = http.request(opts, (pres) => {
    res.statusCode = pres.statusCode;
    Object.keys(pres.headers).forEach(k => {
      if (!['transfer-encoding','connection','keep-alive'].includes(k.toLowerCase())) {
        res.setHeader(k, pres.headers[k]);
      }
    });
    pres.pipe(res);
  });
  preq.on('error', () => { if (!res.headersSent) res.status(502).send('Bad Gateway'); });
  preq.on('timeout', () => { preq.destroy(); if (!res.headersSent) res.status(504).send('Gateway Timeout'); });
  req.pipe(preq);
});

app.use('/admin', (req, res) => res.sendFile(path.join(__dirname, 'yingchao', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'yingchao', 'login.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'yingchao', 'account.html')));
app.get('/mail', (req, res) => res.redirect('/webmail'));
app.use('/', express.static(path.join(__dirname, 'yingchao')));

const server = app.listen(3000, '0.0.0.0', () => {
  console.log('🚀 lifuchun-platform Backend running on 3000');
  // 启动多机器人管理器（延迟启动，确保 MongoDB 就绪）
  setTimeout(() => require('./bot-manager').start(), 3000);
});
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/shigang/choice')) {
    req.url = req.url.replace(/^\/shigang\/choice/, '') || '/';
    choiceProxy.ws(req, socket, head);
  } else if (req.url.startsWith('/shigang/cha')) {
    req.url = req.url.replace(/^\/shigang\/cha/, '') || '/';
    chaProxy.ws(req, socket, head);
  }
});

// ================= Socket.io 聊天（集成到主 server） =================
const setupChatSocket = require('./forum-socket');
setupChatSocket(server);

module.exports = app;
