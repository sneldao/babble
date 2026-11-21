#!/bin/sh
# Install git hooks for this repo.
cp "$(dirname "$0")/../hooks/pre-commit" "$(git rev-parse --git-dir)/hooks/pre-commit"
chmod +x "$(git rev-parse --git-dir)/hooks/pre-commit"
echo "installed pre-commit hook"
