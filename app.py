import copy
import hashlib
import html
import io
import json
import os
import re
import secrets
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

# 배포 시 앱 폴더를 통째로 교체해도 DB가 지워지지 않게 하려면
# CLASSMANAGER_DB_PATH=/절대경로/counseling.db 처럼 영구 저장소를 지정하세요.
_db_override = (os.environ.get("CLASSMANAGER_DB_PATH") or "").strip()
DB_PATH = (
    Path(_db_override).expanduser().resolve()
    if _db_override
    else Path(__file__).resolve().parent / "counseling.db"
)
# 설문/구글폼보내기 등: 프로젝트에 포함된 기본 서식 (.xlsx)
ROSTER_TEMPLATE_PATH = Path(__file__).resolve().parent / "assets" / "student_basic_info_survey.xlsx"
ROSTER_TEMPLATE_DOWNLOAD_NAME = "클래스 매니저.xlsx"
EVAL_ITEM_COUNT = 10
BACKUP_FORMAT_VERSION = 1


def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_student_gender_column(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(students)").fetchall()}
    if "gender" not in cols:
        conn.execute("ALTER TABLE students ADD COLUMN gender TEXT")


# 엑셀 명부 확장 필드 (「학생 기본 정보 기록지」 및 구 서식 열과 호환)
STUDENT_EXTRA_DB_FIELDS = (
    "student_phone",
    "primary_guardian",
    "guardian_phone",
    "hobbies_skills",
    "career_interest",
    "emergency_phone",
    "guardian_relation",
)


def ensure_student_extra_columns(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(students)").fetchall()}
    for col in STUDENT_EXTRA_DB_FIELDS:
        if col not in cols:
            conn.execute(f"ALTER TABLE students ADD COLUMN {col} TEXT")


def ensure_life_record_activity_columns(conn):
    """자율·진로: 활동명, 학생 소감, 교사 관찰."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(life_records)").fetchall()}
    for col in ("activity_name", "student_reflection", "teacher_observation"):
        if col not in cols:
            conn.execute(f"ALTER TABLE life_records ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")


def ensure_evaluation_table(conn):
    score_cols = ",\n".join([f"q{i}_score INTEGER" for i in range(1, EVAL_ITEM_COUNT + 1)])
    comment_cols = ",\n".join(
        [f"q{i}_comment TEXT NOT NULL DEFAULT ''" for i in range(1, EVAL_ITEM_COUNT + 1)]
    )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS student_evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL UNIQUE REFERENCES students(id),
            {score_cols},
            {comment_cols},
            overall_comment TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        )
        """
    )
    cols = {row[1] for row in conn.execute("PRAGMA table_info(student_evaluations)").fetchall()}
    for i in range(1, EVAL_ITEM_COUNT + 1):
        s_col = f"q{i}_score"
        c_col = f"q{i}_comment"
        if s_col not in cols:
            conn.execute(f"ALTER TABLE student_evaluations ADD COLUMN {s_col} INTEGER")
        if c_col not in cols:
            conn.execute(
                f"ALTER TABLE student_evaluations ADD COLUMN {c_col} TEXT NOT NULL DEFAULT ''"
            )
    if "overall_comment" not in cols:
        conn.execute(
            "ALTER TABLE student_evaluations ADD COLUMN overall_comment TEXT NOT NULL DEFAULT ''"
        )
    if "updated_at" not in cols:
        conn.execute("ALTER TABLE student_evaluations ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")


def ensure_homeroom_settings_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS homeroom_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            school_name TEXT NOT NULL DEFAULT '',
            teacher_name TEXT NOT NULL DEFAULT '',
            grade TEXT NOT NULL DEFAULT '',
            class_name TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        )
        """
    )
    cols = {row[1] for row in conn.execute("PRAGMA table_info(homeroom_settings)").fetchall()}
    for col in ("school_name", "teacher_name", "grade", "class_name", "updated_at"):
        if col not in cols:
            conn.execute(
                f"ALTER TABLE homeroom_settings ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"
            )


def ensure_user_feedback_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            read_at TEXT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_feedback_author ON user_feedback (author_user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback (created_at)"
    )


def ensure_app_users_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'pending',
            request_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )


def ensure_app_meta_table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")


def ensure_student_owner_column(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(students)").fetchall()}
    if "owner_user_id" not in cols:
        conn.execute("ALTER TABLE students ADD COLUMN owner_user_id INTEGER REFERENCES app_users(id)")


def _assign_student_owners_from_first_user(conn):
    row = conn.execute("SELECT MIN(id) AS m FROM app_users").fetchone()
    uid = row["m"] if row else None
    if uid is None:
        return
    conn.execute(
        "UPDATE students SET owner_user_id = ? WHERE owner_user_id IS NULL",
        (uid,),
    )


def migrate_students_table_for_per_user_roster(conn):
    """
    UNIQUE(name, number) 제거 → (owner_user_id, name, number) 로 바꿉니다.
    기존 학생은 첫 번째 app_users id(또는 단일 계정)에 귀속됩니다.
    """
    ensure_app_meta_table(conn)
    if conn.execute("SELECT 1 FROM app_meta WHERE k = 'students_per_user_v1'").fetchone():
        return

    ensure_student_owner_column(conn)
    _assign_student_owners_from_first_user(conn)

    create_sql_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='students'"
    ).fetchone()
    create_sql = (create_sql_row["sql"] or "") if create_sql_row else ""
    if "owner_user_id" in create_sql and "UNIQUE" in create_sql and (
        "UNIQUE(owner_user_id" in create_sql.replace(" ", "")
        or "UNIQUE (owner_user_id" in create_sql.replace(" ", "")
    ):
        conn.execute(
            "INSERT OR REPLACE INTO app_meta (k, v) VALUES ('students_per_user_v1', '1')"
        )
        return

    row = conn.execute("SELECT MIN(id) AS m FROM app_users").fetchone()
    fallback_uid = row["m"] if row else None
    if fallback_uid is None:
        return

    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("ALTER TABLE students RENAME TO students_legacy")

    col_defs = [
        "id INTEGER PRIMARY KEY AUTOINCREMENT",
        "name TEXT NOT NULL",
        "number TEXT NOT NULL",
        "gender TEXT",
    ]
    for f in STUDENT_EXTRA_DB_FIELDS:
        col_defs.append(f"{f} TEXT")
    col_defs.append("owner_user_id INTEGER NOT NULL REFERENCES app_users(id)")
    col_defs.append("UNIQUE(owner_user_id, name, number)")
    conn.execute(f"CREATE TABLE students ({', '.join(col_defs)})")

    leg_cols = {r[1] for r in conn.execute("PRAGMA table_info(students_legacy)").fetchall()}
    target_cols = ["id", "name", "number", "gender", *STUDENT_EXTRA_DB_FIELDS, "owner_user_id"]
    exprs: list[str] = []
    for c in target_cols[:-1]:
        if c in leg_cols:
            exprs.append(c)
        elif c == "gender":
            exprs.append("NULL")
        else:
            exprs.append("''")
    if "owner_user_id" in leg_cols:
        exprs.append(f"COALESCE(owner_user_id, {int(fallback_uid)})")
    else:
        exprs.append(str(int(fallback_uid)))
    cols_sql = ", ".join(target_cols)
    sel_sql = ", ".join(exprs)
    conn.execute(f"INSERT INTO students ({cols_sql}) SELECT {sel_sql} FROM students_legacy")
    conn.execute("DROP TABLE students_legacy")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (k, v) VALUES ('students_per_user_v1', '1')"
    )


def ensure_app_user_homeroom_columns(conn):
    """계정별 담임·학급 표시(환영 문구 등). 엑셀의 전역 설정과 분리합니다."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(app_users)").fetchall()}
    for col in ("school_name", "teacher_name", "grade", "class_name"):
        if col not in cols:
            conn.execute(f"ALTER TABLE app_users ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")


def migrate_legacy_homeroom_into_app_users(conn):
    """단일 계정(구버전)만 쓰던 경우에 한해 homeroom_settings(id=1) → 해당 계정으로 이전합니다."""
    n_users = conn.execute("SELECT COUNT(*) AS c FROM app_users").fetchone()["c"]
    if n_users != 1:
        return
    legacy = conn.execute(
        "SELECT school_name, teacher_name, grade, class_name FROM homeroom_settings WHERE id = 1"
    ).fetchone()
    if not legacy:
        return
    keys = ("school_name", "teacher_name", "grade", "class_name")
    if not any((legacy[k] or "").strip() for k in keys):
        return
    u = conn.execute(f"SELECT id, {', '.join(keys)} FROM app_users LIMIT 1").fetchone()
    if not u or not all(not (u[k] or "").strip() for k in keys):
        return
    conn.execute(
        """
        UPDATE app_users SET
            school_name = ?, teacher_name = ?, grade = ?, class_name = ?
        WHERE id = ?
        """,
        (legacy["school_name"], legacy["teacher_name"], legacy["grade"], legacy["class_name"], u["id"]),
    )


_PBKDF2_ITERS = 200_000


def _hash_password_plain(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS, dklen=32
    )
    return f"{salt.hex()}${dk.hex()}"


def _verify_password_plain(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS, dklen=32
        )
        return dk.hex() == dk_hex
    except (ValueError, AttributeError):
        return False


def count_app_users() -> int:
    with get_connection() as conn:
        return int(conn.execute("SELECT COUNT(*) AS c FROM app_users").fetchone()["c"])


def get_app_user_by_id(user_id: int):
    with get_connection() as conn:
        return conn.execute(
            "SELECT id, username, password_hash, display_name, role, status, request_note, created_at FROM app_users WHERE id = ?",
            (user_id,),
        ).fetchone()


def get_app_user_by_username(username: str):
    u = (username or "").strip().lower()
    if not u:
        return None
    with get_connection() as conn:
        return conn.execute(
            "SELECT id, username, password_hash, display_name, role, status, request_note, created_at FROM app_users WHERE lower(username) = ?",
            (u,),
        ).fetchone()


def create_app_user(
    *,
    username: str,
    password: str,
    display_name: str = "",
    request_note: str = "",
    role: str = "user",
    status: str = "pending",
) -> tuple[bool, str]:
    u = (username or "").strip().lower()
    if len(u) < 3 or len(u) > 64:
        return False, "아이디는 3~64자(영문 소문자·숫자·밑줄)로 입력해 주세요."
    if not re.fullmatch(r"[a-z0-9_]+", u):
        return False, "아이디는 영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다."
    if len(password) < 8:
        return False, "비밀번호는 8자 이상이어야 합니다."
    ph = _hash_password_plain(password)
    dn = (display_name or "").strip()
    note = (request_note or "").strip()
    ts = datetime.now().isoformat(timespec="seconds")
    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO app_users (username, password_hash, display_name, role, status, request_note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (u, ph, dn, role, status, note, ts),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        return False, "이미 사용 중인 아이디입니다."
    return True, ""


def try_app_login(username: str, password: str):
    u = get_app_user_by_username(username)
    if not u or not _verify_password_plain(password, u["password_hash"]):
        return None, "아이디 또는 비밀번호가 올바르지 않습니다."
    if u["status"] == "rejected":
        return None, "가입이 거절된 계정입니다. 관리자에게 문의해 주세요."
    return u, ""


def list_app_users_by_status(status: str):
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT id, username, display_name, role, status, request_note, created_at
            FROM app_users
            WHERE status = ?
            ORDER BY datetime(created_at) ASC
            """,
            (status,),
        ).fetchall()


def set_app_user_status(user_id: int, status: str) -> bool:
    if status not in ("pending", "approved", "rejected"):
        return False
    with get_connection() as conn:
        cur = conn.execute("UPDATE app_users SET status = ? WHERE id = ?", (status, user_id))
        conn.commit()
        return cur.rowcount == 1


def list_app_users_approved():
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT id, username, display_name, role, status, created_at
            FROM app_users
            WHERE status = 'approved'
            ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, username ASC
            """
        ).fetchall()


def admin_update_user_password(target_user_id: int, new_password: str) -> tuple[bool, str]:
    if len(new_password or "") < 8:
        return False, "비밀번호는 8자 이상이어야 합니다."
    ph = _hash_password_plain(new_password)
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE app_users SET password_hash = ? WHERE id = ? AND status = 'approved'",
            (ph, target_user_id),
        )
        conn.commit()
        if cur.rowcount != 1:
            return False, "해당 계정을 찾을 수 없거나 승인되지 않은 계정입니다."
    return True, ""


def admin_delete_approved_user(target_user_id: int, acting_admin_id: int) -> tuple[bool, str]:
    """승인된 계정 삭제. 해당 계정 소유 학생·상담·생기부·평가 기록을 함께 삭제합니다."""
    if not is_app_admin(acting_admin_id):
        return False, "관리자만 계정을 삭제할 수 있습니다."
    if target_user_id == acting_admin_id:
        return False, "현재 로그인한 관리자 본인 계정은 이 화면에서 삭제할 수 없습니다."
    tgt = get_app_user_by_id(target_user_id)
    if not tgt or (tgt["status"] or "") != "approved":
        return False, "삭제할 수 있는 승인 계정이 아닙니다."
    if (tgt["role"] or "") == "admin":
        with get_connection() as conn:
            n_adm = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM app_users WHERE role = 'admin' AND status = 'approved'"
                ).fetchone()["c"]
            )
        if n_adm <= 1:
            return False, "마지막 관리자 계정은 삭제할 수 없습니다."
    un = (tgt["username"] or "").strip()
    try:
        with get_connection() as conn:
            sids = [
                int(r["id"])
                for r in conn.execute(
                    "SELECT id FROM students WHERE owner_user_id = ?", (target_user_id,)
                ).fetchall()
            ]
            for sid in sids:
                conn.execute("DELETE FROM counselings WHERE student_id = ?", (sid,))
                conn.execute("DELETE FROM life_records WHERE student_id = ?", (sid,))
                conn.execute("DELETE FROM student_evaluations WHERE student_id = ?", (sid,))
                conn.execute("DELETE FROM students WHERE id = ?", (sid,))
            conn.execute("DELETE FROM user_feedback WHERE author_user_id = ?", (target_user_id,))
            cur = conn.execute("DELETE FROM app_users WHERE id = ?", (target_user_id,))
            conn.commit()
            if cur.rowcount != 1:
                return False, "계정 삭제에 실패했습니다."
    except Exception:
        return False, "삭제 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    return True, f"계정 「{un}」과 해당 명부·기록을 삭제했습니다."


def is_app_admin(user_id: int | None) -> bool:
    if user_id is None:
        return False
    u = get_app_user_by_id(user_id)
    return bool(u and u["role"] == "admin" and u["status"] == "approved")


def insert_user_feedback(author_user_id: int, title: str, body: str) -> tuple[bool, str]:
    t = (title or "").strip()
    b = (body or "").strip()
    if not t:
        return False, "제목을 입력해 주세요."
    if len(t) > 200:
        return False, "제목은 200자 이내로 입력해 주세요."
    if not b:
        return False, "내용을 입력해 주세요."
    if len(b) > 2000:
        return False, "내용은 2000자를 넘을 수 없습니다."
    now = datetime.now().isoformat(timespec="seconds")
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO user_feedback (author_user_id, title, body, created_at, read_at)
            VALUES (?, ?, ?, ?, NULL)
            """,
            (int(author_user_id), t, b, now),
        )
        conn.commit()
    return True, ""


def list_feedback_for_author(author_user_id: int) -> list[dict]:
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT id, title, body, created_at, read_at
            FROM user_feedback
            WHERE author_user_id = ?
            ORDER BY created_at DESC
            """,
            (int(author_user_id),),
        )
        return [dict(r) for r in cur.fetchall()]


def list_all_feedback_for_admin() -> list[dict]:
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT f.id, f.author_user_id, f.title, f.body, f.created_at, f.read_at,
                   u.username AS author_username,
                   u.display_name AS author_display_name
            FROM user_feedback f
            JOIN app_users u ON u.id = f.author_user_id
            ORDER BY (f.read_at IS NOT NULL) ASC, f.created_at DESC
            """
        )
        return [dict(r) for r in cur.fetchall()]


def set_feedback_read_by_admin(feedback_id: int, read: bool) -> None:
    with get_connection() as conn:
        if read:
            conn.execute(
                "UPDATE user_feedback SET read_at = ? WHERE id = ?",
                (datetime.now().isoformat(timespec="seconds"), int(feedback_id)),
            )
        else:
            conn.execute(
                "UPDATE user_feedback SET read_at = NULL WHERE id = ?",
                (int(feedback_id),),
            )
        conn.commit()


def cleanup_demo_students(conn):
    """
    과거 개발 테스트로 들어간 1/a, 2/b 더미 학생은 목록에서 제거합니다.
    상담 기록이 있으면 사용자 데이터일 수 있어 삭제하지 않습니다.
    """
    conn.execute(
        """
        DELETE FROM students
        WHERE lower(name) IN ('a', 'b')
          AND number IN ('1', '2')
          AND id NOT IN (SELECT student_id FROM counselings)
          AND id NOT IN (SELECT student_id FROM life_records)
        """
    )


def migrate_legacy_if_needed(conn):
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='counseling_records'"
    )
    if not cur.fetchone():
        return
    n = conn.execute("SELECT COUNT(*) AS c FROM counselings").fetchone()["c"]
    if n > 0:
        return
    legacy = conn.execute(
        "SELECT student_name, student_number, content, created_at FROM counseling_records"
    ).fetchall()
    uid_row = conn.execute("SELECT MIN(id) AS m FROM app_users").fetchone()
    legacy_owner = int(uid_row["m"]) if uid_row and uid_row["m"] is not None else None
    st_cols = {x[1] for x in conn.execute("PRAGMA table_info(students)").fetchall()}
    use_owner = "owner_user_id" in st_cols and legacy_owner is not None
    for r in legacy:
        nm, num = r["student_name"].strip(), r["student_number"].strip()
        if use_owner:
            conn.execute(
                "INSERT OR IGNORE INTO students (name, number, owner_user_id) VALUES (?, ?, ?)",
                (nm, num, legacy_owner),
            )
            row = conn.execute(
                "SELECT id FROM students WHERE name = ? AND number = ? AND owner_user_id = ?",
                (nm, num, legacy_owner),
            ).fetchone()
        else:
            conn.execute(
                "INSERT OR IGNORE INTO students (name, number) VALUES (?, ?)",
                (nm, num),
            )
            row = conn.execute(
                "SELECT id FROM students WHERE name = ? AND number = ?",
                (nm, num),
            ).fetchone()
        if row:
            conn.execute(
                """
                INSERT INTO counselings (student_id, content, created_at)
                VALUES (?, ?, ?)
                """,
                (row["id"], r["content"].strip(), r["created_at"]),
            )
    conn.execute("DROP TABLE counseling_records")
    conn.commit()


def init_db():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                number TEXT NOT NULL,
                UNIQUE(name, number)
            )
            """
        )
        ensure_student_gender_column(conn)
        ensure_student_extra_columns(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS counselings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS life_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                category TEXT NOT NULL,
                observation TEXT NOT NULL DEFAULT '',
                draft_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_life_records_student_cat ON life_records (student_id, category)"
        )
        ensure_life_record_activity_columns(conn)
        ensure_evaluation_table(conn)
        ensure_homeroom_settings_table(conn)
        ensure_app_users_table(conn)
        ensure_user_feedback_table(conn)
        ensure_app_user_homeroom_columns(conn)
        migrate_legacy_homeroom_into_app_users(conn)
        migrate_students_table_for_per_user_roster(conn)
        cleanup_demo_students(conn)
        conn.commit()
        migrate_legacy_if_needed(conn)


def _number_sort_key(number_str) -> tuple:
    s = str(number_str).strip()
    m = re.search(r"\d+", s)
    if m:
        return (0, int(m.group()), s)
    return (1, 999999, s)


def _current_app_user_id() -> int | None:
    try:
        v = st.session_state.get("auth_user_id")
        return int(v) if v is not None else None
    except Exception:
        return None


