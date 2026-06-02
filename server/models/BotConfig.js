const mongoose = require('mongoose');

const BotConfigSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  botUsername: { type: String, required: true, unique: true },
  postInterval: { type: Number, default: 60, min: 5 },
  useSystemKey: { type: Boolean, default: true },
  aiApiKey: { type: String, default: '' },
  aiModel: { type: String, default: 'deepseek-chat' },
  enabled: { type: Boolean, default: true },

  // 夜间静默
  quietStart: { type: String, default: '' },   // 如 "23:00"
  quietEnd: { type: String, default: '' },       // 如 "07:00"

  // 可见范围
  visibility: { type: String, enum: ['public', 'logged_in', 'friends', 'private'], default: 'public' },

  // 发帖状态
  lastPostTime: { type: Number, default: 0 },
  processedMessageIds: { type: [String], default: [] },
  totalPosts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  pendingTrigger: { type: Boolean, default: false },

  // Token 统计
  tokenUsage: {
    todayDate: { type: String, default: '' },
    todayPrompt: { type: Number, default: 0 },
    todayCompletion: { type: Number, default: 0 },
    monthDate: { type: String, default: '' },
    monthPrompt: { type: Number, default: 0 },
    monthCompletion: { type: Number, default: 0 },
    totalPrompt: { type: Number, default: 0 },
    totalCompletion: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('BotConfig', BotConfigSchema);
