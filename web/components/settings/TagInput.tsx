import { Plus, X } from 'lucide-react';
import React from 'react';
import Button from '../ui/Button';

interface ITagInputProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  helpText?: string;
}

const TagInput: React.FC<ITagInputProps> = ({ label, value = [], onChange, placeholder, helpText }) => {
  const [input, setInput] = React.useState('');

  const handleAdd = () => {
    if (input.trim() && !value.includes(input.trim())) {
      onChange([...value, input.trim()]);
      setInput('');
    }
  };

  const handleRemove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 rounded text-sm text-slate-300"
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemove(tag)}
              className="text-slate-500 hover:text-red-400"
              aria-label={`Remove ${tag}`}
              title={`Remove ${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
        />
        <Button onClick={handleAdd} disabled={!input.trim()} aria-label={`Add ${label.toLowerCase()} value`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {helpText && <p className="text-xs text-slate-500 mt-1">{helpText}</p>}
    </div>
  );
};

export default TagInput;