def list_students(owner_user_id: int | None = None):
    uid = owner_user_id if owner_user_id is not None else _current_app_user_id()
    if uid is None:
        return []
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT id, name, number, gender
            FROM students
            WHERE owner_user_id = ?
            """,
            (uid,),
        )
        rows = cur.fetchall()
    return sorted(rows, key=lambda r: _number_sort_key(r["number"]))


_STUDENT_DETAIL_SELECT = "id, name, number, gender, " + ", ".join(STUDENT_EXTRA_DB_FIELDS)


def get_student(student_id: int, owner_user_id: int | None = None):
    uid = owner_user_id if owner_user_id is not None else _current_app_user_id()
    if uid is None:
        return None
    with get_connection() as conn:
        cur = conn.execute(
            f"SELECT {_STUDENT_DETAIL_SELECT} FROM students WHERE id = ? AND owner_user_id = ?",
            (student_id, uid),
        )
        return cur.fetchone()


def add_student(
    name: str, number: str, gender: str | None = None, owner_user_id: int | None = None
) -> tuple[bool, str]:
    name, number = name.strip(), number.strip()
    if not name or not number:
        return False, "이름과 번호를 모두 입력해 주세요."
    uid = owner_user_id if owner_user_id is not None else _current_app_user_id()
    if uid is None:
        return False, "로그인이 필요합니다."
    g = normalize_gender(gender) if gender else None
    try:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO students (name, number, gender, owner_user_id) VALUES (?, ?, ?, ?)",
                (name, number, g, uid),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        return False, "이미 명부에 있는 학생입니다. (이름·번호 조합 중복)"
    return True, ""


def _normalize_phone(raw: str) -> str:
    """숫자만 남기고 010-0000-0000 형태로 표시."""
    s = re.sub(r"\D+", "", str(raw or ""))
    if len(s) == 11:
        return f"{s[:3]}-{s[3:7]}-{s[7:]}"
    if len(s) == 10:
        return f"{s[:3]}-{s[3:6]}-{s[6:]}"
    return str(raw or "").strip()


def add_student_form(
    *,
    number: str,
    name: str,
    gender: str | None,
    student_phone: str,
    primary_guardian: str,
    guardian_phone: str,
    hobbies_skills: str,
    career_interest: str,
    owner_user_id: int | None = None,
) -> tuple[bool, str]:
    name_v = str(name or "").strip()
    num_v = str(number or "").strip()
    if not name_v or not num_v:
        return False, "학번과 이름은 필수입니다."
    uid = owner_user_id if owner_user_id is not None else _current_app_user_id()
    if uid is None:
        return False, "로그인이 필요합니다."
    g = normalize_gender(gender) if gender else None
    sp = _normalize_phone(student_phone)
    gp = _normalize_phone(guardian_phone)
    pg = str(primary_guardian or "").strip()
    hs = str(hobbies_skills or "").strip()
    ci = str(career_interest or "").strip()
    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO students (
                    name, number, gender,
                    student_phone, primary_guardian, guardian_phone,
                    hobbies_skills, career_interest, owner_user_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name_v, num_v, g, sp, pg, gp, hs, ci, uid),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        return False, "이미 명부에 있는 학생입니다. (이름·번호 조합 중복)"
    return True, ""


def delete_student(student_id: int, owner_user_id: int | None = None) -> bool:
    """학생과 해당 상담·생기부 메모를 함께 삭제합니다."""
    uid = owner_user_id if owner_user_id is not None else _current_app_user_id()
    if uid is None:
        return False
    with get_connection() as conn:
        conn.execute("DELETE FROM counselings WHERE student_id = ?", (student_id,))
        conn.execute("DELETE FROM life_records WHERE student_id = ?", (student_id,))
        conn.execute("DELETE FROM student_evaluations WHERE student_id = ?", (student_id,))
        cur = conn.execute(
            "DELETE FROM students WHERE id = ? AND owner_user_id = ?",
            (student_id, uid),
        )
        conn.commit()
        return cur.rowcount == 1


def reset_counselings(student_id: int) -> None:
    """학생 기본 정보는 유지하고 상담 기록·생기부(자율·진로·행발) 메모를 모두 삭제합니다."""
    with get_connection() as conn:
        conn.execute("DELETE FROM counselings WHERE student_id = ?", (student_id,))
        conn.execute("DELETE FROM life_records WHERE student_id = ?", (student_id,))
        conn.commit()


def delete_counseling(counseling_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM counselings WHERE id = ?", (counseling_id,))
        conn.commit()
        return cur.rowcount == 1


def update_counseling(counseling_id: int, content: str) -> bool:
    content = content.strip()
    if not content:
        return False
    with get_connection() as conn:
        conn.execute(
            "UPDATE counselings SET content = ? WHERE id = ?",
            (content, counseling_id),
        )
        conn.commit()
    return True


# 생기부 참고용: 자율·진로·행동발달 (category: autonomous / career / behavior)
LIFE_RECORD_CATEGORIES: dict[str, str] = {
    "autonomous": "자율활동",
    "career": "진로활동",
    "behavior": "행동발달 특기사항",
}


_LIFE_SELECT_FIELDS = (
    "id, observation, draft_text, activity_name, student_reflection, "
    "teacher_observation, created_at"
)


def list_life_records(student_id: int, category: str):
    with get_connection() as conn:
        cur = conn.execute(
            f"""
            SELECT {_LIFE_SELECT_FIELDS}
            FROM life_records
            WHERE student_id = ? AND category = ?
            ORDER BY datetime(created_at) DESC
            """,
            (student_id, category),
        )
        return cur.fetchall()


def add_life_record(
    student_id: int,
    category: str,
    observation: str = "",
    draft_text: str = "",
    activity_name: str = "",
    student_reflection: str = "",
    teacher_observation: str = "",
) -> bool:
    if category not in LIFE_RECORD_CATEGORIES:
        return False
    if category == "behavior":
        obs = (observation or "").strip()
        dr = (draft_text or "").strip()
        if not obs and not dr:
            return False
        an = sr = to = ""
    else:
        an = (activity_name or "").strip()
        sr = (student_reflection or "").strip()
        to = (teacher_observation or "").strip()
        if not an and not sr and not to:
            return False
        obs = dr = ""
    ts = datetime.now().isoformat(timespec="seconds")
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO life_records (
                student_id, category, observation, draft_text,
                activity_name, student_reflection, teacher_observation, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (student_id, category, obs, dr, an, sr, to, ts),
        )
        conn.commit()
    return True


def update_life_record(
    record_id: int,
    category: str,
    observation: str = "",
    draft_text: str = "",
    activity_name: str = "",
    student_reflection: str = "",
    teacher_observation: str = "",
) -> bool:
    if category == "behavior":
        obs = (observation or "").strip()
        dr = (draft_text or "").strip()
        if not obs and not dr:
            return False
        with get_connection() as conn:
            cur = conn.execute(
                """
                UPDATE life_records SET
                    observation = ?, draft_text = ?,
                    activity_name = '', student_reflection = '', teacher_observation = ''
                WHERE id = ?
                """,
                (obs, dr, record_id),
            )
            conn.commit()
            return cur.rowcount == 1
    an = (activity_name or "").strip()
    sr = (student_reflection or "").strip()
    to = (teacher_observation or "").strip()
    if not an and not sr and not to:
        return False
    with get_connection() as conn:
        cur = conn.execute(
            """
            UPDATE life_records SET
                activity_name = ?, student_reflection = ?, teacher_observation = ?,
                observation = '', draft_text = ''
            WHERE id = ?
            """,
            (an, sr, to, record_id),
        )
        conn.commit()
        return cur.rowcount == 1


def delete_life_record(record_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM life_records WHERE id = ?", (record_id,))
        conn.commit()
        return cur.rowcount == 1


def get_life_record(record_id: int):
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT id, student_id, category, observation, draft_text,
                   activity_name, student_reflection, teacher_observation, created_at
            FROM life_records WHERE id = ?
            """,
            (record_id,),
        )
        return cur.fetchone()


EVALUATION_QUESTIONS = (
    "학생은 수업 시간에 과제와 활동에 얼마나 주도적으로 참여하였나요? 단순히 자리에 앉아 있는 수준을 넘어 질문·발표·토론에서 의미 있는 참여를 보였는지 살펴봐 주세요. 학기 초와 비교해 참여 태도에 변화가 있었는지도 확인해 주세요.",
    "학생은 안내된 과제를 기한 내에 성실히 수행하였나요? 제출물의 양뿐 아니라 내용의 정확성, 정리 수준, 개선 흔적을 함께 확인해 주세요. 반복 과제에서 성장의 흐름이 보였는지도 평가해 주세요.",
    "학생은 스스로 학습 목표를 세우고 실행하려는 태도를 보였나요? 어려움이 생겼을 때 포기하기보다 방법을 찾아보는 시도가 있었는지 살펴봐 주세요. 교사의 지시 없이도 학습을 이어가려는 힘이 있는지 확인해 주세요.",
    "학생은 모둠 활동에서 자신의 역할을 책임 있게 수행하였나요? 타인의 의견을 경청하고 존중하며 필요한 순간에 자신의 생각을 적절히 표현하였는지 확인해 주세요. 갈등 상황에서 해결을 위한 성숙한 태도를 보였는지도 살펴봐 주세요.",
    "학생은 학교 및 학급의 규칙을 이해하고 일관되게 지켰나요? 지각·준비물·약속 이행 등 기본 생활 태도에서 신뢰를 주는 모습을 보였는지 확인해 주세요. 실수가 있었더라도 이후 태도 개선이 있었는지도 함께 살펴봐 주세요.",
    "학생은 새로운 과제나 낯선 상황에서 문제를 스스로 분석하고 해결하려고 하였나요? 실패나 어려움을 만났을 때 회피하지 않고 대안을 탐색하는 태도를 보였는지 확인해 주세요. 결과뿐 아니라 해결 과정의 성실성과 창의성도 함께 평가해 주세요.",
    "학생은 자신의 흥미와 강점을 바탕으로 진로를 탐색하려는 노력을 보였나요? 진로 관련 활동(탐색, 체험, 조사, 상담 등)에 실제로 참여하고 이를 자신의 계획과 연결하였는지 살펴봐 주세요. 진로 인식이 더 구체화되었는지도 확인해 주세요.",
    "학생은 또래 및 교사와의 관계에서 예의와 배려를 실천하였나요? 공동체 안에서 소외되는 사람 없이 함께하려는 태도와 상호 존중의 모습이 있었는지 확인해 주세요. 일상적인 언행이 학급 분위기에 긍정적으로 기여하였는지도 살펴봐 주세요.",
    "학생은 1년 동안 자신의 강점과 약점을 인식하고 개선하려는 모습을 보였나요? 피드백을 수용해 실제 행동 변화로 연결하였는지 확인해 주세요. 성과뿐 아니라 성장의 방향성과 성찰의 깊이도 함께 평가해 주세요.",
    "학생은 학업·생활·관계 영역에서 전반적으로 균형 잡힌 태도를 유지하였나요? 자신에게 맡겨진 역할을 수행하며 학급과 학교 공동체에 긍정적으로 기여하였는지 확인해 주세요. 종합적으로 보았을 때 다음 단계로의 성장 가능성이 충분한지도 평가해 주세요.",
)


def get_student_evaluation(student_id: int):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM student_evaluations WHERE student_id = ?",
            (student_id,),
        ).fetchone()
        if row:
            return row
        data = {"student_id": student_id, "overall_comment": "", "updated_at": ""}
        for i in range(1, EVAL_ITEM_COUNT + 1):
            data[f"q{i}_score"] = None
            data[f"q{i}_comment"] = ""
        return data


def get_homeroom_settings(user_id: int | None = None) -> dict[str, str]:
    """로그인한 계정 기준 담임·학급 정보. 계정이 있으면 전역 테이블과 섞지 않습니다."""
    uid = user_id
    if uid is None:
        try:
            uid = st.session_state.get("auth_user_id")
        except Exception:
            uid = None
    empty = {"school_name": "", "teacher_name": "", "grade": "", "class_name": ""}
    if uid is not None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT school_name, teacher_name, grade, class_name FROM app_users WHERE id = ?",
                (uid,),
            ).fetchone()
        if row:
            return {
                "school_name": (row["school_name"] or "").strip(),
                "teacher_name": (row["teacher_name"] or "").strip(),
                "grade": (row["grade"] or "").strip(),
                "class_name": (row["class_name"] or "").strip(),
            }
        return empty.copy()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT school_name, teacher_name, grade, class_name FROM homeroom_settings WHERE id = 1"
        ).fetchone()
    if not row:
        return empty.copy()
    return {
        "school_name": (row["school_name"] or "").strip(),
        "teacher_name": (row["teacher_name"] or "").strip(),
        "grade": (row["grade"] or "").strip(),
        "class_name": (row["class_name"] or "").strip(),
    }


def homeroom_profile_is_complete(user_id: int) -> bool:
    d = get_homeroom_settings(user_id)
    return all(d.get(k, "").strip() for k in ("school_name", "teacher_name", "grade", "class_name"))


def bulk_apply_activity_records(
    *,
    student_ids: list[int],
    category: str,
    activity_name: str,
    activity_date: str,
    activity_content: str,
    teacher_observation: str,
) -> tuple[int, int]:
    """
    자율/진로 활동을 선택 학생에게 일괄 적용합니다.
    중복 기준: 학생+영역+활동명+활동일(YYYY-MM-DD) 동일 시 건너뜀.
    return: (성공 건수, 중복 건너뜀 건수)
    """
    if category not in ("autonomous", "career"):
        return 0, 0
    ids = [int(x) for x in student_ids if x is not None]
    if not ids:
        return 0, 0
    an = (activity_name or "").strip()
    ac = (activity_content or "").strip()
    to = (teacher_observation or "").strip()
    if not an:
        return 0, 0
    created_at = f"{activity_date}T00:00:00"
    added = 0
    duplicated = 0
    with get_connection() as conn:
        for sid in ids:
            exists = conn.execute(
                """
                SELECT id
                FROM life_records
                WHERE student_id = ?
                  AND category = ?
                  AND activity_name = ?
                  AND substr(created_at, 1, 10) = ?
                """,
                (sid, category, an, activity_date),
            ).fetchone()
            if exists:
                duplicated += 1
                continue
            conn.execute(
                """
                INSERT INTO life_records (
                    student_id, category,
                    observation, draft_text,
                    activity_name, student_reflection, teacher_observation, created_at
                ) VALUES (?, ?, '', '', ?, ?, ?, ?)
                """,
                (sid, category, an, ac, to, created_at),
            )
            added += 1
        conn.commit()
    return added, duplicated


