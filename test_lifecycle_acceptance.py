"""Independent lifecycle acceptance tests for Dashboard project synchronization.

These tests use an isolated SQLite database and a fully mocked EasyAI adapter.
They intentionally exercise public sync functions and Flask routes without
starting the scheduler or touching the checked-in claw.db.
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch


# Keep module import safe during unittest discovery.  app.py reads these values
# at import time, so use a disposable DB and mock mode until each test starts.
_import_db = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_import_db.close()
_saved_import_env = {key: os.environ.get(key) for key in ("DB_PATH", "EASYAI_SYNC_MODE", "EASYAI_SYNC_ENABLED")}
os.environ["DB_PATH"] = _import_db.name
os.environ["EASYAI_SYNC_MODE"] = "mock"
os.environ["EASYAI_SYNC_ENABLED"] = "true"
sys.path.insert(0, os.path.dirname(__file__))

import app as dashboard_app
import project_sync
from project_sync import cleanup_deleted_binding, ensure_tables, sync_all_projects, sync_project, _batch_result

try:
    os.unlink(_import_db.name)
except OSError:
    pass
for _key, _value in _saved_import_env.items():
    if _value is None:
        os.environ.pop(_key, None)
    else:
        os.environ[_key] = _value


class FakeAdapter:
    mode = "real"

    def __init__(self, _config=None):
        self.calls = []
        self.users = [
            {"id": "easy-a", "name": "A", "dingtalk_user_id": "ding-a"},
            {"id": "easy-b", "name": "B", "dingtalk_user_id": "ding-b"},
        ]
        self.add_responses = []
        self.remove_responses = []
        self.organizations = {"org-p-a": {"parent": "parent", "description": "dashboard project p-a"},
                              "org-p-b": {"parent": "parent", "description": "dashboard project p-b"}}

    def list_users(self):
        self.calls.append(("list_users",))
        return list(self.users)

    def add_users_to_organization(self, user_ids, org_id):
        user_ids = list(map(str, user_ids))
        self.calls.append(("add", user_ids, str(org_id)))
        return self.add_responses.pop(0) if self.add_responses else {"success_ids": user_ids, "failed_ids": []}

    def remove_users_from_organization(self, user_ids, org_id):
        user_ids = list(map(str, user_ids))
        self.calls.append(("remove", user_ids, str(org_id)))
        return self.remove_responses.pop(0) if self.remove_responses else {"success_ids": user_ids, "failed_ids": []}

    def delete_organization(self, org_id, parent_id, external_id):
        self.calls.append(("delete_org", str(org_id), str(parent_id), str(external_id)))
        return {"deleted": True, "id": str(org_id)}

    def validate_owned_organization(self, org_id, parent_id, external_id, managed_user_ids=None, require_empty=False):
        self.calls.append(("validate", str(org_id), str(parent_id), str(external_id), list(managed_user_ids or []), require_empty))
        org = self.organizations.get(str(org_id))
        if not org or org["parent"] != str(parent_id):
            raise RuntimeError("组织归属或 Dashboard 标记不匹配")
        return org

    def update_organization_description(self, org_id, description):
        self.calls.append(('description', str(org_id), description))
        self.organizations.setdefault(str(org_id), {})['description'] = description

    def update_organization_name(self, org_id, name):
        self.calls.append(("rename", str(org_id), name))
        return {"id": str(org_id), "name": name}


class LifecycleAcceptanceTests(unittest.TestCase):
    def setUp(self):
        from flask.testing import FlaskClient
        class AuthenticatedClient(FlaskClient):
            def open(self, *args, **kwargs):
                kwargs.setdefault('headers', {})['Authorization'] = 'Bearer lifecycle-test'
                return super().open(*args, **kwargs)
        for patcher in [patch.object(dashboard_app.app, 'test_client_class', AuthenticatedClient),
                        patch('access_control.verify_identity', return_value={'id': 'test-operator', 'roles': ['operator']}),
                        patch('requests.sessions.Session.request', side_effect=AssertionError('Acceptance tests must not use live services'))]:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        self.db_file.close()
        self.fake = FakeAdapter()
        self.p_sync = patch.object(project_sync, "EasyAIClient", return_value=self.fake)
        self.p_app = patch.object(dashboard_app, "EasyAIClient", return_value=self.fake)
        self.p_sync_mode = patch.object(project_sync, "SYNC_MODE", "real")
        self.p_sync_enabled = patch.object(project_sync, "SYNC_ENABLED", True)
        self.p_app_mode = patch.object(dashboard_app, "SYNC_MODE", "real")
        self.p_app_enabled = patch.object(dashboard_app, "SYNC_ENABLED", True)
        self.p_sync.start()
        self.p_app.start()
        self.p_sync_mode.start()
        self.p_sync_enabled.start()
        self.p_app_mode.start()
        self.p_app_enabled.start()
        self.old_db_path = dashboard_app.DB_PATH
        dashboard_app.DB_PATH = self.db_file.name
        self.conn = sqlite3.connect(self.db_file.name)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
                color TEXT DEFAULT '#1890ff', business_trip INTEGER DEFAULT 0, business_trip_start TEXT DEFAULT '',
                business_trip_end TEXT DEFAULT '', business_trip_persons TEXT DEFAULT '[]');
            CREATE TABLE persons (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_type TEXT DEFAULT 'pre',
                avatar TEXT DEFAULT '', ding_id TEXT DEFAULT '', dingtalk_union_id TEXT DEFAULT '',
                department TEXT DEFAULT '', selected INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
                leave_status TEXT DEFAULT '', leave_start TEXT DEFAULT '', leave_end TEXT DEFAULT '', leave_type TEXT DEFAULT '');
            CREATE TABLE assignments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, person_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL);
            CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);
            """
        )
        ensure_tables(self.conn)
        self.today = date.today().isoformat()

    def tearDown(self):
        self.conn.close()
        dashboard_app.DB_PATH = self.old_db_path
        self.p_app.stop()
        self.p_sync.stop()
        self.p_sync_mode.stop()
        self.p_sync_enabled.stop()
        self.p_app_mode.stop()
        self.p_app_enabled.stop()
        try:
            os.unlink(self.db_file.name)
        except OSError:
            pass

    def add_project(self, project_id, name=None):
        self.conn.execute("INSERT INTO projects (id, name, start_date, end_date) VALUES (?, ?, ?, ?)",
                          (project_id, name or project_id, self.today, self.today))
        self.conn.execute("INSERT INTO project_easyai_binding (project_id, easyai_org_id, parent_org_id, organization_name, status) VALUES (?, ?, 'parent', ?, 'active')",
                          (project_id, "org-" + project_id, name or project_id))

    def add_person_assignment(self, project_id, person_id="person-a", name="A", end=None):
        self.conn.execute("INSERT OR IGNORE INTO persons (id, name, ding_id) VALUES (?, ?, ?)", (person_id, name, "ding-a" if person_id.endswith("a") else "ding-b"))
        self.conn.execute("INSERT INTO assignments (id, project_id, person_id, start_date, end_date) VALUES (?, ?, ?, ?, ?)",
                          ("as-" + project_id + "-" + person_id, project_id, person_id, self.today, end or self.today))
        self.conn.commit()

    def test_membership_expiry_rejoin_and_same_minute_change(self):
        self.add_project("p-a", "A project")
        self.add_person_assignment("p-a")
        first = sync_project(self.conn, "p-a")
        self.assertTrue(first["success"])
        self.assertEqual([c[1] for c in self.fake.calls if c[0] == "add"], [["easy-a"]])

        self.conn.execute("UPDATE assignments SET end_date=? WHERE project_id='p-a'", ((date.today() - timedelta(days=1)).isoformat(),))
        self.conn.commit()
        expired = sync_project(self.conn, "p-a")
        self.assertTrue(expired["success"])
        self.assertIn(["easy-a"], [c[1] for c in self.fake.calls if c[0] == "remove"])

        # A changed active assignment in the same minute must produce a new run.
        self.conn.execute("UPDATE assignments SET end_date=? WHERE project_id='p-a'", (self.today,))
        self.conn.commit()
        rejoined = sync_project(self.conn, "p-a")
        self.assertTrue(rejoined["success"])
        adds = [c[1] for c in self.fake.calls if c[0] == "add" and c[1]]
        self.assertEqual(adds, [["easy-a"], ["easy-a"]])

    def test_project_date_edit_updates_description(self):
        self.add_project('p-a')
        self.conn.commit()
        response = dashboard_app.app.test_client().put('/api/projects/p-a', json={'startDate':'2026-09-22','endDate':'2026-09-29'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.fake.organizations['org-p-a']['description'],'20260922-20260929')

    def test_archived_project_is_excluded_without_changing_members_or_organization(self):
        self.add_project("p-a")
        self.add_person_assignment("p-a", end=(date.today() + timedelta(days=7)).isoformat())
        self.assertEqual(sync_project(self.conn, "p-a")["added"], 1)
        self.conn.execute("UPDATE projects SET end_date=? WHERE id='p-a'",
                          ((date.today() - timedelta(days=1)).isoformat(),))
        self.conn.commit()
        self.fake.calls.clear()
        preview = project_sync.preview_project(self.conn, "p-a")
        self.assertTrue(preview['skipped'])
        self.assertEqual(preview["removed"], 0)
        result = sync_all_projects(self.conn)
        self.assertTrue(result["success"])
        self.assertEqual(result["projects"], [])
        self.assertFalse(any(call[0] == "delete_org" for call in self.fake.calls))
        binding = self.conn.execute("SELECT easyai_org_id,status FROM project_easyai_binding WHERE project_id='p-a'").fetchone()
        self.assertEqual(tuple(binding), ("org-p-a", "active"))
        self.assertEqual(self.conn.execute("SELECT status FROM project_easyai_member WHERE project_id='p-a'").fetchone()[0], "active")
        # Both direct and scheduled sync leave the archived organization untouched.
        self.assertTrue(sync_project(self.conn, "p-a", "manual")['skipped'])
        self.assertEqual(sync_project(self.conn, "p-a", "scheduler")["removed"], 0)
        project_sync.ensure_binding(self.conn, 'p-a', 'Changed archived name')
        project_sync.update_project_binding_name(self.conn, 'p-a', 'Changed archived name')
        self.assertEqual(self.fake.calls, [])
        self.conn.execute("UPDATE projects SET end_date=? WHERE id='p-a'", (self.today,))
        self.assertEqual(sync_project(self.conn, "p-a")["existing"], 1)

    def test_archive_filter_keeps_today_and_future_and_excludes_yesterday(self):
        for pid in ['past', 'today', 'future']:
            self.add_project(pid)
        self.conn.execute('UPDATE projects SET end_date=? WHERE id=?', ((date.today()-timedelta(days=1)).isoformat(), 'past'))
        self.conn.execute('UPDATE projects SET end_date=? WHERE id=?', ((date.today()+timedelta(days=1)).isoformat(), 'future'))
        self.assertEqual({row['id'] for row in project_sync.syncable_projects(self.conn)}, {'today', 'future'})
        preview = project_sync.preview_all_projects(self.conn)
        self.assertEqual({row['project']['id'] for row in preview['projects']}, {'today', 'future'})

    def test_archived_project_does_not_contribute_to_consistency(self):
        self.add_project('p-a')
        self.conn.execute('UPDATE projects SET end_date=? WHERE id=?', ((date.today()-timedelta(days=1)).isoformat(), 'p-a'))
        result = project_sync.organization_consistency(self.conn)
        self.assertEqual(result['projects'], 0)
        self.assertEqual(result['differentProjects'], 0)

    def test_scheduler_loop_expires_members_and_continues_after_project_failure(self):
        self.add_project("p-a")
        self.add_person_assignment("p-a")
        sync_project(self.conn, "p-a")
        self.conn.execute("UPDATE assignments SET end_date=? WHERE project_id='p-a'",
                          ((date.today() - timedelta(days=1)).isoformat(),))
        self.add_project("p-b")
        self.add_person_assignment("p-b", "person-b", "B")
        self.conn.commit()
        real_sync = dashboard_app.sync_project

        def fail_first(project_conn, project_id, trigger, operator):
            if project_id == "p-a":
                raise RuntimeError("synthetic scheduler failure")
            return real_sync(project_conn, project_id, trigger, operator)

        # Stop at the next wait: one complete real scheduler loop has executed.
        with patch.object(dashboard_app, "PROJECT_SYNC_SCHEDULER_ENABLED", True), \
             patch.object(dashboard_app.project_sync_wake, "wait", side_effect=[False, InterruptedError]), \
             patch.object(dashboard_app, "sync_project", side_effect=fail_first):
            with self.assertRaises(InterruptedError):
                dashboard_app.schedule_project_sync()
        row = self.conn.execute("SELECT status,trigger FROM sync_run WHERE project_id='p-b' ORDER BY started_at DESC LIMIT 1").fetchone()
        self.assertEqual(tuple(row), ("succeeded", "scheduler"))

        with patch.object(dashboard_app, "PROJECT_SYNC_SCHEDULER_ENABLED", True), \
             patch.object(dashboard_app.project_sync_wake, "wait", side_effect=[False, InterruptedError]) as sleep:
            with self.assertRaises(InterruptedError):
                dashboard_app.schedule_project_sync()
        self.assertEqual(sleep.call_args_list[0].args, (dashboard_app.PROJECT_SYNC_INTERVAL_SECONDS,))
        row = self.conn.execute("SELECT status FROM project_easyai_member WHERE project_id='p-a'").fetchone()
        self.assertEqual(row[0], "removed")
        run = self.conn.execute("SELECT removed_count,trigger FROM sync_run WHERE project_id='p-a' ORDER BY started_at DESC LIMIT 1").fetchone()
        self.assertEqual(tuple(run), (1, "scheduler"))

    def test_scheduler_disabled_does_not_start_thread(self):
        with patch.object(dashboard_app, "PROJECT_SYNC_SCHEDULER_ENABLED", False), \
             patch.object(dashboard_app.threading, "Thread") as thread:
            dashboard_app.start_project_sync_scheduler()
            thread.assert_not_called()
        with patch.dict(os.environ, {"SYNC_INTERVAL_MINUTES": "10"}):
            self.assertEqual(dashboard_app._project_sync_interval_seconds(), 600)

    def test_partial_failure_can_retry_only_failed_members(self):
        self.add_project("p-partial")
        self.add_person_assignment("p-partial", "person-a", "A")
        self.add_person_assignment("p-partial", "person-b", "B")
        self.fake.add_responses = [
            {"success_ids": ["easy-a"], "failed_ids": ["easy-b"]},
            {"success_ids": ["easy-b"], "failed_ids": []},
        ]
        first = sync_project(self.conn, "p-partial")
        self.assertFalse(first["success"])
        second = sync_project(self.conn, "p-partial")
        self.assertTrue(second["success"], second)
        adds = [c[1] for c in self.fake.calls if c[0] == "add"]
        self.assertEqual(adds, [["easy-a", "easy-b"], ["easy-b"]])

    def test_delete_scope_preserves_other_project_and_deleted_is_not_repending(self):
        self.add_project("p-a")
        self.add_project("p-b")
        self.add_person_assignment("p-a")
        self.add_person_assignment("p-b", "person-b", "B")
        sync_project(self.conn, "p-a")
        sync_project(self.conn, "p-b")
        # The deletion helper must only touch the requested project's binding.
        self.conn.execute("DELETE FROM projects WHERE id='p-a'")
        self.conn.commit()
        with dashboard_app.app.test_request_context('/api/projects/p-a'):
            from flask import g
            g.visitor = {'id': 'test-operator'}
            result = dashboard_app.sync_deleted_project("p-a")
        self.assertTrue(result["success"], result)
        self.assertFalse(any(call[0] == 'delete_org' for call in self.fake.calls))
        self.assertNotIn(("delete_org", "org-p-b", "parent", "p-b"), self.fake.calls)
        self.assertEqual(self.conn.execute("SELECT status FROM project_easyai_binding WHERE project_id='p-b'").fetchone()[0], "active")
        self.assertEqual(self.conn.execute("SELECT status FROM project_easyai_binding WHERE project_id='p-a'").fetchone()[0], "retained")
        self.conn.commit()
        followup = sync_all_projects(self.conn, "test")
        self.assertEqual(followup["totals"]["pending_delete"], 0)
        self.assertEqual(self.conn.execute("SELECT status FROM project_easyai_binding WHERE project_id='p-a'").fetchone()[0], "retained")

    def test_member_removal_requires_owned_organization_validation_first(self):
        self.add_project("p-a")
        self.add_person_assignment("p-a")
        self.conn.execute("INSERT INTO project_easyai_member (project_id, easyai_org_id, easyai_user_id, dashboard_user_id, status, first_synced_at, last_synced_at) VALUES ('p-a', 'org-p-a', 'easy-a', 'person-a', 'active', 1, 1)")
        self.conn.commit()
        self.fake.organizations["org-p-a"]["parent"] = "untrusted-parent"
        with self.assertRaisesRegex(RuntimeError, "归属"):
            cleanup_deleted_binding(self.conn, "p-a", client=self.fake)
        self.assertFalse(any(call[0] == "remove" for call in self.fake.calls))
        self.assertTrue(any(call[0] == "validate" for call in self.fake.calls))

    def test_global_api_is_current_only_logs_are_separate_and_failure_isolated(self):
        self.add_project("p-a")
        self.add_project("p-b")
        self.add_person_assignment("p-a")
        self.add_person_assignment("p-b", "person-b", "B")
        # Make one project's provider operation fail while the other succeeds.
        original_add = self.fake.add_users_to_organization
        def add_with_one_failure(ids, org):
            if org == "org-p-a":
                return {"success_ids": [], "failed_ids": list(ids)}
            return original_add(ids, org)
        self.fake.add_users_to_organization = add_with_one_failure
        self.conn.commit()
        client = dashboard_app.app.test_client()
        preview = client.post("/api/project-sync/global/preview").get_json()
        self.assertEqual({item["project"]["id"] for item in preview["projects"]}, {"p-a", "p-b"})
        run = client.post("/api/project-sync/global/run", json={}).get_json()
        statuses = {item["project_id"]: item["status"] for item in run["projects"]}
        self.assertEqual(statuses["p-a"], "failed")
        self.assertEqual(statuses["p-b"], "succeeded")
        logs = client.get("/api/project-sync/global/logs").get_json()
        self.assertTrue(logs and logs[0]["totals"]["failed"] == 1)
        # The dedicated logs route contains the aggregate global run; the
        # generic runs route may also expose per-project runs from that run.
        self.assertTrue(any(item["project_id"] == "__global__" and item["trigger"] == "global"
                            for item in client.get("/api/project-sync/runs").get_json()))

    def test_assignment_routes_sync_after_local_commit_even_when_external_fails(self):
        self.add_project("p-a")
        self.conn.execute("INSERT INTO persons (id, name, ding_id) VALUES ('person-a', 'A', 'ding-a')")
        self.conn.commit()
        with patch.object(dashboard_app, "sync_assignment_project", return_value={"success": False, "retryable": True, "error": "provider down"}) as sync:
            client = dashboard_app.app.test_client()
            created = client.post("/api/assignments", json={"projectId": "p-a", "personId": "person-a", "startDate": self.today, "endDate": self.today}).get_json()
            self.assertTrue(created["success"])
            self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM assignments").fetchone()[0], 1)
            sync.assert_called_once_with("p-a", "assignment_create")
            aid = created["id"]
            client.put("/api/assignments/" + aid, json={"startDate": self.today, "endDate": self.today})
            client.delete("/api/assignments/" + aid)
            self.assertEqual(sync.call_count, 3)

    def test_exports_exclude_credentials_and_unknown_batch_response_is_not_success(self):
        self.conn.execute("INSERT INTO config (key, value) VALUES ('easyai_admin_password', 'SENTINEL-PASSWORD')")
        self.conn.execute("INSERT INTO config (key, value) VALUES ('normal_setting', 'visible')")
        self.conn.commit()
        response = dashboard_app.app.test_client().get("/api/export")
        body = json.dumps(response.get_json(), ensure_ascii=False)
        self.assertNotIn("SENTINEL-PASSWORD", body)
        self.assertIn("visible", body)
        normalized = _batch_result({}, ["easy-a"], "add")
        self.assertEqual(normalized["success_ids"], [])
        self.assertTrue(normalized["partial"])

    def test_consistency_checks_live_members_name_parent_and_orphans(self):
        self.add_project("p-a", "Project A")
        self.add_person_assignment("p-a")
        self.conn.execute("INSERT INTO external_user_identity (dashboard_user_id,easyai_user_id,match_status) VALUES ('person-a','easy-a','confirmed')")
        self.conn.commit()
        remote = [{"id": "parent", "name": project_sync.PARENT_ORG_NAME},
                  {"id": "org-p-a", "name": "Project A", "parent": "parent", "users": [{"id": "easy-a"}], "userCount": 1}]
        with patch.object(self.fake, "list_organizations", return_value=remote, create=True):
            self.assertEqual(project_sync.organization_consistency(self.conn)["state"], "consistent")
            remote[1]["users"] = []; remote[1]["userCount"] = 0
            self.assertEqual(project_sync.organization_consistency(self.conn)["state"], "different")
            remote[1]["users"] = [{"id": "easy-a"}]; remote[1]["userCount"] = 1
            remote[1]["name"] = "wrong"
            self.assertEqual(project_sync.organization_consistency(self.conn)["state"], "different")
            remote[1]["name"] = "Project A"; remote[1]["parent"] = "wrong"
            self.assertEqual(project_sync.organization_consistency(self.conn)["state"], "different")
            remote[1]["parent"] = "parent"
            self.conn.execute("UPDATE external_user_identity SET match_status='unmatched'")
            self.assertEqual(project_sync.organization_consistency(self.conn)["state"], "different")
            self.conn.execute("UPDATE external_user_identity SET match_status='confirmed'")
            self.conn.execute("INSERT INTO project_easyai_binding (project_id,easyai_org_id,organization_name,status) VALUES ('deleted-project','orphan-org','Deleted','pending_delete')")
            remote.append({"id":"orphan-org"})
            self.assertEqual(project_sync.organization_consistency(self.conn)["pendingCleanup"], 1)
            remote.pop()
            del remote[1]["users"]
            with self.assertRaises(RuntimeError):
                project_sync.organization_consistency(self.conn)

    def test_private_config_and_server_side_dingtalk_credentials(self):
        self.conn.executemany('INSERT INTO config (key,value) VALUES (?,?)', [('ding_appKey','test-key'),('ding_appSecret','test-secret'),
            ('easyai_admin_username_encrypted',project_sync.encrypt_secret('test-admin')),
            ('easyai_admin_password_encrypted',project_sync.encrypt_secret('test-password'))])
        self.conn.commit()
        client = dashboard_app.app.test_client()
        data = client.get('/api/config').json
        self.assertTrue(data['dingtalk_configured']); self.assertTrue(data['easyai_admin_credentials_configured'])
        for secret in ['test-key','test-secret','test-admin','test-password']:
            self.assertNotIn(secret, str(data))
        self.assertNotIn('easyai_admin_username', data)
        from unittest.mock import Mock
        with patch.object(dashboard_app.requests, 'get', return_value=Mock(json=lambda:{'errcode':0})) as http:
            self.assertTrue(client.post('/api/dingtalk/test',json={}).json['success'])
            self.assertEqual(http.call_args.kwargs['params'], {'appkey':'test-key','appsecret':'test-secret'})
        client.post('/api/config',json={'ding_appKey':'','ding_appSecret':''})
        self.assertEqual(self.conn.execute("SELECT value FROM config WHERE key='ding_appSecret'").fetchone()[0], 'test-secret')

    def test_schedule_settings_validate_persist_and_wake(self):
        client = dashboard_app.app.test_client()
        with patch.object(dashboard_app, 'start_project_sync_scheduler') as start, \
             patch.object(dashboard_app.project_sync_wake, 'set') as wake, \
             patch.object(dashboard_app, 'PROJECT_SYNC_SCHEDULER_ENABLED',False), \
             patch.object(dashboard_app, 'PROJECT_SYNC_INTERVAL_SECONDS',3600):
            self.assertEqual(client.post('/api/project-sync/schedule',json={'enabled':True,'intervalHours':0}).status_code,400)
            self.assertEqual(client.post('/api/project-sync/schedule',json={'enabled':True,'intervalHours':1.5}).status_code,400)
            data = client.post('/api/project-sync/schedule',json={'enabled':True,'intervalHours':2}).json
            self.assertTrue(data['enabled']); self.assertEqual(data['intervalHours'],2)
            self.assertEqual(dashboard_app.PROJECT_SYNC_INTERVAL_SECONDS,7200)
            wake.assert_called_once(); start.assert_called_once()
            dashboard_app.PROJECT_SYNC_SCHEDULER_ENABLED = False
            dashboard_app.load_project_schedule()
            self.assertTrue(dashboard_app.PROJECT_SYNC_SCHEDULER_ENABLED)
            self.assertEqual(dashboard_app.PROJECT_SYNC_INTERVAL_SECONDS,7200)
            self.assertFalse(client.post('/api/project-sync/schedule',json={'enabled':False,'intervalHours':1}).json['enabled'])

    def test_overview_schedule_and_binding_badges(self):
        self.add_project("p-a")
        self.add_person_assignment("p-a")
        self.conn.commit()
        client = dashboard_app.app.test_client()
        self.assertEqual(client.get('/api/persons').json[0]['wowidea_binding_status'], 'unbound')
        self.conn.execute("INSERT INTO external_user_identity (dashboard_user_id,easyai_user_id,match_status) VALUES ('person-a','easy-a','confirmed')")
        self.conn.commit()
        self.assertEqual(client.get('/api/persons').json[0]['wowidea_binding_status'], 'bound')
        with patch.object(dashboard_app, 'organization_consistency', return_value={'state':'consistent'}), patch.object(dashboard_app, 'PROJECT_SYNC_SCHEDULER_ENABLED', False):
            data = client.get('/api/project-sync/overview').json
            self.assertFalse(data['schedulerEnabled']); self.assertIsNone(data['nextSyncAt'])
        from unittest.mock import Mock
        with patch.object(dashboard_app, 'organization_consistency', return_value={'state':'consistent'}), patch.object(dashboard_app, 'PROJECT_SYNC_SCHEDULER_ENABLED', True), patch.object(dashboard_app, 'project_sync_scheduler_thread', Mock(is_alive=lambda: True)), patch.object(dashboard_app, 'project_sync_next_at', 123456789):
            data = client.get('/api/project-sync/overview').json
            self.assertTrue(data['schedulerEnabled']); self.assertEqual(data['nextSyncAt'], 123456789)
        with patch.object(dashboard_app, 'organization_consistency', side_effect=RuntimeError('secret-test-value')):
            data = client.get('/api/project-sync/overview').json
            self.assertEqual(data['state'], 'error'); self.assertNotIn('secret-test-value', str(data))

    def test_person_sync_preserves_existing_visibility_and_union_id(self):
        self.conn.execute("INSERT INTO persons (id, name, ding_id, dingtalk_union_id, selected) VALUES ('ding-existing', 'Existing', 'ding-existing', 'union-existing', 0)")
        self.conn.commit()
        client = dashboard_app.app.test_client()
        existing = client.post("/api/persons", json={"id": "existing", "name": "Existing Updated", "dingId": "ding-existing", "department": "测试"})
        self.assertEqual(existing.status_code, 200)
        row = self.conn.execute("SELECT name, selected, dingtalk_union_id FROM persons WHERE id='ding-existing'").fetchone()
        self.assertEqual(tuple(row), ("Existing Updated", 0, "union-existing"))

        created = client.post("/api/persons", json={"id": "new-person", "name": "New", "dingId": "ding-new", "department": "测试"})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(self.conn.execute("SELECT selected FROM persons WHERE id='ding-new'").fetchone()[0], 1)

        updated = client.put("/api/persons/ding-existing", json={"name": "Existing Updated", "groupType": "pre", "avatar": "", "dingId": "ding-existing", "unionId": "union-existing", "department": "测试", "selected": 1})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(self.conn.execute("SELECT selected FROM persons WHERE id='ding-existing'").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
