# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **NestJS benchmark project** comparing performance between:
1. **Singleton scope** (baseline)
2. **Request scope** (performance bottleneck)
3. **Async Local Storage (nestjs-cls)** (recommended solution)

The goal is to demonstrate Request Scope's overhead (GC pressure, event loop delays) and validate ALS as a superior alternative.

## Package Manager

This project uses **pnpm**. Always use `pnpm` instead of npm or yarn.

```bash
pnpm install
```

## Development Commands

### Build and Run
```bash
# Build the project
pnpm run build

# Development mode with hot reload
pnpm run start:dev

# Debug mode with inspector
pnpm run start:debug

# Production mode
pnpm run start:prod
```

### Testing
```bash
# Run all unit tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run a single test file
pnpm run test -- path/to/test-file.spec.ts

# Run e2e tests
pnpm run test:e2e

# Run tests with coverage
pnpm run test:cov

# Debug tests with inspector
pnpm run test:debug
```

### Code Quality
```bash
# Lint and auto-fix
pnpm run lint

# Format code with Prettier
pnpm run format
```

### Benchmark Commands

```bash
# Start application with Docker (CPU 1.0, Memory 512MB limits)
docker-compose up -d

# Run performance comparison across all endpoints
docker-compose exec app pnpm run benchmark:all

# Profile individual endpoints with Node.js --prof
docker-compose run --rm app pnpm run profile:singleton
docker-compose run --rm app pnpm run profile:request-scope
docker-compose run --rm app pnpm run profile:cls

# Profile all endpoints at once
docker-compose run --rm app pnpm run profile:all

# View generated reports (text files)
cat reports/singleton-profile.txt | head -100
cat reports/request-scope-profile.txt | head -100
cat reports/cls-profile.txt | head -100

# Stop and clean up
docker-compose down
```

## Architecture Overview

### Benchmark Endpoints

**Three endpoint patterns to compare performance:**

1. **`/bench/singleton`** (BenchController)
   - Uses `SingletonLoggerService` (default scope)
   - Controller remains Singleton
   - Best performance - baseline for comparison

2. **`/bench/request-scope`** (BenchRequestScopeController)
   - Uses `RequestScopeLoggerService` with `Scope.REQUEST`
   - **Critical**: Controller is also Request-scoped due to bubbling
   - Both controller and service are recreated per request
   - Demonstrates significant performance degradation

3. **`/bench/cls`** (BenchController)
   - Uses `ClsService` from nestjs-cls
   - Controller and service remain Singleton
   - Provides request context via Async Local Storage
   - Performance nearly identical to Singleton

### NestJS Module System

- **`main.ts`**: Uses **Fastify adapter** (not Express) for better performance. Disables logger to avoid I/O overhead during benchmarking.

- **`app.module.ts`**:
  - Imports `ClsModule.forRoot()` with middleware that generates unique request IDs
  - Registers two separate controllers: `BenchController` (Singleton) and `BenchRequestScopeController` (Request-scoped)
  - Provides both `SingletonLoggerService` and `RequestScopeLoggerService`

### Request Scope Bubbling

**Important architectural detail**: When a controller injects a Request-scoped provider, the controller itself becomes Request-scoped. This is why `BenchRequestScopeController` is separate - it demonstrates the cascading performance impact of Request scope.

### TypeScript Configuration

- **Module system**: Uses `nodenext` module resolution with ES2023 target
- **Decorators**: `experimentalDecorators` and `emitDecoratorMetadata` are required for NestJS dependency injection
- **Strict mode**: Partial strict mode with `strictNullChecks` enabled but `noImplicitAny` disabled

### Testing Structure

- **Unit tests**: Located alongside source files with `.spec.ts` extension in `src/`
- **E2E tests**: Located in `test/` directory with `.e2e-spec.ts` extension
- **Jest config**: Main config in package.json with `rootDir: "src"`, separate config for e2e at `test/jest-e2e.json`
- **Testing utilities**: Use `@nestjs/testing` for creating test modules, `supertest` for HTTP assertions in e2e tests