def count_activity_duplicates(
    *,
    student_ids: list[int],
    category: str,
    activity_name: str,
    activity_date: str,
) -> int:
    ids = [int(x) for x in student_ids if x is not None]
    if not ids or category not in ("autonomous", "career") or not (activity_name or "").strip():
        return 0
    an = (activity_name or "").strip()
    q_marks = ", ".join(["?"] * len(ids))
    params = [category, an, activity_date] + ids
    with get_connection() as conn:
        row = conn.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM life_records
            WHERE category = ?
              AND activity_name = ?
              AND substr(created_at, 1, 10) = ?
              AND student_id IN ({q_marks})
            """,
            params,
        ).fetchone()
    return int(row["c"]) if row else 0


def save_homeroom_settings(
    school_name: str = "",
    teacher_name: str = "",
    grade: str = "",
    class_name: str = "",
    *,
    user_id: int | None = None,
) -> None:
    sn = (school_name or "").strip()
    tn = (teacher_name or "").strip()
    gr = (grade or "").strip()
    cn = (class_name or "").strip()
    ts = datetime.now().isoformat(timespec="seconds")
    with get_connection() as conn:
        uid = user_id
        if uid is None:
            try:
                uid = st.session_state.get("auth_user_id")
            except Exception:
                uid = None
        if uid is not None:
            conn.execute(
                """
                UPDATE app_users
                SET school_name = ?, teacher_name = ?, grade = ?, class_name = ?
                WHERE id = ?
                """,
                (sn, tn, gr, cn, uid),
            )
        else:
            conn.execute(
                """
                INSERT INTO homeroom_settings (id, school_name, teacher_name, grade, class_name, updated_at)
                VALUES (1, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    school_name=excluded.school_name,
                    teacher_name=excluded.teacher_name,
                    grade=excluded.grade,
                    class_name=excluded.class_name,
                    updated_at=excluded.updated_at
                """,
                (sn, tn, gr, cn, ts),
            )
        conn.commit()


def delete_all_students_for_owner_conn(conn, owner_user_id: int) -> None:
    """같은 연결·트랜잭션 안에서 이 계정 소유 학생과 하위 기록을 삭제합니다."""
    sids = [
        int(r["id"])
        for r in conn.execute(
            "SELECT id FROM students WHERE owner_user_id = ?", (owner_user_id,)
        ).fetchall()
    ]
    for sid in sids:
        conn.execute("DELETE FROM counselings WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM life_records WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM student_evaluations WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM students WHERE id = ?", (sid,))


def export_account_backup_zip(user_id: int) -> tuple[bytes | None, str | None]:
    """현재 로그인 계정의 학생·기록만 ZIP(JSON)으로 묶습니다."""
    u = get_app_user_by_id(user_id)
    if not u:
        return None, "계정 정보를 찾을 수 없습니다."
    homeroom = get_homeroom_settings(user_id)
    manifest = {
        "format_version": BACKUP_FORMAT_VERSION,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "username": u["username"],
        "display_name": (u["display_name"] or "").strip(),
    }
    students_out: list[dict] = []
    counselings_out: list[dict] = []
    life_out: list[dict] = []
    eval_out: list[dict] = []
    feedback_out: list[dict] = []

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM students WHERE owner_user_id = ? ORDER BY id",
            (user_id,),
        ).fetchall()
        for fr in conn.execute(
            """
            SELECT title, body, created_at, read_at
            FROM user_feedback
            WHERE author_user_id = ?
            ORDER BY id
            """,
            (user_id,),
        ).fetchall():
            feedback_out.append(
                {
                    "title": fr["title"],
                    "body": fr["body"],
                    "created_at": fr["created_at"],
                    "read_at": fr["read_at"],
                }
            )
    for row in rows:
        d = {k: row[k] for k in row.keys()}
        bid = int(d.pop("id"))
        d.pop("owner_user_id", None)
        d["backup_student_id"] = bid
        students_out.append(d)
        for c in list_counselings(bid):
            counselings_out.append(
                {
                    "backup_student_id": bid,
                    "content": c["content"],
                    "created_at": c["created_at"],
                }
            )
        for cat in LIFE_RECORD_CATEGORIES:
            for lr in list_life_records(bid, cat):
                life_out.append(
                    {
                        "backup_student_id": bid,
                        "category": cat,
                        "observation": lr["observation"],
                        "draft_text": lr["draft_text"],
                        "activity_name": lr["activity_name"],
                        "student_reflection": lr["student_reflection"],
                        "teacher_observation": lr["teacher_observation"],
                        "created_at": lr["created_at"],
                    }
                )
        er = get_student_evaluation(bid)
        if isinstance(er, sqlite3.Row) and er["id"] is not None:
            evd = {k: er[k] for k in er.keys() if k not in ("id", "student_id")}
            eval_out.append({"backup_student_id": bid, **evd})

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("homeroom.json", json.dumps(homeroom, ensure_ascii=False, indent=2))
        zf.writestr("students.json", json.dumps(students_out, ensure_ascii=False, indent=2))
        zf.writestr("counselings.json", json.dumps(counselings_out, ensure_ascii=False, indent=2))
        zf.writestr("life_records.json", json.dumps(life_out, ensure_ascii=False, indent=2))
        zf.writestr("evaluations.json", json.dumps(eval_out, ensure_ascii=False, indent=2))
        zf.writestr("feedback.json", json.dumps(feedback_out, ensure_ascii=False, indent=2))
    return buf.getvalue(), None


def import_account_backup_zip(
    content: bytes, target_user_id: int, *, replace_existing: bool
) -> tuple[bool, str]:
    """백업 ZIP을 현재 계정(target_user_id) 명부로 복원합니다."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(content), "r")
    except zipfile.BadZipFile:
        return False, "ZIP 파일이 아니거나 손상되었습니다."
    with zf:
        try:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            homeroom = json.loads(zf.read("homeroom.json").decode("utf-8"))
            students_in = json.loads(zf.read("students.json").decode("utf-8"))
            counselings_in = json.loads(zf.read("counselings.json").decode("utf-8"))
            life_in = json.loads(zf.read("life_records.json").decode("utf-8"))
            eval_in = json.loads(zf.read("evaluations.json").decode("utf-8"))
        except (KeyError, json.JSONDecodeError, UnicodeDecodeError):
            return False, "백업 파일 구성이 올바르지 않습니다."
        feedback_in: list | None = None
        if "feedback.json" in zf.namelist():
            try:
                feedback_in = json.loads(zf.read("feedback.json").decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                feedback_in = []
            if not isinstance(feedback_in, list):
                feedback_in = []

    if int(manifest.get("format_version", 0)) != BACKUP_FORMAT_VERSION:
        return False, "지원하지 않는 백업 버전입니다."
    if not isinstance(students_in, list):
        return False, "학생 데이터 형식이 올바르지 않습니다."

    with get_connection() as conn:
        existing = conn.execute(
            "SELECT COUNT(*) AS c FROM students WHERE owner_user_id = ?",
            (target_user_id,),
        ).fetchone()["c"]
        if existing > 0 and not replace_existing:
            return (
                False,
                "이미 명부에 학생이 있습니다. 덮어쓰기에 체크하거나 학생을 비운 뒤 복원하세요.",
            )
        try:
            conn.execute("BEGIN")
            if replace_existing or existing > 0:
                delete_all_students_for_owner_conn(conn, target_user_id)

            id_map: dict[int, int] = {}
            cols_stu = ["name", "number", "gender", *STUDENT_EXTRA_DB_FIELDS, "owner_user_id"]
            ph = ", ".join(["?"] * len(cols_stu))

            for stu in students_in:
                if "backup_student_id" not in stu:
                    raise ValueError("backup_student_id 누락")
                old_id = int(stu["backup_student_id"])
                vals = [
                    stu.get("name") or "",
                    stu.get("number") or "",
                    stu.get("gender"),
                ]
                for f in STUDENT_EXTRA_DB_FIELDS:
                    vals.append(stu.get(f) if stu.get(f) is not None else "")
                vals.append(target_user_id)
                conn.execute(
                    f"INSERT INTO students ({', '.join(cols_stu)}) VALUES ({ph})",
                    vals,
                )
                new_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
                id_map[old_id] = new_id

            for c in counselings_in:
                oid = int(c["backup_student_id"])
                if oid not in id_map:
                    continue
                conn.execute(
                    """
                    INSERT INTO counselings (student_id, content, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (id_map[oid], c.get("content") or "", c.get("created_at") or ""),
                )

            for lr in life_in:
                oid = int(lr["backup_student_id"])
                if oid not in id_map:
                    continue
                cat = lr.get("category") or ""
                if cat not in LIFE_RECORD_CATEGORIES:
                    continue
                conn.execute(
                    """
                    INSERT INTO life_records (
                        student_id, category, observation, draft_text,
                        activity_name, student_reflection, teacher_observation, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        id_map[oid],
                        cat,
                        lr.get("observation") or "",
                        lr.get("draft_text") or "",
                        lr.get("activity_name") or "",
                        lr.get("student_reflection") or "",
                        lr.get("teacher_observation") or "",
                        lr.get("created_at") or datetime.now().isoformat(timespec="seconds"),
                    ),
                )

            score_cols = ", ".join([f"q{i}_score" for i in range(1, EVAL_ITEM_COUNT + 1)])
            comment_cols = ", ".join([f"q{i}_comment" for i in range(1, EVAL_ITEM_COUNT + 1)])
            all_cols = f"{score_cols}, {comment_cols}, overall_comment, updated_at"
            ph_eval = ", ".join(["?"] * (EVAL_ITEM_COUNT * 2 + 2))

            for ev in eval_in:
                oid = int(ev["backup_student_id"])
                if oid not in id_map:
                    continue
                nid = id_map[oid]
                has_score = any(
                    ev.get(f"q{i}_score") is not None for i in range(1, EVAL_ITEM_COUNT + 1)
                )
                has_ov = bool((ev.get("overall_comment") or "").strip())
                if not has_score and not has_ov:
                    continue
                vals = []
                for i in range(1, EVAL_ITEM_COUNT + 1):
                    vals.append(ev.get(f"q{i}_score"))
                for i in range(1, EVAL_ITEM_COUNT + 1):
                    vals.append(ev.get(f"q{i}_comment") or "")
                vals.append(ev.get("overall_comment") or "")
                vals.append(ev.get("updated_at") or datetime.now().isoformat(timespec="seconds"))
                conn.execute("DELETE FROM student_evaluations WHERE student_id = ?", (nid,))
                conn.execute(
                    f"INSERT INTO student_evaluations (student_id, {all_cols}) VALUES (?, {ph_eval})",
                    [nid] + vals,
                )

            if feedback_in is not None:
                conn.execute(
                    "DELETE FROM user_feedback WHERE author_user_id = ?",
                    (target_user_id,),
                )
                for fb in feedback_in:
                    tit = (fb.get("title") or "").strip()
                    bod = (fb.get("body") or "").strip()
                    if not tit or not bod:
                        continue
                    conn.execute(
                        """
                        INSERT INTO user_feedback (author_user_id, title, body, created_at, read_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            target_user_id,
                            tit[:200],
                            bod[:2000],
                            fb.get("created_at") or datetime.now().isoformat(timespec="seconds"),
                            fb.get("read_at"),
                        ),
                    )

            sn = (homeroom.get("school_name") or "").strip()
            tn = (homeroom.get("teacher_name") or "").strip()
            gr = (homeroom.get("grade") or "").strip()
            cn = (homeroom.get("class_name") or "").strip()
            conn.execute(
                """
                UPDATE app_users SET school_name = ?, teacher_name = ?, grade = ?, class_name = ?
                WHERE id = ?
                """,
                (sn, tn, gr, cn, target_user_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            return False, "복원 중 오류가 발생했습니다. 데이터는 변경되지 않았습니다."

    return True, "백업에서 복원했습니다."


def save_student_evaluation(student_id: int, scores: list[int], comments: list[str], overall: str):
    if len(scores) != EVAL_ITEM_COUNT or len(comments) != EVAL_ITEM_COUNT:
        return False, "평가 문항 수가 올바르지 않습니다."
    for s in scores:
        if s is None or int(s) < 1 or int(s) > 5:
            return False, "모든 문항의 점수를 1~5점으로 입력해 주세요."
    ov = (overall or "").strip()
    if not ov:
        return False, "교사 총평을 입력해 주세요."
    score_cols = ", ".join([f"q{i}_score" for i in range(1, EVAL_ITEM_COUNT + 1)])
    comment_cols = ", ".join([f"q{i}_comment" for i in range(1, EVAL_ITEM_COUNT + 1)])
    all_cols = f"{score_cols}, {comment_cols}, overall_comment, updated_at"
    placeholders = ", ".join(["?"] * (EVAL_ITEM_COUNT * 2 + 2))
    vals = [int(s) for s in scores] + [(c or "").strip() for c in comments] + [
        ov,
        datetime.now().isoformat(timespec="seconds"),
    ]
    updates = ", ".join(
        [f"q{i}_score = ?" for i in range(1, EVAL_ITEM_COUNT + 1)]
        + [f"q{i}_comment = ?" for i in range(1, EVAL_ITEM_COUNT + 1)]
        + ["overall_comment = ?", "updated_at = ?"]
    )
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM student_evaluations WHERE student_id = ?",
            (student_id,),
        ).fetchone()
        if existing:
            conn.execute(
                f"UPDATE student_evaluations SET {updates} WHERE student_id = ?",
                vals + [student_id],
            )
        else:
            conn.execute(
                f"INSERT INTO student_evaluations (student_id, {all_cols}) VALUES (?, {placeholders})",
                [student_id] + vals,
            )
        conn.commit()
    return True, ""


def _norm_col_key(label) -> str:
    s = str(label).strip().lower().replace(" ", "").replace("_", "")
    return s


NAME_COLUMN_ALIASES = frozenset(
    {
        "이름",
        "학생이름",
        "학생",
        "성명",
        "name",
        "studentname",
        "student",
        "student_name",
        "학생성명",
    }
)
NUMBER_COLUMN_ALIASES = frozenset(
    {
        "번호",
        "학번",
        "반번호",
        "no",
        "number",
        "studentnumber",
        "student_number",
        "좌석번호",
        "출석번호",
    }
)
GENDER_COLUMN_ALIASES = frozenset(
    {
        "성별",
        "gender",
        "sex",
        "남녀",
    }
)

# 정규화된 엑셀 헤더(_norm_col_key) → DB 컬럼명
EXTRA_HEADER_TO_FIELD: dict[str, str] = {}
for _field, _aliases in (
    (
        "student_phone",
        (
            "본인휴대폰번호",
            "본인휴대전화",
            "본인연락처",
            "학생연락처",
            "학생휴대폰",
            "학생전화",
            "학생전화번호",
            "studentphone",
            "student_phone",
            "mobile",
        ),
    ),
    (
        "primary_guardian",
        (
            "주보호자",
            "주보호자명",
            "대표보호자",
            "보호자성함",
            "primaryguardian",
            "primary_guardian",
        ),
    ),
    (
        "guardian_phone",
        (
            "보호자휴대폰번호",
            "보호자휴대전화",
            "보호자연락처주",
            "보호자연락처(주)",
            "학부모연락처",
            "보호자연락처",
            "학부모전화",
            "parentphone",
            "guardianphone",
            "guardian_phone",
        ),
    ),
    (
        "hobbies_skills",
        (
            "취미나특기",
            "취미및특기",
            "취미/특기",
            "특기",
            "취미",
            "hobbies",
            "specialskills",
            "hobbies_skills",
        ),
    ),
    (
        "emergency_phone",
        (
            "비상연락처보조",
            "비상연락처(보조)",
            "비상연락처",
            "보조연락처",
            "emergencyphone",
            "emergency_phone",
        ),
    ),
    (
        "guardian_relation",
        (
            "보호자관계",
            "보호자관계(모/부/조부모등)",
            "보호자관계모부조부모등",
            "학부모관계",
            "관계",
            "guardianrelation",
            "guardian_relation",
        ),
    ),
    (
        "career_interest",
        (
            "희망진로관심분야",
            "희망진로/관심분야",
            "희망진로",
            "관심분야",
            "진로",
            "희망진로및관심분야",
            "career",
            "careerinterest",
            "career_interest",
        ),
    ),
):
    for a in _aliases:
        EXTRA_HEADER_TO_FIELD[a] = _field


def detect_roster_columns(df: pd.DataFrame) -> tuple[str | None, str | None, str | None]:
    if df is None or df.columns.size == 0:
        return None, None, None
    name_col, num_col, gender_col = None, None, None
    for c in df.columns:
        key = _norm_col_key(c)
        if key in NAME_COLUMN_ALIASES and name_col is None:
            name_col = c
        if key in NUMBER_COLUMN_ALIASES and num_col is None:
            num_col = c
        if key in GENDER_COLUMN_ALIASES and gender_col is None:
            gender_col = c
    return name_col, num_col, gender_col


def detect_extra_roster_columns(df: pd.DataFrame) -> dict[str, str | None]:
    """엑셀 열 → DB 확장 필드 매핑. 매칭되는 열이 없으면 해당 키는 None."""
    found: dict[str, str | None] = {f: None for f in STUDENT_EXTRA_DB_FIELDS}
    if df is None or df.columns.size == 0:
        return found
    for c in df.columns:
        key = _norm_col_key(c)
        field = EXTRA_HEADER_TO_FIELD.get(key)
        if field is not None and found[field] is None:
            found[field] = c
    return found


def parse_homeroom_settings_from_excel_bytes(data: bytes) -> dict[str, str]:
    """
    엑셀 전체 시트를 훑어 기초정보(학교명/선생님 성함/학년/반)를 추출합니다.
    형식: 라벨은 첫 칸, 값은 같은 행의 뒤쪽 칸 중 첫 값.
    """
    result = {"school_name": "", "teacher_name": "", "grade": "", "class_name": ""}
    key_map = {
        "학교명": "school_name",
        "학교": "school_name",
        "선생님성함": "teacher_name",
        "선생님이름": "teacher_name",
        "담임성함": "teacher_name",
        "담임이름": "teacher_name",
        "학년": "grade",
        "반": "class_name",
    }
    try:
        wb = __import__("openpyxl").load_workbook(io.BytesIO(data), data_only=True)
    except Exception:
        return result

    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            label = _cell_to_str(row[0])
            if not label:
                continue
            label_key = _norm_col_key(label)
            field = key_map.get(label_key)
            if field is None or result[field]:
                continue
            value = ""
            for cell in row[1:]:
                candidate = _cell_to_str(cell)
                if candidate:
                    value = candidate
                    break
            if value:
                result[field] = value
    try:
        wb.close()
    except Exception:
        pass
    return result


def parse_roster_dataframe_from_excel_bytes(data: bytes) -> tuple[pd.DataFrame | None, str | None]:
    """
    학생 명부 데이터프레임 추출:
    1) 첫 시트 헤더형(기존)
    2) 시트 내 '학생 기본정보' 블록(라벨형 템플릿)
    """
    try:
        xls = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
    except Exception as e:
        return None, f"엑셀을 읽을 수 없습니다. (.xlsx 형식인지 확인해 주세요) — {e!s}"

    # 1) 시트 내 "학생 기본정보" 블록 탐색 (우선)
    for sheet in xls.sheet_names:
        raw = pd.read_excel(io.BytesIO(data), sheet_name=sheet, header=None, engine="openpyxl")
        if raw.empty:
            continue
        marker_row_idx = None
        for i in range(len(raw)):
            left = _norm_col_key(raw.iat[i, 0])
            if left == "학생기본정보":
                marker_row_idx = i
                break
        if marker_row_idx is None:
            continue
        header_idx = marker_row_idx + 1
        if header_idx >= len(raw):
            continue
        headers = [_cell_to_str(v) for v in raw.iloc[header_idx].tolist()]
        if not any(headers):
            continue
        data_rows = raw.iloc[header_idx + 1 :].copy()
        data_rows.columns = headers
        # 완전 빈 행 제거
        data_rows = data_rows[data_rows.apply(lambda r: any(_cell_to_str(v) for v in r), axis=1)]
        if data_rows.empty:
            continue
        ncol, mcol, gcol = detect_roster_columns(data_rows)
        if ncol and mcol:
            return data_rows.reset_index(drop=True), None

    # 2) 첫 시트 일반 헤더(기존 포맷) fallback
    try:
        first_df = pd.read_excel(io.BytesIO(data), sheet_name=0, engine="openpyxl")
    except Exception:
        first_df = None
    if first_df is not None:
        ncol, mcol, gcol = detect_roster_columns(first_df)
        if ncol and mcol:
            return first_df, None

    return None, (
        "학생 명부 영역을 찾을 수 없습니다. "
        "첫 시트 헤더형 또는 '학생 기본정보' 블록 형식을 확인해 주세요."
    )


def _cell_to_str(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def normalize_gender(raw) -> str | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    if s in ("남", "m", "male", "남학생", "남자", "boy"):
        return "남"
    if s in ("여", "f", "female", "여학생", "여자", "girl"):
        return "여"
    return None


def gender_emoji(g) -> str:
    ng = normalize_gender(g)
    if ng == "남":
        return "♂️"
    if ng == "여":
        return "♀️"
    return "◦"


def import_students_from_excel_bytes(
    data: bytes, acting_user_id: int | None = None
) -> tuple[int, int, int, str | None]:
    """신규 추가 행 수, 기존 학생 정보 갱신 행 수, 빈 행 건너뜀 수, 오류 메시지(없으면 None)."""
    if acting_user_id is None:
        return 0, 0, 0, "로그인 사용자 정보가 없어 명부를 가져올 수 없습니다."
    df, parse_err = parse_roster_dataframe_from_excel_bytes(data)
    if parse_err:
        return 0, 0, 0, parse_err

    name_col, num_col, gender_col = detect_roster_columns(df)
    if not name_col or not num_col:
        return (
            0,
            0,
            0,
            "‘이름’(또는 성명·학생이름)과 ‘학번’(또는 번호) 열을 찾을 수 없습니다. "
            "「엑셀 서식 다운로드」로 받은 학생 기본 정보 기록지를 사용했는지 확인해 주세요.",
        )

    settings = parse_homeroom_settings_from_excel_bytes(data)
    if any(settings.values()) and acting_user_id is not None:
        save_homeroom_settings(
            school_name=settings.get("school_name", ""),
            teacher_name=settings.get("teacher_name", ""),
            grade=settings.get("grade", ""),
            class_name=settings.get("class_name", ""),
            user_id=acting_user_id,
        )

    extra_map = detect_extra_roster_columns(df)
    added = 0
    updated = 0
    skipped_blank = 0
    col_list = "name, number, gender, " + ", ".join(STUDENT_EXTRA_DB_FIELDS) + ", owner_user_id"
    placeholders = ", ".join(["?"] * (4 + len(STUDENT_EXTRA_DB_FIELDS)))

    with get_connection() as conn:
        for _, row in df.iterrows():
            name = _cell_to_str(row.get(name_col))
            number = _cell_to_str(row.get(num_col))
            g = None
            if gender_col:
                g = normalize_gender(row.get(gender_col))
            if not name or not number:
                skipped_blank += 1
                continue

            existing = conn.execute(
                "SELECT id, gender FROM students WHERE name = ? AND number = ? AND owner_user_id = ?",
                (name, number, acting_user_id),
            ).fetchone()

            if existing:
                g_final = g if g is not None else existing["gender"]
                set_parts = ["gender = ?"]
                set_vals: list = [g_final]
                for f in STUDENT_EXTRA_DB_FIELDS:
                    if extra_map[f] is not None:
                        set_parts.append(f"{f} = ?")
                        set_vals.append(_cell_to_str(row.get(extra_map[f])))
                set_vals.extend([existing["id"], acting_user_id])
                conn.execute(
                    f"UPDATE students SET {', '.join(set_parts)} WHERE id = ? AND owner_user_id = ?",
                    set_vals,
                )
                updated += 1
            else:
                ins_vals = [name, number, g]
                for f in STUDENT_EXTRA_DB_FIELDS:
                    if extra_map[f] is None:
                        ins_vals.append("")
                    else:
                        ins_vals.append(_cell_to_str(row.get(extra_map[f])))
                ins_vals.append(acting_user_id)
                conn.execute(
                    f"INSERT INTO students ({col_list}) VALUES ({placeholders})",
                    ins_vals,
                )
                added += 1
        conn.commit()
    return added, updated, skipped_blank, None


def list_counselings(student_id: int):
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT id, content, created_at
            FROM counselings
            WHERE student_id = ?
            ORDER BY datetime(created_at) DESC
            """,
            (student_id,),
        )
        return cur.fetchall()


