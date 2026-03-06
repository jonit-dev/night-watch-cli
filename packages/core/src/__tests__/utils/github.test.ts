import { describe, it, expect } from 'vitest';
import { extractQaScreenshotUrls } from '../../utils/github.js';

describe('github utils', () => {
  describe('extractQaScreenshotUrls', () => {
    it('extracts screenshot markdown links from qa-artifacts', () => {
      const qaComment = `<!-- night-watch-qa-marker -->
## Night Watch QA Report
![Landing](../blob/feat/checkout/qa-artifacts/landing.png)
![Cart](../blob/feat/checkout/qa-artifacts/cart.png)
`;

      const screenshots = extractQaScreenshotUrls(qaComment, 'acme/shop');

      expect(screenshots).toEqual([
        'https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/landing.png',
        'https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/cart.png',
      ]);
    });

    it('deduplicates screenshot links while preserving order', () => {
      const qaComment = `![One](https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/one.png)
![One duplicate](https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/one.png)
![Two](https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/two.png)`;

      const screenshots = extractQaScreenshotUrls(qaComment, 'acme/shop');

      expect(screenshots).toEqual([
        'https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/one.png',
        'https://github.com/acme/shop/blob/feat/checkout/qa-artifacts/two.png',
      ]);
    });

    it('returns an empty list when no screenshot links exist', () => {
      const screenshots = extractQaScreenshotUrls('QA: No tests needed for this PR');
      expect(screenshots).toEqual([]);
    });
  });
});
