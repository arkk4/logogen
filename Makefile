.PHONY: help setup install-hooks badge bump

help:
	@echo "logogen — deterministic SVG logo & badge generator"
	@echo ""
	@echo "  make setup          Setup git hooks"
	@echo "  make install-hooks  Install pre-push git hook"
	@echo "  make badge          Regenerate public/logo.svg and public/badge.svg"
	@echo "  make bump [V=...]   Bump version, regenerate assets, commit"

setup:
	$(MAKE) install-hooks
	@echo "✓ Setup complete"

install-hooks:
	cp .github/hooks/pre-push .git/hooks/pre-push
	chmod +x .git/hooks/pre-push
	@echo "✓ Pre-push hook installed"

badge:
	@node tools/generate_logo.mjs

bump:
	@node tools/bump.mjs $(V)
