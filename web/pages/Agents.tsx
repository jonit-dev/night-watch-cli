import React, { useState, useCallback } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  X,
  ChevronRight,
  Eye,
  Shield,
  Zap,
  TestTube,
  Code,
} from 'lucide-react';
import {
  fetchAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  fetchAgentPrompt,
  seedDefaultAgents,
  useApi,
  IAgentPersona,
  IAgentSoul,
  IAgentStyle,
  IAgentSkill,
  IAgentModelConfig,
  CreateAgentPersonaInput,
  UpdateAgentPersonaInput,
} from '../api';
import { useStore } from '../store/useStore';

// ==================== Avatar Component ====================

const AgentAvatar: React.FC<{ persona: IAgentPersona; size?: 'sm' | 'lg' }> = ({
  persona,
  size = 'sm',
}) => {
  const sizeClass = size === 'lg' ? 'w-20 h-20 text-2xl' : 'w-12 h-12 text-base';
  const roleColors: Record<string, string> = {
    'Security Reviewer': 'bg-red-500/20 text-red-300 border-red-500/30',
    'Tech Lead / Architect': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    'QA Engineer': 'bg-green-500/20 text-green-300 border-green-500/30',
    'Implementer': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  };
  const colorClass =
    roleColors[persona.role] ?? 'bg-slate-700/40 text-slate-300 border-white/10';

  if (persona.avatarUrl) {
    return (
      <img
        src={persona.avatarUrl}
        alt={persona.name}
        className={`${sizeClass} rounded-full object-cover border border-white/10`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full border flex items-center justify-center font-bold ${colorClass}`}
    >
      {persona.name.charAt(0)}
    </div>
  );
};

// ==================== Role Icon ====================

const RoleIcon: React.FC<{ role: string }> = ({ role }) => {
  if (role.toLowerCase().includes('security')) return <Shield className="h-3 w-3" />;
  if (role.toLowerCase().includes('tech') || role.toLowerCase().includes('architect'))
    return <Zap className="h-3 w-3" />;
  if (role.toLowerCase().includes('qa')) return <TestTube className="h-3 w-3" />;
  return <Code className="h-3 w-3" />;
};

// ==================== Agent Card ====================

const AgentCard: React.FC<{
  persona: IAgentPersona;
  onEdit: (p: IAgentPersona) => void;
  onDelete: (p: IAgentPersona) => void;
  onToggleActive: (p: IAgentPersona) => void;
}> = ({ persona, onEdit, onDelete, onToggleActive }) => {
  const topExpertise = persona.soul.expertise.slice(0, 3);
  const worldviewQuote = persona.soul.worldview[0] ?? '';

  return (
    <div
      onClick={() => onEdit(persona)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(persona);
        }
      }}
      className={`relative rounded-xl border p-5 flex flex-col gap-4 transition-all duration-200
        ${
          persona.isActive
            ? 'bg-[#0d1117] border-white/10 hover:border-white/20'
            : 'bg-[#0d1117]/60 border-white/5 opacity-60'
        }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AgentAvatar persona={persona} />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{persona.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <RoleIcon role={persona.role} />
              <span className="text-xs text-slate-400">{persona.role}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive(persona);
            }}
            title={persona.isActive ? 'Deactivate' : 'Activate'}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
              persona.isActive ? 'bg-indigo-600' : 'bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                persona.isActive ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(persona);
            }}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(persona);
            }}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Worldview quote */}
      {worldviewQuote && (
        <p className="text-xs text-slate-500 italic leading-relaxed line-clamp-2">
          &ldquo;{worldviewQuote}&rdquo;
        </p>
      )}

      {/* Expertise tags */}
      {topExpertise.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topExpertise.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Model badge */}
      {persona.modelConfig && (
        <div className="text-[10px] text-slate-600 font-mono">
          {persona.modelConfig.provider}/{persona.modelConfig.model}
        </div>
      )}
    </div>
  );
};

// ==================== Tab Bar ====================

