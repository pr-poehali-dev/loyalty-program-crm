import json
import os
import secrets
import hashlib
import datetime as dt
import urllib.request
import urllib.parse
import psycopg2
import psycopg2.extras


RUB = 100
LIFETIME_CAP = 30
VOUCHERS_PER_BATCH = 5
POINTS_PER_REFERRAL = 1  # 1 балл (100 ₽) за каждого приведённого клиента, независимо от суммы его покупки
LIFETIME_SHARE = 0.1  # доля временных баллов, уходящая в пожизненные
BIRTHDAY_BONUS_AMOUNT = 200  # скидка в рублях к дню рождения
BIRTHDAY_NOTIFY_DAYS_BEFORE = 7  # за сколько дней до ДР отправлять SMS
BIRTHDAY_BONUS_WINDOW_DAYS = 10  # сколько календарных дней действует скидка с момента отправки SMS

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
    keys = row.keys()
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
        'totalEarnedPoints': float(row['total_earned_points']) if 'total_earned_points' in keys else 0,
        'invitedCount': row['invited_count'] if 'invited_count' in keys else 0,
        'sellerName': row['seller_name'] if 'seller_name' in keys else None,
        'sellerEmail': row['seller_email'] if 'seller_email' in keys else None,
        'registrationCompleted': row['registration_completed'] if 'registration_completed' in keys else False,
        'pointsRedeemed': row['points_redeemed'] if 'points_redeemed' in keys else False,
        'pointsRedeemedAmount': float(row['points_redeemed_amount']) if 'points_redeemed_amount' in keys else 0,
        'birthdayBonusNotifyDate': str(row['birthday_bonus_notify_date']) if row.get('birthday_bonus_notify_date') else None,
        'birthdayBonusUsedYear': row['birthday_bonus_used_year'] if 'birthday_bonus_used_year' in keys else None,
    }


def _send_sms(phone: str, text: str) -> bool:
    api_id = os.environ.get('SMSRU_API_ID')
    if not api_id:
        return False
    clean_phone = ''.join(ch for ch in phone if ch.isdigit())
    if len(clean_phone) == 11 and clean_phone.startswith('8'):
        clean_phone = '7' + clean_phone[1:]
    params = urllib.parse.urlencode({
        'api_id': api_id,
        'to': clean_phone,
        'msg': text,
        'json': 1,
    })
    try:
        req = urllib.request.Request(f'https://sms.ru/sms/send?{params}', method='GET')
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        return data.get('status') == 'OK'
    except Exception:
        return False


def _birthday_window(customer_row) -> dict:
    '''Возвращает статус ДР-бонуса: нужно ли уведомлять, действует ли скидка сейчас.'''
    birth = customer_row.get('birth')
    if not birth:
        return {'daysUntilBirthday': None, 'shouldNotify': False, 'bonusActive': False, 'bonusExpires': None}
    today = dt.date.today()
    try:
        next_birthday = birth.replace(year=today.year)
    except ValueError:
        next_birthday = birth.replace(year=today.year, day=28)
    if next_birthday < today:
        try:
            next_birthday = birth.replace(year=today.year + 1)
        except ValueError:
            next_birthday = birth.replace(year=today.year + 1, day=28)
    days_until = (next_birthday - today).days

    notify_date = customer_row.get('birthday_bonus_notify_date')
    bonus_active = False
    bonus_expires = None
    if notify_date:
        bonus_expires = notify_date + dt.timedelta(days=BIRTHDAY_BONUS_WINDOW_DAYS)
        used_year = customer_row.get('birthday_bonus_used_year')
        if today <= bonus_expires and used_year != next_birthday.year and used_year != (next_birthday.year - 1):
            bonus_active = True

    should_notify = (
        days_until == BIRTHDAY_NOTIFY_DAYS_BEFORE
        and (notify_date is None or notify_date.year != today.year)
    )

    return {
        'daysUntilBirthday': days_until,
        'shouldNotify': should_notify,
        'bonusActive': bonus_active,
        'bonusExpires': str(bonus_expires) if bonus_expires else None,
    }


