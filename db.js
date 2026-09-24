const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const PERIODS = [
  { period: 1, start: '09:00', end: '09:55' },
  { period: 2, start: '09:55', end: '10:50' },
  { period: 3, start: '11:05', end: '12:00' },
  { period: 4, start: '12:00', end: '12:55' },
  { period: 5, start: '13:45', end: '14:40' },
  { period: 6, start: '14:40', end: '15:35' }
];

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function seed() {
  const rooms = [
    { id: uid('room'), name: 'LH-101', type: 'lecture', capacity: 70 },
    { id: uid('room'), name: 'LH-102', type: 'lecture', capacity: 70 },
    { id: uid('room'), name: 'LH-103', type: 'lecture', capacity: 60 },
    { id: uid('room'), name: 'Lab-A (CS)', type: 'lab', capacity: 35 },
    { id: uid('room'), name: 'Lab-B (Electronics)', type: 'lab', capacity: 30 }
  ];

  const faculty = [
    { id: uid('fac'), name: 'Dr. Anitha Rao', dept: 'CS', maxWeeklyLoad: 18 },
    { id: uid('fac'), name: 'Prof. Vikram Shah', dept: 'CS', maxWeeklyLoad: 18 },
    { id: uid('fac'), name: 'Dr. Meera Iyer', dept: 'CS', maxWeeklyLoad: 16 },
    { id: uid('fac'), name: 'Prof. Karan Mehta', dept: 'ECE', maxWeeklyLoad: 18 },
    { id: uid('fac'), name: 'Dr. Sunita Nair', dept: 'ECE', maxWeeklyLoad: 16 }
  ];

  const subjects = [
    { id: uid('sub'), name: 'Data Structures', dept: 'CS', weeklyHours: 4, roomType: 'lecture' },
    { id: uid('sub'), name: 'DBMS', dept: 'CS', weeklyHours: 3, roomType: 'lecture' },
    { id: uid('sub'), name: 'DBMS Lab', dept: 'CS', weeklyHours: 2, roomType: 'lab' },
    { id: uid('sub'), name: 'Operating Systems', dept: 'CS', weeklyHours: 3, roomType: 'lecture' },
    { id: uid('sub'), name: 'Digital Electronics', dept: 'ECE', weeklyHours: 3, roomType: 'lecture' },
    { id: uid('sub'), name: 'Electronics Lab', dept: 'ECE', weeklyHours: 2, roomType: 'lab' }
  ];

  const sections = [
    { id: uid('sec'), name: 'CS-A', division: 'CS', strength: 60 },
    { id: uid('sec'), name: 'CS-B', division: 'CS', strength: 58 },
    { id: uid('sec'), name: 'ECE-A', division: 'ECE', strength: 55 }
  ];

  const byName = (arr, name) => arr.find(x => x.name === name);
  const sA = sections[0], sB = sections[1], sC = sections[2];

  const assignments = [
    { id: uid('assign'), subjectId: byName(subjects, 'Data Structures').id, facultyId: faculty[0].id, sectionId: sA.id },
    { id: uid('assign'), subjectId: byName(subjects, 'DBMS').id, facultyId: faculty[1].id, sectionId: sA.id },
    { id: uid('assign'), subjectId: byName(subjects, 'DBMS Lab').id, facultyId: faculty[1].id, sectionId: sA.id },
    { id: uid('assign'), subjectId: byName(subjects, 'Operating Systems').id, facultyId: faculty[2].id, sectionId: sA.id },

    { id: uid('assign'), subjectId: byName(subjects, 'Data Structures').id, facultyId: faculty[0].id, sectionId: sB.id },
    { id: uid('assign'), subjectId: byName(subjects, 'DBMS').id, facultyId: faculty[1].id, sectionId: sB.id },
    { id: uid('assign'), subjectId: byName(subjects, 'DBMS Lab').id, facultyId: faculty[1].id, sectionId: sB.id },
    { id: uid('assign'), subjectId: byName(subjects, 'Operating Systems').id, facultyId: faculty[2].id, sectionId: sB.id },

    { id: uid('assign'), subjectId: byName(subjects, 'Digital Electronics').id, facultyId: faculty[3].id, sectionId: sC.id },
    { id: uid('assign'), subjectId: byName(subjects, 'Electronics Lab').id, facultyId: faculty[4].id, sectionId: sC.id }
  ];

  const users = [
    { id: uid('user'), username: 'admin', name: 'Admin (Registrar)', role: 'admin', facultyId: null, passwordHash: hashPassword('admin123') },
    { id: uid('user'), username: 'hod.cs', name: 'Dr. Priya Krishnan (HOD, CS)', role: 'hod', facultyId: null, passwordHash: hashPassword('hod123') },
    { id: uid('user'), username: 'anitha.rao', name: faculty[0].name, role: 'faculty', facultyId: faculty[0].id, passwordHash: hashPassword('faculty123') }
  ];

  return {
    rooms,
    faculty,
    facultyAvailability: [], // { facultyId, day, period } => blocked
    subjects,
    sections,
    assignments,
    timetables: [], // { id, version, status: 'draft'|'published', createdAt, slots: [...], conflicts: [...] }
    users
  };
}

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = seed();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function reset() {
  const initial = seed();
  save(initial);
  return initial;
}

module.exports = { load, save, reset, uid, DAYS, PERIODS };
