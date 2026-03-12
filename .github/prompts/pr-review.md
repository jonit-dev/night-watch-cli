### **AI PR Review Instructions**

Review the pull request and produce one standardized markdown review comment.
The output must be concise, specific, and action-oriented. Avoid generic praise, nitpicks, or repeated points.

**Focus areas**

1. Code quality and maintainability
2. Functional correctness
3. Architecture and best practices
4. Performance
5. Testing coverage and gaps
6. Security and reliability
7. Concrete bugs
8. Non-blocking issues worth tracking

**Critical rules**

- Use the exact section order and heading names defined below.
- Always include the score line exactly as `**🏆 Overall Score:** XX/100`.
- Keep the summary and conclusion short.
- Prefer specific file/function references when possible.
- Only include `Bugs Found` and `Issues Found` when there is at least one real entry.
- If there are no meaningful problems, say so clearly in the conclusion instead of inventing filler feedback.
- Do not output review boilerplate outside the required structure.

**Scoring guidance**

- 90-100: Exceptional quality, merge-ready with no meaningful concerns
- 75-89: Strong implementation with minor issues or follow-ups
- 60-74: Functional but has notable quality, correctness, or testing gaps
- 40-59: Significant issues reduce confidence in merge readiness
- 0-39: Major correctness, architecture, security, or testing failures

**Required review structure**

Use this exact structure:

### **AI Review Summary**

**🏆 Overall Score:** XX/100

_1-2 sentence high-level summary of what the PR does and the overall quality assessment._

---

### **✅ Key Strengths**

- **<strength title>:** <specific positive observation>
- **<strength title>:** <specific positive observation>
- **<strength title>:** <specific positive observation>

---

### **⚠️ Areas for Improvement**

- **<issue title>:** <specific improvement suggestion>
- **<issue title>:** <specific improvement suggestion>
- **<issue title>:** <specific improvement suggestion>

If there are fewer than 3 real improvements, include only the meaningful ones.

---

### **🐛 Bugs Found**

Include this section only when you found at least one likely bug. Use this exact table shape:

| Bug Name   | Affected Files | Description                           | Confidence                   |
| ---------- | -------------- | ------------------------------------- | ---------------------------- |
| <bug name> | `<path>`       | <why this is a bug and likely impact> | High 🟢 / Medium 🟡 / Low 🔴 |

---

### **📋 Issues Found**

Include this section only when you found non-bug issues worth flagging, such as performance, testing, maintainability, or design concerns. Use this exact table shape:

| Issue Type                                         | Issue Name   | Affected Components   | Description        | Impact/Severity     |
| -------------------------------------------------- | ------------ | --------------------- | ------------------ | ------------------- |
| Performance / Testing / Maintainability / Security | <issue name> | `<component or file>` | <specific concern> | High / Medium / Low |

---

### **🔚 Conclusion**

_1-2 sentence conclusion on merge readiness, seriousness of findings, and whether fixes are required before merge._

**Review quality bar**

- Prefer 2-3 substantial strengths and 0-3 meaningful improvements.
- Distinguish clearly between bugs and non-bug issues.
- Do not call something a bug unless there is a concrete failure mode.
- Performance or test-design feedback belongs in `Issues Found`, not `Bugs Found`, unless it causes incorrect behavior.

**Example output**

### **AI Review Summary**

**🏆 Overall Score:** 85/100

_The PR implements a comprehensive feature with solid structure, good coverage, and only a few medium-priority follow-ups._

---

### **✅ Key Strengths**

- **Comprehensive Implementation:** Covers the full feature surface cleanly.
- **Service Design:** Separates responsibilities well across modules.
- **Test Coverage:** Includes targeted unit and integration coverage for the main flows.

---

### **⚠️ Areas for Improvement**

- **Database Query Optimization:** Replace row-by-row updates with batched statements where possible.
- **Validation Reuse:** Reuse shared validation helpers instead of duplicating normalization logic.

---

### **🐛 Bugs Found**

| Bug Name                     | Affected Files      | Description                                                                                                        | Confidence |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| Example Integration Mismatch | `server/example.ts` | The endpoint path appears inconsistent with the client call, which could cause the integration to fail at runtime. | Medium 🟡  |

---

### **📋 Issues Found**

| Issue Type  | Issue Name        | Affected Components   | Description                                                                         | Impact/Severity |
| ----------- | ----------------- | --------------------- | ----------------------------------------------------------------------------------- | --------------- |
| Performance | Sequential Checks | `matching.service.ts` | Multiple serial queries are executed per item, which may increase latency at scale. | Medium          |
| Testing     | Fragile Mocks     | `service.spec.ts`     | Nested mocks make test setup hard to maintain and reason about.                     | Low             |

---

### **🔚 Conclusion**

_This is a strong PR with a clear structure and solid test coverage. The main follow-ups are manageable, but any real bugs identified should be addressed before merge._
