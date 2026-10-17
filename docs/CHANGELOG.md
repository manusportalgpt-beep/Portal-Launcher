Обновлённый GitHub Pages сайт: динамическая кнопка загрузки (находит .exe или ZIP в latest release), локальные переводы RU/EN, страница-демо интерфейса, OG метатеги и opt-in для аналитики.

Пункты реализованные:
- docs/index.html — новая современная страница (RU + EN toggling)
- docs/style.css — улучшенные стили
- docs/app.js — динамика: fetch releases/latest, pick asset, wire download buttons, translations, analytics opt-in
- docs/demo.html — веб-демо интерфейса
- docs/logo.svg — простой логотип (оставлен прежним)
- docs/README.md — инструкция по деплою

Деплой:
1) Включить GitHub Pages: Branch main, Folder /docs
2) Подождать несколько минут — GitHub Pages сгенерирует сайт: https://manusportalgpt-beep.github.io/Portal-Launcher/

Примечания и ограничения:
- Нельзя запустить сам Tauri/NSIS инсталлятор в браузере — demo показывает тольк�� интерфейс.
- GitHub API может ограничивать unauthenticated requests — при проблемах с rate limit можно добавить Personal Access Token (встраивать на клиенте НЕ рекомендуется). Страница использует публичный API без аутентификации и старается корректно падать в fallback на страницу Releases.

Если хочешь — могу дополнительно:
- добавить real screenshots (путь к файлам в репо) вместо плейсхолдеров
- встроить видео/GIF
- улучшить английский перевод и добавить автоматическое определение языка браузера
