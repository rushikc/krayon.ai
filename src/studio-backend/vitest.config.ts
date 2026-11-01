import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reportsDirectory: path.resolve(__dirname, "../../tmp/coverage/studio"),
      reporter: ["text", "json-summary", "html"],
    },
  },
});
