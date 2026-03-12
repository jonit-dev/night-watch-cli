import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function extractWorkflowCustomPrompt(workflow: string): string {
  const marker = 'custom_prompt: ${{ steps.review_prompt.outputs.prompt }}';
  return workflow.includes(marker) ? marker : '';
}

describe('review prompt sync', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'pr-review.yml');
  const promptPath = path.join(repoRoot, '.github', 'prompts', 'pr-review.md');

  it('loads the shared prompt file from the PR review workflow', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf-8');

    expect(workflow).toContain('cat .github/prompts/pr-review.md');
    expect(extractWorkflowCustomPrompt(workflow)).toBe(
      'custom_prompt: ${{ steps.review_prompt.outputs.prompt }}',
    );
  });

  it('keeps the shared prompt file present for the reviewer cron job', () => {
    const prompt = fs.readFileSync(promptPath, 'utf-8');

    expect(prompt).toContain('### **AI PR Review Instructions**');
    expect(prompt).toContain('### **AI Review Summary**');
    expect(prompt).toContain('**🏆 Overall Score:** XX/100');
    expect(prompt).toContain('### **✅ Key Strengths**');
    expect(prompt).toContain('### **⚠️ Areas for Improvement**');
    expect(prompt).toContain('### **🐛 Bugs Found**');
    expect(prompt).toContain('### **📋 Issues Found**');
    expect(prompt).toContain('### **🔚 Conclusion**');
    expect(prompt).toContain('**🏆 Overall Score:** 85/100');
  });
});
