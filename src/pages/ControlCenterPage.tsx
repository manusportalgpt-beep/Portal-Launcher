import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, BarChart3, Camera, CheckCircle2, Clock, Compass, HeartPulse, Library, RefreshCw, Shield, Trophy } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useAchievementStore } from '@/stores/achievementStore';

function timeLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} m` : `${minutes} m`;
}

export function ControlCenterPage() {
  const navigate = useNavigate();
  const instances = useInstanceStore(state => state.instances);
  const totalMinutes = useMemo(() => instances.reduce((sum, instance) => sum + (instance.totalPlayTime || 0), 0), [instances]);
  const unlockedMap = useAchievementStore(state => state.unlocked);
  const unlock = useAchievementStore(state => state.unlock);
  const clickCount = Number(localStorage.getItem('portal-easter-clicks') || 0);
  const recent = useMemo(() => [...instances].sort((a, b) => new Date(b.lastPlayed || 0).getTime() - new Date(a.lastPlayed || 0).getTime())[0], [instances]);
  const achievements = [
    { id:'first-setup', title:'First setup', description:'Create your first Minecraft instance', complete:instances.length >= 1 },
    { id:'explorer', title:'Explorer', description:'Create three different setups', complete:instances.length >= 3 },
    { id:'timekeeper', title:'Timekeeper', description:'Play for one hour in total', complete:totalMinutes >= 60 },
    { id:'veteran', title:'Veteran', description:'Play for ten hours in total', complete:totalMinutes >= 600 },
    { id:'creator', title:'Collection builder', description:'Create five setups', complete:instances.length >= 5 },
    { id:'verity', title:'Verity', description:'Что-то случиться через 3 дня...', complete:clickCount >= 1000 || Boolean(unlockedMap['verity']) },
  ];
  useEffect(() => { achievements.filter(achievement => achievement.complete).forEach(achievement => unlock(achievement.id)); }, [instances, totalMinutes, clickCount, unlock]);
  const unlocked = achievements.filter(achievement => achievement.complete || unlockedMap[achievement.id]).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="rounded-3xl p-6 relative overflow-hidden" style={{ background:'linear-gradient(135deg, var(--color-surface), var(--color-surface-2))', border:'1px solid var(--color-border)' }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background:'radial-gradient(circle at 85% 15%, var(--color-primary-dim), transparent 35%)' }} />
          <div className="relative flex flex-col sm:flex-row sm:items-end gap-4 justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-primary)' }}>Launcher control center</p><h1 className="text-2xl font-black mt-1" style={{ color:'var(--color-text)' }}>Your Minecraft progress</h1><p className="text-sm mt-2" style={{ color:'var(--color-text-secondary)' }}>Quickly check activity, unlock achievements, update your content or recover a setup.</p></div><button onClick={() => navigate('/library')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Library className="w-4 h-4" />Open Library</button></div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[{ Icon:Library, label:'Setups', value:String(instances.length) }, { Icon:Clock, label:'Time played', value:timeLabel(totalMinutes) }, { Icon:Trophy, label:'Achievements', value:`${unlocked}/${achievements.length}` }, { Icon:BarChart3, label:'Latest setup', value:recent?.name ?? '—' }].map(card => <div key={card.label} className="p-4 rounded-2xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><card.Icon className="w-4 h-4 mb-3" style={{ color:'var(--color-primary)' }} /><p className="text-lg font-black truncate" style={{ color:'var(--color-text)' }}>{card.value}</p><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color:'var(--color-text-tertiary)' }}>{card.label}</p></div>)}
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl p-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><div className="flex items-center justify-between mb-3"><h2 className="font-bold flex items-center gap-2" style={{ color:'var(--color-text)' }}><Award className="w-4 h-4" style={{ color:'var(--color-primary)' }} />Achievements</h2><span className="text-xs" style={{ color:'var(--color-text-secondary)' }}>{unlocked} unlocked</span></div><div className="space-y-2">{achievements.map(achievement => <div key={achievement.id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background:'var(--color-surface-2)', opacity:(achievement.complete || unlockedMap[achievement.id]) ? 1 : 0.58 }}><span className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden" style={{ background:(achievement.complete || unlockedMap[achievement.id]) ? 'var(--color-primary-dim)' : 'var(--color-surface)', color:(achievement.complete || unlockedMap[achievement.id]) ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>{(achievement.complete || unlockedMap[achievement.id]) ? <CheckCircle2 className="w-4 h-4" /> : <Award className="w-4 h-4" />}</span><span className="flex-1"><b className="block text-sm" style={{ color:'var(--color-text)' }}>{achievement.title}</b><small style={{ color:'var(--color-text-secondary)' }}>{achievement.description}</small></span></div>)}</div></div>
          <div className="rounded-2xl p-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><h2 className="font-bold flex items-center gap-2 mb-3" style={{ color:'var(--color-text)' }}><HeartPulse className="w-4 h-4" style={{ color:'var(--color-primary)' }} />Quick tools</h2><div className="grid grid-cols-2 gap-2"><button onClick={() => navigate('/library')} className="p-3 rounded-xl text-left" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><RefreshCw className="w-4 h-4 mb-2" style={{ color:'#2ECC71' }} /><b className="block text-sm" style={{ color:'var(--color-text)' }}>Update center</b><small style={{ color:'var(--color-text-secondary)' }}>Scan installed content</small></button><button onClick={() => navigate('/gallery')} className="p-3 rounded-xl text-left" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><Camera className="w-4 h-4 mb-2" style={{ color:'var(--color-primary)' }} /><b className="block text-sm" style={{ color:'var(--color-text)' }}>Screenshots</b><small style={{ color:'var(--color-text-secondary)' }}>Manage every capture</small></button><button onClick={() => navigate('/discover')} className="p-3 rounded-xl text-left" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><Compass className="w-4 h-4 mb-2" style={{ color:'#8b5cf6' }} /><b className="block text-sm" style={{ color:'var(--color-text)' }}>Find content</b><small style={{ color:'var(--color-text-secondary)' }}>Mods and modpacks</small></button><button onClick={() => navigate('/library')} className="p-3 rounded-xl text-left" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><Shield className="w-4 h-4 mb-2" style={{ color:'var(--color-warning)' }} /><b className="block text-sm" style={{ color:'var(--color-text)' }}>Safe recovery</b><small style={{ color:'var(--color-text-secondary)' }}>Backups and Safe Mode</small></button></div></div>
        </section>
      </div>
    </div>
  );
}

export default ControlCenterPage;
