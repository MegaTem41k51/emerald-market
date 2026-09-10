# EMERALD Market — PostgreSQL на Render

Эта версия хранит пользователей и продажи в PostgreSQL, поэтому данные не пропадают при перезапуске сервиса Render.

## 1. Создай PostgreSQL

В Render создай **PostgreSQL** в том же аккаунте/регионе, где находится Web Service.

## 2. Подключи базу к Web Service

В настройках Web Service → **Environment** добавь переменную:

`DATABASE_URL`

Укажи Internal Database URL от созданной Render PostgreSQL.

Также должны оставаться:

- `STEAM_API_KEY`
- `SESSION_SECRET`
- `BASE_URL=https://emerald-market-2.onrender.com`

`SESSION_SECRET` лучше сделать длинной случайной строкой.

## 3. Deploy

После сохранения переменных сделай Manual Deploy / Deploy latest commit.

В логах после запуска должно появиться примерно:

`🗄️ PostgreSQL подключён. Пользователей: ...`

а затем:

`✅ EMERALD Market запущен`

## Что хранится

### users
- Steam ID — только для админки
- внутренний ID сайта
- имя Steam — только для админки
- аватар — только для админки
- Trade URL — только для админки
- дата регистрации
- последний вход
- количество входов
- сумма продаж
- сумма выплат
- настройки темы/анимации

### sales
- ID продажи
- ID пользователя через Steam ID
- дата
- сумма
- выплата
- метод выплаты
- список проданных предметов

Обычный пользователь через `/profile/ID` получает только публичный внутренний ID.
