import os
import sqlite3
import json
import time
import queue
import threading
from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context, make_response
from flask_cors import CORS
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

PORT = int(os.getenv('PORT', 5000))
DB_PATH = os.path.join(os.path.dirname(__file__), 'claw.db')

# SSE 订阅者队列
sse_clients = []
sse_lock = threading.Lock()

# ==================== 数据库初始化 ====================

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        color TEXT DEFAULT '#1890ff',
        business_trip INTEGER DEFAULT 0,
        business_trip_start TEXT DEFAULT '',
        business_trip_end TEXT DEFAULT '',
        business_trip_persons TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS persons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_type TEXT DEFAULT 'pre',
        avatar TEXT DEFAULT '',
        ding_id TEXT DEFAULT '',
        department TEXT DEFAULT '',
        selected INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        leave_status TEXT DEFAULT '',
        leave_start TEXT DEFAULT '',
        leave_end TEXT DEFAULT '',
        leave_type TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    # assignments: 人员-项目关联，每个人员在项目中有独立起止日期
    c.execute('''CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    )''')

    # 数据库迁移：确保现有表有必要的字段
    try:
        # 检查并添加 persons 表的 leave_type 字段
        c.execute("PRAGMA table_info(persons)")
        columns = [row[1] for row in c.fetchall()]
        if 'leave_type' not in columns:
            c.execute("ALTER TABLE persons ADD COLUMN leave_type TEXT DEFAULT ''")
            print('[DB] Added leave_type column to persons table')
    except Exception as e:
        print(f'[DB] Migration warning: {e}')

    conn.commit()
    conn.close()
    print('[DB] Database initialized:', DB_PATH)

# ==================== SSE 广播 ====================

def broadcast(event_type, data):
    msg = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with sse_lock:
        dead = []
        for q in sse_clients:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            sse_clients.remove(q)

@app.route('/api/events')
def sse_stream():
    def generate():
        q = queue.Queue()
        with sse_lock:
            sse_clients.append(q)
        try:
            yield "data: connected\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except queue.Empty:
                    yield ": ping\n\n"
        except GeneratorExit:
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

# ==================== 项目 API ====================

@app.route('/api/projects', methods=['GET'])
def get_projects():
    conn = get_db()
    rows = conn.execute('SELECT * FROM projects ORDER BY start_date').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/projects', methods=['POST'])
def create_project():
    data = request.json
    pid = data.get('id') or str(int(time.time() * 1000))
    business_trip_persons = data.get('businessTripPersons', '[]')
    if isinstance(business_trip_persons, list):
        business_trip_persons = json.dumps(business_trip_persons)
    conn = get_db()
    conn.execute(
        'INSERT OR REPLACE INTO projects (id, name, start_date, end_date, color, business_trip, business_trip_start, business_trip_end, business_trip_persons) VALUES (?,?,?,?,?,?,?,?,?)',
        (pid, data['name'], data['startDate'], data['endDate'], data.get('color', '#1890ff'),
         data.get('businessTrip', 0), data.get('businessTripStart', ''), data.get('businessTripEnd', ''), business_trip_persons)
    )
    conn.commit()
    conn.close()
    broadcast('projects_changed', {'action': 'create', 'id': pid})
    return jsonify({'success': True, 'id': pid})

@app.route('/api/projects/<pid>', methods=['PUT'])
def update_project(pid):
    data = request.json
    conn = get_db()
    
    # 构建更新字段
    updates = []
    params = []
    
    if 'name' in data:
        updates.append('name=?')
        params.append(data['name'])
    if 'startDate' in data:
        updates.append('start_date=?')
        params.append(data['startDate'])
    if 'endDate' in data:
        updates.append('end_date=?')
        params.append(data['endDate'])
    if 'color' in data:
        updates.append('color=?')
        params.append(data['color'])
    if 'businessTrip' in data:
        updates.append('business_trip=?')
        params.append(data['businessTrip'])
    if 'businessTripStart' in data:
        updates.append('business_trip_start=?')
        params.append(data['businessTripStart'])
    if 'businessTripEnd' in data:
        updates.append('business_trip_end=?')
        params.append(data['businessTripEnd'])
    if 'businessTripPersons' in data:
        bt_persons = data['businessTripPersons']
        if isinstance(bt_persons, list):
            bt_persons = json.dumps(bt_persons)
        updates.append('business_trip_persons=?')
        params.append(bt_persons)
    
    if updates:
        params.append(pid)
        sql = f"UPDATE projects SET {','.join(updates)} WHERE id=?"
        conn.execute(sql, params)
    
    conn.commit()
    conn.close()
    broadcast('projects_changed', {'action': 'update', 'id': pid})
    return jsonify({'success': True})

@app.route('/api/projects/<pid>', methods=['DELETE'])
def delete_project(pid):
    conn = get_db()
    conn.execute('DELETE FROM assignments WHERE project_id=?', (pid,))
    conn.execute('DELETE FROM projects WHERE id=?', (pid,))
    conn.commit()
    conn.close()
    broadcast('projects_changed', {'action': 'delete', 'id': pid})
    return jsonify({'success': True})

