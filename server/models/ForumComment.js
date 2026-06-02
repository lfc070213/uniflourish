const mongoose = require('mongoose');

const ForumCommentSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'ForumPost', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 5000 },
  attachments: [{
    filename: String,
    storedName: String,
    mimetype: String,
    size: Number,
    url: String,
    type: { type: String, enum: ['image', 'file'], default: 'file' }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ForumCommentSchema.index({ post: 1, createdAt: 1 });

module.exports = mongoose.model('ForumComment', ForumCommentSchema);
