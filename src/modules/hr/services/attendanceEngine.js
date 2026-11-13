const Punch = require('../models/Punch');
const AttendanceDay = require('../models/AttendanceDay');
const AttendanceMovement = require('../models/AttendanceMovement');
const ProcessLock = require('../models/ProcessLock');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const { getSettings } = require('./settings.service');
const {
  toLocalParts,
  toLocalDateString,
  offsetMsFor,
  ymdCompare,
} = require('../utils/time');

const ENGINE_VERSION = 1;
const pad = (n) => String(n).padStart(2, '0');

const parseHm = (hm) => {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return h * 60 + m;
};

const hmFromParts = (p) => `${pad(p.hour)}:${pad(p.minute)}`;

const localDateTimeToUtc = (ymd, hm, timezone) => {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = String(hm).split(':').map(Number);
  // construct as if UTC then subtract zone offset
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  return new Date(asUtc - offsetMsFor(timezone));
};

const addDaysYmd = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

const weekdayOfYmd = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const dutyWindowForEmployee = (employee, workDate) => {
  const hist = (employee.dutyHistory || []).find(
    (w) =>
      ymdCompare(workDate, w.fromDate) >= 0 &&
      (!w.toDate || ymdCompare(workDate, w.toDate) < 0)
  );
  if (hist) {
    return {
      dutyStart: hist.start,
      dutyEnd: hist.end,
      shiftName: employee.shift?.name || 'Duty',
      type: hist.end <= hist.start ? 'night' : 'general',
    };
  }

  const roster = (employee.weeklyRoster || []).find(
    (r) => Number(r.weekday) === weekdayOfYmd(workDate)
  );
  if (roster?.off) {
    return {
      dutyStart: employee.dutyStart || '09:00',
      dutyEnd: employee.dutyEnd || '17:00',
      shiftName: employee.shift?.name || 'Duty',
      type: 'off',
      offDay: true,
    };
  }
  if (roster?.start && roster?.end) {
    return {
      dutyStart: roster.start,
      dutyEnd: roster.end,
      shiftName: employee.shift?.name || 'Custom',
      type: roster.end <= roster.start ? 'night' : 'general',
    };
  }

  const start = employee.dutyStart || employee.shift?.dutyStart || '09:00';
  const end = employee.dutyEnd || employee.shift?.dutyEnd || '17:00';
  const workingDays = employee.shift?.workingDays || [1, 2, 3, 4, 5, 6];
  const wd = weekdayOfYmd(workDate);
  if (!workingDays.includes(wd)) {
    return {
      dutyStart: start,
      dutyEnd: end,
      shiftName: employee.shift?.name || 'General Day',
      type: 'off',
      offDay: true,
    };
  }
  return {
    dutyStart: start,
    dutyEnd: end,
    shiftName: employee.shift?.name || 'General Day',
    type: end <= start ? 'night' : employee.shift?.type || 'general',
  };
};

const lunchWindow = (workDate) => {
  const wd = weekdayOfYmd(workDate);
  // Fri 13:00–14:30, else Mon–Thu & Sat 13:00–14:00
  if (wd === 5) return { start: 13 * 60, end: 14 * 60 + 30 };
  return { start: 13 * 60, end: 14 * 60 };
};

const dedupePunches = (punches, dedupeSeconds) => {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.eventTimeUtc) - new Date(b.eventTimeUtc)
  );
  const out = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(new Date(p.eventTimeUtc) - new Date(prev.eventTimeUtc)) <
        dedupeSeconds * 1000
    ) {
      continue;
    }
    out.push(p);
  }
  return out;
};

const pairSessions = (punches) => {
  const sessions = [];
  let openIn = null;
  let inside = false;
  for (const p of punches) {
    let dir = p.direction;
    if (!dir) dir = inside ? 'OUT' : 'IN';
    if (dir === 'IN') {
      if (!inside) {
        openIn = p;
        inside = true;
      }
      // second IN while inside ignored for pairing start
    } else if (dir === 'OUT') {
      if (inside && openIn) {
        sessions.push({ inPunch: openIn, outPunch: p });
        openIn = null;
        inside = false;
      }
    }
  }
  if (inside && openIn) {
    sessions.push({ inPunch: openIn, outPunch: null, open: true });
  }
  return sessions;
};

const acquireLock = async (key, owner) => {
  try {
    await ProcessLock.create({ key, owner, lockedAt: new Date() });
    return true;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await ProcessLock.findOne({ key }).lean();
      // stale lock > 2 minutes
      if (existing && Date.now() - new Date(existing.lockedAt).getTime() > 120000) {
        await ProcessLock.deleteOne({ key });
        return acquireLock(key, owner);
      }
      return false;
    }
    throw err;
  }
};

