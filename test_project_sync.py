import os
import sqlite3
import unittest

os.environ.setdefault("EASYAI_SYNC_MODE", "mock")
os.environ.setdefault("EASYAI_SYNC_ENABLED", "true")

from project_sync import ensure_tables, match_identities, persist_identity_matches, normalize_name, redact_error, test_org_name


class ProjectSyncUnitTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        ensure_tables(self.conn)

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


if __name__ == "__main__":
    unittest.main()