# ==================== 人员 API ====================

@app.route('/api/persons', methods=['GET'])
def get_persons():
    conn = get_db()
    rows = conn.execute('SELECT * FROM persons ORDER BY group_type, sort_order, name').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/persons', methods=['POST'])
def create_person():
    data = request.json
    # 使用钉钉ID作为主键，如果没有则生成时间戳ID
    pid = data.get('dingId') or data.get('id') or str(int(time.time() * 1000))
    
    conn = get_db()
    
    # 先查询是否存在该人员
    existing = conn.execute('SELECT * FROM persons WHERE id = ?', (pid,)).fetchone()
    
    if existing:
        # 存在则更新（保留请假状态等原有数据，只更新基本信息）
        conn.execute('''
            UPDATE persons SET 
                name = ?,
                group_type = ?,
                avatar = ?,
                ding_id = ?,
                department = ?,
                selected = ?
            WHERE id = ?
        ''', (
            data['name'],
            data.get('groupType', 'pre'),
            data.get('avatar', ''),
            data.get('dingId', ''),
            data.get('department', ''),
            1 if data.get('selected') else 0,
            pid
        ))
    else:
        # 不存在则插入
        conn.execute('''
            INSERT INTO persons (id, name, group_type, avatar, ding_id, department, selected, sort_order, leave_status, leave_start, leave_end, leave_type)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ''', (
            pid, data['name'], data.get('groupType', 'pre'), data.get('avatar', ''),
            data.get('dingId', ''), data.get('department', ''),
            1 if data.get('selected') else 0, data.get('sortOrder', 0),
            data.get('leaveStatus', ''), data.get('leaveStart', ''), data.get('leaveEnd', ''),
            data.get('leaveType', '')
        ))
    
    conn.commit()
    conn.close()
    broadcast('persons_changed', {'action': 'create', 'id': pid})
    return jsonify({'success': True, 'id': pid})

@app.route('/api/persons/<pid>', methods=['PUT'])
def update_person(pid):
    data = request.json
    conn = get_db()
    conn.execute(
        'UPDATE persons SET name=?, group_type=?, avatar=?, ding_id=?, department=?, selected=?, sort_order=?, leave_status=?, leave_start=?, leave_end=?, leave_type=? WHERE id=?',
        (data['name'], data.get('groupType', 'pre'), data.get('avatar', ''),
         data.get('dingId', ''), data.get('department', ''),
         1 if data.get('selected') else 0, data.get('sortOrder', 0),
         data.get('leaveStatus', ''), data.get('leaveStart', ''), data.get('leaveEnd', ''),
         data.get('leaveType', ''), pid)
    )
    conn.commit()
    conn.close()
    broadcast('persons_changed', {'action': 'update', 'id': pid})
    return jsonify({'success': True})

@app.route('/api/persons/<pid>', methods=['DELETE'])
def delete_person(pid):
    conn = get_db()
    conn.execute('DELETE FROM assignments WHERE person_id=?', (pid,))
    conn.execute('DELETE FROM persons WHERE id=?', (pid,))
    conn.commit()
    conn.close()
    broadcast('persons_changed', {'action': 'delete', 'id': pid})
    return jsonify({'success': True})

# ==================== 分配 API ====================

