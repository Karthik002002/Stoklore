import { IconMoon, IconSun } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
    >
      {theme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </Button>
  )
}
