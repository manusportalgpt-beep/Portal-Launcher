# Portal Launcher

Полнофункциональный лаунчер Minecraft с поддержкой **всех версий** (от 1.7.10 до новейших снапшотов), модов, лоадеров, импорта из других лаунчеров и **облачной синхронизации аккаунтов**.

## Возможности

- ✅ **Аутентификация Microsoft** — Device Code Flow (код показывается в лаунчере)
- ✅ **Облачное хранилище токенов** — синхронизация между устройствами
- ✅ **Длительный срок входа** — refresh токены действительны 1 год!
- ✅ **Проверка лицензии** — автоматическая проверка владения Minecraft
- ✅ **Все версии Minecraft** — от 1.7.10 до последних снапшотов (включая 26w1.2)
- ✅ **Снапшоты по желанию** — отображаются только если включено в настройках
- ✅ **Лоадеры** — Fabric (1.14+), Forge (1.7.10+), Quilt (1.14+), NeoForge (1.20.1+)
- ✅ **Импорт сборок** — Modrinth App (.mrpack) и Prism Launcher (.zip)
- ✅ **Моды** — поддержка Modrinth и CurseForge, автообновление, зависимости
- ✅ **Инстансы** — изолированные сборки с настройками RAM и Java
- ✅ **Java Manager** — автозагрузка Java 8/16/17/21 (Azul Zulu / Temurin)
- ✅ **Папка PortalLauncher** — в %APPDATA% для совместимости
- ✅ **Глобальные моды** — общие моды для всех инстансов
- ✅ **Ресурс-паки и шейдеры** — полная поддержка

## Поддерживаемые версии

| Диапазон версий | Forge | Fabric | Quilt | NeoForge |
|----------------|-------|--------|-------|----------|
| 1.7.10 - 1.12.2 | ✅ | ❌ | ❌ | ❌ |
| 1.13 - 1.13.2 | ✅ | ❌ | ❌ | ❌ |
| 1.14 - 1.16.5 | ✅ | ✅ | ✅ | ❌ |
| 1.17 - 1.19.4 | ✅ | ✅ | ✅ | ❌ |
| 1.20.1+ | ✅ | ✅ | ✅ | ✅ |
| Снапшоты (26w1.2 и новее) | ❌ | ✅ | ✅ | ❌ |

## Импорт из других лаунчеров

### Modrinth App (.mrpack)
1. Экспортируйте сборку из Modrinth App в формате `.mrpack`
2. В Portal Launcher нажмите "Импорт" → "Import from .mrpack file"
3. Выберите файл `.mrpack`
4. Лаунчер автоматически:
   - Извлечёт моды и конфиги
   - Скачает все файлы модов
   - Настроит версию Minecraft и лоадер

### Prism Launcher (.zip)
1. В Prism Launcher экспортируйте инстанс в ZIP
2. В Portal Launcher нажмите "Импорт" → "Prism Launcher"
3. Выберите ZIP файл экспорта
4. Лаунчер автоматически:
   - Прочитает `instance.cfg` и `mmc-pack.json`
   - Извлечёт все файлы (моды, конфиги, ресурспаки)
   - Сохранит настройки RAM и Java

### Автообнаружение установленных лаунчеров
Лаунчер автоматически обнаружит установленные:
- Prism Launcher
- Modrinth App

И покажет доступные для импорта сборки в окне "Import Instance".

## Структура проекта

- `src/` — frontend на React + TypeScript
- `src-tauri/` — Rust backend с Tauri
- `PortalLauncher/` — данные лаунчера (в `%APPDATA%`)

## Требования

