import { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { AgentAnimationPlayer } from './AgentAnimation';

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copyInstall = () => {
    navigator.clipboard.writeText('npm install -g @jonit-dev/night-watch-cli');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="pt-24 pb-20 px-4 relative min-h-[100svh] flex flex-col justify-center">
      <div className="container mx-auto max-w-5xl text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm font-medium mb-8"
        >
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          v1.0 is now live
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6"
        >
          Your repo's <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-500 drop-shadow-[0_0_30px_rgba(99,102,241,0.3)]">night shift.</span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed px-4"
        >
          Define work during the day. Night Watch executes overnight. Wake up to pull requests, reviewed code, and tested features.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 md:mb-24"
        >
          <button 
            onClick={copyInstall}
            className="group relative flex items-center justify-center gap-3 bg-gray-900/80 backdrop-blur-md border border-gray-700 hover:border-indigo-500/50 px-6 py-3 rounded-xl font-mono text-sm text-gray-300 transition-all w-full sm:w-auto shadow-[0_0_20px_-5px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_-5px_rgba(99,102,241,0.2)]"
          >
            <span className="text-indigo-500">$</span>
            npm install -g @jonit-dev/night-watch-cli
            {copied ? <Check className="w-4 h-4 text-green-500 ml-2" /> : <Copy className="w-4 h-4 text-gray-500 group-hover:text-gray-300 ml-2 transition-colors" />}
          </button>
          <a href="https://github.com/jonit-dev/night-watch-cli/blob/master/README.md" target="_blank" rel="noreferrer" className="px-6 py-3 rounded-xl font-medium text-white border border-white/10 bg-white/5 hover:bg-white/10 backdrop-blur-md transition-all w-full sm:w-auto">
            Read the docs
          </a>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="max-w-4xl mx-auto relative group"
        >
          {/* Glow effect behind player */}
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>
          
          <div className="relative rounded-xl bg-gray-900/80 backdrop-blur-sm ring-1 ring-white/10 shadow-2xl">
            <AgentAnimationPlayer />
          </div>
        </motion.div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-2"
      >
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Scroll</span>
        <a href="#features" className="w-6 h-10 rounded-full border-2 border-gray-700 flex justify-center p-1 hover:border-indigo-500 transition-colors">
          <motion.div 
            animate={{ y: [0, 12, 0] }} 
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="w-1.5 h-1.5 bg-indigo-500 rounded-full"
          />
        </a>
      </motion.div>
    </section>
  );
}
