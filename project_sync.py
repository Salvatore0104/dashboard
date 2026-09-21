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
from collections import Counter, defaultdict

import requests
from cryptography.fernet import Fernet, InvalidToken


TEST_PREFIX = os.getenv("EASYAI_TEST_ORG_PREFIX", "[TEST][dashboard-local]").strip()
SYNC_MODE = os.getenv("EASYAI_SYNC_MODE", "mock").strip().lower()
SYNC_ENABLED = os.getenv("EASYAI_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
PARENT_ORG_NAME = os.getenv("EASYAI_PARENT_ORG_NAME", "执行项目组").strip()
EASYAI_BASE_URL = "https://wowidea.top/api"


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
        rows = conn.execute("SELECT key, value FROM config WHERE key IN ('easyai_admin_bearer_token_encrypted', 'easyai_admin_username_encrypted', 'easyai_admin_password_encrypted')").fetchall()
        config.update({row["key"]: row["value"] for row in rows})
    encrypted = config.get("easyai_admin_bearer_token_encrypted", "")
    encrypted_username = config.get("easyai_admin_username_encrypted", "")
    encrypted_password = config.get("easyai_admin_password_encrypted", "")
    try:
        token = decrypt_secret(encrypted) if encrypted else os.getenv("EASYAI_ADMIN_BEARER_TOKEN", "")
        username = decrypt_secret(encrypted_username) if encrypted_username else os.getenv("EASYAI_ADMIN_USERNAME", "")
        password = decrypt_secret(encrypted_password) if encrypted_password else os.getenv("EASYAI_ADMIN_PASSWORD", "")
    except RuntimeError:
        token = ""
        username = ""
        password = ""
    if username and password:
        token = ""
    return {
        "base_url": EASYAI_BASE_URL,
        "bearer_token": normalize_bearer_token(token),
        "username": username.strip(),
        "password": password,
    }


def normalize_bearer_token(value):
    token = str(value or "").strip()
    if not token:
        return ""
    return token if token.lower().startswith("bearer ") else f"Bearer {token}"


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


def organization_id(org):
    """Read organization IDs from both Mongo-style and legacy responses."""
    if not isinstance(org, dict):
        return ""
    return str(org.get("_id") or org.get("id") or org.get("org_id") or "").strip()


def iter_organizations(value):
    """Flatten the nested organization tree without losing child nodes."""
    if isinstance(value, dict):
        children = value.get("children") or []
        yield value
        for child in children:
            yield from iter_organizations(child)
    elif isinstance(value, list):
        for item in value:
            yield from iter_organizations(item)


class EasyAIClient:
    def __init__(self, runtime_config=None):
        self.mode = SYNC_MODE
        runtime_config = runtime_config or {}
        self.base_url = normalize_base_url(runtime_config.get("base_url") or EASYAI_BASE_URL)
        self.bearer_token = normalize_bearer_token(runtime_config.get("bearer_token"))
        self.username = str(runtime_config.get("username") or "").strip()
        self.password = str(runtime_config.get("password") or "")
        self.refresh_token = str(runtime_config.get("refresh_token") or "")
        self._mock_users = {}
        self._mock_orgs = {}

    def _headers(self):
        self._ensure_authenticated()
        return {"Authorization": self.bearer_token, "Content-Type": "application/json"}

    def _ensure_authenticated(self):
        if self.bearer_token:
            return
        if not self.username or not self.password:
            raise RuntimeError("尚未配置 wowidea 管理员账号和密码")
        payloads = ({"username": self.username, "password": self.password}, {"account": self.username, "password": self.password})
        last_error = None
        for payload in payloads:
            response = requests.post(f"{self.base_url}/users/loginByUsername", json=payload, timeout=15)
            if response.ok:
                data = response.json() if response.content else {}
                body = data.get("data", data) if isinstance(data, dict) else {}
                token = body.get("accessToken") or body.get("access_token") or body.get("token")
                if token:
                    self.bearer_token = normalize_bearer_token(token)
                    self.refresh_token = body.get("refreshToken") or body.get("refresh_token") or ""
                    return
                last_error = "登录响应缺少 access token"
            else:
                last_error = f"EasyAI 登录 API {response.status_code}"
        raise RuntimeError(last_error or "wowidea 管理员登录失败")

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
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", data.get("organizations", []))
        return []

    def find_parent_organization(self, name):
        orgs = list(iter_organizations(self.list_organizations()))
        matches = [
            org for org in orgs
            if str(org.get("name", org.get("org_name", ""))).strip() == name
        ]
        if not matches:
            raise RuntimeError(f"未找到父组织：{name}")
        if len(matches) > 1:
            raise RuntimeError(f"父组织名称冲突：{name}（找到 {len(matches)} 个）")
        parent = matches[0]
        parent_id = organization_id(parent)
        if not parent_id:
            raise RuntimeError(f"父组织缺少 ID：{name}")
        return parent

    def find_organizations_by_name(self, name):
        return [org for org in iter_organizations(self.list_organizations()) if str(org.get("name", "")).strip() == str(name).strip()]

    def create_organization(self, name, parent_id, external_id):
        if self.mode == "mock":
            key = str(external_id)
            if key in self._mock_orgs:
                return self._mock_orgs[key]
            org = {"_id": f"mock-org-{hashlib.sha1(key.encode()).hexdigest()[:12]}", "name": name, "parent": parent_id, "external_id": key}
            self._mock_orgs[key] = org
            return org
        # The deployed OpenAPI DTO uses `parent` and returns Mongo-style `_id`.
        # Keep the request limited to documented fields; external_id is local.
        payload = {"name": name, "parent": str(parent_id), "description": f"dashboard project {external_id}"}
        data = self._request("POST", "/v1/openapi/organization", json=payload)
        if isinstance(data, dict):
            body = data.get("data", data)
            if isinstance(body, dict):
                return body
        raise RuntimeError("组织创建响应格式无效")

    def move_organization(self, org_id, parent_id):
        if not org_id or not parent_id:
            raise RuntimeError("组织移动缺少组织 ID 或父组织 ID")
        if self.mode == "mock":
            for org in self._mock_orgs.values():
                if organization_id(org) == str(org_id):
                    org["parent"] = str(parent_id)
                    return org
            raise RuntimeError(f"未找到组织：{org_id}")
        data = self._request("PATCH", f"/v1/openapi/organization/{org_id}", json={"parent": str(parent_id)})
        body = data.get("data", data) if isinstance(data, dict) else data
        return body if isinstance(body, dict) else {}

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
        dingtalk_open_id TEXT DEFAULT '',
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
        existing_count INTEGER DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS project_easyai_member (
        project_id TEXT NOT NULL,
        easyai_org_id TEXT NOT NULL,
        easyai_user_id TEXT NOT NULL,
        dashboard_user_id TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        first_synced_at INTEGER NOT NULL,
        last_synced_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, easyai_user_id)
    );
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_dingtalk_user ON external_user_identity(dingtalk_user_id) WHERE dingtalk_user_id <> ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_dingtalk_union ON external_user_identity(dingtalk_union_id) WHERE dingtalk_union_id <> ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_external_easyai_user ON external_user_identity(easyai_user_id) WHERE easyai_user_id <> ''")
    identity_columns = {row[1] for row in conn.execute("PRAGMA table_info(external_user_identity)").fetchall()}
    if "dingtalk_open_id" not in identity_columns:
        conn.execute("ALTER TABLE external_user_identity ADD COLUMN dingtalk_open_id TEXT DEFAULT ''")
    # Keep migrations compatible with databases created before this stage.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sync_run)").fetchall()}
    if "existing_count" not in columns:
        conn.execute("ALTER TABLE sync_run ADD COLUMN existing_count INTEGER DEFAULT 0")


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
        def field(*names):
            for name in names:
                try:
                    result = value[name]
                except (KeyError, IndexError):
                    continue
                if result:
                    return result
            return ""
        user_id = field("ding_id", "dingtalk_user_id", "dingId", "userid", "userId", "open_id", "openId")
        if not user_id:
            username = str(field("username") or "")
            if username.startswith("dingtalk_"):
                user_id = username[len("dingtalk_"):]
        union_id = field("dingtalk_union_id", "unionid", "unionId", "dt_unionid")
    else:
        user_id = union_id = ""
    return str(user_id or "").strip(), str(union_id or "").strip()


