// ABOUTME: Global vitest setup — registers custom matchers.
// ABOUTME: Imported by vitest.config.ts setupFiles.
import { expect } from "vitest";
import * as matchers from "vitest-axe/matchers";

expect.extend(matchers);
