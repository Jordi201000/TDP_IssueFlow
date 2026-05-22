# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the NestJS application, organized by domain modules such as `tickets/`, `projects/`, `auth/`, `comments/`, and `attachments/`. Each module typically keeps its controller, service, module, DTOs in `dto/`, entities in `entities/`, and nearby Jest specs as `*.spec.ts`. Shared cross-cutting code lives in `src/common/` (filters, decorators, interceptors, enums, helpers). Runtime configuration is in `src/config/`. End-to-end tests live in `test/`, and compiled output is generated into `dist/`.

## Build, Test, and Development Commands
Run `npm install` to install dependencies. Start the local database with `docker compose up -d`; PostgreSQL is exposed on `localhost:5433` per `compose.yml`.

Use `npm run start:dev` for local development with file watching, `npm run start` for a plain local run, and `npm run build` to compile TypeScript into `dist/`. Quality checks are `npm run lint` for ESLint auto-fixes, `npm run format` for Prettier, `npm test` for unit/module specs, `npm run test:e2e` for API-level tests, and `npm run test:cov` for coverage output.

## Coding Style & Naming Conventions
Use TypeScript with 2-space indentation, single quotes, and trailing commas, matching `.prettierrc`. Follow NestJS naming patterns: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`, `*.entity.ts`, and `*.spec.ts`. Keep classes and enums in `PascalCase`, properties and methods in `camelCase`, and place validation rules on DTOs instead of controllers. Put business rules in services; keep controllers thin.

## Testing Guidelines
Jest is the test runner for both unit and e2e coverage. Place unit and behavior specs next to the code they exercise under `src/`, and keep e2e coverage in `test/`. When changing a feature, add or update tests for the affected service, DTO validation, and any guards, filters, or interceptors involved. No fixed coverage gate is configured, so maintain or improve coverage for touched modules.

## Commit & Pull Request Guidelines
Recent commits use short, feature-focused summaries such as `add csv logic` and `escalation logic`. Follow that style: one concise line, present tense, and scoped to the change. Pull requests should describe the behavior change, list the commands run (`npm test`, `npm run test:e2e`, etc.), link the relevant task or issue, and include sample requests/responses when API contracts change.

## Security & Configuration Tips
Copy values from `.env.example` for local setup and keep secrets out of version control. Replace the default `JWT_SECRET` outside local development. Preserve the default DB port mapping (`5433`) unless you also update the environment configuration.
