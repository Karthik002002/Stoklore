import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import App from './App'
import EventsFeed from './EventsFeed'
import StockDetail from './StockDetail'
import StocksList from './StocksList'
import TopNews from './TopNews'

const rootRoute = createRootRoute({ component: App })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: StocksList,
})

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock/$symbol',
  component: StockDetail,
})

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events',
  component: EventsFeed,
})

const topNewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/top-news',
  component: TopNews,
})

const routeTree = rootRoute.addChildren([indexRoute, stockRoute, eventsRoute, topNewsRoute])

export const router = createRouter({ routeTree })