def add_counseling(student_id: int, content: str):
    content = content.strip()
    if not content:
        return False
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO counselings (student_id, content, created_at)
            VALUES (?, ?, ?)
            """,
            (student_id, content, datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
    return True


def inject_style():
    """geo-eX(지오엑스) 느낌: 하늘·지도 톤, 히어로 카드, 영문 캐치프레이즈 — https://wanyeok96-web.github.io/geo-ex/ """
    st.markdown(
        """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
    :root {
        --geo-font: "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --geo-deep: #134e4a;
        --geo-deep2: #0f766e;
        --geo-text: #134e4a;
        --geo-muted: #5c7c7a;
        --geo-sky1: #e0f2fe;
        --geo-sky2: #ccfbf1;
        --geo-warm: #fffbeb;
        --geo-accent: #0d9488;
        --geo-accent2: #0ea5e9;
    }
    .stApp,
    .stApp button,
    .stApp [data-testid="stMarkdownContainer"],
    section.main .block-container {
        font-family: var(--geo-font) !important;
    }
    .stApp {
        background: linear-gradient(165deg, var(--geo-sky1) 0%, #ecfeff 35%, var(--geo-sky2) 68%, var(--geo-warm) 100%) !important;
        background-attachment: fixed !important;
        color: var(--geo-text) !important;
    }
    [data-testid="stAppViewContainer"] > .main {
        background: transparent;
    }
    section.main .block-container {
        max-width: 820px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding-top: 1rem !important;
        padding-bottom: 2.5rem !important;
        padding-left: max(1rem, env(safe-area-inset-left)) !important;
        padding-right: max(1rem, env(safe-area-inset-right)) !important;
        font-size: 16px !important;
        line-height: 1.55 !important;
    }
    section.main .block-container p,
    section.main .block-container li {
        font-size: 16px !important;
    }
    section.main .block-container h1,
    section.main .block-container h2,
    section.main .block-container h3,
    section.main .block-container h4 {
        color: var(--geo-text) !important;
    }
    section.main [data-testid="stHeading"] {
        font-size: 1.2rem !important;
        font-weight: 700 !important;
        color: var(--geo-deep) !important;
        letter-spacing: -0.02em !important;
    }
    [data-testid="stMarkdownContainer"] p,
    [data-testid="stMarkdownContainer"] li,
    [data-testid="stMarkdownContainer"] strong {
        color: var(--geo-text) !important;
    }
    [data-testid="stWidgetLabel"] p,
    [data-testid="stWidgetLabel"] label,
    [data-testid="stWidgetLabel"] span {
        color: var(--geo-deep) !important;
        font-size: 15px !important;
        font-weight: 500 !important;
    }
    .stTextInput input,
    .stTextArea textarea {
        color: var(--geo-text) !important;
        font-size: 16px !important;
        border-radius: 14px !important;
        border: 1px solid rgba(19, 78, 74, 0.15) !important;
    }
    section.main div[data-testid="stAlert"] {
        border-radius: 16px !important;
        border: 1px solid rgba(13, 148, 136, 0.2) !important;
        background: linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(240,253,250,0.9) 100%) !important;
        box-shadow: 0 4px 20px rgba(15, 118, 110, 0.08) !important;
    }
    section.main div[data-testid="stSuccess"] {
        border-radius: 16px !important;
        font-size: 15px !important;
        border: 1px solid rgba(13, 148, 136, 0.25) !important;
    }
    /* 상단 플래시 알림: 5초 후 자동 사라짐 */
    .geo-flash-banner {
        border-radius: 16px;
        border: 1px solid rgba(13, 148, 136, 0.25);
        background: linear-gradient(135deg, rgba(236, 253, 245, 0.97) 0%, rgba(209, 250, 229, 0.92) 100%);
        color: #065f46;
        font-size: 15px;
        font-weight: 600;
        padding: 0.68rem 0.86rem;
        margin: 0.15rem 0 0.95rem 0;
        box-shadow: 0 4px 18px rgba(16, 185, 129, 0.12);
        animation: geoFlashFadeOnly 0.45s ease 5s forwards;
    }
    @keyframes geoFlashFadeOnly {
        to {
            opacity: 0;
        }
    }
    section.main div[data-testid="stAlert"] p,
    section.main div[data-testid="stAlert"] div {
        color: var(--geo-text) !important;
        font-size: 15px !important;
    }
    /* 지오엑스 스타일 히어로 카드 */
    .geo-hero {
        text-align: center;
        padding: 1.6rem 1.2rem 1.35rem;
        margin-bottom: 1.35rem;
        border-radius: 22px;
        background: linear-gradient(145deg, rgba(255,255,255,0.97) 0%, rgba(240,253,250,0.92) 45%, rgba(224,242,254,0.88) 100%);
        border: 1px solid rgba(13, 148, 136, 0.18);
        box-shadow: 0 10px 40px rgba(15, 118, 110, 0.1), 0 1px 0 rgba(255,255,255,0.8) inset;
    }
    .mock-title {
        font-family: var(--geo-font) !important;
        font-size: clamp(1.65rem, 5vw, 2.35rem) !important;
        font-weight: 800 !important;
        letter-spacing: -0.04em !important;
        color: var(--geo-deep) !important;
        margin: 0 0 0.4rem 0 !important;
        line-height: 1.18 !important;
        text-shadow: 0 1px 0 rgba(255,255,255,0.9);
    }
    .mock-sub {
        font-family: var(--geo-font) !important;
        font-size: 1.05rem !important;
        font-weight: 600 !important;
        color: var(--geo-deep2) !important;
        margin: 0 0 0.65rem 0 !important;
        line-height: 1.35 !important;
    }
    .geo-tagline {
        font-family: var(--geo-font) !important;
        font-size: 0.9rem !important;
        font-weight: 400 !important;
        color: var(--geo-muted) !important;
        margin: 0 !important;
        line-height: 1.5 !important;
    }
    .geo-tagline-en {
        font-style: italic;
        color: #0f766e;
        font-weight: 500;
    }
    .geo-welcome-line {
        font-family: var(--geo-font) !important;
        font-size: 0.98rem !important;
        font-weight: 700 !important;
        color: #0f766e !important;
        margin: 0.35rem 0 0.2rem 0 !important;
    }
    .geo-section-label {
        font-family: var(--geo-font) !important;
        font-size: 1.08rem !important;
        font-weight: 700 !important;
        letter-spacing: -0.01em !important;
        color: #0d9488 !important;
        margin: 0.2rem 0 0.75rem 0 !important;
        text-align: left;
        opacity: 0.95;
    }
    .geo-section-highlight {
        font-family: var(--geo-font) !important;
        font-size: 1.22rem !important;
        font-weight: 800 !important;
        letter-spacing: -0.01em !important;
        color: #0f766e !important;
        margin: 0.15rem 0 0.8rem 0 !important;
        line-height: 1.35 !important;
        display: inline-block;
        padding: 0 0.2rem;
        background: linear-gradient(transparent 56%, rgba(253, 224, 71, 0.65) 56%);
        border-radius: 4px;
    }
    .geo-detail-title {
        font-family: var(--geo-font) !important;
        font-size: 1.55rem !important;
        font-weight: 800 !important;
        letter-spacing: -0.03em !important;
        color: var(--geo-deep) !important;
        margin: 0 0 0.35rem 0 !important;
        line-height: 1.2 !important;
    }
    .geo-detail-meta {
        font-family: var(--geo-font) !important;
        font-size: 0.95rem !important;
        font-weight: 500 !important;
        color: var(--geo-muted) !important;
        margin: 0 0 0.35rem 0 !important;
    }
    .geo-detail-extra {
        font-family: var(--geo-font) !important;
        font-size: 0.88rem !important;
        font-weight: 500 !important;
        color: var(--geo-muted) !important;
        margin: 0.12rem 0 0 0 !important;
        line-height: 1.45 !important;
        max-width: 42rem;
    }
    section.main div.stButton > button[kind="primary"] {
        background: linear-gradient(180deg, #5eead4 0%, #2dd4bf 55%, #14b8a6 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.35) !important;
        color: #ffffff !important;
        border-radius: 16px !important;
        font-weight: 700 !important;
        font-size: 16px !important;
        padding: 0.5rem 1rem !important;
        box-shadow: 0 4px 18px rgba(45, 212, 191, 0.45) !important;
        text-shadow: 0 1px 1px rgba(15, 118, 110, 0.2) !important;
    }
    section.main div.stButton > button[kind="primary"]:hover {
        background: linear-gradient(180deg, #2dd4bf 0%, #14b8a6 100%) !important;
        color: #ffffff !important;
        border-color: rgba(255, 255, 255, 0.45) !important;
    }
    /* 상세·보조 버튼: 연한 회색 톤 (검정 느낌 제거) */
    section.main div.stButton > button[kind="secondary"] {
        background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%) !important;
        border: 1px solid #e2e8f0 !important;
        color: #64748b !important;
        border-radius: 16px !important;
        font-weight: 600 !important;
        font-size: 15px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
    }
    section.main div.stButton > button[kind="secondary"]:hover {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #475569 !important;
    }
    /* 상세 헤더: 초기화(보라) / 학생 삭제(빨강) — data-testid 기준 */
    [data-testid="stButton-detail_reset_btn"] button {
        background: linear-gradient(180deg, #a855f7 0%, #7c3aed 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.35) !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35) !important;
    }
    [data-testid="stButton-detail_reset_btn"] button:hover {
        background: linear-gradient(180deg, #9333ea 0%, #6d28d9 100%) !important;
        color: #ffffff !important;
    }
    [data-testid="stButton-detail_delete_btn"] button {
        background: linear-gradient(180deg, #f87171 0%, #dc2626 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.35) !important;
        color: #ffffff !important;
        font-weight: 700 !important;
        box-shadow: 0 4px 14px rgba(220, 38, 38, 0.35) !important;
    }
    [data-testid="stButton-detail_delete_btn"] button:hover {
        background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%) !important;
        color: #ffffff !important;
    }
    /* 상담·생기부 기록 행(bordered container): 수정/삭제는 기본 옅게, 행에 마우스를 올리면 선명하게 */
    div[data-testid="stVerticalBlockBorderWrapper"]:has([data-testid^="stButton-cedit_"]):hover [data-testid^="stButton-cedit_"] button,
    div[data-testid="stVerticalBlockBorderWrapper"]:has([data-testid^="stButton-cedit_"]):hover [data-testid^="stButton-cdel_"] button,
    div[data-testid="stVerticalBlockBorderWrapper"]:has([data-testid^="stButton-lcedit_"]):hover [data-testid^="stButton-lcedit_"] button,
    div[data-testid="stVerticalBlockBorderWrapper"]:has([data-testid^="stButton-lcedit_"]):hover [data-testid^="stButton-lcdel_"] button {
        opacity: 1 !important;
        filter: none !important;
    }
    [data-testid^="stButton-cedit_"] button,
    [data-testid^="stButton-cdel_"] button,
    [data-testid^="stButton-lcedit_"] button,
    [data-testid^="stButton-lcdel_"] button {
        opacity: 0.45 !important;
        font-size: 0.8rem !important;
        min-height: 2rem !important;
        padding: 0.15rem 0.4rem !important;
    }
</style>
        """,
        unsafe_allow_html=True,
    )


def inject_dashboard_extra_style():
    """대시보드 전용: 밝은 파스텔·흰 글자 조합 (검정/딱딱한 느낌 완화)."""
    st.markdown(
        """
<style>
    /* 상단 3개 버튼(서식 다운로드/엑셀 업로드/학생 추가) 디자인 통일 */
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) .stDownloadButton button {
        background: linear-gradient(165deg, #6ee7b7 0%, #34d399 50%, #10b981 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.45) !important;
        color: #ffffff !important;
        border-radius: 16px !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
        text-shadow: 0 1px 1px rgba(6, 78, 59, 0.25) !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) .stDownloadButton button:hover {
        background: linear-gradient(165deg, #6ee7b7 0%, #059669 100%) !important;
        color: #ffffff !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] {
        margin-top: 0;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] section {
        padding: 0;
    }
    /* 업로드 후 파일명/목록은 숨겨서 버튼처럼만 보이게 */
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] small {
        display: none !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploaderFile"] {
        display: none !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploaderDropzoneInstructions"] {
        display: none !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] [data-testid="stFileUploaderDropzone"] {
        background: linear-gradient(165deg, #6ee7b7 0%, #34d399 50%, #10b981 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.45) !important;
        border-radius: 16px !important;
        min-height: 44px !important;
        padding: 0.3rem 0.5rem !important;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] [data-testid="stFileUploaderDropzone"] *,
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] [data-testid="stFileUploaderDropzone"] {
        color: #ffffff !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) [data-testid="stFileUploader"] [data-testid="stFileUploaderDropzone"] svg {
        fill: #ffffff !important;
        color: #ffffff !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) div.stButton > button {
        background: linear-gradient(165deg, #6ee7b7 0%, #34d399 50%, #10b981 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.45) !important;
        color: #ffffff !important;
        border-radius: 16px !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
        text-shadow: 0 1px 1px rgba(6, 78, 59, 0.25) !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(3)):not(:has(> div[data-testid="column"]:nth-child(4))) div.stButton > button:hover {
        background: linear-gradient(165deg, #6ee7b7 0%, #059669 100%) !important;
        color: #ffffff !important;
    }
    /* 대시보드 환영줄 오른쪽: 기초·설명서·백업·의견 등 — 기초작업과 동일한 초록 버튼 (로그아웃은 상단 전역 내비) */
    [data-testid="stButton-dash_backup_toggle_btn"] button,
    [data-testid="stButton-dash_feedback_toggle_btn"] button,
    [data-testid="stButton-open_setup_page_btn"] button,
    [data-testid="stButton-open_user_manual_btn"] button,
    [data-testid="stButton-open_admin_page_btn"] button {
        background: linear-gradient(165deg, #6ee7b7 0%, #34d399 50%, #10b981 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.45) !important;
        color: #ffffff !important;
        border-radius: 16px !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
        text-shadow: 0 1px 1px rgba(6, 78, 59, 0.25) !important;
    }
    [data-testid="stButton-dash_backup_toggle_btn"] button:hover,
    [data-testid="stButton-dash_feedback_toggle_btn"] button:hover,
    [data-testid="stButton-open_setup_page_btn"] button:hover,
    [data-testid="stButton-open_user_manual_btn"] button:hover,
    [data-testid="stButton-open_admin_page_btn"] button:hover {
        background: linear-gradient(165deg, #6ee7b7 0%, #059669 100%) !important;
        color: #ffffff !important;
    }
    /*
     * 대시보드 환영줄 오른쪽 버튼 행: 라벨이 두 줄로 갈라지지 않도록 (열 축소·한글 자동 줄바꿈·내부 flex 줄바꿈 방지)
     * 이 행에 버튼을 추가할 때는 같은 st.columns 블록에 두고, 아래 [data-testid="stButton-..."] 목록에 키를 추가할 것.
     */
    section.main div[data-testid="stHorizontalBlock"]:has([data-testid="stButton-dash_backup_toggle_btn"]) {
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
    }
    section.main div[data-testid="stHorizontalBlock"]:has([data-testid="stButton-dash_backup_toggle_btn"]) > div[data-testid="column"] {
        flex-shrink: 0 !important;
        min-width: min-content !important;
    }
    section.main div[data-testid="stHorizontalBlock"]:has([data-testid="stButton-dash_backup_toggle_btn"]) .stButton button,
    section.main div[data-testid="stHorizontalBlock"]:has([data-testid="stButton-dash_backup_toggle_btn"]) .stButton button * {
        white-space: nowrap !important;
        word-break: keep-all !important;
        overflow-wrap: normal !important;
    }
    [data-testid="stButton-open_admin_page_btn"] button,
    [data-testid="stButton-open_admin_page_btn"] button *,
    [data-testid="stButton-open_setup_page_btn"] button,
    [data-testid="stButton-open_setup_page_btn"] button *,
    [data-testid="stButton-open_user_manual_btn"] button,
    [data-testid="stButton-open_user_manual_btn"] button *,
    [data-testid="stButton-dash_backup_toggle_btn"] button,
    [data-testid="stButton-dash_backup_toggle_btn"] button *,
    [data-testid="stButton-dash_feedback_toggle_btn"] button,
    [data-testid="stButton-dash_feedback_toggle_btn"] button * {
        white-space: nowrap !important;
        word-break: keep-all !important;
        overflow-wrap: normal !important;
    }
    /* 상단 전역 내비: 흰색 카드 버튼 */
    [data-testid="stButton-global_nav_back"] button,
    [data-testid="stButton-global_nav_home"] button,
    [data-testid="stButton-global_nav_logout"] button {
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        border: 1px solid #e2e8f0 !important;
        color: #334155 !important;
        border-radius: 14px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08) !important;
        text-shadow: none !important;
    }
    [data-testid="stButton-global_nav_back"] button:hover:not(:disabled),
    [data-testid="stButton-global_nav_home"] button:hover:not(:disabled),
    [data-testid="stButton-global_nav_logout"] button:hover:not(:disabled) {
        background: #f8fafc !important;
        border-color: #cbd5e1 !important;
        color: #0f172a !important;
    }
    [data-testid="stButton-global_nav_back"] button:disabled {
        opacity: 0.45 !important;
    }
    [data-testid="stButton-global_nav_back"] button,
    [data-testid="stButton-global_nav_back"] button *,
    [data-testid="stButton-global_nav_home"] button,
    [data-testid="stButton-global_nav_home"] button *,
    [data-testid="stButton-global_nav_logout"] button,
    [data-testid="stButton-global_nav_logout"] button * {
        white-space: nowrap !important;
        word-break: keep-all !important;
    }
    /*
     * 전역 내비: 스크롤 시 상단 고정 (CSS sticky)
     * 한 줄에 뒤로가기·메인화면(좌) + 로그아웃(우) 있는 바 전체
     */
    section.main [data-testid="stHorizontalBlock"]:has([data-testid="stButton-global_nav_back"]):has([data-testid="stButton-global_nav_home"]):has([data-testid="stButton-global_nav_logout"]) {
        position: sticky !important;
        top: 0 !important;
        z-index: 1000 !important;
        background: linear-gradient(
            180deg,
            rgba(248, 250, 252, 0.97) 0%,
            rgba(241, 245, 249, 0.94) 100%
        ) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        padding: 0.4rem 0 0.55rem !important;
        margin-bottom: 0.35rem !important;
        border-bottom: 1px solid rgba(226, 232, 240, 0.95) !important;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06) !important;
    }
    /* 학생 타일 — 크림 카드 + 부드러운 글자색 */
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(5)) div.stButton > button {
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        border: 1px solid #cbd5e1 !important;
        color: #475569 !important;
        border-radius: 16px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        min-height: 3.4rem !important;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06) !important;
        text-shadow: none !important;
    }
    section.main [data-testid="stHorizontalBlock"]:has(> div[data-testid="column"]:nth-child(5)) div.stButton > button:hover {
        background: #f8fafc !important;
        border-color: #94a3b8 !important;
        color: #334155 !important;
    }
    /* 학생 개별 관리 내 +학생추가 타일: 기본 타일과 같되 더 투명한 강조색 */
    [data-testid="stButton-add_student_tile_btn"] button {
        background: linear-gradient(180deg, rgba(219, 234, 254, 0.72) 0%, rgba(224, 242, 254, 0.56) 100%) !important;
        border: 1px dashed #93c5fd !important;
        color: #1d4ed8 !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 10px rgba(59, 130, 246, 0.12) !important;
    }
    [data-testid="stButton-add_student_tile_btn"] button:hover {
        background: linear-gradient(180deg, rgba(191, 219, 254, 0.82) 0%, rgba(219, 234, 254, 0.68) 100%) !important;
        border-color: #60a5fa !important;
        color: #1e40af !important;
    }
</style>
        """,
        unsafe_allow_html=True,
    )


def _fallback_roster_template_bytes() -> bytes:
    """번들 파일이 없을 때만 사용: 설문지와 동일한 열 구성의 빈 서식."""
    columns = [
        "학번",
        "이름",
        "성별",
        "본인 휴대폰 번호",
        "주 보호자",
        "보호자 휴대폰 번호",
        "취미나 특기",
        "희망 진로",
    ]
    df = pd.DataFrame({c: [""] * 12 for c in columns})
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="설문지 응답 시트1", index=False)
    buf.seek(0)
    return buf.getvalue()


def excel_template_bytes() -> bytes:
    """메인 화면 「엑셀 서식 다운로드」: 프로젝트에 포함된 기록지 파일과 동일한 내용."""
    if ROSTER_TEMPLATE_PATH.is_file():
        return ROSTER_TEMPLATE_PATH.read_bytes()
    return _fallback_roster_template_bytes()


