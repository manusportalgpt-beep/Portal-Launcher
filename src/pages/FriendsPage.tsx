import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  UserPlus, Phone, PhoneOff, Mic, MicOff, Send, Paperclip,
  X, Check, CheckCheck, Clock, Trash2, Copy,
  Users, Search, Play, Server, Wifi, FileText, Volume2, Loader2,
} from 'lucide-react';
import { useFriendsStore, Friend, Message, randomAvatarColor } from '@/stores/friendsStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { tauriFriends, tauriChat } from '@/lib/tauri-bridge';
import { useAuthStore } from '@/stores/authStore';
import { relayWS } from '@/lib/relay-ws';
import { initNotifications, notifyMessage, notifyIncomingCall } from '@/lib/notifications';
import { invoke, isTauri } from '@/lib/invoke-shim';
import { loadMillidaFriendsFromCore } from '@/lib/millida-friends';
import { useMillidaAuthStore } from '@/stores/millidaAuthStore';
import { PortalLanControl } from '@/components/PortalLanControl';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ts: string) {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function fmtDur(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

const statusDot: Record<string, string> = { online: '#2ECC71', offline: '#484F58', playing: '#3498DB' };
const statusLabel: Record<string, string> = { online: 'Online', offline: 'Offline', playing: 'Playing' };

// ── Join World Modal ──────────────────────────────────────────────────────────
function JoinWorldModal({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  const { instances } = useInstanceStore();
  const [sel, setSel] = useState(instances[0]?.id ?? '');
  const [joining, setJoining] = useState(false);
  const [done, setDone] = useState(false);

  const go = async () => {
    if (!sel) return;
    setJoining(true);
    try {
      await tauriFriends.joinWorld(friend.uuid, sel, friend.serverAddress);
      setDone(true);
      setTimeout(onClose, 2000);
    } catch { setJoining(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="w-full max-w-md rounded-2xl p-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
        {done ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(46,204,113,0.15)', border: '2px solid var(--color-success)' }}>
              <Check className="w-7 h-7" style={{ color: 'var(--color-success)' }} />
            </div>
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Launching Minecraft…</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>
                  Join {friend.username}'s {friend.serverAddress ? 'Server' : 'World'}
                </h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {friend.serverAddress ? `Connecting to ${friend.serverAddress}` : 'Via LAN / VPN'}
                </p>
              </div>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5">
                <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
              </button>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl mb-5"
              style={{ background: friend.serverAddress ? 'rgba(52,152,219,0.1)' : 'rgba(46,204,113,0.1)', border: `1px solid ${friend.serverAddress ? 'rgba(52,152,219,0.3)' : 'rgba(46,204,113,0.3)'}` }}>
              {friend.serverAddress
                ? <Server className="w-5 h-5" style={{ color: '#3498DB' }} />
                : <Wifi className="w-5 h-5" style={{ color: 'var(--color-success)' }} />}
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {friend.serverAddress ?? 'LAN World'}
              </p>
            </div>
            {instances.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Launch with instance</p>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                  {instances.map(inst => (
                    <button key={inst.id} onClick={() => setSel(inst.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left"
                      style={{ background: sel === inst.id ? 'var(--color-primary)' : 'var(--color-surface-2)', color: sel === inst.id ? 'var(--color-primary-text)' : 'var(--color-text)' }}>
                      {sel === inst.id && <Check className="w-3.5 h-3.5" />}
                      {inst.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={go} disabled={!sel || joining}
              className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', opacity: (!sel || joining) ? 0.6 : 1 }}>
              {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {joining ? 'Launching…' : 'Join World'}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Add Friend Modal ──────────────────────────────────────────────────────────
function AddFriendModal({ onClose, millidaConnected, onAdded }: { onClose: () => void; millidaConnected: boolean; onAdded: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'err'>('idle');
  const [err, setErr] = useState('');
  const go = async () => {
    if (!millidaConnected) { setPhase('err'); setErr('Сначала войдите в аккаунт Millida в настройках'); return; }
    const name = username.trim();
    if (!name) return;
    setPhase('loading'); setErr('');
    try {
      await invoke('millida_send_friend_request', { nickname: name });
      await onAdded();
      setPhase('done');
      setTimeout(onClose, 1800);
    } catch (e: unknown) {
      setPhase('err');
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>Add Friend</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>
        {phase === 'done' ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(46,204,113,0.15)', border: '2px solid var(--color-success)' }}>
              <Check className="w-6 h-6" style={{ color: 'var(--color-success)' }} />
            </div>
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Added {username}!</p>
          </div>
        ) : (
          <>
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              Введите ник или идентификатор пользователя Millida. Заявка отправится через ваш аккаунт Millida.
            </p>
            <input value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && phase !== 'loading' && go()}
              className="w-full px-3 py-2.5 rounded-xl text-sm mb-3 outline-none"
              style={{ background: 'var(--color-surface-2)', border: `1px solid ${phase === 'err' ? 'var(--color-error)' : 'var(--color-border)'}`, color: 'var(--color-text)' }}
              placeholder="Ник Millida" autoFocus />
            {phase === 'err' && <p className="text-xs mb-3 font-medium" style={{ color: 'var(--color-error)' }}>{err}</p>}
            <button onClick={go} disabled={!username.trim() || phase === 'loading'}
              className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', opacity: (!username.trim() || phase === 'loading') ? 0.6 : 1 }}>
              {phase === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {phase === 'loading' ? 'Отправляем заявку…' : 'Добавить в друзья'}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onDelete }: { msg: Message; onDelete: (t: 'me' | 'all') => void }) {
  const [showMenu, setShowMenu] = useState(false);

  if (msg.deletedForMe) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Message deleted</span>
      </div>
    );
  }

  const statusIcon = msg.isMe && (
    msg.status === 'sending' ? <Clock className="w-2.5 h-2.5 opacity-40" /> :
    msg.status === 'sent'    ? <Check className="w-2.5 h-2.5 opacity-50" /> :
    msg.status === 'delivered' ? <CheckCheck className="w-2.5 h-2.5 opacity-50" /> :
    <CheckCheck className="w-2.5 h-2.5" style={{ color: 'var(--color-primary)' }} />
  );

  const content = () => {
    if (msg.deleted) return <p className="text-xs italic opacity-50">This message was deleted</p>;
    if (msg.type === 'image' && msg.imageUrl) return (
      <div>
        <div className="rounded-lg overflow-hidden max-w-[200px] cursor-pointer mb-1"
          onClick={() => window.open(msg.imageUrl, '_blank')}>
          <img src={msg.imageUrl} alt="img" className="w-full h-auto block"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        {msg.text && <p className="text-sm">{msg.text}</p>}
      </div>
    );
    if (msg.type === 'file') return (
      <a href={msg.imageUrl} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 no-underline hover:opacity-80">
        <FileText className="w-5 h-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate max-w-[160px]">{msg.fileName ?? 'File'}</p>
          {msg.fileSize !== undefined && <p className="text-[10px] opacity-60">{fmtSize(msg.fileSize)}</p>}
        </div>
      </a>
    );
    if (msg.type === 'voice' && msg.voiceUrl) return (
      <div className="flex items-center gap-2">
        <Volume2 className="w-4 h-4 shrink-0" />
        <audio controls src={msg.voiceUrl} className="h-7 max-w-[180px]" />
      </div>
    );
    return <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>;
  };

  return (
    <div className={`flex mb-2 ${msg.isMe ? 'justify-end' : 'justify-start'}`}
      onContextMenu={e => { e.preventDefault(); setShowMenu(s => !s); }}>
      <div className="relative max-w-[70%]">
        <div className="px-3 py-2 rounded-2xl"
          style={{
            background: msg.isMe ? 'var(--color-primary)' : 'var(--color-surface-2)',
            color: msg.isMe ? 'var(--color-primary-text)' : 'var(--color-text)',
            borderBottomRightRadius: msg.isMe ? 4 : undefined,
            borderBottomLeftRadius: msg.isMe ? undefined : 4,
          }}>
          {content()}
          <div className={`flex items-center gap-1 mt-0.5 ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] opacity-50">{fmtTime(msg.timestamp)}</span>
            {statusIcon}
          </div>
        </div>
        <AnimatePresence>
          {showMenu && (
            <motion.div className="absolute z-20 rounded-xl overflow-hidden"
              style={{ [msg.isMe ? 'right' : 'left']: '0', bottom: '100%', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              {[
                msg.text ? { icon: Copy, label: 'Copy text', action: () => { navigator.clipboard.writeText(msg.text!); setShowMenu(false); } } : null,
                { icon: Trash2, label: 'Delete for me', action: () => { onDelete('me'); setShowMenu(false); }, color: 'var(--color-error)' },
                msg.isMe ? { icon: Trash2, label: 'Delete for everyone', action: () => { onDelete('all'); setShowMenu(false); }, color: 'var(--color-error)' } : null,
              ].filter(Boolean).map(({ icon: Icon, label, action, color }: any) => (
                <button key={label} onClick={action}
                  className="flex items-center gap-2.5 px-4 py-2.5 w-full text-left text-sm hover:bg-white/5 whitespace-nowrap"
                  style={{ color: color || 'var(--color-text-secondary)' }}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Incoming Call Overlay ─────────────────────────────────────────────────────
function IncomingCallOverlay({ friend, onAccept, onDecline }: {
  friend: Friend; onAccept: () => void; onDecline: () => void;
}) {
  return (
    <motion.div className="fixed bottom-6 right-6 z-50 rounded-2xl p-4 flex items-center gap-4 shadow-2xl"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 260 }}
      initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 animate-pulse"
        style={{ background: `${friend.avatarColor}30`, color: friend.avatarColor }}>
        {friend.username[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{friend.username}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Incoming voice call…</p>
      </div>
      <button onClick={onAccept} title="Accept"
        className="w-8 h-8 flex items-center justify-center rounded-full shrink-0"
        style={{ background: '#2ECC71', color: 'white' }}>
        <Phone className="w-4 h-4" />
      </button>
      <button onClick={onDecline} title="Decline"
        className="w-8 h-8 flex items-center justify-center rounded-full shrink-0"
        style={{ background: 'var(--color-error)', color: 'white' }}>
        <PhoneOff className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// ── Chat Window ───────────────────────────────────────────────────────────────
interface IncomingCallInfo { fromId: string; sdp: string; friend: Friend }

function ChatWindow({ friend, myUuid, relayUrl, onIncomingCall, headerActions, onRemoveFriend }: {
  friend: Friend; myUuid: string; relayUrl: string;
  onIncomingCall: (i: IncomingCallInfo) => void;
  headerActions?: ReactNode;
  onRemoveFriend?: (friend: Friend) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { messages, addMessage, deleteForMe, deleteForAll, markRead, updateMessageStatus, setTyping, typingState } = useFriendsStore();
  const [text, setText] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [callSec, setCallSec] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [removingFriend, setRemovingFriend] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteAudio = useRef(new Audio());
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const msgs = messages[friend.id] ?? [];
  const isPeerTyping = typingState[friend.id] ?? false;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);
  useEffect(() => { markRead(friend.id); }, [friend.id]);

  // Load from Tauri SQLite on mount
  useEffect(() => {
    if (!myUuid || myUuid.startsWith('demo')) return;
    tauriChat.getMessages(myUuid, friend.uuid, 50).then(raws => {
      for (const r of raws) {
        addMessage(friend.id, {
          id: r.id, senderId: r.from_uuid === myUuid ? 'me' : friend.id,
          text: r.text, timestamp: r.timestamp,
          isMe: r.from_uuid === myUuid,
          type: r.image_url ? 'image' : r.voice_url ? 'voice' : 'text',
          status: r.read ? 'read' : r.delivered ? 'delivered' : 'sent',
          imageUrl: r.image_url ?? undefined, voiceUrl: r.voice_url ?? undefined,
        });
      }
    }).catch(() => {});
  }, [friend.uuid]);

  // WS subscription for this friend
  useEffect(() => {
    const unsub = relayWS.subscribe((msg) => {
      const from = msg['fromId'] as string;
      if (from !== friend.uuid) return;

      if (msg.type === 'chat') {
        const m = (msg['message'] ?? {}) as Record<string, unknown>;
        const isImg = String(m['fileUrl'] ?? '').match(/\.(jpg|jpeg|png|gif|webp)$/i);
        const newMsg: Message = {
          id: String(m['id'] ?? `r-${Date.now()}`),
          senderId: friend.id,
          text: m['text'] as string | undefined,
          timestamp: String(m['timestamp'] ?? new Date().toISOString()),
          isMe: false,
          type: m['fileUrl'] ? (isImg ? 'image' : 'file') : 'text',
          status: 'delivered',
          imageUrl: m['fileUrl'] as string | undefined,
          fileName: m['fileName'] as string | undefined,
        };
        addMessage(friend.id, newMsg);
        notifyMessage(friend.username, (m['text'] as string) ?? '📎 File sent', () => {});
      }

      if (msg.type === 'typing') setTyping(friend.id, !!msg['isTyping']);

      if (msg.type === 'webrtc_offer') {
        onIncomingCall({ fromId: friend.uuid, sdp: msg['sdp'] as string, friend });
      }
      if (msg.type === 'webrtc_answer') {
        pcRef.current?.setRemoteDescription({ type: 'answer', sdp: msg['sdp'] as string }).catch(() => {});
      }
      if (msg.type === 'webrtc_ice') {
        pcRef.current?.addIceCandidate({
          candidate: msg['candidate'] as string,
          sdpMid: msg['sdpMid'] as string | undefined,
          sdpMLineIndex: msg['sdpMLineIndex'] as number | undefined,
        }).catch(() => {});
      }
      if (msg.type === 'call_end') endCall(false);
    });
    return unsub;
  }, [friend.uuid, friend.id]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (callTimer.current) clearInterval(callTimer.current);
  }, []);

  // ── Send text ───────────────────────────────────────────────────────────────
  const sendMsg = useCallback(async () => {
    const txt = text.trim();
    if (!txt) return;
    setText('');
    relayWS.send({ type: 'typing', toId: friend.uuid, isTyping: false });

    const localId = `loc-${Date.now()}`;
    addMessage(friend.id, { id: localId, senderId: 'me', text: txt, timestamp: new Date().toISOString(), isMe: true, type: 'text', status: 'sending' });

    try {
      // Millida receives the message via the Rust keyring layer; the access
      // token never reaches the WebView. Relay still handles low-latency live
      // delivery to the selected friend.
      await invoke('millida_send_chat_message', { friendUuid: friend.uuid, text: txt });
      await tauriChat.send(myUuid, friend.uuid, txt);
      updateMessageStatus(friend.id, localId, 'sent');
    } catch {
      // Keep the local/relay delivery path alive during a temporary Millida
      // API outage; it is visible as sent rather than fabricating a sync ack.
      await tauriChat.send(myUuid, friend.uuid, txt).catch(() => {});
      updateMessageStatus(friend.id, localId, 'sent');
    }

    relayWS.send({ type: 'chat', toId: friend.uuid, msgType: 'text', text: txt });
  }, [text, friend.id, friend.uuid, myUuid]);

  const handleKeyChange = (v: string) => {
    setText(v);
    relayWS.send({ type: 'typing', toId: friend.uuid, isTyping: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => relayWS.send({ type: 'typing', toId: friend.uuid, isTyping: false }), 2500);
  };

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    const tempId = `up-${Date.now()}`;
    addMessage(friend.id, { id: tempId, senderId: 'me', text: `📎 Uploading ${file.name}…`, timestamp: new Date().toISOString(), isMe: true, type: 'text', status: 'sending' });
    try {
      if (!isTauri()) throw new Error('Отправка файлов доступна в приложении Portal Launcher после входа в Millida');
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const uploaded = await invoke<Record<string, unknown>>('millida_upload_chat_file', {
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        bytes,
      });
      const url = String(uploaded?.url ?? uploaded?.fileUrl ?? uploaded?.downloadUrl ?? '');
      if (!url) throw new Error('Millida не вернул ссылку на файл');
      const fileName = String(uploaded?.fileName ?? file.name);
      const fileSize = Number(uploaded?.fileSize ?? file.size);
      const mimeType = String(uploaded?.mimeType ?? file.type ?? 'application/octet-stream');
      const isImg = mimeType.startsWith('image/');
      deleteForMe(friend.id, tempId);
      const m: Message = {
        id: `fu-${Date.now()}`, senderId: 'me', timestamp: new Date().toISOString(), isMe: true,
        type: isImg ? 'image' : 'file', status: 'sent',
        text: isImg ? undefined : `📎 ${fileName}`,
        imageUrl: url, fileName, fileSize,
      };
      addMessage(friend.id, m);
      await tauriChat.send(myUuid, friend.uuid, m.text, undefined, url).catch(() => {});
      relayWS.send({ type: 'chat', toId: friend.uuid, msgType: isImg ? 'image' : 'file', fileUrl: url, fileName, fileSize, text: m.text });
    } catch (e) {
      deleteForMe(friend.id, tempId);
      addMessage(friend.id, { id: `err-${Date.now()}`, senderId: 'sys', text: `⚠️ ${e instanceof Error ? e.message : 'Не удалось отправить файл'}`, timestamp: new Date().toISOString(), isMe: false, type: 'text', status: 'delivered' });
    } finally { setUploading(false); }
  };

  // ── WebRTC ──────────────────────────────────────────────────────────────────
  const makePc = () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
    pc.ontrack = e => { remoteAudio.current.srcObject = e.streams[0]; remoteAudio.current.play().catch(() => {}); };
    pc.onicecandidate = e => { if (e.candidate) relayWS.send({ type: 'webrtc_ice', toId: friend.uuid, candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') endCall(true); };
    return pc;
  };

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const pc = makePc(); pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      relayWS.send({ type: 'webrtc_offer', toId: friend.uuid, sdp: offer.sdp });
      setInCall(true);
      callTimer.current = setInterval(() => setCallSec(s => s + 1), 1000);
    } catch (e) { console.error('Call error:', e); }
  };

  // Used by parent to answer incoming call
  const answerCall = async (sdp: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const pc = makePc(); pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      relayWS.send({ type: 'webrtc_answer', toId: friend.uuid, sdp: ans.sdp });
      setInCall(true);
      callTimer.current = setInterval(() => setCallSec(s => s + 1), 1000);
    } catch (e) { console.error('Answer call error:', e); }
  };

  const endCall = (signal = true) => {
    if (signal) relayWS.send({ type: 'call_end', toId: friend.uuid });
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    remoteAudio.current.srcObject = null;
    if (callTimer.current) { clearInterval(callTimer.current); callTimer.current = null; }
    setInCall(false); setCallSec(0); setMicMuted(false);
  };

  const toggleMute = () => {
    const m = !micMuted; setMicMuted(m);
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !m; });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="relative">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: `${friend.avatarColor}25`, color: friend.avatarColor }}>
            {friend.username[0].toUpperCase()}
          </div>
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
            style={{ background: statusDot[friend.status], borderColor: 'var(--color-surface)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{friend.username}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {friend.status === 'playing' && friend.currentInstance
              ? `🎮 ${friend.currentInstance}${friend.serverAddress ? ` · ${friend.serverAddress}` : ' · LAN'}`
              : statusLabel[friend.status]}
          </p>
        </div>
        {headerActions}
        {onRemoveFriend && <button disabled={removingFriend} onClick={async () => {
          if (!window.confirm(`Удалить ${friend.username} из друзей Millida?`)) return;
          setRemovingFriend(true);
          try { await onRemoveFriend(friend); } finally { setRemovingFriend(false); }
        }} className="rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-40" style={{ borderColor: 'color-mix(in srgb, var(--color-error) 45%, var(--color-border))', color: 'var(--color-error)' }} title="Удалить из друзей Millida">{removingFriend ? 'Удаление…' : 'Удалить'}</button>}
        {friend.status === 'playing' && (
          <button onClick={() => setShowJoinModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90"
            style={{ background: 'var(--color-success)', color: 'white' }}>
            <Play className="w-3 h-3 fill-current" />Join
          </button>
        )}
        <button
          onClick={inCall ? () => endCall(true) : startCall}
          title={inCall ? 'End call' : 'Voice call'}
          className="w-8 h-8 flex items-center justify-center rounded-xl transition-all"
          style={{ background: inCall ? 'rgba(231,76,60,0.15)' : 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: inCall ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
          {inCall ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
        </button>
      </div>

      {/* In-call bar */}
      <AnimatePresence>
        {inCall && (
          <motion.div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ background: 'rgba(46,204,113,0.1)', borderBottom: '1px solid rgba(46,204,113,0.2)' }}
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#2ECC71' }} />
              <span className="text-xs font-medium" style={{ color: '#2ECC71' }}>In Call · {fmtDur(callSec)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleMute}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                style={{ background: micMuted ? 'rgba(231,76,60,0.15)' : 'var(--color-surface-2)', color: micMuted ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                {micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => endCall(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--color-error)', color: 'white' }}>
                <PhoneOff className="w-3 h-3" />End
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-area p-4">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold"
              style={{ background: `${friend.avatarColor}20`, color: friend.avatarColor }}>
              {friend.username[0]}
            </div>
            <div className="text-center">
              <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{friend.username}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Friends since {new Date(friend.friendsSince).toLocaleDateString([], { month: 'long', year: 'numeric' })}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Say hello! 👋</p>
            </div>
          </div>
        )}
        {msgs.map(msg => (
          <MessageBubble key={msg.id} msg={msg}
            onDelete={type => type === 'me' ? deleteForMe(friend.id, msg.id) : deleteForAll(friend.id, msg.id)} />
        ))}

        {/* Typing dots */}
        <AnimatePresence>
          {isPeerTyping && (
            <motion.div className="flex items-center gap-2 mb-2"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
              <div className="px-3 py-2 rounded-2xl rounded-bl-sm flex gap-1" style={{ background: 'var(--color-surface-2)' }}>
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--color-text-tertiary)' }}
                    animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.18 }} />
                ))}
              </div>
              <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>typing…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {uploading && (
          <div className="flex items-center gap-2 mb-2 ml-1">
            <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Uploading…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <input ref={fileRef} type="file" className="hidden"
          accept="image/*,audio/*,video/*,.pdf,.txt,.zip,.rar,.7z,.doc,.docx"
          onChange={handleFile} />
        <div className="flex items-end gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="mb-0.5 transition-all hover:opacity-80"
            style={{ color: uploading ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}
            title="Attach file">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <textarea value={text} rows={1}
            onChange={e => handleKeyChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
            placeholder={t('chat.typeMessage')}
            className="flex-1 bg-transparent text-sm resize-none outline-none"
            style={{ color: 'var(--color-text)', maxHeight: '80px', lineHeight: '1.5' }} />
          <button onClick={sendMsg} disabled={!text.trim()} className="mb-0.5 transition-all"
            style={{ color: text.trim() ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-center mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Enter to send · Shift+Enter for newline · 📎 attach files/images
        </p>
      </div>

      <AnimatePresence>{showJoinModal && <JoinWorldModal friend={friend} onClose={() => setShowJoinModal(false)} />}</AnimatePresence>
    </div>
  );
}

// ── Friend Card ───────────────────────────────────────────────────────────────
function FriendCard({ friend, selected, onClick }: { friend: Friend; selected: boolean; onClick: () => void }) {
  const { messages } = useFriendsStore();
  const arr = messages[friend.id] ?? [];
  const last = arr[arr.length - 1];
  const preview = last
    ? (last.isMe ? 'You: ' : '') + (last.type === 'image' ? '📷 Image' : last.type === 'file' ? `📎 ${last.fileName ?? 'File'}` : (last.text ?? ''))
    : statusLabel[friend.status];

  return (
    <motion.button onClick={onClick} whileHover={{ x: 2 }} transition={{ duration: 0.1 }}
      className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all"
      style={{ background: selected ? 'var(--color-primary-dim)' : 'transparent', border: selected ? '1px solid var(--color-primary)' : '1px solid transparent' }}>
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden"
          style={{ background: `${friend.avatarColor}25`, color: friend.avatarColor }}>
          {friend.avatarUrl ? <img src={friend.avatarUrl} alt="" className="h-full w-full object-cover" /> : friend.username[0].toUpperCase()}
        </div>
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
          style={{ background: statusDot[friend.status], borderColor: 'var(--color-surface)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold truncate" style={{ color: selected ? 'var(--color-primary)' : 'var(--color-text)' }}>
            {friend.username}
          </p>
          {last && <span className="text-[10px] shrink-0 ml-1" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(last.timestamp)}</span>}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {friend.status === 'playing' && friend.currentInstance ? `🎮 ${friend.currentInstance}` : preview}
        </p>
      </div>
      {friend.unread > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: 'var(--color-primary)', color: '#fff' }}>
          {friend.unread > 9 ? '9+' : friend.unread}
        </div>
      )}
    </motion.button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function FriendsPage() {
  const { t } = useTranslation();
  const { friends, selectedId, select, addMessage, incrementUnread, setFriendStatus, hydrateFriends } = useFriendsStore();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [wsOk, setWsOk] = useState(false);
  const [relayUrl, setRelayUrl] = useState('');
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const chatRef = useRef<{ answerCall: (sdp: string) => void } | null>(null);
  const authState = useAuthStore();
  const myUuid = authState.user?.uuid ?? 'demo-user';
  const millidaConnected = useMillidaAuthStore(s => s.connected);
  const millidaProfile = useMillidaAuthStore(s => s.profile);
  const removeMillidaFriend = useCallback(async (friend: Friend) => {
    if (!millidaConnected) throw new Error('Сначала войди в Millida');
    await invoke('millida_remove_friend', { friendUuid: friend.uuid });
    const snapshot = await loadMillidaFriendsFromCore();
    if (snapshot.available) hydrateFriends(snapshot.friends);
  }, [hydrateFriends, millidaConnected]);
  useEffect(() => { void useMillidaAuthStore.getState().refresh(); }, []);

  // Millida is an optional remote source. Keep the local Portal state intact
  // when no Millida session exists, and replace only the friend list when the
  // authenticated adapter returns valid data.
  useEffect(() => {
    if (!millidaConnected) return;
    let disposed = false;
    void loadMillidaFriendsFromCore().then(snapshot => {
      if (!disposed && snapshot.available) hydrateFriends(snapshot.friends);
    }).catch(() => {
      // Keep local friends visible when Millida is temporarily unavailable.
    });
    return () => { disposed = true; };
  }, [hydrateFriends, millidaConnected]);

  // Init notifications
  useEffect(() => { initNotifications(); }, []);

  // Connect relay WS
  useEffect(() => {
    invoke<string>('get_relay_server_url').then(url => {
      setRelayUrl(url || 'http://localhost:5000');
      relayWS.onConnectionChange = setWsOk;
      relayWS.connect(url || 'http://localhost:5000', myUuid);
    }).catch(() => {
      setRelayUrl('http://localhost:5000');
      relayWS.onConnectionChange = setWsOk;
      relayWS.connect('http://localhost:5000', myUuid);
    });
    return () => { relayWS.onConnectionChange = null; };
  }, [myUuid]);

  // Global WS: status changes + messages for non-selected friends
  useEffect(() => {
    const unsub = relayWS.subscribe((msg) => {
      if (msg.type === 'friend_status') {
        const fr = friends.find(f => f.uuid === (msg['userId'] as string));
        if (fr) setFriendStatus(fr.id, msg['status'] as 'online' | 'offline' | 'playing');
      }
      if (msg.type === 'chat') {
        const from = msg['fromId'] as string;
        const fr = friends.find(f => f.uuid === from);
        if (!fr || selectedId === fr.id) return;
        const m = (msg['message'] ?? {}) as Record<string, unknown>;
        addMessage(fr.id, {
          id: String(m['id'] ?? `r-${Date.now()}`), senderId: fr.id,
          text: m['text'] as string, timestamp: String(m['timestamp'] ?? new Date().toISOString()),
          isMe: false, type: 'text', status: 'delivered',
        });
        incrementUnread(fr.id);
        notifyMessage(fr.username, (m['text'] as string) ?? '📎 File', () => select(fr.id));
      }
      if (msg.type === 'webrtc_offer') {
        const fr = friends.find(f => f.uuid === (msg['fromId'] as string));
        if (fr && selectedId !== fr.id) {
          setIncomingCall({ fromId: fr.uuid, sdp: msg['sdp'] as string, friend: fr });
          notifyIncomingCall(fr.username, () => { select(fr.id); setIncomingCall(null); });
        }
      }
    });
    return unsub;
  }, [friends, selectedId]);

  const selectedFriend = friends.find(f => f.id === selectedId);
  const filtered = friends.filter(f => f.username.toLowerCase().includes(search.toLowerCase()));
  const online = filtered.filter(f => f.status !== 'offline');
  const offline = filtered.filter(f => f.status === 'offline');

  return (
    <div className="h-full flex gap-4 min-h-0">
      {/* Left panel */}
      <div className="w-64 flex-shrink-0 flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="p-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>{t('friends.title')}</h2>
              <div className="w-1.5 h-1.5 rounded-full" title={wsOk ? 'Relay connected' : 'Relay offline'}
                style={{ background: wsOk ? '#2ECC71' : '#484F58' }} />
            </div>
            <button onClick={() => setShowAdd(true)} title="Add Friend"
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5"
              style={{ color: 'var(--color-text-secondary)' }}>
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none" style={{ color: 'var(--color-text)' }}
              placeholder="Search friends…" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-area p-2">
          {online.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest px-2 py-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Online — {online.length}
              </p>
              {online.map(f => <FriendCard key={f.id} friend={f} selected={selectedId === f.id} onClick={() => select(f.id)} />)}
            </>
          )}
          {offline.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Offline — {offline.length}
              </p>
              {offline.map(f => <FriendCard key={f.id} friend={f} selected={selectedId === f.id} onClick={() => select(f.id)} />)}
            </>
          )}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
              <Users className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
              {friends.length === 0
                ? <><p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('friends.emptyTitle')}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('friends.emptyHint')}</p></>
                : <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>No friends found</p>}
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 rounded-xl overflow-hidden min-w-0"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <AnimatePresence mode="wait">
          {selectedFriend ? (
            <motion.div key={selectedFriend.id} className="h-full"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1">
                  <ChatWindow
                    friend={selectedFriend}
                    myUuid={myUuid}
                    relayUrl={relayUrl}
                    onIncomingCall={setIncomingCall}
                    headerActions={<PortalLanControl myUuid={millidaProfile?.id || myUuid} peerUuid={selectedFriend.uuid} peerName={selectedFriend.username} />}
                    onRemoveFriend={removeMillidaFriend}
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <Users className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
              <div>
                <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{t('friends.selectFriend')}</p>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Select a friend to start chatting or join their world
                </p>
                {!wsOk && relayUrl && (
                  <div className="mt-3 text-xs px-3 py-1.5 rounded-lg inline-block"
                    style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
                    ⚠️ Relay server offline — configure URL in Settings → API Keys
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Incoming call overlay */}
      <AnimatePresence>
        {incomingCall && (
          <IncomingCallOverlay
            friend={incomingCall.friend}
            onAccept={() => { select(incomingCall.friend.id); setIncomingCall(null); }}
            onDecline={() => { relayWS.send({ type: 'call_end', toId: incomingCall.fromId }); setIncomingCall(null); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{showAdd && <AddFriendModal millidaConnected={millidaConnected} onAdded={async () => {
        const snapshot = await loadMillidaFriendsFromCore();
        if (snapshot.available) hydrateFriends(snapshot.friends);
      }} onClose={() => setShowAdd(false)} />}</AnimatePresence>
    </div>
  );
}
