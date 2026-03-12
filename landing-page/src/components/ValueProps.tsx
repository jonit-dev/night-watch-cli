import { Clock, GitBranch, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

const props = [
  {
    icon: Clock,
    title: "Async-first",
    description: "Not pair-programming. Queued execution while you sleep."
  },
  {
    icon: GitBranch,
    title: "Safe isolation",
    description: "Every task runs in its own git worktree. Your main branch stays clean."
  },
  {
    icon: ShieldCheck,
    title: "Human-in-the-loop",
    description: "You review every PR. Configurable trust dials control auto-merge."
  }
];

export function ValueProps() {
  return (
    <section id="features" className="py-24 px-4 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="grid md:grid-cols-3 gap-8">
          {props.map((prop, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group relative p-8 rounded-2xl bg-gray-900/40 backdrop-blur-sm border border-white/5 hover:border-indigo-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_30px_-5px_rgba(99,102,241,0.15)]"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"></div>
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-6 border border-indigo-500/20 group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all duration-300">
                <prop.icon className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-gray-100">{prop.title}</h3>
              <p className="text-gray-400 leading-relaxed">{prop.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
