import type { StorybookConfig } from '@storybook/react-vite'

// Only the design system is catalogued; app pages are not stories. Vite config (Tailwind plugin,
// the @ alias) is picked up from ../vite.config.ts automatically.
const config: StorybookConfig = {
  stories: ['../src/design-system/**/*.mdx', '../src/design-system/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
}

export default config