def ensure_session():
    if "view" not in st.session_state:
        st.session_state.view = "dashboard"
    if "student_id" not in st.session_state:
        st.session_state.student_id = None
    if "uploader_nonce" not in st.session_state:
        st.session_state.uploader_nonce = 0
    if "pending_confirm" not in st.session_state:
        st.session_state.pending_confirm = None
    if "editing_counseling_id" not in st.session_state:
        st.session_state.editing_counseling_id = None
    if "editing_life_record_id" not in st.session_state:
        st.session_state.editing_life_record_id = None
    if "detail_expand_section" not in st.session_state:
        st.session_state.detail_expand_section = "none"
    if "detail_write_expand_section" not in st.session_state:
        st.session_state.detail_write_expand_section = "none"
    if "portfolio_pdf_bytes" not in st.session_state:
        st.session_state.portfolio_pdf_bytes = None
    if "portfolio_pdf_name" not in st.session_state:
        st.session_state.portfolio_pdf_name = None
    if "activity_apply_pending" not in st.session_state:
        st.session_state.activity_apply_pending = None
    if "auth_user_id" not in st.session_state:
        st.session_state.auth_user_id = None
    if "pending_admin_confirm" not in st.session_state:
        st.session_state.pending_admin_confirm = None
    if "dash_show_backup_panel" not in st.session_state:
        st.session_state.dash_show_backup_panel = False
    if "dash_show_feedback_panel" not in st.session_state:
        st.session_state.dash_show_feedback_panel = False
    if "bulk_portfolio_gen_pending" not in st.session_state:
        st.session_state.bulk_portfolio_gen_pending = False
    if "bulk_zip_bytes" not in st.session_state:
        st.session_state.bulk_zip_bytes = None
    if "bulk_zip_show_options" not in st.session_state:
        st.session_state.bulk_zip_show_options = False
    if "nav_stack" not in st.session_state:
        st.session_state.nav_stack = []


def show_flash():
    msg = st.session_state.pop("_flash", None)
    if msg:
        safe = html.escape(str(msg))
        st.markdown(f'<div class="geo-flash-banner">{safe}</div>', unsafe_allow_html=True)


def go_dashboard():
    st.session_state.view = "dashboard"
    st.session_state.student_id = None
    st.session_state.pending_confirm = None
    st.session_state.pending_admin_confirm = None
    st.session_state.editing_counseling_id = None
    st.session_state.editing_life_record_id = None
    st.session_state.detail_write_expand_section = "none"
    st.session_state.portfolio_pdf_bytes = None
    st.session_state.portfolio_pdf_name = None
    st.session_state.dash_show_backup_panel = False
    st.session_state.dash_show_feedback_panel = False
    st.session_state.bulk_portfolio_gen_pending = False
    st.session_state.bulk_zip_show_options = False
    st.session_state.bulk_zip_bytes = None
    st.session_state.nav_stack = []


NAV_SNAPSHOT_KEYS = (
    "view",
    "student_id",
    "bulk_portfolio_gen_pending",
    "bulk_zip_show_options",
    "dash_show_backup_panel",
    "dash_show_feedback_panel",
    "bulk_zip_bytes",
    "pending_confirm",
    "detail_expand_section",
    "detail_write_expand_section",
    "editing_counseling_id",
    "editing_life_record_id",
    "pending_admin_confirm",
    "portfolio_pdf_bytes",
    "portfolio_pdf_name",
)


def _nav_snapshot_copy(val):
    if val is None:
        return None
    try:
        return copy.deepcopy(val)
    except Exception:
        return val


def nav_push_before_leave():
    if "nav_stack" not in st.session_state:
        st.session_state.nav_stack = []
    snap = {k: _nav_snapshot_copy(st.session_state.get(k)) for k in NAV_SNAPSHOT_KEYS}
    st.session_state.nav_stack.append(snap)
    if len(st.session_state.nav_stack) > 30:
        st.session_state.nav_stack = st.session_state.nav_stack[-30:]


def nav_go_back():
    stack = list(st.session_state.get("nav_stack") or [])
    if not stack:
        go_dashboard()
        return
    prev = stack.pop()
    st.session_state.nav_stack = stack
    for k in NAV_SNAPSHOT_KEYS:
        if k in prev:
            st.session_state[k] = _nav_snapshot_copy(prev[k])


def render_app_top_navigation():
    """모든 업무 화면 상단: 좌측 뒤로가기·메인화면, 우측 로그아웃. 스크롤 시 상단 고정은 CSS sticky."""
    inject_dashboard_extra_style()
    with st.container(key="app_top_navigation", border=False):
        left_nav, _nav_mid, right_nav = st.columns([2.4, 4.8, 2.8])
        with left_nav:
            nb1, nb2 = st.columns(2)
            stk = st.session_state.get("nav_stack") or []
            with nb1:
                if st.button(
                    "뒤로가기",
                    key="global_nav_back",
                    use_container_width=True,
                    disabled=len(stk) == 0,
                ):
                    nav_go_back()
                    st.rerun()
            with nb2:
                if st.button("메인화면", key="global_nav_home", use_container_width=True):
                    go_dashboard()
                    st.rerun()
        with _nav_mid:
            pass
        with right_nav:
            if st.button("로그아웃", key="global_nav_logout", use_container_width=True):
                auth_logout()
                st.rerun()


def go_detail(sid: int):
    nav_push_before_leave()
    st.session_state.view = "detail"
    st.session_state.student_id = sid
    st.session_state.pending_confirm = None
    st.session_state.editing_counseling_id = None
    st.session_state.editing_life_record_id = None
    st.session_state.detail_expand_section = "none"
    st.session_state.detail_write_expand_section = "none"


def go_evaluation(sid: int):
    nav_push_before_leave()
    st.session_state.view = "evaluation"
    st.session_state.student_id = sid


def go_bulk_activity():
    nav_push_before_leave()
    st.session_state.view = "bulk_activity"
    st.session_state.student_id = None


def go_bulk_evaluation():
    students = list_students()
    if not students:
        return
    nav_push_before_leave()
    st.session_state.view = "bulk_evaluation"
    st.session_state.student_id = int(students[0]["id"])


def go_setup():
    nav_push_before_leave()
    st.session_state.view = "setup"
    st.session_state.student_id = None


def go_add_student():
    nav_push_before_leave()
    st.session_state.view = "add_student"
    st.session_state.student_id = None


def go_admin():
    nav_push_before_leave()
    st.session_state.view = "admin"
    st.session_state.student_id = None
    st.session_state.pending_confirm = None
    st.session_state.pending_admin_confirm = None


def go_user_manual():
    nav_push_before_leave()
    st.session_state.view = "user_manual"
    st.session_state.student_id = None


def auth_logout():
    st.session_state.auth_user_id = None
    st.session_state.view = "dashboard"
    st.session_state.student_id = None
    st.session_state.pending_admin_confirm = None
    st.session_state.nav_stack = []


# 학생 상세 화면에서 펼쳐 둘 expander (저장/삭제 후에도 동일 구역 유지)
DETAIL_EXPAND_SECTIONS = frozenset(
    {"none", "counseling", "autonomous", "career", "behavior"}
)
DETAIL_WRITE_EXPAND_SECTIONS = frozenset(
    {"none", "counseling", "autonomous", "career", "behavior"}
)


def set_detail_expand(section: str) -> None:
    if section in DETAIL_EXPAND_SECTIONS:
        st.session_state.detail_expand_section = section


def _detail_expand_active() -> str:
    v = st.session_state.get("detail_expand_section", "none")
    return v if v in DETAIL_EXPAND_SECTIONS else "none"


def rerun_detail_focus(section: str) -> None:
    set_detail_expand(section)
    st.rerun()


def set_detail_write_expand(section: str) -> None:
    if section in DETAIL_WRITE_EXPAND_SECTIONS:
        st.session_state.detail_write_expand_section = section


def _detail_write_expand_active() -> str:
    v = st.session_state.get("detail_write_expand_section", "none")
    return v if v in DETAIL_WRITE_EXPAND_SECTIONS else "none"


def rerun_detail_write_focus(section: str) -> None:
    set_detail_write_expand(section)
    st.rerun()


def _record_semester(created_at: str) -> str:
    """3~7월=1학기, 8~2월=2학기."""
    month = None
    try:
        month = datetime.fromisoformat(created_at).month
    except Exception:
        m = re.search(r"-(\d{2})-", str(created_at))
        if m:
            try:
                month = int(m.group(1))
            except ValueError:
                month = None
    if month is None:
        return "s2"
    return "s1" if 3 <= month <= 7 else "s2"


def _split_by_semester(records):
    s1 = []
    s2 = []
    for r in records:
        if _record_semester(r["created_at"]) == "s1":
            s1.append(r)
        else:
            s2.append(r)
    return s1, s2


def _filter_records_by_semesters(records, semesters: set[str]):
    if not semesters:
        return []
    out = []
    for r in records:
        if _record_semester(r["created_at"]) in semesters:
            out.append(r)
    return out


def build_portfolio_pdf(
    student_row,
    semesters: set[str],
    *,
    include_counseling: bool = True,
    include_autonomous: bool = True,
    include_career: bool = True,
    include_behavior: bool = True,
) -> tuple[bytes | None, str]:
    """선택 학기·포함 섹션 기준으로 학생 포트폴리오 PDF 생성."""
    if not (
        include_counseling or include_autonomous or include_career or include_behavior
    ):
        return None, "최소 1개 선택은 필수입니다."
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.utils import simpleSplit
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    except Exception:
        return None, "PDF 생성을 위해 reportlab 라이브러리가 필요합니다. requirements 설치를 확인해 주세요."

    student_id = student_row["id"]
    counseling = (
        _filter_records_by_semesters(list_counselings(student_id), semesters)
        if include_counseling
        else []
    )
    auto_rec = (
        _filter_records_by_semesters(list_life_records(student_id, "autonomous"), semesters)
        if include_autonomous
        else []
    )
    career_rec = (
        _filter_records_by_semesters(list_life_records(student_id, "career"), semesters)
        if include_career
        else []
    )
    behavior_rec = (
        _filter_records_by_semesters(list_life_records(student_id, "behavior"), semesters)
        if include_behavior
        else []
    )
    eval_row = get_student_evaluation(student_id)

    def eval_val(k: str):
        if isinstance(eval_row, dict):
            return eval_row.get(k)
        return eval_row[k]

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 48
    font_name = "Helvetica"
    # 1) 시스템 한글 TTF 우선 사용 (깨짐 방지)
    ttf_candidates = [
        ("MalgunGothic", Path("C:/Windows/Fonts/malgun.ttf")),
        ("NanumGothic", Path("C:/Windows/Fonts/NanumGothic.ttf")),
    ]
    for ttf_name, ttf_path in ttf_candidates:
        try:
            if ttf_path.exists():
                pdfmetrics.registerFont(TTFont(ttf_name, str(ttf_path)))
                font_name = ttf_name
                break
        except Exception:
            continue
    # 2) 실패 시 CID 폰트 시도
    if font_name == "Helvetica":
        for cid_name in ("HYGothic-Medium", "HYSMyeongJo-Medium"):
            try:
                pdfmetrics.registerFont(UnicodeCIDFont(cid_name))
                font_name = cid_name
                break
            except Exception:
                continue
    # 3) 끝까지 실패하면 생성 중단 (깨진 PDF 방지)
    if font_name == "Helvetica":
        return None, "한글 PDF 폰트를 찾을 수 없습니다. Windows의 '맑은 고딕' 폰트 설치 상태를 확인해 주세요."
    c.setFont(font_name, 10)

    def draw_line(text: str, size: int = 10, gap: int = 15):
        nonlocal y
        c.setFont(font_name, size)
        lines = simpleSplit(str(text), font_name, size, width - 70)
        for ln in lines:
            if y < 50:
                c.showPage()
                c.setFont(font_name, size)
                y = height - 48
            c.drawString(35, y, ln)
            y -= gap

    semester_label = "학년도 전체" if semesters == {"s1", "s2"} else ("1학기" if "s1" in semesters else "2학기")
    draw_line("학생 포트폴리오", size=14, gap=18)
    draw_line(f"이름: {student_row['name']}   학번: {student_row['number']}", size=11)
    draw_line(f"범위: {semester_label}", size=11)
    draw_line(f"생성 시각: {datetime.now().isoformat(timespec='seconds')}", size=9)
    y -= 4
    draw_line("-" * 86, size=9, gap=12)

    def section(title: str, records, kind: str):
        nonlocal y
        draw_line(f"[{title}] ({len(records)}건)", size=12, gap=17)
        if not records:
            draw_line("기록이 없습니다.", size=10)
            y -= 3
            return
        for r in records:
            draw_line(f"- {r['created_at']}", size=10)
            if kind == "counsel":
                draw_line(f"  {r['content']}", size=10)
            elif kind == "behavior":
                if (r["observation"] or "").strip():
                    draw_line(f"  관찰·사실: {r['observation']}", size=10)
                if (r["draft_text"] or "").strip():
                    draw_line(f"  기재 초안: {r['draft_text']}", size=10)
            else:
                if (r["activity_name"] or "").strip():
                    draw_line(f"  활동명: {r['activity_name']}", size=10)
                if (r["student_reflection"] or "").strip():
                    draw_line(f"  학생 활동 소감: {r['student_reflection']}", size=10)
                if (r["teacher_observation"] or "").strip():
                    draw_line(f"  교사 관찰 결과: {r['teacher_observation']}", size=10)
            y -= 2

    if include_counseling:
        section("개별 상담", counseling, "counsel")
    if include_autonomous:
        section("자율활동", auto_rec, "life")
    if include_career:
        section("진로활동", career_rec, "life")
    if include_behavior:
        section("행동발달 특기사항", behavior_rec, "behavior")

    draw_line("[교사 평가]", size=12, gap=17)
    if eval_row and any(eval_val(f"q{i}_score") for i in range(1, EVAL_ITEM_COUNT + 1)):
        for i in range(1, EVAL_ITEM_COUNT + 1):
            score = eval_val(f"q{i}_score")
            comment = (eval_val(f"q{i}_comment") or "").strip()
            draw_line(f"{i}. 점수: {score if score is not None else '-'} / 5", size=10)
            if comment:
                draw_line(f"   의견: {comment}", size=10)
        overall = (eval_val("overall_comment") or "").strip()
        draw_line(f"총평: {overall if overall else '-'}", size=10)
    else:
        draw_line("저장된 평가가 없습니다.", size=10)

    c.save()
    return buf.getvalue(), ""


def run_bulk_portfolio_generate(
    semesters: set[str],
    *,
    include_counseling: bool = True,
    include_autonomous: bool = True,
    include_career: bool = True,
    include_behavior: bool = True,
) -> str:
    """전원 포트폴리오 PDF 생성(파일 저장 없이 성공 여부 확인)."""
    students = list_students()
    if not students:
        return "명부에 학생이 없습니다."
    ok_count = 0
    fail_lines: list[str] = []
    for row in students:
        pdf_bytes, err = build_portfolio_pdf(
            row,
            semesters,
            include_counseling=include_counseling,
            include_autonomous=include_autonomous,
            include_career=include_career,
            include_behavior=include_behavior,
        )
        if pdf_bytes:
            ok_count += 1
        else:
            fail_lines.append(f"{row['number']} {row['name']}: {err}")
    msg = f"포트폴리오 생성 완료: 성공 {ok_count}명."
    if fail_lines:
        msg += f" 실패 {len(fail_lines)}명."
        tail = "; ".join(fail_lines[:5])
        if len(fail_lines) > 5:
            tail += "…"
        msg += " " + tail
    return msg


def build_all_portfolios_zip(
    semesters: set[str],
    *,
    include_counseling: bool = True,
    include_autonomous: bool = True,
    include_career: bool = True,
    include_behavior: bool = True,
) -> tuple[bytes | None, str]:
    """명부 전체 학생의 포트폴리오 PDF를 하나의 ZIP으로 묶음."""
    students = list_students()
    if not students:
        return None, "명부에 학생이 없습니다."
    if not semesters:
        return None, "학기를 한 개 이상 선택해 주세요."
    if not (
        include_counseling or include_autonomous or include_career or include_behavior
    ):
        return None, "최소 1개 선택은 필수입니다."
    buf = io.BytesIO()
    added = 0
    skipped: list[str] = []
    sem_label = (
        "전체"
        if semesters == {"s1", "s2"}
        else ("1학기" if semesters == {"s1"} else ("2학기" if semesters == {"s2"} else "선택"))
    )
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in students:
            pdf_bytes, err = build_portfolio_pdf(
                row,
                semesters,
                include_counseling=include_counseling,
                include_autonomous=include_autonomous,
                include_career=include_career,
                include_behavior=include_behavior,
            )
            if pdf_bytes:
                safe_name = re.sub(r"[^0-9A-Za-z가-힣_\-]+", "_", str(row["name"]))
                fn = f"{row['number']}_{safe_name}_{sem_label}_포트폴리오.pdf"
                zf.writestr(fn, pdf_bytes)
                added += 1
            else:
                skipped.append(f"{row['number']} {row['name']}: {err}")
    if added == 0:
        hint = "; ".join(skipped[:3]) if skipped else ""
        return None, "ZIP에 넣을 PDF를 생성할 수 없습니다." + (f" ({hint})" if hint else "")
    warn = ""
    if skipped:
        warn = f"일부 {len(skipped)}명은 PDF 생성에 실패하여 ZIP에서 제외했습니다."
    return buf.getvalue(), warn


def _clear_counseling_new_form_keys(student_id: int) -> None:
    st.session_state.pop(f"new_counseling_content_{student_id}", None)


def _clear_life_new_form_keys(student_id: int, cat_key: str) -> None:
    sid = int(student_id)
    if cat_key == "behavior":
        st.session_state.pop(f"life_new_obs_{cat_key}_{sid}", None)
        st.session_state.pop(f"life_new_dr_{cat_key}_{sid}", None)
    else:
        st.session_state.pop(f"life_new_act_{cat_key}_{sid}", None)
        st.session_state.pop(f"life_new_sr_{cat_key}_{sid}", None)
        st.session_state.pop(f"life_new_to_{cat_key}_{sid}", None)


DETAIL_EXTRA_LABELS = (
    ("student_phone", "본인 휴대폰 번호"),
    ("guardian_phone", "보호자 휴대폰 번호"),
)


def render_counseling_write_section(student_id: int):
    """개별 상담 입력 전용."""
    st.markdown("**새 상담 기록**")
    with st.form("new_counseling", clear_on_submit=True):
        content = st.text_area(
            "상담 내용",
            height=200,
            placeholder="오늘 상담 내용을 적어주세요.",
            label_visibility="collapsed",
            key=f"new_counseling_content_{student_id}",
        )
        if st.form_submit_button("상담 내용 저장", type="primary"):
            if not content or not content.strip():
                st.error("상담 내용을 입력해 주세요.")
            else:
                add_counseling(student_id, content)
                st.session_state._flash = "저장되었습니다."
                _clear_counseling_new_form_keys(student_id)
                rerun_detail_write_focus("counseling")


def _render_counseling_records(records):
    if not records:
        st.info("해당 학기에 저장된 상담 기록이 없습니다.")
        return

    for r in records:
        cid = r["id"]
        if st.session_state.get("editing_counseling_id") == cid:
            st.markdown(f"**{r['created_at']}**")
            edited = st.text_area(
                "상담 내용 수정",
                value=r["content"],
                height=160,
                key=f"edit_area_{cid}",
            )
            e1, e2 = st.columns(2)
            if e1.button("저장", key=f"save_edit_{cid}", type="primary"):
                if update_counseling(cid, edited):
                    st.session_state.editing_counseling_id = None
                    st.session_state._flash = "상담 기록이 수정되었습니다."
                    rerun_detail_focus("counseling")
                st.error("내용을 입력해 주세요.")
            if e2.button("취소", key=f"cancel_edit_{cid}"):
                st.session_state.editing_counseling_id = None
                rerun_detail_focus("counseling")
            st.divider()
            continue

        try:
            row_wrap = st.container(border=True)
        except TypeError:
            row_wrap = st.container()
        with row_wrap:
            cr1, cr2 = st.columns([1, 0.22])
            with cr1:
                st.markdown(f"**{r['created_at']}**")
                st.markdown(r["content"])
            with cr2:
                b1, b2 = st.columns(2)
                with b1:
                    if st.button("수정", key=f"cedit_{cid}", use_container_width=True):
                        st.session_state.editing_life_record_id = None
                        st.session_state.editing_counseling_id = cid
                        rerun_detail_focus("counseling")
                with b2:
                    if st.button("삭제", key=f"cdel_{cid}", use_container_width=True):
                        set_detail_expand("counseling")
                        st.session_state.pending_confirm = ("delete_counseling", cid)
                        st.rerun()
        st.divider()


