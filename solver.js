const { DAYS, PERIODS } = require('./db');

const RESTARTS = 30;

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs the solver against the current dataset.
 * Returns { slots, conflicts, unresolvedCount, attempts }
 */
function generateTimetable({ rooms, faculty, subjects, sections, assignments, facultyAvailability }) {
  const subjectById = Object.fromEntries(subjects.map(s => [s.id, s]));
  const facultyById = Object.fromEntries(faculty.map(f => [f.id, f]));
  const sectionById = Object.fromEntries(sections.map(s => [s.id, s]));
  const blocked = new Set(facultyAvailability.map(b => `${b.facultyId}|${b.day}|${b.period}`));

  // Expand each assignment into N occurrence-tasks (N = subject.weeklyHours)
  const baseTasks = [];
  assignments.forEach(a => {
    const subject = subjectById[a.subjectId];
    if (!subject) return;
    for (let occurrence = 0; occurrence < subject.weeklyHours; occurrence++) {
      baseTasks.push({
        assignmentId: a.id,
        subjectId: a.subjectId,
        facultyId: a.facultyId,
        sectionId: a.sectionId,
        occurrence,
        roomType: subject.roomType
      });
    }
  });

  const slotsGrid = [];
  DAYS.forEach(day => PERIODS.forEach(p => slotsGrid.push({ day, period: p.period })));

  let best = null;

  for (let attempt = 0; attempt < RESTARTS; attempt++) {
    const rng = mulberry32(attempt * 7919 + 13);
    // Order tasks: most-constrained first (fewer eligible rooms), then shuffle within ties for variety across restarts
    const tasksOrdered = shuffle(baseTasks, rng).sort((a, b) => {
      const roomsA = rooms.filter(r => r.type === a.roomType).length;
      const roomsB = rooms.filter(r => r.type === b.roomType).length;
      return roomsA - roomsB;
    });

    const facultyBusy = new Set();   // `${facultyId}|${day}|${period}`
    const sectionBusy = new Set();   // `${sectionId}|${day}|${period}`
    const roomBusy = new Set();      // `${roomId}|${day}|${period}`
    const subjectDayUsed = {};       // `${subjectId}|${sectionId}` -> Set(days) — soft: spread across week

    const placed = [];
    const conflicts = [];

    tasksOrdered.forEach(task => {
      const spreadKey = `${task.subjectId}|${task.sectionId}`;
      if (!subjectDayUsed[spreadKey]) subjectDayUsed[spreadKey] = new Set();

      const eligibleRooms = rooms.filter(r => r.type === task.roomType);
      const candidates = [];

      for (const slot of slotsGrid) {
        const facKey = `${task.facultyId}|${slot.day}|${slot.period}`;
        if (blocked.has(facKey)) continue;
        if (facultyBusy.has(facKey)) continue;
        const secKey = `${task.sectionId}|${slot.day}|${slot.period}`;
        if (sectionBusy.has(secKey)) continue;

        const freeRoom = eligibleRooms.find(r => !roomBusy.has(`${r.id}|${slot.day}|${slot.period}`));
        if (!freeRoom) continue;

        // soft score: prefer a day not already used for this subject+section (spread it out)
        const usedThisDay = subjectDayUsed[spreadKey].has(slot.day) ? 1 : 0;
        candidates.push({ slot, room: freeRoom, score: usedThisDay });
      }

      if (candidates.length === 0) {
        conflicts.push({
          assignmentId: task.assignmentId,
          subjectId: task.subjectId,
          subjectName: subjectById[task.subjectId]?.name,
          facultyId: task.facultyId,
          facultyName: facultyById[task.facultyId]?.name,
          sectionId: task.sectionId,
          sectionName: sectionById[task.sectionId]?.name,
          occurrence: task.occurrence + 1,
          reason: eligibleRooms.length === 0
            ? `No room of type "${task.roomType}" exists in the room inventory.`
            : `No slot exists where faculty, section and a "${task.roomType}" room are all free at once (every candidate slot conflicts with an existing booking or a blocked faculty period).`
        });
        return;
      }

      candidates.sort((a, b) => a.score - b.score || rng() - 0.5);
      const choice = candidates[0];

      facultyBusy.add(`${task.facultyId}|${choice.slot.day}|${choice.slot.period}`);
      sectionBusy.add(`${task.sectionId}|${choice.slot.day}|${choice.slot.period}`);
      roomBusy.add(`${choice.room.id}|${choice.slot.day}|${choice.slot.period}`);
      subjectDayUsed[spreadKey].add(choice.slot.day);

      placed.push({
        assignmentId: task.assignmentId,
        subjectId: task.subjectId,
        facultyId: task.facultyId,
        sectionId: task.sectionId,
        roomId: choice.room.id,
        day: choice.slot.day,
        period: choice.slot.period
      });
    });

    const result = { slots: placed, conflicts, unresolvedCount: conflicts.length };
    if (!best || result.unresolvedCount < best.unresolvedCount) {
      best = result;
      if (best.unresolvedCount === 0) break; // fully feasible solution found
    }
  }

  return { ...best, attempts: RESTARTS };
}

module.exports = { generateTimetable };
