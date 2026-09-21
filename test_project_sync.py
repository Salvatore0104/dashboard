import os
import sqlite3
import unittest
from unittest.mock import patch
from pathlib import Path


os.environ.setdefault("EASYAI_SYNC_MODE", "mock")
os.environ.setdefault("EASYAI_SYNC_ENABLED", "true")

from project_sync import EasyAIClient, encrypt_secret, ensure_tables, load_easyai_runtime_config, match_identities, migrate_legacy_easyai_password, persist_identity_matches, normalize_name, preview_project, redact_error, test_org_name


class ProjectSyncUnitTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        ensure_tables(self.conn)
        self.conn.executescript("""
            CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL);
            CREATE TABLE persons (id TEXT PRIMARY KEY, name TEXT NOT NULL, ding_id TEXT DEFAULT '', dingtalk_union_id TEXT DEFAULT '');
            CREATE TABLE assignments (id TEXT PRIMARY KEY, person_id TEXT, project_id TEXT, start_date TEXT, end_date TEXT);
            CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)

    def tearDown(self):
        self.conn.close()

    def test_normalize_name_removes_whitespace(self):
        self.assertEqual(normalize_name(" 张  三 "), "张三")

    def test_test_org_name_is_idempotent(self):
        first = test_org_name("演示项目")
        self.assertTrue(first.startswith("[TEST][dashboard-local]"))
        self.assertEqual(test_org_name(first), first)

    def test_redact_error_removes_secret_values(self):
        message = redact_error("api_key=sk-1234567890abcdef token=abc")
        self.assertNotIn("1234567890abcdef", message)
        self.assertIn("[REDACTED]", message)

    def test_matching_uses_dingtalk_ids_and_does_not_fallback_to_name(self):
        members = [
            {'id': 'dashboard-1', 'name': '张三', 'ding_id': 'ding-1', 'dingtalk_union_id': 'union-1'},
            {'id': 'dashboard-2', 'name': '李四', 'ding_id': '', 'dingtalk_union_id': ''},
        ]
        users = [
            {'id': 'easy-1', 'name': '张三', 'dingtalk_user_id': 'ding-1', 'dingtalk_union_id': 'union-1'},
            {'id': 'easy-2', 'name': '李四'},
        ]
        result = match_identities(self.conn, members, users)
        self.assertEqual(result[0]['status'], 'auto_matched')
        self.assertEqual(result[0]['match_source'], 'userid')
        self.assertEqual(result[1]['status'], 'unmatched')
        self.assertEqual(result[1]['reason'], 'missing_external_id')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM external_user_identity').fetchone()[0], 0)

    def test_persist_rejects_duplicate_easyai_identity(self):
        matches = [
            {'dashboard_user_id': 'dashboard-1', 'name': '张三', 'dingtalk_user_id': 'ding-1', 'dingtalk_union_id': 'union-1', 'easyai_user_id': 'easy-1', 'status': 'auto_matched', 'match_source': 'userid'},
            {'dashboard_user_id': 'dashboard-2', 'name': '王五', 'dingtalk_user_id': 'ding-2', 'dingtalk_union_id': 'union-2', 'easyai_user_id': 'easy-1', 'status': 'auto_matched', 'match_source': 'userid'},
        ]
        persist_identity_matches(self.conn, matches[:1])
        with self.assertRaises(sqlite3.IntegrityError):
            persist_identity_matches(self.conn, matches[1:])

    def test_parent_lookup_requires_exactly_one_existing_parent(self):
        client = EasyAIClient()
        with self.assertRaisesRegex(RuntimeError, "未找到父组织"):
            client.find_parent_organization("执行项目组")
        client._mock_orgs["parent-1"] = {"id": "parent-1", "name": "执行项目组"}
        self.assertEqual(client.find_parent_organization("执行项目组")["id"], "parent-1")
        client._mock_orgs["parent-2"] = {"id": "parent-2", "name": "执行项目组"}
        with self.assertRaisesRegex(RuntimeError, "名称冲突"):
            client.find_parent_organization("执行项目组")

    def test_preview_marks_mock_provider_as_simulated(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p1', '演示', '', '')")
        result = preview_project(self.conn, "p1")
        self.assertEqual(result["provider"], "mock")
        self.assertTrue(result["simulated"])
        self.assertFalse(result["write_enabled"])

    def test_admin_password_is_loaded_from_encrypted_config(self):
        self.conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", ("easyai_admin_username", "admin"))
        self.conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", ("easyai_admin_password_encrypted", encrypt_secret("secret-value")))
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["username"], "admin")
        self.assertEqual(runtime["password"], "secret-value")
        stored = self.conn.execute("SELECT value FROM config WHERE key='easyai_admin_password_encrypted'").fetchone()[0]
        self.assertNotIn("secret-value", stored)

    def test_invalid_legacy_key_ciphertext_is_ignored_without_affecting_password(self):
        self.conn.executemany(
            "INSERT INTO config (key, value) VALUES (?, ?)",
            [("easyai_admin_api_key_encrypted", "invalid-old-ciphertext"), ("easyai_admin_password_encrypted", encrypt_secret("valid-password"))],
        )
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["api_key"], "")
        self.assertEqual(runtime["password"], "valid-password")

    def test_legacy_plain_password_is_migrated_and_removed(self):
        self.conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", ("easyai_admin_password", "legacy-pass"))
        self.assertTrue(migrate_legacy_easyai_password(self.conn))
        encrypted = self.conn.execute("SELECT value FROM config WHERE key='easyai_admin_password_encrypted'").fetchone()[0]
        self.assertNotIn("legacy-pass", encrypted)
        self.assertIsNone(self.conn.execute("SELECT value FROM config WHERE key='easyai_admin_password'").fetchone())
        self.assertEqual(load_easyai_runtime_config(self.conn)["password"], "legacy-pass")

    def test_admin_login_endpoint_settings_are_fixed(self):
        self.conn.executemany(
            "INSERT INTO config (key, value) VALUES (?, ?)",
            [("easyai_admin_base_url", "https://example.invalid/api"), ("easyai_auth_path", "/wrong")],
        )
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["base_url"], "https://wowidea.top/api")
        self.assertEqual(runtime["auth_path"], "/auth/login")
        self.assertEqual(runtime["username_field"], "username")
        self.assertEqual(runtime["password_field"], "password")

    def test_auth_token_extraction_supports_nested_response(self):
        client = EasyAIClient()
        self.assertEqual(client._extract_token({"data": {"access_token": "jwt-value"}}), "jwt-value")

    def test_bearer_login_is_cached(self):
        class Response:
            ok = True
            content = b'{"data":{"access_token":"jwt-value"},"expires_in":300}'
            status_code = 200

            def json(self):
                return {"data": {"access_token": "jwt-value"}, "expires_in": 300}

        client = EasyAIClient({"base_url": "https://wowidea.top/api", "username": "admin-fallback-2", "password": "secret"})
        with patch("project_sync.requests.post", return_value=Response()) as login:
            self.assertEqual(client._headers()["Authorization"], "Bearer jwt-value")
            self.assertEqual(client._headers()["Authorization"], "Bearer jwt-value")
            self.assertEqual(login.call_count, 1)

    def test_login_404_falls_back_without_exposing_path(self):
        class Response:
            def __init__(self, status_code):
                self.status_code = status_code
                self.ok = status_code == 200
                self.content = b'{"access_token":"jwt-value"}' if self.ok else b''

            def json(self):
                return {"access_token": "jwt-value"}

        client = EasyAIClient({"base_url": "https://wowidea.top/api", "username": "admin-fallback-3", "password": "secret"})
        with patch("project_sync.requests.post", side_effect=[Response(404), Response(200)]) as login:
            self.assertEqual(client._headers()["Authorization"], "Bearer jwt-value")
            self.assertEqual(login.call_count, 2)

    def test_admin_page_has_independent_login_save_control(self):
        html = Path(__file__).with_name("static").joinpath("admin.html").read_text(encoding="utf-8")
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn('id="saveEasyAIAuthBtn"', html)
        self.assertIn("保存 wowidea 登录配置", html)
        self.assertIn("async function saveEasyAIAuthConfig", js)
        self.assertIn('body = { easyai_admin_username: username }', js)
        self.assertIn('state.config.easyai_admin_password_configured ? "已配置"', js)

    def test_password_mask_is_not_exposed_by_config_response_code(self):
        app_source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
        self.assertNotIn("result['easyai_admin_password_masked']", app_source)


if __name__ == "__main__":
    unittest.main()