def render_counseling_section(student_id: int):
    """개별 상담 확인(조회/수정/삭제) 전용."""
    st.caption("저장된 상담은 최신순이며 학기별로 확인할 수 있습니다.")
    records = list_counselings(student_id)
    s1, s2 = _split_by_semester(records)
    t1, t2 = st.tabs(["1학기 (3~7월)", "2학기 (8~2월)"])
    with t1:
        _render_counseling_records(s1)
    with t2:
        _render_counseling_records(s2)


def _activity_edit_defaults(r) -> tuple[str, str, str]:
    """자율·진로: 새 필드가 비어 있으면 예전 관찰/초안을 수정 화면 초기값으로."""
    an = (r["activity_name"] or "").strip()
    sr = (r["student_reflection"] or "").strip()
    to = (r["teacher_observation"] or "").strip()
    if an or sr or to:
        return an, sr, to
    return "", (r["draft_text"] or "").strip(), (r["observation"] or "").strip()


def render_life_write_section(student_id: int, cat_key: str):
    """생기부 입력 전용."""
    if cat_key == "behavior":
        st.markdown("**새 기록**")
        with st.form(f"life_new_{cat_key}_{student_id}", clear_on_submit=True):
            obs = st.text_area(
                "관찰·사실",
                height=140,
                key=f"life_new_obs_{cat_key}_{student_id}",
                placeholder="상황·태도·협력 등 짧게 적어 주세요.",
            )
            dr = st.text_area(
                "기재 초안(선택)",
                height=100,
                key=f"life_new_dr_{cat_key}_{student_id}",
                placeholder="나중에 생기부에 옮길 문장을 적어 두면 됩니다.",
            )
            if st.form_submit_button("저장", type="primary"):
                if add_life_record(
                    student_id, "behavior", observation=obs, draft_text=dr
                ):
                    st.session_state._flash = "저장되었습니다."
                    _clear_life_new_form_keys(student_id, cat_key)
                    rerun_detail_write_focus("behavior")
                st.error("관찰·사실 또는 기재 초안 중 하나 이상을 입력해 주세요.")
        return

    st.markdown("**새 기록**")
    with st.form(f"life_new_{cat_key}_{student_id}", clear_on_submit=True):
        st.caption("활동명·학생 소감·교사 관찰 중 최소 한 항목은 적어 주세요.")
        act = st.text_area(
            "활동명",
            height=68,
            key=f"life_new_act_{cat_key}_{student_id}",
            placeholder="예: 자율·자치 활동 주제, 진로 체험 프로그램명 등",
        )
        sr = st.text_area(
            "학생 활동 소감",
            height=120,
            key=f"life_new_sr_{cat_key}_{student_id}",
            placeholder="학생이 제출한 활동 소감을 옮겨 적어 주세요.",
        )
        to = st.text_area(
            "교사 관찰 결과",
            height=120,
            key=f"life_new_to_{cat_key}_{student_id}",
            placeholder="수업·활동 중 관찰한 내용을 적어 주세요.",
        )
        if st.form_submit_button("저장", type="primary"):
            if add_life_record(
                student_id,
                cat_key,
                activity_name=act,
                student_reflection=sr,
                teacher_observation=to,
            ):
                st.session_state._flash = "저장되었습니다."
                _clear_life_new_form_keys(student_id, cat_key)
                rerun_detail_write_focus(cat_key)
            st.error(
                "활동명, 학생 활동 소감, 교사 관찰 중 하나 이상을 입력해 주세요."
            )


def _render_life_records(records, cat_key: str):
    if not records:
        st.info("해당 학기에 저장된 기록이 없습니다.")
        return

    for r in records:
        rid = r["id"]
        an0, sr0, to0 = _activity_edit_defaults(r)
        has_new = bool(
            (r["activity_name"] or "").strip()
            or (r["student_reflection"] or "").strip()
            or (r["teacher_observation"] or "").strip()
        )

        if st.session_state.get("editing_life_record_id") == rid:
            st.markdown(f"**{r['created_at']}**")
            if cat_key == "behavior":
                eo = st.text_area(
                    "관찰·사실",
                    value=r["observation"],
                    height=120,
                    key=f"le_obs_{rid}",
                )
                ed = st.text_area(
                    "기재 초안(선택)",
                    value=r["draft_text"],
                    height=100,
                    key=f"le_dr_{rid}",
                )
                e1, e2 = st.columns(2)
                if e1.button("저장", key=f"life_save_{rid}", type="primary"):
                    if update_life_record(rid, "behavior", observation=eo, draft_text=ed):
                        st.session_state.editing_life_record_id = None
                        st.session_state._flash = "저장되었습니다."
                        rerun_detail_focus("behavior")
                    st.error("관찰·사실 또는 기재 초안 중 하나 이상을 입력해 주세요.")
                if e2.button("취소", key=f"life_cancel_{rid}"):
                    st.session_state.editing_life_record_id = None
                    rerun_detail_focus("behavior")
            else:
                ea = st.text_area(
                    "활동명",
                    value=an0,
                    height=68,
                    key=f"le_act_{rid}",
                )
                es = st.text_area(
                    "학생 활동 소감",
                    value=sr0,
                    height=120,
                    key=f"le_sr_{rid}",
                )
                et = st.text_area(
                    "교사 관찰 결과",
                    value=to0,
                    height=120,
                    key=f"le_to_{rid}",
                )
                e1, e2 = st.columns(2)
                if e1.button("저장", key=f"life_save_{rid}", type="primary"):
                    if update_life_record(
                        rid,
                        cat_key,
                        activity_name=ea,
                        student_reflection=es,
                        teacher_observation=et,
                    ):
                        st.session_state.editing_life_record_id = None
                        st.session_state._flash = "저장되었습니다."
                        rerun_detail_focus(cat_key)
                    st.error(
                        "활동명, 학생 활동 소감, 교사 관찰 중 하나 이상을 입력해 주세요."
                    )
                if e2.button("취소", key=f"life_cancel_{rid}"):
                    st.session_state.editing_life_record_id = None
                    rerun_detail_focus(cat_key)
            st.divider()
            continue

        try:
            row_wrap = st.container(border=True)
        except TypeError:
            row_wrap = st.container()
        with row_wrap:
            cr1, cr2 = st.columns([1, 0.22])
            with cr1:
                st.markdown(f"**{r['created_at']}**")
                if cat_key == "behavior":
                    if r["observation"]:
                        st.markdown("**관찰·사실**")
                        st.markdown(r["observation"])
                    if r["draft_text"]:
                        st.markdown("**기재 초안**")
                        st.markdown(r["draft_text"])
                elif has_new:
                    if (r["activity_name"] or "").strip():
                        st.markdown("**활동명**")
                        st.markdown(r["activity_name"])
                    if (r["student_reflection"] or "").strip():
                        st.markdown("**학생 활동 소감**")
                        st.markdown(r["student_reflection"])
                    if (r["teacher_observation"] or "").strip():
                        st.markdown("**교사 관찰 결과**")
                        st.markdown(r["teacher_observation"])
                else:
                    st.caption("(이전 형식으로 저장된 기록입니다.)")
                    if r["observation"]:
                        st.markdown("**관찰·사실**")
                        st.markdown(r["observation"])
                    if r["draft_text"]:
                        st.markdown("**기재 초안**")
                        st.markdown(r["draft_text"])
            with cr2:
                b1, b2 = st.columns(2)
                with b1:
                    if st.button(
                        "수정",
                        key=f"lcedit_{cat_key}_{rid}",
                        use_container_width=True,
                    ):
                        st.session_state.editing_counseling_id = None
                        st.session_state.editing_life_record_id = rid
                        rerun_detail_focus(cat_key)
                with b2:
                    if st.button(
                        "삭제",
                        key=f"lcdel_{cat_key}_{rid}",
                        use_container_width=True,
                    ):
                        set_detail_expand(cat_key)
                        st.session_state.pending_confirm = ("delete_life", rid)
                        st.rerun()
        st.divider()


def render_life_section(student_id: int, cat_key: str):
    """생기부 확인(조회/수정/삭제) 전용."""
    st.caption("저장된 기록은 최신순이며 학기별로 확인할 수 있습니다.")
    records = list_life_records(student_id, cat_key)
    s1, s2 = _split_by_semester(records)
    t1, t2 = st.tabs(["1학기 (3~7월)", "2학기 (8~2월)"])
    with t1:
        _render_life_records(s1, cat_key)
    with t2:
        _render_life_records(s2, cat_key)


def render_bootstrap_admin():
    """DB에 사용자가 없을 때 한 번만: 최초 관리자 계정을 만듭니다."""
    inject_style()
    st.markdown(
        """
<div class="geo-hero">
<p class="mock-title">📚🎓 클래스 매니저 ✏️📋</p>
<p class="geo-tagline">최초 관리자 계정을 등록해 주세요.</p>
</div>
        """,
        unsafe_allow_html=True,
    )
    st.info(
        "아직 등록된 계정이 없습니다. 이 화면에서 만드는 계정이 **관리자**이며, 이후 동료 선생님은 **가입 요청 → 승인** 후 이용할 수 있습니다."
    )
    with st.form("bootstrap_admin_form"):
        uid = st.text_input("관리자 아이디 (영문 소문자·숫자·밑줄, 3~64자)", key="boot_uid")
        pw1 = st.text_input("비밀번호 (8자 이상)", type="password", key="boot_pw1")
        pw2 = st.text_input("비밀번호 확인", type="password", key="boot_pw2")
        if st.form_submit_button("관리자 계정 만들기", type="primary"):
            if (pw1 or "") != (pw2 or ""):
                st.error("비밀번호가 서로 일치하지 않습니다.")
            else:
                ok, err = create_app_user(
                    username=uid,
                    password=pw1 or "",
                    display_name="",
                    request_note="",
                    role="admin",
                    status="approved",
                )
                if ok:
                    row = get_app_user_by_username(uid)
                    if row:
                        st.session_state.auth_user_id = row["id"]
                    st.session_state._flash = "관리자 계정이 등록되었습니다."
                    st.rerun()
                else:
                    st.error(err)


def render_login_signup(*, banner: str | None = None):
    inject_style()
    st.markdown(
        """
<div class="geo-hero">
<p class="mock-title">📚🎓 클래스 매니저 ✏️📋</p>
<p class="geo-tagline">로그인하거나 가입을 요청해 주세요.</p>
</div>
        """,
        unsafe_allow_html=True,
    )
    if banner:
        st.warning(html.escape(banner))

    t_login, t_join = st.tabs(["로그인", "가입 요청"])

    with t_login:
        with st.form("app_login_form"):
            lu = st.text_input("아이디", key="login_username")
            lp = st.text_input("비밀번호", type="password", key="login_password")
            if st.form_submit_button("로그인", type="primary"):
                u, err = try_app_login(lu, lp)
                if not u:
                    st.error(err)
                else:
                    st.session_state.auth_user_id = u["id"]
                    st.rerun()

    with t_join:
        st.caption("가입 요청 후 관리자가 승인하면 로그인하여 서비스를 이용할 수 있습니다.")
        with st.form("app_signup_form"):
            su = st.text_input("아이디 (영문 소문자·숫자·밑줄)", key="signup_username")
            sp1 = st.text_input("비밀번호 (8자 이상)", type="password", key="signup_pw1")
            sp2 = st.text_input("비밀번호 확인", type="password", key="signup_pw2")
            sname = st.text_input("표시 이름 (선택)", placeholder="예: 김담임", key="signup_display")
            snote = st.text_area(
                "요청 사유 (선택)",
                placeholder="예: ○○중 담임",
                height=80,
                key="signup_note",
            )
            if st.form_submit_button("가입 요청 보내기", type="primary"):
                if (sp1 or "") != (sp2 or ""):
                    st.error("비밀번호가 서로 일치하지 않습니다.")
                else:
                    ok, err = create_app_user(
                        username=su,
                        password=sp1 or "",
                        display_name=sname,
                        request_note=snote,
                        role="user",
                        status="pending",
                    )
                    if ok:
                        st.success("가입 요청이 접수되었습니다. 관리자 승인 후 다시 로그인해 주세요.")
                    else:
                        st.error(err)


def render_pending_approval(user_row):
    inject_style()
    inject_dashboard_extra_style()
    dn = (user_row["display_name"] or "").strip()
    label = f"{user_row['username']}" + (f" ({dn})" if dn else "")
    st.markdown(
        f"""
<div class="geo-hero">
<p class="mock-title">승인 대기</p>
<p class="geo-tagline">{html.escape(label)} 님의 가입 요청이 관리자 승인을 기다리고 있습니다.</p>
</div>
        """,
        unsafe_allow_html=True,
    )
    st.info(
        "관리자가 승인하면 아래 **승인 여부 다시 확인**을 눌러 주세요. 승인 후에도 화면이 바뀌지 않으면 **로그아웃** 후 다시 로그인해 주세요."
    )
    p1, p2 = st.columns(2)
    with p1:
        if st.button("승인 여부 다시 확인", key="pending_refresh_btn", use_container_width=True):
            st.rerun()
    with p2:
        if st.button("로그아웃", key="pending_logout_btn", use_container_width=True):
            auth_logout()
            st.rerun()


def render_homeroom_onboarding():
    """엑셀 업로드 전에 계정별 학교·학급·담임 정보를 받습니다."""
    inject_style()
    inject_dashboard_extra_style()
    st.markdown(
        """
<div class="geo-hero">
<p class="mock-title">🏫 담임·학급 기본 정보</p>
<p class="geo-tagline">본인이 담임으로 맡으신 학교와 학급을 입력해 주세요.</p>
</div>
        """,
        unsafe_allow_html=True,
    )
    st.info(
        "가입하신 선생님마다 학급이 다를 수 있습니다. **메인 화면과 엑셀 업로드 전에** 여기서 먼저 설정해 주세요. "
        "이후 엑셀 파일에 적힌 기초정보가 있으면 업로드 시 이 계정 정보에도 반영됩니다."
    )
    with st.form("homeroom_onboarding_form"):
        c1, c2 = st.columns(2)
        with c1:
            school = st.text_input("학교명 *", placeholder="예: 이솔고등학교", key="onb_school")
            grade = st.text_input("학년 *", placeholder="예: 2", key="onb_grade")
        with c2:
            class_name = st.text_input("반 *", placeholder="예: 1", key="onb_class")
            teacher = st.text_input("담임 선생님 성함 *", placeholder="예: 홍길동", key="onb_teacher")
        submitted = st.form_submit_button("저장하고 시작하기", type="primary")
        if submitted:
            if not all(
                str(x or "").strip()
                for x in (school, grade, class_name, teacher)
            ):
                st.error("학교명, 학년, 반, 담임 선생님 성함을 모두 입력해 주세요.")
            else:
                save_homeroom_settings(
                    school_name=school,
                    teacher_name=teacher,
                    grade=grade,
                    class_name=class_name,
                )
                st.session_state._flash = "담임 설정이 저장되었습니다. 이제 메인 화면과 기초작업(엑셀)을 이용할 수 있습니다."
                st.rerun()

    st.divider()
    if st.button("로그아웃", key="onboarding_logout_btn", use_container_width=True):
        auth_logout()
        st.rerun()


def render_admin_feedback_inbox():
    fb_list = list_all_feedback_for_admin()
    if not fb_list:
        st.info("접수된 의견이 없습니다.")
        return
    for r in fb_list:
        fid = int(r["id"])
        un = (r.get("author_username") or "").strip()
        dn = (r.get("author_display_name") or "").strip()
        author_lab = f"`{html.escape(un)}`" + (f" ({html.escape(dn)})" if dn else "")
        try:
            box = st.container(border=True)
        except TypeError:
            box = st.container()
        with box:
            st.markdown(
                f"**{html.escape(r.get('title') or '')}** · 보낸 사람: {author_lab}",
                unsafe_allow_html=True,
            )
            st.caption(f"보낸 시각: {html.escape(str(r.get('created_at') or ''))}")
            st.text((r.get("body") or "").strip() or "(내용 없음)")
            ra = r.get("read_at")
            if ra:
                st.success(f"읽음 처리됨 · {html.escape(str(ra)[:19])}")
                if st.button("읽음 취소", key=f"admin_fb_unread_{fid}", use_container_width=True):
                    set_feedback_read_by_admin(fid, False)
                    st.session_state._flash = "읽음을 취소했습니다."
                    st.rerun()
            else:
                st.caption("아직 읽지 않음")
                if st.button("읽음 처리", key=f"admin_fb_read_{fid}", type="primary", use_container_width=True):
                    set_feedback_read_by_admin(fid, True)
                    st.session_state._flash = "읽음 처리했습니다."
                    st.rerun()
        st.divider()


def render_user_feedback_panel():
    uid = _current_app_user_id()
    if uid is None:
        return
    uid = int(uid)
    st.caption("제목·내용을 남기면 관리자 화면으로 전달됩니다. (본문 최대 2000자)")
    with st.form("user_feedback_form"):
        ft = st.text_input("제목", max_chars=200, key="user_fb_title_input")
        fb = st.text_area(
            "내용",
            height=160,
            max_chars=2000,
            key="user_fb_body_input",
            placeholder="건의·버그·불편 사항 등을 적어 주세요.",
        )
        if st.form_submit_button("의견 보내기", type="primary"):
            ok, err = insert_user_feedback(uid, ft, fb)
            if ok:
                st.session_state._flash = "의견이 전달되었습니다."
                st.rerun()
            st.error(err)

    mine = list_feedback_for_author(uid)
    if mine:
        st.markdown("**내가 보낸 의견**")
        for m in mine:
            mid = int(m["id"])
            st.markdown(f"**{html.escape(m.get('title') or '')}** · {html.escape(str(m.get('created_at') or '')[:19])}")
            if m.get("read_at"):
                st.success(f"관리자 확인함 · {html.escape(str(m['read_at'])[:19])}")
            else:
                st.caption("관리자 읽음 전")
            with st.expander("내용 보기", expanded=False):
                st.text((m.get("body") or "").strip())


