let granted = false;

export async function initNotifications(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') { granted = true; return; }
  if (Notification.permission !== 'denied') {
    const p = await Notification.requestPermission();
    granted = p === 'granted';
  }
}

export function notifyMessage(senderName: string, text: string, onClick?: () => void): void {
  if (!granted) return;
  if (document.hasFocus()) return;
  try {
    const n = new Notification(`💬 ${senderName}`, {
      body: text.length > 100 ? text.slice(0, 100) + '…' : text,
      icon: '/favicon.ico',
      tag: `portal-chat-${senderName}`,
      silent: false,
    });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    setTimeout(() => n.close(), 6000);
  } catch { /* unsupported */ }
}

export function notifyIncomingCall(callerName: string, onAccept: () => void): Notification | null {
  if (!granted) return null;
  try {
    const n = new Notification(`📞 ${callerName} is calling…`, {
      body: 'Click to answer',
      tag: 'portal-call',
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); onAccept(); n.close(); };
    return n;
  } catch { return null; }
}
