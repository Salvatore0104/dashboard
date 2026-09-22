"""Security boundaries use real middleware, fake upstream and disposable data only."""
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests
import app as dashboard
from access_control import IDENTITY_URL, PUBLIC_API


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db = patch.object(dashboard, 'DB_PATH', os.path.join(self.temp.name, 'test.db'))
        db.start()
        self.addCleanup(db.stop)
        dashboard.init_db()
        self.client = dashboard.app.test_client()
        self.headers = {'Authorization': 'Bearer synthetic-test-token'}
        self.upstream = patch('access_control.requests.get')
        self.identity_get = self.upstream.start()
        self.addCleanup(self.upstream.stop)
        self.identity_get.return_value = self.response(['operator'])

    @staticmethod
    def response(roles, status=200):
        return Mock(status_code=status, json=Mock(return_value={
            'data': {'_id': 'verified-user', 'role': roles, 'status': 0}}))

    def test_every_api_route_denies_anonymous_and_ordinary_users_before_handler(self):
        with patch.object(dashboard, 'get_db', side_effect=AssertionError('handler executed')):
            for rule in dashboard.app.url_map.iter_rules():
                if not rule.rule.startswith('/api/') or rule.rule in PUBLIC_API:
                    continue
                url = rule.rule
                for argument in rule.arguments:
                    url = url.replace('<' + argument + '>', 'fixture')
                for method in rule.methods:
                    with self.subTest(url=url, method=method):
                        self.assertEqual(self.client.open(url, method=method).status_code, 401)
                        self.identity_get.return_value = self.response(['user'])
                        result = self.client.open(url, method=method, headers=self.headers)
                        self.assertEqual(result.status_code, 403)
                        self.assertEqual(result.headers['Cache-Control'], 'no-store')

    def test_role_arrays_and_no_client_role_override(self):
        for roles, status in [(['operator'], 200), (['manager'], 200), (['admin'], 200),
                              (['user', 'operator'], 200), (['user'], 403),
                              (['creator'], 403), (['unknown'], 403), ([], 403)]:
            with self.subTest(roles=roles):
                self.identity_get.return_value = self.response(roles)
                result = self.client.get('/api/access?role=admin', headers=self.headers)
                self.assertEqual(result.status_code, status)
                if status == 200:
                    self.assertEqual(result.json, {'user': {'id': 'verified-user'}, 'canManage': True})
        self.assertEqual(self.identity_get.call_count, 8)
        self.identity_get.assert_called_with(IDENTITY_URL,
            headers=self.headers, timeout=(3, 8), allow_redirects=False)

    def test_invalid_upstream_identity_fails_closed(self):
        for status, expected in [(401, 401), (403, 401), (302, 503), (500, 503)]:
            self.identity_get.return_value = self.response(['admin'], status)
            self.assertEqual(self.client.get('/api/access', headers=self.headers).status_code, expected)
        for payload in [None, {}, {'data': None}, {'data': {'_id': 'x', 'role': 'admin'}},
                        {'data': {'role': ['admin']}}, {'data': {'_id': 'x', 'role': [{}]}}]:
            self.identity_get.return_value = Mock(status_code=200, json=Mock(return_value=payload))
            self.assertEqual(self.client.get('/api/access', headers=self.headers).status_code, 503)
        self.identity_get.side_effect = requests.Timeout('do not expose details')
        result = self.client.get('/api/access', headers=self.headers)
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('details', result.text)

    def test_missing_forged_and_query_token(self):
        for value in ['', 'Basic abc', 'Bearer ', 'Bearer a b']:
            result = self.client.get('/api/access?token=abc&role=admin', headers={'Authorization': value})
            self.assertEqual(result.status_code, 401)
        self.identity_get.assert_not_called()
        self.identity_get.return_value = self.response(['admin'], 401)
        self.assertEqual(self.client.get('/api/access', headers={'Authorization': 'Bearer forged.jwt.value'}).status_code, 401)

    def test_disabled_identity_and_public_write_methods(self):
        response = self.response(['admin'])
        response.json.return_value['data']['status'] = 1
        self.identity_get.return_value = response
        self.assertEqual(self.client.get('/api/access', headers=self.headers).status_code, 401)
        for path in PUBLIC_API:
            self.assertEqual(self.client.post(path, json={}).status_code, 401)

    def test_tv_display_whitelist_and_hidden_relations(self):
        conn = dashboard.get_db()
        conn.execute("INSERT INTO persons (id,name,selected,leave_type,leave_start,leave_end,ding_id) VALUES ('p','Visible',1,'年假','2099-01-01','2099-01-03','EXTERNAL-SECRET')")
        conn.execute("INSERT INTO persons (id,name,selected) VALUES ('hidden','Hidden',0)")
        conn.execute("INSERT INTO projects (id,name,start_date,end_date,business_trip_persons) VALUES ('j','Project','2099-01-01','2099-01-31', ?)", (json.dumps(['p','hidden']),))
        for person in ['p', 'hidden']:
            conn.execute("INSERT INTO assignments (id,person_id,project_id,start_date,end_date) VALUES (?,?, 'j','2099-01-01','2099-01-02')", (person, person))
        for key in ['project_title','dept_color_前期美术','easyai_admin_password','dingtalk_configured','leave_sync_last_time']:
            conn.execute('INSERT INTO config VALUES (?,?)', (key, 'SENTINEL'))
        conn.commit()
        conn.close()
        result = self.client.get('/api/tv/data')
        self.assertEqual(result.status_code, 200)
        self.identity_get.assert_not_called()
        data = result.json
        public_id = dashboard.tv_person_id('p')
        self.assertEqual([p['id'] for p in data['persons']], [public_id])
        self.assertEqual(data['persons'][0]['leave_type'], '年假')
        self.assertEqual(data['persons'][0]['leave_end'], '2099-01-03')
        self.assertEqual([a['person_id'] for a in data['assignments']], [public_id])
        self.assertEqual(json.loads(data['projects'][0]['business_trip_persons']), [public_id])
        self.assertEqual(set(data['config']), {'project_title','dept_color_前期美术'})
        self.assertNotIn('EXTERNAL-SECRET', result.text)
        self.assertNotIn('hidden', result.text)

    def test_sse_contains_only_invalidation_and_old_channel_is_closed(self):
        result = self.client.get('/api/tv/events', buffered=False)
        try:
            next(result.response)
            dashboard.broadcast('persons_changed', {'secret': 'SENTINEL', 'id': 'PRIVATE'})
            event = next(result.response).decode()
            self.assertEqual(event, 'event: invalidate\ndata: {}\n\n')
        finally:
            result.close()
        self.assertEqual(self.client.get('/api/events').status_code, 401)
        self.assertEqual(self.client.get('/api/events', headers=self.headers).status_code, 404)

    def test_audit_uses_verified_visitor(self):
        with patch.object(dashboard, 'sync_all_projects', return_value={'success': True}) as sync:
            self.client.post('/api/project-sync/global/run', headers=self.headers, json={'operatorId': 'forged-admin'})
            self.assertEqual(sync.call_args.args[1], 'verified-user')
        with patch.object(dashboard, 'sync_project', return_value={'success': True}) as sync:
            with dashboard.app.test_request_context('/api/assignments'):
                from flask import g
                g.visitor = {'id': 'verified-user'}
                dashboard.sync_assignment_project('p', 'assignment_create')
            self.assertEqual(sync.call_args.args[3], 'verified-user')

    def test_health_static_and_same_origin(self):
        result = self.client.get('/health', headers={'Origin': 'https://untrusted.invalid'})
        self.assertEqual(result.json, {'status': 'ok'})
        self.assertNotIn('Access-Control-Allow-Origin', result.headers)
        for page in ['/tv.html','/admin.html','/dashboard.html']:
            with self.client.get(page) as page_response:
                self.assertEqual(page_response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
