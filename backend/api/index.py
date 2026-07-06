import json
import os
import hashlib
import psycopg2
import psycopg2.extras


RUB = 100
LIFETIME_CAP = 30
VOUCHERS_PER_BATCH = 5
POINTS_PER_AMOUNT = 1000  # 1 балл за каждую 1000 ₽ покупки
LIFETIME_SHARE = 0.1  # доля временных баллов, уходящая в пожизненные

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Seller-Id',
    'Access-Control-Max-Age': '86400',
}


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _resp(status: int, body: dict):
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'isBase64Encoded': False,
        'body': json.dumps(body, default=str),
    }


def _customer_dict(row) -> dict:
    return {
        'id': row['id'],
        'name': row['name'],
        'phone': row['phone'],
        'birth': str(row['birth']) if row['birth'] else '',
        'type': row['type'],
        'refId': row['ref_id'],
        'tempPoints': float(row['temp_points']),
        'lifePoints': float(row['life_points']),
        'vouchers': row['vouchers'],
        'purchases': row['purchases'],
        'joined': str(row['joined']),
        'productName': row['product_name'] or '',
        'purchaseAmount': float(row['purchase_amount']) if row['purchase_amount'] is not None else 0,
        'purchaseDate': str(row['purchase_date']) if row['purchase_date'] else '',
        'totalEarnedPoints': float(row['total_earned_points']) if 'total_earned_points' in row.keys() else 0,
        'invitedCount': row['invited_count'] if 'invited_count' in row.keys() else 0,
    }


