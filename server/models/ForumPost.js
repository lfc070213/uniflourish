const mongoose = require('mongoose');

const ForumPostSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, maxlength: 200 },
  content: { type: String, required: true },
  visibility: {
    type: String,
    enum: ['private', 'friends', 'whitelist', 'blacklist', 'logged_in', 'public'],
    default: 'public',
    index: true
  },
  visibleTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  hiddenFrom: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  attachments: [{
    filename: String,
    storedName: String,
    mimetype: String,
    size: Number,
    url: String,
    type: { type: String, enum: ['image', 'file'], default: 'file' }
  }],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likeCount: { type: Number, default: 0 },
  commentCount: { type: Number, default: 0 },
  tags: [{ type: String, lowercase: true }],
  isPinned: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

ForumPostSchema.index({ author: 1, createdAt: -1 });
ForumPostSchema.index({ tags: 1 });

module.exports = mongoose.model('ForumPost', ForumPostSchema);
