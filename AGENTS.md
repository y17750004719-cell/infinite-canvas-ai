# Repository Instructions

## Default Workspace

- The default workspace for coding and verification is `/Volumes/ZO/ZO.DESIGN`.
- Treat this directory as the only normal place to edit files and run local checks unless the user explicitly says otherwise.
- Existing external worktrees, such as `/private/tmp/...`, are not the default working location and must not be used unless the user asks for them.

## Before Making Changes

- Before starting edits, confirm the current workspace with `pwd`.
- Before starting edits, confirm the current branch with `git branch --show-current`.
- Briefly tell the user which directory and branch are active before substantial changes.

## Branch And Worktree Policy

- Do not automatically create a new branch.
- Do not automatically switch branches.
- Do not automatically create a git worktree.
- Do not move work into `/private/tmp/...` or any other alternate directory unless the user explicitly approves it.
- If the current workspace is on `main`, reading, analysis, planning, and explanation are allowed.
- If work would require changing branches, creating a worktree, or doing a git operation that changes the user's workflow, stop and ask first.

## Local Testing Workflow

- Default local verification happens from `/Volumes/ZO/ZO.DESIGN`.
- Use `npm run dev` as the default local startup command unless the user asks for a different command.
- Assume the user will verify changes at `http://localhost:3000` from this workspace.
- When the user says they want to test locally right away, keep the work in `/Volumes/ZO/ZO.DESIGN` so the running project reflects the changes directly.

## If Isolation Is Explicitly Requested

- If the user explicitly requests an isolated branch or worktree, confirm the target branch and the directory they will use for testing.
- Make it clear that changes made in an isolated worktree will not appear in `/Volumes/ZO/ZO.DESIGN` until merged or copied back.
