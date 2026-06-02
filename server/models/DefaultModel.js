const mongoose = require('mongoose');

const DefaultModelSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  provider: { type: String, required: true, enum: ['google', 'deepseek', 'doubao', 'kimi', 'claude', 'openai'] }
}, { timestamps: true });

module.exports = mongoose.model('DefaultModel', DefaultModelSchema);
