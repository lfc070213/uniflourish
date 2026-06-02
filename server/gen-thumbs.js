// 为所有已上传图片生成缩略图
const mongoose = require('mongoose');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = '/data/uploads';

async function generateThumbs() {
  await mongoose.connect('mongodb://127.0.0.1:27017/lifuchun-platform');
  const ForumPost = mongoose.model('ForumPost', new mongoose.Schema({}, { strict: false, collection: 'forumposts' }));
  const ForumComment = mongoose.model('ForumComment', new mongoose.Schema({}, { strict: false, collection: 'forumcomments' }));

  async function processAttachments(docs, type) {
    for (const doc of docs) {
      let updated = false;
      for (const att of (doc.attachments || [])) {
        if (att.type !== 'image' || att.thumbUrl) continue;
        const filePath = path.join(UPLOAD_DIR, att.storedName);
        if (!fs.existsSync(filePath)) { console.log('  File missing:', att.storedName); continue; }
        try {
          const thumbName = 'thumb_' + att.storedName;
          const thumbPath = path.join(UPLOAD_DIR, thumbName);
          if (fs.existsSync(thumbPath)) {
            att.thumbUrl = '/uploads/' + thumbName;
            updated = true;
            continue;
          }
          await sharp(filePath)
            .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 65 })
            .toFile(thumbPath);
          att.thumbUrl = '/uploads/' + thumbName;
          updated = true;
          const origSize = fs.statSync(filePath).size;
          const thumbSize = fs.statSync(thumbPath).size;
          console.log(`  ${type}: ${att.filename} ${(origSize/1024).toFixed(0)}KB -> ${(thumbSize/1024).toFixed(0)}KB`);
        } catch (e) { console.log('  Fail:', att.filename, e.message); }
      }
      if (updated) {
        await doc.constructor.updateOne({ _id: doc._id }, { $set: { attachments: doc.attachments } });
      }
    }
  }

  const posts = await ForumPost.find({ 'attachments.type': 'image', 'attachments.thumbUrl': { $exists: false } });
  console.log(`Found ${posts.length} posts with images needing thumbs`);
  await processAttachments(posts, 'Post');

  const comments = await ForumComment.find({ 'attachments.type': 'image', 'attachments.thumbUrl': { $exists: false } });
  console.log(`Found ${comments.length} comments with images needing thumbs`);
  await processAttachments(comments, 'Comment');

  console.log('Done!');
  await mongoose.disconnect();
}

generateThumbs().catch(e => { console.error(e); process.exit(1); });
