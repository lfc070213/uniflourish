const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  sessions: { type: Array, default: [] },
  longTermMemory: { type: String, default: "" },
  geminiKey: { type: String, default: "" },
  deepseekKey: { type: String, default: "" },
  doubaoKey: { type: String, default: "" },
  kimiKey: { type: String, default: "" },
  claudeKey: { type: String, default: "" },
  openaiKey: { type: String, default: "" },
  customModels: { type: Array, default: [] },
  role: { type: String, default: "user" },
  // Forum fields
  nickname: { type: String, default: null },
  avatar: { type: String, default: null },
  bio: { type: String, default: '', maxlength: 200 },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendCount: { type: Number, default: 0 },
  postCount: { type: Number, default: 0 },
  commentCount: { type: Number, default: 0 },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastActive: { type: Date, default: Date.now },
  // Email fields
  allocatedEmail: { type: String, unique: true, sparse: true },
  boundEmail: { type: String, default: null },
  emailVerified: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', UserSchema);
