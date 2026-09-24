const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { generateTimetable } = require('./solver');
const { verifyPassword, issueToken, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 4000;

// ---------- helpers ----------
function withStore(handler) {
  return (req, res) => {
    try {
      const store = db.load();
      handler(req, res, store);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

// Any signed-in role can GET; only the given roles can write.
function collection(name, writeRoles) {
  const router = express.Router();

  router.get('/', requireAuth(), withStore((req, res, store) => res.json(store[name])));

  router.post('/', requireAuth(writeRoles), withStore((req, res, store) => {
    const item = { id: db.uid(name.slice(0, 3)), ...req.body };
    store[name].push(item);
    db.save(store);
    res.status(201).json(item);
  }));

  router.put('/:id', requireAuth(writeRoles), withStore((req, res, store) => {
    const idx = store[name].findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    store[name][idx] = { ...store[name][idx], ...req.body, id: req.params.id };
    db.save(store);
    res.json(store[name][idx]);
  }));

  router.delete('/:id', requireAuth(writeRoles), withStore((req, res, store) => {
    store[name] = store[name].filter(x => x.id !== req.params.id);
    db.save(store);
    res.status(204).end();
  }));

  return router;
}

// ---------- auth ----------
app.post('/api/auth/login', withStore((req, res, store) => {
  const { username, password } = req.body || {};
  const user = store.users.find(u => u.username === username);
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, facultyId: user.facultyId }
  });
}));

app.get('/api/auth/me', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

// ---------- meta ----------
app.get('/api/meta', requireAuth(), (req, res) => {
  res.json({ days: db.DAYS, periods: db.PERIODS });
});

// ---------- setup CRUD ----------
// Only Admin edits the institution's setup data (rooms/faculty/subjects/sections/assignments).
// HOD and Faculty have read access so they can see what they're scheduled against.
app.use('/api/rooms', collection('rooms', ['admin']));
app.use('/api/faculty', collection('faculty', ['admin']));
app.use('/api/subjects', collection('subjects', ['admin']));
app.use('/api/sections', collection('sections', ['admin']));
app.use('/api/assignments', collection('assignments', ['admin']));

// faculty availability (blocked slots): Admin/HOD manage anyone's; Faculty may only manage their own.
app.get('/api/availability', requireAuth(), withStore((req, res, store) => res.json(store.facultyAvailability)));

function canEditAvailability(req, facultyId) {
  if (['admin', 'hod'].includes(req.user.role)) return true;
  return req.user.role === 'faculty' && req.user.facultyId === facultyId;
}

app.post('/api/availability', requireAuth(), withStore((req, res, store) => {
  const { facultyId, day, period } = req.body;
  if (!canEditAvailability(req, facultyId)) {
    return res.status(403).json({ error: 'You can only manage your own availability.' });
  }
  const exists = store.facultyAvailability.some(b => b.facultyId === facultyId && b.day === day && b.period === period);
  if (!exists) store.facultyAvailability.push({ facultyId, day, period });
  db.save(store);
  res.status(201).json(store.facultyAvailability);
}));
app.delete('/api/availability', requireAuth(), withStore((req, res, store) => {
  const { facultyId, day, period } = req.body;
  if (!canEditAvailability(req, facultyId)) {
    return res.status(403).json({ error: 'You can only manage your own availability.' });
  }
  store.facultyAvailability = store.facultyAvailability.filter(
    b => !(b.facultyId === facultyId && b.day === day && b.period === period)
  );
  db.save(store);
  res.json(store.facultyAvailability);
}));

// ---------- generation ----------
// Admin or HOD can run the solver; publishing a version is an Admin-only act.
app.post('/api/timetables/generate', requireAuth(['admin', 'hod']), withStore((req, res, store) => {
  const result = generateTimetable({
    rooms: store.rooms,
    faculty: store.faculty,
    subjects: store.subjects,
    sections: store.sections,
    assignments: store.assignments,
    facultyAvailability: store.facultyAvailability
  });

  const nextVersion = store.timetables.length
    ? Math.max(...store.timetables.map(t => t.version)) + 1
    : 1;

  const timetable = {
    id: db.uid('tt'),
    version: nextVersion,
    status: 'draft',
    createdAt: new Date().toISOString(),
    slots: result.slots,
    conflicts: result.conflicts,
    attempts: result.attempts
  };

  store.timetables.push(timetable);
  db.save(store);
  res.status(201).json(timetable);
}));

app.get('/api/timetables', requireAuth(), withStore((req, res, store) => {
  res.json(store.timetables.map(t => ({
    id: t.id, version: t.version, status: t.status, createdAt: t.createdAt,
    slotCount: t.slots.length, conflictCount: t.conflicts.length
  })));
}));

app.get('/api/timetables/:id', requireAuth(), withStore((req, res, store) => {
  const tt = store.timetables.find(t => t.id === req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });
  res.json(tt);
}));

app.post('/api/timetables/:id/publish', requireAuth(['admin']), withStore((req, res, store) => {
  const tt = store.timetables.find(t => t.id === req.params.id);
  if (!tt) return res.status(404).json({ error: 'Not found' });
  store.timetables.forEach(t => { if (t.status === 'published') t.status = 'archived'; });
  tt.status = 'published';
  db.save(store);
  res.json(tt);
}));

app.delete('/api/timetables/:id', requireAuth(['admin']), withStore((req, res, store) => {
  store.timetables = store.timetables.filter(t => t.id !== req.params.id);
  db.save(store);
  res.status(204).end();
}));

// full dataset (used by the frontend to hydrate dropdowns in one call).
// users/passwordHashes are stripped — never send credential material to the client.
app.get('/api/dataset', requireAuth(), withStore((req, res, store) => {
  const { users, ...safe } = store;
  res.json(safe);
}));

app.post('/api/reset', requireAuth(['admin']), (req, res) => {
  const fresh = db.reset();
  const { users, ...safe } = fresh;
  res.json(safe);
});

app.listen(PORT, () => {
  console.log(`Timetable Generator API running at http://localhost:${PORT}`);
});
