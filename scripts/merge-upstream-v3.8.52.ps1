# Run in PowerShell (Git repo with a clean worktree):
# pwsh -File ./scripts/merge-upstream-v3.8.52.ps1
# Keeps codex/v3.8.51 unchanged. Stops instead of force-merging.
param([switch]$SkipDependencyInstall)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$branch = "sync/upstream-v3.8.52-from-v3.8.51"
$baseSha = "19971f8b630a79976d88fc834edda0ffc8aa6966"
function Check($description) {
    if ($LASTEXITCODE -ne 0) { throw "$description failed with exit code $LASTEXITCODE." }
}
git rev-parse --show-toplevel | Out-Null; Check "Git repository check"
if (@(git status --porcelain).Count -gt 0) { throw "Working tree must be clean." }
git fetch origin "$branch"; Check "Fetch integration branch"
git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
    git switch "$branch"; Check "Switch to branch"
    git merge --ff-only "origin/$branch"; Check "Fast-forward branch"
} else {
    git switch -c "$branch" --track "origin/$branch"; Check "Track branch"
}
git merge-base --is-ancestor "$baseSha" HEAD; Check "Base ancestry check"
$remote = "omniroute-upstream-sync"
if (@(git remote) -notcontains $remote) {
    git remote add "$remote" "https://github.com/diegosouzapw/OmniRoute.git"; Check "Add upstream"
}
$url = (git remote get-url "$remote").Trim()
if ($url -ne "https://github.com/diegosouzapw/OmniRoute.git") { throw "Unexpected upstream URL: $url" }
git fetch --no-tags "$remote" "release/v3.8.52"; Check "Fetch upstream"
# Git 3-way merge; only conflicting hunks prefer current custom branch.
git merge --no-commit --no-ff -s ort -X ours "$remote/release/v3.8.52"
$mergeCode = $LASTEXITCODE
$unmerged = @(git diff --name-only --diff-filter=U)
if ($mergeCode -ne 0 -or $unmerged.Count -gt 0) {
    $unmerged | Set-Content -Path "OmniRoute-merge-unresolved-paths.txt"
    Write-Warning "Unresolved: $($unmerged.Count) files. No commit/push. Inspect the report and resolve conflicts."
    exit 2
}
git diff --cached --check; Check "Whitespace validation"
git diff --cached --stat
Write-Warning "Carefully review custom adaptive routing semantics before accepting this merge."
node --version; Check "Node"
npm --version; Check "npm"
if (-not $SkipDependencyInstall) { npm ci; Check "Install dependencies" }
npm run test:unit:fast; Check "Unit tests"
npm run build:fast; Check "Production build"
npm run lint; Check "Lint"
git commit -m "merge: sync upstream v3.8.52 preserving adaptive routing"; Check "Commit"
git push origin "$branch"; Check "Push integration branch"
Write-Host "Merge pushed to $branch. Original branch unchanged." -ForegroundColor Green
