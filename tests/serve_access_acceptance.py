"""Loopback-only manual browser fixture. All upstream traffic is forbidden.

Run: .venv/Scripts/python.exe tests/serve_access_acceptance.py
Synthetic tokens: operator, operator-new, manager, admin, user, expired, unavailable.
This fixture does not add a bypass switch to the production application.
"""
import os
import sys
import tempfile
from datetime import date, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import app
import access_control


def visitor(token):
    if token == 'unavailable':
        raise access_control.IdentityError(503)
    if token not in ('operator', 'operator-new', 'manager', 'admin', 'user'):
        raise access_control.IdentityError(401)
    role = 'operator' if token == 'operator-new' else token
    return {'id': 'visitor-' + role, 'roles': [role]}


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as directory:
        app.DB_PATH = os.path.join(directory, 'acceptance.db')
        app.init_db()
        conn = app.get_db()
        today = date.today().isoformat()
        end = (date.today() + timedelta(days=7)).isoformat()
        conn.execute("INSERT INTO projects (id,name,start_date,end_date) VALUES ('demo','权限验收项目',?,?)", (today, end))
        conn.execute("INSERT INTO persons (id,name,selected,leave_type,leave_start,leave_end) VALUES ('person','验收人员',1,'年假',?,?)", (today, end))
        conn.execute("INSERT INTO assignments (id,project_id,person_id,start_date,end_date) VALUES ('a','demo','person',?,?)", (today, end))
        conn.commit()
        conn.close()
        with patch('access_control.verify_identity', side_effect=visitor), patch(
                'requests.sessions.Session.request', side_effect=RuntimeError('Acceptance server prohibits upstream traffic')):
            app.app.run(host='127.0.0.1', port=5011, threaded=True, use_reloader=False)