def _seller_dict(row) -> dict:
    keys = row.keys()
    return {
        'id': row['id'],
        'email': row['email'],
        'name': row['name'],
        'role': row['role'],
        'status': row['status'],
        'invitedAt': str(row['invited_at']) if row.get('invited_at') else None,
        'activatedAt': str(row['activated_at']) if row.get('activated_at') else None,
        'customersCount': row['customers_count'] if 'customers_count' in keys else 0,
        'workingDays': row['working_days'] if 'working_days' in keys else 0,
    }


def handler(event: dict, context) -> dict:
    '''Бэкенд CRM программы лояльности: вход, роли (админ/продавец), приглашения, покупатели, баллы, фиолки.'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    headers = event.get('headers', {})
    seller_id_header = headers.get('X-Seller-Id') or headers.get('x-seller-id')

    conn = _conn()
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        body = json.loads(event.get('body') or '{}')

        if method == 'POST' and action == 'login':
            email = (body.get('email') or '').strip().lower()
            password = body.get('password') or ''
            cur.execute("SELECT id, email, name, password_hash, role, status FROM sellers WHERE email = %s", (email,))
            seller = cur.fetchone()
            if not seller:
                return _resp(401, {'error': 'Продавец не найден'})
            if seller['status'] == 'invited':
                return _resp(403, {'error': 'Учётная запись не активирована. Перейдите по ссылке-приглашению из письма'})
            if seller['status'] == 'blocked':
                return _resp(403, {'error': 'Учётная запись заблокирована'})
            ok = seller['password_hash'] == password or seller['password_hash'] == _hash(password)
            if not ok:
                return _resp(401, {'error': 'Неверный пароль'})
            return _resp(200, {'id': seller['id'], 'email': seller['email'], 'name': seller['name'], 'role': seller['role']})

        if method == 'GET' and action == 'invite_info':
            token = params.get('token') or ''
            cur.execute("SELECT email, name, status FROM sellers WHERE invite_token = %s", (token,))
            inv = cur.fetchone()
            if not inv:
                return _resp(404, {'error': 'Приглашение не найдено'})
            if inv['status'] != 'invited':
                return _resp(400, {'error': 'Приглашение уже использовано'})
            return _resp(200, {'email': inv['email'], 'name': inv['name']})

        if method == 'POST' and action == 'accept_invite':
            token = body.get('token') or ''
            password = body.get('password') or ''
            if len(password) < 3:
                return _resp(400, {'error': 'Пароль слишком короткий'})
            cur.execute("SELECT id, status FROM sellers WHERE invite_token = %s", (token,))
            inv = cur.fetchone()
            if not inv:
                return _resp(404, {'error': 'Приглашение не найдено'})
            if inv['status'] != 'invited':
                return _resp(400, {'error': 'Приглашение уже использовано'})
            cur.execute(
                """UPDATE sellers SET password_hash = %s, status = 'active', invite_token = NULL, activated_at = now()
                   WHERE id = %s RETURNING id, email, name, role""",
                (_hash(password), inv['id']),
            )
            seller = cur.fetchone()
            return _resp(200, {'id': seller['id'], 'email': seller['email'], 'name': seller['name'], 'role': seller['role']})

        if not seller_id_header:
            return _resp(401, {'error': 'Требуется авторизация'})
        seller_id = int(seller_id_header)

        cur.execute("SELECT id, role, status FROM sellers WHERE id = %s", (seller_id,))
        current = cur.fetchone()
        if not current:
            return _resp(401, {'error': 'Требуется авторизация'})
        if current['status'] == 'blocked':
            return _resp(403, {'error': 'Учётная запись заблокирована'})
        is_admin = current['role'] == 'admin'

        if method == 'POST' and action == 'change_password':
            old_password = body.get('oldPassword') or ''
            new_password = body.get('newPassword') or ''
            if len(new_password) < 3:
                return _resp(400, {'error': 'Новый пароль слишком короткий'})
            cur.execute("SELECT password_hash FROM sellers WHERE id = %s", (seller_id,))
            seller = cur.fetchone()
            ok = seller['password_hash'] == old_password or seller['password_hash'] == _hash(old_password)
            if not ok:
                return _resp(401, {'error': 'Текущий пароль указан неверно'})
            cur.execute("UPDATE sellers SET password_hash = %s WHERE id = %s", (_hash(new_password), seller_id))
            return _resp(200, {'ok': True})

        # ---- Админские действия ----
        if action == 'invite_seller':
            if not is_admin:
                return _resp(403, {'error': 'Доступно только администратору'})
            email = (body.get('email') or '').strip().lower()
            name = (body.get('name') or '').strip() or 'Продавец'
            if '@' not in email:
                return _resp(400, {'error': 'Некорректный email'})
            cur.execute("SELECT id FROM sellers WHERE email = %s", (email,))
            if cur.fetchone():
                return _resp(409, {'error': 'Продавец с таким email уже существует'})
            token = secrets.token_urlsafe(24)
            placeholder_hash = _hash(secrets.token_hex(16))
            cur.execute(
                """INSERT INTO sellers (email, password_hash, name, role, status, invite_token, invited_at)
                   VALUES (%s, %s, %s, 'seller', 'invited', %s, now()) RETURNING id""",
                (email, placeholder_hash, name, token),
            )
            new_id = cur.fetchone()['id']
            return _resp(200, {'id': new_id, 'email': email, 'name': name, 'inviteToken': token})

        if method == 'GET' and action == 'list_sellers':
            date_from = params.get('dateFrom') or None
            date_to = params.get('dateTo') or None
            cur.execute(
                """SELECT s.*,
                          (SELECT COUNT(*) FROM customers c WHERE c.seller_id = s.id
                            AND (%(date_from)s::date IS NULL OR c.joined >= %(date_from)s::date)
                            AND (%(date_to)s::date IS NULL OR c.joined <= %(date_to)s::date)) AS customers_count,
                          (SELECT COUNT(DISTINCT c.joined) FROM customers c WHERE c.seller_id = s.id
                            AND (%(date_from)s::date IS NULL OR c.joined >= %(date_from)s::date)
                            AND (%(date_to)s::date IS NULL OR c.joined <= %(date_to)s::date)) AS working_days
                   FROM sellers s ORDER BY s.id""",
                {'date_from': date_from, 'date_to': date_to},
            )
            rows = cur.fetchall()
            return _resp(200, {'sellers': [_seller_dict(r) for r in rows]})

        if method == 'POST' and action == 'set_seller_status':
            if not is_admin:
                return _resp(403, {'error': 'Доступно только администратору'})
            target_id = int(body.get('id'))
            new_status = body.get('status')
            if new_status not in ('active', 'blocked'):
                return _resp(400, {'error': 'Некорректный статус'})
            if target_id == seller_id:
                return _resp(400, {'error': 'Нельзя изменить статус самому себе'})
            cur.execute(
                "UPDATE sellers SET status = %s WHERE id = %s AND role = 'seller' RETURNING id",
                (new_status, target_id),
            )
            if not cur.fetchone():
                return _resp(404, {'error': 'Продавец не найден'})
            return _resp(200, {'ok': True})

        if method == 'DELETE' and action == 'delete_customer':
            if not is_admin:
                return _resp(403, {'error': 'Доступно только администратору'})
            cid = params.get('id')
            if not cid:
                return _resp(400, {'error': 'Не указан id покупателя'})
            cid = int(cid)
            cur.execute("SELECT id FROM customers WHERE id = %s", (cid,))
            if not cur.fetchone():
                return _resp(404, {'error': 'Покупатель не найден'})
            cur.execute("UPDATE customers SET ref_id = NULL WHERE ref_id = %s", (cid,))
            cur.execute("DELETE FROM customers WHERE id = %s", (cid,))
            return _resp(200, {'ok': True})

        if method == 'GET' and action == 'all_customers':
            cur.execute(
                """SELECT c.*, s.name AS seller_name, s.email AS seller_email,
                          (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c JOIN sellers s ON s.id = c.seller_id
                   ORDER BY c.id"""
            )
            rows = cur.fetchall()
            return _resp(200, {'customers': [_customer_dict(r) for r in rows]})

        # ---- Общие действия продавца (база покупателей общая для всех продавцов) ----
        if method == 'GET' and action == 'customer_detail':
            cid = params.get('id')
            if not cid:
                return _resp(400, {'error': 'Не указан id покупателя'})
            cur.execute(
                """SELECT c.*, (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c WHERE c.id = %s""",
                (int(cid),),
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            cur.execute(
                """SELECT c.*, (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c WHERE c.ref_id = %s ORDER BY c.id""",
                (int(cid),),
            )
            invited_rows = cur.fetchall()
            return _resp(200, {
                'customer': _customer_dict(row),
                'invited': [_customer_dict(r) for r in invited_rows],
            })

        if method == 'POST' and action == 'complete_registration':
            cid = int(body.get('id'))
            cur.execute("SELECT id, seller_id FROM customers WHERE id = %s", (cid,))
            target = cur.fetchone()
            if not target:
                return _resp(404, {'error': 'Покупатель не найден'})
            cur.execute(
                "UPDATE customers SET registration_completed = true WHERE id = %s RETURNING *",
                (cid,),
            )
            row = cur.fetchone()
            return _resp(200, {'customer': _customer_dict(row)})

        if method == 'POST' and action == 'edit_customer':
            cid = int(body.get('id'))
            cur.execute("SELECT * FROM customers WHERE id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            if row['registration_completed'] and not is_admin:
                return _resp(403, {'error': 'Регистрация завершена, редактирование доступно только администратору'})

            name = (body.get('name') or row['name']).strip()
            phone = (body.get('phone') or row['phone']).strip()
            if not name or not phone:
                return _resp(400, {'error': 'Укажите Ф.И.О. и телефон'})
            birth = body.get('birth') if 'birth' in body else (str(row['birth']) if row['birth'] else None)
            birth = birth or None
            product_name = (body.get('productName').strip() if body.get('productName') is not None else row['product_name']) or None
            purchase_amount = body.get('purchaseAmount')
            if purchase_amount is None and 'purchaseAmount' not in body:
                purchase_amount = float(row['purchase_amount']) if row['purchase_amount'] is not None else None
            else:
                purchase_amount = float(purchase_amount) if purchase_amount not in (None, '') else None
            purchase_date = body.get('purchaseDate') if body.get('purchaseDate') else (str(row['purchase_date']) if row['purchase_date'] else None)

            new_ref_id = body.get('refId') if 'refId' in body else row['ref_id']
            new_ref_id = int(new_ref_id) if new_ref_id else None
            if new_ref_id == cid:
                return _resp(400, {'error': 'Покупатель не может пригласить самого себя'})

            if new_ref_id:
                cur.execute("SELECT id FROM customers WHERE id = %s", (new_ref_id,))
                if not cur.fetchone():
                    return _resp(400, {'error': 'Пригласивший покупатель не найден'})
                cur.execute(
                    """WITH RECURSIVE chain AS (
                           SELECT id, ref_id, 1 AS depth FROM customers
                           WHERE id = %s
                           UNION ALL
                           SELECT c.id, c.ref_id, chain.depth + 1
                           FROM customers c JOIN chain ON c.id = chain.ref_id
                           WHERE chain.depth < 1000
                       )
                       SELECT count(*) AS cnt, count(DISTINCT id) AS distinct_cnt FROM chain""",
                    (new_ref_id,),
                )
                chain_check = cur.fetchone()
                if chain_check['cnt'] != chain_check['distinct_cnt']:
                    return _resp(400, {'error': 'Обнаружена закольцованная цепочка приглашений'})

            old_ref_id = row['ref_id']
            old_given = float(row['earned_points_given'])

            # Откатываем ранее начисленные баллы старому пригласившему
            if old_ref_id and old_given > 0:
                cur.execute("SELECT temp_points, life_points, total_earned_points FROM customers WHERE id = %s", (old_ref_id,))
                old_ref = cur.fetchone()
                if old_ref:
                    reverted_temp = max(round(float(old_ref['temp_points']) - old_given, 1), 0)
                    reverted_life = max(round(float(old_ref['life_points']) - old_given * LIFETIME_SHARE, 1), 0)
                    reverted_total = max(round(float(old_ref['total_earned_points']) - old_given, 1), 0)
                    cur.execute(
                        "UPDATE customers SET temp_points = %s, life_points = %s, total_earned_points = %s WHERE id = %s",
                        (reverted_temp, reverted_life, reverted_total, old_ref_id),
                    )

            # Начисляем баллы новому пригласившему (если указан)
            new_given = 0.0
            notify = None
            if new_ref_id:
                cur.execute("SELECT name, temp_points, life_points, total_earned_points FROM customers WHERE id = %s", (new_ref_id,))
                new_ref = cur.fetchone()
                if new_ref:
                    new_given = POINTS_PER_REFERRAL
                    new_temp = round(float(new_ref['temp_points']) + new_given, 1)
                    new_life = min(round(float(new_ref['life_points']) + new_given * LIFETIME_SHARE, 1), LIFETIME_CAP)
                    new_total = round(float(new_ref['total_earned_points']) + new_given, 1)
                    cur.execute(
                        "UPDATE customers SET temp_points = %s, life_points = %s, total_earned_points = %s WHERE id = %s",
                        (new_temp, new_life, new_total, new_ref_id),
                    )
                    notify = new_ref['name'].split(' ')[0]

            cur.execute(
                """UPDATE customers SET name = %s, phone = %s, birth = %s, ref_id = %s,
                          product_name = %s, purchase_amount = %s, purchase_date = COALESCE(%s, purchase_date),
                          earned_points_given = %s
                   WHERE id = %s RETURNING *""",
                (name, phone, birth, new_ref_id, product_name, purchase_amount, purchase_date, new_given, cid),
            )
            updated = cur.fetchone()
            return _resp(200, {'customer': _customer_dict(updated), 'notify': notify, 'earnedPoints': new_given or None})

        if method == 'GET':
            cur.execute(
                """SELECT c.*, s.name AS seller_name, s.email AS seller_email,
                          (SELECT COUNT(*) FROM customers r WHERE r.ref_id = c.id) AS invited_count
                   FROM customers c JOIN sellers s ON s.id = c.seller_id
                   ORDER BY c.id"""
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
                cur.execute("SELECT id FROM customers WHERE id = %s", (ref_id,))
                if not cur.fetchone():
                    return _resp(400, {'error': 'Пригласивший покупатель не найден'})

                # Защита от закольцованных приглашений: поднимаемся по цепочке
                # "пригласил" вверх и проверяем, что она не зациклена
                cur.execute(
                    """WITH RECURSIVE chain AS (
                           SELECT id, ref_id, 1 AS depth FROM customers
                           WHERE id = %s
                           UNION ALL
                           SELECT c.id, c.ref_id, chain.depth + 1
                           FROM customers c JOIN chain ON c.id = chain.ref_id
                           WHERE chain.depth < 1000
                       )
                       SELECT count(*) AS cnt, count(DISTINCT id) AS distinct_cnt FROM chain""",
                    (ref_id,),
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
                    "SELECT name, temp_points, life_points, total_earned_points FROM customers WHERE id = %s",
                    (ref_id,),
                )
                ref = cur.fetchone()
                if ref:
                    earned_points = POINTS_PER_REFERRAL
                    new_temp = round(float(ref['temp_points']) + earned_points, 1)
                    new_life = min(round(float(ref['life_points']) + earned_points * LIFETIME_SHARE, 1), LIFETIME_CAP)
                    new_total = round(float(ref['total_earned_points']) + earned_points, 1)
                    cur.execute(
                        "UPDATE customers SET temp_points = %s, life_points = %s, total_earned_points = %s WHERE id = %s",
                        (new_temp, new_life, new_total, ref_id),
                    )
                    cur.execute(
                        "UPDATE customers SET earned_points_given = %s WHERE id = %s",
                        (earned_points, new_row['id']),
                    )
                    notify = ref['name'].split(' ')[0]

            return _resp(200, {'customer': _customer_dict(new_row), 'notify': notify, 'earnedPoints': earned_points})

        if method == 'POST' and action == 'spend_voucher':
            cid = int(body.get('id'))
            cur.execute(
                "UPDATE customers SET vouchers = vouchers - 1 WHERE id = %s AND vouchers > 0 RETURNING *",
                (cid,),
            )
            row = cur.fetchone()
            if not row:
                return _resp(400, {'error': 'Нет доступных фиолок'})
            return _resp(200, {'customer': _customer_dict(row)})

        if method == 'POST' and action == 'redeem_points':
            cid = int(body.get('id'))
            amount = body.get('amount')
            try:
                amount = round(float(amount), 1)
            except (TypeError, ValueError):
                return _resp(400, {'error': 'Укажите корректную сумму списания'})
            if amount <= 0:
                return _resp(400, {'error': 'Сумма списания должна быть больше нуля'})

            cur.execute("SELECT * FROM customers WHERE id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            if row['points_redeemed']:
                return _resp(409, {'error': 'Баллы за эту покупку уже списаны'})
            if amount > float(row['temp_points']):
                return _resp(400, {'error': 'Недостаточно временных баллов для списания'})

            new_temp = round(float(row['temp_points']) - amount, 1)
            cur.execute(
                """UPDATE customers SET temp_points = %s, points_redeemed = true, points_redeemed_amount = %s
                   WHERE id = %s RETURNING *""",
                (new_temp, amount, cid),
            )
            updated = cur.fetchone()
            return _resp(200, {'customer': _customer_dict(updated)})

        if method == 'GET' and action == 'birthday_bonuses':
            cur.execute(
                """SELECT c.*, s.name AS seller_name, s.email AS seller_email
                   FROM customers c JOIN sellers s ON s.id = c.seller_id
                   WHERE c.birth IS NOT NULL ORDER BY c.id"""
            )
            rows = cur.fetchall()
            today = dt.date.today()
            result = []
            auto_sent = 0
            for r in rows:
                info = _birthday_window(r)
                if info['daysUntilBirthday'] is None:
                    continue
                # Автоматическая отправка SMS за BIRTHDAY_NOTIFY_DAYS_BEFORE дней до ДР при заходе в систему
                if info['shouldNotify']:
                    text = f"{r['name'].split(' ')[0]}, с наступающим Днём рождения! Дарим скидку {BIRTHDAY_BONUS_AMOUNT} ₽ на покупку в течение {BIRTHDAY_BONUS_WINDOW_DAYS} дней."
                    if _send_sms(r['phone'], text):
                        cur.execute(
                            "UPDATE customers SET birthday_bonus_notify_date = %s WHERE id = %s RETURNING *",
                            (today, r['id']),
                        )
                        r = cur.fetchone()
                        info = _birthday_window(r)
                        auto_sent += 1
                if info['daysUntilBirthday'] <= BIRTHDAY_NOTIFY_DAYS_BEFORE or info['bonusActive']:
                    item = _customer_dict(r)
                    item.update({
                        'daysUntilBirthday': info['daysUntilBirthday'],
                        'shouldNotify': info['shouldNotify'],
                        'bonusActive': info['bonusActive'],
                        'bonusExpires': info['bonusExpires'],
                    })
                    result.append(item)
            result.sort(key=lambda x: x['daysUntilBirthday'])
            return _resp(200, {'customers': result, 'bonusAmount': BIRTHDAY_BONUS_AMOUNT, 'autoSent': auto_sent})

        if method == 'POST' and action == 'send_birthday_sms':
            cid = int(body.get('id'))
            cur.execute("SELECT * FROM customers WHERE id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            today = dt.date.today()
            text = f"{row['name'].split(' ')[0]}, с наступающим Днём рождения! Дарим скидку {BIRTHDAY_BONUS_AMOUNT} ₽ на покупку в течение {BIRTHDAY_BONUS_WINDOW_DAYS} дней."
            sent = _send_sms(row['phone'], text)
            if not sent:
                return _resp(502, {'error': 'Не удалось отправить SMS. Проверьте баланс и ключ SMS.ru'})
            cur.execute(
                "UPDATE customers SET birthday_bonus_notify_date = %s WHERE id = %s RETURNING *",
                (today, cid),
            )
            updated = cur.fetchone()
            return _resp(200, {'customer': _customer_dict(updated)})

        if method == 'POST' and action == 'use_birthday_bonus':
            cid = int(body.get('id'))
            cur.execute("SELECT * FROM customers WHERE id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Покупатель не найден'})
            info = _birthday_window(row)
            if not info['bonusActive']:
                return _resp(400, {'error': 'Скидка ко дню рождения сейчас не активна'})
            used_year = dt.date.today().year if row['birthday_bonus_notify_date'] is None else row['birthday_bonus_notify_date'].year
            cur.execute(
                "UPDATE customers SET birthday_bonus_used_year = %s WHERE id = %s RETURNING *",
                (used_year, cid),
            )
            updated = cur.fetchone()
            return _resp(200, {'customer': _customer_dict(updated)})

        return _resp(404, {'error': 'Неизвестное действие'})

    finally:
        cur.close()
        conn.close()