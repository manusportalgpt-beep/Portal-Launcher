import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Clock, MessageSquare, Gamepad2, Wifi } from 'lucide-react';
import { Friend } from '@/stores/friendsStore';

function fmtLastOnline(lastSeen?: string, status?: string): string {
  if (status === 'online' || status === 'playing') return 'Online now';
  if (!lastSeen) return 'Long time ago';
  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400 / 7)} weeks ago`;
  return new Date(lastSeen).toLocaleDateString();
}

const STATUS_COLOR: Record<string, string> = { online: '#2ECC71', offline: '#606770', playing: '#3498DB' };
const STATUS_LABEL: Record<string, string> = { online: 'Online', offline: 'Offline', playing: 'Playing' };

// Rotatable 3D skin viewer using crafatar
function SkinViewer({ uuid, username }: { uuid: string; username: string }) {
  const [rotation, setRotation] = useState(20);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startRot, setStartRot] = useState(0);
  const animRef = useRef<number>();

  useEffect(() => {
    if (!isDragging) {
      const animate = () => {
        setRotation(r => r + 0.35);
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isDragging]);

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.clientX);
    setStartRot(rotation);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setRotation(startRot + (e.clientX - startX) * 0.6);
  };
  const onMouseUp = () => setIsDragging(false);

  const bodyUrl = uuid
    ? `https://crafatar.com/renders/body/${uuid}?scale=8&overlay`
    : null;

  return (
    <div className="relative flex flex-col items-center gap-3 select-none cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <div style={{ perspective: '500px' }}>
        <div
          style={{
            transform: `rotateY(${rotation}deg)`,
            transformStyle: 'preserve-3d',
            transition: isDragging ? 'none' : 'transform 0.05s linear',
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.4))',
          }}>
          {bodyUrl ? (
            <img src={bodyUrl} alt={username}
              style={{ width: 130, imageRendering: 'pixelated' }}
              draggable={false} />
          ) : (
            <div className="w-24 h-32 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--color-surface-2)', border: '2px dashed var(--color-border)' }}>
              <User className="w-12 h-12" style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
          )}
        </div>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>↔ Drag to rotate</p>
    </div>
  );
}

interface FriendProfileModalProps {
  friend: Friend;
  onClose: () => void;
  onChat?: () => void;
}

export function FriendProfileModal({ friend, onClose, onChat }: FriendProfileModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}>
        <motion.div
          className="relative w-full max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg), var(--shadow-glow)',
          }}
          initial={{ scale: 0.88, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.88, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          onClick={e => e.stopPropagation()}>

          {/* Banner */}
          <div className="h-20 w-full relative"
            style={{ background: `linear-gradient(135deg, ${friend.avatarColor}44, ${friend.avatarColor}22)` }}>
            <button onClick={onClose}
              className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
              style={{ background: 'rgba(0,0,0,0.3)' }}>
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Avatar overlapping banner */}
          <div className="px-5 pb-5">
            <div className="relative" style={{ marginTop: -44 }}>
              <div className="w-[88px] h-[88px] rounded-2xl border-4 flex items-center justify-center overflow-hidden"
                style={{ background: friend.avatarColor, borderColor: 'var(--color-surface)' }}>
                <img
                  src={`https://mc-heads.net/head/${friend.uuid}/80`}
                  alt={friend.username}
                  className="w-full h-full"
                  style={{ imageRendering: 'pixelated' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-white font-bold text-2xl absolute">{friend.username[0]}</span>
              </div>
              {/* Status */}
              <div className="absolute bottom-0 right-0 translate-x-1 translate-y-1 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: `${STATUS_COLOR[friend.status]}22`, border: `1px solid ${STATUS_COLOR[friend.status]}55`, color: STATUS_COLOR[friend.status] }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[friend.status] }} />
                {STATUS_LABEL[friend.status]}
              </div>
            </div>

            {/* Name */}
            <div className="mt-3">
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{friend.username}</h2>
              {friend.status === 'playing' && friend.currentInstance && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Gamepad2 className="w-3.5 h-3.5" style={{ color: '#3498DB' }} />
                  <span className="text-xs" style={{ color: '#3498DB' }}>Playing {friend.currentInstance}</span>
                </div>
              )}
              {friend.status === 'playing' && friend.serverAddress && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                  <span className="text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>{friend.serverAddress}</span>
                </div>
              )}
            </div>

            {/* 3D Skin */}
            <div className="mt-4 py-4 rounded-xl flex justify-center"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <SkinViewer uuid={friend.uuid} username={friend.username} />
            </div>

            {/* Stats */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--color-text-tertiary)' }}>Last Online</span>
                </div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {fmtLastOnline(friend.lastSeen, friend.status)}
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <User className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--color-text-tertiary)' }}>Friends Since</span>
                </div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {new Date(friend.friendsSince).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              {onChat && (
                <button onClick={() => { onChat(); onClose(); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <MessageSquare className="w-4 h-4" /> Message
                </button>
              )}
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-white/5 active:scale-95"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