def _typed_external_ids(value):
    """Normalize DingTalk IDs while preserving their provider type."""
    if not hasattr(value, "keys"):
        return {}
    aliases = {
        "userid": ("ding_id", "dingtalk_user_id", "dingId", "userid", "userId"),
        "union_id": ("dingtalk_union_id", "unionid", "unionId", "dt_unionid"),
        "open_id": ("open_id", "openId", "dingtalk_open_id", "openid"),
    }
    result = {}
    for kind, names in aliases.items():
        for name in names:
            try:
                raw = value[name]
            except (KeyError, IndexError):
                continue
            if raw:
                result[kind] = str(raw).strip()
                break
    if "userid" not in result:
        username = ""
        try:
            username = str(value["username"] or "")
        except (KeyError, IndexError):
            pass
        if username.startswith("dingtalk_"):
            result["userid"] = username[len("dingtalk_"):]
    return result


def match_identities(conn, members, easyai_users):
    by_typed_id = defaultdict(list)
    by_name = defaultdict(list)
    for user in easyai_users:
        for kind, value in _typed_external_ids(user).items():
            by_typed_id[(kind, value)].append(user)
        name = normalize_name(user.get("name", user.get("display_name", user.get("nickname", ""))))
        if name:
            by_name[name].append(user)
    results = []
    for member in members:
        existing = conn.execute("SELECT * FROM external_user_identity WHERE dashboard_user_id=?", (member["id"],)).fetchone()
        if existing and existing["easyai_user_id"] and existing["match_status"] in {"confirmed", "auto_matched"}:
            results.append({"dashboard_user_id": member["id"], "name": member["name"], "dingtalk_user_id": existing["dingtalk_user_id"], "dingtalk_union_id": existing["dingtalk_union_id"], "dingtalk_open_id": existing["dingtalk_open_id"] if "dingtalk_open_id" in existing.keys() else "", "easyai_user_id": existing["easyai_user_id"], "status": existing["match_status"], "match_source": existing["match_source"], "candidate": None, "name_changed": normalize_name(member["name"]) != existing["normalized_name"]})
            continue
        typed_ids = _typed_external_ids(member)
        dingtalk_id, union_id = _external_ids(member)
        candidates = []
        source = ""
        for kind, value in typed_ids.items():
            matches = by_typed_id.get((kind, value), [])
            candidates.extend(matches)
            if len(matches) > 1:
                source = f"{kind}_duplicate"
            elif len(matches) == 1 and not source:
                source = kind
        candidates = list({_user_id(item): item for item in candidates if _user_id(item)}.values())
        same_raw_different_type = any(
            value in typed_ids.values() and sum(1 for (kind, raw) in by_typed_id if raw == value) > 1
            for value in typed_ids.values()
        )
        if not typed_ids:
            candidates = by_name.get(normalize_name(member["name"]), [])
            source = "name_unique" if len(candidates) == 1 else ("name_conflict" if len(candidates) > 1 else "")
            status = "candidate" if len(candidates) == 1 else ("conflict" if len(candidates) > 1 else "unmatched")
        else:
            status = "conflict" if same_raw_different_type or len(candidates) > 1 else ("auto_matched" if len(candidates) == 1 else "unmatched")
        candidate = candidates[0] if len(candidates) == 1 else None
        easy_id = _user_id(candidate) if candidate and status == "auto_matched" else ""
        results.append({"dashboard_user_id": member["id"], "name": member["name"], "dingtalk_user_id": dingtalk_id, "dingtalk_union_id": union_id, "dingtalk_open_id": typed_ids.get("open_id", ""), "easyai_user_id": easy_id, "status": status, "match_source": source, "candidate": candidate, "reason": "missing_external_id" if not typed_ids else ("id_type_conflict" if same_raw_different_type else "")})
    return results


