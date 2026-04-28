import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/firestore.ts', 'src/adapters/dynamodb.ts', 'src/adapters/redis.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@google-cloud/firestore', '@aws-sdk/client-dynamodb', 'ioredis', 'circuit-breaker-core'],
});
