const mongoose = require('mongoose');

const FriendRequestSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  message: { type: String, default: '', maxlength: 200 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

FriendRequestSchema.index({ from: 1, to: 1, status: 1 }, { unique: true });

module.exports = mongoose.model('FriendRequest', FriendRequestSchema);
