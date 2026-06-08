(function () {
  "use strict";

  var STORAGE_V2 = "classmanager_v2";
  /** 상담 기록 목록·개별·포트폴리오 열람(탭 단위, sessionStorage) */
  var COUNSEL_VIEW_PASSWORD = "5951";
  var SS_COUNSEL_VIEW_UNLOCK = "cm_counsel_view_unlocked";
  /** 봉사 표 하단 빈 입력 행 개수(저장 시 1로 초기화, + 버튼으로 증가) */
  var volunteerEditorBlankRows = 1;

  function isCounselViewUnlocked() {
    try {
      return sessionStorage.getItem(SS_COUNSEL_VIEW_UNLOCK) === "1";
    } catch (e) {
      return false;
    }
  }

  function setCounselViewUnlocked() {
    try {
      sessionStorage.setItem(SS_COUNSEL_VIEW_UNLOCK, "1");
    } catch (e) {}
  }

  function tryUnlockCounselView(rawPassword, onSuccess) {
    if (String(rawPassword || "").trim() !== COUNSEL_VIEW_PASSWORD) {
      toast("비밀번호가 올바르지 않습니다.");
      return false;
    }
    setCounselViewUnlocked();
    if (onSuccess) onSuccess();
    return true;
  }

  function syncCounselListGateUi() {
    /* 구역 게이트는 상담관리 탭의 학생별「상담 기록 확인」패널에서 처리 */
  }

  function appendCounselPasswordGate(container, onSuccess) {
    if (!container) return;
    container.innerHTML = "";
    var gate = document.createElement("div");
    gate.className = "cm-counsel-gate";
    var p = document.createElement("p");
    p.className = "cm-settings-note";
    p.textContent = "상담 기록은 비밀번호를 입력한 뒤에만 표시됩니다.";
    var lab = document.createElement("label");
    lab.className = "school-filter-field";
    var span = document.createElement("span");
    span.className = "school-filter-label";
    span.textContent = "비밀번호";
    var inp = document.createElement("input");
    inp.type = "password";
    inp.className = "school-filter-select cm-input-text";
    inp.autocomplete = "off";
    inp.setAttribute("aria-label", "상담 기록 보기 비밀번호");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-btn";
    btn.textContent = "확인";
    function submit() {
      var v = inp.value;
      inp.value = "";
      tryUnlockCounselView(v, onSuccess);
    }
    btn.addEventListener("click", submit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    lab.appendChild(span);
    lab.appendChild(inp);
    gate.appendChild(p);
    gate.appendChild(lab);
    gate.appendChild(btn);
    container.appendChild(gate);
  }

  function renderCounselRecordsForStudent(container, sid, emptyMsg) {
    if (!container) return;
    container.innerHTML = "";
    var wantSid = String(sid);
    var cRows = state.counselings
      .filter(function (c) {
        return c && String(c.studentId) === wantSid;
      })
      .sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
    if (cRows.length === 0) {
      var pc = document.createElement("p");
      pc.className = "cm-home-muted";
      pc.textContent = emptyMsg || "상담관리 탭에 등록된 기록이 없습니다.";
      container.appendChild(pc);
      return;
    }
    cRows.forEach(function (r) {
      var div = document.createElement("div");
      div.className = "cm-record-item";
      var meta = document.createElement("div");
      meta.className = "cm-record-item__meta";
      var dateLine = r.counselingDate ? "상담일 " + r.counselingDate + " · " : "";
      meta.textContent = dateLine + formatTs(r.createdAt);
      var bod = document.createElement("div");
      bod.className = "cm-record-item__body";
      var t = (r.topics || "").trim();
      bod.textContent = (t ? "주제: " + t + "\n\n" : "") + (r.body || "");
      var act = document.createElement("div");
      act.className = "cm-record-actions";
      var b1 = document.createElement("button");
      b1.type = "button";
      b1.className = "btn-secondary";
      b1.textContent = "수정";
      b1.addEventListener("click", function () {
        if (!els.ceditId || !els.ceditDate || !els.ceditTopics || !els.ceditBody) {
          toast("상담 수정 창을 불러오지 못했습니다.");
          return;
        }
        els.ceditId.value = r.id;
        els.ceditDate.value = r.counselingDate || "";
        els.ceditTopics.value = r.topics || "";
        els.ceditBody.value = r.body || "";
        openModal("counselEditModal");
      });
      var b2 = document.createElement("button");
      b2.type = "button";
      b2.className = "btn-danger";
      b2.textContent = "삭제";
      b2.addEventListener("click", function () {
        if (!confirm("이 상담 기록을 삭제할까요?")) return;
        state.counselings = state.counselings.filter(function (x) {
          return String(x.id) !== String(r.id);
        });
        persist();
        toast("삭제했습니다.");
        renderAll();
      });
      act.appendChild(b1);
      act.appendChild(b2);
      div.appendChild(meta);
      div.appendChild(bod);
      div.appendChild(act);
      container.appendChild(div);
    });
  }

  function emptyTimetableGrid() {
    var wd = ["월", "화", "수", "목", "금"];
    var rows = [];
    for (var i = 1; i <= 7; i++) {
      rows.push({ period: String(i), cells: ["", "", "", "", ""] });
    }
    return { weekdayLabels: wd.slice(), rows: rows };
  }

  function normalizeTimetableGrid(g) {
    var d = emptyTimetableGrid();
    if (!g || !Array.isArray(g.rows)) return d;
    if (Array.isArray(g.weekdayLabels) && g.weekdayLabels.length === 5) {
      d.weekdayLabels = g.weekdayLabels.map(function (x, i) {
        var t = String(x == null ? "" : x).trim();
        return t || ["월", "화", "수", "목", "금"][i];
      });
    }
    for (var r = 0; r < 7; r++) {
      var row = g.rows[r];
      if (!row) continue;
      if (row.period != null && String(row.period).trim()) d.rows[r].period = String(row.period).trim();
      var cells = row.cells;
      if (!Array.isArray(cells)) continue;
      for (var c = 0; c < 5; c++) {
        d.rows[r].cells[c] = String(cells[c] == null ? "" : cells[c]).trim();
      }
    }
    return d;
  }

  var currentTabId = "home";
  var studentIndividualOpenId = null;
  /** 학생 개별 상세 카드 내 탭: basic | volunteer | autonomous | career | eval */
  var studentIndividualPanelTab = "basic";
  var rosterFolderActive = null;
  /** 상담관리 탭: 선택 학생, 상세 내 탭 new | list */
  var counselManageOpenStudentId = null;
  var counselManagePanelTab = "new";

  function uid() {
    return "x_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function safeParse(json, fallback) {
    try {
      var v = JSON.parse(json);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function emptyState() {
    return {
      version: 2,
      homeroom: {
        schoolName: "",
        grade: "",
        className: "",
        teacherName: "",
      },
      students: [],
      counselings: [],
      volunteers: [],
      evaluations: {},
      timetableGrids: { class: emptyTimetableGrid(), teacher: emptyTimetableGrid() },
      dashboard: emptyDashboard(),
      participationEventCatalog: [],
    };
  }

  function emptyDashboard() {
    return {
      calendarYm: "",
      selectedDate: "",
      holidays: [],
      todosByDate: {},
      attendanceByDate: {},
      calendarEvents: [],
    };
  }

  var CAL_EVENT_CATEGORIES = [
    { id: "personal", label: "개인", color: "#5ac8fa" },
    { id: "class", label: "학급", color: "#34c759" },
    { id: "meeting", label: "회의", color: "#ff9500" },
    { id: "school", label: "학교", color: "#af52de" },
    { id: "other", label: "기타", color: "#8e8e93" },
  ];

  function calendarCategoryById(id) {
    for (var i = 0; i < CAL_EVENT_CATEGORIES.length; i++) {
      if (CAL_EVENT_CATEGORIES[i].id === id) return CAL_EVENT_CATEGORIES[i];
    }
    return null;
  }

  function calendarEventsForDate(ymd) {
    var list = (state.dashboard.calendarEvents || []).filter(function (e) {
      return e && e.date === ymd;
    });
    list.sort(function (a, b) {
      var ad = !!a.allDay;
      var bd = !!b.allDay;
      if (ad !== bd) return ad ? -1 : 1;
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    return list;
  }

  function ymdPad2(n) {
    return String(n).padStart(2, "0");
  }

  function ymdFromDate(d) {
    return d.getFullYear() + "-" + ymdPad2(d.getMonth() + 1) + "-" + ymdPad2(d.getDate());
  }

  function todayYmd() {
    return ymdFromDate(new Date());
  }

  function currentYm() {
    var d = new Date();
    return d.getFullYear() + "-" + ymdPad2(d.getMonth() + 1);
  }

  function dateFromYmd(s) {
    var p = String(s || "").split("-");
    if (p.length !== 3) return new Date(NaN);
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var day = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(day)) return new Date(NaN);
    return new Date(y, m, day);
  }

  function normalizeDashboard(d) {
    var out = emptyDashboard();
    if (!d || typeof d !== "object") d = {};
    out.calendarYm = String(d.calendarYm || "").trim();
    if (!/^\d{4}-\d{2}$/.test(out.calendarYm)) out.calendarYm = currentYm();
    out.selectedDate = String(d.selectedDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.selectedDate)) out.selectedDate = todayYmd();
    if (isNaN(dateFromYmd(out.selectedDate).getTime())) out.selectedDate = todayYmd();
    out.holidays = Array.isArray(d.holidays)
      ? d.holidays
          .map(function (x) {
            return String(x || "").trim();
          })
          .filter(function (x) {
            return /^\d{4}-\d{2}-\d{2}$/.test(x);
          })
      : [];
    var seen = {};
    out.holidays = out.holidays.filter(function (x) {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
    out.holidays.sort();
    out.todosByDate = d.todosByDate && typeof d.todosByDate === "object" ? d.todosByDate : {};
    out.attendanceByDate = d.attendanceByDate && typeof d.attendanceByDate === "object" ? d.attendanceByDate : {};
    out.calendarEvents = [];
    if (Array.isArray(d.calendarEvents)) {
      d.calendarEvents.forEach(function (ev) {
        if (!ev || typeof ev !== "object") return;
        var date = String(ev.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        var title = String(ev.title || "").trim();
        if (!title) return;
        var cat = String(ev.categoryId || "other");
        if (!calendarCategoryById(cat)) cat = "other";
        var allDay = !!ev.allDay;
        var st = "";
        var et = "";
        if (!allDay) {
          st = String(ev.startTime || "09:00").trim().slice(0, 5);
          if (!/^\d{2}:\d{2}$/.test(st)) st = "09:00";
          et = String(ev.endTime || "").trim().slice(0, 5);
          if (et && !/^\d{2}:\d{2}$/.test(et)) et = "";
        }
        out.calendarEvents.push({
          id: String(ev.id || "").trim() || uid(),
          date: date,
          categoryId: cat,
          allDay: allDay,
          startTime: st,
          endTime: et,
          title: title.slice(0, 120),
          detail: String(ev.detail || "").slice(0, 2000),
        });
      });
    }
    return out;
  }

  function isWeekendYmd(ymd) {
    var d = dateFromYmd(ymd);
    if (isNaN(d.getTime())) return false;
    var w = d.getDay();
    return w === 0 || w === 6;
  }

  function isHolidayYmd(ymd) {
    return state.dashboard.holidays.indexOf(ymd) >= 0;
  }

  function isSchoolDayYmd(ymd) {
    return !isWeekendYmd(ymd) && !isHolidayYmd(ymd);
  }

  /** 월~금 열 인덱스 0~4, 그 외 -1 */
  function weekdayColIndexFromYmd(ymd) {
    var d = dateFromYmd(ymd);
    if (isNaN(d.getTime())) return -1;
    var w = d.getDay();
    if (w >= 1 && w <= 5) return w - 1;
    return -1;
  }

  var ATT_STATUS_OPTIONS = [
    { v: "", lab: "—" },
    { v: "present", lab: "출석" },
    { v: "late", lab: "지각" },
    { v: "early_leave", lab: "조퇴" },
    { v: "absent", lab: "결석" },
  ];

  function attendanceSummaryForDay(ymd) {
    var list = rosterStudentsSortedByNumber();
    var n = list.length;
    if (!n || !isSchoolDayYmd(ymd)) return { total: 0, filled: 0, level: "none" };
    var map = state.dashboard.attendanceByDate[ymd] || {};
    var filled = 0;
    for (var i = 0; i < n; i++) {
      var st = map[list[i].id];
      if (st && String(st).trim()) filled++;
    }
    var level = "empty";
    if (filled >= n) level = "full";
    else if (filled > 0) level = "partial";
    return { total: n, filled: filled, level: level };
  }

  function migrateFromV1() {
    var rosterRaw = "[]";
    var counselRaw = "[]";
    try {
      rosterRaw = localStorage.getItem("classmanager_v1_roster") || "[]";
      counselRaw = localStorage.getItem("classmanager_v1_counsel") || "[]";
    } catch (e) {
      return null;
    }
    var roster = safeParse(rosterRaw, []);
    if (!Array.isArray(roster) || roster.length === 0) return null;
    var st = emptyState();
    st.students = roster.map(function (s) {
      return {
        id: s.id || uid(),
        name: (s.name || "").trim(),
        number: String(s.number || "").trim(),
        note: String(s.note || "").trim(),
        gender: "",
        studentPhone: "",
        guardianPhone: "",
        careerInterest: "",
        clubName: "",
        specialNotes: "",
        oneRole: "",
        electiveSubjects: emptyElectiveSlots(),
        timetable: "",
        participationEvents: "",
      };
    });
    var counsel = safeParse(counselRaw, []);
    st.counselings = (Array.isArray(counsel) ? counsel : []).map(function (c) {
      return {
        id: c.id || uid(),
        studentId: c.studentId,
        body: String(c.body || ""),
        topics: "",
        counselingDate: "",
        createdAt: c.createdAt || new Date().toISOString(),
      };
    });
    return st;
  }

  var state = emptyState();

  function loadState() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_V2);
    } catch (e) {
      toast("브라우저 저장소를 사용할 수 없습니다. 시크릿 모드·저장 차단 여부를 확인해 주세요.");
      state = emptyState();
      return;
    }
    if (raw) {
      var o = safeParse(raw, null);
      if (o && o.version === 2) {
        state = normalizeState(o);
        return;
      }
    }
    var m = migrateFromV1();
    if (m) {
      state = normalizeState(m);
      persist();
      return;
    }
    state = emptyState();
  }

  function normalizeState(o) {
    var s = emptyState();
    s.homeroom = Object.assign(s.homeroom, o.homeroom || {});
    s.students = Array.isArray(o.students) ? o.students : [];
    s.counselings = (Array.isArray(o.counselings) ? o.counselings : [])
      .filter(function (c) {
        return c && typeof c === "object";
      })
      .map(function (c) {
        return {
          id: c.id || uid(),
          studentId: c.studentId,
          body: String(c.body || ""),
          topics: String(c.topics || ""),
          counselingDate: String(c.counselingDate || ""),
          createdAt: c.createdAt || new Date().toISOString(),
        };
      });
    s.volunteers = Array.isArray(o.volunteers) ? o.volunteers : [];
    s.evaluations = o.evaluations && typeof o.evaluations === "object" ? o.evaluations : {};
    s.timetableGrids = {
      class: normalizeTimetableGrid(o.timetableGrids && o.timetableGrids.class),
      teacher: normalizeTimetableGrid(o.timetableGrids && o.timetableGrids.teacher),
    };
    s.dashboard = normalizeDashboard(o.dashboard);
    s.participationEventCatalog = normalizeParticipationEventCatalog(o.participationEventCatalog);
    s.students = s.students.map(function (st) {
      var x = Object.assign({}, st);
      if (!x.id) x.id = uid();
      if (x.oneRole == null) x.oneRole = "";
      if (x.clubRoom == null) x.clubRoom = "";
      if (x.clubTeacher == null) x.clubTeacher = "";
      if (x.electiveSubjects == null) x.electiveSubjects = emptyElectiveSlots();
      else x.electiveSubjects = coerceElectiveSubjects(x.electiveSubjects);
      if (x.timetable == null) x.timetable = "";
      if (x.neisTimetableS1 === undefined) x.neisTimetableS1 = null;
      if (x.neisTimetableS2 === undefined) x.neisTimetableS2 = null;
      if (x.neisTimetable && x.neisTimetable.rows && x.neisTimetable.rows.length) {
        var legSem = semesterKeyFromNeisTitle(x.neisTimetable.title || "");
        if (legSem === "s2") {
          if (!x.neisTimetableS2 || !x.neisTimetableS2.rows || !x.neisTimetableS2.rows.length) x.neisTimetableS2 = x.neisTimetable;
        } else {
          if (!x.neisTimetableS1 || !x.neisTimetableS1.rows || !x.neisTimetableS1.rows.length) x.neisTimetableS1 = x.neisTimetable;
        }
        x.neisTimetable = null;
      }
      if (x.neisTimetable == null) x.neisTimetable = null;
      if (x.participationEvents == null) x.participationEvents = "";
      x.participationSemSlots = coerceParticipationSemSlots(x.participationSemSlots, x.participationEvents);
      x.participationEvents = participationSemSlotsToLegacySummary(x.participationSemSlots, s.participationEventCatalog);
      x.autonomousActivities = normalizeStudentActivityList(x.autonomousActivities, x.autonomousActivity);
      x.careerActivities = normalizeStudentActivityList(x.careerActivities, x.careerActivity);
      delete x.autonomousActivity;
      delete x.careerActivity;
      coerceSiInputClosedOnStudent(x);
      return x;
    });
    return s;
  }

  /** @returns {boolean} 저장 성공 여부 */
  function persist() {
    try {
      localStorage.setItem(STORAGE_V2, JSON.stringify(state));
      return true;
    } catch (e) {
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
        toast("저장 공간이 부족합니다. 백업 후 불필요한 데이터를 정리하거나 브라우저 저장 데이터를 확인해 주세요.");
      } else {
        toast("데이터를 저장하지 못했습니다. 브라우저 설정(시크릿 모드·저장 차단)을 확인해 주세요.");
      }
      return false;
    }
  }

  function escapeHtml(str) {
    var d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function numberSortKey(numStr) {
    var s = String(numStr || "").trim();
    var m = s.match(/\d+/);
    if (m) return [0, parseInt(m[0], 10), s];
    return [1, 999999, s];
  }

  function studentById(id) {
    if (id == null || id === "") return null;
    var want = String(id);
    for (var i = 0; i < state.students.length; i++) {
      if (String(state.students[i].id) === want) return state.students[i];
    }
    return null;
  }

  function coerceSiInputClosedOnStudent(x) {
    if (!x || typeof x !== "object") return;
    x.siInputClosedVolunteer = x.siInputClosedVolunteer === true;
    x.siInputClosedAutonomous = x.siInputClosedAutonomous === true;
    x.siInputClosedCareer = x.siInputClosedCareer === true;
    x.siInputClosedEval = x.siInputClosedEval === true;
  }

  /** @returns {boolean} 값이 바뀌었으면 true */
  function clearSiInputClosedFlag(sid, which) {
    var s = studentById(sid);
    if (!s) return false;
    coerceSiInputClosedOnStudent(s);
    var k =
      which === "volunteer"
        ? "siInputClosedVolunteer"
        : which === "autonomous"
          ? "siInputClosedAutonomous"
          : which === "career"
            ? "siInputClosedCareer"
            : which === "eval"
              ? "siInputClosedEval"
              : null;
    if (!k || !s[k]) return false;
    s[k] = false;
    return true;
  }

  /** 개별관리 입력 마감 구역 수(봉사·자율·진로·총평) — 포트폴리오 진행률 분모 */
  var SI_INPUT_CLOSE_ZONE_COUNT = 4;

  function siInputClosedCount(s) {
    coerceSiInputClosedOnStudent(s);
    var n = 0;
    if (s.siInputClosedVolunteer) n++;
    if (s.siInputClosedAutonomous) n++;
    if (s.siInputClosedCareer) n++;
    if (s.siInputClosedEval) n++;
    return n;
  }

  function siInputClosedPct(s) {
    return Math.round((siInputClosedCount(s) / SI_INPUT_CLOSE_ZONE_COUNT) * 100);
  }

  function studentName(id) {
    var s = studentById(id);
    return s ? s.name : "(삭제됨)";
  }

  function findRowById(arr, id) {
    if (id == null || id === "") return null;
    var want = String(id);
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].id) === want) return arr[i];
    }
    return null;
  }

  function genderLabel(g) {
    if (g === "M") return "남";
    if (g === "F") return "여";
    if (g === "O") return "기타";
    return "—";
  }

  function parseGenderImport(raw) {
    var v = String(raw == null ? "" : raw)
      .trim()
      .toLowerCase();
    if (!v) return "";
    if (v === "m" || v === "남" || v === "male" || v === "남자") return "M";
    if (v === "f" || v === "여" || v === "female" || v === "여자") return "F";
    if (v === "o" || v === "기타") return "O";
    return "";
  }

  function normExcelHeader(h) {
    return String(h == null ? "" : h)
      .trim()
      .replace(/[\s\u00a0\u3000]+/g, "");
  }

  function emptyElectiveSlots() {
    return { s1: ["", "", ""], s2: ["", "", ""] };
  }

  function coerceElectiveSubjects(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      function trim3(a) {
        var o = ["", "", ""];
        var arr = Array.isArray(a) ? a : [];
        for (var i = 0; i < 3; i++) {
          o[i] = String(arr[i] == null ? "" : arr[i]).trim();
          if (o[i].length > 120) o[i] = o[i].slice(0, 120);
        }
        return o;
      }
      return { s1: trim3(raw.s1), s2: trim3(raw.s2) };
    }
    var legacy = String(raw == null ? "" : raw).trim();
    var o = emptyElectiveSlots();
    if (!legacy) return o;
    var parts = [];
    var lines = legacy.split(/\r\n|\n/).map(function (l) {
      return l.trim();
    });
    var multiline = lines.filter(Boolean).length > 1;
    if (multiline) {
      lines.forEach(function (ln) {
        if (!ln) return;
        ln.split(/[,，]/).forEach(function (x) {
          x = x.trim();
          if (x) parts.push(x);
        });
      });
    } else {
      legacy.split(/[,，]/).forEach(function (x) {
        x = x.trim();
        if (x) parts.push(x);
      });
    }
    for (var k = 0; k < Math.min(6, parts.length); k++) {
      var sem = k < 3 ? "s1" : "s2";
      var idx = k % 3;
      o[sem][idx] = parts[k].slice(0, 120);
    }
    if (!parts.length) o.s1[0] = legacy.slice(0, 120);
    return o;
  }

  function emptyParticipationSemSlots() {
    return { s1: [null, null, null, null, null], s2: [null, null, null, null, null] };
  }

  function normalizeParticipationSlot(slot) {
    if (!slot || typeof slot !== "object") return null;
    if (slot.mode === "catalog" && slot.catalogId) {
      return { mode: "catalog", catalogId: String(slot.catalogId).trim() };
    }
    if (slot.mode === "manual") {
      var t = String(slot.text != null ? slot.text : "").trim().slice(0, 200);
      return { mode: "manual", text: t };
    }
    return null;
  }

  function coerceParticipationSemSlots(raw, legacyText) {
    var empty = emptyParticipationSemSlots();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      ["s1", "s2"].forEach(function (sem) {
        var arr = raw[sem];
        if (!Array.isArray(arr)) arr = [];
        for (var i = 0; i < 5; i++) {
          empty[sem][i] = normalizeParticipationSlot(arr[i]);
        }
      });
      return empty;
    }
    var lt = String(legacyText == null ? "" : legacyText).trim();
    if (!lt) return empty;
    var parts = [];
    lt.split(/\r\n|\n/).forEach(function (ln) {
      ln = ln.trim();
      if (!ln) return;
      ln.split(/[,，]/).forEach(function (x) {
        x = String(x || "").trim();
        if (x) parts.push(x);
      });
    });
    if (!parts.length) parts = [lt.slice(0, 200)];
    for (var p = 0; p < Math.min(10, parts.length); p++) {
      var sem = p < 5 ? "s1" : "s2";
      var idx = p % 5;
      empty[sem][idx] = { mode: "manual", text: parts[p].slice(0, 200) };
    }
    return empty;
  }

  /** 비어 있음을 표시할 때(빈 칸 안내) */
  var PARTICIPATION_EMPTY_DISPLAY = "선택 or 직접입력";

  /** 자율·진로 활동 모달 — 활동명 입력란 placeholder */
  var SI_ACT_NAME_PLACEHOLDER =
    "학생의 활동을 선택하거나, 활동명을 자유롭게 입력하세요. 단, 활동별로 입력시 해당 활동의 기재 가능 영역(자율, 진로 중)을 확인하세요.";

  function participationTextIsEmptySentinel(v) {
    var t = String(v == null ? "" : v).trim();
    if (!t) return true;
    if (t === PARTICIPATION_EMPTY_DISPLAY) return true;
    if (t === "\u2014" || t === "-") return true;
    return false;
  }

  function participationCatalogEventById(catalog, id) {
    var want = String(id || "").trim();
    if (!want || !Array.isArray(catalog)) return null;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i] && catalog[i].id === want) return catalog[i];
    }
    return null;
  }

  /** 담당부서 문자열 기준 칩 색(같은 부서는 동일 색) */
  function participationCatalogChipStyleForDepartment(department) {
    var s = normExcelHeader(String(department == null ? "" : department));
    if (!s) s = "__none__";
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var hues = [212, 142, 28, 268, 152, 328, 52, 188, 292, 96, 12, 200];
    var hue = hues[Math.abs(h) % hues.length];
    return {
      bg: "hsl(" + hue + ", 58%, 92%)",
      br: "hsl(" + hue + ", 42%, 70%)",
      fg: "hsl(" + hue + ", 26%, 20%)",
    };
  }

  function participationSlotDepartmentKey(slot, catalog) {
    if (!slot) return "";
    var cat = Array.isArray(catalog) ? catalog : [];
    if (slot.mode === "catalog" && slot.catalogId) {
      var ev = participationCatalogEventById(cat, slot.catalogId);
      return ev ? String(ev.department || "").trim() : "";
    }
    if (slot.mode === "manual") {
      var resolved = matchImportTextToParticipationSlot(String(slot.text || ""), cat);
      if (resolved && resolved.mode === "catalog" && resolved.catalogId) {
        var ev2 = participationCatalogEventById(cat, resolved.catalogId);
        return ev2 ? String(ev2.department || "").trim() : "";
      }
    }
    return "";
  }

  /** 일괄 참여행사 칩과 동일한 배경·테두리·글자색(담당부서 해시) */
  function participationSlotVisualStyle(slot, catalog) {
    if (!slot) {
      return {
        bg: "hsl(220, 14%, 91%)",
        br: "hsl(220, 10%, 78%)",
        fg: "hsl(222, 14%, 24%)",
      };
    }
    if (slot.mode === "catalog" && slot.catalogId) {
      var ev = participationCatalogEventById(Array.isArray(catalog) ? catalog : [], slot.catalogId);
      if (ev) return participationCatalogChipStyleForDepartment(String(ev.department || "").trim());
    }
    var deptKey = participationSlotDepartmentKey(slot, catalog);
    return participationCatalogChipStyleForDepartment(deptKey || "");
  }

  function participationCatalogPickLabel(ev) {
    if (!ev) return "";
    var n = String(ev.name || "").trim();
    var m = String(ev.month || "").trim();
    var d = String(ev.department || "").trim();
    var parts = [n];
    if (m) parts.push(m);
    if (d) parts.push(d);
    return parts.join(" · ");
  }

  /** 칩·입력란 표시용(행사명만) */
  function participationCatalogChipTitle(ev) {
    return String(ev && ev.name != null ? ev.name : "").trim().slice(0, 120);
  }

  function participationSlotDisplayText(slot, catalog) {
    if (!slot) return "";
    if (slot.mode === "catalog") {
      var ev = participationCatalogEventById(catalog, slot.catalogId);
      if (ev) return participationCatalogPickLabel(ev);
      return "(삭제된 행사)";
    }
    if (slot.mode === "manual") return String(slot.text || "").trim();
    return "";
  }

  function participationSemSlotsToLegacySummary(slots, catalog) {
    var s = coerceParticipationSemSlots(slots, "");
    function line(semKey, lab) {
      var bits = [];
      for (var i = 0; i < 5; i++) {
        var t = participationSlotDisplayText(s[semKey][i], catalog);
        if (t) bits.push(t);
      }
      return lab + ": " + (bits.length ? bits.join(", ") : "—");
    }
    return line("s1", "1학기") + "\n" + line("s2", "2학기");
  }

  function syncStudentParticipationLegacySummary(s) {
    if (!s) return;
    s.participationSemSlots = coerceParticipationSemSlots(s.participationSemSlots, "");
    s.participationEvents = participationSemSlotsToLegacySummary(s.participationSemSlots, state.participationEventCatalog || []);
  }

  function emptyActivityRecordBlock() {
    return { name: "", content: "", studentReflection: "", teacherObservation: "" };
  }

  function normalizeActivityRecordBlock(raw) {
    if (!raw || typeof raw !== "object") return emptyActivityRecordBlock();
    return {
      name: String(raw.name != null ? raw.name : "").trim().slice(0, 200),
      content: String(raw.content != null ? raw.content : "").trim().slice(0, 8000),
      studentReflection: String(raw.studentReflection != null ? raw.studentReflection : "").trim().slice(0, 8000),
      teacherObservation: String(raw.teacherObservation != null ? raw.teacherObservation : "").trim().slice(0, 8000),
    };
  }

  function normalizeActivityRecordEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    var f = normalizeActivityRecordBlock(raw);
    var id = String(raw.id != null ? raw.id : "").trim();
    if (!id) id = uid();
    var createdAt = String(raw.createdAt != null ? raw.createdAt : "").trim();
    if (!createdAt) createdAt = new Date().toISOString();
    return {
      id: id,
      name: f.name,
      content: f.content,
      studentReflection: f.studentReflection,
      teacherObservation: f.teacherObservation,
      createdAt: createdAt,
    };
  }

  /** 배열 정규화. 예전 단일 객체(legacySingle)는 한 건으로 승격 */
  function normalizeStudentActivityList(arr, legacySingle) {
    var out = [];
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        var e = normalizeActivityRecordEntry(arr[i]);
        if (!e) continue;
        if (e.name || e.content || e.studentReflection || e.teacherObservation) out.push(e);
      }
      return out;
    }
    if (legacySingle != null && typeof legacySingle === "object") {
      var e2 = normalizeActivityRecordEntry(legacySingle);
      if (e2 && (e2.name || e2.content || e2.studentReflection || e2.teacherObservation)) out.push(e2);
    }
    return out;
  }

  /** 학생 일괄 관리 참여행사 슬롯 중 비어 있지 않은 항목(개별 관리 카드 표시용) */
  function studentParticipationFilledRows(student) {
    if (!student) return [];
    var cat = state.participationEventCatalog || [];
    var slots = coerceParticipationSemSlots(student.participationSemSlots, student.participationEvents);
    var rows = [];
    ["s1", "s2"].forEach(function (sem) {
      var semLab = sem === "s1" ? "1학기" : "2학기";
      for (var i = 0; i < 5; i++) {
        var sl = slots[sem][i];
        if (!sl) continue;
        var t = participationSlotDisplayText(sl, cat);
        if (!t || participationTextIsEmptySentinel(t)) continue;
        rows.push({ semKey: sem, semLab: semLab, slotIndex: i + 1, text: t, slot: sl });
      }
    });
    return rows;
  }

  function normalizeParticipationEventCatalog(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    var seen = {};
    arr.forEach(function (ev) {
      if (!ev || typeof ev !== "object") return;
      var name = String(ev.name || "").trim().slice(0, 120);
      if (!name) return;
      var department = String(ev.department != null ? ev.department : ev.dept || "").trim().slice(0, 80);
      var month = String(ev.month != null ? ev.month : ev.runMonth || "").trim().slice(0, 40);
      var target = String(ev.target != null ? ev.target : ev.audience || "").trim().slice(0, 120);
      var activityRecord = String(ev.activityRecord != null ? ev.activityRecord : ev.activityContent || "").trim().slice(0, 500);
      var seq = ev.seq == null || ev.seq === "" ? "" : String(ev.seq).trim().slice(0, 12);
      var key = eventCatalogMergeKey(name, department, month);
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        id: String(ev.id || "").trim() || uid(),
        seq: seq,
        name: name,
        month: month,
        target: target,
        department: department,
        activityRecord: activityRecord,
      });
    });
    return out;
  }

  function eventCatalogMergeKey(name, department, month) {
    return (
      normExcelHeader(name) + "|" + normExcelHeader(department) + "|" + normExcelHeader(month == null ? "" : month)
    );
  }

  function rosterParticipationSlotColumnsPresent(colIndex) {
    for (var si = 0; si < 5; si++) {
      if (colIndex["participationS1_" + si] != null) return true;
      if (colIndex["participationS2_" + si] != null) return true;
    }
    return false;
  }

  function matchImportTextToParticipationSlot(text, catalog) {
    var raw = String(text == null ? "" : text).trim();
    if (participationTextIsEmptySentinel(text)) return null;
    var cat = Array.isArray(catalog) ? catalog : [];
    var exactHits = [];
    var i;
    for (i = 0; i < cat.length; i++) {
      var ev = cat[i];
      if (!ev) continue;
      var lab = participationCatalogPickLabel(ev);
      if (lab === raw) exactHits.push(ev);
    }
    if (exactHits.length === 1) return { mode: "catalog", catalogId: exactHits[0].id };
    if (exactHits.length > 1) return { mode: "manual", text: raw.slice(0, 200) };
    var nameHits = [];
    for (i = 0; i < cat.length; i++) {
      if (cat[i] && String(cat[i].name || "").trim() === raw) nameHits.push(cat[i]);
    }
    if (nameHits.length === 1) return { mode: "catalog", catalogId: nameHits[0].id };
    return { mode: "manual", text: raw.slice(0, 200) };
  }

  function exportEventCatalogExcel() {
    if (typeof XLSX === "undefined") {
      toast("엑셀 기능을 불러오지 못했습니다. 인터넷 연결 후 새로고침 해 주세요.");
      return;
    }
    var cat = normalizeParticipationEventCatalog(state.participationEventCatalog || []);
    var headers = ["순번", "행사명", "시행월", "참가대상", "담당부서", "활동내용기록항목"];
    var rows = cat.map(function (ev, idx) {
      var seqOut = ev.seq !== "" && ev.seq != null ? excelCellString(ev.seq) : String(idx + 1);
      return [
        seqOut,
        excelCellString(ev.name),
        excelCellString(ev.month),
        excelCellString(ev.target),
        excelCellString(ev.department),
        excelCellString(ev.activityRecord),
      ];
    });
    var pad = 18;
    while (rows.length < pad) {
      rows.push(["", "", "", "", "", ""]);
    }
    var aoa = [headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 8 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 40 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "행사목록");
    var fname = "classmanager_행사목록_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    XLSX.writeFile(wb, fname);
    toast("행사 목록 양식을 내려받았습니다.");
  }

  function findEventCatalogHeaderRow(aoa) {
    var maxR = Math.min(aoa.length || 0, 40);
    for (var r = 0; r < maxR; r++) {
      var row = aoa[r] || [];
      var byH = {};
      for (var c = 0; c < row.length; c++) {
        var hk = rosterHeaderKey(excelCellString(row[c]));
        if (hk && byH[hk] == null) byH[hk] = c;
      }
      if (byH["행사명"] == null) continue;
      var nameCol = byH["행사명"];
      var deptCol = byH["담당부서"] != null ? byH["담당부서"] : byH["주관부서"] != null ? byH["주관부서"] : null;
      return {
        row: r,
        seqCol: byH["순번"] != null ? byH["순번"] : nameCol > 0 ? nameCol - 1 : null,
        nameCol: nameCol,
        monthCol: byH["시행월"] != null ? byH["시행월"] : null,
        targetCol: byH["참가대상"] != null ? byH["참가대상"] : null,
        deptCol: deptCol,
        activityCol: byH["활동내용기록항목"] != null ? byH["활동내용기록항목"] : null,
      };
    }
    return null;
  }

  function importEventCatalogExcelBuffer(buf) {
    if (typeof XLSX === "undefined") {
      toast("엑셀 라이브러리가 없습니다.");
      return;
    }
    var wb = XLSX.read(buf, { type: "array" });
    var sn0 = wb.SheetNames[0];
    if (!sn0) {
      toast("시트가 없습니다.");
      return;
    }
    var ws = wb.Sheets[sn0];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (!aoa.length) {
      toast("데이터가 없습니다.");
      return;
    }
    var hdr = findEventCatalogHeaderRow(aoa);
    if (!hdr) {
      toast("「행사명」이 있는 헤더 행을 찾지 못했습니다.");
      return;
    }
    var oldCat = normalizeParticipationEventCatalog(state.participationEventCatalog || []);
    var oldById = {};
    oldCat.forEach(function (e) {
      oldById[e.id] = e;
    });
    var oldByKey = {};
    oldCat.forEach(function (e) {
      oldByKey[eventCatalogMergeKey(e.name, e.department, e.month)] = e;
    });
    function evCell(row, col) {
      if (col == null || col < 0) return "";
      return excelCellString(row[col]);
    }
    var incoming = [];
    for (var r = hdr.row + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var name = evCell(row, hdr.nameCol);
      if (!name.trim()) continue;
      var seq = hdr.seqCol != null ? evCell(row, hdr.seqCol) : "";
      var month = hdr.monthCol != null ? evCell(row, hdr.monthCol) : "";
      var target = hdr.targetCol != null ? evCell(row, hdr.targetCol) : "";
      var dept = hdr.deptCol != null ? evCell(row, hdr.deptCol) : "";
      var activity = hdr.activityCol != null ? evCell(row, hdr.activityCol) : "";
      incoming.push({
        seq: String(seq || "").trim().slice(0, 12),
        name: name.trim().slice(0, 120),
        month: String(month || "").trim().slice(0, 40),
        target: String(target || "").trim().slice(0, 120),
        department: String(dept || "").trim().slice(0, 80),
        activityRecord: String(activity || "").trim().slice(0, 500),
      });
    }
    if (!incoming.length) {
      toast("저장할 행사 행이 없습니다.");
      return;
    }
    var newCat = [];
    incoming.forEach(function (row) {
      var k = eventCatalogMergeKey(row.name, row.department, row.month);
      var prev = oldByKey[k];
      if (prev) {
        newCat.push({
          id: prev.id,
          seq: row.seq,
          name: row.name,
          month: row.month,
          target: row.target,
          department: row.department,
          activityRecord: row.activityRecord,
        });
      } else {
        newCat.push({
          id: uid(),
          seq: row.seq,
          name: row.name,
          month: row.month,
          target: row.target,
          department: row.department,
          activityRecord: row.activityRecord,
        });
      }
    });
    state.participationEventCatalog = normalizeParticipationEventCatalog(newCat);
    var validIds = {};
    state.participationEventCatalog.forEach(function (e) {
      validIds[e.id] = true;
    });
    state.students.forEach(function (st) {
      var slots = coerceParticipationSemSlots(st.participationSemSlots, st.participationEvents);
      ["s1", "s2"].forEach(function (sem) {
        for (var i = 0; i < 5; i++) {
          var sl = slots[sem][i];
          if (sl && sl.mode === "catalog" && !validIds[sl.catalogId]) {
            var ev = oldById[sl.catalogId];
            slots[sem][i] = ev ? { mode: "manual", text: participationCatalogPickLabel(ev).slice(0, 200) } : null;
          }
        }
      });
      st.participationSemSlots = slots;
      syncStudentParticipationLegacySummary(st);
    });
    persist();
    renderAll();
    toast("행사 목록 " + state.participationEventCatalog.length + "건을 저장했습니다.");
  }

  function fillStudentIndividualElectiveDisplay(host, slots) {
    if (!host) return;
    host.textContent = "";
    var s = coerceElectiveSubjects(slots);
    var wrap = document.createElement("div");
    wrap.className = "cm-si-elective-display";
    function appendSem(semKey, title, semClass) {
      var semEl = document.createElement("div");
      semEl.className = "cm-si-elective-sem " + semClass;
      var hd = document.createElement("div");
      hd.className = "cm-si-elective-sem__hd";
      hd.textContent = title;
      var row = document.createElement("div");
      row.className = "cm-si-elective-sem__badges";
      var texts = s[semKey].map(function (t) {
        return String(t || "").trim();
      }).filter(Boolean);
      if (!texts.length) {
        var empty = document.createElement("span");
        empty.className = "cm-si-elective-empty";
        empty.textContent = "없음";
        row.appendChild(empty);
      } else {
        texts.forEach(function (text) {
          var b = document.createElement("span");
          b.className = "cm-si-elective-badge cm-si-elective-badge--" + semKey;
          b.textContent = text;
          row.appendChild(b);
        });
      }
      semEl.appendChild(hd);
      semEl.appendChild(row);
      wrap.appendChild(semEl);
    }
    appendSem("s1", "1학기", "cm-si-elective-sem--s1");
    appendSem("s2", "2학기", "cm-si-elective-sem--s2");
    host.appendChild(wrap);
  }

  function electiveSlotsFromFormPrefix(prefix) {
    var slots = emptyElectiveSlots();
    var p = prefix || "";
    ["s1", "s2"].forEach(function (sem) {
      for (var i = 0; i < 3; i++) {
        var el = document.getElementById(p + "elective_" + sem + "_" + i);
        var v = el ? String(el.value || "").trim() : "";
        if (v.length > 120) v = v.slice(0, 120);
        slots[sem][i] = v;
      }
    });
    return slots;
  }

  function fillElectiveInputs(prefix, slots) {
    var s = coerceElectiveSubjects(slots);
    var p = prefix || "";
    ["s1", "s2"].forEach(function (sem) {
      for (var i = 0; i < 3; i++) {
        var el = document.getElementById(p + "elective_" + sem + "_" + i);
        if (el) el.value = s[sem][i] || "";
      }
    });
  }

  function rosterElectiveSlotColumnsPresent(colIndex) {
    return (
      colIndex.electiveS1_0 != null ||
      colIndex.electiveS1_1 != null ||
      colIndex.electiveS1_2 != null ||
      colIndex.electiveS2_0 != null ||
      colIndex.electiveS2_1 != null ||
      colIndex.electiveS2_2 != null
    );
  }

  function rosterHeaderKey(cell) {
    var s = normExcelHeader(cell);
    if (!s) return "";
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) return s.toLowerCase();
    return s;
  }

  var ROSTER_HEADER_KEYS = {
    학번: "number",
    번호: "number",
    number: "number",
    이름: "name",
    성명: "name",
    name: "name",
    성별: "gender",
    gender: "gender",
    학생연락처: "studentPhone",
    학생전화번호: "studentPhone",
    studentphone: "studentPhone",
    학부모연락처: "guardianPhone",
    보호자연락처: "guardianPhone",
    보호자전화번호: "guardianPhone",
    guardianphone: "guardianPhone",
    진로희망: "careerInterest",
    진로관심: "careerInterest",
    careerinterest: "careerInterest",
    동아리: "clubName",
    부서명: "clubName",
    clubname: "clubName",
    동아리교실: "clubRoom",
    동아리실: "clubRoom",
    부서위치: "clubRoom",
    교실: "clubRoom",
    활동장소: "clubRoom",
    강의실: "clubRoom",
    clubroom: "clubRoom",
    담당교사: "clubTeacher",
    지도교사: "clubTeacher",
    동아리담당교사: "clubTeacher",
    clubteacher: "clubTeacher",
    "1인1역": "oneRole",
    onerole: "oneRole",
    선택과목: "electiveSubjects",
    electivesubjects: "electiveSubjects",
    "1학기과목1": "electiveS1_0",
    "1학기과목2": "electiveS1_1",
    "1학기과목3": "electiveS1_2",
    "2학기과목1": "electiveS2_0",
    "2학기과목2": "electiveS2_1",
    "2학기과목3": "electiveS2_2",
    "1학기선택과목1": "electiveS1_0",
    "1학기선택과목2": "electiveS1_1",
    "1학기선택과목3": "electiveS1_2",
    "2학기선택과목1": "electiveS2_0",
    "2학기선택과목2": "electiveS2_1",
    "2학기선택과목3": "electiveS2_2",
    "1학기선택1": "electiveS1_0",
    "1학기선택2": "electiveS1_1",
    "1학기선택3": "electiveS1_2",
    "2학기선택1": "electiveS2_0",
    "2학기선택2": "electiveS2_1",
    "2학기선택3": "electiveS2_2",
    electives1_0: "electiveS1_0",
    electives1_1: "electiveS1_1",
    electives1_2: "electiveS1_2",
    electives2_0: "electiveS2_0",
    electives2_1: "electiveS2_1",
    electives2_2: "electiveS2_2",
    시간표: "timetable",
    timetable: "timetable",
    특이사항: "specialNotes",
    specialnotes: "specialNotes",
    짧은메모: "note",
    메모: "note",
    비고: "note",
    note: "note",
    참여행사: "participationEvents",
    행사참여: "participationEvents",
    참여및행사: "participationEvents",
    participationevents: "participationEvents",
    "1학기참여1": "participationS1_0",
    "1학기참여2": "participationS1_1",
    "1학기참여3": "participationS1_2",
    "1학기참여4": "participationS1_3",
    "1학기참여5": "participationS1_4",
    "2학기참여1": "participationS2_0",
    "2학기참여2": "participationS2_1",
    "2학기참여3": "participationS2_2",
    "2학기참여4": "participationS2_3",
    "2학기참여5": "participationS2_4",
  };

  function excelCellString(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number") {
      if (isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) < 1e15) return String(Math.round(v));
      return String(v);
    }
    return String(v).trim();
  }

  function rosterRowAllEmpty(row) {
    if (!row || !row.length) return true;
    for (var i = 0; i < row.length; i++) {
      if (excelCellString(row[i])) return false;
    }
    return true;
  }

  function buildRosterColIndexFromHeaderRow(headerCells) {
    var colIndex = {};
    headerCells = headerCells || [];
    for (var c = 0; c < headerCells.length; c++) {
      var hk = rosterHeaderKey(excelCellString(headerCells[c]));
      var field = ROSTER_HEADER_KEYS[hk];
      if (field && colIndex[field] == null) colIndex[field] = c;
    }
    return colIndex;
  }

  function findRosterHeaderRowIndex(aoa, rowCheck) {
    var maxR = Math.min(aoa.length || 0, 60);
    for (var r = 0; r < maxR; r++) {
      var row = aoa[r] || [];
      if (rosterRowAllEmpty(row)) continue;
      var colIndex = buildRosterColIndexFromHeaderRow(row);
      if (rowCheck(colIndex)) return r;
    }
    return -1;
  }

  function simplifyNeisTitle(raw) {
    return excelCellString(raw)
      .replace(/-\s*\d+주차\s*\([^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseNeisStudentMetaFromTitle(shortTitle) {
    var m = String(shortTitle || "")
      .trim()
      .match(/(\d+)번\s*(.+)$/);
    if (!m) return null;
    return { num: m[1], name: m[2].trim() };
  }

  function neisTitleCellFromRow(row) {
    row = row || [];
    for (var c = 0; c < Math.min(row.length, 12); c++) {
      var t = excelCellString(row[c]);
      if (t.indexOf("학년도") >= 0 && t.indexOf("번") >= 0) return t;
    }
    return excelCellString(row[0]);
  }

  function isNeisBlockTitleRow(row) {
    var t = neisTitleCellFromRow(row);
    return t.indexOf("학년도") >= 0 && t.indexOf("번") >= 0;
  }

  function mergeNeisTwoLinesCells(a, b) {
    var x = excelCellString(a);
    var y = excelCellString(b);
    if (x && y) return x + "\n" + y;
    return x || y || "";
  }

  function parseNeisDayColumns(headerRow) {
    var out = [];
    for (var c = 0; c < headerRow.length; c++) {
      var h = excelCellString(headerRow[c]);
      var lab = "";
      if (/^월요일/.test(h)) lab = "월";
      else if (/^화요일/.test(h)) lab = "화";
      else if (/^수요일/.test(h)) lab = "수";
      else if (/^목요일/.test(h)) lab = "목";
      else if (/^금요일/.test(h)) lab = "금";
      else continue;
      out.push({ label: lab, col: c });
    }
    out.sort(function (a, b) {
      return a.col - b.col;
    });
    return out;
  }

  function parseSingleNeisBlock(aoa, startIdx) {
    var titleRaw = neisTitleCellFromRow(aoa[startIdx] || []);
    var title = simplifyNeisTitle(titleRaw);
    var meta = parseNeisStudentMetaFromTitle(title);
    if (!meta) return null;
    var hdrRowIdx = startIdx + 2;
    if (hdrRowIdx >= aoa.length) return null;
    var hdrRow = aoa[hdrRowIdx] || [];
    if (excelCellString(hdrRow[0]).indexOf("교") < 0) return null;
    var dayCols = parseNeisDayColumns(hdrRow);
    if (!dayCols.length) return null;
    var rows = [];
    for (var p = 1; p <= 7; p++) {
      var r1 = startIdx + 2 + (p - 1) * 2 + 1;
      var r2 = r1 + 1;
      if (r2 >= aoa.length) break;
      var row1 = aoa[r1] || [];
      var row2 = aoa[r2] || [];
      var period = excelCellString(row1[0]);
      var cells = dayCols.map(function (d) {
        return mergeNeisTwoLinesCells(row1[d.col], row2[d.col]);
      });
      rows.push({ period: period, cells: cells });
    }
    var nextIndex = startIdx + 1;
    for (; nextIndex < aoa.length; nextIndex++) {
      if (isNeisBlockTitleRow(aoa[nextIndex])) break;
    }
    return {
      nextIndex: nextIndex,
      title: title,
      meta: meta,
      weekdayLabels: dayCols.map(function (d) {
        return d.label;
      }),
      rows: rows,
    };
  }

  function parseAllNeisBlocks(aoa) {
    var blocks = [];
    var i = 0;
    while (i < aoa.length) {
      if (!isNeisBlockTitleRow(aoa[i])) {
        i++;
        continue;
      }
      var b = parseSingleNeisBlock(aoa, i);
      if (!b) {
        i++;
        continue;
      }
      blocks.push(b);
      i = b.nextIndex;
    }
    return blocks;
  }

  function normalizeNeisPersonName(n) {
    return String(n || "")
      .trim()
      .replace(/[\s\u00a0\u3000]+/g, " ");
  }

  function findStudentByNeisMeta(meta) {
    if (!meta) return null;
    var want = String(meta.num).trim();
    for (var k = 0; k < state.students.length; k++) {
      if (String(state.students[k].number || "").trim() === want) return state.students[k];
    }
    var n = parseInt(want, 10);
    if (!isNaN(n)) {
      for (var j = 0; j < state.students.length; j++) {
        var sn = parseInt(String(state.students[j].number || "").trim(), 10);
        if (!isNaN(sn) && sn === n) return state.students[j];
      }
    }
    /* NEIS 제목의 「N번」은 출석번호인 경우가 많고, 명단 학번은 10자리 등이라 숫자가 안 맞을 수 있음 → 이름이 유일하면 이름으로 연결 */
    var targetName = normalizeNeisPersonName(meta.name);
    if (targetName) {
      var hits = [];
      for (var i = 0; i < state.students.length; i++) {
        if (normalizeNeisPersonName(state.students[i].name) === targetName) hits.push(state.students[i]);
      }
      if (hits.length === 1) return hits[0];
    }
    return null;
  }

  function semesterKeyFromNeisTitle(title) {
    var t = String(title || "");
    var m = t.match(/학년도\s*(\d)\s*학기/);
    if (m && m[1] === "2") return "s2";
    return "s1";
  }

  function isNeisSportsTimetableLine(line) {
    return /스포츠\s*생활|스포츠\s*생활/i.test(String(line || ""));
  }

  function isNeisCommonClassPlaceholderLine(line) {
    return /^\d+학년\s*\d+반$/.test(String(line || "").trim());
  }

  function extractElectiveNamesFromNeisBlock(block) {
    var byLetter = {};
    if (!block || !block.rows) return [];
    block.rows.forEach(function (row) {
      (row.cells || []).forEach(function (cell) {
        String(cell || "")
          .split(/\r\n|\n/)
          .forEach(function (raw) {
            var line = String(raw || "").trim();
            if (!line || isNeisCommonClassPlaceholderLine(line)) return;
            if (isNeisSportsTimetableLine(line)) return;
            var m = line.match(/^(.+?)\s*([ABCD])(\d*)(?:\s*\([^)]*\))?\s*$/);
            if (!m) return;
            var base = m[1].replace(/\s+/g, " ").trim();
            if (!base || isNeisSportsTimetableLine(base)) return;
            var L = m[2];
            if (byLetter[L] == null) byLetter[L] = base;
          });
      });
    });
    var names = ["A", "B", "C", "D"]
      .map(function (L) {
        return byLetter[L];
      })
      .filter(function (n) {
        return n && !isNeisSportsTimetableLine(n);
      });
    return names.slice(0, 3);
  }

  function applyElectivesFromNeisTimetableBlock(st, block, semOverride) {
    if (!st || !block) return false;
    var names = extractElectiveNamesFromNeisBlock(block);
    if (!names.length) return false;
    var sem = semOverride != null ? semOverride : semesterKeyFromNeisTitle(block.title || "");
    if (sem !== "s2") sem = "s1";
    var slots = coerceElectiveSubjects(st.electiveSubjects);
    for (var i = 0; i < 3; i++) {
      slots[sem][i] = names[i] ? String(names[i]).trim().slice(0, 120) : "";
    }
    st.electiveSubjects = slots;
    return true;
  }

  function importNeisTimetableBuffer(buf, optForceSem) {
    if (typeof XLSX === "undefined") {
      toast("엑셀 라이브러리가 없습니다.");
      return;
    }
    var wb = XLSX.read(buf, { type: "array" });
    var sn0 = wb.SheetNames[0];
    if (!sn0) {
      toast("시트가 없습니다.");
      return;
    }
    var ws = wb.Sheets[sn0];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    var blocks = parseAllNeisBlocks(aoa);
    if (!blocks.length) {
      toast("NEIS 학생별 시간표 형식을 찾지 못했습니다.");
      return;
    }
    var nOk = 0;
    var nElective = 0;
    var miss = [];
    blocks.forEach(function (b) {
      var st = findStudentByNeisMeta(b.meta);
      if (st) {
        var ttPayload = { title: b.title, weekdayLabels: b.weekdayLabels, rows: b.rows };
        var ttSem =
          optForceSem === "s1" || optForceSem === "s2"
            ? optForceSem
            : semesterKeyFromNeisTitle(b.title || "");
        if (ttSem !== "s2") ttSem = "s1";
        if (ttSem === "s2") st.neisTimetableS2 = ttPayload;
        else st.neisTimetableS1 = ttPayload;
        if (applyElectivesFromNeisTimetableBlock(st, b, ttSem)) nElective++;
        nOk++;
      } else {
        miss.push(b.meta.num + "번 " + b.meta.name);
      }
    });
    persist();
    renderAll();
    var tail = "";
    if (miss.length) {
      tail = " 미매칭 " + miss.length + "명: " + miss.slice(0, 4).join(", ");
      if (miss.length > 4) tail += "…";
    }
    var elTail = nElective ? " 선택과목 자동 반영 " + nElective + "명." : "";
    toast("NEIS 시간표: " + nOk + "명 반영." + elTail + tail);
  }

  function exportRosterExcel() {
    if (typeof XLSX === "undefined") {
      toast("엑셀 기능을 불러오지 못했습니다. 인터넷 연결 후 새로고침 해 주세요.");
      return;
    }
    var headers = ["번호", "이름", "성별", "학생 연락처", "학부모 연락처", "진로 희망", "1인 1역"];
    var list = state.students.slice().sort(function (a, b) {
      var ka = numberSortKey(a.number);
      var kb = numberSortKey(b.number);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return String(ka[2]).localeCompare(String(kb[2]));
    });
    var rows = list.map(function (s) {
      var g = s.gender;
      var gOut = g === "M" ? "남" : g === "F" ? "여" : g === "O" ? "기타" : "";
      return [
        excelCellString(s.number),
        excelCellString(s.name),
        gOut,
        excelCellString(s.studentPhone),
        excelCellString(s.guardianPhone),
        excelCellString(s.careerInterest),
        excelCellString(s.oneRole),
      ];
    });
    var aoa = [headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 24 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "명단");
    var fname = "classmanager_명단_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    XLSX.writeFile(wb, fname);
    toast("엑셀 파일을 내려받았습니다.");
  }

  function importRosterExcelBuffer(buf) {
    if (typeof XLSX === "undefined") {
      toast("엑셀 라이브러리가 없습니다.");
      return;
    }
    var wb = XLSX.read(buf, { type: "array" });
    var name0 = wb.SheetNames[0];
    if (!name0) {
      toast("시트가 없습니다.");
      return;
    }
    var ws = wb.Sheets[name0];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (!aoa.length) {
      toast("데이터가 없습니다.");
      return;
    }
    var headerRow = findRosterHeaderRowIndex(aoa, function (ci) {
      return ci.name != null;
    });
    if (headerRow < 0) {
      toast("「이름」또는「성명」이 있는 헤더 행을 찾지 못했습니다. NEIS 명렬표는 상단 안내 행이 있어도 자동으로 찾습니다.");
      return;
    }
    var headerCells = aoa[headerRow] || [];
    var colIndex = buildRosterColIndexFromHeaderRow(headerCells);
    var added = 0;
    var updated = 0;
    var skipped = 0;
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r];
      if (rosterRowAllEmpty(row)) continue;
      function getf(field) {
        var i = colIndex[field];
        if (i == null || i < 0) return "";
        return excelCellString(row[i]);
      }
      var slotCols = rosterElectiveSlotColumnsPresent(colIndex);
      var legacyElectiveCol = colIndex.electiveSubjects != null;
      var partialSlots = null;
      if (slotCols) {
        partialSlots = emptyElectiveSlots();
        partialSlots.s1[0] = getf("electiveS1_0");
        partialSlots.s1[1] = getf("electiveS1_1");
        partialSlots.s1[2] = getf("electiveS1_2");
        partialSlots.s2[0] = getf("electiveS2_0");
        partialSlots.s2[1] = getf("electiveS2_1");
        partialSlots.s2[2] = getf("electiveS2_2");
        partialSlots = coerceElectiveSubjects(partialSlots);
      } else if (legacyElectiveCol) {
        partialSlots = coerceElectiveSubjects(getf("electiveSubjects"));
      }
      var slotColsP = rosterParticipationSlotColumnsPresent(colIndex);
      var partialPeSlots = null;
      if (slotColsP) {
        partialPeSlots = emptyParticipationSemSlots();
        var catalogImp = state.participationEventCatalog || [];
        for (var psi = 0; psi < 5; psi++) {
          partialPeSlots.s1[psi] = matchImportTextToParticipationSlot(getf("participationS1_" + psi), catalogImp);
          partialPeSlots.s2[psi] = matchImportTextToParticipationSlot(getf("participationS2_" + psi), catalogImp);
        }
      }
      var name = getf("name");
      if (!name) {
        skipped++;
        continue;
      }
      var partial = {
        number: getf("number"),
        name: name,
        gender: parseGenderImport(getf("gender")),
        studentPhone: getf("studentPhone"),
        guardianPhone: getf("guardianPhone"),
        careerInterest: getf("careerInterest"),
        clubName: getf("clubName"),
        clubRoom: getf("clubRoom"),
        clubTeacher: getf("clubTeacher"),
        oneRole: getf("oneRole"),
        timetable: getf("timetable"),
        specialNotes: getf("specialNotes"),
        note: getf("note"),
        participationEvents: getf("participationEvents"),
      };
      var numKey = partial.number.trim();
      var existing = null;
      if (numKey) {
        for (var j = 0; j < state.students.length; j++) {
          if (String(state.students[j].number || "").trim() === numKey) {
            existing = state.students[j];
            break;
          }
        }
      }
      if (existing) {
        existing.number = partial.number;
        existing.name = partial.name;
        existing.gender = partial.gender;
        existing.studentPhone = partial.studentPhone;
        existing.guardianPhone = partial.guardianPhone;
        existing.careerInterest = partial.careerInterest;
        existing.clubName = partial.clubName;
        existing.clubRoom = partial.clubRoom;
        existing.clubTeacher = partial.clubTeacher;
        existing.oneRole = partial.oneRole;
        if (partialSlots != null) existing.electiveSubjects = partialSlots;
        existing.timetable = partial.timetable;
        existing.specialNotes = partial.specialNotes;
        existing.note = partial.note;
        existing.participationSemSlots = slotColsP
          ? partialPeSlots
          : coerceParticipationSemSlots(null, partial.participationEvents);
        syncStudentParticipationLegacySummary(existing);
        updated++;
      } else {
        var peSlotsNew = slotColsP
          ? partialPeSlots
          : coerceParticipationSemSlots(null, partial.participationEvents);
        var peSummaryNew = participationSemSlotsToLegacySummary(peSlotsNew, state.participationEventCatalog || []);
        state.students.push({
          id: uid(),
          number: partial.number,
          name: partial.name,
          gender: partial.gender,
          studentPhone: partial.studentPhone,
          guardianPhone: partial.guardianPhone,
          careerInterest: partial.careerInterest,
          clubName: partial.clubName,
          clubRoom: partial.clubRoom,
          clubTeacher: partial.clubTeacher,
          specialNotes: partial.specialNotes,
          note: partial.note,
          oneRole: partial.oneRole,
          electiveSubjects: partialSlots != null ? partialSlots : emptyElectiveSlots(),
          timetable: partial.timetable,
          neisTimetable: null,
          neisTimetableS1: null,
          neisTimetableS2: null,
          participationSemSlots: peSlotsNew,
          participationEvents: peSummaryNew,
          autonomousActivities: [],
          careerActivities: [],
          siInputClosedVolunteer: false,
          siInputClosedAutonomous: false,
          siInputClosedCareer: false,
          siInputClosedEval: false,
        });
        added++;
      }
    }
    persist();
    renderAll();
    var tail = skipped ? " 이름 없는 행 " + skipped + "개는 건너뜀." : "";
    toast("엑셀 반영: " + added + "명 추가, " + updated + "명 수정." + tail);
  }

  function importClubExcelBuffer(buf) {
    if (typeof XLSX === "undefined") {
      toast("엑셀 라이브러리가 없습니다.");
      return;
    }
    var wb = XLSX.read(buf, { type: "array" });
    var name0 = wb.SheetNames[0];
    if (!name0) {
      toast("시트가 없습니다.");
      return;
    }
    var ws = wb.Sheets[name0];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (!aoa.length) {
      toast("데이터가 없습니다.");
      return;
    }
    var headerRow = findRosterHeaderRowIndex(aoa, function (ci) {
      return ci.clubName != null && (ci.number != null || ci.name != null);
    });
    if (headerRow < 0) {
      toast(
        "「동아리」또는「부서명」과 학생 열(학번·번호·이름·성명)이 있는 헤더 행을 찾지 못했습니다. NEIS 동아리 부서배정 조회 파일도 지원합니다."
      );
      return;
    }
    var headerCells = aoa[headerRow] || [];
    var colIndex = buildRosterColIndexFromHeaderRow(headerCells);
    var updated = 0;
    var skipped = 0;
    var miss = 0;
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r];
      if (rosterRowAllEmpty(row)) continue;
      function getf(field) {
        var i = colIndex[field];
        if (i == null || i < 0) return "";
        return excelCellString(row[i]);
      }
      var club = getf("clubName").trim();
      if (!club) {
        skipped++;
        continue;
      }
      var numKey = colIndex.number != null ? getf("number").trim() : "";
      var nameKey = colIndex.name != null ? getf("name").trim() : "";
      if (!numKey && !nameKey) {
        skipped++;
        continue;
      }
      var st = null;
      if (numKey) {
        for (var j = 0; j < state.students.length; j++) {
          if (String(state.students[j].number || "").trim() === numKey) {
            st = state.students[j];
            break;
          }
        }
      }
      if (!st && nameKey) {
        var hits = [];
        for (var k = 0; k < state.students.length; k++) {
          if (String(state.students[k].name || "").trim() === nameKey) hits.push(state.students[k]);
        }
        if (hits.length === 1) st = hits[0];
      }
      if (!st) {
        miss++;
        continue;
      }
      st.clubName = club;
      st.clubRoom = getf("clubRoom").trim();
      st.clubTeacher = getf("clubTeacher").trim();
      updated++;
    }
    persist();
    renderAll();
    toast("동아리 반영: " + updated + "명 수정." + (miss ? " 미매칭 " + miss + "행." : "") + (skipped ? " 빈 행 " + skipped + "개 건너뜀." : ""));
  }

  function formatTs(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return (
      d.getFullYear() +
      "." +
      String(d.getMonth() + 1).padStart(2, "0") +
      "." +
      String(d.getDate()).padStart(2, "0") +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function displayHomeroomLine() {
    var h = state.homeroom;
    var parts = [];
    if (h.schoolName) parts.push(h.schoolName);
    if (h.grade || h.className) parts.push([h.grade, h.className].filter(Boolean).join("학년 ") + (h.className ? "반" : ""));
    if (h.teacherName) parts.push(h.teacherName + " 선생님");
    return parts.length ? parts.join(" · ") : "학급 정보는 관리실에서 입력해 주세요.";
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("cmToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  function closeAllModals() {
    closeCalendarEventPopover();
    document.querySelectorAll(".modal-root").forEach(function (m) {
      m.setAttribute("hidden", "");
    });
    document.body.classList.remove("modal-open");
  }

  function openModal(id) {
    closeAllModals();
    var m = document.getElementById(id);
    if (m) {
      m.removeAttribute("hidden");
      document.body.classList.add("modal-open");
    }
  }

  function isAnyModalOpen() {
    return !!document.querySelector(".modal-root:not([hidden])");
  }

  var els = {};

  function cacheEls() {
    els.tabs = document.querySelectorAll(".tab[data-tab-target]");
    els.panels = document.querySelectorAll(".tab-panel[data-tab-panel]");
    els.panelHome = document.getElementById("panel-home");
    els.rosterForm = document.getElementById("rosterForm");
    els.rosterBody = document.getElementById("rosterTableBody");
    els.rosterEmpty = document.getElementById("rosterEmpty");
    els.btnRosterExportExcel = document.getElementById("btnRosterExportExcel");
    els.btnRosterImportExcel = document.getElementById("btnRosterImportExcel");
    els.rosterExcelImport = document.getElementById("rosterExcelImport");
    els.studentIndividualListView = document.getElementById("studentIndividualListView");
    els.studentIndividualDetailView = document.getElementById("studentIndividualDetailView");
    els.studentIndividualButtonHost = document.getElementById("studentIndividualButtonHost");
    els.studentIndividualEmpty = document.getElementById("studentIndividualEmpty");
    els.studentIndividualDetailHost = document.getElementById("studentIndividualDetailHost");
    els.counselListView = document.getElementById("counselListView");
    els.counselDetailView = document.getElementById("counselDetailView");
    els.counselStudentPickHost = document.getElementById("counselStudentPickHost");
    els.counselStudentEmpty = document.getElementById("counselStudentEmpty");
    els.counselDetailHost = document.getElementById("counselDetailHost");
    els.neisTimetableImportS1 = document.getElementById("neisTimetableImportS1");
    els.neisTimetableImportS2 = document.getElementById("neisTimetableImportS2");
    els.openAddStudentModal = document.getElementById("openAddStudentModal");
    els.addStudentModal = document.getElementById("addStudentModal");
    els.closeAddStudentModal = document.getElementById("closeAddStudentModal");
    els.cancelAddStudentModal = document.getElementById("cancelAddStudentModal");
    els.modalStudentName = document.getElementById("modalStudentName");
    els.homeroomBasicForm = document.getElementById("homeroomBasicForm");
    els.classGridTimetableHost = document.getElementById("classGridTimetableHost");
    els.teacherGridTimetableHost = document.getElementById("teacherGridTimetableHost");
    els.btnSaveGridTimetables = document.getElementById("btnSaveGridTimetables");
    els.neisClubImport = document.getElementById("neisClubImport");
    els.setSchool = document.getElementById("setSchool");
    els.setGrade = document.getElementById("setGrade");
    els.setClassNum = document.getElementById("setClassNum");
    els.setTeacher = document.getElementById("setTeacher");
    els.btnExportJson = document.getElementById("btnExportJson");
    els.importJsonFile = document.getElementById("importJsonFile");
    els.btnOpenResetModal = document.getElementById("btnOpenResetModal");
    els.resetAllModal = document.getElementById("resetAllModal");
    els.closeResetModal = document.getElementById("closeResetModal");
    els.cancelResetModal = document.getElementById("cancelResetModal");
    els.confirmResetModal = document.getElementById("confirmResetModal");
    els.calEvBackdrop = document.getElementById("calEvBackdrop");
    els.calEvPopover = document.getElementById("calEvPopover");
    els.calEvForm = document.getElementById("calEvForm");
    els.calEvCancel = document.getElementById("calEvCancel");
    els.calEvDelete = document.getElementById("calEvDelete");
    els.studentDetailModal = document.getElementById("studentDetailModal");
    els.detailForm = document.getElementById("detailStudentForm");
    els.detailStudentId = document.getElementById("detailStudentId");
    els.closeDetailModal = document.getElementById("closeDetailModal");
    els.cancelDetailModal = document.getElementById("cancelDetailModal");
    els.detailDeleteStudent = document.getElementById("detailDeleteStudent");
    els.counselEditModal = document.getElementById("counselEditModal");
    els.counselEditForm = document.getElementById("counselEditForm");
    els.ceditId = document.getElementById("ceditId");
    els.ceditDate = document.getElementById("ceditDate");
    els.ceditTopics = document.getElementById("ceditTopics");
    els.ceditBody = document.getElementById("ceditBody");
    els.closeCounselEditModal = document.getElementById("closeCounselEditModal");
    els.cancelCounselEdit = document.getElementById("cancelCounselEdit");
    els.pfStudentListHost = document.getElementById("pfStudentListHost");
    els.pfStudentRowsHost = document.getElementById("pfStudentRowsHost");
    els.pfSelectAllCb = document.getElementById("pfSelectAllCb");
    els.btnPortfolioPdf = document.getElementById("btnPortfolioPdf");
    els.pfIncAutonomous = document.getElementById("pfIncAutonomous");
    els.pfIncCareer = document.getElementById("pfIncCareer");
    els.pfIncCounsel = document.getElementById("pfIncCounsel");
    els.pfIncVol = document.getElementById("pfIncVol");
    els.pfIncEval = document.getElementById("pfIncEval");
  }

  var reopenTabAfterReset = null;

  function rosterStudentsSortedByNumber() {
    var list = state.students.slice();
    list.sort(function (a, b) {
      var ka = numberSortKey(a.number);
      var kb = numberSortKey(b.number);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return String(ka[2]).localeCompare(String(kb[2]));
    });
    return list;
  }

  var PORTFOLIO_AI_PROMPT =
    "첨부된 PDF 파일은 한 학생의 학교 활동 포트폴리오입니다.\n\n" +
    "당신은 대한민국 고등학교 담임교사이며,\n" +
    "학교생활기록부 작성 경험이 풍부한 교사의 관점으로 문장을 작성하세요.\n\n" +
    "단순 요약이 아니라,\n" +
    "학생의 활동 흐름·관심 분야·진로 방향성을 분석하여\n" +
    "실제 학교생활기록부 문체로 작성해야 합니다.\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[1단계 : 학생 진로 방향 우선 분석]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "가장 먼저 PDF 전체 내용을 분석하여,\n" +
    "학생의 진로 관심 분야를 먼저 파악하세요.\n\n" +
    "다음 요소를 우선적으로 종합 분석할 것:\n\n" +
    "* 선택과목\n" +
    "* 자율활동\n" +
    "* 진로활동\n" +
    "* 동아리\n" +
    "* 탐구 주제\n" +
    "* 상담 내용\n" +
    "* 발표 내용\n" +
    "* 반복적으로 등장하는 관심 키워드\n\n" +
    "그 후 아래 형식으로 먼저 출력:\n\n" +
    "[학생 진로 방향 분석]\n\n" +
    "* 예상 진로 분야:\n" +
    "* 핵심 관심 키워드:\n" +
    "* 반복적으로 드러나는 활동 특성:\n" +
    "* 활동 전반에서 나타나는 강점:\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[2단계 : 활동 해석]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "학생 활동을 단순 나열하지 말고,\n" +
    "학생의 진로 방향성과 연결하여 해석할 것.\n\n" +
    "예시:\n\n" +
    "* 공학 계열 → 문제 해결·분석·설계 중심 해석\n" +
    "* 교육 계열 → 협업·설명·소통 중심 해석\n" +
    "* 사회 계열 → 자료 분석·사회 현상 이해 중심 해석\n" +
    "* 보건 계열 → 공감·책임·생명 존중 중심 해석\n\n" +
    "즉,\n" +
    "같은 활동이라도 학생의 관심 분야에 맞게 의미를 재구성할 것.\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[3단계 : 생활기록부 작성]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "다음 원칙을 반드시 지킬 것.\n\n" +
    "1. 실제 학교생활기록부 문체 유지\n\n" +
    "* 객관적 서술 중심\n" +
    "* 교사 관찰 느낌 유지\n" +
    "* 과장 금지\n" +
    "* 미사여구 최소화\n\n" +
    "2. AI가 작성한 티가 나지 않아야 함\n\n" +
    "* 지나치게 완벽한 문장 구조 금지\n" +
    "* GPT식 표현 반복 금지\n" +
    "* “창의적 사고를 바탕으로”, “주도적으로 참여함” 같은 표현 남발 금지\n" +
    "* 실제 담임교사가 직접 관찰 후 기록한 느낌 유지\n\n" +
    "3. 단순 칭찬 금지\n\n" +
    "* “성실함”, “책임감 있음” 같은 단어 반복 금지\n" +
    "* 반드시 활동 근거 기반으로 작성\n\n" +
    "4. 활동 → 과정 → 행동 → 성장 흐름이 드러나야 함\n\n" +
    "5. 제공된 자료 밖의 내용을 절대 추론하지 말 것\n\n" +
    "6. 학생마다 표현 방식이 달라야 함\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[글자 수 원칙]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "* 자율활동: 500자 내외\n" +
    "* 진로활동: 500자 내외\n" +
    "* 행동특성 및 종합의견: 300자 내외\n\n" +
    "너무 짧거나 과도하게 길어지지 않도록 조절할 것.\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[출력 형식]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "[자율활동]\n" +
    "(500자 내외)\n\n" +
    "[근거]\n\n" +
    "* 사용한 활동:\n" +
    "* 반영한 학생 특징:\n" +
    "* 연결한 진로 요소:\n\n" +
    "---\n\n" +
    "[진로활동]\n" +
    "(500자 내외)\n\n" +
    "[근거]\n\n" +
    "* 사용한 활동:\n" +
    "* 반영한 학생 특징:\n" +
    "* 연결한 진로 요소:\n\n" +
    "---\n\n" +
    "[행동특성 및 종합의견]\n" +
    "(300자 내외)\n\n" +
    "[근거]\n\n" +
    "* 핵심 근거 활동:\n" +
    "* 반복적으로 반영한 학생 특징:\n" +
    "* 학생 성장 흐름:\n" +
    "* 진로 연계 포인트:\n\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    "[매우 중요한 추가 지시]\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    "* 실제 학교생활기록부처럼 작성할 것\n" +
    "* 문장 구조 반복 최소화\n" +
    "* 같은 단어 반복 최소화\n" +
    "* 활동 간 연결성을 분석할 것\n" +
    "* 학생만의 특징이 드러나게 작성할 것\n" +
    "* “잘 쓴 AI 글”보다 “실제 담임교사의 기록”처럼 보이는 것이 가장 중요함\n" +
    "* 결과물은 바로 학교생활기록부에 참고 및 수정 활용 가능한 수준으로 작성할 것\n\n" +
    "이제 PDF 파일을 분석하여 작성하세요.";

  function openPortfolioAiPromptModal() {
    var pre = document.getElementById("portfolioAiPromptText");
    if (pre) pre.textContent = PORTFOLIO_AI_PROMPT;
    openModal("portfolioAiPromptModal");
  }

  function copyPortfolioAiPrompt() {
    var text = PORTFOLIO_AI_PROMPT;
    function done(ok) {
      toast(ok ? "프롬프트를 복사했습니다." : "복사에 실패했습니다. 프롬프트 영역에서 직접 선택해 복사해 주세요.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          done(true);
        })
        .catch(function () {
          copyPortfolioAiPromptFallback(done);
        });
      return;
    }
    copyPortfolioAiPromptFallback(done);
  }

  function copyPortfolioAiPromptFallback(done) {
    var ta = document.createElement("textarea");
    ta.value = PORTFOLIO_AI_PROMPT;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    done(ok);
  }

  function portfolioCoverTitleText(s) {
    if (!s) return "포트폴리오";
    var num = String(s.number != null ? s.number : "").trim();
    var nm = String(s.name || "").trim() || "학생";
    return (num ? num + "번 " : "") + nm + " 포트폴리오";
  }

  /** PDF 페이지 경계에서 글자가 잘리지 않도록 한 줄 단위 DOM으로 출력 */
  function portfolioLineHtml(line, extraClass) {
    var cls = "pf-line" + (extraClass ? " " + extraClass : "");
    var t = String(line != null ? line : "");
    return '<div class="' + cls + '">' + (t ? escapeHtml(t) : "&#8203;") + "</div>";
  }

  function portfolioLinesFromText(text, lineClass) {
    var raw = String(text != null ? text : "");
    if (!raw.trim()) return portfolioLineHtml("—", lineClass);
    return raw
      .split(/\r?\n/)
      .map(function (ln) {
        return portfolioLineHtml(ln, lineClass);
      })
      .join("");
  }

  function portfolioMultilineBlocksHtml(text) {
    var raw = String(text != null ? text : "").trim();
    if (!raw) {
      return '<div class="pf-block"><div class="pf-line">—</div></div>';
    }
    return raw
      .split(/\n\s*\n/)
      .map(function (para) {
        return '<div class="pf-block">' + portfolioLinesFromText(para) + "</div>";
      })
      .join("");
  }

  function portfolioLabeledLinesHtml(label, text) {
    var body = String(text != null ? text : "").trim();
    if (!body) return "";
    var out = portfolioLineHtml(label, "pf-line--label");
    out += portfolioLinesFromText(body);
    return out;
  }

  /** 포트폴리오 PDF 첫 페이지에 항상 넣는 기본 프로필(학급 설정 + 학생 기본 필드) */
  function buildPortfolioProfileHtml(s) {
    var h = state.homeroom || {};
    var school = String(h.schoolName != null ? h.schoolName : "").trim();
    var gradeRaw = String(h.grade != null ? h.grade : "").trim();
    var classRaw = String(h.className != null ? h.className : "").trim();
    var gradeDisp = gradeRaw ? (/학년$/.test(gradeRaw) ? gradeRaw : gradeRaw + "학년") : "";
    var classDisp = classRaw ? (/반$/.test(classRaw) ? classRaw : classRaw + "반") : "";
    var num = String(s.number != null ? s.number : "").trim();
    var nm = String(s.name != null ? s.name : "").trim();
    var career = String(s.careerInterest != null ? s.careerInterest : "").trim();
    var oneRole = String(s.oneRole != null ? s.oneRole : "").trim();
    function row(label, val) {
      var v = (val || "").trim();
      return (
        '<div class="pf-profile-row">' +
        '<div class="pf-profile-row__label">' +
        escapeHtml(label) +
        '</div><div class="pf-profile-row__value">' +
        escapeHtml(v || "—") +
        "</div></div>"
      );
    }
    var parts = [];
    parts.push('<section class="pf-sec pf-sec--profile">');
    parts.push('<div class="pf-sec-title">기본 프로필</div>');
    parts.push('<div class="pf-profile-grid">');
    parts.push(row("학교", school));
    parts.push(row("학년", gradeDisp));
    parts.push(row("반", classDisp));
    parts.push(row("번호", num));
    parts.push(row("이름", nm));
    parts.push(row("진로희망", career));
    parts.push(row("1인 1역", oneRole));
    parts.push("</div></section>");
    return parts.join("");
  }

  function buildPortfolioActivitySectionHtml(title, arr, legacySingle) {
    var list = normalizeStudentActivityList(arr, legacySingle);
    var sec = ['<section class="pf-sec"><div class="pf-sec-title">' + escapeHtml(title) + "</div>"];
    if (!list.length) {
      sec.push('<div class="pf-block"><div class="pf-line">없음</div></div>');
    } else {
      list.forEach(function (e, idx) {
        sec.push('<div class="pf-block pf-block--activity">');
        sec.push(
          portfolioLineHtml("〔활동 " + (idx + 1) + "〕 " + (e.name ? e.name : "(제목 없음)"), "pf-line--head")
        );
        sec.push(portfolioLabeledLinesHtml("내용:", e.content));
        sec.push(portfolioLabeledLinesHtml("학생 반성:", e.studentReflection));
        sec.push(portfolioLabeledLinesHtml("교사 관찰:", e.teacherObservation));
        sec.push("</div>");
      });
    }
    sec.push("</section>");
    return sec.join("");
  }

  function buildPortfolioEvalDetailHtml(sid) {
    var ev = getEval(sid);
    var parts = ['<section class="pf-sec pf-sec--eval"><div class="pf-sec-title">학생 총평</div>'];
    EVAL_AREA_SPECS.forEach(function (spec, a) {
      var ar = ev.areas[a] || { scores: [], note: "" };
      parts.push('<div class="pf-eval-area">');
      parts.push('<div class="pf-eval-area-title">' + escapeHtml(spec.title) + "</div>");
      spec.questions.forEach(function (qtext, q) {
        var sc = ar.scores[q];
        parts.push('<div class="pf-eval-q">');
        parts.push('<div class="pf-eval-qhead">' + escapeHtml("문항 " + (q + 1)) + "</div>");
        parts.push('<div class="pf-eval-qtext">' + portfolioLinesFromText(qtext) + "</div>");
        parts.push(
          '<div class="pf-eval-score">' +
            escapeHtml(sc != null ? "점수: " + sc + "점" : "점수: — (미선택)") +
            "</div>"
        );
        parts.push("</div>");
      });
      var note = (ar.note || "").trim();
      parts.push('<div class="pf-eval-area-note-label">영역별 추가 기록</div>');
      parts.push('<div class="pf-eval-area-note">' + portfolioLinesFromText(note || "—") + "</div>");
      parts.push("</div>");
    });
    var overall = (ev.overall || "").trim();
    parts.push('<div class="pf-eval-overall">');
    parts.push('<div class="pf-eval-overall-title">종합 의견</div>');
    parts.push('<div class="pf-eval-overall-body">' + portfolioLinesFromText(overall || "—") + "</div>");
    parts.push("</div></section>");
    return parts.join("");
  }

  function buildPortfolioHtml(sid) {
    var s = studentById(sid);
    if (!s) return '<div class="pf-block"><div class="pf-line">학생을 찾을 수 없습니다.</div></div>';
    function H(inp) {
      return inp && inp.checked;
    }
    var titleLine = portfolioCoverTitleText(s);
    var head =
      '<h2 class="pf-doc-title">' +
      escapeHtml(titleLine) +
      '</h2><p class="pf-meta">' +
      escapeHtml(new Date().toLocaleString("ko-KR")) +
      "</p>";
    var profileHtml = buildPortfolioProfileHtml(s);
    var pages = [];
    function addSectionPage(innerHtml) {
      if (!pages.length) {
        pages.push('<div class="pf-page pf-page--cover">' + head + profileHtml + innerHtml + "</div>");
      } else {
        pages.push('<div class="pf-page pf-page--break">' + innerHtml + "</div>");
      }
    }
    if (H(els.pfIncAutonomous)) {
      addSectionPage(buildPortfolioActivitySectionHtml("자율활동", s.autonomousActivities, s.autonomousActivity));
    }
    if (H(els.pfIncCareer)) {
      addSectionPage(buildPortfolioActivitySectionHtml("진로활동", s.careerActivities, s.careerActivity));
    }
    if (H(els.pfIncCounsel)) {
      var csec = ['<section class="pf-sec"><div class="pf-sec-title">상담 기록</div>'];
      if (!isCounselViewUnlocked()) {
        csec.push(
          '<div class="pf-block"><div class="pf-line">상담 기록은 상담관리 탭 또는 학생 개별 관리에서 비밀번호를 입력한 뒤에만 요약에 포함됩니다.</div></div>'
        );
      } else {
        var cs = state.counselings
          .filter(function (c) {
            return c.studentId === sid;
          })
          .sort(function (a, b) {
            return String(a.createdAt).localeCompare(String(b.createdAt));
          });
        if (!cs.length) csec.push('<div class="pf-block"><div class="pf-line">없음</div></div>');
        else {
          cs.forEach(function (c) {
            var chead = (c.counselingDate ? c.counselingDate + " · " : "") + formatTs(c.createdAt);
            if ((c.topics || "").trim()) chead += " · 주제: " + c.topics;
            csec.push('<div class="pf-block pf-block--counsel">');
            csec.push('<div class="pf-line pf-line--head"><strong>' + escapeHtml(chead) + "</strong></div>");
            csec.push(portfolioLinesFromText(c.body || ""));
            csec.push("</div>");
          });
        }
      }
      csec.push("</section>");
      addSectionPage(csec.join(""));
    }
    if (H(els.pfIncVol)) {
      var vsec = ['<section class="pf-sec"><div class="pf-sec-title">봉사활동</div>'];
      var vs = state.volunteers
        .filter(function (v) {
          return v.studentId === sid;
        })
        .sort(function (a, b) {
          return String(a.createdAt).localeCompare(String(b.createdAt));
        });
      if (!vs.length) vsec.push('<div class="pf-block"><div class="pf-line">없음</div></div>');
      else {
        vs.forEach(function (v) {
          var line =
            (v.semester === "2" ? "2학기" : "1학기") +
            " · " +
            v.activityName +
            " · " +
            String(v.hours) +
            "시간 · " +
            formatTs(v.createdAt);
          vsec.push('<div class="pf-block"><div class="pf-line">' + escapeHtml(line) + "</div></div>");
        });
      }
      vsec.push("</section>");
      addSectionPage(vsec.join(""));
    }
    if (H(els.pfIncEval)) {
      addSectionPage(buildPortfolioEvalDetailHtml(sid));
    }
    if (!pages.length) {
      return (
        '<div class="pf-doc"><div class="pf-page pf-page--cover">' +
        head +
        profileHtml +
        '<div class="pf-block"><div class="pf-line">포트폴리오에 포함할 영역을 하나 이상 선택하세요.</div></div></div></div>'
      );
    }
    return '<div class="pf-doc">' + pages.join("") + "</div>";
  }

  function getPortfolioExportCss() {
    return (
      "body{margin:0;padding:0;background:#fff;color:#1c1c1e;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.62;}" +
      ".pf-doc{max-width:100%;margin:0;}" +
      ".pf-page{box-sizing:border-box;}" +
      ".pf-page--break{page-break-before:always;padding-top:0;margin-top:0;border:0;}" +
      ".pf-doc-title{margin:0 0 6px;font-size:1.35rem;font-weight:800;letter-spacing:-0.02em;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-meta{margin:0 0 14px;font-size:0.88rem;color:#6a6a72;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-sec{margin-top:12px;}" +
      ".pf-page--cover .pf-sec--profile{margin-top:0;}" +
      ".pf-page--cover .pf-sec--profile + .pf-sec{margin-top:14px;}" +
      ".pf-profile-grid{margin:4px 0 0;font-size:0.93rem;line-height:1.5;}" +
      ".pf-profile-row{display:grid;grid-template-columns:6.75rem 1fr;column-gap:16px;margin-bottom:8px;page-break-inside:avoid;break-inside:avoid-page;}" +
      ".pf-profile-row__label{margin:0;color:#6a6a72;font-weight:700;}" +
      ".pf-profile-row__value{margin:0;word-break:break-word;color:#1c1c1e;}" +
      ".pf-sec-title{margin:0 0 8px;font-size:1rem;font-weight:800;padding-bottom:4px;border-bottom:1px solid rgba(60,60,67,0.18);page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-block{margin:8px 0;}" +
      ".pf-line{margin:0;padding:1px 0;white-space:pre-wrap;word-break:break-word;line-height:1.62;page-break-inside:avoid;break-inside:avoid-page;}" +
      ".pf-line--head{font-weight:700;}" +
      ".pf-line--label{font-weight:700;color:#3d3d45;margin-top:4px;}" +
      ".pf-sec--eval .pf-eval-area{margin-top:14px;padding-top:12px;border-top:1px solid rgba(60,60,67,0.1);}" +
      ".pf-sec--eval>.pf-sec-title+.pf-eval-area{margin-top:0;padding-top:0;border-top:0;}" +
      ".pf-eval-area-title{font-weight:800;font-size:1.02rem;margin:0 0 10px;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-eval-q{margin:0 0 12px;}" +
      ".pf-eval-qhead{font-weight:700;font-size:0.84rem;margin:0 0 4px;color:#3d3d45;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-eval-qtext{margin:0 0 6px;font-size:0.88rem;line-height:1.55;color:#1c1c1e;}" +
      ".pf-eval-score{margin:0;font-size:0.9rem;font-weight:700;page-break-before:avoid;break-before:avoid-page;}" +
      ".pf-eval-area-note-label{font-weight:700;font-size:0.85rem;margin:10px 0 4px;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-eval-area-note{margin:0;padding:10px 12px;background:rgba(60,60,67,0.06);border-radius:8px;font-size:0.88rem;line-height:1.55;}" +
      ".pf-eval-overall{margin-top:16px;padding:12px 14px;border:1px solid rgba(60,60,67,0.15);border-radius:10px;}" +
      ".pf-eval-overall-title{font-weight:800;margin:0 0 6px;font-size:1rem;page-break-after:avoid;break-after:avoid-page;}" +
      ".pf-eval-overall-body{margin:0;font-size:0.92rem;line-height:1.55;}" +
      ".pf-export-root{box-sizing:border-box;margin:0;padding:0;background:#fff;color:#1c1c1e;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.62;}"
    );
  }

  function sanitizePortfolioFilePart(name) {
    var t = String(name || "student")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return t || "student";
  }

  function downloadBlobAsFile(blob, filename) {
    var a = document.createElement("a");
    var u = URL.createObjectURL(blob);
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
  }

  function applyImportedStateObject(o) {
    if (!o || o.version !== 2 || !Array.isArray(o.students)) {
      toast("올바른 백업 파일이 아닙니다. (version 2)");
      return false;
    }
    if (
      !confirm(
        "백업 파일 내용으로 현재 데이터를 모두 바꿉니다.\n·지금 쓰는 학급 데이터는 사라집니다.\n·먼저 「백업 파일 다운로드」로 현재 데이터를 받아 두는 것을 권장합니다.\n\n계속할까요?"
      )
    ) {
      return false;
    }
    state = normalizeState(o);
    if (!persist()) {
      toast("가져온 내용을 저장하지 못했습니다. 저장 공간·브라우저 설정을 확인해 주세요.");
      return false;
    }
    toast("데이터를 가져왔습니다.");
    renderAll();
    return true;
  }

  function getCheckedPortfolioStudentIds() {
    var rowsHost = els.pfStudentRowsHost || document.getElementById("pfStudentRowsHost");
    var root = els.pfStudentListHost || document.getElementById("pfStudentListHost");
    var scope = rowsHost || root;
    if (!scope) return [];
    var want = {};
    scope.querySelectorAll(".pf-student-cb:checked").forEach(function (cb) {
      want[cb.value] = true;
    });
    return rosterStudentsSortedByNumber()
      .filter(function (s) {
        return want[s.id];
      })
      .map(function (s) {
        return s.id;
      });
  }

  function renderPortfolioStudentCheckboxes() {
    var rowsHost = els.pfStudentRowsHost || document.getElementById("pfStudentRowsHost");
    if (!rowsHost) return;
    rowsHost.innerHTML = "";
    if (!state.students.length) {
      rowsHost.innerHTML = '<p class="cm-empty-hint">등록된 학생이 없습니다.</p>';
      syncPfSelectAllMasterCheckbox();
      return;
    }
    rosterStudentsSortedByNumber().forEach(function (s) {
      var row = document.createElement("label");
      row.className = "cm-pf-student-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "pf-student-cb";
      cb.value = s.id;
      var span = document.createElement("span");
      span.className = "cm-pf-student-row__text";
      span.textContent = (s.number != null && String(s.number).trim() !== "" ? String(s.number).trim() + "번 " : "") + (s.name || "");
      row.appendChild(cb);
      row.appendChild(span);
      rowsHost.appendChild(row);
    });
    syncPfSelectAllMasterCheckbox();
  }

  function renderPortfolioInputStatusCard() {
    var host = document.getElementById("pfInputStatusHost");
    if (!host) return;
    host.innerHTML = "";
    if (!state.students.length) {
      host.innerHTML = '<p class="cm-empty-hint">등록된 학생이 없습니다.</p>';
      return;
    }
    var filterEl = document.getElementById("pfStatusFilterIncomplete");
    var onlyIncomplete = filterEl && filterEl.checked;
    var rows = rosterStudentsSortedByNumber().map(function (s) {
      coerceSiInputClosedOnStudent(s);
      return { s: s, c: siInputClosedCount(s), pct: siInputClosedPct(s) };
    });
    if (onlyIncomplete) {
      rows = rows.filter(function (r) {
        return r.c < SI_INPUT_CLOSE_ZONE_COUNT;
      });
    }
    if (!rows.length) {
      host.innerHTML = '<p class="cm-empty-hint">조건에 맞는 학생이 없습니다.</p>';
      return;
    }
    rows.forEach(function (r) {
      var s = r.s;
      var cell = document.createElement("div");
      cell.className = "cm-pf-input-status-cell";
      cell.setAttribute("role", "listitem");
      var num = (s.number || "").trim();
      var title = document.createElement("div");
      title.className = "cm-pf-input-status-cell__title";
      title.textContent = (num ? num + " " : "") + (s.name || "");
      var barRow = document.createElement("div");
      barRow.className = "cm-pf-input-status-cell__bar-row";
      var track = document.createElement("div");
      track.className = "cm-pf-progress-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(r.pct));
      var fill = document.createElement("div");
      fill.className = "cm-pf-progress-fill" + (r.c >= SI_INPUT_CLOSE_ZONE_COUNT ? " is-complete" : "");
      fill.style.width = r.pct + "%";
      track.appendChild(fill);
      var pctEl = document.createElement("span");
      pctEl.className = "cm-pf-progress-pct" + (r.c >= SI_INPUT_CLOSE_ZONE_COUNT ? " is-done" : "");
      pctEl.textContent = r.pct + "%";
      barRow.appendChild(track);
      barRow.appendChild(pctEl);
      cell.appendChild(title);
      cell.appendChild(barRow);
      host.appendChild(cell);
    });
  }

  function syncPfSelectAllMasterCheckbox() {
    var master = els.pfSelectAllCb || document.getElementById("pfSelectAllCb");
    if (!master) return;
    var rowsHost = els.pfStudentRowsHost || document.getElementById("pfStudentRowsHost");
    var boxes = rowsHost ? rowsHost.querySelectorAll(".pf-student-cb") : [];
    if (!boxes.length) {
      master.disabled = true;
      master.checked = false;
      master.indeterminate = false;
      return;
    }
    master.disabled = false;
    var checked = 0;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) checked++;
    }
    master.indeterminate = checked > 0 && checked < boxes.length;
    master.checked = checked === boxes.length;
  }

  function onPfSelectAllMasterChange() {
    var master = els.pfSelectAllCb || document.getElementById("pfSelectAllCb");
    var rowsHost = els.pfStudentRowsHost || document.getElementById("pfStudentRowsHost");
    if (!master || master.disabled || !rowsHost) return;
    var boxes = rowsHost.querySelectorAll(".pf-student-cb");
    var on = master.checked;
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = on;
    }
    master.indeterminate = false;
  }

  function portfolioPdfBaseName(sid) {
    var s = studentById(sid);
    return sanitizePortfolioFilePart(
      (s && s.number ? String(s.number).trim() + "_" : "") + (s && s.name ? s.name : sid)
    );
  }

  function portfolioHtml2PdfOptions(filename) {
    return {
      margin: [6, 8, 8, 8],
      filename: filename,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true, scrollY: 0 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: {
        mode: ["avoid-all", "css", "legacy"],
        before: ".pf-page--break",
        avoid: [
          ".pf-line",
          ".pf-profile-row",
          ".pf-eval-qhead",
          ".pf-eval-score",
          ".pf-sec-title",
          ".pf-doc-title",
          ".pf-meta",
          ".pf-eval-area-title",
          ".pf-eval-area-note-label",
          ".pf-eval-overall-title",
          "tr",
          "img",
        ],
      },
    };
  }

  function removePortfolioPdfHost(host) {
    try {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    } catch (eRm) {}
  }

  /** @returns {Promise<Blob>} */
  function portfolioPdfBlobForStudent(sid) {
    var inner = buildPortfolioHtml(sid);
    var host = document.createElement("div");
    host.setAttribute("data-cm-portfolio-pdf-host", "1");
    host.style.cssText =
      "position:fixed;left:-12000px;top:0;width:210mm;max-width:210mm;box-sizing:border-box;overflow:visible;background:#fff;";
    host.innerHTML =
      '<style>' + getPortfolioExportCss() + '</style><div class="pf-export-root">' + inner + "</div>";
    document.body.appendChild(host);
    var root = host.querySelector(".pf-export-root") || host;
    var fname = "포트폴리오_" + portfolioPdfBaseName(sid) + ".pdf";
    var opt = portfolioHtml2PdfOptions(fname);
    return html2pdf()
      .set(opt)
      .from(root)
      .outputPdf("blob")
      .then(function (blob) {
        removePortfolioPdfHost(host);
        return blob;
      })
      .catch(function (err) {
        removePortfolioPdfHost(host);
        throw err;
      });
  }

  function portfolioGenerateButton() {
    return els.btnPortfolioPdf || document.getElementById("btnPortfolioPdf");
  }

  var PORTFOLIO_GEN_LABEL_DEFAULT = "포트폴리오 생성하기";
  var portfolioFakeProgressTimer = null;

  function setPortfolioGenerateProgress(pct) {
    var btn = portfolioGenerateButton();
    if (!btn) return;
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    btn.style.setProperty("--cm-pf-progress", p + "%");
  }

  function setPortfolioGenerateBusy(isBusy, initialPct) {
    var btn = portfolioGenerateButton();
    if (!btn) return;
    var lab = btn.querySelector(".cm-pf-gen-label");
    if (isBusy) {
      btn.disabled = true;
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
      if (lab) lab.textContent = "생성 중…";
      setPortfolioGenerateProgress(typeof initialPct === "number" ? initialPct : 0);
    } else {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.removeAttribute("aria-busy");
      if (lab) lab.textContent = PORTFOLIO_GEN_LABEL_DEFAULT;
      setPortfolioGenerateProgress(0);
    }
  }

  function clearPortfolioFakeProgress() {
    if (portfolioFakeProgressTimer != null) {
      clearInterval(portfolioFakeProgressTimer);
      portfolioFakeProgressTimer = null;
    }
  }

  /** 단일 PDF처럼 구간 진척이 없을 때, 최대 cap까지 서서히 채움 */
  function startPortfolioFakeProgress(maxCap) {
    clearPortfolioFakeProgress();
    var cap = typeof maxCap === "number" ? maxCap : 88;
    portfolioFakeProgressTimer = setInterval(function () {
      var btn = portfolioGenerateButton();
      if (!btn || !btn.classList.contains("is-busy")) {
        clearPortfolioFakeProgress();
        return;
      }
      var raw = (btn.style.getPropertyValue("--cm-pf-progress") || "0%").replace("%", "");
      var cur = parseFloat(raw);
      if (isNaN(cur)) cur = 0;
      if (cur >= cap) return;
      setPortfolioGenerateProgress(Math.min(cur + 1.8, cap));
    }, 160);
  }

  function finishPortfolioGenerateUiSoon() {
    clearPortfolioFakeProgress();
    setPortfolioGenerateProgress(100);
    setTimeout(function () {
      setPortfolioGenerateBusy(false);
    }, 420);
  }

  function exportPortfoliosPdf() {
    var busyBtn = portfolioGenerateButton();
    if (busyBtn && busyBtn.classList.contains("is-busy")) return;
    var ids = getCheckedPortfolioStudentIds();
    if (!ids.length) {
      toast("포트폴리오를 받을 학생을 한 명 이상 선택하세요.");
      return;
    }
    if (typeof html2pdf === "undefined") {
      toast("PDF 변환 도구를 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.");
      return;
    }
    if (ids.length === 1) {
      setPortfolioGenerateBusy(true, 0);
      startPortfolioFakeProgress(88);
      portfolioPdfBlobForStudent(ids[0]).then(
        function (blob) {
          clearPortfolioFakeProgress();
          downloadBlobAsFile(blob, "포트폴리오_" + portfolioPdfBaseName(ids[0]) + ".pdf");
          toast("PDF 파일을 다운로드했습니다.");
          finishPortfolioGenerateUiSoon();
        },
        function () {
          clearPortfolioFakeProgress();
          setPortfolioGenerateBusy(false);
          toast("PDF 생성에 실패했습니다. 잠시 후 다시 시도하거나, 브라우저를 최신으로 유지해 주세요.");
        }
      );
      return;
    }
    if (typeof JSZip === "undefined") {
      toast("ZIP 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.");
      return;
    }
    var n = ids.length;
    setPortfolioGenerateBusy(true, 0);
    toast("선택한 학생 PDF를 순서대로 생성합니다…");
    var zip = new JSZip();
    var idx = 0;
    function step() {
      if (idx >= ids.length) {
        setPortfolioGenerateProgress((n / (n + 1)) * 100);
        zip
          .generateAsync({ type: "blob" })
          .then(function (blob) {
            downloadBlobAsFile(blob, "포트폴리오_선택" + ids.length + "명_pdf.zip");
            toast("ZIP(PDF) 파일을 다운로드했습니다.");
            finishPortfolioGenerateUiSoon();
          })
          .catch(function () {
            toast("ZIP 생성 중 오류가 났습니다.");
            setPortfolioGenerateBusy(false);
          });
        return;
      }
      setPortfolioGenerateProgress((idx / (n + 1)) * 100);
      var sid = ids[idx];
      portfolioPdfBlobForStudent(sid).then(
        function (blob) {
          zip.file("포트폴리오_" + portfolioPdfBaseName(sid) + ".pdf", blob);
          idx++;
          setPortfolioGenerateProgress((idx / (n + 1)) * 100);
          requestAnimationFrame(function () {
            step();
          });
        },
        function () {
          toast("PDF 생성에 실패했습니다. (" + (idx + 1) + "번째 학생부터 중단)");
          setPortfolioGenerateBusy(false);
        }
      );
    }
    step();
  }

  function fillStudentSelects() {
    var opts = function (sel, ph) {
      if (!sel) return;
      sel.innerHTML = "";
      var p = document.createElement("option");
      p.value = "";
      p.textContent = ph;
      sel.appendChild(p);
      state.students.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name + (s.number ? " (" + s.number + ")" : "");
        sel.appendChild(o);
      });
      sel.disabled = state.students.length === 0;
    };
    renderPortfolioStudentCheckboxes();
    renderPortfolioInputStatusCard();
  }

  function ymAddMonths(ym, delta) {
    var p = String(ym || "").split("-");
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    if (isNaN(y) || isNaN(m)) {
      var d0 = new Date();
      y = d0.getFullYear();
      m = d0.getMonth();
    }
    var d = new Date(y, m + delta, 1);
    return d.getFullYear() + "-" + ymdPad2(d.getMonth() + 1);
  }

  function daysInMonth(y, m1to12) {
    return new Date(y, m1to12, 0).getDate();
  }

  function buildCalendarCellEventsHtml(ymd) {
    var evs = calendarEventsForDate(ymd);
    if (!evs.length) return '<div class="cm-home-cal-evlist"></div>';
    var lines = [];
    var show = evs.slice(0, 4);
    show.forEach(function (ev) {
      var c = calendarCategoryById(ev.categoryId);
      var color = c ? c.color : "#8e8e93";
      var rawTit = ev.title || "";
      var tit = rawTit.length > 16 ? rawTit.slice(0, 14) + "…" : rawTit;
      var timeStr = "";
      if (ev.allDay) {
        timeStr = "종일";
      } else {
        timeStr = ev.startTime || "";
        if (ev.endTime && String(ev.endTime).trim()) {
          timeStr = (ev.startTime || "") + "–" + ev.endTime;
        }
      }
      var tip = (ev.allDay ? "하루 종일\n" : "") + rawTit + (ev.detail ? "\n\n" + ev.detail : "");
      lines.push(
        '<button type="button" class="cm-home-cal-ev" data-home-action="cal-ev-open" data-cal-ev-id="' +
          escapeHtml(ev.id) +
          '" title="' +
          escapeAttr(tip) +
          '"><span class="cm-home-cal-ev-dot" style="background:' +
          escapeHtml(color) +
          '"></span><span class="cm-home-cal-ev-time">' +
          escapeHtml(timeStr) +
          '</span><span class="cm-home-cal-ev-title">' +
          escapeHtml(tit) +
          "</span></button>"
      );
    });
    if (evs.length > 4) {
      lines.push('<div class="cm-home-cal-ev-more">+' + (evs.length - 4) + "</div>");
    }
    return '<div class="cm-home-cal-evlist">' + lines.join("") + "</div>";
  }

  function buildHomeCalendarInnerHTML(y, mo) {
    var dash = state.dashboard;
    var first = new Date(y, mo - 1, 1);
    var startPad = first.getDay();
    var lastDay = daysInMonth(y, mo);
    var today = todayYmd();
    var sel = dash.selectedDate;
    var parts = [];
    parts.push('<div class="cm-home-cal-weekdays">');
    ["일", "월", "화", "수", "목", "금", "토"].forEach(function (w) {
      parts.push('<div class="cm-home-cal-wd">' + w + "</div>");
    });
    parts.push("</div>");
    parts.push('<div class="cm-home-cal-cells">');
    var cellCount = 0;
    var i;
    for (i = 0; i < startPad; i++) {
      parts.push('<div class="cm-home-cal-cell cm-home-cal-cell--pad" aria-hidden="true"></div>');
      cellCount++;
    }
    for (var day = 1; day <= lastDay; day++) {
      var ymd = y + "-" + ymdPad2(mo) + "-" + ymdPad2(day);
      var classes = ["cm-home-cal-cell"];
      if (ymd === sel) classes.push("is-selected");
      if (ymd === today) classes.push("is-today");
      if (isWeekendYmd(ymd)) classes.push("is-weekend");
      if (isHolidayYmd(ymd)) classes.push("is-holiday");
      parts.push(
        '<div class="' +
          classes.join(" ") +
          '" data-cal-date="' +
          ymd +
          '" role="gridcell">' +
          '<button type="button" class="cm-home-cal-daybtn" data-home-action="cal-pick" data-date="' +
          ymd +
          '"><span class="cm-home-cal-day">' +
          day +
          "</span></button>" +
          buildCalendarCellEventsHtml(ymd) +
          '<div class="cm-home-cal-footer"></div></div>'
      );
      cellCount++;
    }
    while (cellCount % 7 !== 0) {
      parts.push('<div class="cm-home-cal-cell cm-home-cal-cell--pad" aria-hidden="true"></div>');
      cellCount++;
    }
    parts.push("</div>");
    parts.push(
      '<p class="cm-home-cal-legend">' +
        "일정: 색 원·시간·제목 · 날짜 칸 <strong>더블클릭</strong>으로 추가</p>" +
        '<p class="cm-home-cal-legend cm-home-cal-legend--cats">' +
        CAL_EVENT_CATEGORIES.map(function (c) {
          return (
            '<span class="cm-home-cal-legcat"><span class="cm-home-cal-ev-dot" style="background:' +
            escapeHtml(c.color) +
            '"></span>' +
            escapeHtml(c.label) +
            "</span>"
          );
        }).join("") +
        "</p>"
    );
    return parts.join("");
  }

  function buildHomeTimetableColumnHtml(which, col) {
    if (col < 0) {
      return '<p class="cm-home-muted">주중(월~금)에만 요일별 시간표를 표시합니다.</p>';
    }
    var g = state.timetableGrids[which];
    if (!g || !g.rows || !g.rows.length) {
      return '<p class="cm-home-muted">관리실 → 시간표 입력에서 채울 수 있습니다.</p>';
    }
    var lab = (g.weekdayLabels && g.weekdayLabels[col]) || ["월", "화", "수", "목", "금"][col];
    var out = [];
    out.push('<p class="cm-home-tt-daylab">' + escapeHtml(lab) + "요일</p>");
    out.push('<table class="cm-home-tt-mini"><tbody>');
    g.rows.forEach(function (row) {
      var cell = (row.cells && row.cells[col]) || "";
      out.push(
        "<tr><th>" +
          escapeHtml(String(row.period || "")) +
          '</th><td>' +
          escapeHtml(cell).replace(/\n/g, "<br/>") +
          "</td></tr>"
      );
    });
    out.push("</tbody></table>");
    return out.join("");
  }

  function buildAttendanceCalendarInnerHTML(y, mo) {
    var first = new Date(y, mo - 1, 1);
    var startPad = first.getDay();
    var lastDay = daysInMonth(y, mo);
    var today = todayYmd();
    var parts = [];
    parts.push('<div class="cm-att-cal-weekdays">');
    ["일", "월", "화", "수", "목", "금", "토"].forEach(function (w) {
      parts.push('<div class="cm-att-cal-wd">' + w + "</div>");
    });
    parts.push("</div>");
    parts.push('<div class="cm-att-cal-cells">');
    var cellCount = 0;
    var i;
    for (i = 0; i < startPad; i++) {
      parts.push('<div class="cm-att-cal-cell cm-att-cal-cell--pad" aria-hidden="true"></div>');
      cellCount++;
    }
    for (var day = 1; day <= lastDay; day++) {
      var ymd = y + "-" + ymdPad2(mo) + "-" + ymdPad2(day);
      var classes = ["cm-att-cal-cell"];
      if (ymd === today) classes.push("is-today");
      if (isWeekendYmd(ymd)) classes.push("is-weekend");
      if (isHolidayYmd(ymd)) classes.push("is-holiday");
      var sum = attendanceSummaryForDay(ymd);
      var mark = "";
      var title = "";
      if (isSchoolDayYmd(ymd) && sum.total > 0) {
        if (sum.level === "full") {
          mark = '<span class="cm-home-cal-mark cm-home-cal-mark--ok"></span>';
          title = "출결 입력 완료";
        } else if (sum.level === "partial") {
          mark = '<span class="cm-home-cal-mark cm-home-cal-mark--part"></span>';
          title = "일부만 입력";
        } else {
          mark = '<span class="cm-home-cal-mark cm-home-cal-mark--miss"></span>';
          title = "출결 미입력";
        }
      } else if (isSchoolDayYmd(ymd) && sum.total === 0) {
        mark = '<span class="cm-att-cal-note">명단 없음</span>';
        title = "학생 명단이 없습니다";
      }
      parts.push(
        '<div class="' +
          classes.join(" ") +
          '" data-att-ymd="' +
          escapeHtml(ymd) +
          '" title="' +
          escapeAttr(title) +
          '" role="gridcell">' +
          '<span class="cm-att-cal-daynum">' +
          day +
          "</span>" +
          '<div class="cm-att-cal-markwrap">' +
          mark +
          "</div></div>"
      );
      cellCount++;
    }
    while (cellCount % 7 !== 0) {
      parts.push('<div class="cm-att-cal-cell cm-att-cal-cell--pad" aria-hidden="true"></div>');
      cellCount++;
    }
    parts.push("</div>");
    return parts.join("");
  }

  function buildHomeTodoHtml(ymd) {
    var list = state.dashboard.todosByDate[ymd] || [];
    if (!list.length) {
      return '<p class="cm-home-muted">할 일이 없습니다. 아래에서 추가하세요.</p>';
    }
    var out = [];
    list.forEach(function (t) {
      out.push(
        '<div class="cm-home-todo-row">' +
          '<label class="cm-home-todo-check"><input type="checkbox" class="cm-home-todo-cb" data-todo-id="' +
          escapeHtml(t.id) +
          '" ' +
          (t.done ? "checked " : "") +
          "/>" +
          '<span class="cm-home-todo-text">' +
          escapeHtml(t.text || "") +
          "</span></label>" +
          '<button type="button" class="cm-home-todo-del" data-home-action="todo-del" data-todo-id="' +
          escapeHtml(t.id) +
          '" aria-label="삭제">×</button></div>'
      );
    });
    return out.join("");
  }

  function buildHomeAttendanceHtml(ymd) {
    var list = rosterStudentsSortedByNumber();
    if (!list.length) {
      return '<p class="cm-home-muted">학생 일괄 관리에서 명단을 먼저 등록하세요.</p>';
    }
    var map = state.dashboard.attendanceByDate[ymd] || {};
    var out = [];
    out.push('<div class="data-table data-table--home-att"><table><thead><tr><th>번호</th><th>이름</th><th>출결</th></tr></thead><tbody>');
    list.forEach(function (s) {
      var cur = map[s.id] != null ? String(map[s.id]) : "";
      out.push("<tr><td>" + escapeHtml(s.number || "—") + "</td><td>" + escapeHtml(s.name || "") + "</td><td>");
      out.push(
        '<input type="text" class="school-filter-select cm-input-text cm-home-att-inp" data-home-att-sid="' +
          escapeHtml(s.id) +
          '" value="' +
          escapeAttr(cur) +
          '" maxlength="40" placeholder="예: 출석, 지각" />'
      );
      out.push("</td></tr>");
    });
    out.push("</tbody></table></div>");
    return out.join("");
  }

  function renderHome() {
    var dash = state.dashboard;
    var ymParts = dash.calendarYm.split("-");
    var y = parseInt(ymParts[0], 10);
    var mo = parseInt(ymParts[1], 10);
    if (isNaN(y) || isNaN(mo)) {
      y = new Date().getFullYear();
      mo = new Date().getMonth() + 1;
    }

    var titleEl = document.getElementById("homeCalTitle");
    if (titleEl) titleEl.textContent = y + "년 " + mo + "월";

    var homePanelTitle = document.getElementById("homePanelTitle");
    if (homePanelTitle) {
      var rawTn = String(state.homeroom.teacherName || "").trim();
      var callName;
      if (!rawTn) {
        callName = "선생님";
      } else {
        var compact = rawTn.replace(/\s+선생님/g, "선생님").trim();
        if (compact.indexOf("선생님") >= 0) {
          callName = compact.replace(/\s/g, "");
        } else {
          callName = compact.replace(/\s/g, "") + "선생님";
        }
      }
      homePanelTitle.textContent = callName + ", 오늘도 좋은 하루가 될거에요 :)";
    }

    var calHost = document.getElementById("homeCalendarHost");
    if (calHost) calHost.innerHTML = buildHomeCalendarInnerHTML(y, mo);

    var sel = dash.selectedDate;
    var line = document.getElementById("homeSelectedLine");
    if (line) {
      var dsel = dateFromYmd(sel);
      var wk = isNaN(dsel.getTime()) ? "—" : ["일", "월", "화", "수", "목", "금", "토"][dsel.getDay()];
      var extra = [];
      if (isHolidayYmd(sel)) extra.push("공휴일");
      if (isWeekendYmd(sel)) extra.push("주말");
      line.textContent = sel + " (" + wk + ")" + (extra.length ? " · " + extra.join(" · ") : "");
    }

    var col = weekdayColIndexFromYmd(sel);
    var clsHost = document.getElementById("homeClassTimetableHost");
    var teaHost = document.getElementById("homeTeacherTimetableHost");
    if (clsHost) clsHost.innerHTML = buildHomeTimetableColumnHtml("class", col);
    if (teaHost) teaHost.innerHTML = buildHomeTimetableColumnHtml("teacher", col);

    var school = isSchoolDayYmd(sel);
    var todoHost = document.getElementById("homeTodoHost");
    var todoAdd = document.getElementById("homeTodoAddWrap");
    var todoMuted = document.getElementById("homeTodoMuted");
    var attHost = document.getElementById("homeAttendanceHost");
    var attMuted = document.getElementById("homeAttMuted");
    var attSave = document.getElementById("homeAttSaveBtn");

    if (school) {
      if (todoMuted) todoMuted.hidden = true;
      if (todoAdd) todoAdd.hidden = false;
      if (todoHost) todoHost.innerHTML = buildHomeTodoHtml(sel);
      if (attMuted) attMuted.hidden = true;
      if (attHost) attHost.innerHTML = buildHomeAttendanceHtml(sel);
      if (attSave) attSave.hidden = false;
    } else {
      if (todoHost) todoHost.innerHTML = "";
      if (todoMuted) todoMuted.hidden = false;
      if (todoAdd) todoAdd.hidden = true;
      if (attHost) attHost.innerHTML = "";
      if (attMuted) attMuted.hidden = false;
      if (attSave) attSave.hidden = true;
    }
  }

  function commitStudentBasicField(sid, field, rawValue, inputEl) {
    var s = studentById(sid);
    if (!s) return;
    var v = rawValue;
    if (typeof v === "string") v = v.trim();
    if (field === "name") {
      if (!v) {
        toast("이름은 비울 수 없습니다.");
        if (inputEl) inputEl.value = s.name || "";
        return;
      }
      s.name = v;
    } else if (field === "number") {
      s.number = String(v == null ? "" : v).trim();
    } else if (field === "gender") {
      s.gender = v || "";
    } else if (field === "studentPhone") {
      s.studentPhone = String(v == null ? "" : v).trim();
    } else if (field === "guardianPhone") {
      s.guardianPhone = String(v == null ? "" : v).trim();
    } else if (field === "careerInterest") {
      s.careerInterest = String(v == null ? "" : v).trim();
    } else if (field === "oneRole") {
      s.oneRole = String(v == null ? "" : v).trim();
      if (s.oneRole.length > 120) s.oneRole = s.oneRole.slice(0, 120);
      if (inputEl) inputEl.value = s.oneRole;
    } else if (field === "clubName") {
      s.clubName = String(v == null ? "" : v).trim();
    } else if (field === "clubRoom") {
      s.clubRoom = String(v == null ? "" : v).trim();
      if (s.clubRoom.length > 80) s.clubRoom = s.clubRoom.slice(0, 80);
      if (inputEl) inputEl.value = s.clubRoom;
    } else if (field === "clubTeacher") {
      s.clubTeacher = String(v == null ? "" : v).trim();
      if (s.clubTeacher.length > 40) s.clubTeacher = s.clubTeacher.slice(0, 40);
      if (inputEl) inputEl.value = s.clubTeacher;
    } else if (field === "participationEvents") {
      s.participationSemSlots = coerceParticipationSemSlots(null, String(v == null ? "" : v).trim());
      syncStudentParticipationLegacySummary(s);
    }
    persist();
    fillStudentSelects();
    renderHome();
  }

  function commitElectiveSlot(sid, semKey, slotIndex, rawValue, inputEl) {
    var s = studentById(sid);
    if (!s) return;
    var slots = coerceElectiveSubjects(s.electiveSubjects);
    var v = String(rawValue == null ? "" : rawValue).trim();
    if (v.length > 120) v = v.slice(0, 120);
    if (inputEl) inputEl.value = v;
    slots[semKey][slotIndex] = v;
    s.electiveSubjects = slots;
    persist();
    fillStudentSelects();
    renderHome();
  }

  function neisTtBlockForStudentSem(s, semKey) {
    if (!s) return null;
    if (semKey === "s2") {
      if (s.neisTimetableS2 && s.neisTimetableS2.rows && s.neisTimetableS2.rows.length) return s.neisTimetableS2;
      return null;
    }
    if (s.neisTimetableS1 && s.neisTimetableS1.rows && s.neisTimetableS1.rows.length) return s.neisTimetableS1;
    if (s.neisTimetable && s.neisTimetable.rows && s.neisTimetable.rows.length) return s.neisTimetable;
    return null;
  }

  function defaultNeisWeekdayLabels() {
    return ["월", "화", "수", "목", "금"];
  }

  /** NEIS 격자 크기(요일·교시) 참고용: 우선 반대 학기, 그다음 아무 학기·레거시 */
  function neisTimetableShapeTemplate(s, forSemKey) {
    if (!s) return null;
    var other = forSemKey === "s2" ? "s1" : "s2";
    var tryKeys = [other, "s1", "s2"];
    var seen = {};
    for (var i = 0; i < tryKeys.length; i++) {
      var k = tryKeys[i];
      if (seen[k]) continue;
      seen[k] = true;
      var b = neisTtBlockForStudentSem(s, k);
      if (b && b.rows && b.rows.length) return b;
    }
    if (s.neisTimetable && s.neisTimetable.rows && s.neisTimetable.rows.length) return s.neisTimetable;
    return null;
  }

  /** 자료가 없는 학기용 — 셀은 비우되 행·열 구조는 template(또는 기본 월~금·7교시)와 동일 */
  function emptyNeisShellBlockFromTemplate(template, semKey) {
    var labels =
      template && template.weekdayLabels && template.weekdayLabels.length
        ? template.weekdayLabels.slice()
        : defaultNeisWeekdayLabels();
    var nCols = labels.length;
    var rows = [];
    var srcRows = template && template.rows && template.rows.length ? template.rows : null;
    if (srcRows) {
      srcRows.forEach(function (r) {
        var cells = [];
        for (var c = 0; c < nCols; c++) cells.push("");
        rows.push({ period: r.period != null ? String(r.period) : "", cells: cells });
      });
    } else {
      for (var p = 1; p <= 7; p++) {
        var cells2 = [];
        for (var c2 = 0; c2 < nCols; c2++) cells2.push("");
        rows.push({ period: String(p), cells: cells2 });
      }
    }
    var semLabel = semKey === "s2" ? "2학기" : "1학기";
    return {
      title: semLabel + " NEIS 시간표 (아직 없음)",
      weekdayLabels: labels,
      rows: rows,
      __emptyShell: true,
    };
  }

  function appendNeisTimetableBlockTo(container, block) {
    if (!container || !block || !block.rows || !block.rows.length) return;
    var wrap = document.createElement("div");
    wrap.className = "cm-neis-tt-wrap" + (block.__emptyShell ? " cm-neis-tt-wrap--shell" : "");
    if (block.title) {
      var pTitle = document.createElement("p");
      pTitle.className = "cm-neis-tt-title" + (block.__emptyShell ? " cm-neis-tt-title--shell" : "");
      pTitle.textContent = block.title;
      wrap.appendChild(pTitle);
    }
    var tbl = document.createElement("table");
    tbl.className = "cm-neis-tt-table" + (block.__emptyShell ? " cm-neis-tt-table--shell" : "");
    if (block.__emptyShell) {
      tbl.setAttribute("aria-label", "NEIS 시간표 격자(해당 학기 자료 없음, 빈 칸)");
    }
    var nDay = (block.weekdayLabels || []).length;
    if (nDay > 0) {
      var cg = document.createElement("colgroup");
      var col0 = document.createElement("col");
      col0.className = "cm-neis-tt-col-period";
      col0.style.width = "11%";
      cg.appendChild(col0);
      var dayPct = (89 / nDay).toFixed(3) + "%";
      for (var ci = 0; ci < nDay; ci++) {
        var colD = document.createElement("col");
        colD.className = "cm-neis-tt-col-day";
        colD.style.width = dayPct;
        cg.appendChild(colD);
      }
      tbl.appendChild(cg);
    }
    var thead = document.createElement("thead");
    var trh = document.createElement("tr");
    var th0 = document.createElement("th");
    th0.textContent = "교시";
    trh.appendChild(th0);
    (block.weekdayLabels || []).forEach(function (lab) {
      var th = document.createElement("th");
      th.textContent = lab;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);
    var tbod = document.createElement("tbody");
    block.rows.forEach(function (row) {
      var trr = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.textContent = row.period || "";
      trr.appendChild(td0);
      (row.cells || []).forEach(function (cellText) {
        var td = document.createElement("td");
        var raw = String(cellText || "").trim();
        if (raw) {
          td.innerHTML = escapeHtml(cellText || "").replace(/\n/g, "<br/>");
        } else if (block.__emptyShell) {
          td.className = "cm-neis-tt-empty-cell";
          td.innerHTML = '<span class="cm-neis-tt-ph">\u00a0</span>';
        } else {
          td.textContent = "";
        }
        trr.appendChild(td);
      });
      tbod.appendChild(trr);
    });
    tbl.appendChild(tbod);
    wrap.appendChild(tbl);
    container.appendChild(wrap);
  }

  function fillStudentTimetableContainer(bodyEl, s, semKey) {
    if (!bodyEl || !s) return;
    if (!semKey) semKey = "s1";
    bodyEl.innerHTML = "";
    var block = neisTtBlockForStudentSem(s, semKey);
    if (block) {
      appendNeisTimetableBlockTo(bodyEl, block);
      return;
    }
    var draftT = (s.timetable || "").trim();
    if (semKey === "s1" && draftT) {
      var preT = document.createElement("pre");
      preT.className = "cm-roster-aux-pre";
      preT.textContent = draftT;
      bodyEl.appendChild(preT);
    }
    if (!(semKey === "s1" && draftT)) {
      var tmpl = neisTimetableShapeTemplate(s, semKey);
      var shell = emptyNeisShellBlockFromTemplate(tmpl, semKey);
      appendNeisTimetableBlockTo(bodyEl, shell);
    }
    var p2 = document.createElement("p");
    p2.className = "cm-roster-aux-placeholder cm-neis-tt-foot";
    if (semKey === "s2") {
      p2.textContent =
        "2학기 NEIS 시간표가 없습니다. 관리실에서 2학기 시간표 엑셀을 업로드하면 (표 제목에 2학기가 포함된 경우) 여기에 표시됩니다.";
    } else {
      p2.textContent = draftT
        ? "위는 시간표 메모입니다. 1학기 NEIS 시간표를 업로드하면 격자 표로 바뀝니다."
        : "1학기 NEIS 시간표가 없습니다. 관리실에서 1학기 시간표 엑셀을 업로드할 수 있습니다.";
    }
    bodyEl.appendChild(p2);
  }

  function buildStudentTimetableSemTabs(host, s) {
    if (!host || !s) return;
    host.innerHTML = "";
    var root = document.createElement("div");
    root.className = "cm-curriculum-modal-tabs cm-student-tt-card-tabs";
    var tablist = document.createElement("div");
    tablist.className = "cm-curriculum-tablist";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "학기");
    var panels = document.createElement("div");
    panels.className = "cm-curriculum-tabpanels";

    var tabs = [];
    [["s1", "1학기"], ["s2", "2학기"]].forEach(function (pair, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-curriculum-tab" + (idx === 0 ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
      btn.setAttribute("data-curr-sem", pair[0]);
      btn.textContent = pair[1];
      var panel = document.createElement("div");
      panel.className = "cm-curriculum-tabpanel" + (idx === 0 ? "" : " is-hidden");
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("data-curr-panel", pair[0]);
      panel.hidden = idx !== 0;
      fillStudentTimetableContainer(panel, s, pair[0]);
      tablist.appendChild(btn);
      panels.appendChild(panel);
      tabs.push({ btn: btn, panel: panel, sem: pair[0] });
    });

    function activateSem(sem) {
      tabs.forEach(function (t) {
        var on = t.sem === sem;
        t.btn.classList.toggle("is-active", on);
        t.btn.setAttribute("aria-selected", on ? "true" : "false");
        t.panel.classList.toggle("is-hidden", !on);
        t.panel.hidden = !on;
      });
    }
    tabs.forEach(function (t) {
      t.btn.addEventListener("click", function () {
        activateSem(t.sem);
      });
    });

    root.appendChild(tablist);
    root.appendChild(panels);
    host.appendChild(root);
  }

  function buildStudentCurriculumModalBody(bodyEl, s) {
    if (!bodyEl || !s) return;
    bodyEl.innerHTML = "";
    buildStudentTimetableSemTabs(bodyEl, s);
  }

  function openStudentCurriculumModal(sid) {
    var s = studentById(sid);
    if (!s) return;
    var titleEl = document.getElementById("studentCurriculumModalTitle");
    var leadEl = document.getElementById("studentCurriculumModalLead");
    var bodyEl = document.getElementById("studentCurriculumModalBody");
    var hid = document.getElementById("studentCurriculumStudentId");
    if (hid) hid.value = sid;
    if (titleEl) titleEl.textContent = "개별 시간표 — " + s.name;
    if (leadEl) {
      var num = (s.number || "").trim();
      leadEl.textContent = (num ? "번호 " + num + " · " : "") + "학기별 탭에서 1학기·2학기 NEIS 시간표를 확인할 수 있습니다.";
    }
    if (bodyEl) buildStudentCurriculumModalBody(bodyEl, s);
    openModal("studentCurriculumModal");
  }

  function setRosterFolder(folder) {
    rosterFolderActive = folder;
    var ph = document.getElementById("rosterFolderPlaceholder");
    var map = {
      basic: document.getElementById("rosterSectionBasic"),
      electives: document.getElementById("rosterSectionElectives"),
      club: document.getElementById("rosterSectionClub"),
      volunteer: document.getElementById("rosterSectionVolunteer"),
      events: document.getElementById("rosterSectionEvents"),
    };
    document.querySelectorAll("[data-roster-folder]").forEach(function (btn) {
      var f = btn.getAttribute("data-roster-folder");
      var on = f === folder;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (ph) ph.hidden = !!folder;
    Object.keys(map).forEach(function (k) {
      var el = map[k];
      if (el) el.hidden = k !== folder;
    });
    if (folder === "volunteer") renderVolunteer();
  }

  function renderRosterBasicTable() {
    if (!els.rosterBody) return;
    var list = rosterStudentsSortedByNumber();
    els.rosterBody.innerHTML = "";
    list.forEach(function (s) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-student-id", s.id);

      var tdNum = document.createElement("td");
      tdNum.textContent = (s.number || "").trim() || "—";
      tr.appendChild(tdNum);

      var tdName = document.createElement("td");
      tdName.textContent = s.name || "";
      tr.appendChild(tdName);

      var tdGen = document.createElement("td");
      var sel = document.createElement("select");
      sel.className = "school-filter-select cm-roster-cell-select";
      [["", "—"], ["M", "남"], ["F", "여"], ["O", "기타"]].forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt[0];
        o.textContent = opt[1];
        sel.appendChild(o);
      });
      sel.value = s.gender || "";
      sel.addEventListener("change", function () {
        commitStudentBasicField(s.id, "gender", sel.value, null);
      });
      tdGen.appendChild(sel);
      tr.appendChild(tdGen);

      var tdSt = document.createElement("td");
      var inpSt = document.createElement("input");
      inpSt.type = "text";
      inpSt.className = "cm-roster-cell-input";
      inpSt.maxLength = 20;
      inpSt.value = s.studentPhone || "";
      inpSt.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "studentPhone", inpSt.value, inpSt);
      });
      tdSt.appendChild(inpSt);
      tr.appendChild(tdSt);

      var tdGp = document.createElement("td");
      var inpGp = document.createElement("input");
      inpGp.type = "text";
      inpGp.className = "cm-roster-cell-input";
      inpGp.maxLength = 20;
      inpGp.value = s.guardianPhone || "";
      inpGp.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "guardianPhone", inpGp.value, inpGp);
      });
      tdGp.appendChild(inpGp);
      tr.appendChild(tdGp);

      var tdCr = document.createElement("td");
      var inpCr = document.createElement("input");
      inpCr.type = "text";
      inpCr.className = "cm-roster-cell-input";
      inpCr.maxLength = 80;
      inpCr.value = s.careerInterest || "";
      inpCr.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "careerInterest", inpCr.value, inpCr);
      });
      tdCr.appendChild(inpCr);
      tr.appendChild(tdCr);

      var tdOneRole = document.createElement("td");
      var inpOneRole = document.createElement("input");
      inpOneRole.type = "text";
      inpOneRole.className = "cm-roster-cell-input";
      inpOneRole.maxLength = 120;
      inpOneRole.value = s.oneRole || "";
      inpOneRole.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "oneRole", inpOneRole.value, inpOneRole);
      });
      tdOneRole.appendChild(inpOneRole);
      tr.appendChild(tdOneRole);

      var tdCurr = document.createElement("td");
      var btnCurr = document.createElement("button");
      btnCurr.type = "button";
      btnCurr.className = "btn-secondary cm-roster-curr-btn";
      btnCurr.textContent = "확인하기";
      btnCurr.addEventListener("click", function () {
        openStudentCurriculumModal(s.id);
      });
      tdCurr.appendChild(btnCurr);
      tr.appendChild(tdCurr);

      var tdDel = document.createElement("td");
      tdDel.className = "col-roster-del";
      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-roster-trash";
      btnDel.setAttribute("aria-label", "학생 삭제");
      btnDel.setAttribute("title", "학생 삭제");
      btnDel.textContent = "🗑";
      btnDel.addEventListener("click", function () {
        if (!confirm("이 학생과 관련 상담·생기부·봉사·평가를 모두 삭제할까요?")) return;
        if (!confirm("삭제한 데이터는 복구할 수 없습니다. 정말 삭제할까요?")) return;
        deleteStudentCascade(s.id);
        toast("학생을 삭제했습니다.");
        renderAll();
      });
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);

      els.rosterBody.appendChild(tr);
    });
    if (els.rosterEmpty) els.rosterEmpty.hidden = list.length > 0;
  }

  function renderRosterElectivesTable() {
    var tbody = document.getElementById("rosterElectivesTableBody");
    var emptyEl = document.getElementById("rosterElectivesEmpty");
    if (!tbody) return;
    tbody.innerHTML = "";
    function addInp(td, s, semKey, idx) {
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "school-filter-select cm-input-text cm-roster-cell-input";
      inp.maxLength = 120;
      var sl = coerceElectiveSubjects(s.electiveSubjects);
      inp.value = sl[semKey][idx] || "";
      inp.addEventListener("blur", function () {
        commitElectiveSlot(s.id, semKey, idx, inp.value, inp);
      });
      td.appendChild(inp);
    }
    var list = rosterStudentsSortedByNumber();
    list.forEach(function (s) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-student-id", s.id);
      var tdN = document.createElement("td");
      tdN.textContent = (s.number || "").trim() || "—";
      tr.appendChild(tdN);
      var tdNm = document.createElement("td");
      tdNm.textContent = s.name || "";
      tr.appendChild(tdNm);
      for (var i = 0; i < 3; i++) {
        var td1 = document.createElement("td");
        addInp(td1, s, "s1", i);
        tr.appendChild(td1);
      }
      for (var j = 0; j < 3; j++) {
        var td2 = document.createElement("td");
        addInp(td2, s, "s2", j);
        tr.appendChild(td2);
      }
      tbody.appendChild(tr);
    });
    if (emptyEl) emptyEl.hidden = list.length > 0;
  }

  function renderRosterClubTable() {
    var tbody = document.getElementById("rosterClubTableBody");
    var emptyEl = document.getElementById("rosterClubEmpty");
    if (!tbody) return;
    tbody.innerHTML = "";
    var list = rosterStudentsSortedByNumber();
    list.forEach(function (s) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-student-id", s.id);
      var tdN = document.createElement("td");
      tdN.textContent = (s.number || "").trim() || "—";
      tr.appendChild(tdN);
      var tdNm = document.createElement("td");
      tdNm.textContent = s.name || "";
      tr.appendChild(tdNm);
      var tdClub = document.createElement("td");
      var inpClub = document.createElement("input");
      inpClub.type = "text";
      inpClub.className = "cm-roster-cell-input";
      inpClub.maxLength = 60;
      inpClub.value = s.clubName || "";
      inpClub.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "clubName", inpClub.value, inpClub);
      });
      tdClub.appendChild(inpClub);
      tr.appendChild(tdClub);

      var tdRoom = document.createElement("td");
      var inpRoom = document.createElement("input");
      inpRoom.type = "text";
      inpRoom.className = "cm-roster-cell-input";
      inpRoom.maxLength = 80;
      inpRoom.value = s.clubRoom || "";
      inpRoom.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "clubRoom", inpRoom.value, inpRoom);
      });
      tdRoom.appendChild(inpRoom);
      tr.appendChild(tdRoom);

      var tdTea = document.createElement("td");
      var inpTea = document.createElement("input");
      inpTea.type = "text";
      inpTea.className = "cm-roster-cell-input";
      inpTea.maxLength = 40;
      inpTea.value = s.clubTeacher || "";
      inpTea.addEventListener("blur", function () {
        commitStudentBasicField(s.id, "clubTeacher", inpTea.value, inpTea);
      });
      tdTea.appendChild(inpTea);
      tr.appendChild(tdTea);

      tbody.appendChild(tr);
    });
    if (emptyEl) emptyEl.hidden = list.length > 0;
  }

  function mountParticipationCatalogDatalist() {
    var id = "rosterParticipationCatalogDatalist";
    var old = document.getElementById(id);
    if (old) old.remove();
    var dl = document.createElement("datalist");
    dl.id = id;
    var catNorm = normalizeParticipationEventCatalog(state.participationEventCatalog || []);
    var seenName = {};
    catNorm.forEach(function (ev) {
      var title = participationCatalogChipTitle(ev);
      if (!title || seenName[normExcelHeader(title)]) return;
      seenName[normExcelHeader(title)] = true;
      var o = document.createElement("option");
      o.value = title;
      dl.appendChild(o);
    });
    document.body.appendChild(dl);
  }

  /** 등록된 행사 목록 표(행사목록 확인 모달·활동 입력 모달 삽입 공용) */
  function renderEventCatalogViewInto(body) {
    if (!body) return;
    var cat = normalizeParticipationEventCatalog(state.participationEventCatalog || []);
    if (!cat.length) {
      body.innerHTML =
        '<p class="cm-settings-note">행사 목록 엑셀 내려받기로 양식을 받은 뒤, 작성하여 업로드하면 여기에 표시됩니다.</p>';
      return;
    }
    var rows = cat
      .map(function (ev) {
        return (
          "<tr><td>" +
          escapeHtml(String(ev.seq || "").trim() || "—") +
          "</td><td>" +
          escapeHtml(ev.name || "") +
          "</td><td>" +
          escapeHtml(ev.month || "") +
          "</td><td>" +
          escapeHtml(ev.target || "") +
          "</td><td>" +
          escapeHtml(ev.department || "") +
          "</td><td>" +
          escapeHtml(ev.activityRecord || "") +
          "</td></tr>"
        );
      })
      .join("");
    body.innerHTML =
      '<table class="cm-catalog-view-table"><thead><tr>' +
      "<th>순번</th><th>행사명</th><th>시행월</th><th>참가대상</th><th>담당부서</th><th>활동내용기록항목</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>";
  }

  function openRosterEventCatalogViewModal() {
    var cat = normalizeParticipationEventCatalog(state.participationEventCatalog || []);
    var lead = document.getElementById("rosterEventCatalogViewLead");
    var body = document.getElementById("rosterEventCatalogViewBody");
    if (!body) return;
    if (lead) {
      lead.textContent = cat.length ? "총 " + cat.length + "건이 등록되어 있습니다." : "등록된 행사가 없습니다. 엑셀로 목록을 올려 주세요.";
    }
    renderEventCatalogViewInto(body);
    openModal("rosterEventCatalogViewModal");
  }

  function mountSiActParticipationDatalist(sid) {
    var id = "siActParticipationDatalist";
    var old = document.getElementById(id);
    if (old) old.remove();
    var dl = document.createElement("datalist");
    dl.id = id;
    var s = studentById(sid);
    var rows = s ? studentParticipationFilledRows(s) : [];
    var seen = {};
    rows.forEach(function (r) {
      var tx = String(r.text || "").trim();
      if (!tx || participationTextIsEmptySentinel(tx)) return;
      var k = normExcelHeader(tx);
      if (seen[k]) return;
      seen[k] = true;
      var o = document.createElement("option");
      o.value = tx;
      dl.appendChild(o);
    });
    document.body.appendChild(dl);
  }

  function syncSiActNameComboVisual(sid) {
    var inp = document.getElementById("siActName");
    if (!inp) return;
    var cat = state.participationEventCatalog || [];
    inp.classList.remove("cm-roster-ev-combo--empty", "cm-roster-ev-combo--catalog", "cm-roster-ev-combo--manual", "cm-roster-ev-combo--editing");
    inp.style.removeProperty("--ev-chip-bg");
    inp.style.removeProperty("--ev-chip-br");
    inp.style.removeProperty("--ev-chip-fg");
    var raw = String(inp.value != null ? inp.value : "");
    if (participationTextIsEmptySentinel(raw)) {
      inp.value = "";
      inp.placeholder = SI_ACT_NAME_PLACEHOLDER;
      inp.classList.add("cm-roster-ev-combo--empty");
      return;
    }
    inp.placeholder = "";
    var v = raw.trim().slice(0, 200);
    inp.value = v;
    var s = studentById(sid);
    if (!s) {
      inp.classList.add("cm-roster-ev-combo--manual");
      return;
    }
    var rows = studentParticipationFilledRows(s);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].text || "").trim() === v) {
        var slot = rows[i].slot;
        var st = participationSlotVisualStyle(slot, cat);
        var isCatalog =
          slot &&
          slot.mode === "catalog" &&
          slot.catalogId &&
          participationCatalogEventById(cat, slot.catalogId);
        inp.classList.add(isCatalog ? "cm-roster-ev-combo--catalog" : "cm-roster-ev-combo--manual");
        inp.style.setProperty("--ev-chip-bg", st.bg);
        inp.style.setProperty("--ev-chip-br", st.br);
        inp.style.setProperty("--ev-chip-fg", st.fg);
        return;
      }
    }
    inp.classList.add("cm-roster-ev-combo--manual");
  }

  function participationSemLabel(sem) {
    return sem === "s2" ? "2학기" : "1학기";
  }

  function commitParticipationSemSlot(sid, sem, idx, newSlot) {
    var s = studentById(sid);
    if (!s) return;
    var slots = coerceParticipationSemSlots(s.participationSemSlots, "");
    slots[sem][idx] = newSlot || null;
    s.participationSemSlots = slots;
    syncStudentParticipationLegacySummary(s);
    persist();
    fillStudentSelects();
    renderHome();
    renderRoster();
  }

  function buildParticipationSlotControl(sid, semKey, idx, slot, catalog) {
    var slotWrap = document.createElement("div");
    slotWrap.className = "cm-roster-ev-slot";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.setAttribute("list", "rosterParticipationCatalogDatalist");
    inp.className = "school-filter-select cm-input-text cm-roster-ev-combo";
    inp.maxLength = 200;
    inp.placeholder = "";
    inp.readOnly = false;
    inp.setAttribute("title", "칸을 눌러 언제든지 행사를 바꿀 수 있습니다. 목록에서 고르거나 직접 입력하세요.");
    inp.setAttribute("aria-label", participationSemLabel(semKey) + " 참여 행사 " + (idx + 1));
    if (!slot) inp.value = PARTICIPATION_EMPTY_DISPLAY;
    else if (slot.mode === "catalog" && slot.catalogId) {
      var ev = participationCatalogEventById(catalog, slot.catalogId);
      inp.value = ev ? participationCatalogChipTitle(ev) : PARTICIPATION_EMPTY_DISPLAY;
    } else {
      inp.value =
        slot && slot.mode === "manual" && String(slot.text || "").trim()
          ? String(slot.text || "")
          : PARTICIPATION_EMPTY_DISPLAY;
    }
    function applyComboChipStyle() {
      inp.classList.remove("cm-roster-ev-combo--empty", "cm-roster-ev-combo--catalog", "cm-roster-ev-combo--manual");
      inp.style.removeProperty("--ev-chip-bg");
      inp.style.removeProperty("--ev-chip-br");
      inp.style.removeProperty("--ev-chip-fg");
      if (!slot) {
        inp.classList.add("cm-roster-ev-combo--empty");
        return;
      }
      if (slot.mode === "catalog" && slot.catalogId) {
        var evChip = participationCatalogEventById(catalog, slot.catalogId);
        if (evChip) {
          inp.classList.add("cm-roster-ev-combo--catalog");
          var st = participationCatalogChipStyleForDepartment(String(evChip.department || "").trim());
          inp.style.setProperty("--ev-chip-bg", st.bg);
          inp.style.setProperty("--ev-chip-br", st.br);
          inp.style.setProperty("--ev-chip-fg", st.fg);
          return;
        }
      }
      if (slot.mode === "manual" && String(slot.text || "").trim()) {
        inp.classList.add("cm-roster-ev-combo--manual");
        var deptKey = participationSlotDepartmentKey(slot, catalog);
        if (deptKey) {
          var stM = participationCatalogChipStyleForDepartment(deptKey);
          inp.style.setProperty("--ev-chip-bg", stM.bg);
          inp.style.setProperty("--ev-chip-br", stM.br);
          inp.style.setProperty("--ev-chip-fg", stM.fg);
        }
        return;
      }
      inp.classList.add("cm-roster-ev-combo--empty");
    }
    applyComboChipStyle();
    inp.addEventListener("focus", function () {
      inp.classList.add("cm-roster-ev-combo--editing");
      if (participationTextIsEmptySentinel(inp.value)) inp.value = "";
    });
    inp.addEventListener("blur", function () {
      inp.classList.remove("cm-roster-ev-combo--editing");
      var raw = String(inp.value || "").trim();
      if (participationTextIsEmptySentinel(raw)) {
        commitParticipationSemSlot(sid, semKey, idx, null);
        return;
      }
      var resolved = matchImportTextToParticipationSlot(inp.value, catalog);
      commitParticipationSemSlot(sid, semKey, idx, resolved);
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
    });
    slotWrap.appendChild(inp);
    return slotWrap;
  }

  function renderRosterEventsTable() {
    var tbody = document.getElementById("rosterEventsTableBody");
    var emptyEl = document.getElementById("rosterEventsEmpty");
    if (!tbody) return;
    tbody.innerHTML = "";
    mountParticipationCatalogDatalist();
    var list = rosterStudentsSortedByNumber();
    var catalog = state.participationEventCatalog || [];
    list.forEach(function (s) {
      var slots = coerceParticipationSemSlots(s.participationSemSlots, "");
      var tr = document.createElement("tr");
      tr.setAttribute("data-student-id", s.id);
      var tdN = document.createElement("td");
      tdN.textContent = (s.number || "").trim() || "—";
      tr.appendChild(tdN);
      var tdNm = document.createElement("td");
      tdNm.textContent = s.name || "";
      tr.appendChild(tdNm);
      var tdEv = document.createElement("td");
      tdEv.className = "cm-roster-events-cell-td";
      var wrap = document.createElement("div");
      wrap.className = "cm-roster-events-cell";
      ["s1", "s2"].forEach(function (sem) {
        var row = document.createElement("div");
        row.className = "cm-roster-ev-sem";
        var lab = document.createElement("span");
        lab.className = "cm-roster-ev-sem-lab";
        lab.textContent = participationSemLabel(sem);
        row.appendChild(lab);
        var slotsHost = document.createElement("div");
        slotsHost.className = "cm-roster-ev-slots";
        for (var i = 0; i < 5; i++) {
          slotsHost.appendChild(buildParticipationSlotControl(s.id, sem, i, slots[sem][i], catalog));
        }
        row.appendChild(slotsHost);
        wrap.appendChild(row);
      });
      tdEv.appendChild(wrap);
      tr.appendChild(tdEv);
      tbody.appendChild(tr);
    });
    if (emptyEl) emptyEl.hidden = list.length > 0;
  }

  function renderRoster() {
    renderRosterBasicTable();
    renderRosterElectivesTable();
    renderRosterClubTable();
    renderRosterEventsTable();
  }

  function volunteerStudentOptionLabel(s) {
    var num = String(s.number != null ? s.number : "").trim();
    var nm = String(s.name || "").trim();
    if (num) return num + " " + nm;
    return nm || "(이름 없음)";
  }

  /** 학생 번호 오름차순, 동일 학생이면 학기·작성 시각으로 안정 정렬 */
  function compareVolunteerRecords(a, b) {
    var sa = studentById(a.studentId);
    var sb = studentById(b.studentId);
    var ka = sa ? numberSortKey(sa.number) : [1, 999999, ""];
    var kb = sb ? numberSortKey(sb.number) : [1, 999999, ""];
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    var cmp = String(ka[2] || "").localeCompare(String(kb[2] || ""));
    if (cmp !== 0) return cmp;
    if (a.semester !== b.semester) return (a.semester === "2" ? 1 : 0) - (b.semester === "2" ? 1 : 0);
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  }

  function volunteerRowsSorted() {
    return state.volunteers.slice().sort(compareVolunteerRecords);
  }

  function volunteerRowPayloadFromTr(tr) {
    var fixedSid = tr.getAttribute("data-vol-student-fixed");
    var sidEl = tr.querySelector('[data-vol-field="student"]');
    var semEl = tr.querySelector('[data-vol-field="semester"]');
    var actEl = tr.querySelector('[data-vol-field="activity"]');
    var hrsEl = tr.querySelector('[data-vol-field="hours"]');
    if (!semEl || !actEl || !hrsEl) return null;
    if (!fixedSid && !sidEl) return null;
    var studentId = fixedSid ? String(fixedSid).trim() : String(sidEl.value || "").trim();
    return {
      studentId: studentId,
      semester: semEl.value === "2" ? "2" : "1",
      activityName: String(actEl.value || "").trim().slice(0, 120),
      hours: Math.max(0, Math.min(999, parseInt(hrsEl.value, 10) || 0)),
    };
  }

  function volunteerRecordById(id) {
    var want = String(id || "");
    for (var i = 0; i < state.volunteers.length; i++) {
      if (state.volunteers[i].id === want) return state.volunteers[i];
    }
    return null;
  }

  function buildVolunteerStudentSelect(selectedSid) {
    var sel = document.createElement("select");
    sel.className = "school-filter-select cm-roster-cell-select";
    sel.setAttribute("data-vol-field", "student");
    if (!state.students.length) sel.disabled = true;
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "선택";
    sel.appendChild(o0);
    rosterStudentsSortedByNumber().forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = volunteerStudentOptionLabel(s);
      sel.appendChild(o);
    });
    if (selectedSid && !studentById(selectedSid)) {
      var ox = document.createElement("option");
      ox.value = selectedSid;
      ox.textContent = "(명단에 없는 학생)";
      sel.appendChild(ox);
    }
    if (selectedSid) sel.value = selectedSid;
    return sel;
  }

  function buildVolunteerSemesterSelect(sem) {
    var sel = document.createElement("select");
    sel.className = "school-filter-select cm-roster-cell-select";
    sel.setAttribute("data-vol-field", "semester");
    [["1", "1학기"], ["2", "2학기"]].forEach(function (x) {
      var o = document.createElement("option");
      o.value = x[0];
      o.textContent = x[1];
      sel.appendChild(o);
    });
    sel.value = sem === "2" ? "2" : "1";
    return sel;
  }

  function saveVolunteersFromEditor() {
    if (!state.students.length) {
      toast("등록된 학생이 없습니다.");
      return;
    }
    var tbody = document.getElementById("rosterVolTableBody");
    if (!tbody) return;
    var next = [];
    var trs = tbody.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var payload = volunteerRowPayloadFromTr(tr);
      if (!payload) continue;
      var vid = tr.getAttribute("data-vol-id");
      if (vid) {
        if (!payload.studentId) {
          toast("저장할 모든 행에서 학생을 선택하세요.");
          return;
        }
        if (!payload.activityName) {
          toast("저장할 모든 행에서 활동명을 입력하세요.");
          return;
        }
        var old = volunteerRecordById(vid);
        next.push({
          id: vid,
          studentId: payload.studentId,
          semester: payload.semester,
          activityName: payload.activityName,
          hours: payload.hours,
          createdAt: old && old.createdAt ? old.createdAt : new Date().toISOString(),
        });
      } else if (tr.getAttribute("data-vol-new")) {
        if (!payload.studentId && !payload.activityName) continue;
        if (!payload.studentId || !payload.activityName) {
          toast("새로 추가한 행은 학생과 활동명을 모두 입력하거나, 비워 두세요.");
          return;
        }
        next.push({
          id: uid(),
          studentId: payload.studentId,
          semester: payload.semester,
          activityName: payload.activityName,
          hours: payload.hours,
          createdAt: new Date().toISOString(),
        });
      }
    }
    state.volunteers = next.slice().sort(compareVolunteerRecords);
    volunteerEditorBlankRows = 1;
    persist();
    toast("봉사 기록을 저장했습니다. 학생 개별 관리 화면도 같은 데이터를 씁니다.");
    renderAll();
  }

  /** 학생 개별 카드의 봉사 표만 저장(해당 학생 행만 병합) */
  function saveVolunteersFromStudentTbody(tbody, studentId) {
    if (!tbody || !studentById(studentId)) {
      toast("학생을 찾을 수 없습니다.");
      return;
    }
    var nextOwn = [];
    var trs = tbody.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var payload = volunteerRowPayloadFromTr(tr);
      if (!payload) continue;
      if (tr.getAttribute("data-vol-student-fixed")) payload.studentId = studentId;
      var vid = tr.getAttribute("data-vol-id");
      if (vid) {
        if (!payload.activityName) {
          toast("저장할 모든 행에서 활동명을 입력하세요.");
          return;
        }
        var old = volunteerRecordById(vid);
        if (!old || old.studentId !== studentId) continue;
        nextOwn.push({
          id: vid,
          studentId: studentId,
          semester: payload.semester,
          activityName: payload.activityName,
          hours: payload.hours,
          createdAt: old.createdAt ? old.createdAt : new Date().toISOString(),
        });
      } else if (tr.getAttribute("data-vol-new")) {
        if (!payload.activityName || !String(payload.activityName).trim()) continue;
        nextOwn.push({
          id: uid(),
          studentId: studentId,
          semester: payload.semester,
          activityName: payload.activityName,
          hours: payload.hours,
          createdAt: new Date().toISOString(),
        });
      }
    }
    var others = state.volunteers.filter(function (v) {
      return v.studentId !== studentId;
    });
    state.volunteers = others.concat(nextOwn).sort(compareVolunteerRecords);
    clearSiInputClosedFlag(studentId, "volunteer");
    persist();
    toast("봉사 기록을 저장했습니다. 학생 일괄 관리의 봉사활동과 같은 데이터입니다.");
    renderAll();
  }

  function appendVolunteerBlankRow(tbody, fixedStudentId) {
    var hasStudents = state.students.length > 0;
    var tr = document.createElement("tr");
    tr.setAttribute("data-vol-new", "1");
    if (fixedStudentId) tr.setAttribute("data-vol-student-fixed", fixedStudentId);
    var tdDs = document.createElement("td");
    tdDs.appendChild(buildVolunteerStudentSelect(fixedStudentId || ""));
    if (fixedStudentId) {
      var sel0 = tdDs.querySelector("select");
      if (sel0) sel0.disabled = true;
    }
    tr.appendChild(tdDs);
    var tdDm = document.createElement("td");
    tdDm.appendChild(buildVolunteerSemesterSelect("1"));
    tr.appendChild(tdDm);
    var tdDa = document.createElement("td");
    var inpDa = document.createElement("input");
    inpDa.type = "text";
    inpDa.className = "school-filter-select cm-input-text cm-roster-cell-input";
    inpDa.maxLength = 120;
    inpDa.setAttribute("data-vol-field", "activity");
    inpDa.placeholder = "활동명";
    inpDa.disabled = !hasStudents;
    tdDa.appendChild(inpDa);
    tr.appendChild(tdDa);
    var tdDh = document.createElement("td");
    var inpDh = document.createElement("input");
    inpDh.type = "number";
    inpDh.className = "school-filter-select cm-input-text cm-roster-cell-input";
    inpDh.min = "0";
    inpDh.max = "999";
    inpDh.setAttribute("data-vol-field", "hours");
    inpDh.value = "0";
    inpDh.disabled = !hasStudents;
    tdDh.appendChild(inpDh);
    tr.appendChild(tdDh);
    var tdDd = document.createElement("td");
    tdDd.className = "col-roster-del";
    var btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn-roster-trash";
    btnDel.setAttribute("aria-label", "행 제거");
    btnDel.setAttribute("title", "행 제거");
    btnDel.textContent = "🗑";
    btnDel.addEventListener("click", function () {
      var nNew = tbody.querySelectorAll("tr[data-vol-new]").length;
      if (tr.getAttribute("data-vol-new") && nNew <= 1) {
        toast("입력 행은 최소 한 줄 유지됩니다.");
        return;
      }
      if (!confirm("이 행을 표에서 제거할까요? (저장 시 반영됩니다)")) return;
      var wasNew = !!tr.getAttribute("data-vol-new");
      tr.remove();
      if (wasNew) {
        if (!tr.getAttribute("data-vol-student-fixed")) {
          volunteerEditorBlankRows = Math.max(1, volunteerEditorBlankRows - 1);
        }
      }
    });
    tdDd.appendChild(btnDel);
    tr.appendChild(tdDd);
    tbody.appendChild(tr);
  }

  function appendVolunteerExtraBlankRow() {
    var tbody = document.getElementById("rosterVolTableBody");
    if (!tbody) return;
    if (!state.students.length) {
      toast("등록된 학생이 없습니다.");
      return;
    }
    volunteerEditorBlankRows++;
    appendVolunteerBlankRow(tbody);
  }

  function renderVolunteerTableInto(tbody, emptyEl, fixedStudentId) {
    if (!tbody) return;
    tbody.innerHTML = "";
    var hasStudents = state.students.length > 0;
    if (emptyEl) emptyEl.hidden = hasStudents;
    volunteerRowsSorted().forEach(function (r) {
      if (fixedStudentId && r.studentId !== fixedStudentId) return;
      var tr = document.createElement("tr");
      tr.setAttribute("data-vol-id", r.id);
      if (fixedStudentId) tr.setAttribute("data-vol-student-fixed", fixedStudentId);
      var tdS = document.createElement("td");
      tdS.appendChild(buildVolunteerStudentSelect(r.studentId));
      if (fixedStudentId) {
        var selF = tdS.querySelector("select");
        if (selF) selF.disabled = true;
      }
      tr.appendChild(tdS);
      var tdM = document.createElement("td");
      tdM.appendChild(buildVolunteerSemesterSelect(r.semester));
      tr.appendChild(tdM);
      var tdA = document.createElement("td");
      var inpA = document.createElement("input");
      inpA.type = "text";
      inpA.className = "school-filter-select cm-input-text cm-roster-cell-input";
      inpA.maxLength = 120;
      inpA.setAttribute("data-vol-field", "activity");
      inpA.value = r.activityName || "";
      inpA.disabled = !hasStudents;
      tdA.appendChild(inpA);
      tr.appendChild(tdA);
      var tdH = document.createElement("td");
      var inpH = document.createElement("input");
      inpH.type = "number";
      inpH.className = "school-filter-select cm-input-text cm-roster-cell-input";
      inpH.min = "0";
      inpH.max = "999";
      inpH.setAttribute("data-vol-field", "hours");
      inpH.value = r.hours != null ? String(r.hours) : "0";
      inpH.disabled = !hasStudents;
      tdH.appendChild(inpH);
      tr.appendChild(tdH);
      var tdDel = document.createElement("td");
      tdDel.className = "col-roster-del";
      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-roster-trash";
      btnDel.setAttribute("aria-label", "행 제거");
      btnDel.setAttribute("title", "행 제거");
      btnDel.textContent = "🗑";
      btnDel.addEventListener("click", function () {
        if (!confirm("이 행을 표에서 제거할까요? (저장 시 삭제됩니다)")) return;
        tr.remove();
      });
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
    var blankCount = fixedStudentId ? 1 : volunteerEditorBlankRows;
    for (var b = 0; b < blankCount; b++) {
      appendVolunteerBlankRow(tbody, fixedStudentId || undefined);
    }
  }

  function renderVolunteer() {
    renderVolunteerTableInto(document.getElementById("rosterVolTableBody"), document.getElementById("rosterVolEmpty"));
  }

  function pruneStudentRefsFromDashboard(sid) {
    var want = String(sid);
    var dash = state.dashboard;
    if (!dash || !dash.attendanceByDate) return;
    Object.keys(dash.attendanceByDate).forEach(function (ymd) {
      var map = dash.attendanceByDate[ymd];
      if (!map || typeof map !== "object") return;
      Object.keys(map).forEach(function (k) {
        if (String(k) === want) delete map[k];
      });
    });
  }

  function deleteStudentCascade(sid) {
    var want = String(sid);
    state.students = state.students.filter(function (x) {
      return String(x.id) !== want;
    });
    state.counselings = state.counselings.filter(function (x) {
      return String(x.studentId) !== want;
    });
    state.volunteers = state.volunteers.filter(function (x) {
      return String(x.studentId) !== want;
    });
    if (state.evaluations && typeof state.evaluations === "object") {
      Object.keys(state.evaluations).forEach(function (k) {
        if (String(k) === want) delete state.evaluations[k];
      });
    }
    pruneStudentRefsFromDashboard(want);
    if (studentIndividualOpenId != null && String(studentIndividualOpenId) === want) {
      studentIndividualOpenId = null;
      studentIndividualPanelTab = "basic";
    }
    if (counselManageOpenStudentId != null && String(counselManageOpenStudentId) === want) {
      counselManageOpenStudentId = null;
      counselManagePanelTab = "new";
    }
    persist();
  }

  function openStudentDetail(sid) {
    var s = studentById(sid);
    if (!s || !els.detailStudentId) return;
    els.detailStudentId.value = sid;
    document.getElementById("d_name").value = s.name || "";
    document.getElementById("d_number").value = s.number || "";
    document.getElementById("d_gender").value = s.gender || "";
    document.getElementById("d_stPhone").value = s.studentPhone || "";
    document.getElementById("d_gpPhone").value = s.guardianPhone || "";
    document.getElementById("d_career").value = s.careerInterest || "";
    document.getElementById("d_club").value = s.clubName || "";
    document.getElementById("d_special").value = s.specialNotes || "";
    document.getElementById("d_oneRole").value = s.oneRole || "";
    fillElectiveInputs("d_", s.electiveSubjects);
    document.getElementById("detailModalTitle").textContent = "학생 상세 — " + s.name;
    openModal("studentDetailModal");
  }

  function updateStudentIndividualPickSelection() {
    if (!els.studentIndividualButtonHost) return;
    els.studentIndividualButtonHost.querySelectorAll("button.cm-student-individual-pick").forEach(function (b) {
      var id = b.getAttribute("data-student-id");
      var on = !!(id && studentIndividualOpenId != null && String(id) === String(studentIndividualOpenId));
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function updateCounselStudentPickSelection() {
    if (!els.counselStudentPickHost) return;
    els.counselStudentPickHost.querySelectorAll("button.cm-student-individual-pick").forEach(function (b) {
      var id = b.getAttribute("data-student-id");
      var on = !!(id && counselManageOpenStudentId != null && String(id) === String(counselManageOpenStudentId));
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncCounselManageTabView() {
    if (!els.counselListView || !els.counselDetailView) return;
    var open = counselManageOpenStudentId && studentById(counselManageOpenStudentId);
    els.counselListView.hidden = false;
    els.counselDetailView.hidden = !open;
    updateCounselStudentPickSelection();
    if (open) renderCounselStudentDetail(counselManageOpenStudentId);
  }

  function showCounselManageList() {
    counselManageOpenStudentId = null;
    syncCounselManageTabView();
  }

  function openCounselManageStudent(sid) {
    if (!studentById(sid)) return;
    if (counselManageOpenStudentId != null && String(counselManageOpenStudentId) === String(sid)) {
      showCounselManageList();
      return;
    }
    if (counselManageOpenStudentId == null || String(counselManageOpenStudentId) !== String(sid))
      counselManagePanelTab = "new";
    counselManageOpenStudentId = sid;
    syncCounselManageTabView();
  }

  function setCounselManagePanel(tab) {
    var valid = { new: 1, list: 1 };
    if (!valid[tab]) tab = "new";
    counselManagePanelTab = tab;
    var root = els.counselDetailHost && els.counselDetailHost.querySelector(".cm-counsel-manage-composite");
    if (!root) return;
    root.querySelectorAll("[data-cm-counsel-tab]").forEach(function (btn) {
      var f = btn.getAttribute("data-cm-counsel-tab");
      var on = f === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll("[data-cm-counsel-panel]").forEach(function (pan) {
      pan.hidden = pan.getAttribute("data-cm-counsel-panel") !== tab;
    });
  }

  function renderCounselStudentPickList() {
    if (!els.counselStudentPickHost) return;
    els.counselStudentPickHost.innerHTML = "";
    var list = rosterStudentsSortedByNumber();
    if (els.counselStudentEmpty) els.counselStudentEmpty.hidden = list.length > 0;
    list.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn-secondary cm-student-individual-pick";
      b.setAttribute("role", "listitem");
      b.setAttribute("data-student-id", s.id);
      b.setAttribute("aria-pressed", "false");
      var num = (s.number || "").trim();
      b.textContent = (num ? num + " " : "") + (s.name || "");
      b.addEventListener("click", function () {
        openCounselManageStudent(s.id);
      });
      els.counselStudentPickHost.appendChild(b);
    });
    updateCounselStudentPickSelection();
  }

  function renderCounselStudentDetail(sid) {
    var s = studentById(sid);
    if (!els.counselDetailHost) return;
    if (!s) {
      showCounselManageList();
      toast("학생을 찾을 수 없습니다.");
      return;
    }
    els.counselDetailHost.innerHTML = "";

    var work = document.createElement("div");
    work.className = "card cm-card cm-roster-work--indexed cm-counsel-manage-composite";

    var tabRow = document.createElement("div");
    tabRow.className = "cm-roster-index-row";
    tabRow.setAttribute("role", "tablist");
    tabRow.setAttribute("aria-label", "상담 기록 구역");

    [["new", "신규 상담 기록"], ["list", "상담 기록 확인"]].forEach(function (pair) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-roster-index-tab" + (pair[0] === counselManagePanelTab ? " is-active" : "");
      btn.setAttribute("data-cm-counsel-tab", pair[0]);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", pair[0] === counselManagePanelTab ? "true" : "false");
      btn.textContent = pair[1];
      btn.addEventListener("click", function () {
        setCounselManagePanel(pair[0]);
      });
      tabRow.appendChild(btn);
    });
    work.appendChild(tabRow);

    var pNew = document.createElement("div");
    pNew.className = "cm-roster-index-panel";
    pNew.setAttribute("data-cm-counsel-panel", "new");
    pNew.setAttribute("role", "tabpanel");
    pNew.hidden = counselManagePanelTab !== "new";

    var bodyForm = document.createElement("div");
    bodyForm.className = "cm-card__body";
    var form = document.createElement("form");
    form.className = "cm-counsel-form";

    var labDate = document.createElement("label");
    labDate.className = "school-filter-field";
    var spDate = document.createElement("span");
    spDate.className = "school-filter-label";
    spDate.textContent = "상담일";
    var inpDate = document.createElement("input");
    inpDate.type = "date";
    inpDate.className = "school-filter-select cm-input-text";
    labDate.appendChild(spDate);
    labDate.appendChild(inpDate);

    var labTop = document.createElement("label");
    labTop.className = "school-filter-field";
    var spTop = document.createElement("span");
    spTop.className = "school-filter-label";
    spTop.textContent = "주제 (쉼표로 구분)";
    var inpTop = document.createElement("input");
    inpTop.type = "text";
    inpTop.className = "school-filter-select cm-input-text";
    inpTop.placeholder = "학업, 진로";
    inpTop.maxLength = 200;
    labTop.appendChild(spTop);
    labTop.appendChild(inpTop);

    var labBody = document.createElement("label");
    labBody.className = "school-filter-field";
    var spBody = document.createElement("span");
    spBody.className = "school-filter-label";
    spBody.textContent = "내용";
    var taBody = document.createElement("textarea");
    taBody.rows = 5;
    taBody.placeholder = "상담 내용";
    labBody.appendChild(spBody);
    labBody.appendChild(taBody);

    var formAct = document.createElement("div");
    formAct.className = "cm-form-actions";
    var btnSubmit = document.createElement("button");
    btnSubmit.type = "submit";
    btnSubmit.className = "primary-btn";
    btnSubmit.textContent = "저장";
    formAct.appendChild(btnSubmit);

    form.appendChild(labDate);
    form.appendChild(labTop);
    form.appendChild(labBody);
    form.appendChild(formAct);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = (taBody.value || "").trim();
      if (!body) {
        toast("내용을 입력해 주세요.");
        return;
      }
      state.counselings.push({
        id: uid(),
        studentId: sid,
        body: body,
        topics: (inpTop.value || "").trim(),
        counselingDate: (inpDate.value || "").trim(),
        createdAt: new Date().toISOString(),
      });
      taBody.value = "";
      inpTop.value = "";
      inpDate.value = "";
      persist();
      toast("상담 기록을 저장했습니다.");
      counselManagePanelTab = "list";
      renderCounselStudentDetail(sid);
    });

    bodyForm.appendChild(form);
    pNew.appendChild(bodyForm);

    var pList = document.createElement("div");
    pList.className = "cm-roster-index-panel";
    pList.setAttribute("data-cm-counsel-panel", "list");
    pList.setAttribute("role", "tabpanel");
    pList.hidden = counselManagePanelTab !== "list";

    var bodyList = document.createElement("div");
    bodyList.className = "cm-card__body";
    if (!isCounselViewUnlocked()) {
      appendCounselPasswordGate(bodyList, function () {
        renderCounselStudentDetail(sid);
      });
    } else {
      var listHost = document.createElement("div");
      listHost.className = "cm-record-list";
      renderCounselRecordsForStudent(listHost, sid, "등록된 상담 기록이 없습니다.");
      bodyList.appendChild(listHost);
    }
    pList.appendChild(bodyList);

    work.appendChild(pNew);
    work.appendChild(pList);
    els.counselDetailHost.appendChild(work);
  }

  function renderCounselManageUi() {
    if (counselManageOpenStudentId && !studentById(counselManageOpenStudentId)) {
      counselManageOpenStudentId = null;
      counselManagePanelTab = "new";
    }
    renderCounselStudentPickList();
    syncCounselManageTabView();
  }

  function syncStudentIndividualTabView() {
    if (!els.studentIndividualListView || !els.studentIndividualDetailView) return;
    var open = studentIndividualOpenId && studentById(studentIndividualOpenId);
    els.studentIndividualListView.hidden = false;
    els.studentIndividualDetailView.hidden = !open;
    updateStudentIndividualPickSelection();
    if (open) renderStudentIndividualDetail(studentIndividualOpenId);
  }

  function showStudentIndividualList() {
    studentIndividualOpenId = null;
    syncStudentIndividualTabView();
  }

  function openStudentIndividualPage(sid) {
    if (!studentById(sid)) return;
    if (studentIndividualOpenId != null && String(studentIndividualOpenId) === String(sid)) {
      showStudentIndividualList();
      return;
    }
    if (studentIndividualOpenId == null || String(studentIndividualOpenId) !== String(sid))
      studentIndividualPanelTab = "basic";
    studentIndividualOpenId = sid;
    syncStudentIndividualTabView();
  }

  function setStudentIndividualPanel(tab) {
    var valid = { basic: 1, volunteer: 1, autonomous: 1, career: 1, eval: 1 };
    if (!valid[tab]) tab = "basic";
    studentIndividualPanelTab = tab;
    var root = els.studentIndividualDetailHost && els.studentIndividualDetailHost.querySelector(".cm-student-individual-composite");
    if (!root) return;
    root.querySelectorAll(".cm-roster-index-tab[data-si-folder]").forEach(function (btn) {
      var f = btn.getAttribute("data-si-folder");
      var on = f === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll("[data-si-panel]").forEach(function (pan) {
      pan.hidden = pan.getAttribute("data-si-panel") !== tab;
    });
  }

  function genderLabelForStudent(g) {
    if (g === "M") return "남";
    if (g === "F") return "여";
    if (g === "O") return "기타";
    return "—";
  }

  function renderStudentIndividualList() {
    if (!els.studentIndividualButtonHost) return;
    els.studentIndividualButtonHost.innerHTML = "";
    var list = rosterStudentsSortedByNumber();
    if (els.studentIndividualEmpty) els.studentIndividualEmpty.hidden = list.length > 0;
    list.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn-secondary cm-student-individual-pick";
      b.setAttribute("role", "listitem");
      b.setAttribute("data-student-id", s.id);
      b.setAttribute("aria-pressed", "false");
      var num = (s.number || "").trim();
      b.textContent = (num ? num + " " : "") + (s.name || "");
      b.addEventListener("click", function () {
        openStudentIndividualPage(s.id);
      });
      els.studentIndividualButtonHost.appendChild(b);
    });
    updateStudentIndividualPickSelection();
  }

  /** 참여행사 표시(개별관리 기본정보 탭·활동 입력 모달 공용) */
  function renderStudentParticipationDisplayInto(bodyPe, sid) {
    if (!bodyPe) return;
    bodyPe.innerHTML = "";
    var s = studentById(sid);
    if (!s) {
      var p0 = document.createElement("p");
      p0.className = "cm-home-muted cm-si-pe-empty";
      p0.textContent = "학생을 찾을 수 없습니다.";
      bodyPe.appendChild(p0);
      return;
    }
    var cat = state.participationEventCatalog || [];
    var rows = studentParticipationFilledRows(s);
    if (!rows.length) {
      var p = document.createElement("p");
      p.className = "cm-home-muted cm-si-pe-empty";
      p.textContent =
        "등록된 참여 행사가 없습니다. 학생 일괄 관리의 참여행사에서 입력하거나, 행사 목록을 올린 뒤 칸에서 선택할 수 있습니다.";
      bodyPe.appendChild(p);
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "cm-si-pe-display";
    var bySem = { s1: [], s2: [] };
    rows.forEach(function (r) {
      if (r.semKey === "s2") bySem.s2.push(r);
      else bySem.s1.push(r);
    });
    function appendSemBlock(semKey, title) {
      var list = bySem[semKey];
      if (!list.length) return;
      var semEl = document.createElement("div");
      semEl.className = "cm-si-pe-sem";
      var hd = document.createElement("div");
      hd.className = "cm-si-pe-sem__hd";
      hd.textContent = title;
      var row = document.createElement("div");
      row.className = "cm-si-pe-sem__badges";
      list.forEach(function (r) {
        var st = participationSlotVisualStyle(r.slot, cat);
        var badge = document.createElement("span");
        badge.className = "cm-si-pe-badge";
        badge.textContent = r.text;
        badge.style.background = st.bg;
        badge.style.borderColor = st.br;
        badge.style.color = st.fg;
        badge.setAttribute("title", title + " 참여" + r.slotIndex);
        row.appendChild(badge);
      });
      semEl.appendChild(hd);
      semEl.appendChild(row);
      wrap.appendChild(semEl);
    }
    appendSemBlock("s1", "1학기");
    appendSemBlock("s2", "2학기");
    bodyPe.appendChild(wrap);
  }

  function fillStudentIndividualParticipationBody(container, sid) {
    if (!container) return;
    var bodyPe = document.createElement("div");
    bodyPe.className = "cm-si-pe-body";
    renderStudentParticipationDisplayInto(bodyPe, sid);
    container.appendChild(bodyPe);
  }

  function siActivityModalTargets() {
    return {
      modal: document.getElementById("studentActivityInputModal"),
      sidEl: document.getElementById("siActStudentId"),
      keyEl: document.getElementById("siActStateKey"),
      entryIdEl: document.getElementById("siActEntryId"),
      titleEl: document.getElementById("siActModalTitle"),
      studentLineEl: document.getElementById("siActModalStudentLine"),
      peHost: document.getElementById("siActPeHost"),
      nameEl: document.getElementById("siActName"),
      contentEl: document.getElementById("siActContent"),
      stRefEl: document.getElementById("siActStRef"),
      teObsEl: document.getElementById("siActTeObs"),
    };
  }

  function openStudentActivityInputModal(sid, stateKey, existingEntry) {
    var t = siActivityModalTargets();
    if (!t.modal || !t.sidEl || !t.keyEl) return;
    var st = studentById(sid);
    if (!st) {
      toast("학생을 찾을 수 없습니다.");
      return;
    }
    t.sidEl.value = sid;
    t.keyEl.value = stateKey;
    var isEdit = !!(existingEntry && existingEntry.id);
    if (t.entryIdEl) t.entryIdEl.value = isEdit ? String(existingEntry.id) : "";
    var baseTitle =
      stateKey === "autonomousActivities"
        ? "자율활동"
        : stateKey === "careerActivities"
          ? "진로활동"
          : "활동";
    if (t.titleEl) t.titleEl.textContent = isEdit ? baseTitle + " 수정" : baseTitle + " 입력";
    if (t.studentLineEl) t.studentLineEl.textContent = st.name ? String(st.name).trim() + " 학생" : "학생";
    if (t.peHost) renderStudentParticipationDisplayInto(t.peHost, sid);
    mountSiActParticipationDatalist(sid);
    if (isEdit) {
      if (t.nameEl) {
        var nm0 = existingEntry.name != null ? String(existingEntry.name).trim() : "";
        t.nameEl.value = nm0;
      }
      if (t.contentEl) t.contentEl.value = existingEntry.content != null ? String(existingEntry.content) : "";
      if (t.stRefEl) t.stRefEl.value = existingEntry.studentReflection != null ? String(existingEntry.studentReflection) : "";
      if (t.teObsEl) t.teObsEl.value = existingEntry.teacherObservation != null ? String(existingEntry.teacherObservation) : "";
    } else {
      if (t.nameEl) t.nameEl.value = "";
      if (t.contentEl) t.contentEl.value = "";
      if (t.stRefEl) t.stRefEl.value = "";
      if (t.teObsEl) t.teObsEl.value = "";
    }
    syncSiActNameComboVisual(sid);
    openModal("studentActivityInputModal");
    if (t.nameEl) {
      requestAnimationFrame(function () {
        t.nameEl.focus();
      });
    }
  }

  function submitStudentActivityInputFromModal() {
    var t = siActivityModalTargets();
    var sid = (t.sidEl && t.sidEl.value) || "";
    var stateKey = (t.keyEl && t.keyEl.value) || "";
    var editId = t.entryIdEl ? String(t.entryIdEl.value || "").trim() : "";
    if (!sid || !stateKey) return;
    var whichShort = stateKey === "autonomousActivities" ? "autonomous" : "career";
    var s2 = studentById(sid);
    if (!s2) {
      toast("학생을 찾을 수 없습니다.");
      closeAllModals();
      return;
    }
    var nameRaw = t.nameEl ? String(t.nameEl.value) : "";
    var nameClean = participationTextIsEmptySentinel(nameRaw) ? "" : nameRaw.trim().slice(0, 200);
    var fields = normalizeActivityRecordBlock({
      name: nameClean,
      content: t.contentEl ? t.contentEl.value : "",
      studentReflection: t.stRefEl ? t.stRefEl.value : "",
      teacherObservation: t.teObsEl ? t.teObsEl.value : "",
    });
    if (!fields.name && !fields.content && !fields.studentReflection && !fields.teacherObservation) {
      toast("내용을 한 가지 이상 입력해 주세요.");
      return;
    }
    if (!Array.isArray(s2[stateKey])) s2[stateKey] = [];
    var arr = s2[stateKey];
    if (editId) {
      var prev = findRowById(arr, editId);
      if (!prev) {
        toast("수정할 활동을 찾을 수 없습니다.");
        closeAllModals();
        renderAll();
        return;
      }
      var merged = normalizeActivityRecordEntry(
        Object.assign({ id: editId, createdAt: prev.createdAt }, fields)
      );
      if (!merged) return;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === editId) {
          arr[i] = merged;
          break;
        }
      }
    } else {
      var newEntry = normalizeActivityRecordEntry(Object.assign({ id: uid() }, fields));
      if (newEntry) arr.push(newEntry);
    }
    clearSiInputClosedFlag(sid, whichShort);
    persist();
    toast("저장했습니다.");
    closeAllModals();
    renderAll();
  }

  function appendSiTabInputDeadlineFooter(container, sid, which) {
    if (!container || !sid) return;
    var s = studentById(sid);
    if (!s) return;
    coerceSiInputClosedOnStudent(s);
    var k =
      which === "volunteer"
        ? "siInputClosedVolunteer"
        : which === "autonomous"
          ? "siInputClosedAutonomous"
          : which === "career"
            ? "siInputClosedCareer"
            : which === "eval"
              ? "siInputClosedEval"
              : null;
    if (!k) return;
    var isClosed = !!s[k];
    var foot = document.createElement("div");
    foot.className = "cm-si-input-deadline-foot";
    var status = document.createElement("p");
    status.className = "cm-si-input-deadline-status" + (isClosed ? " is-closed" : "");
    status.textContent = isClosed
      ? "이 구역은 입력 마감 상태입니다. 내용을 수정·저장·삭제(또는 총평 입력 변경)하면 마감이 자동으로 해제됩니다."
      : "자료 반영이 끝나면 아래에서 마감할 수 있습니다. 포트폴리오 탭의 개별 관리 입력 현황에 반영됩니다.";
    var row = document.createElement("div");
    row.className = "cm-si-input-deadline-actions";
    if (!isClosed) {
      var bClose = document.createElement("button");
      bClose.type = "button";
      bClose.className = "btn-secondary";
      bClose.textContent = "입력 마감";
      bClose.addEventListener("click", function () {
        var sx = studentById(sid);
        if (!sx) return;
        coerceSiInputClosedOnStudent(sx);
        sx[k] = true;
        persist();
        toast("입력 마감했습니다.");
        renderAll();
      });
      row.appendChild(bClose);
    } else {
      var badge = document.createElement("span");
      badge.className = "cm-si-deadline-badge";
      badge.textContent = "마감됨";
      row.appendChild(badge);
    }
    foot.appendChild(status);
    foot.appendChild(row);
    container.appendChild(foot);
  }

  function fillStudentIndividualActivityBlock(container, sid, stateKey) {
    if (!container) return;
    var s0 = studentById(sid);
    if (!s0) return;
    var list = normalizeStudentActivityList(s0[stateKey], null);
    s0[stateKey] = list;
    var whichShort = stateKey === "autonomousActivities" ? "autonomous" : "career";

    var addRow = document.createElement("div");
    addRow.className = "cm-si-activity-add-row";
    var btnAdd = document.createElement("button");
    btnAdd.type = "button";
    btnAdd.className = "btn-secondary";
    btnAdd.textContent = "+ 활동 입력";
    btnAdd.addEventListener("click", function () {
      openStudentActivityInputModal(sid, stateKey, null);
    });
    addRow.appendChild(btnAdd);
    container.appendChild(addRow);

    var listSection = document.createElement("div");
    listSection.className = "cm-student-activity-saved-list";
    var h4 = document.createElement("h4");
    h4.className = "cm-student-individual-subhd";
    h4.textContent = "저장된 활동";
    listSection.appendChild(h4);

    if (!list.length) {
      var pEmpty = document.createElement("p");
      pEmpty.className = "cm-home-muted";
      pEmpty.textContent = "저장된 항목이 없습니다. 「+ 활동 입력」에서 추가하면 여기에 표시됩니다.";
      listSection.appendChild(pEmpty);
    } else {
      list.forEach(function (entry) {
        var wrap = document.createElement("div");
        wrap.className = "cm-student-activity-saved-item";

        var meta = document.createElement("div");
        meta.className = "cm-student-activity-saved-item__meta";
        meta.textContent = formatTs(entry.createdAt);

        var title = document.createElement("div");
        title.className = "cm-student-activity-saved-item__title";
        title.textContent = (entry.name && String(entry.name).trim()) || "(활동명 없음)";

        function addSection(legend, text) {
          var t = (text == null ? "" : String(text)).trim();
          if (!t) return;
          var lab = document.createElement("div");
          lab.className = "cm-student-activity-saved-item__label";
          lab.textContent = legend;
          var bod = document.createElement("div");
          bod.className = "cm-student-activity-saved-item__body";
          bod.textContent = t;
          wrap.appendChild(lab);
          wrap.appendChild(bod);
        }

        wrap.appendChild(meta);
        wrap.appendChild(title);
        addSection("활동 내용", entry.content);
        addSection("학생 소감", entry.studentReflection);
        addSection("교사 관찰 내용", entry.teacherObservation);

        var act = document.createElement("div");
        act.className = "cm-record-actions";
        var bEdit = document.createElement("button");
        bEdit.type = "button";
        bEdit.className = "btn-secondary";
        bEdit.textContent = "수정";
        bEdit.addEventListener("click", function () {
          openStudentActivityInputModal(sid, stateKey, entry);
        });
        var bDel = document.createElement("button");
        bDel.type = "button";
        bDel.className = "btn-danger";
        bDel.textContent = "삭제";
        bDel.addEventListener("click", function () {
          if (!confirm("이 활동 기록을 삭제할까요?")) return;
          var s3 = studentById(sid);
          if (!s3 || !Array.isArray(s3[stateKey])) return;
          s3[stateKey] = s3[stateKey].filter(function (x) {
            return x.id !== entry.id;
          });
          clearSiInputClosedFlag(sid, whichShort);
          persist();
          toast("삭제했습니다.");
          renderAll();
        });
        act.appendChild(bEdit);
        act.appendChild(bDel);
        wrap.appendChild(act);
        listSection.appendChild(wrap);
      });
    }
    container.appendChild(listSection);
    appendSiTabInputDeadlineFooter(container, sid, whichShort);
  }

  function fillStudentIndividualEvalBlock(container, sid) {
    if (!container || !sid) return;
    var head = document.createElement("div");
    head.className = "cm-card__head cm-card__head--block";
    var h3 = document.createElement("h3");
    h3.className = "cm-card__title";
    h3.textContent = "학생 총평";
    head.appendChild(h3);
    var body = document.createElement("div");
    body.className = "cm-card__body";
    var formHost = document.createElement("div");
    formHost.className = "cm-student-individual-eval-host";
    renderEvalFormInto(formHost, sid);
    body.appendChild(formHost);
    var act = document.createElement("div");
    act.className = "cm-form-actions cm-form-actions--eval";
    var bReset = document.createElement("button");
    bReset.type = "button";
    bReset.className = "eval-reset-btn";
    bReset.textContent = "초기화";
    bReset.addEventListener("click", function () {
      resetCurrentEvalForm(sid);
    });
    var bSave = document.createElement("button");
    bSave.type = "button";
    bSave.className = "primary-btn";
    bSave.textContent = "총평 저장";
    bSave.addEventListener("click", function () {
      saveEvalFromForm(sid);
    });
    act.appendChild(bReset);
    act.appendChild(bSave);
    body.appendChild(act);
    if (!formHost.dataset.cmSiEvalUnlockBound) {
      formHost.dataset.cmSiEvalUnlockBound = "1";
      var evalUnlockTimer = null;
      function scheduleEvalUnlockPersist() {
        if (clearSiInputClosedFlag(sid, "eval")) {
          if (evalUnlockTimer) clearTimeout(evalUnlockTimer);
          evalUnlockTimer = setTimeout(function () {
            persist();
            evalUnlockTimer = null;
            if (currentTabId === "portfolio") renderPortfolioInputStatusCard();
          }, 340);
        }
      }
      formHost.addEventListener("input", scheduleEvalUnlockPersist);
      formHost.addEventListener("change", scheduleEvalUnlockPersist);
    }
    appendSiTabInputDeadlineFooter(body, sid, "eval");
    container.appendChild(head);
    container.appendChild(body);
  }

  function renderStudentIndividualDetail(sid) {
    var s = studentById(sid);
    if (!els.studentIndividualDetailHost) return;
    if (!s) {
      showStudentIndividualList();
      toast("학생을 찾을 수 없습니다.");
      return;
    }
    if (studentIndividualPanelTab === "counsel") studentIndividualPanelTab = "basic";

    var host = els.studentIndividualDetailHost;
    host.innerHTML = "";

    function valStr(x) {
      var t = (x == null ? "" : String(x)).trim();
      return t || "—";
    }

    function addDlRow(dl, label, text) {
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      dd.textContent = text;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    var work = document.createElement("div");
    work.className = "card cm-card cm-roster-work--indexed cm-student-individual-composite";

    var tabRow = document.createElement("div");
    tabRow.className = "cm-roster-index-row";
    tabRow.setAttribute("role", "tablist");
    tabRow.setAttribute("aria-label", "학생 개별 구역");

    var numTab = (s.number || "").trim();
    var nameTab = (s.name || "").trim();
    var basicTabLabel = (numTab ? numTab + " " : "") + (nameTab || "이름 없음");

    var tabsDef = [
      { id: "basic", label: "기본정보", ariaLabel: basicTabLabel + " — 기본정보" },
      { id: "volunteer", label: "봉사활동", ariaLabel: null },
      { id: "autonomous", label: "자율활동", ariaLabel: null },
      { id: "career", label: "진로활동", ariaLabel: null },
      { id: "eval", label: "학생 총평", ariaLabel: null },
    ];
    tabsDef.forEach(function (td) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-roster-index-tab";
      btn.setAttribute("data-si-folder", td.id);
      btn.setAttribute("role", "tab");
      btn.textContent = td.label;
      if (td.ariaLabel) btn.setAttribute("aria-label", td.ariaLabel);
      btn.addEventListener("click", function () {
        setStudentIndividualPanel(td.id);
      });
      tabRow.appendChild(btn);
    });
    work.appendChild(tabRow);

    function appendPanel(panelId) {
      var p = document.createElement("div");
      p.className = "cm-roster-index-panel";
      p.setAttribute("data-si-panel", panelId);
      p.setAttribute("role", "tabpanel");
      work.appendChild(p);
      return p;
    }

    var pBasic = appendPanel("basic");

    var blockBasic = document.createElement("div");
    blockBasic.className = "cm-si-basic-block";
    var headBasic = document.createElement("div");
    headBasic.className = "cm-si-basic-block__head";
    var hBasic = document.createElement("h3");
    hBasic.className = "cm-si-basic-block__title";
    hBasic.textContent = "기본 정보";
    var btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn-secondary cm-si-pe-btn";
    btnEdit.textContent = "정보 수정";
    btnEdit.addEventListener("click", function () {
      openStudentDetail(sid);
    });
    headBasic.appendChild(hBasic);
    headBasic.appendChild(btnEdit);
    var bodyBasic = document.createElement("div");
    bodyBasic.className = "cm-si-basic-block__body";
    var dl = document.createElement("dl");
    dl.className = "cm-student-individual-dl";
    addDlRow(dl, "번호", valStr(s.number));
    addDlRow(dl, "이름", valStr(s.name));
    addDlRow(dl, "성별", genderLabelForStudent(s.gender));
    addDlRow(dl, "학생 연락처", valStr(s.studentPhone));
    addDlRow(dl, "학부모 연락처", valStr(s.guardianPhone));
    addDlRow(dl, "진로희망", valStr(s.careerInterest));
    addDlRow(dl, "동아리", valStr(s.clubName));
    addDlRow(dl, "1인 1역", valStr(s.oneRole));
    addDlRow(dl, "특이사항", valStr(s.specialNotes));
    bodyBasic.appendChild(dl);
    blockBasic.appendChild(headBasic);
    blockBasic.appendChild(bodyBasic);
    pBasic.appendChild(blockBasic);

    var blockElective = document.createElement("div");
    blockElective.className = "cm-si-basic-block";
    var hElective = document.createElement("h3");
    hElective.className = "cm-si-basic-block__title";
    hElective.textContent = "선택과목";
    var electiveHost = document.createElement("div");
    electiveHost.className = "cm-si-elective-display-host";
    fillStudentIndividualElectiveDisplay(electiveHost, s.electiveSubjects);
    blockElective.appendChild(hElective);
    blockElective.appendChild(electiveHost);
    pBasic.appendChild(blockElective);

    var blockTt = document.createElement("div");
    blockTt.className = "cm-si-basic-block";
    var hTt = document.createElement("h3");
    hTt.className = "cm-si-basic-block__title";
    hTt.textContent = "시간표";
    var ttWrap = document.createElement("div");
    ttWrap.className = "cm-student-individual-tt";
    buildStudentTimetableSemTabs(ttWrap, s);
    blockTt.appendChild(hTt);
    blockTt.appendChild(ttWrap);
    pBasic.appendChild(blockTt);

    var blockPe = document.createElement("div");
    blockPe.className = "cm-si-basic-block";
    var headPe = document.createElement("div");
    headPe.className = "cm-si-basic-block__head";
    var hPe = document.createElement("h3");
    hPe.className = "cm-si-basic-block__title";
    hPe.textContent = "참여행사";
    var btnPeCat = document.createElement("button");
    btnPeCat.type = "button";
    btnPeCat.className = "btn-secondary cm-si-pe-btn";
    btnPeCat.textContent = "행사 목록 확인";
    btnPeCat.addEventListener("click", function () {
      openRosterEventCatalogViewModal();
    });
    headPe.appendChild(hPe);
    headPe.appendChild(btnPeCat);
    blockPe.appendChild(headPe);
    fillStudentIndividualParticipationBody(blockPe, sid);
    pBasic.appendChild(blockPe);

    var pVol = appendPanel("volunteer");
    var headVol = document.createElement("div");
    headVol.className = "cm-card__head cm-card__head--volunteer-toolbar";
    var h3a = document.createElement("h3");
    h3a.className = "cm-card__title";
    h3a.textContent = "봉사활동";
    var btnVolSave = document.createElement("button");
    btnVolSave.type = "button";
    btnVolSave.className = "primary-btn";
    btnVolSave.textContent = "저장";
    headVol.appendChild(h3a);
    headVol.appendChild(btnVolSave);

    var bodyVol = document.createElement("div");
    bodyVol.className = "cm-card__body";
    var noteVol = document.createElement("p");
    noteVol.className = "cm-settings-note";
    noteVol.innerHTML =
      "표에서 입력한 뒤 <strong>저장</strong>을 누르면 반영됩니다. 학생 일괄 관리의 봉사활동 탭과 같은 데이터입니다.";
    bodyVol.appendChild(noteVol);

    var wrapTbl = document.createElement("div");
    wrapTbl.className = "data-table data-table--volunteer-edit";
    var tableVol = document.createElement("table");
    var theadVol = document.createElement("thead");
    var trhVol = document.createElement("tr");
    ["학생", "학기", "활동", "시간", ""].forEach(function (lab, hi) {
      var th = document.createElement("th");
      if (hi === 4) {
        th.className = "col-roster-del";
        th.setAttribute("aria-label", "삭제");
      } else {
        th.textContent = lab;
      }
      trhVol.appendChild(th);
    });
    theadVol.appendChild(trhVol);
    var tbodyVol = document.createElement("tbody");
    tableVol.appendChild(theadVol);
    tableVol.appendChild(tbodyVol);
    wrapTbl.appendChild(tableVol);
    bodyVol.appendChild(wrapTbl);

    var footVol = document.createElement("div");
    footVol.className = "cm-volunteer-table-footer";
    var btnVolAdd = document.createElement("button");
    btnVolAdd.type = "button";
    btnVolAdd.className = "btn-secondary cm-volunteer-add-row";
    btnVolAdd.setAttribute("aria-label", "입력 행 추가");
    btnVolAdd.textContent = "+";
    footVol.appendChild(btnVolAdd);
    bodyVol.appendChild(footVol);

    renderVolunteerTableInto(tbodyVol, null, sid);
    btnVolSave.addEventListener("click", function () {
      saveVolunteersFromStudentTbody(tbodyVol, sid);
    });
    btnVolAdd.addEventListener("click", function () {
      appendVolunteerBlankRow(tbodyVol, sid);
    });

    pVol.appendChild(headVol);
    pVol.appendChild(bodyVol);
    appendSiTabInputDeadlineFooter(pVol, sid, "volunteer");
    var sVolClosed = studentById(sid);
    coerceSiInputClosedOnStudent(sVolClosed);
    if (sVolClosed && sVolClosed.siInputClosedVolunteer) {
      btnVolSave.disabled = true;
      btnVolAdd.disabled = true;
      tbodyVol.querySelectorAll("input, select, button").forEach(function (el) {
        el.disabled = true;
      });
    }

    var pAuto = appendPanel("autonomous");
    fillStudentIndividualActivityBlock(pAuto, sid, "autonomousActivities");

    var pCareer = appendPanel("career");
    fillStudentIndividualActivityBlock(pCareer, sid, "careerActivities");

    var pEval = appendPanel("eval");
    fillStudentIndividualEvalBlock(pEval, sid);

    host.appendChild(work);
    setStudentIndividualPanel(studentIndividualPanelTab);
  }

  var EVAL_SCHEMA_V2 = "v2";
  var EVAL_AREA_COUNT = 6;
  var EVAL_QUESTIONS_PER_AREA = 5;
  var EVAL_AREA_SPECS = [
    {
      title: "자기이해·자기조절",
      questions: [
        "학생은 자신의 강점과 보완할 점을 말이나 글로 분명히 밝히고, 한 학기 동안 그에 맞게 행동을 조정하려 하였나요?",
        "학생은 스스로 세운 생활·활동 목표를 정해 두고, 중간에 점검하며 바꾸거나 이어 가려 하였나요?",
        "학생은 힘들거나 불편한 상황에서도 학급·학교 규칙과 기본 예절을 지키며 감정을 조절하려 하였나요?",
        "학생은 자신의 말과 행동의 결과를 스스로 돌아보고, 잘못이 있다고 느낄 때 인정하려 하였나요?",
        "학생은 수업·생활 전반에서 집중이나 태도가 흐트러질 때 스스로 환기·정리 등으로 다시 맞추려 하였나요?",
      ],
    },
    {
      title: "책임·성실·약속 이행",
      questions: [
        "학생은 학급·모둠·행사 등에서 맡은 역할을 정해진 기한과 절차에 맞게 끝까지 수행하였나요?",
        "학생은 선생님·또래와 나눈 약속(제출 시한, 역할 분담 등)을 스스로 기억하고 지키려 하였나요?",
        "학생은 지각·누락 등이 있을 때 솔직히 인정하고, 다음에는 어떻게 하겠다고 말하거나 행동으로 보완하였나요?",
        "학생은 준비물·복장·장소 이동 등 생활에서 반복되는 절차를 스스로 챙기려 하였나요?",
        "학생은 공지된 일정이나 변경 사항을 확인하고 그에 맞추려 하였나요?",
      ],
    },
    {
      title: "대인관계·배려·협력",
      questions: [
        "학생은 또래와 의견이 다르거나 마찰이 있을 때, 상대 입장을 먼저 듣고 말하거나 행동으로 조율하였나요?",
        "학생은 모둠 활동·행사 준비 등에서 자신의 몫을 하고, 필요할 때 다른 친구를 도와 협력하였나요?",
        "학생은 장애·가정환경·성별 등이 다른 동료를 놀리거나 배제하지 않고, 존중하는 말과 태도를 보였나요?",
        "학생은 발언할 차례와 경청할 때를 구분하며, 모둠·학급 대화에서 예의를 갖추었나요?",
        "학생은 갈등이 생겼을 때 선생님께 상황을 숨기지 않고 도움을 요청하거나 중재에 협조하였나요?",
      ],
    },
    {
      title: "공동체 참여·시민성·봉사",
      questions: [
        "학생은 학급·학교 행사나 봉사 활동에 참여할 때 정해진 시간과 장소를 지키고, 공동 작업에 성실히 기여하였나요?",
        "학생은 캠페인·분리수거·안전 교육 등 공동체·환경·안전과 관련된 활동에 관심을 보이거나 실천하였나요?",
        "학생은 학급 회의·자치 활동 등에서 필요한 의견을 예의를 갖추어 말하고, 결정된 사항을 따르려 하였나요?",
        "학생은 공용 공간·기물을 함께 쓰는 규칙을 지키고, 뒷정리·정돈에 참여하였나요?",
        "학생은 학교 밖 활동(체험학습 등)에서도 질서와 안전 수칙을 지키며 학교의 일원으로 행동하였나요?",
      ],
    },
    {
      title: "진로의식·탐색·설계",
      questions: [
        "학생은 자신의 흥미·적성·가치관과 연결하여 진로를 찾아보거나(상담·체험·조사 등) 그 결과를 정리하여 말한 적이 있나요?",
        "학생은 고등학교 졸업 이후 진학·취업 등의 경로를 위해 필요한 정보를 스스로 찾거나 선생님·전문가에게 질문하였나요?",
        "학생은 진로와 관련한 선택(동아리·활동 참여 방향 등)을 남에게만 맡기지 않고, 스스로 이유를 말하며 결정하려 하였나요?",
        "학생은 진로 관련 발표·자기소개·포트폴리오 등에서 자신의 경험을 진솔하게 담으려 하였나요?",
        "학생은 진로가 바뀌거나 방향을 고민할 때도 포기하지 않고 다시 탐색하려는 태도를 보였나요?",
      ],
    },
    {
      title: "도전·성찰·성장",
      questions: [
        "학생은 익숙하지 않은 발표·행사·역할 등에 회피하지 않고 도전하여 끝까지 시도하였나요?",
        "학생은 어려움을 겪은 뒤 원인을 스스로 짚어 보고, 다음에는 무엇을 바꾸겠다고 말하거나 계획을 세운 적이 있나요?",
        "학생은 선생님이나 또래의 피드백을 듣고 반복 연습·수정 등으로 나아지려는 모습을 보였나요?",
        "학생은 실패나 낮은 만족도의 결과에도 학습·활동을 중단하지 않고 다시 시도하였나요?",
        "학생은 한 학기 동안 이전과 비교해 성장했다고 느끼는 점을 말하거나 기록으로 표현한 적이 있나요?",
      ],
    },
  ];

  /** 영역별 차트·라디오 강조색(배지·세로선과 동일 계열) */
  var EVAL_AREA_COLOR_MAIN = ["#007aff", "#34c759", "#ff9500", "#af52de", "#ff3b30", "#32ade6"];
  var EVAL_RADAR_SVG_ID = "evRadarSvg";

  function readEvalScoreTotalsFromForm() {
    var totals = [0, 0, 0, 0, 0, 0];
    for (var a = 0; a < EVAL_AREA_COUNT; a++) {
      for (var q = 0; q < EVAL_QUESTIONS_PER_AREA; q++) {
        var inp = document.querySelector('input[name="ev_a' + a + "_q" + q + '"]:checked');
        if (inp) totals[a] += parseInt(inp.value, 10);
      }
    }
    return totals;
  }

  function truncateEvalLabelTitle(s, maxLen) {
    var n = maxLen || 16;
    if (!s || s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }

  function paintEvalRadarSvg(svg) {
    if (!svg) return;
    var NS = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var vb = 280;
    var cx = vb / 2;
    var cy = vb / 2;
    var R = 74;
    var totals = readEvalScoreTotalsFromForm();
    function vtx(angle, r) {
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
    var angles = [];
    for (var i = 0; i < 6; i++) angles.push(-Math.PI / 2 + (i * 2 * Math.PI) / 6);
    [0.34, 0.67, 1].forEach(function (t) {
      var poly = document.createElementNS(NS, "polygon");
      poly.setAttribute(
        "points",
        angles
          .map(function (ang) {
            var p = vtx(ang, R * t);
            return p.x + "," + p.y;
          })
          .join(" ")
      );
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "rgba(60, 60, 67, 0.16)");
      poly.setAttribute("stroke-width", "1");
      svg.appendChild(poly);
    });
    angles.forEach(function (ang) {
      var p = vtx(ang, R);
      var line = document.createElementNS(NS, "line");
      line.setAttribute("x1", String(cx));
      line.setAttribute("y1", String(cy));
      line.setAttribute("x2", String(p.x));
      line.setAttribute("y2", String(p.y));
      line.setAttribute("stroke", "rgba(60, 60, 67, 0.1)");
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
    });
    var ptsData = [];
    for (var i = 0; i < 6; i++) {
      var tot = totals[i];
      var ratio = Math.min(1, Math.max(0, tot / 25));
      var p = vtx(angles[i], ratio * R);
      ptsData.push(p.x + "," + p.y);
    }
    var polyD = document.createElementNS(NS, "polygon");
    polyD.setAttribute("points", ptsData.join(" "));
    polyD.setAttribute("fill", "rgba(0, 122, 255, 0.1)");
    polyD.setAttribute("stroke", "rgba(0, 122, 255, 0.45)");
    polyD.setAttribute("stroke-width", "2");
    polyD.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyD);
    for (var j = 0; j < 6; j++) {
      var totJ = totals[j];
      var ratioJ = Math.min(1, Math.max(0, totJ / 25));
      var pj = vtx(angles[j], ratioJ * R);
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(pj.x));
      c.setAttribute("cy", String(pj.y));
      c.setAttribute("r", "5");
      c.setAttribute("fill", EVAL_AREA_COLOR_MAIN[j]);
      c.setAttribute("stroke", "#fff");
      c.setAttribute("stroke-width", "1.5");
      svg.appendChild(c);
    }
    var Rlab = R + 30;
    for (var k = 0; k < 6; k++) {
      var pk = vtx(angles[k], Rlab);
      var g = document.createElementNS(NS, "g");
      g.setAttribute("transform", "translate(" + pk.x + "," + pk.y + ")");
      var tScore = document.createElementNS(NS, "text");
      tScore.setAttribute("text-anchor", "middle");
      tScore.setAttribute("y", "-5");
      tScore.setAttribute("fill", EVAL_AREA_COLOR_MAIN[k]);
      tScore.setAttribute("font-size", "12");
      tScore.setAttribute("font-weight", "700");
      tScore.setAttribute("font-family", "inherit");
      tScore.textContent = totals[k] + "/25";
      var tName = document.createElementNS(NS, "text");
      tName.setAttribute("text-anchor", "middle");
      tName.setAttribute("y", "8");
      tName.setAttribute("fill", "#6a6a72");
      tName.setAttribute("font-size", "9.5");
      tName.setAttribute("font-weight", "600");
      tName.setAttribute("font-family", "inherit");
      tName.textContent = truncateEvalLabelTitle(EVAL_AREA_SPECS[k].title, 15);
      g.appendChild(tScore);
      g.appendChild(tName);
      svg.appendChild(g);
    }
  }

  function updateEvalRadarFromForm() {
    paintEvalRadarSvg(document.getElementById(EVAL_RADAR_SVG_ID));
  }

  function emptyEvalBlock() {
    var areas = [];
    for (var a = 0; a < EVAL_AREA_COUNT; a++) {
      areas.push({ scores: [null, null, null, null, null], note: "" });
    }
    return { schema: EVAL_SCHEMA_V2, areas: areas, overall: "", updatedAt: "" };
  }

  function isEvalV2Shape(ev) {
    return (
      ev &&
      ev.schema === EVAL_SCHEMA_V2 &&
      Array.isArray(ev.areas) &&
      ev.areas.length === EVAL_AREA_COUNT
    );
  }

  function getEval(sid) {
    if (!state.evaluations[sid]) state.evaluations[sid] = emptyEvalBlock();
    var ev = state.evaluations[sid];
    if (!isEvalV2Shape(ev)) {
      var overallKeep = ev && typeof ev.overall === "string" ? ev.overall : "";
      ev = emptyEvalBlock();
      ev.overall = overallKeep;
      state.evaluations[sid] = ev;
    }
    for (var a = 0; a < EVAL_AREA_COUNT; a++) {
      if (!ev.areas[a] || typeof ev.areas[a] !== "object") ev.areas[a] = { scores: [null, null, null, null, null], note: "" };
      if (!Array.isArray(ev.areas[a].scores)) ev.areas[a].scores = [];
      while (ev.areas[a].scores.length < EVAL_QUESTIONS_PER_AREA) ev.areas[a].scores.push(null);
      ev.areas[a].scores = ev.areas[a].scores.slice(0, EVAL_QUESTIONS_PER_AREA);
      for (var q = 0; q < EVAL_QUESTIONS_PER_AREA; q++) {
        var s = ev.areas[a].scores[q];
        ev.areas[a].scores[q] = s === 1 || s === 2 || s === 3 || s === 4 || s === 5 ? s : null;
      }
      ev.areas[a].note = ev.areas[a].note != null ? String(ev.areas[a].note) : "";
    }
    return ev;
  }

  function renderEvalFormInto(host, sid) {
    if (!host) return;
    host.innerHTML = "";
    if (!sid) {
      host.innerHTML = "<p class=\"cm-empty-hint\">학생을 선택하세요.</p>";
      return;
    }
    var ev = getEval(sid);
    EVAL_AREA_SPECS.forEach(function (spec, a) {
      var areaEl = ev.areas[a];
      var card = document.createElement("div");
      card.className = "eval-block eval-area-card eval-area-card--" + a;
      var head = document.createElement("div");
      head.className = "eval-area-head";
      var badge = document.createElement("span");
      badge.className = "eval-area-badge";
      badge.textContent = spec.title;
      head.appendChild(badge);
      card.appendChild(head);
      var body = document.createElement("div");
      body.className = "eval-area-body";
      spec.questions.forEach(function (qtext, q) {
        var row = document.createElement("div");
        row.className = "eval-q-row";
        var pq = document.createElement("p");
        pq.className = "eval-q-text";
        pq.textContent = qtext;
        row.appendChild(pq);
        var scale = document.createElement("div");
        scale.className = "eval-scale";
        scale.setAttribute("role", "radiogroup");
        scale.setAttribute("aria-label", spec.title + " 문항 " + (q + 1) + " 점수");
        var name = "ev_a" + a + "_q" + q;
        var cur = areaEl.scores[q];
        for (var v = 1; v <= 5; v++) {
          var lab = document.createElement("label");
          lab.className = "eval-scale-opt";
          var inp = document.createElement("input");
          inp.type = "radio";
          inp.name = name;
          inp.value = String(v);
          if (cur === v) inp.checked = true;
          lab.appendChild(inp);
          lab.appendChild(document.createTextNode(String(v) + "점"));
          scale.appendChild(lab);
        }
        row.appendChild(scale);
        body.appendChild(row);
      });
      var noteRow = document.createElement("div");
      noteRow.className = "eval-note-row";
      var noteIntro = document.createElement("p");
      noteIntro.className = "eval-q-text";
      noteIntro.textContent =
        spec.title + " 영역과 관련하여 학생에 대해 별도로 기재하고 싶은 내용을 자유롭게 기술해주세요.";
      noteRow.appendChild(noteIntro);
      var ta = document.createElement("textarea");
      ta.className = "school-filter-select cm-eval-note-ta";
      ta.id = "ev_note_" + a;
      ta.rows = 3;
      ta.value = areaEl.note || "";
      noteRow.appendChild(ta);
      body.appendChild(noteRow);
      card.appendChild(body);
      host.appendChild(card);
    });
    var ov = document.createElement("div");
    ov.className = "eval-block eval-overall-row";
    var hWrap = document.createElement("div");
    hWrap.className = "eval-overall-heading";
    var hov = document.createElement("h4");
    hov.textContent = "종합 의견";
    hWrap.appendChild(hov);
    ov.appendChild(hWrap);
    var cols = document.createElement("div");
    cols.className = "eval-overall-cols";
    var chartHost = document.createElement("div");
    chartHost.className = "eval-overall-chart-host";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 280 280");
    svg.setAttribute("class", "eval-radar-svg");
    svg.setAttribute("id", EVAL_RADAR_SVG_ID);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "영역별 총점 육각형 그래프");
    chartHost.appendChild(svg);
    var textHost = document.createElement("div");
    textHost.className = "eval-overall-text-host";
    var taO = document.createElement("textarea");
    taO.className = "school-filter-select eval-overall-ta";
    taO.rows = 8;
    taO.id = "ev_overall";
    taO.setAttribute("aria-label", "종합 의견");
    taO.value = ev.overall || "";
    textHost.appendChild(taO);
    cols.appendChild(chartHost);
    cols.appendChild(textHost);
    ov.appendChild(cols);
    host.appendChild(ov);
    paintEvalRadarSvg(svg);
  }

  function saveEvalFromForm(sid) {
    if (!sid) return;
    var ev = emptyEvalBlock();
    for (var a = 0; a < EVAL_AREA_COUNT; a++) {
      var scores = [];
      for (var q = 0; q < EVAL_QUESTIONS_PER_AREA; q++) {
        var picked = document.querySelector('input[name="ev_a' + a + "_q" + q + '"]:checked');
        var num = picked ? parseInt(picked.value, 10) : NaN;
        scores.push(num >= 1 && num <= 5 ? num : null);
      }
      var noteEl = document.getElementById("ev_note_" + a);
      ev.areas[a] = { scores: scores, note: noteEl ? String(noteEl.value || "") : "" };
    }
    var oa = document.getElementById("ev_overall");
    ev.overall = oa ? String(oa.value || "") : "";
    ev.updatedAt = new Date().toISOString();
    state.evaluations[sid] = ev;
    persist();
    toast("총평을 저장했습니다.");
    renderAll();
  }

  function resetCurrentEvalForm(sid) {
    if (!sid) {
      toast("학생을 선택하세요.");
      return;
    }
    if (!confirm("입력 내용을 모두 초기화하시겠습니까?")) return;
    clearSiInputClosedFlag(sid, "eval");
    state.evaluations[sid] = emptyEvalBlock();
    persist();
    studentIndividualPanelTab = "eval";
    renderStudentIndividualDetail(sid);
    toast("초기화했습니다.");
  }

  function renderGridTimetableEditors() {
    var hostC = els.classGridTimetableHost;
    var hostT = els.teacherGridTimetableHost;
    if (!hostC || !hostT) return;
    function buildTable(which) {
      var g = state.timetableGrids[which];
      var tbl = document.createElement("table");
      tbl.className = "cm-grid-tt-editor";
      var thead = document.createElement("thead");
      var trh = document.createElement("tr");
      var th0 = document.createElement("th");
      th0.textContent = "교시";
      trh.appendChild(th0);
      (g.weekdayLabels || ["월", "화", "수", "목", "금"]).forEach(function (lab) {
        var th = document.createElement("th");
        th.textContent = lab;
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      tbl.appendChild(thead);
      var tbod = document.createElement("tbody");
      g.rows.forEach(function (row, ri) {
        var tr = document.createElement("tr");
        var td0 = document.createElement("td");
        var inp0 = document.createElement("input");
        inp0.type = "text";
        inp0.className = "school-filter-select cm-input-text cm-grid-tt-cell";
        inp0.value = row.period || "";
        inp0.setAttribute("data-grid", which);
        inp0.setAttribute("data-kind", "period");
        inp0.setAttribute("data-row", String(ri));
        td0.appendChild(inp0);
        tr.appendChild(td0);
        for (var c = 0; c < 5; c++) {
          var td = document.createElement("td");
          var inp = document.createElement("input");
          inp.type = "text";
          inp.className = "school-filter-select cm-input-text cm-grid-tt-cell";
          inp.value = (row.cells && row.cells[c]) || "";
          inp.setAttribute("data-grid", which);
          inp.setAttribute("data-kind", "cell");
          inp.setAttribute("data-row", String(ri));
          inp.setAttribute("data-col", String(c));
          td.appendChild(inp);
          tr.appendChild(td);
        }
        tbod.appendChild(tr);
      });
      tbl.appendChild(tbod);
      return tbl;
    }
    hostC.innerHTML = "";
    hostT.innerHTML = "";
    hostC.appendChild(buildTable("class"));
    hostT.appendChild(buildTable("teacher"));
  }

  function saveGridTimetablesFromDom() {
    ["class", "teacher"].forEach(function (which) {
      var host = which === "class" ? els.classGridTimetableHost : els.teacherGridTimetableHost;
      if (!host) return;
      var g = state.timetableGrids[which];
      host.querySelectorAll(".cm-grid-tt-cell[data-grid=\"" + which + "\"]").forEach(function (inp) {
        var ri = parseInt(inp.getAttribute("data-row"), 10);
        if (isNaN(ri) || !g.rows[ri]) return;
        var kind = inp.getAttribute("data-kind");
        if (kind === "period") g.rows[ri].period = String(inp.value || "").trim();
        else if (kind === "cell") {
          var c = parseInt(inp.getAttribute("data-col"), 10);
          if (!isNaN(c) && c >= 0 && c < 5) g.rows[ri].cells[c] = String(inp.value || "").trim();
        }
      });
    });
    persist();
    toast("시간표를 저장했습니다.");
  }

  function syncSettingsForm() {
    var h = state.homeroom;
    if (els.setSchool) els.setSchool.value = h.schoolName || "";
    if (els.setGrade) els.setGrade.value = h.grade || "";
    if (els.setClassNum) els.setClassNum.value = h.className || "";
    if (els.setTeacher) els.setTeacher.value = h.teacherName || "";
  }

  function renderAll() {
    fillStudentSelects();
    renderHome();
    renderRoster();
    renderStudentIndividualList();
    if (currentTabId === "student-individual") {
      if (studentIndividualOpenId && !studentById(studentIndividualOpenId)) {
        showStudentIndividualList();
      } else if (studentIndividualOpenId) {
        renderStudentIndividualDetail(studentIndividualOpenId);
      }
    }
    syncCounselListGateUi();
    renderCounselManageUi();
    renderVolunteer();
    syncSettingsForm();
  }

  function activateTab(id) {
    if (!id) id = "home";
    closeAllModals();
    currentTabId = id;
    if (els.tabs) {
      els.tabs.forEach(function (btn) {
        var on = btn.getAttribute("data-tab-target") === id;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    if (els.panels) {
      els.panels.forEach(function (panel) {
        var on = panel.getAttribute("data-tab-panel") === id;
        panel.toggleAttribute("hidden", !on);
        panel.classList.toggle("is-active", on);
      });
    }
    if (id === "student-individual") syncStudentIndividualTabView();
    if (id === "counsel") renderCounselManageUi();
    if (id === "roster") setRosterFolder("basic");
    if (id === "office") {
      syncSettingsForm();
      renderGridTimetableEditors();
    }
    if (id === "portfolio") renderPortfolioInputStatusCard();
    try {
      history.replaceState(null, "", "#" + id);
    } catch (e) {}
  }

  function hashToTab() {
    var h = (location.hash || "").replace(/^#/, "").trim();
    if (h === "life" || h === "volunteer") h = "home";
    if (h === "eval") h = "student-individual";
    if (h === "settings" || h === "basic-settings" || h === "data-room") h = "office";
    var ok = false;
    if (els.tabs) {
      els.tabs.forEach(function (b) {
        if (b.getAttribute("data-tab-target") === h) ok = true;
      });
    }
    return ok ? h : "home";
  }

  function closeResetModalAndMaybeReopenSettings() {
    var reopen = reopenTabAfterReset;
    reopenTabAfterReset = null;
    closeAllModals();
    if (reopen) {
      activateTab(reopen);
    }
  }

  var calEvPopoverAnchor = null;

  function onCalEvPopoverResize() {
    positionCalendarEventPopover();
  }

  function closeCalendarEventPopover() {
    if (els.calEvBackdrop) {
      els.calEvBackdrop.hidden = true;
      els.calEvBackdrop.setAttribute("aria-hidden", "true");
    }
    if (els.calEvPopover) els.calEvPopover.hidden = true;
    calEvPopoverAnchor = null;
    window.removeEventListener("resize", onCalEvPopoverResize);
  }

  function positionCalendarEventPopover() {
    var pop = els.calEvPopover;
    var anchor = calEvPopoverAnchor;
    if (!pop || pop.hidden || !anchor) return;
    var r = anchor.getBoundingClientRect();
    var pr = pop.getBoundingClientRect();
    var left = r.left + r.width / 2 - pr.width / 2;
    var top = r.bottom + 10;
    var pad = 10;
    left = Math.max(pad, Math.min(left, window.innerWidth - pr.width - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - pr.height - pad));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function renderCalEvCategoryPicker(selectedId) {
    var host = document.getElementById("calEvCategoryPicker");
    var hid = document.getElementById("calEvCategory");
    if (!host || !hid) return;
    var id0 = String(selectedId || "").trim() || "other";
    if (!calendarCategoryById(id0)) id0 = "other";
    hid.value = id0;
    host.innerHTML = CAL_EVENT_CATEGORIES.map(function (c) {
      var on = c.id === id0;
      return (
        '<button type="button" class="cm-cal-ev-cat-opt' +
        (on ? " is-selected" : "") +
        '" data-cal-cat="' +
        escapeHtml(c.id) +
        '" role="option" aria-selected="' +
        (on ? "true" : "false") +
        '"><span class="cm-cal-ev-cat-dot" style="background:' +
        escapeHtml(c.color) +
        '"></span><span class="cm-cal-ev-cat-lbl">' +
        escapeHtml(c.label) +
        "</span></button>"
      );
    }).join("");
  }

  function syncCalEvAllDayUi() {
    var cb = document.getElementById("calEvAllDay");
    var wrap = document.getElementById("calEvTimeWrap");
    var stInp = document.getElementById("calEvStart");
    var etInp = document.getElementById("calEvEnd");
    if (!cb || !wrap || !stInp || !etInp) return;
    var on = !!cb.checked;
    wrap.classList.toggle("is-disabled", on);
    stInp.disabled = on;
    etInp.disabled = on;
    stInp.required = !on;
  }

  function openCalendarEventPopover(evId, ymd, anchorEl) {
    if (!els.calEvBackdrop || !els.calEvPopover || !els.calEvForm) return;
    calEvPopoverAnchor = anchorEl || null;
    var idInp = document.getElementById("calEvId");
    var dateInp = document.getElementById("calEvDate");
    var catHid = document.getElementById("calEvCategory");
    var stInp = document.getElementById("calEvStart");
    var etInp = document.getElementById("calEvEnd");
    var allDayCb = document.getElementById("calEvAllDay");
    var titInp = document.getElementById("calEvTitle");
    var detInp = document.getElementById("calEvDetail");
    var titleEl = document.getElementById("calEvPopoverTitle");
    if (!idInp || !dateInp || !catHid || !stInp || !etInp || !allDayCb || !titInp || !detInp) return;
    var pickCat = "class";
    if (evId) {
      var ev = null;
      var arr0 = state.dashboard.calendarEvents || [];
      for (var i = 0; i < arr0.length; i++) {
        if (arr0[i].id === evId) {
          ev = arr0[i];
          break;
        }
      }
      if (!ev) {
        toast("일정을 찾을 수 없습니다.");
        return;
      }
      pickCat = ev.categoryId;
      idInp.value = ev.id;
      dateInp.value = ev.date;
      allDayCb.checked = !!ev.allDay;
      if (ev.allDay) {
        stInp.value = "";
        etInp.value = "";
      } else {
        stInp.value = ev.startTime || "09:00";
        etInp.value = ev.endTime || "";
      }
      titInp.value = ev.title || "";
      detInp.value = ev.detail || "";
      if (els.calEvDelete) els.calEvDelete.hidden = false;
      if (titleEl) titleEl.textContent = "일정 수정";
    } else {
      idInp.value = "";
      dateInp.value = ymd || state.dashboard.selectedDate || todayYmd();
      allDayCb.checked = false;
      stInp.value = "09:00";
      etInp.value = "";
      titInp.value = "";
      detInp.value = "";
      if (els.calEvDelete) els.calEvDelete.hidden = true;
      if (titleEl) titleEl.textContent = "새 일정";
    }
    renderCalEvCategoryPicker(pickCat);
    syncCalEvAllDayUi();
    els.calEvBackdrop.hidden = false;
    els.calEvBackdrop.removeAttribute("aria-hidden");
    els.calEvPopover.hidden = false;
    requestAnimationFrame(function () {
      positionCalendarEventPopover();
      window.addEventListener("resize", onCalEvPopoverResize);
    });
  }

  function timeStrToMin(t) {
    var p = String(t || "").split(":");
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return NaN;
    return h * 60 + m;
  }

  function handleCalEvFormSubmit(e) {
    e.preventDefault();
    var dash = state.dashboard;
    if (!Array.isArray(dash.calendarEvents)) dash.calendarEvents = [];
    var idInp = document.getElementById("calEvId");
    var dateInp = document.getElementById("calEvDate");
    var catHid = document.getElementById("calEvCategory");
    var stInp = document.getElementById("calEvStart");
    var etInp = document.getElementById("calEvEnd");
    var allDayCb = document.getElementById("calEvAllDay");
    var titInp = document.getElementById("calEvTitle");
    var detInp = document.getElementById("calEvDetail");
    if (!idInp || !dateInp || !catHid || !stInp || !etInp || !allDayCb || !titInp || !detInp) return;
    var date = String(dateInp.value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast("날짜가 올바르지 않습니다.");
      return;
    }
    var title = String(titInp.value || "").trim();
    if (!title) {
      toast("제목을 입력하세요.");
      return;
    }
    var cat = String(catHid.value || "other");
    if (!calendarCategoryById(cat)) cat = "other";
    var allDay = !!allDayCb.checked;
    var st = "";
    var et = "";
    if (!allDay) {
      st = String(stInp.value || "").trim().slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(st)) {
        toast("시작 시간을 선택하세요.");
        return;
      }
      et = String(etInp.value || "").trim().slice(0, 5);
      if (et && !/^\d{2}:\d{2}$/.test(et)) et = "";
      if (et) {
        var a = timeStrToMin(st);
        var b = timeStrToMin(et);
        if (!isNaN(a) && !isNaN(b) && b < a) {
          toast("종료 시간은 시작 이후여야 합니다.");
          return;
        }
      }
    }
    var detail = String(detInp.value || "").trim();
    var rec = {
      id: String(idInp.value || "").trim() || uid(),
      date: date,
      categoryId: cat,
      allDay: allDay,
      startTime: st,
      endTime: et,
      title: title.slice(0, 120),
      detail: detail.slice(0, 2000),
    };
    var existingId = String(idInp.value || "").trim();
    if (existingId) {
      dash.calendarEvents = dash.calendarEvents.filter(function (x) {
        return x.id !== existingId;
      });
    }
    dash.calendarEvents.push(rec);
    persist();
    closeCalendarEventPopover();
    renderHome();
    toast("일정을 저장했습니다.");
  }

  function handleCalEvDelete() {
    var idInp = document.getElementById("calEvId");
    if (!idInp) return;
    var eid = String(idInp.value || "").trim();
    if (!eid) return;
    if (!confirm("이 일정을 삭제할까요?")) return;
    state.dashboard.calendarEvents = (state.dashboard.calendarEvents || []).filter(function (x) {
      return x.id !== eid;
    });
    persist();
    closeCalendarEventPopover();
    renderHome();
    toast("일정을 삭제했습니다.");
  }

  function handleHomeCalDblClick(e) {
    if (!e.target.closest("#homeCalendarHost")) return;
    if (e.target.closest(".cm-home-cal-ev")) return;
    var cell = e.target.closest(".cm-home-cal-cell");
    if (!cell || cell.classList.contains("cm-home-cal-cell--pad")) return;
    var ymd = cell.getAttribute("data-cal-date");
    if (!ymd) return;
    e.preventDefault();
    openCalendarEventPopover(null, ymd, cell);
  }

  function handleHomePanelClick(e) {
    var t = e.target.closest("[data-home-action]");
    if (!t) return;
    var act = t.getAttribute("data-home-action");
    var dash = state.dashboard;
    if (act === "cal-ev-open") {
      var eid = t.getAttribute("data-cal-ev-id");
      if (eid) openCalendarEventPopover(eid, null, t);
      return;
    }
    if (act === "cal-prev") {
      dash.calendarYm = ymAddMonths(dash.calendarYm, -1);
      persist();
      renderHome();
      return;
    }
    if (act === "cal-next") {
      dash.calendarYm = ymAddMonths(dash.calendarYm, 1);
      persist();
      renderHome();
      return;
    }
    if (act === "cal-today") {
      dash.selectedDate = todayYmd();
      dash.calendarYm = dash.selectedDate.slice(0, 7);
      persist();
      renderHome();
      return;
    }
    if (act === "cal-pick") {
      var ds = t.getAttribute("data-date");
      if (ds) {
        dash.selectedDate = ds;
        dash.calendarYm = ds.slice(0, 7);
        persist();
        renderHome();
      }
      return;
    }
    if (act === "todo-add") {
      if (!isSchoolDayYmd(dash.selectedDate)) return;
      var tin = document.getElementById("homeTodoNewInput");
      var tx = tin && tin.value ? String(tin.value).trim() : "";
      if (!tx) {
        toast("할 일 내용을 입력하세요.");
        return;
      }
      if (!dash.todosByDate[dash.selectedDate]) dash.todosByDate[dash.selectedDate] = [];
      dash.todosByDate[dash.selectedDate].push({ id: uid(), text: tx, done: false });
      persist();
      if (tin) tin.value = "";
      renderHome();
      return;
    }
    if (act === "todo-del") {
      var tid = t.getAttribute("data-todo-id");
      var arr = dash.todosByDate[dash.selectedDate] || [];
      dash.todosByDate[dash.selectedDate] = arr.filter(function (x) {
        return x.id !== tid;
      });
      persist();
      renderHome();
      return;
    }
    if (act === "att-save") {
      persist();
      toast("출결을 저장했습니다.");
      renderHome();
    }
  }

  function handleHomePanelChange(e) {
    var inp = e.target;
    if (!inp || !inp.matches) return;
    if (inp.matches("input.cm-home-todo-cb") && inp.type === "checkbox") {
      var tid = inp.getAttribute("data-todo-id");
      var dash = state.dashboard;
      var arr = dash.todosByDate[dash.selectedDate] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === tid) {
          arr[i].done = !!inp.checked;
          break;
        }
      }
      persist();
      renderHome();
      return;
    }
    if (inp.matches("input.cm-home-att-inp")) {
      var sid = inp.getAttribute("data-home-att-sid");
      var d0 = state.dashboard.selectedDate;
      if (!isSchoolDayYmd(d0) || !sid) return;
      if (!state.dashboard.attendanceByDate[d0]) state.dashboard.attendanceByDate[d0] = {};
      state.dashboard.attendanceByDate[d0][sid] = String(inp.value || "").trim();
      persist();
      renderHome();
    }
  }

  function applyAttCalModal() {
    var inp = document.getElementById("attCalMonthInput");
    var host = document.getElementById("attCalHost");
    if (!inp || !host) return;
    var v = String(inp.value || "").trim();
    if (!/^\d{4}-\d{2}$/.test(v)) {
      toast("조회할 달을 선택하세요.");
      return;
    }
    var p = v.split("-");
    var y = parseInt(p[0], 10);
    var mo = parseInt(p[1], 10);
    if (isNaN(y) || isNaN(mo)) return;
    host.innerHTML = buildAttendanceCalendarInnerHTML(y, mo);
  }

  function openAttCalModal() {
    var mEl = document.getElementById("attCalMonthInput");
    var host = document.getElementById("attCalHost");
    if (mEl) {
      var ym = state.dashboard.calendarYm;
      if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) ym = currentYm();
      mEl.value = ym;
    }
    if (host) {
      host.innerHTML =
        '<p class="cm-home-muted">조회할 달을 확인한 뒤 <strong>조회</strong>를 누르세요.</p>';
    }
    openModal("attCalModal");
  }

  function warnIfExternalLibsMissing() {
    var missing = [];
    if (typeof XLSX === "undefined") missing.push("엑셀");
    if (typeof JSZip === "undefined") missing.push("ZIP");
    if (typeof html2pdf === "undefined") missing.push("PDF");
    if (!missing.length) return;
    setTimeout(function () {
      toast("일부 기능(" + missing.join(", ") + ")을 쓰려면 인터넷 연결 후 페이지를 새로고침해 주세요.");
    }, 500);
  }

  function bindEvents() {
    if (!els.tabs || !els.tabs.length) {
      toast("화면 구성을 불러오지 못했습니다. index.html을 다시 실행해 주세요.");
      return;
    }
    els.tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        activateTab(btn.getAttribute("data-tab-target"));
      });
    });
    document.querySelectorAll("[data-go-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        activateTab(b.getAttribute("data-go-tab"));
      });
    });
    if (els.panelHome) {
      els.panelHome.addEventListener("click", handleHomePanelClick);
      els.panelHome.addEventListener("change", handleHomePanelChange);
      els.panelHome.addEventListener("dblclick", handleHomeCalDblClick);
    }
    if (els.calEvForm) els.calEvForm.addEventListener("submit", handleCalEvFormSubmit);
    if (els.calEvPopover) {
      els.calEvPopover.addEventListener("click", function (e) {
        var b = e.target.closest("[data-cal-cat]");
        if (!b) return;
        e.preventDefault();
        renderCalEvCategoryPicker(b.getAttribute("data-cal-cat"));
      });
    }
    var calEvAllDay = document.getElementById("calEvAllDay");
    if (calEvAllDay) calEvAllDay.addEventListener("change", syncCalEvAllDayUi);
    if (els.calEvCancel) els.calEvCancel.addEventListener("click", closeCalendarEventPopover);
    if (els.calEvDelete) els.calEvDelete.addEventListener("click", handleCalEvDelete);
    if (els.calEvBackdrop) els.calEvBackdrop.addEventListener("click", closeCalendarEventPopover);
    var openAttCal = document.getElementById("openAttCalModal");
    if (openAttCal) openAttCal.addEventListener("click", openAttCalModal);
    var attCalApply = document.getElementById("attCalApplyBtn");
    if (attCalApply) attCalApply.addEventListener("click", applyAttCalModal);
    var closeAttCal = document.getElementById("closeAttCalModal");
    if (closeAttCal) closeAttCal.addEventListener("click", closeAllModals);
    var attCalModal = document.getElementById("attCalModal");
    if (attCalModal) {
      attCalModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "attcal") closeAllModals();
      });
    }
    window.addEventListener("hashchange", function () {
      activateTab(hashToTab());
    });

    if (els.btnRosterExportExcel) els.btnRosterExportExcel.addEventListener("click", exportRosterExcel);
    if (els.btnRosterImportExcel && els.rosterExcelImport) {
      els.btnRosterImportExcel.addEventListener("click", function () {
        els.rosterExcelImport.click();
      });
    }
    if (els.rosterExcelImport) {
      els.rosterExcelImport.addEventListener("change", function () {
        var f = els.rosterExcelImport.files && els.rosterExcelImport.files[0];
        els.rosterExcelImport.value = "";
        if (!f) return;
        if (
          !confirm(
            "엑셀 내용을 명단에 반영합니다.\n·「이름」이 있는 행만 읽습니다.\n·같은 번호가 이미 있으면 해당 학생 정보를 덮어씁니다.\n·번호가 없거나 새 번호면 학생이 추가됩니다.\n·파일에 없는 학생은 삭제되지 않습니다.\n\n계속할까요?"
          )
        ) {
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importRosterExcelBuffer(reader.result);
          } catch (err) {
            toast("엑셀을 읽는 중 오류가 났습니다.");
          }
        };
        reader.onerror = function () {
          toast("파일을 읽을 수 없습니다.");
        };
        reader.readAsArrayBuffer(f);
      });
    }

    var btnDrRosterExp = document.getElementById("btnDataRoomRosterExport");
    if (btnDrRosterExp) btnDrRosterExp.addEventListener("click", exportRosterExcel);
    var btnDrRosterImp = document.getElementById("btnDataRoomRosterImport");
    if (btnDrRosterImp && els.rosterExcelImport) {
      btnDrRosterImp.addEventListener("click", function () {
        els.rosterExcelImport.click();
      });
    }
    var btnDrEvExp = document.getElementById("btnDataRoomEventCatalogExport");
    if (btnDrEvExp) btnDrEvExp.addEventListener("click", exportEventCatalogExcel);

    var btnRosterEventCatalogExport = document.getElementById("btnRosterEventCatalogExport");
    var btnRosterEventCatalogImport = document.getElementById("btnRosterEventCatalogImport");
    var rosterEventCatalogImportEl = document.getElementById("rosterEventCatalogImport");
    if (btnRosterEventCatalogExport) btnRosterEventCatalogExport.addEventListener("click", exportEventCatalogExcel);
    if (btnRosterEventCatalogImport && rosterEventCatalogImportEl) {
      btnRosterEventCatalogImport.addEventListener("click", function () {
        rosterEventCatalogImportEl.click();
      });
    }
    if (rosterEventCatalogImportEl) {
      rosterEventCatalogImportEl.addEventListener("change", function () {
        var f = rosterEventCatalogImportEl.files && rosterEventCatalogImportEl.files[0];
        rosterEventCatalogImportEl.value = "";
        if (!f) return;
        if (
          !confirm(
            "엑셀의 행사 목록으로 등록된 행사를 바꿉니다.\n·같은 행사명·담당부서·시행월 조합은 기존 ID를 유지합니다.\n·목록에서 빠진 행사를 학생이 선택 중이던 경우, 직접 입력된 텍스트로 바뀝니다.\n\n계속할까요?"
          )
        ) {
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importEventCatalogExcelBuffer(reader.result);
          } catch (err) {
            toast("엑셀을 읽는 중 오류가 났습니다.");
          }
        };
        reader.onerror = function () {
          toast("파일을 읽을 수 없습니다.");
        };
        reader.readAsArrayBuffer(f);
      });
    }

    var btnRosterEventCatalogView = document.getElementById("btnRosterEventCatalogView");
    if (btnRosterEventCatalogView) btnRosterEventCatalogView.addEventListener("click", openRosterEventCatalogViewModal);
    var closeRosterEventCatalogViewModal = document.getElementById("closeRosterEventCatalogViewModal");
    var closeRosterEventCatalogViewBtn = document.getElementById("closeRosterEventCatalogViewBtn");
    var rosterEventCatalogViewModal = document.getElementById("rosterEventCatalogViewModal");
    if (closeRosterEventCatalogViewModal) closeRosterEventCatalogViewModal.addEventListener("click", closeAllModals);
    if (closeRosterEventCatalogViewBtn) closeRosterEventCatalogViewBtn.addEventListener("click", closeAllModals);
    if (rosterEventCatalogViewModal) {
      rosterEventCatalogViewModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "ecview") closeAllModals();
      });
    }

    function wireNeisTimetableSemImport(inputEl, optForceSem) {
      if (!inputEl) return;
      inputEl.addEventListener("change", function () {
        var f = inputEl.files && inputEl.files[0];
        inputEl.value = "";
        if (!f) return;
        var semLine =
          optForceSem === "s1"
            ? "이번에 고른 파일은 「1학기」 시간표로만 저장합니다.\n"
            : optForceSem === "s2"
              ? "이번에 고른 파일은 「2학기」 시간표로만 저장합니다.\n"
              : "표 제목에 「1학기」「2학기」가 있으면 각각 해당 학기 시간표로 저장합니다.\n";
        if (
          !confirm(
            "NEIS에서 받은 학생별 시간표 엑셀을 반영합니다.\n·명단의 번호와 NEIS의 「N번」이 같으면 그 학생에게 적용됩니다.\n·숫자가 다르면(출석번호만 NEIS에 있는 경우 등) 같은 이름이 한 명일 때만 연결합니다.\n·월~금, 1~7교시만 저장합니다.\n·" +
              semLine +
              "\n계속할까요?"
          )
        ) {
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importNeisTimetableBuffer(reader.result, optForceSem);
          } catch (err) {
            toast("파일을 읽는 중 오류가 났습니다.");
          }
        };
        reader.onerror = function () {
          toast("파일을 읽을 수 없습니다.");
        };
        reader.readAsArrayBuffer(f);
      });
    }
    wireNeisTimetableSemImport(els.neisTimetableImportS1, "s1");
    wireNeisTimetableSemImport(els.neisTimetableImportS2, "s2");

    if (els.neisClubImport) {
      els.neisClubImport.addEventListener("change", function () {
        var f = els.neisClubImport.files && els.neisClubImport.files[0];
        els.neisClubImport.value = "";
        if (!f) return;
        if (
          !confirm(
            "엑셀의 동아리 열을 명단에 반영합니다.\n·「동아리」열과 「번호」·「학번」또는「이름」열이 있어야 합니다.\n·일치하는 학생의 동아리만 바뀌며, 새 학생은 추가되지 않습니다.\n\n계속할까요?"
          )
        ) {
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importClubExcelBuffer(reader.result);
          } catch (err) {
            toast("엑셀을 읽는 중 오류가 났습니다.");
          }
        };
        reader.onerror = function () {
          toast("파일을 읽을 수 없습니다.");
        };
        reader.readAsArrayBuffer(f);
      });
    }

    document.querySelectorAll("[data-roster-folder]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var f = btn.getAttribute("data-roster-folder");
        if (f) setRosterFolder(f);
      });
    });

    if (els.openAddStudentModal) els.openAddStudentModal.addEventListener("click", function () {
      if (els.rosterForm) els.rosterForm.reset();
      openModal("addStudentModal");
      if (els.modalStudentName) requestAnimationFrame(function () { els.modalStudentName.focus(); });
    });
    if (els.closeAddStudentModal) els.closeAddStudentModal.addEventListener("click", closeAllModals);
    if (els.cancelAddStudentModal) els.cancelAddStudentModal.addEventListener("click", closeAllModals);
    if (els.addStudentModal) {
      els.addStudentModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "add") closeAllModals();
      });
    }

    if (els.rosterForm) {
      els.rosterForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(els.rosterForm);
        var name = (fd.get("name") || "").toString().trim();
        if (!name) return;
        state.students.push({
          id: uid(),
          name: name,
          number: (fd.get("number") || "").toString().trim(),
          gender: (fd.get("gender") || "").toString(),
          studentPhone: (fd.get("studentPhone") || "").toString().trim(),
          guardianPhone: (fd.get("guardianPhone") || "").toString().trim(),
          careerInterest: (fd.get("careerInterest") || "").toString().trim(),
          clubName: "",
          clubRoom: "",
          clubTeacher: "",
          specialNotes: "",
          note: "",
          oneRole: (fd.get("oneRole") || "").toString().trim(),
          electiveSubjects: emptyElectiveSlots(),
          participationSemSlots: emptyParticipationSemSlots(),
          participationEvents: participationSemSlotsToLegacySummary(emptyParticipationSemSlots(), state.participationEventCatalog || []),
          autonomousActivities: [],
          careerActivities: [],
          siInputClosedVolunteer: false,
          siInputClosedAutonomous: false,
          siInputClosedCareer: false,
          siInputClosedEval: false,
          timetable: "",
          neisTimetable: null,
          neisTimetableS1: null,
          neisTimetableS2: null,
        });
        persist();
        closeAllModals();
        toast("학생을 추가했습니다.");
        renderAll();
      });
    }

    if (els.detailForm) {
      els.detailForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var sid = els.detailStudentId.value;
        var s = studentById(sid);
        if (!s) return;
        s.name = document.getElementById("d_name").value.trim();
        s.number = document.getElementById("d_number").value.trim();
        s.gender = document.getElementById("d_gender").value;
        s.studentPhone = document.getElementById("d_stPhone").value.trim();
        s.guardianPhone = document.getElementById("d_gpPhone").value.trim();
        s.careerInterest = document.getElementById("d_career").value.trim();
        s.clubName = document.getElementById("d_club").value.trim();
        s.specialNotes = document.getElementById("d_special").value.trim();
        s.oneRole = document.getElementById("d_oneRole").value.trim();
        s.electiveSubjects = coerceElectiveSubjects(electiveSlotsFromFormPrefix("d_"));
        if (!s.name) {
          toast("이름은 필수입니다.");
          return;
        }
        persist();
        closeAllModals();
        toast("저장했습니다.");
        renderAll();
      });
    }
    if (els.closeDetailModal) els.closeDetailModal.addEventListener("click", closeAllModals);
    if (els.cancelDetailModal) els.cancelDetailModal.addEventListener("click", closeAllModals);
    if (els.studentDetailModal) {
      els.studentDetailModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "detail") closeAllModals();
      });
    }
    if (els.detailDeleteStudent) {
      els.detailDeleteStudent.addEventListener("click", function () {
        if (!els.detailStudentId) return;
        var sid = els.detailStudentId.value;
        if (!sid || !confirm("이 학생과 관련 데이터를 모두 삭제할까요?")) return;
        deleteStudentCascade(sid);
        closeAllModals();
        toast("삭제했습니다.");
        renderAll();
      });
    }

    var closeStudentCurriculumModal = document.getElementById("closeStudentCurriculumModal");
    var closeStudentCurriculumBtn = document.getElementById("closeStudentCurriculumBtn");
    var studentCurriculumModal = document.getElementById("studentCurriculumModal");
    if (closeStudentCurriculumModal) closeStudentCurriculumModal.addEventListener("click", closeAllModals);
    if (closeStudentCurriculumBtn) closeStudentCurriculumBtn.addEventListener("click", closeAllModals);
    if (studentCurriculumModal) {
      studentCurriculumModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "curr") closeAllModals();
      });
    }

    var closeStudentActivityModal = document.getElementById("closeStudentActivityModal");
    var cancelStudentActivityModal = document.getElementById("cancelStudentActivityModal");
    var btnSiActSave = document.getElementById("btnSiActSave");
    var studentActivityInputModal = document.getElementById("studentActivityInputModal");
    if (closeStudentActivityModal) closeStudentActivityModal.addEventListener("click", closeAllModals);
    if (cancelStudentActivityModal) cancelStudentActivityModal.addEventListener("click", closeAllModals);
    if (btnSiActSave) btnSiActSave.addEventListener("click", submitStudentActivityInputFromModal);
    var siActNameInp = document.getElementById("siActName");
    if (siActNameInp && !siActNameInp.dataset.cmSiActComboWired) {
      siActNameInp.dataset.cmSiActComboWired = "1";
      siActNameInp.placeholder = SI_ACT_NAME_PLACEHOLDER;
      siActNameInp.title = SI_ACT_NAME_PLACEHOLDER;
      siActNameInp.addEventListener("focus", function () {
        siActNameInp.classList.add("cm-roster-ev-combo--editing");
        if (participationTextIsEmptySentinel(siActNameInp.value)) siActNameInp.value = "";
      });
      siActNameInp.addEventListener("blur", function () {
        siActNameInp.classList.remove("cm-roster-ev-combo--editing");
        var sidEl = document.getElementById("siActStudentId");
        var sid = sidEl && sidEl.value ? String(sidEl.value) : "";
        syncSiActNameComboVisual(sid);
      });
      siActNameInp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          siActNameInp.blur();
        }
      });
    }
    if (studentActivityInputModal) {
      studentActivityInputModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "siact") closeAllModals();
      });
    }

    if (els.counselEditForm) {
      els.counselEditForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!els.ceditId || !els.ceditDate || !els.ceditTopics || !els.ceditBody) return;
        var id = els.ceditId.value;
        var row = findRowById(state.counselings, id);
        if (!row) return;
        row.counselingDate = els.ceditDate.value || "";
        row.topics = (els.ceditTopics.value || "").trim();
        row.body = (els.ceditBody.value || "").trim();
        if (!persist()) return;
        closeAllModals();
        toast("수정했습니다.");
        renderAll();
      });
    }
    if (els.closeCounselEditModal) els.closeCounselEditModal.addEventListener("click", closeAllModals);
    if (els.cancelCounselEdit) els.cancelCounselEdit.addEventListener("click", closeAllModals);
    if (els.counselEditModal) {
      els.counselEditModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "cedit") closeAllModals();
      });
    }

    var btnRosterVolunteerSave = document.getElementById("btnRosterVolunteerSave");
    var btnRosterVolunteerAddRow = document.getElementById("btnRosterVolunteerAddRow");
    if (btnRosterVolunteerSave) btnRosterVolunteerSave.addEventListener("click", saveVolunteersFromEditor);
    if (btnRosterVolunteerAddRow) btnRosterVolunteerAddRow.addEventListener("click", appendVolunteerExtraBlankRow);

    if (!document.documentElement.dataset.cmEvalRadarDelegation) {
      document.documentElement.dataset.cmEvalRadarDelegation = "1";
      document.addEventListener("change", function (e) {
        var t = e.target;
        if (t && t.matches && t.matches('input[type="radio"][name^="ev_a"]')) {
          updateEvalRadarFromForm();
        }
      });
    }

    document.querySelectorAll("[data-open-settings]").forEach(function (b) {
      b.addEventListener("click", function () {
        activateTab("office");
      });
    });
    if (els.btnPortfolioPdf) {
      els.btnPortfolioPdf.addEventListener("click", exportPortfoliosPdf);
    }
    var btnPortfolioAiPromptView = document.getElementById("btnPortfolioAiPromptView");
    var closePortfolioAiPromptModal = document.getElementById("closePortfolioAiPromptModal");
    var cancelPortfolioAiPromptModal = document.getElementById("cancelPortfolioAiPromptModal");
    var btnCopyPortfolioAiPrompt = document.getElementById("btnCopyPortfolioAiPrompt");
    var portfolioAiPromptModal = document.getElementById("portfolioAiPromptModal");
    if (btnPortfolioAiPromptView) btnPortfolioAiPromptView.addEventListener("click", openPortfolioAiPromptModal);
    if (closePortfolioAiPromptModal) closePortfolioAiPromptModal.addEventListener("click", closeAllModals);
    if (cancelPortfolioAiPromptModal) cancelPortfolioAiPromptModal.addEventListener("click", closeAllModals);
    if (btnCopyPortfolioAiPrompt) btnCopyPortfolioAiPrompt.addEventListener("click", copyPortfolioAiPrompt);
    if (portfolioAiPromptModal) {
      portfolioAiPromptModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "pfprompt") closeAllModals();
      });
    }
    if (els.pfSelectAllCb) {
      els.pfSelectAllCb.addEventListener("change", onPfSelectAllMasterChange);
    }
    if (els.pfStudentListHost && !els.pfStudentListHost.dataset.cmPfSelectSync) {
      els.pfStudentListHost.dataset.cmPfSelectSync = "1";
      els.pfStudentListHost.addEventListener("change", function (e) {
        if (e.target && e.target.matches && e.target.matches(".pf-student-cb")) {
          syncPfSelectAllMasterCheckbox();
        }
      });
    }

    var pfPanel = document.getElementById("panel-portfolio");
    if (pfPanel && !pfPanel.dataset.cmPfStatusFilter) {
      pfPanel.dataset.cmPfStatusFilter = "1";
      pfPanel.addEventListener("change", function (e) {
        if (e.target && e.target.id === "pfStatusFilterIncomplete") renderPortfolioInputStatusCard();
      });
    }

    if (els.homeroomBasicForm) {
      els.homeroomBasicForm.addEventListener("submit", function (e) {
        e.preventDefault();
        state.homeroom.schoolName = (els.setSchool && els.setSchool.value) || "";
        state.homeroom.grade = (els.setGrade && els.setGrade.value) || "";
        state.homeroom.className = (els.setClassNum && els.setClassNum.value) || "";
        state.homeroom.teacherName = (els.setTeacher && els.setTeacher.value) || "";
        persist();
        toast("학급 정보를 저장했습니다.");
        renderAll();
      });
    }
    if (els.btnSaveGridTimetables) {
      els.btnSaveGridTimetables.addEventListener("click", function () {
        saveGridTimetablesFromDom();
      });
    }

    if (els.btnExportJson) {
      els.btnExportJson.addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "classmanager_backup_" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("백업 파일을 저장했습니다.");
      });
    }
    if (els.importJsonFile) {
      els.importJsonFile.addEventListener("change", function () {
        var f = els.importJsonFile.files && els.importJsonFile.files[0];
        els.importJsonFile.value = "";
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            applyImportedStateObject(JSON.parse(String(reader.result || "{}")));
          } catch (err) {
            toast("백업 파일을 읽을 수 없습니다.");
          }
        };
        reader.onerror = function () {
          toast("파일을 읽을 수 없습니다.");
        };
        reader.readAsText(f, "utf-8");
      });
    }

    if (els.btnOpenResetModal) {
      els.btnOpenResetModal.addEventListener("click", function () {
        reopenTabAfterReset = currentTabId === "office" ? "office" : null;
        openModal("resetAllModal");
      });
    }
    if (els.closeResetModal) els.closeResetModal.addEventListener("click", closeResetModalAndMaybeReopenSettings);
    if (els.cancelResetModal) els.cancelResetModal.addEventListener("click", closeResetModalAndMaybeReopenSettings);
    if (els.resetAllModal) {
      els.resetAllModal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close-modal") === "reset")
          closeResetModalAndMaybeReopenSettings();
      });
    }
    if (els.confirmResetModal) {
      els.confirmResetModal.addEventListener("click", function () {
        reopenTabAfterReset = null;
        state = emptyState();
        if (!persist()) {
          toast("저장소 오류로 초기화가 완료되지 않았을 수 있습니다.");
        } else {
          toast("모든 데이터를 지웠습니다.");
        }
        closeAllModals();
        renderAll();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (els.calEvPopover && !els.calEvPopover.hidden) {
        e.preventDefault();
        closeCalendarEventPopover();
        return;
      }
      if (!isAnyModalOpen()) return;
      e.preventDefault();
      if (els.resetAllModal && !els.resetAllModal.hasAttribute("hidden")) {
        closeResetModalAndMaybeReopenSettings();
      } else {
        closeAllModals();
      }
    });
  }

  cacheEls();
  loadState();
  bindEvents();
  activateTab(hashToTab());
  renderAll();
  warnIfExternalLibsMissing();
})();
