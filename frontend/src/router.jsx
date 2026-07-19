import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import App from './App'
import StockDetail from './StockDetail'
import StocksList from './StocksList'

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

const routeTree = rootRoute.addChildren([indexRoute, stockRoute])

export const router = createRouter({ routeTree })
