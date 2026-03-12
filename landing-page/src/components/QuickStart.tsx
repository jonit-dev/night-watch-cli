import { motion } from 'motion/react';
import { Terminal } from 'lucide-react';

export function QuickStart() {
  return (
    <section id="quick-start" className="py-24 px-4">
      <div className="container mx-auto max-w-3xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Up and running in 60 seconds</h2>
          <p className="text-gray-400">Zero infrastructure. Runs on your machine.</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="bg-[#0d1117] rounded-xl border border-gray-800 shadow-xl overflow-hidden mb-8 text-left"
        >
          <div className="flex items-center px-4 py-3 border-b border-gray-800 bg-[#161b22]">
            <Terminal className="w-4 h-4 text-gray-500 mr-2" />
            <span className="text-xs text-gray-400 font-mono">Terminal</span>
          </div>
          <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
            <div className="text-gray-500 mb-1"># Install globally</div>
            <div className="text-gray-200 mb-4 whitespace-nowrap">
              <span className="text-indigo-400">$</span> npm install -g @jonit-dev/night-watch-cli
            </div>

            <div className="text-gray-500 mb-1"># Initialize in your project</div>
            <div className="text-gray-200 whitespace-nowrap">
              <span className="text-indigo-400">$</span> cd your-project
            </div>
            <div className="text-gray-200 mb-4 whitespace-nowrap">
              <span className="text-indigo-400">$</span> night-watch init
            </div>

            <div className="text-gray-500 mb-1"># Check everything is set up</div>
            <div className="text-gray-200 mb-4 whitespace-nowrap">
              <span className="text-indigo-400">$</span> night-watch doctor
            </div>

            <div className="text-gray-500 mb-1"># Add work to the queue</div>
            <div className="text-gray-200 mb-4 whitespace-nowrap">
              <span className="text-indigo-400">$</span> night-watch board create-prd "Implement
              feature X" --priority P1
            </div>

            <div className="text-gray-500 mb-1">
              # Run once or install cron for overnight automation
            </div>
            <div className="text-gray-200 whitespace-nowrap">
              <span className="text-indigo-400">$</span> night-watch run{' '}
              <span className="text-gray-600"># run once</span>
            </div>
            <div className="text-gray-200 whitespace-nowrap">
              <span className="text-indigo-400">$</span> night-watch install{' '}
              <span className="text-gray-600"># setup automated cron</span>
            </div>
          </div>
        </motion.div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
          <a
            href="https://github.com/jonit-dev/night-watch-cli/blob/master/README.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-4"
          >
            5-minute walkthrough
          </a>
          <span className="text-gray-700">•</span>
          <a
            href="https://github.com/jonit-dev/night-watch-cli/blob/master/README.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-4"
          >
            Full docs
          </a>
          <span className="text-gray-700">•</span>
          <a
            href="https://github.com/jonit-dev/night-watch-cli/blob/master/README.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-4"
          >
            Commands reference
          </a>
        </div>
      </div>
    </section>
  );
}
