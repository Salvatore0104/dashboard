"""Visitor authentication. Never uses the synchronization administrator credentials."""
import requests
from flask import g, jsonify, request

IDENTITY_URL = 'https://wowidea.top/api/auth/self'
ALLOWED_ROLES = frozenset({'operator', 'manager', 'admin'})
PUBLIC_API = frozenset({'/api/tv/data', '/api/tv/events'})


class IdentityError(Exception):
    def __init__(self, status):
        self.status = status


def verify_identity(token):
    try:
        response = requests.get(IDENTITY_URL, headers={'Authorization': 'Bearer ' + token},
                                timeout=(3, 8), allow_redirects=False)
        if response.status_code in (401, 403):
            raise IdentityError(401)
        if response.status_code != 200:
            raise IdentityError(503)
        payload = response.json()
        identity = payload.get('data', payload)
        if not isinstance(identity, dict):
            raise IdentityError(503)
        if identity.get('status', 0) != 0:
            raise IdentityError(401)
        user_id = identity.get('_id') or identity.get('id')
        roles = identity.get('role')
        if not isinstance(user_id, str) or not user_id.strip() or not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
            raise IdentityError(503)
        return {'id': str(user_id), 'roles': roles}
    except (requests.RequestException, ValueError, AttributeError):
        raise IdentityError(503) from None


def install_access_control(app):
    @app.before_request
    def authorize():
        if not request.path.startswith('/api/'):
            return
        if request.path in PUBLIC_API and request.method in ('GET', 'HEAD'):
            return
        scheme, _, token = request.headers.get('Authorization', '').partition(' ')
        if scheme.lower() != 'bearer' or not token.strip() or any(c.isspace() for c in token):
            return jsonify(error='identity_unavailable'), 401
        try:
            identity = verify_identity(token)
        except IdentityError as error:
            return jsonify(error='identity_unavailable'), error.status
        if not ALLOWED_ROLES.intersection(identity['roles']):
            return jsonify(error='access_denied'), 403
        g.visitor = identity

    @app.after_request
    def private_response(response):
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/access')
    def access():
        return jsonify(user={'id': g.visitor['id']}, canManage=True)