const releaseLock = async (key) => {
  await ProcessLock.deleteOne({ key });
};

/**
 * Rebuild one attendance day from punches.
 */
const rebuildDay = async (employeeId, workDate, { force = false } = {}) => {
  const settings = await getSettings();
  const tz = settings.timezone || 'Asia/Karachi';
  const lockKey = `${employeeId}:${workDate}`;
  const got = await acquireLock(lockKey, `engine-${process.pid}`);
  if (!got) return { skipped: true, reason: 'locked' };

  try {
    const employee = await Employee.findById(employeeId).populate('shift');
    if (!employee || employee.deletedAt) {
      return { skipped: true, reason: 'missing_employee' };
    }
    if (employee.status !== 'active' && !force) {
      // keep old rows; do not create new processing for inactive
      const existing = await AttendanceDay.findOne({ employee: employeeId, workDate });
      return { skipped: true, reason: 'inactive', day: existing };
    }

    const existingDay = await AttendanceDay.findOne({ employee: employeeId, workDate });
    if (existingDay?.correctionApplied && !force) {
      // corrections survive reprocess of punches — leave applied status intact later
    }

    const duty = dutyWindowForEmployee(employee, workDate);
    const crossesMidnight = duty.dutyEnd <= duty.dutyStart && !duty.offDay;
    const shiftStartUtc = localDateTimeToUtc(workDate, duty.dutyStart, tz);
    const shiftEndYmd = crossesMidnight ? addDaysYmd(workDate, 1) : workDate;
    const shiftEndUtc = localDateTimeToUtc(shiftEndYmd, duty.dutyEnd, tz);
    const earlyWindowStart = new Date(shiftStartUtc.getTime() - 180 * 60 * 1000);
    const nextShiftStart = new Date(shiftEndUtc.getTime() + 24 * 60 * 60 * 1000);
    const windowEnd = new Date(
      Math.min(
        nextShiftStart.getTime() - 2 * 60 * 60 * 1000,
        shiftStartUtc.getTime() + 18 * 60 * 60 * 1000
      )
    );

    // Night: punches after midnight still belong to start date if before window end
    const punches = await Punch.find({
      employee: employeeId,
      eventTimeUtc: { $gte: earlyWindowStart, $lte: windowEnd },
      ingestStatus: { $in: ['pending', 'processed'] },
    }).sort({ eventTimeUtc: 1 });

    const clean = dedupePunches(punches, settings.punchDedupeSeconds || 60);
    const sessions = pairSessions(clean);

    // Confirm OUT only after 30 minutes with no return
    const confirmMs = (settings.checkoutConfirmMinutes || 30) * 60 * 1000;
    const now = Date.now();
    const confirmedSessions = [];
    let currentlyInside = false;
    for (let i = 0; i < sessions.length; i += 1) {
      const s = sessions[i];
      if (s.open || !s.outPunch) {
        currentlyInside = true;
        confirmedSessions.push(s);
        continue;
      }
      const outAt = new Date(s.outPunch.eventTimeUtc).getTime();
      const nextIn = sessions[i + 1]?.inPunch
        ? new Date(sessions[i + 1].inPunch.eventTimeUtc).getTime()
        : null;
      if (nextIn && nextIn - outAt < confirmMs) {
        // short step-out: movement, day stays open — merge with next
        currentlyInside = true;
        confirmedSessions.push({
          inPunch: s.inPunch,
          outPunch: null,
          open: true,
          provisionalOut: s.outPunch,
          returnIn: sessions[i + 1].inPunch,
        });
        // skip next session's IN as already consumed
        sessions[i + 1] = {
          ...sessions[i + 1],
          consumed: true,
        };
        continue;
      }
      if (now - outAt < confirmMs && !nextIn) {
        currentlyInside = true;
        confirmedSessions.push({ ...s, pendingConfirm: true });
      } else {
        confirmedSessions.push(s);
      }
    }

    const usable = confirmedSessions.filter((s) => !s.consumed);
    const firstIn = usable.find((s) => s.inPunch)?.inPunch || null;
    let lastOut = null;
    for (let i = usable.length - 1; i >= 0; i -= 1) {
      if (usable[i].outPunch && !usable[i].pendingConfirm && !usable[i].open) {
        lastOut = usable[i].outPunch;
        break;
      }
    }

    // Movements (preserve manual overrides)
    const oldManual = await AttendanceMovement.find({
      employee: employeeId,
      workDate,
      manualOverride: true,
    }).lean();
    await AttendanceMovement.deleteMany({
      employee: employeeId,
      workDate,
      manualOverride: { $ne: true },
    });

    let movementCount = oldManual.length;
    let lunchExceeded = false;
    for (const s of usable) {
      if (!s.provisionalOut && !(s.outPunch && s.open === false)) continue;
      const outPunch = s.provisionalOut || s.outPunch;
      const inPunch = s.returnIn || null;
      if (!outPunch || !inPunch) continue;
      const outParts = toLocalParts(new Date(outPunch.eventTimeUtc), tz);
      const inParts = toLocalParts(new Date(inPunch.eventTimeUtc), tz);
      const outMin = outParts.hour * 60 + outParts.minute;
      const inMin = inParts.hour * 60 + inParts.minute;
      const lunch = lunchWindow(workDate);
      const grace = 15;
      let type = 'office_exit';
      if (outMin >= lunch.start && outMin <= lunch.end + grace) {
        if (inMin <= lunch.end + grace) type = 'lunch';
        else {
          type = 'lunch_exceeded';
          lunchExceeded = true;
        }
      }
      const minutes = Math.max(
        0,
        Math.round((new Date(inPunch.eventTimeUtc) - new Date(outPunch.eventTimeUtc)) / 60000)
      );
      await AttendanceMovement.create({
        employee: employeeId,
        workDate,
        type,
        outAt: outPunch.eventTimeUtc,
        inAt: inPunch.eventTimeUtc,
        minutes,
      });
      movementCount += 1;
    }

    const holiday = await Holiday.findOne({ date: workDate, active: true }).lean().catch(() => null);

    let status = 'Open';
    let lateMinutes = 0;
    let earlyMinutes = 0;
    let remark = '';
    let processingState = 'open';
    let timeIn = null;
    let timeOut = null;
    let timeInAt = null;
    let timeOutAt = null;

    if (duty.offDay || holiday) {
      if (!firstIn) {
        status = holiday ? 'Public-holiday' : 'Weekend';
        processingState = 'closed';
        currentlyInside = false;
      }
    }

    if (firstIn) {
      timeInAt = new Date(firstIn.eventTimeUtc);
      timeIn = hmFromParts(toLocalParts(timeInAt, tz));
      const arrival = parseHm(timeIn);
      const startM = parseHm(duty.dutyStart);
      const grace = settings.arrivalGraceMinutes ?? 15;
      const halfThreshold = settings.halfDayArrivalMinutes ?? 240;
      lateMinutes = Math.max(0, arrival - startM);
      if (lateMinutes > grace) {
        status = 'Late';
      } else {
        status = 'Present';
        lateMinutes = 0;
      }
      if (arrival - startM >= halfThreshold) {
        status = 'Half-day';
      }
    }

    if (lastOut) {
      timeOutAt = new Date(lastOut.eventTimeUtc);
      timeOut = hmFromParts(toLocalParts(timeOutAt, tz));
      const leaveM = parseHm(timeOut);
      let endM = parseHm(duty.dutyEnd);
      if (crossesMidnight) endM += 24 * 60;
      let leaveAdj = leaveM;
      if (crossesMidnight && leaveM < parseHm(duty.dutyStart)) leaveAdj += 24 * 60;
      const earlyGrace = settings.earlyGraceMinutes ?? 5;
      earlyMinutes = Math.max(0, endM - leaveAdj);
      if (earlyMinutes > 60) {
        status = 'Half-day';
      } else if (earlyMinutes >= earlyGrace) {
        // grace 5 ⇒ 16:55 early, 16:56 ok
        if (status === 'Present' || status === 'Late') status = 'Early-departure';
      } else {
        earlyMinutes = 0;
      }
      if (!currentlyInside && !usable.some((s) => s.pendingConfirm || s.open)) {
        processingState = 'closed';
      }
    } else if (firstIn) {
      // missing checkout
      if (now > windowEnd.getTime()) {
        status = 'Missing Check-Out';
        processingState = 'closed';
        currentlyInside = false;
      } else {
        status = 'Incomplete';
        processingState = 'open';
        currentlyInside = true;
      }
    }

    // Absent: no check-in on working day after shift end + 90 min
    if (!firstIn && !duty.offDay && !holiday) {
      const absentAfter = shiftEndUtc.getTime() + 90 * 60 * 1000;
      if (now >= absentAfter) {
        status = 'Absent';
        processingState = 'closed';
      } else {
        status = 'Open';
        processingState = 'open';
      }
    }

    // Short-stay rule
    const dutyLen = (() => {
      let a = parseHm(duty.dutyStart);
      let b = parseHm(duty.dutyEnd);
      if (b <= a) b += 24 * 60;
      return b - a;
    })();
    if (
      firstIn &&
      lastOut &&
      dutyLen >= 8 * 60 &&
      processingState === 'closed' &&
      status !== 'Absent'
    ) {
      const spanMin = Math.round((timeOutAt - timeInAt) / 60000);
      if (spanMin < (settings.shortStayMinutes || 180)) {
        status = 'Absent';
        remark =
          'Marked absent because check-in to check-out was under 3 hours.';
      }
    }

    if (lunchExceeded && (status === 'Present' || status === 'Late')) {
      remark = [remark, 'Lunch exceeded'].filter(Boolean).join(' · ');
    }

    // Preserve leave / correction overlays from existing day
    if (existingDay?.leaveApplied && !force) {
      status = existingDay.status;
      remark = existingDay.remark || remark;
    }
    if (existingDay?.correctionApplied && !force) {
      status = existingDay.status;
      timeIn = existingDay.timeIn || timeIn;
      timeOut = existingDay.timeOut || timeOut;
      timeInAt = existingDay.timeInAt || timeInAt;
      timeOutAt = existingDay.timeOutAt || timeOutAt;
      lateMinutes = existingDay.lateMinutes;
      earlyMinutes = existingDay.earlyMinutes;
      remark = existingDay.remark || remark;
    }

    const grossMinutesInside =
      timeInAt && timeOutAt
        ? Math.max(0, Math.round((timeOutAt - timeInAt) / 60000))
        : 0;

    const day = await AttendanceDay.findOneAndUpdate(
      { employee: employeeId, workDate },
      {
        $set: {
          status,
          timeIn,
          timeOut,
          timeInAt,
          timeOutAt,
          source: clean.some((p) => p.source === 'manual')
            ? clean.every((p) => p.source === 'manual')
              ? 'manual'
              : 'hybrid'
            : 'device',
          lateMinutes,
          earlyMinutes,
          grossMinutesInside,
          workingMinutes: grossMinutesInside,
          movementCount,
          overtimeMinutes: 0,
          overtimeHoursComplete: 0,
          remark,
          shiftSnapshot: {
            name: duty.shiftName,
            dutyStart: duty.dutyStart,
            dutyEnd: duty.dutyEnd,
            shiftType: duty.type,
            crossesMidnight,
          },
          processingState,
          currentlyInside,
          engineVersion: ENGINE_VERSION,
          leaveApplied: existingDay?.leaveApplied || false,
          correctionApplied: existingDay?.correctionApplied || false,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    await Punch.updateMany(
      { _id: { $in: clean.map((p) => p._id) }, ingestStatus: 'pending' },
      { $set: { ingestStatus: 'processed' } }
    );

    return { day, rebuilt: true };
  } finally {
    await releaseLock(lockKey);
  }
};

const resolveWorkDateForPunch = (punch, employee, timezone) => {
  const local = toLocalDateString(new Date(punch.eventTimeUtc), timezone);
  const duty = dutyWindowForEmployee(employee, local);
  if (duty.type === 'night' || duty.dutyEnd <= duty.dutyStart) {
    // if local time is before duty end and after midnight, belong to previous day
    const parts = toLocalParts(new Date(punch.eventTimeUtc), timezone);
    const mins = parts.hour * 60 + parts.minute;
    if (mins < parseHm(duty.dutyEnd)) {
      return addDaysYmd(local, -1);
    }
  }
  // also: early punches up to 180 min before start still same day — local date is fine
  return punch.workDateHint || local;
};

const processPendingPunches = async ({ limit = 200 } = {}) => {
  const settings = await getSettings();
  const tz = settings.timezone || 'Asia/Karachi';
  const pending = await Punch.find({
    ingestStatus: 'pending',
    employee: { $ne: null },
  })
    .sort({ eventTimeUtc: 1 })
    .limit(limit);

  const groups = new Map();
  for (const punch of pending) {
    const employee = await Employee.findById(punch.employee).populate('shift');
    if (!employee || employee.status !== 'active' || employee.deletedAt) {
      punch.ingestStatus = 'skipped';
      punch.processError = 'employee inactive or missing';
      await punch.save();
      continue;
    }
    const workDate = resolveWorkDateForPunch(punch, employee, tz);
    const key = `${employee._id}|${workDate}`;
    if (!groups.has(key)) groups.set(key, { employeeId: employee._id, workDate });
  }

  const results = [];
  for (const g of groups.values()) {
    results.push(await rebuildDay(g.employeeId, g.workDate));
  }

  // Fill missed absents for last 31 days (active employees)
  const today = toLocalDateString(new Date(), tz);
  // lightweight: only employees touched above + sample — full scan optional
  return { groups: groups.size, results };
};

module.exports = {
  rebuildDay,
  processPendingPunches,
  resolveWorkDateForPunch,
  dutyWindowForEmployee,
  dedupePunches,
  pairSessions,
  ENGINE_VERSION,
};