def handler(event: dict, context) -> dict:
    '''Бэкенд CRM программы лояльности: вход продавца, покупатели, баллы, фиолки.'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    headers = event.get('headers', {})
    seller_id = headers.get('X-Seller-Id') or headers.get('x-seller-id')

    conn = _conn()
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        body = json.loads(event.get('body') or '{}')

        if method == 'POST' and action == 'login':
            email = (body.get('email') or '').strip().lower()
            password = body.get('password') or ''
            cur.execute("SELECT id, email, name, password_hash FROM sellers WHERE email = %s", (email,))
            seller = cur.fetchone()
            if not seller:
                return _resp(401, {'error': 'Продавец не найден'})
            ok = seller['password_hash'] == password or seller['password_hash'] == _hash(password)
            if not ok:
                return _resp(401, {'error': 'Неверный пароль'})
            return _resp(200, {'id': seller['id'], 'email': seller['email'], 'name': seller['name']})

        if method == 'POST' and action == 'register':
            email = (body.get('email') or '').strip().lower()
            password = body.get('password') or ''
            if '@' not in email or len(password) < 3:
                return _resp(400, {'error': 'Некорректный email или короткий пароль'})
            cur.execute("SELECT id FROM sellers WHERE email = %s", (email,))
            if cur.fetchone():
                return _resp(409, {'error': 'Продавец с таким email уже существует'})
            cur.execute(
                "INSERT INTO sellers (email, password_hash, name) VALUES (%s, %s, %s) RETURNING id, email, name",
                (email, _hash(password), body.get('name') or 'Продавец'),
            )
            seller = cur.fetchone()
            return _resp(200, {'id': seller['id'], 'email': seller['email'], 'name': seller['name']})

        if not seller_id:
            return _resp(401, {'error': 'Требуется авторизация'})
        seller_id = int(seller_id)

        if method == 'GET' and action == 'customer_detail':
            cid = params.get('id')
            if not cid:
                return _resp(400, {'error': 'Не указан id покупателя'})
            cur.execute(
                """SELECT c.*,
                          (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c WHERE c.id = %s AND c.seller_id = %s""",
                (int(cid), seller_id),
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            cur.execute(
                """SELECT c.*,
                          (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c WHERE c.ref_id = %s AND c.seller_id = %s ORDER BY c.id""",
                (int(cid), seller_id),
            )
            invited_rows = cur.fetchall()
            return _resp(200, {
                'customer': _customer_dict(row),
                'invited': [_customer_dict(r) for r in invited_rows],
            })

        if method == 'GET':
            cur.execute(
                """SELECT c.*,
                          (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c WHERE c.seller_id = %s ORDER BY c.id""",
                (seller_id,),
            )
            rows = cur.fetchall()
            return _resp(200, {'customers': [_customer_dict(r) for r in rows]})

        if method == 'POST' and action == 'add_customer':
            name = (body.get('name') or '').strip()
            phone = (body.get('phone') or '').strip()
            if not name or not phone:
                return _resp(400, {'error': 'Укажите Ф.И.О. и телефон'})
            birth = body.get('birth') or None
            ref_id = body.get('refId')
            ref_id = int(ref_id) if ref_id else None
            product_name = (body.get('productName') or '').strip() or None
            purchase_amount = body.get('purchaseAmount')
            purchase_amount = float(purchase_amount) if purchase_amount not in (None, '') else None
            purchase_date = body.get('purchaseDate') or None

            if ref_id:
                cur.execute(
                    "SELECT id FROM customers WHERE id = %s AND seller_id = %s",
                    (ref_id, seller_id),
                )
                if not cur.fetchone():
                    return _resp(400, {'error': 'Пригласивший покупатель не найден'})

                # Защита от закольцованных приглашений: поднимаемся по цепочке
                # "пригласил" вверх и проверяем, что она не зациклена
                cur.execute(
                    """WITH RECURSIVE chain AS (
                           SELECT id, ref_id, 1 AS depth FROM customers
                           WHERE id = %s AND seller_id = %s
                           UNION ALL
                           SELECT c.id, c.ref_id, chain.depth + 1
                           FROM customers c JOIN chain ON c.id = chain.ref_id
                           WHERE chain.depth < 1000
                       )
                       SELECT count(*) AS cnt, count(DISTINCT id) AS distinct_cnt FROM chain""",
                    (ref_id, seller_id),
                )
                chain_check = cur.fetchone()
                if chain_check['cnt'] != chain_check['distinct_cnt']:
                    return _resp(400, {'error': 'Обнаружена закольцованная цепочка приглашений'})

            # Фиолки выдаются любому зарегистрированному покупателю, совершившему покупку
            vouchers = VOUCHERS_PER_BATCH
            cur.execute(
                """INSERT INTO customers
                   (seller_id, name, phone, birth, type, ref_id, vouchers, product_name, purchase_amount, purchase_date)
                   VALUES (%s, %s, %s, %s, 'customer', %s, %s, %s, %s, COALESCE(%s, CURRENT_DATE)) RETURNING *""",
                (seller_id, name, phone, birth, ref_id, vouchers, product_name, purchase_amount, purchase_date),
            )
            new_row = cur.fetchone()

            notify = None
            earned_points = None
            if ref_id:
                cur.execute(
                    "SELECT name, temp_points, life_points, total_earned_points FROM customers WHERE id = %s AND seller_id = %s",
                    (ref_id, seller_id),
                )
                ref = cur.fetchone()
                if ref:
                    amount = purchase_amount or 0
                    earned_points = round(max(amount / POINTS_PER_AMOUNT, 1) if amount > 0 else 1, 1)
                    new_temp = round(float(ref['temp_points']) + earned_points, 1)
                    new_life = min(round(float(ref['life_points']) + earned_points * LIFETIME_SHARE, 1), LIFETIME_CAP)
                    new_total = round(float(ref['total_earned_points']) + earned_points, 1)
                    cur.execute(
                        "UPDATE customers SET temp_points = %s, life_points = %s, total_earned_points = %s WHERE id = %s",
                        (new_temp, new_life, new_total, ref_id),
                    )
                    notify = ref['name'].split(' ')[0]

            return _resp(200, {'customer': _customer_dict(new_row), 'notify': notify, 'earnedPoints': earned_points})

        if method == 'POST' and action == 'spend_voucher':
            cid = int(body.get('id'))
            cur.execute(
                "UPDATE customers SET vouchers = vouchers - 1 WHERE id = %s AND seller_id = %s AND vouchers > 0 RETURNING *",
                (cid, seller_id),
            )
            row = cur.fetchone()
            if not row:
                return _resp(400, {'error': 'Нет доступных фиолок'})
            return _resp(200, {'customer': _customer_dict(row)})

        return _resp(404, {'error': 'Неизвестное действие'})

    finally:
        cur.close()
        conn.close()