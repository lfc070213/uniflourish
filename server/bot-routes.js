'use strict';

const express = require('express');
const router = express.Router();
const BotConfig = require('./models/BotConfig');
const User = require('./models/User');
const { requireUser, requireAdmin } = require('./middleware/auth');
const { getSettings, updateSettings } = require('./bot-manager');

const FORUM_BASE = 'http://127.0.0.1:3000';

// ==================== 用户 API ====================

// 获取我的 bot
router.get('/bot', requireUser, async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ owner: req.userId }).lean();
    res.json({ bot: bot || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建我的 bot
router.post('/bot', requireUser, async (req, res) => {
  try {
    const { botUsername, postInterval, useSystemKey, aiApiKey, aiModel, quietStart, quietEnd, visibility } = req.body;

    if (!botUsername) {
      return res.status(400).json({ error: '请填写机器人用户名' });
    }

    // 每人只能有一个
    const existing = await BotConfig.findOne({ owner: req.userId });
    if (existing) return res.status(400).json({ error: '你已经有一个机器人了' });

    // 检查 bot 用户名是否被占用
    const existByName = await BotConfig.findOne({ botUsername });
    if (existByName) return res.status(400).json({ error: '该机器人用户名已被使用' });

    // 注册 forum 账号
    const password = botUsername;
    const regRes = await fetch(`${FORUM_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: botUsername, password })
    });
    if (!regRes.ok) {
      const err = await regRes.json().catch(() => ({}));
      if (err.error !== '用户名已存在') {
        return res.status(400).json({ error: '注册机器人账号失败: ' + (err.error || regRes.status) });
      }
    }

    // 创建配置
    const bot = await BotConfig.create({
      owner: req.userId,
      botUsername,
      postInterval: postInterval || 60,
      useSystemKey: useSystemKey !== false,
      aiApiKey: aiApiKey || '',
      aiModel: aiModel || 'deepseek-chat',
      quietStart: quietStart || '',
      quietEnd: quietEnd || '',
      visibility: visibility || 'public'
    });

    res.json({ bot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新我的 bot
router.put('/bot', requireUser, async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ owner: req.userId });
    if (!bot) return res.status(404).json({ error: '你还没有机器人' });

    const { postInterval, useSystemKey, aiApiKey, aiModel, enabled, quietStart, quietEnd, visibility } = req.body;
    if (postInterval !== undefined) bot.postInterval = Math.max(5, postInterval);
    if (useSystemKey !== undefined) bot.useSystemKey = useSystemKey;
    if (aiApiKey !== undefined) bot.aiApiKey = aiApiKey;
    if (aiModel !== undefined) bot.aiModel = aiModel;
    if (enabled !== undefined) bot.enabled = enabled;
    if (quietStart !== undefined) bot.quietStart = quietStart;
    if (quietEnd !== undefined) bot.quietEnd = quietEnd;
    if (visibility !== undefined) bot.visibility = visibility;

    await bot.save();
    res.json({ bot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除我的 bot
router.delete('/bot', requireUser, async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ owner: req.userId });
    if (!bot) return res.status(404).json({ error: '你还没有机器人' });

    await BotConfig.findByIdAndDelete(bot._id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 手动触发发帖
router.post('/bot/trigger', requireUser, async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ owner: req.userId });
    if (!bot) return res.status(404).json({ error: '你还没有机器人' });
    if (!bot.enabled) return res.status(400).json({ error: '机器人已禁用' });

    bot.pendingTrigger = true;
    await bot.save();
    res.json({ success: true, message: '将在 60 秒内发帖' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 管理员 API ====================

// 所有 bot 列表
router.get('/admin/bots', requireAdmin, async (req, res) => {
  try {
    const bots = await BotConfig.find().populate('owner', 'username').lean();
    res.json({ bots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 修改任意 bot
router.put('/admin/bots/:id', requireAdmin, async (req, res) => {
  try {
    const bot = await BotConfig.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot 不存在' });

    const fields = ['postInterval', 'useSystemKey', 'aiApiKey', 'aiModel', 'enabled', 'botUsername', 'quietStart', 'quietEnd'];
    fields.forEach(f => { if (req.body[f] !== undefined) bot[f] = req.body[f]; });
    await bot.save();
    res.json({ bot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除任意 bot
router.delete('/admin/bots/:id', requireAdmin, async (req, res) => {
  try {
    await BotConfig.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 系统设置
router.get('/admin/bots/settings', requireAdmin, async (req, res) => {
  res.json({ settings: getSettings() });
});

router.put('/admin/bots/settings', requireAdmin, async (req, res) => {
  const updated = updateSettings(req.body);
  res.json({ settings: updated });
});

module.exports = router;