@app.route('/api/assignments', methods=['GET'])
def get_assignments():
    conn = get_db()
    rows = conn.execute('''
        SELECT a.*, p.name as person_name, p.group_type, pr.name as project_name, pr.color as project_color
        FROM assignments a
        JOIN persons p ON a.person_id = p.id
        JOIN projects pr ON a.project_id = pr.id
        ORDER BY a.start_date
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/assignments', methods=['POST'])
def create_assignment():
    data = request.json
    # 使用UUID确保唯一ID，加上时间戳后缀
    import uuid
    aid = str(int(time.time() * 1000)) + '-' + str(uuid.uuid4())[:8]
    conn = get_db()
    try:
        # 允许同一人员同一项目有多个时间段，直接插入新记录
        conn.execute(
            'INSERT INTO assignments (id, project_id, person_id, start_date, end_date) VALUES (?,?,?,?,?)',
            (aid, data['projectId'], data['personId'], data['startDate'], data['endDate'])
        )
        conn.commit()
        print(f"[CREATE] 新建分配: id={aid}, project={data['projectId']}, person={data['personId']}, {data['startDate']} ~ {data['endDate']}")
        
        # 验证插入成功
        count = conn.execute('SELECT COUNT(*) FROM assignments WHERE id=?', (aid,)).fetchone()[0]
        print(f"[CREATE] 验证: id={aid} 在数据库中的记录数: {count}")
    except Exception as e:
        print(f"[CREATE] 错误: {e}")
        conn.rollback()
        raise e
    finally:
        conn.close()
    
    broadcast('assignments_changed', {'action': 'create', 'id': aid})
    return jsonify({'success': True, 'id': aid})

@app.route('/api/assignments/<aid>', methods=['PUT'])
def update_assignment(aid):
    data = request.json
    conn = get_db()
    conn.execute(
        'UPDATE assignments SET start_date=?, end_date=? WHERE id=?',
        (data['startDate'], data['endDate'], aid)
    )
    conn.commit()
    conn.close()
    broadcast('assignments_changed', {'action': 'update', 'id': aid})
    return jsonify({'success': True})

@app.route('/api/assignments/<aid>', methods=['DELETE'])
def delete_assignment(aid):
    conn = get_db()
    conn.execute('DELETE FROM assignments WHERE id=?', (aid,))
    conn.commit()
    conn.close()
    broadcast('assignments_changed', {'action': 'delete', 'id': aid})
    return jsonify({'success': True})

# ==================== 配置 API ====================

@app.route('/api/config', methods=['GET'])
def get_config():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM config').fetchall()
    conn.close()
    return jsonify({r['key']: r['value'] for r in rows})

@app.route('/api/config', methods=['POST'])
def save_config():
    data = request.json
    conn = get_db()
    for key, value in data.items():
        conn.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)', (key, str(value)))
    conn.commit()
    conn.close()
    broadcast('config_changed', {'action': 'update'})
    return jsonify({'success': True})

# ==================== 钉钉 API ====================

@app.route('/api/dingtalk/test', methods=['POST'])
def test_dingtalk():
    data = request.json
    app_key = data.get('appKey')
    app_secret = data.get('appSecret')
    if not app_key or not app_secret:
        return jsonify({"success": False, "message": "请提供 AppKey 和 AppSecret"})
    try:
        # 使用旧版接口获取token
        url = "https://oapi.dingtalk.com/gettoken"
        response = requests.get(url, params={"appkey": app_key, "appsecret": app_secret}, timeout=10)
        result = response.json()
        if result.get('errcode', 0) == 0:
            return jsonify({"success": True, "message": "连接成功"})
        return jsonify({"success": False, "message": result.get('errmsg', '未知错误')})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})

@app.route('/api/dingtalk/users', methods=['POST'])
def get_dingtalk_users():
    data = request.json
    app_key = data.get('appKey')
    app_secret = data.get('appSecret')
    dept_ids = data.get('deptIds', [])
    
    if not app_key or not app_secret:
        return jsonify({"success": False, "message": "请提供 AppKey 和 AppSecret"})
    
    try:
        # ========== Step 1: 获取 AccessToken ==========
        url = "https://oapi.dingtalk.com/gettoken"
        response = requests.get(url, params={"appkey": app_key, "appsecret": app_secret}, timeout=10)
        token_data = response.json()
        
        if token_data.get('errcode', 0) != 0:
            return jsonify({"success": False, "message": "获取Token失败: " + token_data.get('errmsg', '未知错误')})
        
        token = token_data['access_token']
        print(f"[DingTalk] 获取Token成功")
        
        all_users = []
        dept_info = {}  # dept_id -> {name, users}
        
        # ========== Step 2: 递归获取所有子部门 ==========
        def get_all_subdepts(parent_id, token):
            """递归获取所有子部门ID"""
            all_ids = []
            try:
                resp = requests.post(
                    "https://oapi.dingtalk.com/topapi/v2/department/listsub",
                    params={"access_token": token},
                    json={"dept_id": int(parent_id)},
                    timeout=10
                )
                result = resp.json()
                if result.get('errcode', 0) == 0:
                    sub_depts = result.get('result', [])
                    for d in sub_depts:
                        sub_id = str(d.get('dept_id'))
                        sub_name = d.get('name', '')
                        all_ids.append({'id': sub_id, 'name': sub_name})
                        # 递归获取子部门的子部门
                        all_ids.extend(get_all_subdepts(sub_id, token))
            except Exception as e:
                print(f"[DingTalk] 获取子部门失败: {e}")
            return all_ids
        
        def get_dept_name(dept_id, token):
            """获取部门名称"""
            try:
                resp = requests.get(
                    "https://oapi.dingtalk.com/topapi/v2/department/get",
                    params={"access_token": token},
                    json={"dept_id": int(dept_id)},
                    timeout=10
                )
                result = resp.json()
                if result.get('errcode', 0) == 0:
                    return result.get('result', {}).get('name', '')
            except Exception as e:
                print(f"[DingTalk] 获取部门名称失败: {e}")
            return ''
        
        # 如果没有指定部门，获取根部门下所有子部门
        if not dept_ids:
            print(f"[DingTalk] 获取所有子部门...")
            # 先获取根部门名称
            root_name = get_dept_name('1', token)
            dept_ids = [{'id': '1', 'name': root_name}]
            # 获取根部门的所有子部门（递归）
            sub_depts = get_all_subdepts('1', token)
            dept_ids.extend(sub_depts)
        else:
            # 指定了部门ID，获取这些部门的信息
            dept_ids = [{'id': str(d), 'name': get_dept_name(str(d), token)} for d in dept_ids]
        
        print(f"[DingTalk] 共找到 {len(dept_ids)} 个部门")
        
        # ========== Step 3: 遍历所有部门获取人员 ==========
        seen_users = set()  # 用于去重
        
        for dept in dept_ids:
            dept_id = dept['id']
            dept_name = dept['name']
            
            try:
                print(f"[DingTalk] 查询部门 {dept_id} ({dept_name}) 的人员...")
                
                # 使用分页获取所有人员
                cursor = 0
                has_more = True
                dept_user_count = 0
                
                while has_more:
                    resp = requests.post(
                        "https://oapi.dingtalk.com/topapi/v2/user/list",
                        params={"access_token": token},
                        json={"dept_id": int(dept_id), "cursor": cursor, "size": 100},
                        timeout=10
                    )
                    result = resp.json()
                    
                    if result.get('errcode', 0) != 0:
                        print(f"[DingTalk] 获取部门 {dept_id} 人员失败: {result.get('errmsg')}")
                        break
                    
                    user_list = result.get('result', {}).get('list', [])
                    has_more = result.get('result', {}).get('has_more', False)
                    cursor = result.get('result', {}).get('next_cursor', 0) + 1
                    
                    for u in user_list:
                        user_id = u.get('userid')
                        if user_id and user_id not in seen_users:
                            seen_users.add(user_id)
                            all_users.append({
                                "id": user_id,
                                "dingId": user_id,
                                "name": u.get('name'),
                                "avatar": u.get('avatar', ''),
                                "department": dept_name,
                                "deptId": dept_id,
                                "title": u.get('title', '')
                            })
                            dept_user_count += 1
                    
                    if not has_more:
                        break
                
                print(f"[DingTalk] 部门 {dept_id} ({dept_name}) 获取到 {dept_user_count} 人")
                        
            except Exception as e:
                print(f"[DingTalk] 处理部门 {dept_id} 时出错: {e}")
                continue
        
        print(f"[DingTalk] 最终获取人员数: {len(all_users)}")
        print(f"[DingTalk] 人员列表预览: {all_users[:5] if len(all_users) > 5 else all_users}")
        
        return jsonify({"success": True, "data": all_users})
    except Exception as e:
        print(f"[DingTalk] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)})

@app.route('/api/leave/sync', methods=['POST'])
def sync_leave():
    """同步请假状态 - 从钉钉获取请假数据"""
    data = request.json
    app_key = data.get('appKey')
    app_secret = data.get('appSecret')
    # 默认同步未来30天
    days = int(data.get('days', 30))
    
    if not app_key or not app_secret:
        return jsonify({"success": False, "message": "请提供 AppKey 和 AppSecret"})
    
    try:
        # 使用旧版API获取AccessToken（旧版请假API需要旧版token）
        url = "https://oapi.dingtalk.com/gettoken"
        response = requests.get(url, params={"appkey": app_key, "appsecret": app_secret}, timeout=10)
        result = response.json()
        
        if result.get('errcode', 0) != 0:
            return jsonify({"success": False, "message": f"获取Token失败: {result.get('errmsg', '未知错误')}"})
        
        token = result['access_token']
        print(f"[Leave Sync] 获取Token成功")
        
        conn = get_db()
        db_persons = conn.execute('SELECT * FROM persons').fetchall()
        
        # 计算日期范围 - 毫秒时间戳
        from datetime import datetime, timedelta
        today = datetime.today()
        today_zero = datetime(today.year, today.month, today.day, 0, 0, 0)
        start_time_ms = int(today_zero.timestamp() * 1000)
        end_time_ms = int((today_zero + timedelta(days=days)).timestamp() * 1000)
        
        updated = 0
        skipped = 0
        errors = []
        
        # 收集所有钉钉用户ID（分批处理，每批最多50个）
        ding_ids = []
        for person in db_persons:
            if person['ding_id']:
                ding_ids.append(person['ding_id'])
        
        if not ding_ids:
            return jsonify({"success": True, "message": "没有可同步的人员", "updated": 0, "skipped": 0})
        
        # 请假类型名称映射
        leave_type_map = {
            'ANNUAL_LEAVE': '年假',
            'SICK_LEAVE': '病假',
            'PERSONAL_LEAVE': '事假',
            'MARRIAGE_LEAVE': '婚假',
            'MATERNITY_LEAVE': '产假',
            'PATERNITY_LEAVE': '陪产假',
            'FUNERAL_LEAVE': '丧假',
            'HOME_LEAVE': '探亲假',
            'ABROAD_LEAVE': '出国假',
            'OFFSET_LEAVE': '调休',
            'COMPENSATORY_LEAVE': '补休',
            'UNPAID_LEAVE': '无薪假',
            '1': '请假',
            '2': '调休',
            '3': '年假',
            '4': '病假',
            '5': '事假',
        }
        
        # 逐个查询用户请假状态
        for person in db_persons:
            ding_id = person['ding_id']
            if not ding_id:
                skipped += 1
                continue
            
            try:
                # 使用旧版请假状态API
                leave_url = f"https://oapi.dingtalk.com/topapi/attendance/getleavestatus?access_token={token}"
                params = {
                    "userid_list": ding_id,  # 字符串类型
                    "start_time": start_time_ms,
                    "end_time": end_time_ms,
                    "offset": 0,
                    "size": 20
                }
                
                resp = requests.post(leave_url, json=params, timeout=10)
                leave_result = resp.json()
                print(f"[Leave Sync] {person['name']} 响应: {leave_result}")
                
                if leave_result.get('errcode') == 0:
                    leave_list = leave_result.get('result', {}).get('leave_status', []) or []
                    
                    if leave_list and len(leave_list) > 0:
                        # 取最新的请假记录（按结束时间排序）
                        leave_list.sort(key=lambda x: x.get('end_time', 0), reverse=True)
                        record = leave_list[0]
                        
                        leave_type = str(record.get('leave_type', ''))
                        leave_type_name = leave_type_map.get(leave_type, leave_type or '请假')
                        
                        # 解析时间戳（毫秒转日期）
                        start_ts = record.get('start_time', 0)
                        end_ts = record.get('end_time', 0)
                        start_date = time.strftime('%Y-%m-%d', time.localtime(start_ts / 1000)) if start_ts else ''
                        end_date = time.strftime('%Y-%m-%d', time.localtime(end_ts / 1000)) if end_ts else ''
                        
                        print(f"[Leave Sync] {person['name']}: {leave_type_name} {start_date} ~ {end_date}")
                        
                        # 更新数据库
                        conn.execute('''
                            UPDATE persons SET
                                leave_status = ?,
                                leave_start = ?,
                                leave_end = ?,
                                leave_type = ?
                            WHERE id = ?
                        ''', (leave_type_name, start_date, end_date, leave_type_name, person['id']))
                        updated += 1
                    # 如果无请假记录，保留现有数据（不清空）
                else:
                    err_msg = leave_result.get('errmsg', '未知错误')
                    print(f"[Leave Sync] {person['name']} 查询失败: {err_msg}")
                    errors.append(f"{person['name']}: {err_msg}")
                        
            except Exception as e:
                errors.append(f"{person['name']}: {str(e)}")
                print(f"[Leave Sync] {person['name']} 处理异常: {e}")
        
        conn.commit()
        conn.close()
        
        # 记录同步时间到数据库
        import math
        sync_time_ms = str(int(time.time() * 1000))
        conn2 = get_db()
        conn2.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)', 
                      ('leave_sync_last_time', sync_time_ms))
        conn2.commit()
        conn2.close()
        
        # 广播更新
        broadcast('persons_changed', {'action': 'batch_update'})
        
        message = f"同步完成: 更新 {updated} 人, 跳过 {skipped} 人(无钉钉ID)"
        if errors:
            message += f", 失败 {len(errors)} 人"
        
        print(f"[Leave Sync] {message}")
        return jsonify({
            "success": True, 
            "updated": updated,
            "skipped": skipped,
            "message": message,
            "errors": errors[:5]
        })
        
    except Exception as e:
        print(f"[Leave Sync] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/leave/clear', methods=['POST'])
def clear_leave():
    """清空所有请假状态"""
    try:
        conn = get_db()
        conn.execute('''
            UPDATE persons SET 
                leave_status = '', 
                leave_start = '', 
                leave_end = '',
                leave_type = ''
        ''')
        conn.commit()
        conn.close()
        broadcast('persons_changed', {'action': 'batch_update'})
        return jsonify({"success": True, "message": "已清空所有请假状态"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/leave/set', methods=['POST'])
def set_leave():
    """手动设置人员请假状态"""
    data = request.json
    person_id = data.get('personId')
    leave_status = data.get('leaveStatus', '')
    leave_start = data.get('leaveStart', '')
    leave_end = data.get('leaveEnd', '')
    leave_type = data.get('leaveType', '')
    
    if not person_id:
        return jsonify({"success": False, "message": "缺少人员ID"})
    
    try:
        conn = get_db()
        conn.execute('''
            UPDATE persons SET 
                leave_status = ?, 
                leave_start = ?, 
                leave_end = ?,
                leave_type = ?
            WHERE id = ?
        ''', (leave_status, leave_start, leave_end, leave_type, person_id))
        conn.commit()
        conn.close()
        broadcast('persons_changed', {'action': 'update', 'id': person_id})
        return jsonify({"success": True, "message": "请假状态已更新"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/export', methods=['GET'])
def export_data():
    """导出所有数据为JSON"""
    try:
        conn = get_db()
        projects = conn.execute('SELECT * FROM projects ORDER BY start_date').fetchall()
        persons = conn.execute('SELECT * FROM persons ORDER BY group_type, name').fetchall()
        assignments = conn.execute('SELECT * FROM assignments ORDER BY start_date').fetchall()
        config = conn.execute('SELECT * FROM config').fetchall()
        conn.close()
        
        data = {
            'export_time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'projects': [dict(p) for p in projects],
            'persons': [dict(p) for p in persons],
            'assignments': [dict(a) for a in assignments],
            'config': {c['key']: c['value'] for c in config}
        }
        
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/export/csv', methods=['GET'])
def export_persons_csv():
    """导出人员数据为CSV"""
    try:
        conn = get_db()
        persons = conn.execute('SELECT * FROM persons ORDER BY group_type, name').fetchall()
        conn.close()

        import csv
        import io

        output = io.StringIO()
        # 添加UTF-8 BOM，解决Excel打开中文乱码问题
        output.write('\ufeff')
        writer = csv.writer(output)

        # 写入表头
        writer.writerow(['ID', '姓名', '部门', '钉钉ID', '分组', '头像', '请假状态', '请假开始', '请假结束', '请假类型'])

        # 写入数据
        for p in persons:
            writer.writerow([
                p['id'],
                p['name'],
                p['department'],
                p['ding_id'],
                p['group_type'],
                p['avatar'],
                p['leave_status'],
                p['leave_start'],
                p['leave_end'],
                p['leave_type']
            ])

        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename=persons.csv'}
        )
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/leave/schedule', methods=['POST'])
def set_leave_schedule():
    """设置请假同步定时任务"""
    data = request.json
    interval_hours = data.get('intervalHours', 4)  # 默认4小时
    enabled = data.get('enabled', True)
    
    try:
        conn = get_db()
        conn.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)', 
                    ('leave_sync_interval', str(interval_hours)))
        conn.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)', 
                    ('leave_sync_enabled', '1' if enabled else '0'))
        conn.commit()
        conn.close()
        
        # 更新全局变量（下次定时任务会读取新配置）
        global leave_sync_interval, leave_sync_enabled
        leave_sync_interval = interval_hours
        leave_sync_enabled = enabled
        
        return jsonify({
            "success": True, 
            "message": f"定时同步已{'开启' if enabled else '关闭'}，间隔 {interval_hours} 小时"
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.route('/api/leave/schedule', methods=['GET'])
def get_leave_schedule():
    """获取请假同步定时任务配置"""
    try:
        conn = get_db()
        rows = conn.execute('SELECT key, value FROM config WHERE key LIKE "leave_sync_%"').fetchall()
        conn.close()
        config = {r['key']: r['value'] for r in rows}
        return jsonify({
            "intervalHours": int(config.get('leave_sync_interval', 4)),
            "enabled": config.get('leave_sync_enabled', '1') == '1',
            "lastSyncTime": int(config.get('leave_sync_last_time', 0))
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})

@app.route('/api/sync/leave', methods=['POST'])
def manual_sync_leave():
    """手动触发请假同步"""
    conn = get_db()
    config = {r['key']: r['value'] for r in conn.execute('SELECT key, value FROM config').fetchall()}
    conn.close()
    
    app_key = config.get('ding_appKey')
    app_secret = config.get('ding_appSecret')
    
    if not app_key or not app_secret:
        return jsonify({"success": False, "message": "请先配置钉钉 AppKey 和 AppSecret"})
    
    return sync_dingtalk_leave_internal(app_key, app_secret)

def sync_dingtalk_leave_internal(app_key, app_secret):
    """内部函数：同步钉钉请假状态"""
    try:
        url = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
        response = requests.post(url, json={"appKey": app_key, "appSecret": app_secret}, timeout=10)
        token = response.json()['accessToken']
        
        conn = get_db()
        persons = conn.execute('SELECT * FROM persons').fetchall()
        
        today_str = time.strftime('%Y-%m-%d')
        tomorrow_str = time.strftime('%Y-%m-%d', time.localtime(time.time() + 86400))
        
        updated = 0
        for person in persons:
            if not person['ding_id']:
                continue
            
            # 清空请假状态（实际应用中需要调用真实API）
            conn.execute(
                'UPDATE persons SET leave_status=?, leave_start=?, leave_end=? WHERE id=?',
                ('', '', '', person['id'])
            )
            updated += 1
        
        # 记录同步时间
        sync_time_ms = str(int(time.time() * 1000))
        conn.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)',
                     ('leave_sync_last_time', sync_time_ms))
        
        conn.commit()
        conn.close()
        broadcast('persons_changed', {'action': 'batch_update'})
        return {"success": True, "updated": updated, "message": f"已同步 {updated} 人员请假状态"}
    except Exception as e:
        return {"success": False, "message": str(e)}

# 全局定时任务配置
leave_sync_interval = 4  # 小时
leave_sync_enabled = True

def schedule_leave_sync():
    """定时同步请假状态"""
    global leave_sync_interval, leave_sync_enabled
    while True:
        if leave_sync_enabled:
            try:
                conn = get_db()
                config = {r['key']: r['value'] for r in conn.execute('SELECT key, value FROM config').fetchall()}
                conn.close()
                
                # 读取配置
                interval = int(config.get('leave_sync_interval', 4))
                enabled = config.get('leave_sync_enabled', '1') == '1'
                
                leave_sync_interval = interval
                leave_sync_enabled = enabled
                
                if enabled:
                    app_key = config.get('ding_appKey')
                    app_secret = config.get('ding_appSecret')
                    
                    if app_key and app_secret:
                        print(f"[AutoSync] 开始定时同步请假状态...")
                        result = sync_leave_internal(app_key, app_secret)
                        print(f"[AutoSync] Leave sync result: {result}")
            except Exception as e:
                print(f"[AutoSync] Error: {e}")
        
        # 读取最新配置作为休眠时间
        sleep_seconds = leave_sync_interval * 3600
        time.sleep(sleep_seconds)

def sync_leave_internal(app_key, app_secret):
    """内部函数：同步请假状态（供定时任务调用）"""
    try:
        # 使用新版API获取AccessToken
        url = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
        response = requests.post(url, json={"appKey": app_key, "appSecret": app_secret}, timeout=10)
        result = response.json()
        
        if 'accessToken' not in result:
            return {"success": False, "message": f"获取Token失败"}
        
        token = result['accessToken']
        
        conn = get_db()
        persons = conn.execute('SELECT * FROM persons').fetchall()
        
        # 同步未来30天
        today = time.strftime('%Y-%m-%d')
        future_date = time.strftime('%Y-%m-%d', time.localtime(time.time() + 30 * 86400))
        
        updated = 0
        
        for person in persons:
            if not person['ding_id']:
                continue
            
            try:
                leave_url = "https://api.dingtalk.com/v1.0/attendance/leaveRecords/byUser"
                headers = {"x-acs-dingtalk-access-token": token}
                params = {
                    "userId": person['ding_id'],
                    "startDate": today,
                    "endDate": future_date
                }
                
                resp = requests.post(leave_url, headers=headers, json=params, timeout=10)
                leave_result = resp.json()
                
                if leave_result.get('code') == 0 and leave_result.get('result'):
                    records = leave_result['result'].get('leaveRecordList', [])
                    
                    if records and len(records) > 0:
                        record = records[0]
                        leave_type = record.get('leaveTypeName', '请假')
                        start_date = record.get('startTime', '')[:10] if record.get('startTime') else ''
                        end_date = record.get('endTime', '')[:10] if record.get('endTime') else ''
                        
                        conn.execute('''
                            UPDATE persons SET 
                                leave_status = ?, 
                                leave_start = ?, 
                                leave_end = ?,
                                leave_type = ?
                            WHERE id = ?
                        ''', (leave_type, start_date, end_date, leave_type, person['id']))
                        updated += 1
                    else:
                        conn.execute('''
                            UPDATE persons SET 
                                leave_status = '', 
                                leave_start = '', 
                                leave_end = '',
                                leave_type = ''
                            WHERE id = ?
                        ''', (person['id'],))
                else:
                    conn.execute('''
                        UPDATE persons SET 
                            leave_status = '', 
                            leave_start = '', 
                            leave_end = '',
                            leave_type = ''
                        WHERE id = ?
                    ''', (person['id'],))
                    
            except Exception as e:
                print(f"[Leave] {person['name']} 处理失败: {e}")
        
        conn.commit()
        conn.close()
        
        # 记录同步时间
        conn2 = get_db()
        sync_time_ms = str(int(time.time() * 1000))
        conn2.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)',
                      ('leave_sync_last_time', sync_time_ms))
        conn2.commit()
        conn2.close()
        
        broadcast('persons_changed', {'action': 'batch_update'})
        return {"success": True, "message": f"已同步 {updated} 人"}
        
    except Exception as e:
        return {"success": False, "message": str(e)}

# 启动定时任务线程
import threading
sync_thread = threading.Thread(target=schedule_leave_sync, daemon=True)
sync_thread.start()

# ==================== 静态文件 ====================

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    response = make_response(send_from_directory('static', path))
    # 禁用静态文件缓存，确保浏览器加载最新版本
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'db': DB_PATH})

# ==================== 启动 ====================

if __name__ == '__main__':
    init_db()
    
    # 启动时自动同步一次请假信息
    def startup_sync_leave():
        """启动时自动同步请假信息（使用与手动同步相同的API）"""
        try:
            # 延迟10秒后再同步，等待数据库和应用完全初始化
            print("[Startup] 10秒后将执行首次请假同步...")
            time.sleep(10)
            
            conn = get_db()
            config = {r['key']: r['value'] for r in conn.execute('SELECT key, value FROM config').fetchall()}
            db_persons = conn.execute('SELECT * FROM persons').fetchall()
            conn.close()
            
            app_key = config.get('ding_appKey')
            app_secret = config.get('ding_appSecret')
            
            if app_key and app_secret:
                print("[Startup] 检测到钉钉配置，开始首次同步请假信息...")
                
                # 使用与 /api/leave/sync 相同的API（钉钉旧版API）
                try:
                    # Step 1: 获取Token（使用旧版API）
                    token_url = "https://oapi.dingtalk.com/gettoken"
                    token_resp = requests.get(token_url, params={"appkey": app_key, "appsecret": app_secret}, timeout=10)
                    token_result = token_resp.json()
                    
                    if token_result.get('errcode', 0) != 0:
                        print(f"[Startup] ✗ 获取Token失败: {token_result.get('errmsg', '未知错误')}")
                        return
                    
                    token = token_result['access_token']
                    print(f"[Startup] 获取Token成功")
                    
                    # Step 2: 计算日期范围
                    from datetime import datetime, timedelta
                    today = datetime.today()
                    today_zero = datetime(today.year, today.month, today.day, 0, 0, 0)
                    start_time_ms = int(today_zero.timestamp() * 1000)
                    end_time_ms = int((today_zero + timedelta(days=30)).timestamp() * 1000)
                    
                    # 请假类型名称映射
                    leave_type_map = {
                        'ANNUAL_LEAVE': '年假', 'SICK_LEAVE': '病假', 'PERSONAL_LEAVE': '事假',
                        'MARRIAGE_LEAVE': '婚假', 'MATERNITY_LEAVE': '产假', 'PATERNITY_LEAVE': '陪产假',
                        'FUNERAL_LEAVE': '丧假', 'HOME_LEAVE': '探亲假', 'ABROAD_LEAVE': '出国假',
                        'OFFSET_LEAVE': '调休', 'COMPENSATORY_LEAVE': '补休', 'UNPAID_LEAVE': '无薪假',
                        '1': '请假', '2': '调休', '3': '年假', '4': '病假', '5': '事假',
                    }
                    
                    updated = 0
                    skipped = 0
                    
                    for person in db_persons:
                        ding_id = person['ding_id']
                        if not ding_id:
                            skipped += 1
                            continue
                        
                        try:
                            # 使用旧版请假状态API
                            leave_url = f"https://oapi.dingtalk.com/topapi/attendance/getleavestatus?access_token={token}"
                            params = {
                                "userid_list": ding_id,
                                "start_time": start_time_ms,
                                "end_time": end_time_ms,
                                "offset": 0,
                                "size": 20
                            }
                            
                            resp = requests.post(leave_url, json=params, timeout=10)
                            leave_result = resp.json()
                            
                            if leave_result.get('errcode') == 0:
                                leave_list = leave_result.get('result', {}).get('leave_status', []) or []
                                
                                if leave_list and len(leave_list) > 0:
                                    leave_list.sort(key=lambda x: x.get('end_time', 0), reverse=True)
                                    record = leave_list[0]
                                    
                                    leave_type = str(record.get('leave_type', ''))
                                    leave_type_name = leave_type_map.get(leave_type, leave_type or '请假')
                                    start_ts = record.get('start_time', 0)
                                    end_ts = record.get('end_time', 0)
                                    start_date = time.strftime('%Y-%m-%d', time.localtime(start_ts / 1000)) if start_ts else ''
                                    end_date = time.strftime('%Y-%m-%d', time.localtime(end_ts / 1000)) if end_ts else ''
                                    
                                    # 更新数据库
                                    conn2 = get_db()
                                    conn2.execute('''
                                        UPDATE persons SET leave_status = ?, leave_start = ?, leave_end = ?, leave_type = ?
                                        WHERE id = ?
                                    ''', (leave_type_name, start_date, end_date, leave_type_name, person['id']))
                                    conn2.commit()
                                    conn2.close()
                                    updated += 1
                        except Exception as e:
                            print(f"[Startup] {person['name']} 处理异常: {e}")
                    
                    print(f"[Startup] ✓ 请假信息同步成功！共更新 {updated} 人, 跳过 {skipped} 人(无钉钉ID)")
                    
                    # 记录同步时间
                    conn3 = get_db()
                    sync_time_ms = str(int(time.time() * 1000))
                    conn3.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)',
                                  ('leave_sync_last_time', sync_time_ms))
                    conn3.commit()
                    conn3.close()
                    
                    # 广播更新
                    broadcast('persons_changed', {'action': 'batch_update'})
                    
                except Exception as e:
                    print(f"[Startup] ✗ 请假同步出错: {e}")
            else:
                print("[Startup] 未配置钉钉，跳过首次请假同步")
        except Exception as e:
            print(f"[Startup] 首次请假同步出错（不影响启动）: {e}")
    
    # 在后台线程执行首次同步，不阻塞启动
    import threading
    sync_thread = threading.Thread(target=startup_sync_leave, daemon=True)
    sync_thread.start()
    
    print(f"\n{'='*60}")
    print(f"[START] Claw Dashboard running...")
    print(f"{'='*60}")
    print(f"  Address:  http://localhost:{PORT}")
    print(f"  Dashboard: http://localhost:{PORT}/dashboard.html")
    print(f"  Admin:    http://localhost:{PORT}/admin.html")
    print(f"  API:      http://localhost:{PORT}/api/")
    print(f"  DB:       {DB_PATH}")
    print(f"{'='*60}")
    print(f"  Features:")
    print(f"  - SQLite Database (multi-device sync)")
    print(f"  - SSE Real-time Updates")
    print(f"  - Auto Leave Sync (every 4 hours)")
    print(f"  - Startup Auto-Sync (first sync on launch)")
    print(f"{'='*60}\n")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
