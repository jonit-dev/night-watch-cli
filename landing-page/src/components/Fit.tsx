import { CheckCircle, XCircle } from 'lucide-react';
import { motion } from 'motion/react';

export function Fit() {
  return (
    <section className="py-24 px-4 border-t border-white/5 bg-gray-950/50">
      <div className="container mx-auto max-w-5xl">
        <div className="grid md:grid-cols-2 gap-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h3 className="text-2xl font-semibold mb-6 flex items-center gap-3">
              <CheckCircle className="text-emerald-500 w-6 h-6" />
              Night Watch is strongest when:
            </h3>
            <ul className="space-y-4">
              {[
                'You already use structured specs, PRDs, or queued board items',
                'You want async execution, not another pair-programming UI',
                'Your work can be broken into small, reviewable pull requests',
                'You care about overnight throughput on bounded tasks',
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3 text-gray-300">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500/50 shrink-0"></div>
                  <span className="leading-relaxed">{text}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h3 className="text-2xl font-semibold mb-6 flex items-center gap-3">
              <XCircle className="text-gray-500 w-6 h-6" />
              Night Watch is a weaker fit when:
            </h3>
            <ul className="space-y-4">
              {[
                'Work starts vague and gets clarified only during implementation',
                'Your team is not comfortable reviewing AI-generated pull requests',
                'You want a general-purpose AI coding assistant',
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3 text-gray-400">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0"></div>
                  <span className="leading-relaxed">{text}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
