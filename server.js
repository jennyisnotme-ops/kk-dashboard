// KK魔法學院 繪師儀表板 — Node.js 後端 v1
// 對應原 Code.gs，改用 Express + PostgreSQL

const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── 工具 ─────────────────────────────────────────────────────

function reply(res, cb, data) {
  if (cb) {
    res.type('text/javascript');
    res.send(`${cb}(${JSON.stringify(data)})`);
  } else {
    res.json(data);
  }
}

async function findUser(secret) {
  const result = await pool.query('SELECT * FROM users WHERE secret = $1', [secret]);
  return result.rows[0] || null;
}

async function writeLog(operator, role, action, target) {
  const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  await pool.query(
    'INSERT INTO logs (time, operator, role, action, target) VALUES ($1,$2,$3,$4,$5)',
    [time, operator, role, action, target]
  );
}

// ── 主要 API（對應原本的 doGet）────────────────────────────────

app.get('/api', async (req, res) => {
  const { callback: cb = '', action = '', secret = '', type = '' } = req.query;
  let payload = {};
  try { payload = JSON.parse(decodeURIComponent(req.query.payload || '{}')); } catch (e) {}

  try {
    // ── 公開讀取（不需登入）────────────────────────────────
    if (!action) {
      const members  = (await pool.query('SELECT * FROM members ORDER BY id')).rows;
      const projects = (await pool.query('SELECT * FROM projects ORDER BY id')).rows;
      const settings = (await pool.query("SELECT key, value FROM settings WHERE key IN ('groups','countries')")).rows;

      const groups    = settings.find(s => s.key === 'groups')?.value    ?? ['A組','B組'];
      const countries = settings.find(s => s.key === 'countries')?.value ?? ['TW','CN'];

      projects.forEach(p => {
        p.isLongTerm = Boolean(p.longterm);
        delete p.longterm;
      });

      return reply(res, cb, { members, projects, groups, countries });
    }

    // ── 需要登入的操作 ───────────────────────────────────────
    const user = await findUser(secret);
    if (!user) return reply(res, cb, { error: '密碼錯誤或無權限' });

    // ── 帳號管理 ─────────────────────────────────────────────
    if (type === 'users') {
      if (action === 'list') {
        const users = (await pool.query('SELECT id, name, role FROM users')).rows;
        if (user.role === 'super_admin') {
          return reply(res, cb, { ok: true, users: users.map(u => ({ idx: u.id, name: u.name, role: u.role })) });
        } else {
          return reply(res, cb, { ok: true, users: [{ idx: user.id, name: user.name, role: user.role }], selfOnly: true });
        }
      }

      if (action === 'add') {
        if (user.role !== 'super_admin') return reply(res, cb, { error: '權限不足' });
        if (!payload.name || !payload.secret) throw new Error('姓名與密碼不能為空');
        const dup = await pool.query('SELECT 1 FROM users WHERE secret = $1', [payload.secret]);
        if (dup.rows.length > 0) throw new Error('此密碼已被使用');
        const newRole = payload.role === 'super_admin' ? 'super_admin' : 'editor';
        await pool.query('INSERT INTO users (name, secret, role) VALUES ($1,$2,$3)', [payload.name, payload.secret, newRole]);
        await writeLog(user.name, user.role, '新增帳號', `${payload.name}（${newRole}）`);
        return reply(res, cb, { ok: true });
      }

      if (action === 'remove') {
        if (user.role !== 'super_admin') return reply(res, cb, { error: '權限不足' });
        const target = (await pool.query('SELECT * FROM users WHERE id = $1', [payload.idx])).rows[0];
        if (!target) throw new Error('找不到此帳號');
        if (target.secret === secret) throw new Error('不能刪除自己的帳號');
        const admins = await pool.query("SELECT 1 FROM users WHERE role = 'super_admin' AND id != $1", [payload.idx]);
        if (admins.rows.length === 0) throw new Error('至少需要保留一位超級管理者');
        await pool.query('DELETE FROM users WHERE id = $1', [payload.idx]);
        await writeLog(user.name, user.role, '刪除帳號', target.name);
        return reply(res, cb, { ok: true });
      }

      if (action === 'changeRole') {
        if (user.role !== 'super_admin') return reply(res, cb, { error: '權限不足' });
        const target = (await pool.query('SELECT * FROM users WHERE id = $1', [payload.idx])).rows[0];
        if (!target) throw new Error('找不到此帳號');
        if (target.secret === secret) throw new Error('不能變更自己的權限');
        const newRole = payload.role === 'super_admin' ? 'super_admin' : 'editor';
        const oldRole = target.role;
        if (oldRole === 'super_admin' && newRole === 'editor') {
          const admins = await pool.query("SELECT 1 FROM users WHERE role = 'super_admin' AND id != $1", [payload.idx]);
          if (admins.rows.length === 0) throw new Error('至少需要保留一位超級管理者');
        }
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, payload.idx]);
        await writeLog(user.name, user.role, '變更權限', `${target.name}：${oldRole} → ${newRole}`);
        return reply(res, cb, { ok: true });
      }

      if (action === 'changeSecret') {
        if (!payload.newSecret) throw new Error('新密碼不能為空');
        const dup = await pool.query('SELECT 1 FROM users WHERE secret = $1', [payload.newSecret]);
        if (dup.rows.length > 0) throw new Error('此密碼已被使用');
        await pool.query('UPDATE users SET secret = $1 WHERE id = $2', [payload.newSecret, user.id]);
        await writeLog(user.name, user.role, '修改密碼', user.name);
        return reply(res, cb, { ok: true });
      }

      if (action === 'changeName') {
        if (!payload.newName) throw new Error('名稱不能為空');
        const oldName = user.name;
        await pool.query('UPDATE users SET name = $1 WHERE id = $2', [payload.newName, user.id]);
        await writeLog(payload.newName, user.role, '修改名稱', `${oldName} → ${payload.newName}`);
        return reply(res, cb, { ok: true });
      }
    }

    // ── 系統設定（groups / countries）────────────────────────
    if (type === 'settings') {
      if (user.role !== 'super_admin') return reply(res, cb, { error: '權限不足' });
      const key = payload.key;
      if (key !== 'groups' && key !== 'countries') throw new Error('無效的設定項目');

      if (action === 'set') {
        if (!Array.isArray(payload.values)) throw new Error('格式錯誤');
        const cleaned = payload.values.map(v => String(v).trim()).filter(Boolean);
        if (cleaned.length === 0) throw new Error('至少需要一個選項');

        if (key === 'groups') {
          const oldSetting = (await pool.query("SELECT value FROM settings WHERE key = 'groups'")).rows[0];
          const oldGroups = oldSetting?.value ?? [];
          if (oldGroups.length === cleaned.length) {
            const renameMap = {};
            oldGroups.forEach((oldName, i) => {
              if (oldName !== cleaned[i]) renameMap[oldName] = cleaned[i];
            });
            if (Object.keys(renameMap).length > 0) {
              for (const [from, to] of Object.entries(renameMap)) {
                await pool.query('UPDATE members SET "group" = $1 WHERE "group" = $2', [to, from]);
              }
              await writeLog(user.name, user.role, '同步更新組員群組', JSON.stringify(renameMap));
            }
          }
        }

        await pool.query(
          'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2',
          [key, JSON.stringify(cleaned)]
        );
        await writeLog(user.name, user.role, '更新系統設定', `${key}: ${cleaned.join(', ')}`);
        return reply(res, cb, { ok: true });
      }
    }

    // ── 操作記錄 ─────────────────────────────────────────────
    if (type === 'log' && action === 'list') {
      let logs;
      if (user.role === 'super_admin') {
        logs = (await pool.query('SELECT * FROM logs ORDER BY id DESC LIMIT 200')).rows;
      } else {
        logs = (await pool.query('SELECT * FROM logs WHERE operator = $1 ORDER BY id DESC LIMIT 200', [user.name])).rows;
      }
      return reply(res, cb, { ok: true, logs });
    }

    // ── 組員 CRUD ────────────────────────────────────────────
    if (type === 'members') {
      if (action === 'upsert') {
        const exists = (await pool.query('SELECT 1 FROM members WHERE id = $1', [payload.id])).rows.length > 0;
        await pool.query(`
          INSERT INTO members (id, name, "group", country, role, note, tags)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET
            name=$2, "group"=$3, country=$4, role=$5, note=$6, tags=$7
        `, [payload.id, payload.name, payload.group, payload.country, payload.role,
            payload.note ?? '', JSON.stringify(payload.tags ?? [])]);
        await writeLog(user.name, user.role, exists ? '編輯組員' : '新增組員', payload.name ?? payload.id);
      }
      if (action === 'delete') {
        const existing = (await pool.query('SELECT name FROM members WHERE id = $1', [payload.id])).rows[0];
        await pool.query('DELETE FROM members WHERE id = $1', [payload.id]);
        await writeLog(user.name, user.role, '刪除組員', existing?.name ?? payload.id);
      }
    }

    // ── 專案 CRUD ────────────────────────────────────────────
    if (type === 'projects') {
      if (action === 'upsert') {
        const exists = (await pool.query('SELECT 1 FROM projects WHERE id = $1', [payload.id])).rows.length > 0;
        await pool.query(`
          INSERT INTO projects (id, name, type, owner, start, deadline, progress, "progressOverride", status, assignees, note, tags, longterm)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (id) DO UPDATE SET
            name=$2, type=$3, owner=$4, start=$5, deadline=$6, progress=$7,
            "progressOverride"=$8, status=$9, assignees=$10, note=$11, tags=$12, longterm=$13
        `, [payload.id, payload.name, payload.type, payload.owner,
            payload.start, payload.deadline, payload.progress ?? 0,
            payload.progressOverride ?? false, payload.status,
            JSON.stringify(payload.assignees ?? []), payload.note ?? '',
            JSON.stringify(payload.tags ?? []), payload.isLongTerm ?? false]);
        await writeLog(user.name, user.role, exists ? '編輯專案' : '新增專案', payload.name ?? payload.id);
      }
      if (action === 'delete') {
        const existing = (await pool.query('SELECT name FROM projects WHERE id = $1', [payload.id])).rows[0];
        await pool.query('DELETE FROM projects WHERE id = $1', [payload.id]);
        await writeLog(user.name, user.role, '刪除專案', existing?.name ?? payload.id);
      }
    }

    return reply(res, cb, { ok: true });

  } catch (err) {
    return reply(res, cb, { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`伺服器啟動，port ${PORT}`));
