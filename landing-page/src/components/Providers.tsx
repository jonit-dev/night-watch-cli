export function Providers() {
  return (
    <section className="py-16 px-4 border-t border-white/5 bg-gray-950/50">
      <div className="container mx-auto max-w-4xl text-center">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-8">
          Supported Providers
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col items-center justify-center">
            <span className="font-semibold text-gray-200 mb-1">Claude CLI</span>
            <span className="text-xs text-gray-500">Default, with rate-limit fallback</span>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col items-center justify-center">
            <span className="font-semibold text-gray-200 mb-1">Codex CLI</span>
            <span className="text-xs text-gray-500">Full support</span>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col items-center justify-center">
            <span className="font-semibold text-gray-200 mb-1">GLM-5 / Custom</span>
            <span className="text-xs text-gray-500">Via providerEnv config</span>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          Bring your own AI provider. Night Watch wraps the CLI — you stay in control of credentials
          and costs.
        </p>
      </div>
    </section>
  );
}
