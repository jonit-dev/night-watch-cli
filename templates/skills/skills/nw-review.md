# Skill: nw-review

Run the Night Watch automated PR reviewer on open pull requests.

## When to use

When the user wants to trigger automated code review on Night Watch PRs, or when a PR needs a review score.

## Steps

1. **List open Night Watch PRs**:
   ```
   gh pr list --state open --json number,title,headRefName --jq '.[] | select(.headRefName | startswith("night-watch/"))'
   ```

2. **Run the reviewer** (processes all eligible PRs):
   ```
   night-watch review
   ```

3. **Review a specific PR**:
   ```
   night-watch review --pr <number>
   ```

4. **Check review results**:
   ```
   night-watch logs --type review
   ```

## Notes

- Minimum passing score: 80/100 (configurable via `minReviewScore` in `night-watch.config.json`)
- Failed reviews block auto-merge and trigger webhook notifications
- The reviewer runs automatically on its own cron schedule (`reviewerSchedule` in config)
- Review checks: code quality, test coverage, PR description, acceptance criteria alignment