const TabBar: React.FC<{
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="flex border-b border-white/10 mb-6">
    {tabs.map((tab) => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
          active === tab
            ? 'text-indigo-300 border-indigo-500'
            : 'text-slate-500 border-transparent hover:text-slate-300'
        }`}
      >
        {tab}
      </button>
    ))}
  </div>
);

// ==================== Tag Editor ====================

const TagEditor: React.FC<{
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}> = ({ label, tags, onChange, placeholder }) => {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-slate-800 text-slate-300 border border-white/10"
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-slate-500 hover:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder ?? 'Add item...'}
          className="flex-1 bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={add}
          className="px-3 py-2 rounded-lg bg-white/5 text-slate-400 hover:text-slate-200 text-sm"
        >
          Add
        </button>
      </div>
    </div>
  );
};

// ==================== Key-Value Editor ====================

const KVEditor: React.FC<{
  label: string;
  items: Record<string, string>;
  onChange: (items: Record<string, string>) => void;
}> = ({ label, items, onChange }) => {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');

  const add = () => {
    if (!key.trim()) return;
    onChange({ ...items, [key.trim()]: val.trim() });
    setKey('');
    setVal('');
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-2">{label}</label>
      <div className="space-y-1.5 mb-2">
        {Object.entries(items).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-xs font-mono text-indigo-400 w-32 truncate">{k}</span>
            <span className="text-xs text-slate-400 flex-1 truncate">{v}</span>
            <button
              onClick={() => {
                const next = { ...items };
                delete next[k];
                onChange(next);
              }}
              className="text-slate-600 hover:text-red-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key"
          className="w-32 bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
        />
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="value"
          className="flex-1 bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={add}
          className="px-3 py-2 rounded-lg bg-white/5 text-slate-400 hover:text-slate-200 text-sm"
        >
          Add
        </button>
      </div>
    </div>
  );
};

const ExampleWhyEditor: React.FC<{
  label: string;
  items: Array<{ example: string; why: string }>;
  onChange: (items: Array<{ example: string; why: string }>) => void;
  examplePlaceholder?: string;
  whyPlaceholder?: string;
}> = ({ label, items, onChange, examplePlaceholder, whyPlaceholder }) => {
  const updateItem = (index: number, patch: Partial<{ example: string; why: string }>) => {
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-medium text-slate-400">{label}</label>
        <button
          onClick={() => onChange([...items, { example: '', why: '' }])}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-lg border border-white/10 bg-[#111827] p-2 space-y-2">
            <input
              value={item.example}
              onChange={(e) => updateItem(idx, { example: e.target.value })}
              placeholder={examplePlaceholder ?? 'Example...'}
              className="w-full bg-black/20 border border-white/10 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
            />
            <div className="flex items-center gap-2">
              <input
                value={item.why}
                onChange={(e) => updateItem(idx, { why: e.target.value })}
                placeholder={whyPlaceholder ?? 'Why this misses the voice...'}
                className="flex-1 bg-black/20 border border-white/10 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
              />
              <button
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                className="text-slate-500 hover:text-red-400 px-1"
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==================== Textarea Field ====================

const TextareaField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}> = ({ label, value, onChange, rows = 3, placeholder }) => (
  <div>
    <label className="block text-xs font-medium text-slate-400 mb-2">{label}</label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 resize-none"
    />
  </div>
);

// ==================== Input Field ====================

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}> = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label className="block text-xs font-medium text-slate-400 mb-2">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
    />
  </div>
);

// ==================== Persona Form State ====================

interface PersonaFormState {
  name: string;
  role: string;
  avatarUrl: string;
  soul: IAgentSoul;
  style: IAgentStyle;
  skill: IAgentSkill;
  modelConfig: IAgentModelConfig | null;
  systemPromptOverride: string;
}

function emptyForm(): PersonaFormState {
  return {
    name: '',
    role: '',
    avatarUrl: '',
    soul: {
      whoIAm: '',
      worldview: [],
      opinions: {},
      expertise: [],
      interests: [],
      tensions: [],
      boundaries: [],
      petPeeves: [],
    },
    style: {
      voicePrinciples: '',
      sentenceStructure: '',
      tone: '',
      wordsUsed: [],
      wordsAvoided: [],
      emojiUsage: { frequency: 'moderate', favorites: [], contextRules: '' },
      quickReactions: {},
      rhetoricalMoves: [],
      antiPatterns: [],
      goodExamples: [],
      badExamples: [],
    },
    skill: {
      modes: {},
      interpolationRules: '',
      additionalInstructions: [],
    },
    modelConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    systemPromptOverride: '',
  };
}

function personaToForm(p: IAgentPersona): PersonaFormState {
  return {
    name: p.name,
    role: p.role,
    avatarUrl: p.avatarUrl ?? '',
    soul: { ...p.soul },
    style: { ...p.style },
    skill: { ...p.skill },
    modelConfig: p.modelConfig ?? { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    systemPromptOverride: p.systemPromptOverride ?? '',
  };
}

// ==================== Soul Editor Modal ====================

const MODAL_TABS = ['Identity', 'Soul', 'Style', 'Calibration', 'Advanced'];

const SoulEditorModal: React.FC<{
  persona: IAgentPersona | null;
  onClose: () => void;
  onSave: (id: string | null, input: CreateAgentPersonaInput | UpdateAgentPersonaInput) => Promise<void>;
}> = ({ persona, onClose, onSave }) => {
  const [tab, setTab] = useState('Identity');
  const [form, setForm] = useState<PersonaFormState>(
    persona ? personaToForm(persona) : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const updateSoul = (patch: Partial<IAgentSoul>) =>
    setForm((f) => ({ ...f, soul: { ...f.soul, ...patch } }));

  const updateStyle = (patch: Partial<IAgentStyle>) =>
    setForm((f) => ({ ...f, style: { ...f.style, ...patch } }));

  const updateSkill = (patch: Partial<IAgentSkill>) =>
    setForm((f) => ({ ...f, skill: { ...f.skill, ...patch } }));

  const updateModelConfig = (patch: Partial<IAgentModelConfig>) =>
    setForm((f) => ({
      ...f,
      modelConfig: f.modelConfig
        ? { ...f.modelConfig, ...patch }
        : { provider: 'anthropic', model: 'claude-sonnet-4-6', ...patch },
    }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) {
      setError('Name and role are required.');
      return;
    }

    setSaving(true);
    setError(null);

    const modelConfigForSave =
      form.modelConfig === null
        ? null
        : form.modelConfig.model
          ? form.modelConfig
          : undefined;

    const input: CreateAgentPersonaInput = {
      name: form.name.trim(),
      role: form.role.trim(),
      avatarUrl: form.avatarUrl.trim() || undefined,
      soul: form.soul,
      style: form.style,
      skill: form.skill,
      modelConfig: modelConfigForSave,
      systemPromptOverride: form.systemPromptOverride.trim() || undefined,
    };

    try {
      await onSave(persona?.id ?? null, input);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewPrompt = async () => {
    if (!persona) return;
    setLoadingPrompt(true);
    try {
      const result = await fetchAgentPrompt(persona.id);
      setPromptPreview(result.prompt);
    } catch (err) {
      setPromptPreview(`Error: ${(err as Error).message}`);
    } finally {
      setLoadingPrompt(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            {persona && <AgentAvatar persona={persona} />}
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {persona ? `Edit ${persona.name}` : 'Hire Agent'}
              </h2>
              <p className="text-xs text-slate-500">Define their soul, style, and skills</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <TabBar tabs={MODAL_TABS} active={tab} onChange={setTab} />
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
          {/* ── Identity ── */}
          {tab === 'Identity' && (
            <>
              <InputField
                label="Name"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="e.g. Maya"
              />
              <InputField
                label="Role"
                value={form.role}
                onChange={(v) => setForm((f) => ({ ...f, role: v }))}
                placeholder="e.g. Security Reviewer"
              />
              {/* Avatar file picker */}
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Avatar</label>
                <div className="flex items-center gap-4">
                  {/* Preview circle */}
                  <div className="h-16 w-16 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {form.avatarUrl ? (
                      <img src={form.avatarUrl} alt="avatar" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-indigo-400">
                        {(form.name || '?')[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10 transition-colors">
                      <span>Upload image</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            const dataUri = evt.target?.result as string;
                            setForm((f) => ({ ...f, avatarUrl: dataUri }));
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    {form.avatarUrl && (
                      <button
                        onClick={() => setForm((f) => ({ ...f, avatarUrl: '' }))}
                        className="ml-2 text-xs text-slate-500 hover:text-red-400"
                      >Remove</button>
                    )}
                  </div>
                </div>
              </div>
              <TextareaField
                label="Who I Am"
                value={form.soul.whoIAm}
                onChange={(v) => updateSoul({ whoIAm: v })}
                rows={4}
                placeholder="A concise self-description in first person..."
              />
              <TagEditor
                label="Expertise"
                tags={form.soul.expertise}
                onChange={(tags) => updateSoul({ expertise: tags })}
                placeholder="e.g. security, cryptography..."
              />
              <TagEditor
                label="Interests"
                tags={form.soul.interests}
                onChange={(tags) => updateSoul({ interests: tags })}
                placeholder="e.g. OWASP, threat modeling..."
              />
            </>
          )}

          {/* ── Soul ── */}
          {tab === 'Soul' && (
            <>
              <TagEditor
                label="Worldview (beliefs)"
                tags={form.soul.worldview}
                onChange={(tags) => updateSoul({ worldview: tags })}
                placeholder="Add a core belief..."
              />
              <TagEditor
                label="Tensions (internal conflicts)"
                tags={form.soul.tensions}
                onChange={(tags) => updateSoul({ tensions: tags })}
                placeholder="Add a tension..."
              />
              <TagEditor
                label="Boundaries (won't do)"
                tags={form.soul.boundaries}
                onChange={(tags) => updateSoul({ boundaries: tags })}
                placeholder="Add a boundary..."
              />
              <TagEditor
                label="Pet Peeves"
                tags={form.soul.petPeeves}
                onChange={(tags) => updateSoul({ petPeeves: tags })}
                placeholder="Add a pet peeve..."
              />

              {/* Opinions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Opinions</label>
                  <button
                    onClick={() => {
                      const domain = prompt('Domain name (e.g., security, architecture):');
                      if (domain?.trim()) {
                        updateSoul({
                          opinions: { ...(form.soul.opinions ?? {}), [domain.trim()]: [] },
                        });
                      }
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                  >+ Add Domain</button>
                </div>
                {Object.entries(form.soul.opinions ?? {}).map(([domain, takes]) => (
                  <div key={domain} className="mb-3 p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-300">{domain}</span>
                      <button
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { [domain]: _removed, ...rest } = form.soul.opinions ?? {};
                          updateSoul({ opinions: rest });
                        }}
                        className="text-xs text-red-400 hover:text-red-300"
                      >Remove domain</button>
                    </div>
                    <div className="space-y-1 mb-2">
                      {takes.map((take, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            value={take}
                            onChange={(e) => {
                              const newTakes = [...takes];
                              newTakes[idx] = e.target.value;
                              updateSoul({
                                opinions: { ...(form.soul.opinions ?? {}), [domain]: newTakes },
                              });
                            }}
                            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
                            placeholder="Add a take..."
                          />
                          <button
                            onClick={() => {
                              const newTakes = takes.filter((_, i) => i !== idx);
                              updateSoul({
                                opinions: { ...(form.soul.opinions ?? {}), [domain]: newTakes },
                              });
                            }}
                            className="text-slate-500 hover:text-red-400 text-xs"
                          >×</button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        updateSoul({
                          opinions: { ...(form.soul.opinions ?? {}), [domain]: [...takes, ''] },
                        });
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >+ Add take</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Style ── */}
          {tab === 'Style' && (
            <>
              <TextareaField
                label="Voice Principles"
                value={form.style.voicePrinciples}
                onChange={(v) => updateStyle({ voicePrinciples: v })}
                placeholder="Describe the voice in 1-2 sentences..."
              />
              <InputField
                label="Tone"
                value={form.style.tone}
                onChange={(v) => updateStyle({ tone: v })}
                placeholder="e.g. Vigilant but not paranoid. Matter-of-fact."
              />
              <InputField
                label="Sentence Structure"
                value={form.style.sentenceStructure}
                onChange={(v) => updateStyle({ sentenceStructure: v })}
                placeholder="e.g. Short and punchy. One risk, one fix per message."
              />
              <TagEditor
                label="Words I Use"
                tags={form.style.wordsUsed}
                onChange={(tags) => updateStyle({ wordsUsed: tags })}
                placeholder="Add a word or phrase..."
              />
              <TagEditor
                label="Words I Never Use"
                tags={form.style.wordsAvoided}
                onChange={(tags) => updateStyle({ wordsAvoided: tags })}
                placeholder="Add a word to avoid..."
              />
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Emoji Frequency
                </label>
                <select
                  value={form.style.emojiUsage.frequency}
                  onChange={(e) =>
                    updateStyle({
                      emojiUsage: {
                        ...form.style.emojiUsage,
                        frequency: e.target.value as IAgentStyle['emojiUsage']['frequency'],
                      },
                    })
                  }
                  className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="never">Never</option>
                  <option value="rare">Rare</option>
                  <option value="moderate">Moderate</option>
                  <option value="heavy">Heavy</option>
                </select>
              </div>
              <TagEditor
                label="Favorite Emojis"
                tags={form.style.emojiUsage.favorites}
                onChange={(tags) =>
                  updateStyle({
                    emojiUsage: { ...form.style.emojiUsage, favorites: tags },
                  })
                }
                placeholder="Add an emoji..."
              />
              <TextareaField
                label="Emoji Context Rules"
                value={form.style.emojiUsage.contextRules}
                onChange={(v) =>
                  updateStyle({
                    emojiUsage: { ...form.style.emojiUsage, contextRules: v },
                  })
                }
                rows={2}
                placeholder="e.g. 🔒 for concerns, ✅ for resolved issues"
              />
              <KVEditor
                label="Quick Reactions"
                items={form.style.quickReactions}
                onChange={(items) => updateStyle({ quickReactions: items })}
              />
            </>
          )}

          {/* ── Calibration ── */}
          {tab === 'Calibration' && (
            <>
              <TagEditor
                label="Good Examples (what I sound like)"
                tags={form.style.goodExamples}
                onChange={(tags) => updateStyle({ goodExamples: tags })}
                placeholder="Add a good example message..."
              />
              <TagEditor
                label="Rhetorical Moves"
                tags={form.style.rhetoricalMoves}
                onChange={(tags) => updateStyle({ rhetoricalMoves: tags })}
                placeholder="Add a rhetorical pattern..."
              />
              <TagEditor
                label="Additional Instructions"
                tags={form.skill.additionalInstructions}
                onChange={(tags) => updateSkill({ additionalInstructions: tags })}
                placeholder="Add an instruction..."
              />
              <ExampleWhyEditor
                label="Anti-Patterns (Never Sound Like This)"
                items={form.style.antiPatterns}
                onChange={(items) => updateStyle({ antiPatterns: items })}
                examplePlaceholder="What should be avoided..."
                whyPlaceholder="Why this is off-voice..."
              />
              <ExampleWhyEditor
                label="Bad Examples"
                items={form.style.badExamples}
                onChange={(items) => updateStyle({ badExamples: items })}
                examplePlaceholder="Bad output example..."
                whyPlaceholder="Why it misses..."
              />
            </>
          )}

          {/* ── Advanced ── */}
          {tab === 'Advanced' && (
            <>
              {/* Use Global Config toggle */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-medium text-slate-300">Use Global Config</p>
                  <p className="text-xs text-slate-500">When on, this persona uses the global Night Watch AI model settings</p>
                </div>
                <button
                  onClick={() => setForm((f) => ({
                    ...f,
                    modelConfig: f.modelConfig ? null : { provider: 'anthropic', model: 'claude-sonnet-4-6' },
                  }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${!form.modelConfig ? 'bg-indigo-500' : 'bg-white/10'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${!form.modelConfig ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {form.modelConfig && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">Provider</label>
                    <select
                      value={form.modelConfig.provider}
                      onChange={(e) =>
                        updateModelConfig({
                          provider: e.target.value as IAgentModelConfig['provider'],
                        })
                      }
                      className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <InputField
                    label="Model"
                    value={form.modelConfig.model}
                    onChange={(v) => updateModelConfig({ model: v })}
                    placeholder="e.g. claude-sonnet-4-6"
                  />
                  {form.modelConfig.provider === 'custom' && (
                    <InputField
                      label="Base URL"
                      value={form.modelConfig.baseUrl ?? ''}
                      onChange={(v) => updateModelConfig({ baseUrl: v })}
                      placeholder="https://api.example.com/v1"
                    />
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">
                      Temperature:{' '}
                      <span className="text-slate-300">{form.modelConfig.temperature ?? 0.7}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={form.modelConfig.temperature ?? 0.7}
                      onChange={(e) => updateModelConfig({ temperature: parseFloat(e.target.value) })}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                      Max Tokens (optional)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={32768}
                      value={form.modelConfig.maxTokens ?? ''}
                      onChange={(e) => updateModelConfig({
                        maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                      })}
                      placeholder="Default from provider"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                      Custom Env Vars
                    </label>
                    <p className="text-xs text-slate-500 mb-2">API keys injected at call time for this persona only. Values are masked after save.</p>
                    {Object.entries(form.modelConfig.envVars ?? {}).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2 mb-1">
                        <input
                          value={key}
                          readOnly
                          className="w-1/3 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        />
                        <input
                          value={val === '***' ? '' : val}
                          placeholder={val === '***' ? '(masked)' : 'value'}
                          onChange={(e) => updateModelConfig({
                            envVars: { ...(form.modelConfig?.envVars ?? {}), [key]: e.target.value },
                          })}
                          type="password"
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        />
                        <button
                          onClick={() => {
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const { [key]: _removed, ...rest } = form.modelConfig?.envVars ?? {};
                            updateModelConfig({ envVars: rest });
                          }}
                          className="text-slate-500 hover:text-red-400 text-xs"
                        >×</button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const newKey = prompt('Environment variable name (e.g., ANTHROPIC_API_KEY):');
                        if (newKey?.trim()) {
                          updateModelConfig({
                            envVars: { ...(form.modelConfig?.envVars ?? {}), [newKey.trim()]: '' },
                          });
                        }
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 mt-1"
                    >+ Add Env Var</button>
                  </div>
                </>
              )}

              <KVEditor
                label="Operating Modes"
                items={form.skill.modes}
                onChange={(items) => updateSkill({ modes: items })}
              />
              <TextareaField
                label="Interpolation Rules"
                value={form.skill.interpolationRules}
                onChange={(v) => updateSkill({ interpolationRules: v })}
                rows={3}
                placeholder="How this persona should reason when explicit opinions are missing..."
              />
              <TextareaField
                label="System Prompt Override (leave empty to compile from soul)"
                value={form.systemPromptOverride}
                onChange={(v) => setForm((f) => ({ ...f, systemPromptOverride: v }))}
                rows={6}
                placeholder="Optionally paste a raw system prompt here to bypass soul compilation..."
              />

              {/* Prompt Preview */}
              {persona && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-400">Compiled System Prompt Preview</label>
                    <button
                      onClick={handlePreviewPrompt}
                      disabled={loadingPrompt}
                      className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {loadingPrompt ? 'Loading...' : 'Preview'}
                    </button>
                  </div>
                  {promptPreview && (
                    <pre className="bg-[#060d17] border border-white/10 rounded-lg p-4 text-xs text-slate-400 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
                      {promptPreview}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!error && <span />}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : persona ? 'Save Changes' : 'Hire Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== Delete Confirm Dialog ====================

const DeleteConfirmDialog: React.FC<{
  persona: IAgentPersona;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}> = ({ persona, onConfirm, onCancel }) => {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-slate-100 mb-2">Delete {persona.name}?</h3>
        <p className="text-sm text-slate-400 mb-6">
          This will permanently remove {persona.name}&apos;s soul from the team. This action
          cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Agents Page ====================

const Agents: React.FC = () => {
  const { selectedProjectId, globalModeLoading } = useStore();
  const {
    data: personas,
    loading,
    error,
    refetch,
  } = useApi(() => fetchAgents(), [selectedProjectId], { enabled: !globalModeLoading });

  const [editingPersona, setEditingPersona] = useState<IAgentPersona | null | undefined>(
    undefined
  ); // undefined = closed, null = new, IAgentPersona = editing
  const [deletingPersona, setDeletingPersona] = useState<IAgentPersona | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const handleSave = useCallback(
    async (
      id: string | null,
      input: CreateAgentPersonaInput | UpdateAgentPersonaInput
    ) => {
      if (id) {
        await updateAgent(id, input as UpdateAgentPersonaInput);
      } else {
        await createAgent(input as CreateAgentPersonaInput);
      }
      refetch();
    },
    [refetch]
  );

  const handleDelete = useCallback(
    async (persona: IAgentPersona) => {
      await deleteAgent(persona.id);
      setDeletingPersona(null);
      refetch();
    },
    [refetch]
  );

  const handleToggleActive = useCallback(
    async (persona: IAgentPersona) => {
      await updateAgent(persona.id, { isActive: !persona.isActive });
      refetch();
    },
    [refetch]
  );

  const handleSeedDefaults = async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      await seedDefaultAgents();
      refetch();
    } catch (err) {
      setSeedError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const activeCount = personas?.filter((p) => p.isActive).length ?? 0;
  const totalCount = personas?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Users className="h-5 w-5 text-indigo-400" />
            </div>
            <h1 className="text-xl font-semibold text-slate-100">Team</h1>
          </div>
          <p className="text-sm text-slate-500 ml-11">
            {totalCount} agent{totalCount !== 1 ? 's' : ''} &middot;{' '}
            {activeCount} active
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/10 transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`h-4 w-4 ${seeding ? 'animate-spin' : ''}`} />
            Restore Defaults
          </button>
          <button
            onClick={() => setEditingPersona(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            Hire Agent
          </button>
        </div>
      </div>

      {seedError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {seedError}
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          Failed to load agents: {error.message}
        </div>
      )}

      {!loading && !error && personas && personas.length === 0 && (
        <div className="text-center py-20">
          <Users className="h-12 w-12 text-slate-700 mx-auto mb-4" />
          <p className="text-slate-500 mb-2">No agents yet</p>
          <p className="text-sm text-slate-600 mb-6">
            Hire your first agent or restore the defaults to meet the team.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={handleSeedDefaults}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 border border-white/10 hover:bg-white/5 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Restore Defaults
            </button>
            <button
              onClick={() => setEditingPersona(null)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="h-4 w-4" />
              Hire Agent
            </button>
          </div>
        </div>
      )}

      {!loading && !error && personas && personas.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {personas.map((p) => (
            <AgentCard
              key={p.id}
              persona={p}
              onEdit={setEditingPersona}
              onDelete={setDeletingPersona}
              onToggleActive={handleToggleActive}
            />
          ))}

          {/* Hire Agent CTA card */}
          <button
            onClick={() => setEditingPersona(null)}
            className="rounded-xl border border-dashed border-white/10 p-5 flex flex-col items-center justify-center gap-3 text-slate-600 hover:text-slate-400 hover:border-white/20 hover:bg-white/5 transition-all duration-200 min-h-[200px]"
          >
            <Plus className="h-8 w-8" />
            <span className="text-sm font-medium">Hire Agent</span>
          </button>
        </div>
      )}

      {/* Agent detail mini-preview on hover (shown inline for simple pages) */}
      {!loading && !error && personas && personas.length > 0 && (
        <div className="mt-2">
          <details className="group">
            <summary className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:text-slate-400 select-none">
              <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
              View soul documents
            </summary>
            <div className="mt-4 space-y-3">
              {personas.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-white/5 bg-[#0d1117]/60 p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <AgentAvatar persona={p} size="sm" />
                    <div>
                      <span className="text-sm font-medium text-slate-200">{p.name}</span>
                      <span className="text-xs text-slate-500 ml-2">{p.role}</span>
                    </div>
                  </div>
                  {p.soul.whoIAm && (
                    <p className="text-xs text-slate-500 leading-relaxed mb-2">{p.soul.whoIAm}</p>
                  )}
                  {p.soul.worldview.length > 0 && (
                    <ul className="space-y-1">
                      {p.soul.worldview.slice(0, 3).map((belief, i) => (
                        <li key={i} className="text-xs text-slate-600 pl-3 border-l border-white/5">
                          {belief}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Soul Editor Modal */}
      {editingPersona !== undefined && (
        <SoulEditorModal
          persona={editingPersona}
          onClose={() => setEditingPersona(undefined)}
          onSave={handleSave}
        />
      )}

      {/* Delete Confirm Dialog */}
      {deletingPersona && (
        <DeleteConfirmDialog
          persona={deletingPersona}
          onConfirm={() => handleDelete(deletingPersona)}
          onCancel={() => setDeletingPersona(null)}
        />
      )}
    </div>
  );
};

export default Agents;
