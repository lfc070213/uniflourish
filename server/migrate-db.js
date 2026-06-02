// 一次性脚本：将 uniflourish_db 所有数据迁移到 lifuchun-platform
// 用法: node migrate-db.js

const mongoose = require('mongoose');

async function migrate() {
  console.log('🔌 连接到 uniflourish_db...');
  const sourceConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/uniflourish_db').asPromise();
  const sourceDb = sourceConn.db;

  console.log('🔌 连接到 lifuchun-platform...');
  const targetConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/lifuchun-platform').asPromise();
  const targetDb = targetConn.db;

  const collections = await sourceDb.listCollections().toArray();
  console.log(`📋 找到 ${collections.length} 个集合: ${collections.map(c => c.name).join(', ')}`);

  for (const coll of collections) {
    const docs = await sourceDb.collection(coll.name).find({}).toArray();
    if (docs.length > 0) {
      await targetDb.collection(coll.name).insertMany(docs);
    }
    console.log(`  ✅ ${coll.name}: ${docs.length} 条文档`);
  }

  console.log('\n🎉 迁移完成！请更新 index.js 中的数据库连接字符串并重启服务。');
  console.log('   确认无误后，可手动删除旧库: use uniflourish_db; db.dropDatabase()');

  await sourceConn.close();
  await targetConn.close();
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ 迁移失败:', err);
  process.exit(1);
});