def render_admin_page():
    uid = st.session_state.get("auth_user_id")
    if not is_app_admin(uid):
        st.error("관리자만 접근할 수 있습니다.")
        if st.button("메인으로", key="admin_deny_back"):
            go_dashboard()
            st.rerun()
        return

    inject_dashboard_extra_style()
    show_flash()
    err_del = st.session_state.pop("_admin_delete_err", None)
    if err_del:
        st.error(err_del)

    st.markdown('<p class="geo-section-label">💬 의견 보내기 쪽지</p>', unsafe_allow_html=True)
    st.caption(
        "사용자가 보낸 의견입니다. **읽음 처리**하면 보낸 분의 메인 화면(의견 보내기)에서도 확인할 수 있습니다."
    )
    render_admin_feedback_inbox()
    st.divider()

    pac = st.session_state.get("pending_admin_confirm")
    if pac is not None:
        typ, tid = pac
        if typ == "delete_app_user":
            tgt = get_app_user_by_id(int(tid))
            st.warning("정말 이 승인 계정을 삭제할까요?")
            if tgt:
                st.caption(
                    f"계정 `{html.escape(tgt['username'])}`와 이 계정에 속한 **학생 명부·상담·생기부·평가** 데이터가 "
                    "모두 삭제되며 복구할 수 없습니다."
                )
            else:
                st.caption("대상 계정을 찾을 수 없습니다. 취소 후 다시 시도해 주세요.")
            c_y, c_n = st.columns(2)
            if c_y.button("확인", type="primary", key="admin_del_user_yes"):
                if tgt:
                    ok_del, msg_del = admin_delete_approved_user(int(tid), int(uid))
                    st.session_state.pending_admin_confirm = None
                    if ok_del:
                        st.session_state._flash = msg_del
                    else:
                        st.session_state._admin_delete_err = msg_del
                else:
                    st.session_state.pending_admin_confirm = None
                st.rerun()
            if c_n.button("취소", key="admin_del_user_no"):
                st.session_state.pending_admin_confirm = None
                st.rerun()
            st.stop()

    st.markdown('<p class="geo-section-label">🔐 관리자 · 가입 승인</p>', unsafe_allow_html=True)
    st.caption("가입 요청을 검토한 뒤 승인 또는 거절할 수 있습니다.")

    pending = list_app_users_by_status("pending")
    if not pending:
        st.success("대기 중인 가입 요청이 없습니다.")
    else:
        for row in pending:
            rid = row["id"]
            un = row["username"]
            dn = (row["display_name"] or "").strip()
            note = (row["request_note"] or "").strip()
            created = row["created_at"] or ""
            with st.container(border=True):
                st.markdown(f"**아이디:** `{html.escape(un)}`")
                if dn:
                    st.markdown(f"**표시 이름:** {html.escape(dn)}")
                if note:
                    st.markdown(f"**요청 사유:** {html.escape(note)}")
                st.caption(f"요청 시각: {html.escape(created)}")
                a1, a2 = st.columns(2)
                with a1:
                    if st.button("승인", key=f"approve_u_{rid}", type="primary", use_container_width=True):
                        if set_app_user_status(rid, "approved"):
                            st.session_state._flash = f"승인 완료: {un}"
                        st.rerun()
                with a2:
                    if st.button("거절", key=f"reject_u_{rid}", use_container_width=True):
                        if set_app_user_status(rid, "rejected"):
                            st.session_state._flash = f"거절 처리: {un}"
                        st.rerun()

    st.divider()
    st.markdown('<p class="geo-section-label">👤 승인된 사용자</p>', unsafe_allow_html=True)
    st.caption("이용 중인 계정 목록입니다. 비밀번호를 잊은 동료는 아래에서 재설정할 수 있습니다.")

    approved = list_app_users_approved()
    if not approved:
        st.info("승인된 사용자가 없습니다.")
    else:
        rows = []
        for r in approved:
            rows.append(
                {
                    "아이디": r["username"],
                    "표시 이름": (r["display_name"] or "").strip() or "—",
                    "역할": "관리자" if r["role"] == "admin" else "사용자",
                    "등록 시각": r["created_at"] or "—",
                }
            )
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        pick_options: list[tuple[str, int]] = []
        for r in approved:
            un = r["username"]
            dn = (r["display_name"] or "").strip()
            role_kr = "관리자" if r["role"] == "admin" else "사용자"
            lab = f"{un} ({role_kr})" + (f" · {dn}" if dn else "")
            pick_options.append((lab, r["id"]))

        st.markdown("**비밀번호 재설정**")
        sel_lab = st.selectbox(
            "재설정할 계정",
            options=[p[0] for p in pick_options],
            key="admin_pw_reset_select",
        )
        target_pw_uid = next(pid for lab, pid in pick_options if lab == sel_lab)

        with st.form("admin_reset_password_form"):
            np1 = st.text_input("새 비밀번호 (8자 이상)", type="password", key="admin_np1")
            np2 = st.text_input("새 비밀번호 확인", type="password", key="admin_np2")
            if st.form_submit_button("비밀번호 재설정", type="primary"):
                if (np1 or "") != (np2 or ""):
                    st.error("새 비밀번호가 서로 일치하지 않습니다.")
                else:
                    ok_pw, err_pw = admin_update_user_password(target_pw_uid, np1 or "")
                    if ok_pw:
                        st.session_state._flash = "비밀번호가 재설정되었습니다. 해당 선생님께 새 비밀번호를 안전하게 전달해 주세요."
                        st.rerun()
                    else:
                        st.error(err_pw)

        st.markdown("**계정 삭제**")
        st.caption(
            "승인된 동료 계정을 삭제합니다. 본인 계정·마지막 관리자는 삭제할 수 없으며, 삭제 시 해당 계정의 학생·기록이 모두 제거됩니다."
        )
        del_choices = [(lab, pid) for lab, pid in pick_options if pid != uid]
        if not del_choices:
            st.info("삭제할 다른 승인 계정이 없습니다.")
        else:
            del_labels = [x[0] for x in del_choices]
            del_sel = st.selectbox(
                "삭제할 계정",
                options=del_labels,
                key="admin_delete_user_select",
            )
            del_target_id = next(pid for lab, pid in del_choices if lab == del_sel)
            if st.button("선택한 계정 삭제…", key="admin_delete_user_btn", type="secondary"):
                st.session_state.pending_admin_confirm = ("delete_app_user", del_target_id)
                st.rerun()

    rejected = list_app_users_by_status("rejected")
    if rejected:
        with st.expander("거절된 계정 (참고)", expanded=False):
            for row in rejected:
                st.caption(
                    f"`{html.escape(row['username'])}` · "
                    f"{html.escape(row['created_at'] or '')}"
                )


def render_dashboard():
    inject_dashboard_extra_style()
    show_flash()

    st.markdown(
        """
<div class="geo-hero">
<p class="mock-title">📚🎓 클래스 매니저 ✏️📋</p>
<p class="geo-tagline">기록은 간편하게, 평가는 꼼꼼하게, 정리는 스마트하게.<br>선생님의 똑똑한 보조 담임, Class Manager!</p>
</div>
        """,
        unsafe_allow_html=True,
    )
    settings = get_homeroom_settings()
    sn = settings.get("school_name", "")
    gr = settings.get("grade", "")
    cn = settings.get("class_name", "")
    tn = settings.get("teacher_name", "")
    if sn and gr and cn and tn:
        welcome = f"환영합니다! {sn} {gr}학년 {cn}반 {tn}선생님!"
    else:
        welcome = "환영합니다! 담임 설정을 먼저 입력해 주세요."

    # 오른쪽에 버튼이 많아 좁은 열에서 라벨이 줄바꿈되기 쉬움 → 버튼 쪽을 넓힘 (줄바꿈 방지는 CSS와 병행)
    h1, h2 = st.columns([4, 6])
    with h1:
        st.markdown(
            f'<p class="geo-welcome-line">{html.escape(welcome)}</p>',
            unsafe_allow_html=True,
        )
    with h2:
        _admin = is_app_admin(st.session_state.get("auth_user_id"))
        # 비율은 시각적 가중치용(실제 최소 너비는 CSS에서 flex-shrink:0으로 보장)
        # 관리자: 관리자 → 기초작업 → 설명서 → 백업 → 의견 / 일반: 기초작업 → 설명서 → 백업 → 의견 (로그아웃은 상단 전역 내비)
        bh = (
            st.columns([1, 1, 1, 1.7, 1.5])
            if _admin
            else st.columns([1, 1, 1.7, 1.5])
        )
        idx = 0
        if _admin:
            with bh[idx]:
                idx += 1
                if st.button("🔐 관리자", use_container_width=True, key="open_admin_page_btn"):
                    go_admin()
                    st.rerun()
        with bh[idx]:
            idx += 1
            if st.button("🛠️ 기초작업", use_container_width=True, key="open_setup_page_btn"):
                go_setup()
                st.rerun()
        with bh[idx]:
            idx += 1
            if st.button("📖 설명서", use_container_width=True, key="open_user_manual_btn"):
                go_user_manual()
                st.rerun()
        with bh[idx]:
            idx += 1
            if st.button(
                "💾 데이터 백업 / 복원",
                use_container_width=True,
                key="dash_backup_toggle_btn",
            ):
                st.session_state.dash_show_backup_panel = not st.session_state.get(
                    "dash_show_backup_panel", False
                )
                st.rerun()
        with bh[idx]:
            idx += 1
            if st.button(
                "💬 의견 보내기",
                use_container_width=True,
                key="dash_feedback_toggle_btn",
            ):
                st.session_state.dash_show_feedback_panel = not st.session_state.get(
                    "dash_show_feedback_panel", False
                )
                st.rerun()

    st.divider()
    if st.session_state.get("dash_show_backup_panel"):
        render_backup_restore_panel(key_prefix="dash_header")
        st.divider()
    if st.session_state.get("dash_show_feedback_panel"):
        st.markdown('<p class="geo-section-label">💬 의견 보내기</p>', unsafe_allow_html=True)
        render_user_feedback_panel()
        st.divider()
    st.markdown('<p class="geo-section-highlight">📋 학생 개별 관리</p>', unsafe_allow_html=True)

    students = list_students()
    if not students:
        st.info(
            "이 계정의 명부에 학생이 없습니다. 기초작업에서 엑셀을 업로드하거나 +학생추가로 직접 입력해 주세요."
        )

    cols = st.columns(5)
    for i, s in enumerate(students):
        em = gender_emoji(s["gender"])
        label = f"{s['number']} {s['name']} {em}"
        with cols[i % 5]:
            if st.button(
                label,
                key=f"open_student_{s['id']}",
                use_container_width=True,
                help="상세 보기",
            ):
                go_detail(s["id"])
                st.rerun()

    add_idx = len(students)
    with cols[add_idx % 5]:
        if st.button("+학생추가", key="add_student_tile_btn", use_container_width=True):
            go_add_student()
            st.rerun()

    st.divider()
    st.markdown('<p class="geo-section-highlight">⚡ 학생 일괄 관리</p>', unsafe_allow_html=True)
    st.caption("활동 기록, 평가, 포트폴리오를 여러 학생에게 한 번에 진행합니다.")

    _show_hub_pf_opts = st.session_state.get(
        "bulk_portfolio_gen_pending"
    ) or st.session_state.get("bulk_zip_show_options")
    if _show_hub_pf_opts:
        st.markdown("**포트폴리오·ZIP 범위**")
        st.caption("전원 생성·ZIP 다운에 아래 설정이 적용됩니다.")
        hz1, hz2 = st.columns(2)
        with hz1:
            st.checkbox("1학기(3~7월)", value=True, key="hub_pf_sem1")
        with hz2:
            st.checkbox("2학기(8~2월)", value=True, key="hub_pf_sem2")
        hs = st.columns(4)
        with hs[0]:
            st.checkbox("개별 상담", value=True, key="hub_pf_inc_counsel")
        with hs[1]:
            st.checkbox("자율활동", value=True, key="hub_pf_inc_auto")
        with hs[2]:
            st.checkbox("진로활동", value=True, key="hub_pf_inc_career")
        with hs[3]:
            st.checkbox("행동발달 특기사항", value=True, key="hub_pf_inc_behavior")

    if st.session_state.get("bulk_portfolio_gen_pending"):
        st.warning("모든 학생의 포트폴리오를 생성하시겠습니까?")
        y1, y2 = st.columns(2)
        if y1.button("예", type="primary", key="bulk_pf_yes"):
            sems = set()
            if st.session_state.get("hub_pf_sem1", True):
                sems.add("s1")
            if st.session_state.get("hub_pf_sem2", True):
                sems.add("s2")
            inc_c = st.session_state.get("hub_pf_inc_counsel", True)
            inc_a = st.session_state.get("hub_pf_inc_auto", True)
            inc_cr = st.session_state.get("hub_pf_inc_career", True)
            inc_b = st.session_state.get("hub_pf_inc_behavior", True)
            if not sems:
                st.error("학기를 한 개 이상 선택해 주세요.")
            elif not (inc_c or inc_a or inc_cr or inc_b):
                st.error("최소 1개 선택은 필수입니다.")
            else:
                with st.spinner("전원 포트폴리오 생성 중..."):
                    msg = run_bulk_portfolio_generate(
                        sems,
                        include_counseling=inc_c,
                        include_autonomous=inc_a,
                        include_career=inc_cr,
                        include_behavior=inc_b,
                    )
                st.session_state.bulk_portfolio_gen_pending = False
                st.session_state._flash = msg
                st.rerun()
        if y2.button("아니오", key="bulk_pf_no"):
            st.session_state.bulk_portfolio_gen_pending = False
            st.rerun()
    elif st.session_state.get("bulk_zip_show_options"):
        st.caption("범위를 선택한 뒤 ZIP을 생성해 주세요.")
        zb1, zb2 = st.columns(2)
        if zb1.button(
            "선택한 범위로 ZIP 만들기", type="primary", key="bulk_zip_build_btn", use_container_width=True
        ):
            sems = set()
            if st.session_state.get("hub_pf_sem1", True):
                sems.add("s1")
            if st.session_state.get("hub_pf_sem2", True):
                sems.add("s2")
            inc_c = st.session_state.get("hub_pf_inc_counsel", True)
            inc_a = st.session_state.get("hub_pf_inc_auto", True)
            inc_cr = st.session_state.get("hub_pf_inc_career", True)
            inc_b = st.session_state.get("hub_pf_inc_behavior", True)
            err_line = None
            if not sems:
                err_line = "학기를 한 개 이상 선택해 주세요."
            elif not (inc_c or inc_a or inc_cr or inc_b):
                err_line = "최소 1개 선택은 필수입니다."
            if err_line:
                st.error(err_line)
            else:
                with st.spinner("PDF 및 ZIP 생성 중..."):
                    zbytes, warn = build_all_portfolios_zip(
                        sems,
                        include_counseling=inc_c,
                        include_autonomous=inc_a,
                        include_career=inc_cr,
                        include_behavior=inc_b,
                    )
                if zbytes is None:
                    st.error(warn or "ZIP을 만들 수 없습니다.")
                else:
                    st.session_state.bulk_zip_bytes = zbytes
                    st.session_state.bulk_zip_show_options = False
                    st.session_state._flash = warn or "ZIP을 준비했습니다. 아래에서 받아 주세요."
                    st.rerun()
        if zb2.button("취소", key="bulk_zip_opts_cancel", use_container_width=True):
            st.session_state.bulk_zip_show_options = False
            st.rerun()
    else:
        students_roster = list_students()
        if st.button("📝 활동 기록 (일괄)", use_container_width=True, key="bulk_hub_activity"):
            go_bulk_activity()
            st.rerun()
        if st.button("🧾 평가하기", use_container_width=True, key="bulk_hub_eval"):
            if not students_roster:
                st.session_state._flash = "평가할 학생이 없습니다."
            else:
                go_bulk_evaluation()
            st.rerun()
        if st.button("📁 포트폴리오 생성 (전원)", use_container_width=True, key="bulk_hub_pf_gen"):
            if not students_roster:
                st.session_state._flash = "학생이 없습니다."
            else:
                st.session_state.bulk_zip_show_options = False
                st.session_state.bulk_portfolio_gen_pending = True
            st.rerun()
        if st.button("📦 포트폴리오 ZIP 다운", use_container_width=True, key="bulk_hub_pf_zip"):
            if not students_roster:
                st.session_state._flash = "다운로드할 학생이 없습니다."
            else:
                st.session_state.bulk_portfolio_gen_pending = False
                st.session_state.bulk_zip_show_options = True
            st.rerun()

    if st.session_state.get("bulk_zip_bytes"):
        _zip_fn = f"class_portfolios_{datetime.now().strftime('%Y%m%d_%H%M')}.zip"
        st.download_button(
            "ZIP 파일 받기",
            data=st.session_state.bulk_zip_bytes,
            file_name=_zip_fn,
            mime="application/zip",
            use_container_width=True,
            key="bulk_zip_download_btn",
        )


def render_backup_restore_panel(*, key_prefix: str) -> None:
    """기초작업·대시보드 공통: 계정 단위 ZIP 백업/복원."""
    uid = st.session_state.get("auth_user_id")
    if uid is None:
        return
    uid = int(uid)
    st.markdown('<p class="geo-section-label">💾 백업 / 복원</p>', unsafe_allow_html=True)
    st.caption(
        "인터넷(URL)으로 쓰는 서버와 내 PC에 깐 프로그램은 **서로 다른 저장소**를 씁니다. "
        "자동으로 맞춰지지 않으니, 옮기거나 새 ZIP으로 설치할 때는 이 백업 파일을 사용하세요. "
        "**지금 로그인한 계정**의 학생·기록·담임 설정만 들어 있습니다."
    )
    urow = get_app_user_by_id(uid)
    safe_u = re.sub(r"[^0-9A-Za-z가-힣_-]+", "_", (urow["username"] if urow else "user"))[:40]
    bdata, berr = export_account_backup_zip(uid)
    if berr:
        st.error(berr)
    elif bdata:
        fn = f"classmanager_backup_{safe_u}_{datetime.now().strftime('%Y%m%d_%H%M')}.zip"
        st.download_button(
            label="내 데이터 백업 받기 (ZIP)",
            data=bdata,
            file_name=fn,
            mime="application/zip",
            use_container_width=True,
            key=f"{key_prefix}_backup_download",
        )

    st.markdown("**백업에서 복원**")
    replace = st.checkbox(
        "이 계정에 이미 있는 학생·기록을 **모두 지우고** 백업 내용으로 덮어씁니다.",
        value=False,
        key=f"{key_prefix}_backup_replace",
    )
    st.caption("덮어쓰지 않으면, 명부가 **비어 있을 때만** 복원할 수 있습니다.")
    up = st.file_uploader(
        "백업 ZIP 선택",
        type=["zip"],
        key=f"{key_prefix}_backup_upload",
    )
    if st.button("선택한 백업으로 복원", type="primary", key=f"{key_prefix}_backup_restore_btn"):
        if up is None:
            st.error("ZIP 파일을 선택해 주세요.")
        else:
            ok, msg = import_account_backup_zip(
                up.getvalue(),
                uid,
                replace_existing=replace,
            )
            if ok:
                st.session_state._flash = msg
                st.rerun()
            else:
                st.error(msg)


def render_user_manual_page():
    inject_dashboard_extra_style()
    show_flash()
    st.markdown('<p class="geo-section-label">📖 사용 설명서</p>', unsafe_allow_html=True)
    st.info("이 화면에 사용 방법을 정리하고, PDF 다운로드 버튼을 두는 작업은 추후 협의하여 진행합니다.")


def render_setup_page():
    inject_dashboard_extra_style()
    show_flash()

    st.markdown('<p class="geo-section-label">🛠️ 기초작업</p>', unsafe_allow_html=True)
    st.caption("엑셀 서식 다운로드와 업로드를 여기서 진행합니다.")

    a1, a2 = st.columns(2)
    with a1:
        st.download_button(
            label="엑셀 서식 다운로드",
            data=excel_template_bytes(),
            file_name=ROSTER_TEMPLATE_DOWNLOAD_NAME,
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            key="download_excel_template_setup",
        )
    with a2:
        uploaded_xlsx = st.file_uploader(
            "엑셀 업로드",
            type=["xlsx"],
            key=f"roster_excel_upload_{st.session_state.uploader_nonce}",
        )

    up = uploaded_xlsx
    if up is None:
        st.session_state.pop("_roster_import_sig", None)
    else:
        raw = up.getvalue()
        sig = (up.name, hashlib.md5(raw).hexdigest())
        if st.session_state.get("_roster_import_sig") != sig:
            added, updated, blank, err = import_students_from_excel_bytes(
                raw, acting_user_id=st.session_state.get("auth_user_id")
            )
            st.session_state._roster_import_sig = sig
            st.session_state.uploader_nonce += 1
            if err:
                st.error(err)
            else:
                parts = []
                if added:
                    parts.append(f"새로 추가 {added}명")
                if updated:
                    parts.append(f"정보 갱신 {updated}명")
                if blank:
                    parts.append(f"건너뜀(빈칸) {blank}행")
                st.session_state._flash = (
                    (" · ".join(parts) if parts else "변경 사항 없음") + "."
                )
                st.rerun()

    st.divider()
    render_backup_restore_panel(key_prefix="setup")


