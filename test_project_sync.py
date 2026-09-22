import os
import sqlite3
import unittest
from unittest.mock import patch
from pathlib import Path


os.environ.setdefault("EASYAI_SYNC_MODE", "mock")
os.environ.setdefault("EASYAI_SYNC_ENABLED", "true")

from project_sync import EasyAIClient, ProjectSyncCoordinator, _batch_result, encrypt_secret, ensure_tables, ensure_binding, identity_inventory_preview, iter_organizations, load_easyai_runtime_config, match_identities, normalize_name, organization_id, persist_identity_matches, preview_all_projects, preview_project, project_members, refresh_identity_inventory, redact_error, sync_all_projects, sync_project, test_org_name


class ProjectSyncUnitTests(unittest.TestCase):
    def setUp(self):
        sync_mode = patch('project_sync.SYNC_MODE', 'mock')
        sync_mode.start()
        self.addCleanup(sync_mode.stop)
        network = patch('requests.sessions.Session.request', side_effect=AssertionError('Unit tests must not use live services'))
        network.start()
        self.addCleanup(network.stop)
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

    def test_new_organization_initializes_once_and_preserves_spent_balance(self):
        client = EasyAIClient()
        client.mode = 'mock'
        client._mock_orgs['test-parent'] = {'_id':'test-parent', 'name':'执行项目组'}
        with patch('project_sync.EasyAIClient', return_value=client), patch('project_sync.SYNC_ENABLED', True):
            first = ensure_binding(self.conn, 'new-project', 'New project')
            org = next(o for o in client._mock_orgs.values() if organization_id(o) == first['easyai_org_id'])
            self.assertEqual(org['balance'], 5000)
            self.assertEqual(org['balance_deduction_strategy'], 'organization_first')
            org['balance'] = 4200
            again = ensure_binding(self.conn, 'new-project', 'New project')
            self.assertEqual(again['easyai_org_id'], first['easyai_org_id'])
            self.assertEqual(org['balance'], 4200)

    def test_real_create_sends_initial_balance_and_strategy_in_one_request(self):
        client = EasyAIClient()
        client.mode = 'real'
        with patch.object(client, '_request', return_value={'data': {'_id': 'org-new'}}) as request:
            client.create_organization('New', 'parent', 'project', description='20260922-20260929')
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args, ('POST', '/organization'))
        self.assertEqual(request.call_args.kwargs['json']['balance'], 5000)
        self.assertEqual(request.call_args.kwargs['json']['balance_deduction_strategy'], 'organization_first')
        self.assertEqual(request.call_args.kwargs['json']['description'], '20260922-20260929')

    def test_reuse_preserves_finances_and_updates_project_dates(self):
        client = EasyAIClient(); client.mode = 'mock'
        client._mock_orgs = {'parent': {'_id':'parent','name':'执行项目组'},
                            'old': {'_id':'old','parent':'parent','name':'Existing','balance':123,'balance_deduction_strategy':'user_only'}}
        self.conn.execute("INSERT INTO projects VALUES ('reuse','Existing','2026-09-22','2026-09-29')")
        with patch('project_sync.EasyAIClient', return_value=client), patch('project_sync.SYNC_ENABLED', True), patch.object(client,'create_organization',side_effect=AssertionError('must reuse')):
            binding = ensure_binding(self.conn,'reuse','Existing')
            self.assertEqual(binding['easyai_org_id'],'old')
            self.assertEqual(client._mock_orgs['old']['description'],'20260922-20260929')
            self.assertEqual(client._mock_orgs['old']['balance'],123)
            self.assertEqual(client._mock_orgs['old']['balance_deduction_strategy'],'user_only')
            self.conn.execute("UPDATE projects SET end_date='2026-10-01' WHERE id='reuse'")
            ensure_binding(self.conn,'reuse','Existing')
            self.assertEqual(client._mock_orgs['old']['description'],'20260922-20261001')
            self.assertEqual(client._mock_orgs['old']['balance'],123)
            self.conn.execute("DELETE FROM projects WHERE id='reuse'")
            self.conn.execute("UPDATE project_easyai_binding SET status='retained' WHERE project_id='reuse'")
            self.conn.execute("INSERT INTO projects VALUES ('reuse-new','Existing','2026-10-01','2026-10-09')")
            rebound = ensure_binding(self.conn,'reuse-new','Existing')
            self.assertEqual(rebound['easyai_org_id'],'old')
            self.assertEqual(client._mock_orgs['old']['balance'],123)
            self.assertEqual(client._mock_orgs['old']['balance_deduction_strategy'],'user_only')

    def test_duplicate_name_is_not_automatically_bound(self):
        client = EasyAIClient(); client.mode = 'mock'
        client._mock_orgs = {'parent':{'_id':'parent','name':'执行项目组'},
                            'a':{'_id':'a','name':'Duplicate','parent':'parent'},
                            'b':{'_id':'b','name':'Duplicate','parent':'parent'}}
        with patch('project_sync.EasyAIClient',return_value=client), patch('project_sync.SYNC_ENABLED',True):
            with self.assertRaisesRegex(RuntimeError,'多个同名'):
                ensure_binding(self.conn,'dup','Duplicate')

    def test_member_cleanup_allows_retained_balance(self):
        client = EasyAIClient()
        with patch.object(client, 'list_organizations', return_value=[{'_id':'org', 'parent':'parent', 'description':'dashboard project p', 'balance':5000, 'users':[]} ]):
            self.assertIsNotNone(client.validate_owned_organization('org','parent','p',[],require_empty=False))

    def test_test_org_name_is_idempotent(self):
        first = test_org_name("演示项目")
        self.assertEqual(first, "演示项目")
        self.assertEqual(test_org_name(first), first)

    def test_expired_assignments_are_not_project_members(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('project-1', '演示', '2026-01-01', '2026-12-31')")
        self.conn.execute("INSERT INTO persons (id, name) VALUES ('person-1', '张三')")
        self.conn.execute("INSERT INTO assignments (id, person_id, project_id, start_date, end_date) VALUES ('assignment-1', 'person-1', 'project-1', '2020-01-01', '2020-01-02')")
        self.assertEqual(project_members(self.conn, 'project-1'), [])

    def test_redact_error_removes_secret_values(self):
        message = redact_error("api_key=sk-1234567890abcdef token=abc")
        self.assertNotIn("1234567890abcdef", message)
        self.assertIn("[REDACTED]", message)

    def test_batch_result_preserves_partial_success(self):
        result = _batch_result({'success_ids': ['u1'], 'failed_ids': ['u2']}, ['u1', 'u2'], 'remove')
        self.assertEqual(result['success_ids'], ['u1'])
        self.assertEqual(result['failed_ids'], ['u2'])
        self.assertTrue(result['partial'])

    def test_delete_guard_requires_dashboard_parent_and_description(self):
        client = EasyAIClient()
        client._mock_orgs['org-1'] = {'_id': 'org-1', 'name': '项目', 'parent': 'parent-1', 'description': 'dashboard project p1'}
        with self.assertRaisesRegex(RuntimeError, '禁止删除'):
            client.delete_organization('org-1', 'parent-1', 'p1')
        self.assertIn('org-1', client._mock_orgs)
        client._mock_orgs['org-2'] = {'_id': 'org-2', 'name': '外部', 'parent': 'parent-1', 'description': 'other'}
        with self.assertRaisesRegex(RuntimeError, '禁止删除'):
            client.delete_organization('org-2', 'parent-1', 'p2')

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
        self.assertEqual(result[1]['status'], 'candidate')
        self.assertEqual(result[1]['reason'], 'missing_external_id')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM external_user_identity').fetchone()[0], 0)

    def test_matching_reads_platform_dingtalk_username_and_unionid(self):
        members = [{'id': 'dashboard-1', 'name': '张三', 'ding_id': 'ding-1', 'dingtalk_union_id': ''}]
        users = [{'_id': 'easy-1', 'username': 'dingtalk_ding-1', 'dt_unionid': 'union-1'}]
        result = match_identities(self.conn, members, users)
        self.assertEqual(result[0]['status'], 'auto_matched')
        self.assertEqual(result[0]['easyai_user_id'], 'easy-1')

    def test_matching_marks_duplicate_and_cross_type_ids_as_conflicts(self):
        members = [{'id': 'dashboard-1', 'name': '张三', 'ding_id': 'same-id', 'dingtalk_union_id': ''}]
        users = [{'id': 'easy-1', 'dingtalk_user_id': 'same-id'}, {'id': 'easy-2', 'dingtalk_user_id': 'same-id'}]
        self.assertEqual(match_identities(self.conn, members, users)[0]['status'], 'conflict')
        users = [{'id': 'easy-1', 'dingtalk_user_id': 'same-id', 'dingtalk_union_id': 'other'}, {'id': 'easy-2', 'dingtalk_union_id': 'same-id'}]
        result = match_identities(self.conn, members, users)[0]
        self.assertEqual(result['status'], 'conflict')
        self.assertEqual(result['reason'], 'id_type_conflict')

    def test_confirmed_binding_survives_nickname_change(self):
        self.conn.execute("INSERT INTO external_user_identity (dashboard_user_id, dingtalk_user_id, display_name, normalized_name, easyai_user_id, match_status) VALUES ('dashboard-1', 'ding-1', '张三', '张三', 'easy-1', 'confirmed')")
        members = [{'id': 'dashboard-1', 'name': '张三（新）', 'ding_id': 'ding-1', 'dingtalk_union_id': ''}]
        result = match_identities(self.conn, members, [{'id': 'easy-1', 'dingtalk_user_id': 'ding-1'}])[0]
        self.assertEqual(result['easyai_user_id'], 'easy-1')
        self.assertTrue(result['name_changed'])

    def test_refresh_identity_inventory_persists_full_review(self):
        self.conn.execute("INSERT INTO persons (id, name, ding_id, dingtalk_union_id) VALUES ('person-1', '张三', 'ding-1', 'union-1')")
        self.conn.execute("INSERT INTO persons (id, name, ding_id, dingtalk_union_id) VALUES ('person-2', '李四', '', '')")
        rows = refresh_identity_inventory(self.conn, [{'id': 'easy-1', 'username': 'dingtalk_ding-1'}, {'id': 'easy-2', 'name': '李四'}])
        self.assertEqual(len(rows), 2)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM external_user_identity").fetchone()[0], 2)
        self.assertEqual(self.conn.execute("SELECT match_status FROM external_user_identity WHERE dashboard_user_id='person-1'").fetchone()[0], 'auto_matched')
        self.assertEqual(self.conn.execute("SELECT match_status FROM external_user_identity WHERE dashboard_user_id='person-2'").fetchone()[0], 'candidate')

    def test_identity_inventory_preview_is_read_only(self):
        self.conn.execute("INSERT INTO persons (id, name, ding_id, dingtalk_union_id) VALUES ('person-1', '张三', 'ding-1', 'union-1')")
        rows = identity_inventory_preview(self.conn, [{'id': 'easy-1', 'username': 'dingtalk_ding-1'}])
        self.assertEqual(rows[0]['status'], 'auto_matched')
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM external_user_identity").fetchone()[0], 0)

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

    def test_parent_lookup_reads_nested_children_and_mongo_id(self):
        client = EasyAIClient()
        client._mock_orgs["root"] = {"_id": "root", "name": "根", "children": [{"_id": "parent-2", "name": "执行项目组", "children": []}]}
        parent = client.find_parent_organization("执行项目组")
        self.assertEqual(organization_id(parent), "parent-2")
        self.assertEqual(list(iter_organizations(client.list_organizations()))[-1]["_id"], "parent-2")

    def test_mock_binding_uses_normalized_mongo_id(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p-bind', '绑定', '', '')")
        client = EasyAIClient()
        client._mock_orgs["parent"] = {"_id": "parent", "name": "执行项目组", "children": []}
        with patch('project_sync.EasyAIClient', return_value=client):
            binding = ensure_binding(self.conn, 'p-bind', '绑定')
        self.assertEqual(binding['easyai_org_id'], 'mock-org-e7acab82c958')
        self.assertEqual(binding['parent_org_id'], 'parent')

    def test_preview_marks_mock_provider_as_simulated(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p1', '演示', '', '')")
        result = preview_project(self.conn, "p1")
        self.assertEqual(result["provider"], "mock")
        self.assertTrue(result["simulated"])
        self.assertFalse(result["write_enabled"])

    def test_bearer_token_is_loaded_from_encrypted_config(self):
        self.conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", ("easyai_admin_bearer_token_encrypted", encrypt_secret("jwt-value")))
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["bearer_token"], "Bearer jwt-value")
        stored = self.conn.execute("SELECT value FROM config WHERE key='easyai_admin_bearer_token_encrypted'").fetchone()[0]
        self.assertNotIn("jwt-value", stored)

    def test_bearer_token_mask_only_exposes_last_four(self):
        from project_sync import mask_secret
        masked = mask_secret("Bearer abcdefghijkl2moA")
        self.assertTrue(masked.endswith("2moA"))
        self.assertNotIn("Bearer", masked)

    def test_invalid_bearer_ciphertext_is_ignored(self):
        self.conn.execute("INSERT INTO config (key, value) VALUES (?, ?)", ("easyai_admin_bearer_token_encrypted", "invalid-old-ciphertext"))
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["bearer_token"], "")

    def test_admin_api_endpoint_is_fixed(self):
        self.conn.executemany(
            "INSERT INTO config (key, value) VALUES (?, ?)",
            [("easyai_admin_base_url", "https://example.invalid/api"), ("easyai_auth_path", "/wrong")],
        )
        runtime = load_easyai_runtime_config(self.conn)
        self.assertEqual(runtime["base_url"], "https://wowidea.top/api")
        self.assertEqual(runtime["base_url"], "https://wowidea.top/api")

    def test_bearer_header_preserves_or_adds_prefix(self):
        self.assertEqual(EasyAIClient({"bearer_token": "jwt-value"})._headers()["Authorization"], "Bearer jwt-value")
        self.assertEqual(EasyAIClient({"bearer_token": "Bearer jwt-value"})._headers()["Authorization"], "Bearer jwt-value")

    def test_preview_and_sync_track_new_and_existing_members(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p-sync', '演示同步', '', '')")
        self.conn.execute("INSERT INTO persons (id, name, ding_id, dingtalk_union_id) VALUES ('person-1', '张三', 'ding-1', 'union-1')")
        self.conn.execute("INSERT INTO assignments (id, person_id, project_id, start_date, end_date) VALUES ('a-1', 'person-1', 'p-sync', '', '')")
        self.conn.execute("INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, status) VALUES ('p-sync', 'org-1', 'parent-1', '[TEST][dashboard-local] 演示同步', 'active')")
        preview = preview_project(self.conn, 'p-sync')
        self.assertEqual(preview['added'], 1)
        self.assertEqual(preview['existing'], 0)
        result = sync_project(self.conn, 'p-sync')
        self.assertEqual(result['added'], 1)
        self.assertEqual(result['existing'], 0)
        preview_after = preview_project(self.conn, 'p-sync')
        self.assertEqual(preview_after['added'], 0)
        self.assertEqual(preview_after['existing'], 1)
        repeat = sync_project(self.conn, 'p-sync')
        self.assertFalse(repeat.get('idempotent', False))
        self.assertEqual(repeat['added'], 0)

    def test_sync_run_schema_has_existing_count(self):
        columns = {row[1] for row in self.conn.execute("PRAGMA table_info(sync_run)").fetchall()}
        self.assertIn('existing_count', columns)

    def test_global_preview_excludes_orphan_from_current_diff(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p-live', '在线项目', '', '')")
        self.conn.execute("INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, status) VALUES ('p-live', 'org-live', 'parent', '[TEST][dashboard-local] 在线项目', 'active')")
        self.conn.execute("INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, status) VALUES ('p-deleted', 'org-deleted', 'parent', '[TEST][dashboard-local] 已删除项目', 'active')")
        result = preview_all_projects(self.conn)
        self.assertEqual([item['project']['id'] for item in result['projects']], ['p-live'])
        self.assertEqual(result['totals']['pending_delete'], 0)

    def test_project_sync_coordinator_skips_overlapping_project(self):
        coordinator = ProjectSyncCoordinator()
        lock = coordinator._locks['project-1']
        lock.acquire()
        try:
            result = coordinator.run('project-1', lambda: {'success': True})
            self.assertTrue(result['skipped'])
            self.assertEqual(result['reason'], 'already_running')
        finally:
            lock.release()

    def test_project_sync_coordinator_releases_lock_after_failure(self):
        coordinator = ProjectSyncCoordinator()
        with self.assertRaisesRegex(RuntimeError, 'boom'):
            coordinator.run('project-1', lambda: (_ for _ in ()).throw(RuntimeError('boom')))
        result = coordinator.run('project-1', lambda: {'success': True})
        self.assertEqual(result, {'success': True})

    def test_failed_sync_run_is_recorded_for_retry_diagnostics(self):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES ('p-fail', '失败项目', '', '')")
        self.conn.execute("INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, status) VALUES ('p-fail', 'org-1', 'parent-1', '[TEST][dashboard-local] 失败项目', 'active')")
        failing = EasyAIClient()
        failing.list_users = lambda: (_ for _ in ()).throw(RuntimeError('api_key=secret-value'))
        with patch('project_sync.EasyAIClient', return_value=failing):
            with self.assertRaises(RuntimeError):
                sync_project(self.conn, 'p-fail', 'scheduler', 'scheduler')
        row = self.conn.execute("SELECT status, error_count, details FROM sync_run WHERE project_id='p-fail'").fetchone()
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['error_count'], 1)
        self.assertNotIn('secret-value', row['details'])

    def test_admin_page_has_independent_login_save_control(self):
        html = Path(__file__).with_name("static").joinpath("admin.html").read_text(encoding="utf-8")
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn('id="saveEasyAICredentialsBtn"', html)
        self.assertIn("保存管理员账号", html)
        self.assertIn("async function saveEasyAICredentials", js)
        self.assertIn('body = { easyai_admin_username: username, easyai_admin_password: password }', js)
        self.assertIn('state.config.easyai_admin_credentials_configured', js)

    def test_password_mask_is_not_exposed_by_config_response_code(self):
        app_source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
        self.assertNotIn("result['easyai_admin_password_masked']", app_source)
        self.assertIn("JWT 已过期或无效", app_source)

    def test_export_filters_sensitive_config_keys(self):
        app_source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
        self.assertIn("sensitive = ('password', 'secret', 'token', 'api_key'", app_source)
        self.assertIn("if not any(part in str(c['key']).lower() for part in sensitive)", app_source)

    def test_global_sync_result_render_and_delete_feedback_contract(self):
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn("item.project_id, name: item.project_name", js)
        self.assertIn("item.organization_name || item.org_name", js)
        self.assertIn("本地已删除，但组织清理失败或待重试", js)
        self.assertIn("actionConfirmBtn.disabled = true", js)
        self.assertNotIn('if (!confirm("确定删除此项目及其全部分配吗？")) return;', js)

    def test_json_export_is_downloaded_without_navigation(self):
        app_source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn('Content-Disposition"] = \'attachment; filename="dashboard-export.json"\'', app_source)
        self.assertIn('byId("exportJsonBtn").addEventListener("click", downloadJsonExport)', js)
        self.assertIn("DashboardAccess.download('api/export', 'dashboard.json')", js)
        self.assertIn('JSON 导出已开始下载', js)
        self.assertNotIn('URL.revokeObjectURL(url)', js)
        self.assertNotIn('location.href = "api/export"', js)

    def test_person_delete_uses_in_page_confirmation(self):
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn('async function deletePerson(id)', js)
        self.assertIn('openActionConfirm("确认删除人员"', js)
        self.assertNotIn('if (!confirm("确定删除此人员及其全部分配吗？")) return;', js)

    def test_person_sync_preserves_visibility_and_union_id(self):
        app_source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
        js = Path(__file__).with_name("static").joinpath("admin.js").read_text(encoding="utf-8")
        self.assertIn("dingtalk_union_id = COALESCE(?, dingtalk_union_id)", app_source)
        self.assertIn("selected = COALESCE(?, selected)", app_source)
        self.assertIn("unionId: user.unionId || user.dingtalkUnionId || existing?.dingtalk_union_id || \"\"", js)


if __name__ == "__main__":
    unittest.main()