def persist_identity_matches(conn, matches, operator_id=""):
    """Persist only uniquely matched identities; preview remains read-only."""
    persisted = []
    for item in matches:
        if item["status"] not in {"auto_matched", "confirmed"} or not item.get("easyai_user_id"):
            continue
        conn.execute("""
            INSERT INTO external_user_identity (dashboard_user_id, dingtalk_user_id, dingtalk_union_id, dingtalk_open_id, display_name, normalized_name, easyai_user_id, match_status, match_source, match_score, confirmed_by, confirmed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dashboard_user_id) DO UPDATE SET dingtalk_user_id=excluded.dingtalk_user_id, dingtalk_union_id=excluded.dingtalk_union_id, dingtalk_open_id=excluded.dingtalk_open_id, display_name=excluded.display_name, normalized_name=excluded.normalized_name, easyai_user_id=excluded.easyai_user_id, match_status=excluded.match_status, match_source=excluded.match_source, match_score=excluded.match_score, confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at, updated_at=datetime('now')
        """, (item["dashboard_user_id"], item.get("dingtalk_user_id", ""), item.get("dingtalk_union_id", ""), item.get("dingtalk_open_id", ""), item["name"], normalize_name(item["name"]), item["easyai_user_id"], item["status"], item.get("match_source", ""), 1.0, operator_id, now_ms()))
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
        organization_name = test_org_name(project_name)
        # A failed local binding must never claim an online organization by name.
        # If a same-named test org already exists, require manual inspection.
        same_name = client.find_organizations_by_name(organization_name)
        if same_name:
            raise RuntimeError(f"发现同名测试组织，拒绝自动认领：{organization_name}")
        parent = client.find_parent_organization(PARENT_ORG_NAME)
        parent_id = organization_id(parent)
        org = client.create_organization(test_org_name(project_name), parent_id, project_id)
        org_id = organization_id(org)
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
    known = {
        str(row["easyai_user_id"])
        for row in conn.execute("SELECT easyai_user_id FROM project_easyai_member WHERE project_id=? AND status='active'", (project_id,)).fetchall()
    }
    for item in matches:
        item["membership"] = "existing" if item.get("easyai_user_id") in known else "new"
    existing = sum(item["status"] in {"auto_matched", "confirmed"} and item["membership"] == "existing" for item in matches)
    added = sum(item["status"] in {"auto_matched", "confirmed"} and item["membership"] == "new" for item in matches)
    return {"project": dict(project), "binding": dict(binding) if binding else None, "members": matches, "added": added, "existing": existing, "unmatched": counts["unmatched"], "conflict": counts["conflict"], "removed": 0, "read_only": True, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "preserved_fields": ["username", "password", "email", "phone", "history", "balance", "existing_organizations"]}