def render_add_student_page():
    inject_dashboard_extra_style()
    show_flash()

    st.markdown('<p class="geo-section-label">🧾 학생 직접 추가</p>', unsafe_allow_html=True)
    st.caption("엑셀 서식 항목을 설문 형태로 직접 입력합니다. (학번·이름 필수)")

    with st.form("add_student_form", clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            number = st.text_input("학번 *", placeholder="예: 20104")
            name = st.text_input("이름 *", placeholder="예: 홍길동")
            gender = st.selectbox("성별", options=["", "남", "여"], index=0)
            student_phone = st.text_input(
                "본인 휴대폰 번호", placeholder="예: 010-1234-5678"
            )
        with c2:
            primary_guardian = st.text_input("주 보호자", placeholder="예: 어머니")
            guardian_phone = st.text_input(
                "보호자 휴대폰 번호", placeholder="예: 010-9876-5432"
            )
            hobbies_skills = st.text_input("취미나 특기", placeholder="예: 독서, 축구")
            career_interest = st.text_input("희망 진로", placeholder="예: 데이터 사이언티스트")

        submitted = st.form_submit_button("추가하기", type="primary")
        if submitted:
            ok, msg = add_student_form(
                number=number,
                name=name,
                gender=gender,
                student_phone=student_phone,
                primary_guardian=primary_guardian,
                guardian_phone=guardian_phone,
                hobbies_skills=hobbies_skills,
                career_interest=career_interest,
            )
            if ok:
                st.session_state._flash = f"{number.strip()} {name.strip()} 학생이 추가되었습니다."
                go_dashboard()
                st.rerun()
            st.error(msg)


def render_evaluation_page(student_id: int, *, bulk_mode: bool = False):
    show_flash()
    row = get_student(student_id)
    if not row:
        st.error("학생을 찾을 수 없습니다. 이 계정 명부에 없는 학생일 수 있습니다. 상단 **메인화면**을 이용해 주세요.")
        return

    if not bulk_mode:
        st.markdown(
            f'<p class="geo-detail-title">{html.escape(row["name"])} {gender_emoji(row["gender"])} · 평가하기</p>',
            unsafe_allow_html=True,
        )
        st.markdown(
            f'<p class="geo-detail-meta">학번 {html.escape(str(row["number"]))}</p>',
            unsafe_allow_html=True,
        )
    st.caption("각 문항은 1점(낮음)~5점(높음)으로 평가해 주세요.")
    eval_row = get_student_evaluation(student_id)

    with st.form(f"teacher_eval_form_{student_id}"):
        scores: list[int] = []
        comments: list[str] = []
        for idx, q in enumerate(EVALUATION_QUESTIONS, start=1):
            st.markdown(f"**문항 {idx}**")
            st.markdown(q)
            default_score = eval_row[f"q{idx}_score"] if eval_row[f"q{idx}_score"] is not None else 3
            s = st.selectbox(
                f"문항 {idx} 점수",
                options=[1, 2, 3, 4, 5],
                index=max(0, min(4, int(default_score) - 1)),
                key=f"eval_score_{student_id}_{idx}",
                format_func=lambda x: f"{x}점",
            )
            cmt = st.text_area(
                f"문항 {idx}과 관련된 선생님의 추가 의견이 있다면 입력해주세요.",
                value=eval_row[f"q{idx}_comment"] or "",
                height=95,
                key=f"eval_comment_{student_id}_{idx}",
            )
            scores.append(s)
            comments.append(cmt)
            st.divider()

        overall = st.text_area(
            "교사 총평",
            value=eval_row["overall_comment"] or "",
            height=180,
            key=f"eval_overall_{student_id}",
            placeholder="학생의 1년 성장을 종합적으로 작성해 주세요.",
        )
        b1, b2 = st.columns(2)
        submitted = b1.form_submit_button("평가 저장", type="primary")
        back = b2.form_submit_button(
            "← 일괄 관리로 돌아가기" if bulk_mode else "학생 페이지로 돌아가기"
        )
        if submitted:
            ok, msg = save_student_evaluation(student_id, scores, comments, overall)
            if ok:
                st.session_state._flash = "평가가 저장되었습니다."
                if not bulk_mode:
                    go_detail(student_id)
                st.rerun()
            st.error(msg)
        if back:
            if bulk_mode:
                go_dashboard()
            else:
                go_detail(student_id)
            st.rerun()


def render_bulk_evaluation_page():
    inject_dashboard_extra_style()
    students = list_students()
    if not students:
        show_flash()
        st.info("학생이 없습니다. 상단 **메인화면**에서 돌아갈 수 있습니다.")
        return

    ids = [int(s["id"]) for s in students]
    sid = st.session_state.get("student_id")
    if sid is None or int(sid) not in ids:
        st.session_state.student_id = ids[0]
        sid = ids[0]
    sid = int(sid)
    idx = ids.index(sid)
    cur = students[idx]

    n1, n2, n3 = st.columns([1, 6, 1])
    with n1:
        if st.button("◀", key="bulk_eval_prev", use_container_width=True, disabled=idx <= 0):
            st.session_state.student_id = ids[idx - 1]
            st.rerun()
    with n2:
        em = gender_emoji(cur["gender"])
        st.markdown(
            f'<p class="geo-detail-title" style="text-align:center;margin-bottom:0.25rem;">'
            f"{html.escape(cur['name'])} {em}</p>",
            unsafe_allow_html=True,
        )
        st.markdown(
            f'<p class="geo-detail-meta" style="text-align:center;">'
            f"학번 {html.escape(str(cur['number']))} · {idx + 1}/{len(students)}</p>",
            unsafe_allow_html=True,
        )
    with n3:
        if st.button(
            "▶",
            key="bulk_eval_next",
            use_container_width=True,
            disabled=idx >= len(students) - 1,
        ):
            st.session_state.student_id = ids[idx + 1]
            st.rerun()

    st.divider()
    render_evaluation_page(sid, bulk_mode=True)


def render_bulk_activity_page():
    inject_dashboard_extra_style()
    show_flash()

    st.markdown('<p class="geo-section-highlight">⚡ 활동 기록 (일괄)</p>', unsafe_allow_html=True)
    st.caption("자율/진로 활동을 선택한 학생에게 일괄 적용합니다.")

    students = list_students()
    if not students:
        st.info(
            "이 계정의 명부에 학생이 없습니다. 기초작업에서 엑셀을 업로드하거나 +학생추가로 직접 입력해 주세요. "
            "상단 **메인화면**에서 돌아갈 수 있습니다."
        )
        return

    pending = st.session_state.get("activity_apply_pending")
    if pending:
        st.warning("선택한 학생들에게 활동을 일괄 적용하시겠습니까?")
        st.caption(
            f"{pending['label']} · {pending['date']} · 대상 {len(pending['student_ids'])}명"
        )
        p1, p2 = st.columns(2)
        if p1.button("확인", key="activity_apply_confirm", type="primary"):
            added, dup = bulk_apply_activity_records(
                student_ids=pending["student_ids"],
                category=pending["category"],
                activity_name=pending["activity_name"],
                activity_date=pending["date"],
                activity_content=pending["activity_content"],
                teacher_observation=pending["teacher_observation"],
            )
            st.session_state.activity_apply_pending = None
            st.session_state._flash = f"일괄 적용 완료: 성공 {added}건 · 중복 건너뜀 {dup}건."
            st.rerun()
        if p2.button("취소", key="activity_apply_cancel"):
            st.session_state.activity_apply_pending = None
            st.rerun()

    d1, d2 = st.columns(2)
    with d1:
        cat_label = st.selectbox("영역", ["자율활동", "진로활동"], key="activity_cat_label")
        activity_name = st.text_input("활동명", key="activity_name_input")
        activity_date = st.date_input("활동일", key="activity_date_input")
    with d2:
        activity_content = st.text_area(
            "활동 내용(공통)",
            height=95,
            key="activity_content_input",
            placeholder="선택 학생들에게 공통 반영할 활동 내용을 입력해 주세요.",
        )
        teacher_observation = st.text_area(
            "교사 관찰 결과(공통)",
            height=95,
            key="activity_teacher_obs_input",
            placeholder="공통 관찰 결과가 있으면 입력해 주세요.",
        )

    id_to_label = {
        int(s["id"]): f"{s['number']} {s['name']} {gender_emoji(s['gender'])}" for s in students
    }
    all_ids = list(id_to_label.keys())
    current_selected = set(st.session_state.get("activity_target_students", []))
    all_selected_now = len(all_ids) > 0 and len(current_selected) == len(all_ids)
    st.markdown("**적용 대상 학생**")
    h1, h2, h3 = st.columns([6, 2.2, 1.8])
    with h1:
        st.caption("학생 이름 오른쪽 체크칸을 선택해 주세요.")
    with h3:
        toggle_all = st.checkbox("전체 선택", value=all_selected_now, key="activity_select_all_toggle")
    if toggle_all != all_selected_now:
        new_state = bool(toggle_all)
        st.session_state.activity_target_students = all_ids if new_state else []
        for sid in all_ids:
            st.session_state[f"activity_chk_{sid}"] = new_state
        st.rerun()

    selected_students = []
    checked_ids = set(st.session_state.get("activity_target_students", []))
    check_cols = st.columns(5)
    for idx, sid in enumerate(all_ids):
        chk_key = f"activity_chk_{sid}"
        if chk_key not in st.session_state:
            st.session_state[chk_key] = sid in checked_ids
        with check_cols[idx % 5]:
            checked = st.checkbox(
                id_to_label.get(sid, str(sid)),
                key=chk_key,
            )
            if checked:
                selected_students.append(sid)
    st.session_state.activity_target_students = selected_students

    cat_key = "autonomous" if cat_label == "자율활동" else "career"
    duplicate_count = count_activity_duplicates(
        student_ids=[int(x) for x in selected_students],
        category=cat_key,
        activity_name=activity_name,
        activity_date=activity_date.isoformat(),
    )
    st.caption(
        f"미리보기 · 영역: {cat_label} · 대상: {len(selected_students)}명 · 중복 예상: {duplicate_count}건"
    )

    if st.button("선택한 학생에게 일괄 적용", type="primary", key="activity_apply_btn"):
        if not activity_name or not activity_name.strip():
            st.error("활동명을 입력해 주세요.")
        elif not selected_students:
            st.error("적용할 학생을 1명 이상 선택해 주세요.")
        else:
            st.session_state.activity_apply_pending = {
                "category": cat_key,
                "label": cat_label,
                "activity_name": activity_name.strip(),
                "date": activity_date.isoformat(),
                "activity_content": (activity_content or "").strip(),
                "teacher_observation": (teacher_observation or "").strip(),
                "student_ids": [int(x) for x in selected_students],
            }
            st.rerun()


def render_detail(student_id: int):
    show_flash()
    row = get_student(student_id)
    if not row:
        st.error("학생을 찾을 수 없습니다. 이 계정 명부에 없는 학생이거나 잘못된 접근일 수 있습니다.")
        return

    pc = st.session_state.get("pending_confirm")
    if pc is not None:
        typ, pid = pc
        st.warning("정말 삭제하시겠습니까?")
        if typ == "delete_student":
            st.caption(
                "학생 기본 정보·상담 기록·생기부(자율·진로·행발) 메모가 모두 삭제됩니다."
            )
        elif typ == "reset_counselings":
            st.caption(
                "상담 기록과 생기부(자율·진로·행발) 메모가 모두 삭제되며, 학생 기본 정보는 유지됩니다."
            )
        elif typ == "delete_counseling":
            st.caption("이 상담 기록을 삭제합니다.")
        elif typ == "delete_life":
            st.caption("이 생기부 참고 기록을 삭제합니다.")
        elif typ == "generate_portfolio":
            st.caption("학생의 이번 학년도 포트폴리오를 생성하시겠습니까?")
            p1, p2 = st.columns(2)
            with p1:
                st.checkbox("1학기(3~7월)", value=True, key="portfolio_sem1")
            with p2:
                st.checkbox("2학기(8~2월)", value=True, key="portfolio_sem2")
            st.markdown("**포함할 기록**")
            q1, q2, q3, q4 = st.columns(4)
            with q1:
                st.checkbox("개별 상담", value=True, key="portfolio_inc_counsel")
            with q2:
                st.checkbox("자율활동", value=True, key="portfolio_inc_auto")
            with q3:
                st.checkbox("진로활동", value=True, key="portfolio_inc_career")
            with q4:
                st.checkbox("행동발달 특기사항", value=True, key="portfolio_inc_behavior")
        c_yes, c_no = st.columns(2)
        if c_yes.button("확인", key="pending_confirm_yes", type="primary"):
            if typ == "delete_student" and pid == student_id:
                if delete_student(student_id):
                    st.session_state.pending_confirm = None
                    st.session_state._flash = "학생이 삭제되었습니다."
                    go_dashboard()
                    st.rerun()
                st.error("삭제에 실패했습니다. 다시 시도해 주세요.")
            elif typ == "reset_counselings" and pid == student_id:
                reset_counselings(student_id)
                st.session_state.pending_confirm = None
                st.session_state._flash = "상담·생기부 기록이 초기화되었습니다."
                set_detail_expand("counseling")
                st.rerun()
            elif typ == "delete_counseling":
                if delete_counseling(pid):
                    st.session_state.pending_confirm = None
                    st.session_state._flash = "상담 기록이 삭제되었습니다."
                    set_detail_expand("counseling")
                    st.rerun()
                st.error("삭제에 실패했습니다. 다시 시도해 주세요.")
            elif typ == "delete_life":
                rec = get_life_record(pid)
                if rec and rec["student_id"] == student_id and delete_life_record(pid):
                    st.session_state.pending_confirm = None
                    st.session_state._flash = "기록이 삭제되었습니다."
                    cat = rec["category"]
                    if cat in DETAIL_EXPAND_SECTIONS:
                        set_detail_expand(cat)
                    st.rerun()
                st.error("삭제에 실패했습니다. 다시 시도해 주세요.")
            elif typ == "generate_portfolio" and pid == student_id:
                sems = set()
                if st.session_state.get("portfolio_sem1", True):
                    sems.add("s1")
                if st.session_state.get("portfolio_sem2", True):
                    sems.add("s2")
                inc_c = st.session_state.get("portfolio_inc_counsel", True)
                inc_a = st.session_state.get("portfolio_inc_auto", True)
                inc_cr = st.session_state.get("portfolio_inc_career", True)
                inc_b = st.session_state.get("portfolio_inc_behavior", True)
                if not sems:
                    st.error("최소 한 개 학기를 선택해 주세요.")
                elif not (inc_c or inc_a or inc_cr or inc_b):
                    st.error("최소 1개 선택은 필수입니다.")
                else:
                    pdf_bytes, err = build_portfolio_pdf(
                        row,
                        sems,
                        include_counseling=inc_c,
                        include_autonomous=inc_a,
                        include_career=inc_cr,
                        include_behavior=inc_b,
                    )
                    if err:
                        st.error(err)
                    elif pdf_bytes is not None:
                        label = "전체" if sems == {"s1", "s2"} else ("1학기" if "s1" in sems else "2학기")
                        safe_name = re.sub(r"[^0-9A-Za-z가-힣_\\-]+", "_", str(row["name"]))
                        st.session_state.portfolio_pdf_bytes = pdf_bytes
                        st.session_state.portfolio_pdf_name = f"{row['number']}_{safe_name}_{label}_포트폴리오.pdf"
                        st.session_state.pending_confirm = None
                        st.session_state._flash = "포트폴리오가 생성되었습니다."
                        st.rerun()
        if c_no.button("취소", key="pending_confirm_no"):
            st.session_state.pending_confirm = None
            st.rerun()
        st.stop()

    head_l, head_r = st.columns([3, 2])
    with head_l:
        st.markdown(
            f'<p class="geo-detail-title">{html.escape(row["name"])} {gender_emoji(row["gender"])}</p>',
            unsafe_allow_html=True,
        )
        st.markdown(
            f'<p class="geo-detail-meta">학번 {html.escape(str(row["number"]))}</p>',
            unsafe_allow_html=True,
        )
        extra_lines = []
        for key, label in DETAIL_EXTRA_LABELS:
            raw = row[key]
            val = "" if raw is None else str(raw).strip()
            if val:
                extra_lines.append(
                    f'<p class="geo-detail-extra">{html.escape(label)}: {html.escape(val)}</p>'
                )
        if extra_lines:
            st.markdown("".join(extra_lines), unsafe_allow_html=True)
    with head_r:
        r1, r2 = st.columns(2)
        with r1:
            if st.button("초기화", key="detail_reset_btn", use_container_width=True):
                st.session_state.pending_confirm = ("reset_counselings", student_id)
                st.rerun()
        with r2:
            if st.button("학생 삭제", key="detail_delete_btn", use_container_width=True):
                st.session_state.pending_confirm = ("delete_student", student_id)
                st.rerun()

    st.divider()
    st.markdown(
        '<p class="geo-section-label" style="margin-bottom:0.75rem;">📝 기록하기</p>',
        unsafe_allow_html=True,
    )
    st.caption("이 영역에서는 새 기록만 작성합니다.")

    wex = _detail_write_expand_active()
    with st.expander("개별 상담", expanded=(wex == "counseling")):
        render_counseling_write_section(student_id)

    with st.expander("자율활동", expanded=(wex == "autonomous")):
        render_life_write_section(student_id, "autonomous")

    with st.expander("진로활동", expanded=(wex == "career")):
        render_life_write_section(student_id, "career")

    with st.expander("행동발달 특기사항", expanded=(wex == "behavior")):
        render_life_write_section(student_id, "behavior")

    st.divider()
    st.markdown(
        '<p class="geo-section-label" style="margin-bottom:0.75rem;">🔎 확인하기</p>',
        unsafe_allow_html=True,
    )
    st.caption("저장된 기록을 학기별로 조회하고 수정/삭제할 수 있습니다.")

    dex = _detail_expand_active()
    with st.expander("개별 상담", expanded=(dex == "counseling")):
        render_counseling_section(student_id)

    with st.expander("자율활동", expanded=(dex == "autonomous")):
        render_life_section(student_id, "autonomous")

    with st.expander("진로활동", expanded=(dex == "career")):
        render_life_section(student_id, "career")

    with st.expander("행동발달 특기사항", expanded=(dex == "behavior")):
        render_life_section(student_id, "behavior")

    st.divider()
    st.markdown(
        '<p class="geo-section-label" style="margin-bottom:0.55rem;">🧩 마무리 작업</p>',
        unsafe_allow_html=True,
    )
    f1, f2 = st.columns(2)
    if f1.button("🧾 평가하기", key="detail_eval_btn", use_container_width=True):
        go_evaluation(student_id)
        st.rerun()
    if f2.button("📁 포트폴리오 생성", key="detail_portfolio_btn", use_container_width=True):
        st.session_state.pending_confirm = ("generate_portfolio", student_id)
        st.rerun()

    if st.session_state.get("portfolio_pdf_bytes"):
        st.download_button(
            "PDF 다운로드",
            data=st.session_state.portfolio_pdf_bytes,
            file_name=st.session_state.get("portfolio_pdf_name", "portfolio.pdf"),
            mime="application/pdf",
            use_container_width=True,
            key="detail_portfolio_download_btn",
        )


def main():
    st.set_page_config(
        page_title="클래스 매니저",
        page_icon="🎓",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    inject_style()
    init_db()
    ensure_session()

    if count_app_users() == 0:
        render_bootstrap_admin()
        return

    uid = st.session_state.get("auth_user_id")
    if uid is not None:
        u = get_app_user_by_id(uid)
        if not u:
            st.session_state.auth_user_id = None
            uid = None
        elif u["status"] == "rejected":
            st.session_state.auth_user_id = None
            render_login_signup(banner="가입이 거절된 계정입니다. 관리자에게 문의해 주세요.")
            return
        elif u["status"] == "pending":
            render_pending_approval(u)
            return

    if uid is None:
        render_login_signup()
        return

    u = get_app_user_by_id(uid)
    if not u or u["status"] != "approved":
        st.session_state.auth_user_id = None
        render_login_signup(banner="세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.")
        return

    if not homeroom_profile_is_complete(uid):
        render_homeroom_onboarding()
        return

    render_app_top_navigation()

    if st.session_state.view == "detail" and st.session_state.student_id is not None:
        render_detail(st.session_state.student_id)
    elif st.session_state.view == "evaluation" and st.session_state.student_id is not None:
        render_evaluation_page(st.session_state.student_id)
    elif st.session_state.view == "bulk_activity":
        render_bulk_activity_page()
    elif st.session_state.view == "bulk_evaluation" and st.session_state.student_id is not None:
        render_bulk_evaluation_page()
    elif st.session_state.view == "user_manual":
        render_user_manual_page()
    elif st.session_state.view == "setup":
        render_setup_page()
    elif st.session_state.view == "add_student":
        render_add_student_page()
    elif st.session_state.view == "admin":
        render_admin_page()
    else:
        render_dashboard()


if __name__ == "__main__":
    main()