- **Node.js 18+** и npm/pnpm
- **Rust 1.77+** (установить с https://rustup.rs)
- **Windows 10/11** (также работает на Linux/macOS)

## Сборка и запуск

### 1. Установка зависимостей

```bash
npm install
```

### 2. Запуск в режиме разработки

```bash
npm run tauri dev
```

### 3. Сборка релизной версии

```bash
npm run tauri build
```

Релизные билды появятся в `src-tauri/target/release/bundle/`

## Расположение данных

```
%APPDATA%\PortalLauncher\
├── auth.json              # Microsoft токены
├── settings.json          # Настройки (вкл. show_snapshots)
├── instances/             # Инстансы
│   └── my-pack-abc123/
│       ├── instance.json
│       ├── mods/
│       ├── config/
│       ├── resourcepacks/
│       ├── shaderpacks/
│       ├── saves/
│       └── logs/
├── versions/              # Версии Minecraft
├── libraries/             # Библиотеки
├── assets/                # Ассеты
├── java/                  # Java runtime
├── mods/                  # Глобальные моды
├── resourcepacks/         # Глобальные ресурспаки
├── shaderpacks/           # Глобальные шейдеры
└── backups/               # Бэкапы
```

## Облачное хранилище токенов

### Длительный срок действия
- **Access токен**: 24 часа (автоматически обновляется)
- **Refresh токен**: **1 год** без необходимости повторного входа!
- **Автоматическое обновление**: лаунчер сам обновит токены до истечения

### Синхронизация между устройствами
Токены можно синхронизировать через:
- **Portal Cloud** (по умолчанию, локальное зашифрованное хранилище)
- **Google Drive** (требуется OAuth токен)
- **Dropbox** (требуется OAuth токен)
- **Локальный файл** (указанный путь)

### Безопасность
- ✅ Шифрование данных (XOR с SHA-256 ключом)
- ✅ Привязка к устройству
- ✅ Проверка владения аккаунтом (premium check)

### API команды

```typescript
// Сохранить текущий вход в облако
await invoke('save_auth_to_cloud');

// Загрузить из облака
const profile = await invoke('load_auth_from_cloud');

// Синхронизировать
await invoke('sync_auth_cloud');

// Проверить статус
const status = await invoke('get_cloud_sync_status');

// Установить провайдера
await invoke('set_cloud_provider', { 
  providerType: 'google', 
  accessToken: '...' 
});
```

## Настройки

### Показ снапшотов
В настройках включите `show_snapshots: true` чтобы видеть все снапшоты включая 26w1.2

```json
{
  "show_snapshots": true
}
```

## API Команды

### Версии
- `get_available_versions` — все версии (параметр `include_snapshots`)
- `get_filtered_versions` — версии с учётом настройки снапшотов
- `download_minecraft_version` — загрузить версию
- `delete_minecraft_version` — удалить версию

### Импорт
- `import_modrinth_pack` — импорт из .mrpack
- `import_prismlauncher_instance` — импорт из Prism ZIP
- `detect_prismlauncher_instances` — найти инстансы Prism
- `detect_modrinth_instances` — найти инстансы Modrinth App

### Аутентификация
- `start_device_code_flow` — начать вход (возвращает код)
- `poll_for_token` — проверить статус входа
- `get_cached_profile` — получить сохранённый профиль
- `clear_auth` — выйти
- `save_auth_to_cloud` — сохранить в облако
- `load_auth_from_cloud` — загрузить из облака
- `sync_auth_cloud` — синхронизировать
- `get_cloud_sync_status` — статус синхронизации
- `set_cloud_provider` — установить провайдера
- `delete_cloud_auth` — удалить облачные данные

### Инстансы
- `create_instance` — создать инстанс
- `get_instances` — список инстансов
- `launch_instance` — запустить
- `install_fabric/forge/quilt/neoforge` — установить лоадер

### Моды
- `search_mods` — поиск (Modrinth + CurseForge)
- `install_mod` — установить мод
- `get_instance_mods` — моды инстанса
- `check_mod_updates` — обновления
- `detect_mod_conflicts` — конфликты

### Настройки
- `get_setting` / `set_setting` — чтение/запись настроек
- `should_show_snapshots` — проверка настройки снапшотов

## Исправление ошибок

### Ошибка `alloc-no-stdlib`
```bash
cd src-tauri
rm Cargo.lock
cargo build
```

### Нет Java
Лаунчер автоматически загрузит Java нужной версии при первом запуске.

## Лицензия

MIT © Portal Team


## Игровые логи сборки

Окно **Игровые логи** показывает только вывод активной Minecraft-сборки: строки `stdout` и `stderr`, которые поступают от Java/Minecraft-процесса или поддерживаемого launch wrapper для выбранного `instance_id`. Действия пользователя в интерфейсе лаунчера, навигация, клики, импорт, обновление модов, состояние настроек и служебные UI-события в игровые логи не попадают.

Каждое live-событие `game-log` имеет источник `source: "minecraft"`, идентификатор сборки `instance_id`, PID процесса и канал `stream` (`stdout` или `stderr`). Frontend принимает событие только если оно относится к выбранной сборке и имеет источник Minecraft. События `launch-status`, `install-progress`, `download-progress` и `mod-progress` используются отдельными виджетами прогресса и не смешиваются с содержимым окна игровых логов.

Файл `latest.log` хранится внутри конкретной сборки:

```text
%APPDATA%\\PortalLauncher\\instances\\<instance-id>\\.minecraft\\logs\\latest.log
```

При запуске новый вывод Minecraft записывается в `latest.log`. Для диагностики также могут создаваться дополнительные журналы запуска в папке `.minecraft/logs`. В окне логов доступны фильтр по тексту, авто-прокрутка, копирование и очистка локального представления. Сам файл сборки не удаляется операцией очистки окна.

### Диагностика сбоя

При аварийном завершении Portal Launcher сохраняет последние строки игрового процесса, версию Minecraft, загрузчик и crash-report. Эти данные используются для локального анализа и могут быть отправлены в `mclo.gs` только после явного подтверждения пользователя. В отправляемый набор не должны входить события интерфейса лаунчера, токены, пароли и настройки аккаунта.

### Команды логов

- `launch_instance` — запускает выбранную сборку и публикует только её Minecraft stdout/stderr.
- `get_game_logs` — читает лог выбранной сборки из памяти текущего процесса или из её `latest.log`.
- `game-log` — live-событие только с `source: "minecraft"` и `instance_id`.
- `game-exited` — сообщает о завершении процесса выбранной сборки.
- `game-crashed` — передаёт диагностические данные только для завершившейся сборки.


## Quilt и Minecraft 26.2

Для Minecraft 26.x Portal Launcher выбирает **Java 25**. Это важно для class-file major version 69: Java 25 использует именно этот формат классов, а старые версии Quilt Loader/ASM могут его не разбирать.

При установке Quilt лаунчер теперь запрашивает loader builds для конкретной версии Minecraft через Quilt Meta, предпочитает стабильную сборку и не переиспользует старые `0.20.x–0.25.x` beta/alpha-профили для Minecraft 26.x. Для запуска также передаётся явный `--gameDir` изолированной сборки, чтобы Quilt не получил `null` вместо игровой директории.

Если сборка уже была установлена со старым профилем, откройте её настройки, выберите Quilt заново или очистите только loader-профиль этой сборки и выполните установку ещё раз. После завершения подготовки первый запуск может вернуть статус готовности; Minecraft запускается отдельным нажатием Launch.

В локальной среде этого проекта `cargo check` может остановиться до компиляции зависимостей из-за Cargo 1.75 и зависимости, использующей `edition2024`. Финальную Rust-проверку следует выполнять в GitHub Actions с актуальным stable Rust toolchain.

## Проверка

```bash
pnpm run build
pnpm tauri build
```

Для GitHub Actions используйте Rust stable и Node.js 18+; архив проекта не содержит `node_modules` или локальных build-кэшей.

## References

- [1] [Quilt Meta API](https://meta.quiltmc.org/)
- [2] [Fabric documentation: porting to Minecraft 26.2](https://docs.fabricmc.net/develop/porting/)
- [3] [Java class-file version reference](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html)
