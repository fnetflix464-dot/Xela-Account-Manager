# Contributing to Xela Account Manager

Thank you for your interest in contributing! Here are some guidelines to help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/Xela-Account-Manager.git`
3. Add upstream remote: `git remote add upstream https://github.com/fnetflix464-dot/Xela-Account-Manager.git`
4. Create a feature branch: `git checkout -b feature/amazing-feature`

## Development Setup

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed setup instructions.

## Code Style

- ES Modules in `src/models`, `src/services`, `src/repositories`, `src/commands`, `src/data`; CommonJS in `public/electron.js` and `public/preload.cjs` (see [ARCHITECTURE.md](./ARCHITECTURE.md) for why the split exists — it's not arbitrary)
- Functional components with React Hooks
- No comments explaining *what* code does — only ones explaining a non-obvious *why* (a hidden constraint, a workaround, something that would surprise a reader)
- Reuse the shared button/panel primitives in `src/index.css` rather than writing new one-off styles; a hardcoded color instead of a `--color-*` variable is usually a bug, not a choice

## Commit Guidelines

- Clear, descriptive commit messages explaining *why*, not just *what*
- Reference issues when applicable: `Fixes #123`
- Keep commits focused on a single feature/fix

## Pull Request Process

1. Run `npm test` and `npm run build` — both must pass
2. Update documentation if the change affects it (README, ARCHITECTURE, this file)
3. Push to your fork
4. Create a Pull Request with a clear description
5. Link related issues
6. Wait for review and feedback

## Areas for Contribution

- Bug fixes
- Feature implementations
- Documentation improvements
- UI/UX enhancements
- Performance optimizations
- Security improvements
- Test coverage

## Security

If you discover a security vulnerability, please report it privately via GitHub's "Report a vulnerability" flow (Security tab on the repo) rather than a public issue or PR.

## Questions?

Open an issue with the `question` label.

Thank you for contributing.
