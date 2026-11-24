import yooOxlintConfigReact from '@yoo-digital/oxlint-config-react';
import yooOxlintConfigVitest from '@yoo-digital/oxlint-config-vitest';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [yooOxlintConfigReact, yooOxlintConfigVitest],
  ignorePatterns: ['examples/react-vite/src/components/ui/**'], // shadcn-generated
});
