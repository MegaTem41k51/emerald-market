# Email и Render

Для отправки кодов подтверждения используется Resend HTTPS API. SMTP-порты Render для этой функции не нужны.

## Environment в Render

Оставьте:

- `BASE_URL` — текущий публичный URL сайта Render
- `DATABASE_URL` — Internal Database URL PostgreSQL
- `SESSION_SECRET` — ваш секрет сессии
- `STEAM_API_KEY` — ваш Steam API key

Добавьте:

- `RESEND_API_KEY` — API key из Resend
- `EMAIL_FROM` — подтверждённый адрес отправителя в Resend
- `EMAIL_FROM_NAME` — например `EMERALD Market`

Старые SMTP-переменные `EMAIL_HOST`, `EMAIL_PASS`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER` этой версией не требуются.

## Email verification

- обычное подтверждение отправляет 6-значный код;
- код действует 10 минут;
- после успешного подтверждения `email_verified` остаётся TRUE и не истекает;
- кнопка меняется на `Отвязать`;
- отвязка требует отдельного 6-значного кода, отправленного на уже подтверждённую почту;
- письмо для отвязки сообщает, что код нужен для действия «удаление email».

## Онлайн

Сайт отправляет heartbeat каждые 30 секунд. Сервер хранит активность браузеров в PostgreSQL и считает посетителя онлайн, если его heartbeat был не более 90 секунд назад. Один браузер использует один visitor ID через localStorage.

После изменения Environment сделайте redeploy.
