# Git Recovery & Worktrees Cheatsheet

*Tags: git, recovery, worktrees, commands*

## Worktree Workflow
```bash
# Add worktree for a branch
git worktree add ../feature-branch feature-branch

# List and prune worktrees
git worktree list
git worktree prune
```

## Recovery Commands
```bash
# Find lost commits
git reflog -n 20

# Revert detached state safely
git checkout main
git reset --hard HEAD@{1}
```
