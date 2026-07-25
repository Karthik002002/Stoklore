import { useTitle } from 'react-haiku'

// One place for the "{sub} | StokLore" convention - pages pass just their own name (or nothing,
// on the home page).
export function usePageTitle(sub) {
  useTitle(sub ? `${sub} | StokLore` : 'StokLore')
}
