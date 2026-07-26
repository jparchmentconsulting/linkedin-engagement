# Contributing

Thanks for your interest in improving LinkedIn Engagement.

## Getting set up

```bash
git clone https://github.com/jparchmentconsulting/linkedin-engagement.git
cd linkedin-engagement
npm install
npm run dev
```

The app runs against a local SQLite database created on first start. Pipeline runs need your own Apify and Anthropic keys in `.env` (see `.env.example`); everything else works without them.

## Before you open a pull request

- Run `npm run build`. It lints and type-checks as well as building; it must pass clean.
- Keep the scope of a PR to one change. Small PRs get reviewed fast.
- Match the style of the surrounding code, including its comment density. Comments in this codebase explain *why*, not *what*.
- If you change the Prisma schema, include the migration (`npx prisma migrate dev --name your-change`).

## Reporting bugs and requesting features

Use the issue templates. For bugs, the terminal output from `npm run dev` at the moment things went wrong is the single most useful thing you can include: the background worker logs every pipeline failure there.

## A note on scope

This is deliberately a simple, single-user, local-first tool. Features that add servers, accounts, background services, or LinkedIn automation (auto-sending, auto-connecting) are out of scope. Better scoring, better ergonomics, and better data hygiene are very much in scope.
