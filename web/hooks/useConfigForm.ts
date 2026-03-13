import { useState, useCallback } from 'react';
import type { INightWatchConfig } from '../api.js';

export function useConfigForm<T extends Record<string, unknown>>(
  config: INightWatchConfig | null,
  toFormState: (config: INightWatchConfig) => T,
) {
  const [form, setForm] = useState<T | null>(config ? toFormState(config) : null);
  const [initialForm, setInitialForm] = useState<T | null>(config ? toFormState(config) : null);

  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const resetForm = useCallback(() => {
    setForm(initialForm);
  }, [initialForm]);

  const initForm = useCallback((newConfig: INightWatchConfig) => {
    const newForm = toFormState(newConfig);
    setForm(newForm);
    setInitialForm(newForm);
  }, [toFormState]);

  const isDirty = form !== null && initialForm !== null && JSON.stringify(form) !== JSON.stringify(initialForm);

  return { form, updateField, resetForm, initForm, isDirty };
}
