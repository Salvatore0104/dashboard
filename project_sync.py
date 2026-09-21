"""Local-first project -> EasyAI organization synchronization.

The adapter defaults to mock mode. Real EasyAI writes require an explicit
EASYAI_SYNC_MODE=real setting and credentials supplied through the environment.
"""
import hashlib
import json
import os
import re
import time
import uuid
import base64
import threading
from collections import Counter, defaultdict

import requests
from cryptography.fernet import Fernet, InvalidToken


TEST_PREFIX = os.getenv("EASYAI_TEST_ORG_PREFIX", "[TEST][dashboard-local]").strip()
SYNC_MODE = os.getenv("EASYAI_SYNC_MODE", "mock").strip().lower()
SYNC_ENABLED = os.getenv("EASYAI_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
PARENT_ORG_NAME = os.getenv("EASYAI_PARENT_ORG_NAME", "执行项目组").strip()
EASYAI_BASE_URL = "https://wowidea.top/api"
EASYAI_KEY_HEADER = os.getenv("EASYAI_ADMIN_API_KEY_HEADER", "X-Admin-Access-Key").strip()
EASYAI_AUTH_PATH = "/auth/boss/login"
EASYAI_AUTH_USERNAME_FIELD = "username"
EASYAI_AUTH_PASSWORD_FIELD = "password"
_AUTH_CACHE = {}
_AUTH_CACHE_LOCK = threading.Lock()


def normalize_base_url(value):
    base = str(value or "").strip().rstrip("/")
    if not base:
        return "https://wowidea.top/api"
    return base if base.endswith("/api") else f"{base}/api"


def _config_key_path():
    return os.getenv("EASYAI_CONFIG_KEY_FILE", os.path.join(os.path.dirname(__file__), ".easyai-config.key"))


def _cipher():
    configured = os.getenv("EASYAI_CONFIG_ENCRYPTION_KEY", "").strip()
    if configured:
        return Fernet(configured.encode("utf-8"))
    path = _config_key_path()
    if os.path.exists(path):
        with open(path, "rb") as handle:
            key = handle.read().strip()
    else:
        key = Fernet.generate_key()
        with open(path, "wb") as handle:
            handle.write(key)
    return Fernet(key)


def encrypt_secret(value):
    if not value:
        return ""
    return _cipher().encrypt(str(value).encode("utf-8")).decode("ascii")


def decrypt_secret(value):
    if not value:
        return ""
    try:
        return _cipher().decrypt(str(value).encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        raise RuntimeError("wowidea 管理凭据解密失败，请检查 EASYAI_CONFIG_ENCRYPTION_KEY")


def mask_secret(value):
    value = str(value or "")
    return f"{'*' * max(4, len(value) - 4)}{value[-4:]}" if value else ""


def load_easyai_runtime_config(conn=None):
    config = {}
    if conn is not None:
        rows = conn.execute("SELECT key, value FROM config WHERE key IN ('easyai_admin_base_url', 'easyai_admin_api_key_header', 'easyai_admin_api_key_encrypted', 'easyai_admin_username', 'easyai_admin_password_encrypted', 'easyai_auth_path', 'easyai_auth_username_field', 'easyai_auth_password_field', 'easyai_auth_token_field')").fetchall()
        config.update({row["key"]: row["value"] for row in rows})
    encrypted = config.get("easyai_admin_api_key_encrypted", "")
    return {
        "base_url": EASYAI_BASE_URL,
        "key_header": EASYAI_KEY_HEADER,
        "api_key": os.getenv("EASYAI_ADMIN_API_KEY", ""),
        "username": config.get("easyai_admin_username") or os.getenv("EASYAI_ADMIN_USERNAME", ""),
        "password": decrypt_secret(config.get("easyai_admin_password_encrypted", "")) if config.get("easyai_admin_password_encrypted") else os.getenv("EASYAI_ADMIN_PASSWORD", ""),
        "auth_path": EASYAI_AUTH_PATH,
        "username_field": EASYAI_AUTH_USERNAME_FIELD,
        "password_field": EASYAI_AUTH_PASSWORD_FIELD,
        "token_field": "",
    }


def migrate_legacy_easyai_password(conn):
    """Encrypt and remove the pre-encryption password setting."""
    legacy = conn.execute("SELECT value FROM config WHERE key=?", ('easyai_admin_password',)).fetchone()
    if not legacy:
        return False
    current = conn.execute("SELECT value FROM config WHERE key=?", ('easyai_admin_password_encrypted',)).fetchone()
    if not current and legacy['value']:
        conn.execute(
            'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
            ('easyai_admin_password_encrypted', encrypt_secret(legacy['value'])),
        )
    conn.execute('DELETE FROM config WHERE key=?', ('easyai_admin_password',))
    return True


def now_ms():
    return int(time.time() * 1000)


def normalize_name(value):
    return re.sub(r"[\s\u3000]+", "", str(value or "")).casefold()


def test_org_name(name):
    raw = str(name or "未命名项目").strip()
    prefix = TEST_PREFIX or "[TEST][dashboard-local]"
    return raw if raw.startswith(prefix) else f"{prefix} {raw}"


def redact_error(error):
    text = str(error or "同步失败")
    text = re.sub(r"(?i)(authorization|x-api-key|api[-_]?key|token|secret|password)\s*[:=]\s*[^,;\s]+", r"\1=[REDACTED]", text)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}\b", "sk-[REDACTED]", text)
    return text[:500]


class EasyAIClient:
    def __init__(self, runtime_config=None):
        self.mode = SYNC_MODE
        runtime_config = runtime_config or {}
        self.base_url = normalize_base_url(runtime_config.get("base_url") or EASYAI_BASE_URL)
        self.key_header = str(runtime_config.get("key_header") or EASYAI_KEY_HEADER).strip()
        self.api_key = str(runtime_config.get("api_key") or os.getenv("EASYAI_ADMIN_API_KEY", "")).strip()
        self.username = str(runtime_config.get("username") or "").strip()
        self.password = str(runtime_config.get("password") or "")
        self.auth_path = str(runtime_config.get("auth_path") or EASYAI_AUTH_PATH).strip()
        self.username_field = str(runtime_config.get("username_field") or EASYAI_AUTH_USERNAME_FIELD).strip()
        self.password_field = str(runtime_config.get("password_field") or EASYAI_AUTH_PASSWORD_FIELD).strip()
        self.token_field = str(runtime_config.get("token_field") or "").strip()
        self._mock_users = {}
        self._mock_orgs = {}

    def _headers(self):
        if self.username or self.password:
            if not self.username or not self.password:
                raise RuntimeError("wowidea 管理员账号或密码未完整配置")
            return {"Authorization": f"Bearer {self._get_bearer_token()}", "Content-Type": "application/json"}
        if not self.api_key:
            raise RuntimeError("wowidea 管理员登录或兼容 Key 未配置")
        return {self.key_header: self.api_key, "Content-Type": "application/json"}

    def _extract_token(self, data):
        if not isinstance(data, dict):
            return ""
        if self.token_field:
            value = data
            for part in self.token_field.split("."):
                if not isinstance(value, dict):
                    value = None
                    break
                value = value.get(part)
            if value:
                return str(value)
        for key in ("access_token", "accessToken", "token", "jwt"):
            if data.get(key):
                return str(data[key])
        for key in ("data", "result", "user"):
            token = self._extract_token(data.get(key))
            if token:
                return token
        return ""

    @staticmethod
    def _token_expiry(token, data):
        expires_in = data.get("expires_in") if isinstance(data, dict) else None
        if expires_in is None and isinstance(data, dict):
            expires_in = data.get("expiresIn")
        try:
            if expires_in is not None:
                return time.time() + max(30, float(expires_in))
        except (TypeError, ValueError):
            pass
        try:
            payload = token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
            if claims.get("exp"):
                return float(claims["exp"])
        except (IndexError, ValueError, TypeError, json.JSONDecodeError):
            pass
        return time.time() + 300

    def _get_bearer_token(self):
        cache_key = (self.base_url, self.auth_path, self.username)
        with _AUTH_CACHE_LOCK:
            cached = _AUTH_CACHE.get(cache_key)
            if cached and cached["expires_at"] > time.time() + 30:
                return cached["token"]
        payload = {self.username_field: self.username, self.password_field: self.password}
        try:
            response = requests.post(f"{self.base_url}{self.auth_path}", json=payload, timeout=15)
            if not response.ok:
                raise RuntimeError(f"wowidea 登录失败：HTTP {response.status_code}")
            data = response.json() if response.content else {}
            token = self._extract_token(data)
            if not token:
                raise RuntimeError("wowidea 登录响应缺少 JWT")
            expires_at = self._token_expiry(token, data)
            with _AUTH_CACHE_LOCK:
                _AUTH_CACHE[cache_key] = {"token": token, "expires_at": expires_at}
            return token
        except requests.RequestException as exc:
            raise RuntimeError(f"wowidea 登录网络错误：{exc.__class__.__name__}")
        except ValueError:
            raise RuntimeError("wowidea 登录响应不是 JSON")

    def _request(self, method, path, **kwargs):
        response = requests.request(method, f"{self.base_url}{path}", headers=self._headers(), timeout=15, **kwargs)
        if not response.ok:
            raise RuntimeError(f"EasyAI API {response.status_code} ({response.headers.get('content-type', 'unknown')})")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            raise RuntimeError(f"EasyAI API returned non-JSON ({response.status_code}, {response.headers.get('content-type', 'unknown')})")

    def list_organizations(self):
        if self.mode == "mock":
            return list(self._mock_orgs.values())
        data = self._request("GET", "/organization")
        return data if isinstance(data, list) else data.get("data", data.get("organizations", []))

    def find_parent_organization(self, name):
        orgs = self.list_organizations()
        matches = [
            org for org in orgs
            if str(org.get("name", org.get("org_name", ""))).strip() == name
        ]
        if not matches:
            raise RuntimeError(f"未找到父组织：{name}")
        if len(matches) > 1:
            raise RuntimeError(f"父组织名称冲突：{name}（找到 {len(matches)} 个）")
        parent = matches[0]
        parent_id = parent.get("id", parent.get("org_id", ""))
        if not parent_id:
            raise RuntimeError(f"父组织缺少 ID：{name}")
        return parent

    def create_organization(self, name, parent_id, external_id):
        if self.mode == "mock":
            key = str(external_id)
            if key in self._mock_orgs:
                return self._mock_orgs[key]
            org = {"id": f"mock-org-{hashlib.sha1(key.encode()).hexdigest()[:12]}", "name": name, "parent_id": parent_id, "external_id": key}
            self._mock_orgs[key] = org
            return org
        payload = {"name": name, "parent_id": parent_id, "description": f"dashboard project {external_id}", "external_id": str(external_id)}
        data = self._request("POST", "/organization", json=payload)
        return data.get("data", data)

    def update_organization_name(self, org_id, name):
        if not org_id:
            raise RuntimeError("组织更新缺少组织 ID")
        if self.mode == "mock":
            for org in self._mock_orgs.values():
                if str(org.get("id")) == str(org_id):
                    org["name"] = name
                    return org
            raise RuntimeError(f"未找到组织：{org_id}")
        data = self._request("PUT", f"/organization/{org_id}", json={"name": name})
        return data.get("data", data) if isinstance(data, dict) else data

    def list_users(self):
        if self.mode == "mock":
            return list(self._mock_users.values())
        data = self._request("GET", "/users")
        return data if isinstance(data, list) else data.get("data", data.get("users", []))

    def add_users_to_organization(self, user_ids, org_id):
        user_ids = [str(item) for item in user_ids]
        if not user_ids:
            return {"added": 0, "user_ids": []}
        if self.mode == "mock":
            return {"added": len(user_ids), "user_ids": user_ids, "org_id": org_id}
        # The set endpoint replaces a user's organization membership.  Use the
        # additive OpenAPI endpoint so existing organization access is retained.
        path = f"/v1/openapi/organization/{org_id}/users/batch/add"
        data = self._request("POST", path, json={"user_ids": user_ids})
        return data.get("data", data) if isinstance(data, dict) else data

    def bind_dingtalk_identity(self, easyai_user_id, dingtalk_user_id, dingtalk_union_id=""):
        """Bind an external identity without creating or mutating the user account.

        The production endpoint is deployment-specific, so it must be explicitly
        configured.  Refusing to guess the endpoint prevents a sync from falling
        back to an account-creation or provider-sync API.
        """
        if not easyai_user_id or not dingtalk_user_id:
            raise ValueError("绑定钉钉身份缺少平台用户 ID 或钉钉 userid")
        if self.mode == "mock":
            return {"user_id": str(easyai_user_id), "dingtalk_user_id": str(dingtalk_user_id), "dingtalk_union_id": str(dingtalk_union_id or "")}
        template = os.getenv("EASYAI_DINGTALK_BIND_PATH", "").strip()
        if not template:
            raise RuntimeError("EASYAI_DINGTALK_BIND_PATH 未配置；为避免创建新账号，已拒绝猜测钉钉绑定接口")
        path = template.format(user_id=str(easyai_user_id))
        payload = {"platform": "dingtalk", "platform_user_id": str(dingtalk_user_id), "system_user_id": str(easyai_user_id)}
        if dingtalk_union_id:
            payload["union_id"] = str(dingtalk_union_id)
        data = self._request("POST", path, json=payload)
        return data.get("data", data) if isinstance(data, dict) else data


def ensure_tables(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS project_easyai_binding (
        project_id TEXT PRIMARY KEY,
        easyai_org_id TEXT UNIQUE,
        parent_org_id TEXT,
        organization_name TEXT NOT NULL,
        is_test_org INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        last_sync_at INTEGER,
        last_error TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS external_user_identity (
        dashboard_user_id TEXT PRIMARY KEY,
        dingtalk_user_id TEXT DEFAULT '',
        dingtalk_union_id TEXT DEFAULT '',
        display_name TEXT DEFAULT '',
        normalized_name TEXT DEFAULT '',
        easyai_user_id TEXT DEFAULT '',
        match_status TEXT NOT NULL DEFAULT 'unmatched',
        match_source TEXT DEFAULT '',
        match_score REAL DEFAULT 0,
        confirmed_by TEXT DEFAULT '',
        confirmed_at INTEGER,
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_run (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        added_count INTEGER DEFAULT 0,
        removed_count INTEGER DEFAULT 0,
        unmatched_count INTEGER DEFAULT 0,
        conflict_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        idempotency_key TEXT UNIQUE,
        details TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS sync_audit_log (
        id TEXT PRIMARY KEY,
        operator_id TEXT DEFAULT '',
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_org_id TEXT DEFAULT '',
        affected_user_ids TEXT DEFAULT '[]',
        result TEXT NOT NULL,
        error_code TEXT DEFAULT '',
        created_at INTEGER NOT NULL
    );
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_dingtalk_user ON external_user_identity(dingtalk_user_id) WHERE dingtalk_user_id <> ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_dingtalk_union ON external_user_identity(dingtalk_union_id) WHERE dingtalk_union_id <> ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_easyai_user ON external_user_identity(easyai_user_id) WHERE easyai_user_id <> ''")


def project_members(conn, project_id):
    today = time.strftime("%Y-%m-%d")
    rows = conn.execute("""
        SELECT DISTINCT p.id, p.name, p.ding_id, COALESCE(p.dingtalk_union_id, '') AS dingtalk_union_id
        FROM assignments a JOIN persons p ON p.id=a.person_id
        WHERE a.project_id=? AND a.start_date<=? AND a.end_date>=?
    """, (project_id, today, today)).fetchall()
    if rows:
        return rows
    return conn.execute("""
        SELECT DISTINCT p.id, p.name, p.ding_id, COALESCE(p.dingtalk_union_id, '') AS dingtalk_union_id
        FROM assignments a JOIN persons p ON p.id=a.person_id WHERE a.project_id=?
    """, (project_id,)).fetchall()


def _user_id(user):
    return str(user.get("id", user.get("user_id", user.get("_id", ""))))


def _external_ids(value):
    """Return normalized DingTalk IDs from a dashboard member or EasyAI user."""
    if hasattr(value, "keys"):
        user_id = value.get("ding_id", value.get("dingtalk_user_id", value.get("dingId", value.get("userid", value.get("userId", "")))))
        union_id = value.get("dingtalk_union_id", value.get("unionid", value.get("unionId", "")))
    else:
        user_id = union_id = ""
    return str(user_id or "").strip(), str(union_id or "").strip()


def match_identities(conn, members, easyai_users):
    by_dingtalk_id = defaultdict(list)
    by_union_id = defaultdict(list)
    for user in easyai_users:
        dingtalk_id, union_id = _external_ids(user)
        if dingtalk_id:
            by_dingtalk_id[dingtalk_id].append(user)
        if union_id:
            by_union_id[union_id].append(user)
    results = []
    for member in members:
        existing = conn.execute("SELECT * FROM external_user_identity WHERE dashboard_user_id=?", (member["id"],)).fetchone()
        if existing and existing["easyai_user_id"] and existing["match_status"] in {"confirmed", "auto_matched"}:
            results.append({"dashboard_user_id": member["id"], "name": member["name"], "dingtalk_user_id": existing["dingtalk_user_id"], "dingtalk_union_id": existing["dingtalk_union_id"], "easyai_user_id": existing["easyai_user_id"], "status": existing["match_status"], "match_source": existing["match_source"], "candidate": None})
            continue
        dingtalk_id, union_id = _external_ids(member)
        candidates = by_dingtalk_id.get(dingtalk_id, []) if dingtalk_id else []
        source = "userid" if len(candidates) == 1 else ""
        if not candidates and union_id:
            candidates = by_union_id.get(union_id, [])
            source = "unionid" if len(candidates) == 1 else ""
        status = "auto_matched" if len(candidates) == 1 else ("conflict" if len(candidates) > 1 else "unmatched")
        candidate = candidates[0] if len(candidates) == 1 else None
        easy_id = _user_id(candidate) if candidate else ""
        results.append({"dashboard_user_id": member["id"], "name": member["name"], "dingtalk_user_id": dingtalk_id, "dingtalk_union_id": union_id, "easyai_user_id": easy_id, "status": status, "match_source": source, "candidate": candidate, "reason": "missing_external_id" if not dingtalk_id and not union_id else ""})
    return results


def persist_identity_matches(conn, matches, operator_id=""):
    """Persist only uniquely matched identities; preview remains read-only."""
    persisted = []
    for item in matches:
        if item["status"] not in {"auto_matched", "confirmed"} or not item.get("easyai_user_id"):
            continue
        conn.execute("""
            INSERT INTO external_user_identity (dashboard_user_id, dingtalk_user_id, dingtalk_union_id, display_name, normalized_name, easyai_user_id, match_status, match_source, match_score, confirmed_by, confirmed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dashboard_user_id) DO UPDATE SET dingtalk_user_id=excluded.dingtalk_user_id, dingtalk_union_id=excluded.dingtalk_union_id, display_name=excluded.display_name, normalized_name=excluded.normalized_name, easyai_user_id=excluded.easyai_user_id, match_status=excluded.match_status, match_source=excluded.match_source, match_score=excluded.match_score, confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at, updated_at=datetime('now')
        """, (item["dashboard_user_id"], item.get("dingtalk_user_id", ""), item.get("dingtalk_union_id", ""), item["name"], normalize_name(item["name"]), item["easyai_user_id"], item["status"], item.get("match_source", ""), 1.0, operator_id, now_ms()))
        persisted.append(item)
    return persisted


def ensure_binding(conn, project_id, project_name):
    existing = conn.execute("SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)).fetchone()
    if existing and existing["easyai_org_id"]:
        return dict(existing)
    if not SYNC_ENABLED:
        return dict(existing) if existing else None
    client = EasyAIClient(load_easyai_runtime_config(conn))
    try:
        parent = client.find_parent_organization(PARENT_ORG_NAME)
        parent_id = parent.get("id", parent.get("org_id", ""))
        org = client.create_organization(test_org_name(project_name), parent_id, project_id)
        org_id = org.get("id", org.get("org_id", ""))
        if not org_id:
            raise RuntimeError("组织创建响应缺少组织 ID")
        conn.execute("""
            INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, is_test_org, status, updated_at)
            VALUES (?, ?, ?, ?, 1, 'active', datetime('now'))
            ON CONFLICT(project_id) DO UPDATE SET easyai_org_id=excluded.easyai_org_id, parent_org_id=excluded.parent_org_id, organization_name=excluded.organization_name, status='active', last_error='', updated_at=datetime('now')
        """, (project_id, str(org_id), str(parent_id), test_org_name(project_name)))
        return dict(conn.execute("SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)).fetchone())
    except Exception as exc:
        message = redact_error(exc)
        conn.execute("""
            INSERT INTO project_easyai_binding (project_id, organization_name, is_test_org, status, last_error, updated_at)
            VALUES (?, ?, 1, 'error', ?, datetime('now'))
            ON CONFLICT(project_id) DO UPDATE SET status='error', last_error=excluded.last_error, updated_at=datetime('now')
        """, (project_id, test_org_name(project_name), message))
        raise


def update_project_binding_name(conn, project_id, project_name):
    """Keep an existing project organization name aligned with the project."""
    binding = conn.execute(
        "SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)
    ).fetchone()
    if not binding or not binding["easyai_org_id"]:
        return None
    organization_name = test_org_name(project_name)
    if binding["organization_name"] == organization_name:
        return dict(binding)
    if not SYNC_ENABLED:
        conn.execute(
            "UPDATE project_easyai_binding SET organization_name=?, updated_at=datetime('now') WHERE project_id=?",
            (organization_name, project_id),
        )
        return dict(conn.execute("SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)).fetchone())
    client = EasyAIClient(load_easyai_runtime_config(conn))
    try:
        client.update_organization_name(binding["easyai_org_id"], organization_name)
        conn.execute(
            "UPDATE project_easyai_binding SET organization_name=?, last_error='', updated_at=datetime('now') WHERE project_id=?",
            (organization_name, project_id),
        )
        return dict(conn.execute("SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)).fetchone())
    except Exception as exc:
        message = redact_error(exc)
        conn.execute(
            "UPDATE project_easyai_binding SET status='error', last_error=?, updated_at=datetime('now') WHERE project_id=?",
            (message, project_id),
        )
        raise


def preview_project(conn, project_id):
    project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        raise ValueError("项目不存在")
    binding = conn.execute("SELECT * FROM project_easyai_binding WHERE project_id=?", (project_id,)).fetchone()
    members = project_members(conn, project_id)
    client = EasyAIClient(load_easyai_runtime_config(conn))
    users = client.list_users() if SYNC_ENABLED else []
    if client.mode == "mock" and not users:
        users = [{"id": f"mock-user-{member['id']}", "name": member["name"], "dingtalk_user_id": member["ding_id"], "dingtalk_union_id": member["dingtalk_union_id"]} for member in members if member["ding_id"] or member["dingtalk_union_id"]]
    matches = match_identities(conn, members, users)
    counts = Counter(item["status"] for item in matches)
    return {"project": dict(project), "binding": dict(binding) if binding else None, "members": matches, "added": counts["auto_matched"], "unmatched": counts["unmatched"], "conflict": counts["conflict"], "removed": 0, "read_only": True, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "preserved_fields": ["username", "password", "email", "phone", "history", "balance", "existing_organizations"]}


def sync_project(conn, project_id, trigger="manual", operator_id=""):
    project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        raise ValueError("项目不存在")
    run_id = str(uuid.uuid4())
    idem = f"project-sync:{project_id}:{time.strftime('%Y%m%d%H%M')}"
    started = now_ms()
    conn.execute("INSERT OR IGNORE INTO sync_run (id, project_id, trigger, status, started_at, idempotency_key) VALUES (?, ?, ?, 'running', ?, ?)", (run_id, project_id, trigger, started, idem))
    try:
        binding = ensure_binding(conn, project_id, project["name"])
        if not binding or not binding.get("easyai_org_id"):
            raise RuntimeError("项目尚未绑定 EasyAI 组织")
        members = project_members(conn, project_id)
        client = EasyAIClient(load_easyai_runtime_config(conn))
        users = client.list_users() if SYNC_ENABLED else []
        if client.mode == "mock" and not users:
            users = [{"id": f"mock-user-{member['id']}", "name": member["name"], "dingtalk_user_id": member["ding_id"], "dingtalk_union_id": member["dingtalk_union_id"]} for member in members if member["ding_id"] or member["dingtalk_union_id"]]
        matches = match_identities(conn, members, users)
        persisted = persist_identity_matches(conn, matches, operator_id)
        matched_ids = [item["easyai_user_id"] for item in persisted if item["easyai_user_id"]]
        identity_results = []
        for item in persisted:
            identity_results.append(client.bind_dingtalk_identity(item["easyai_user_id"], item.get("dingtalk_user_id", ""), item.get("dingtalk_union_id", "")) if SYNC_ENABLED else {"user_id": item["easyai_user_id"]})
        added = client.add_users_to_organization(matched_ids, binding["easyai_org_id"]) if SYNC_ENABLED else {"added": 0}
        unmatched = sum(item["status"] == "unmatched" for item in matches)
        conflicts = sum(item["status"] == "conflict" for item in matches)
        details = {"members": matches, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "identity_bindings": identity_results, "provider_result": added, "preserved_fields": ["username", "password", "email", "phone", "history", "balance", "existing_organizations"]}
        conn.execute("UPDATE sync_run SET status='succeeded', finished_at=?, added_count=?, unmatched_count=?, conflict_count=?, details=? WHERE id=?", (now_ms(), len(matched_ids), unmatched, conflicts, json.dumps(details, ensure_ascii=False), run_id))
        conn.execute("UPDATE project_easyai_binding SET last_sync_at=?, last_error='', updated_at=datetime('now') WHERE project_id=?", (now_ms(), project_id))
        conn.execute("INSERT INTO sync_audit_log (id, operator_id, project_id, operation, target_org_id, affected_user_ids, result, created_at) VALUES (?, ?, ?, 'project_sync', ?, ?, 'succeeded', ?)", (str(uuid.uuid4()), operator_id, project_id, binding["easyai_org_id"], json.dumps(matched_ids), now_ms()))
        return {"success": True, "run_id": run_id, "added": len(matched_ids), "unmatched": unmatched, "conflict": conflicts, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "details": details}
    except Exception as exc:
        message = redact_error(exc)
        conn.execute("UPDATE sync_run SET status='failed', finished_at=?, error_count=1, details=? WHERE id=?", (now_ms(), json.dumps({"error": message}, ensure_ascii=False), run_id))
        conn.execute("UPDATE project_easyai_binding SET status='error', last_error=?, updated_at=datetime('now') WHERE project_id=?", (message, project_id))
        conn.execute("INSERT INTO sync_audit_log (id, operator_id, project_id, operation, result, error_code, created_at) VALUES (?, ?, ?, 'project_sync', 'failed', ?, ?)", (str(uuid.uuid4()), operator_id, project_id, message[:120], now_ms()))
        raise
