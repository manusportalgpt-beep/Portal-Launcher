import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';

/**
 * Вход в Microsoft.
 *
 * Способ выбора убран: остался только рабочий вход по коду подтверждения
 * (MicrosoftAuthOAuth) — он вызывается без изменений. OAuth через браузер
 * удалён, потому что требовал ручной Client ID/Redirect URI и путал вход.
 */
export function MicrosoftAuthChoice({ onSuccess, onCancel }: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  return <MicrosoftAuthOAuth onSuccess={onSuccess} onCancel={onCancel} />;
}

export default MicrosoftAuthChoice;