def sync_project(conn, project_id, trigger="manual", operator_id=""):
    project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        raise ValueError("项目不存在")
    run_id = str(uuid.uuid4())
    idem = f"project-sync:{project_id}:{time.strftime('%Y%m%d%H%M')}"
    started = now_ms()
    prior = conn.execute("SELECT * FROM sync_run WHERE idempotency_key=?", (idem,)).fetchone()
    if prior:
        if prior["status"] == "running":
            raise RuntimeError("该项目已有同步任务正在运行")
        details = json.loads(prior["details"] or "{}")
        return {"success": prior["status"] == "succeeded", "run_id": prior["id"], "idempotent": True, "added": prior["added_count"], "existing": prior["existing_count"], "unmatched": prior["unmatched_count"], "conflict": prior["conflict_count"], "provider": details.get("provider", SYNC_MODE), "simulated": details.get("simulated", SYNC_MODE != "real"), "write_enabled": details.get("write_enabled", SYNC_ENABLED and SYNC_MODE == "real"), "details": details}
    conn.execute("INSERT INTO sync_run (id, project_id, trigger, status, started_at, idempotency_key) VALUES (?, ?, ?, 'running', ?, ?)", (run_id, project_id, trigger, started, idem))
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
        tracked = {str(row["easyai_user_id"]) for row in conn.execute("SELECT easyai_user_id FROM project_easyai_member WHERE project_id=? AND status='active'", (project_id,)).fetchall()}
        matched_ids = [item["easyai_user_id"] for item in persisted if item["easyai_user_id"]]
        new_ids = [user_id for user_id in matched_ids if str(user_id) not in tracked]
        existing_count = len(matched_ids) - len(new_ids)
        identity_results = []
        for item in persisted:
            if SYNC_ENABLED and os.getenv("EASYAI_DINGTALK_BIND_PATH", "").strip():
                identity_results.append(client.bind_dingtalk_identity(item["easyai_user_id"], item.get("dingtalk_user_id", ""), item.get("dingtalk_union_id", "")))
            else:
                identity_results.append({"user_id": item["easyai_user_id"], "status": "local_identity_only"})
        added = client.add_users_to_organization(new_ids, binding["easyai_org_id"]) if SYNC_ENABLED else {"added": len(new_ids)}
        synced_at = now_ms()
        for item in persisted:
            if item["easyai_user_id"]:
                conn.execute("""INSERT INTO project_easyai_member (project_id, easyai_org_id, easyai_user_id, dashboard_user_id, status, first_synced_at, last_synced_at) VALUES (?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(project_id, easyai_user_id) DO UPDATE SET dashboard_user_id=excluded.dashboard_user_id, status='active', last_synced_at=excluded.last_synced_at""", (project_id, binding["easyai_org_id"], item["easyai_user_id"], item["dashboard_user_id"], synced_at, synced_at))
        unmatched = sum(item["status"] == "unmatched" for item in matches)
        conflicts = sum(item["status"] == "conflict" for item in matches)
        details = {"members": matches, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "identity_bindings": identity_results, "provider_result": added, "preserved_fields": ["username", "password", "email", "phone", "history", "balance", "existing_organizations"]}
        details["existing"] = existing_count
        details["new_ids"] = new_ids
        conn.execute("UPDATE sync_run SET status='succeeded', finished_at=?, added_count=?, existing_count=?, unmatched_count=?, conflict_count=?, details=? WHERE id=?", (now_ms(), len(new_ids), existing_count, unmatched, conflicts, json.dumps(details, ensure_ascii=False), run_id))
        conn.execute("UPDATE project_easyai_binding SET last_sync_at=?, last_error='', updated_at=datetime('now') WHERE project_id=?", (now_ms(), project_id))
        conn.execute("INSERT INTO sync_audit_log (id, operator_id, project_id, operation, target_org_id, affected_user_ids, result, created_at) VALUES (?, ?, ?, 'project_sync', ?, ?, 'succeeded', ?)", (str(uuid.uuid4()), operator_id, project_id, binding["easyai_org_id"], json.dumps(matched_ids), now_ms()))
        return {"success": True, "run_id": run_id, "added": len(new_ids), "existing": existing_count, "unmatched": unmatched, "conflict": conflicts, "provider": SYNC_MODE, "simulated": SYNC_MODE != "real", "write_enabled": SYNC_ENABLED and SYNC_MODE == "real", "details": details}
    except Exception as exc:
        message = redact_error(exc)
        conn.execute("UPDATE sync_run SET status='failed', finished_at=?, error_count=1, details=? WHERE id=?", (now_ms(), json.dumps({"error": message}, ensure_ascii=False), run_id))
        conn.execute("UPDATE project_easyai_binding SET status='error', last_error=?, updated_at=datetime('now') WHERE project_id=?", (message, project_id))
        conn.execute("INSERT INTO sync_audit_log (id, operator_id, project_id, operation, result, error_code, created_at) VALUES (?, ?, ?, 'project_sync', 'failed', ?, ?)", (str(uuid.uuid4()), operator_id, project_id, message[:120], now_ms()))
        raise
