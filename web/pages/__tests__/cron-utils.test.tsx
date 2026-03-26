import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TEMPLATES,
  cronToHuman,
  detectTemplate,
  getTemplateById,
  getPresetValue,
  isCronEquivalent,
  resolveActiveTemplate,
} from '../../utils/cron';

describe('cron utilities', () => {
  describe('detectTemplate', () => {
    it('detects every built-in template by exact schedule set', () => {
      for (const template of SCHEDULE_TEMPLATES) {
        const detected = detectTemplate(
          template.schedules.executor,
          template.schedules.reviewer,
          template.schedules.qa,
          template.schedules.audit,
          template.schedules.slicer,
          template.schedules.merger,
        );

        expect(detected?.id).toBe(template.id);
      }
    });

    it('returns undefined when only one schedule differs', () => {
      const alwaysOn = SCHEDULE_TEMPLATES.find((tpl) => tpl.id === 'always-on');
      expect(alwaysOn).toBeDefined();

      const detected = detectTemplate(
        alwaysOn!.schedules.executor,
        alwaysOn!.schedules.reviewer,
        alwaysOn!.schedules.qa,
        '15 1 * * *',
        alwaysOn!.schedules.slicer,
        alwaysOn!.schedules.merger,
      );

      expect(detected).toBeUndefined();
    });

    it('matches template when cron values have extra whitespace', () => {
      const detected = detectTemplate(
        '  5   *   * * *  ',
        '25   */3 * * *',
        '45 2,10,18 *  * *',
        '50 3 * *   1',
        '35 */6 * * *',
        '55 */4 * * *',
      );

      expect(detected?.id).toBe('always-on');
    });

    it('detects every built-in template even with uneven whitespace', () => {
      for (const template of SCHEDULE_TEMPLATES) {
        const detected = detectTemplate(
          ` ${template.schedules.executor.replace(/\s+/g, '  ')} `,
          ` ${template.schedules.reviewer.replace(/\s+/g, '   ')} `,
          ` ${template.schedules.qa.replace(/\s+/g, '    ')} `,
          ` ${template.schedules.audit.replace(/\s+/g, '  ')} `,
          ` ${template.schedules.slicer.replace(/\s+/g, '   ')} `,
          ` ${template.schedules.merger.replace(/\s+/g, '  ')} `,
        );

        expect(detected?.id).toBe(template.id);
      }
    });
  });

  describe('getPresetValue', () => {
    it('returns preset for canonical cron value', () => {
      expect(getPresetValue('5 */2 * * *')).toBe('5 */2 * * *');
    });

    it('returns preset for cron value with extra whitespace', () => {
      expect(getPresetValue('  5   */2 * * *  ')).toBe('5 */2 * * *');
    });

    it('returns custom sentinel for unknown schedule', () => {
      expect(getPresetValue('17 1 * * *')).toBe('__custom__');
    });
  });

  describe('resolveActiveTemplate', () => {
    it('uses persisted template id when id exists and schedules match', () => {
      const resolved = resolveActiveTemplate(
        'always-on',
        '5 * * * *',
        '25 */3 * * *',
        '45 2,10,18 * * *',
        '50 3 * * 1',
        '35 */6 * * *',
        '55 */4 * * *',
      );

      expect(resolved?.id).toBe('always-on');
    });

    it('falls back to detection when persisted template id is invalid', () => {
      const resolved = resolveActiveTemplate(
        'unknown-bundle',
        '5 * * * *',
        '25 */3 * * *',
        '45 2,10,18 * * *',
        '50 3 * * 1',
        '35 */6 * * *',
        '55 */4 * * *',
      );

      expect(resolved?.id).toBe('always-on');
    });

    it('does not trust stale persisted template id when schedules no longer match', () => {
      const resolved = resolveActiveTemplate(
        'always-on',
        '17 * * * *',
        '25 */3 * * *',
        '45 2,10,18 * * *',
        '50 3 * * 1',
        '35 */6 * * *',
        '55 */4 * * *',
      );

      expect(resolved).toBeUndefined();
    });
  });

  describe('isCronEquivalent', () => {
    it('returns true for equivalent cron strings with uneven whitespace', () => {
      expect(isCronEquivalent('5 */3 * * *', '  5   */3 * * *  ')).toBe(true);
    });

    it('returns false for different cron strings', () => {
      expect(isCronEquivalent('5 */3 * * *', '10 */3 * * *')).toBe(false);
    });
  });

  describe('getTemplateById', () => {
    it('returns undefined for missing template id', () => {
      expect(getTemplateById('missing')).toBeUndefined();
    });
  });

  describe('cronToHuman', () => {
    it('returns preset label for matching expression with extra whitespace', () => {
      expect(cronToHuman('  5   */2 * * *  ')).toBe('Balanced (recommended)');
    });

    it('formats common interval patterns', () => {
      expect(cronToHuman('0 */2 * * *')).toBe('Every 2 hours');
      expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes');
      expect(cronToHuman('30 */3 * * *')).toBe('Every 3 hours at :30');
    });

    it('formats fixed-minute day and range schedules', () => {
      expect(cronToHuman('45 9 * * 1-5')).toBe('Weekdays at 9:45 AM');
      expect(cronToHuman('30 9-18 * * *')).toBe('Every hour from 9:30 AM to 6:30 PM');
      expect(cronToHuman('30 2,14 * * *')).toBe('At 2:30 AM and 2:30 PM');
    });

    it('handles invalid cron format gracefully', () => {
      expect(cronToHuman('not-a-cron')).toBe('not-a-cron');
    });
  });
});
