import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TIPS = [
  'Tip: Use Fabric for performance mods like Sodium and Lithium',
  'Tip: Allocate 4–6 GB RAM for large modpacks',
  'Tip: Check Modrinth for the latest Fabric mods',
  'Tip: Iris Shaders works great with Sodium installed',
  'Tip: Create modpacks using the instance export feature',
];

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const [stage, setStage] = useState('Initializing...');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stages = [
    { at: 0,  label: 'Initializing...' },
    { at: 20, label: 'Loading configuration...' },
    { at: 40, label: 'Checking Java installations...' },
    { at: 60, label: 'Loading instances...' },
    { at: 80, label: 'Connecting to services...' },
    { at: 95, label: 'Almost ready...' },
  ];

  useEffect(() => {
    const interval = window.setInterval(() => {
      setProgress(p => {
        if (p >= 100) { window.clearInterval(interval); return 100; }
        const next = Math.min(p + Math.random() * 12 + 4, 100);
        const s = stages.slice().reverse().find(s => next >= s.at);
        if (s) setStage(s.label);
        return next;
      });
    }, 180);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      const t = window.setTimeout(onComplete, 600);
      return () => window.clearTimeout(t);
    }
  }, [progress, onComplete]);

  // Particle canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Floating particles
    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2.5 + 0.5,
      opacity: Math.random() * 0.5 + 0.1,
      hue: Math.random() > 0.7 ? 0 : 260, // mix red and purple
    }));

    let animId = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 70%, 70%, ${p.opacity})`;
        ctx.fill();

        if (p.size > 1.5) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 70%, 70%, ${p.opacity * 0.1})`;
          ctx.fill();
        }
      });
      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at 30% 40%, #1a0533 0%, #0d0f1a 40%, #080c18 100%)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5 }}>

      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
          style={{ background: 'radial-gradient(circle, #6C5CE7 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 left-1/4 w-96 h-96 rounded-full blur-[80px] opacity-10"
          style={{ background: 'radial-gradient(circle, #E74C3C 0%, transparent 70%)' }} />
      </div>

      {/* Logo + title */}
      <motion.div className="relative z-10 text-center"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}>

        {/* Icon */}
        <motion.div
          className="w-24 h-24 rounded-3xl mx-auto mb-6 overflow-hidden"
          style={{
            boxShadow: '0 8px 40px rgba(231,76,60,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
          }}
          animate={{ y: [0, -6, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}>
          <img
            src="/launcher-icon.png"
            alt="Portal Launcher"
            className="w-full h-full object-cover"
            draggable={false}
          />
        </motion.div>

        <h1 className="text-6xl font-black tracking-tight select-none leading-none mb-2">
          <span style={{ color: '#FFFFFF' }}>Portal</span>
          <span style={{
            background: 'linear-gradient(90deg, #6C5CE7, #E74C3C)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}> Launcher</span>
        </h1>

        <motion.p
          className="text-sm tracking-widest uppercase font-semibold"
          style={{ color: 'rgba(255,255,255,0.3)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}>
          by Portalrolls
        </motion.p>
      </motion.div>

      {/* Progress bar */}
      <motion.div className="relative z-10 w-80 mt-14"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}>

        {/* Bar track */}
        <div className="relative h-2 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Fill */}
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #6C5CE7, #E74C3C)',
            }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
          {/* Shimmer */}
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              width: '40%',
            }}
            animate={{ x: ['-100%', '300%'] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          />
        </div>

        {/* Stage label + percent */}
        <div className="flex items-center justify-between mt-3">
          <AnimatePresence mode="wait">
            <motion.p key={stage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs font-medium"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              {stage}
            </motion.p>
          </AnimatePresence>
          <p className="text-xs font-black tabular-nums"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            {Math.round(progress)}%
          </p>
        </div>
      </motion.div>

      {/* Tip */}
      <motion.p
        className="relative z-10 text-xs text-center mt-6 max-w-sm"
        style={{ color: 'rgba(255,255,255,0.2)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}>
        {tip}
      </motion.p>
    </motion.div>
  );
}
