// ================= Uniflourish Web 版 =================
const { exec } = require('child_process');

app.use('/uniflourish', express.static(path.join(__dirname, 'uniflourish-app')));

// PM2 状态 API
app.get('/api/system-info', requireAdmin, (req, res) => {
  exec('pm2 jlist 2>/dev/null && pm2 logs --nostream --lines 80 2>/dev/null', { timeout: 8000 }, (err, stdout) => {
    if (err) return res.json({ error: '无法获取系统信息' });
    res.json({ raw: stdout });
  });
});

// Status 页面
app.get('/uniflourish/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'uniflourish-app', 'index.html'));
});

// SPA fallback
app.get('/uniflourish/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'uniflourish-app', 'index.html'));
});
