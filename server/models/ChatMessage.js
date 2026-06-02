const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, default: '' },
  attachments: [{
    filename: String,
    storedName: String,
    mimetype: String,
    size: Number,
    url: String,
    type: { type: String, enum: ['image', 'file'], default: 'file' }
  }],
  read: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now }
});

ChatMessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
