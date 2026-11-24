import type { Decorator, Preview } from '@storybook/react-vite'
import '../src/design-system/styles.css'
import { applyTheme, themeStore } from '../src/design-system/theme/store'
import { THEMES } from '../src/design-system/tokens/themes'

applyTheme()

// The toolbar picks a preset; the in-story ThemeSelector/Customizer can change it too, so only
// react when the toolbar value itself changes (otherwise every render would undo the customizer).
let lastToolbar: string | undefined
const withTheme: Decorator = (Story, ctx) => {
  const id = ctx.globals.theme as string | undefined
  if (id && id !== lastToolbar) {
    if (lastToolbar !== undefined || id !== themeStore.get().presetId) themeStore.setPreset(id, true)
    lastToolbar = id
  }
  return (
    <div className="min-h-full bg-background p-4 font-sans text-xs text-foreground">
      <Story />
    </div>
  )
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Design-system theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: THEMES.map((t) => ({ value: t.id, title: t.label, right: t.mode })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: themeStore.get().presetId },
  decorators: [withTheme],
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    controls: { expanded: true },
    options: { storySort: { order: ['Introduction', 'Foundations', 'Theme', 'Components', '*'] } },
  },
}

export default preview
