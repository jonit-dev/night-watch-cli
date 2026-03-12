import { motion } from 'motion/react';

const steps = [
  {
    number: '01',
    title: 'Define work',
    description: "Create a GitHub issue or write a PRD. Mark it as 'Ready' on your project board.",
  },
  {
    number: '02',
    title: 'Night Watch picks it up',
    description: 'The executor claims the next issue, creates a worktree, and implements the spec.',
  },
  {
    number: '03',
    title: 'Automated review cycle',
    description:
      'The reviewer scores the PR, requests fixes, and retries. QA generates and runs e2e tests.',
  },
  {
    number: '04',
    title: 'You wake up to PRs',
    description:
      'Review, approve, merge. Or let auto-merge handle it when the score is high enough.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            From spec to merged PR — while you sleep
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            A fully autonomous pipeline that respects your workflow.
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative"
            >
              <div className="text-5xl font-black text-gray-800 mb-4">{step.number}</div>
              <h3 className="text-lg font-semibold mb-2 text-gray-200">{step.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>

              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-6 left-1/2 w-full h-[1px] bg-gradient-to-r from-gray-800 to-transparent -z-10"></div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
