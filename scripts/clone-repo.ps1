<#
.SYNOPSIS
    Clones the cloudbeds_dashboard repo into the local Git-Claude folder so it
    can be used with the Claude Code CLI.

.DESCRIPTION
    Target parent folder already exists: C:\Users\Kyle Estocapio\Git-Claude
    This script clones (or, if already cloned, pulls) the repo into that folder.

.USAGE
    Right-click > Run with PowerShell, or from a PowerShell prompt:
        ./clone-repo.ps1
#>

$ErrorActionPreference = "Stop"

# --- Config ---------------------------------------------------------------
$ParentDir = "C:\Users\Kyle Estocapio\Git-Claude"
$RepoName  = "cloudbeds_dashboard"
$RepoUrl   = "https://github.com/stayable/cloudbeds_dashboard.git"
$RepoPath  = Join-Path $ParentDir $RepoName
# -------------------------------------------------------------------------

# Verify git is installed
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is not installed or not on PATH. Install Git for Windows first: https://git-scm.com/download/win"
    exit 1
}

# Ensure parent folder exists
if (-not (Test-Path $ParentDir)) {
    Write-Host "Parent folder not found, creating: $ParentDir"
    New-Item -ItemType Directory -Path $ParentDir | Out-Null
}

if (Test-Path $RepoPath) {
    Write-Host "Repo already exists at: $RepoPath"
    Write-Host "Pulling latest..."
    Set-Location $RepoPath
    git pull
} else {
    Write-Host "Cloning $RepoUrl into $ParentDir ..."
    Set-Location $ParentDir
    git clone $RepoUrl $RepoName
    Set-Location $RepoPath
}

Write-Host ""
Write-Host "Done. Repo is at: $RepoPath"
Write-Host "Next: run start-claude.bat (in the repo root) to pull + launch Claude Code."
