import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage)
  },
  {
    path: 'signup',
    loadComponent: () => import('./pages/signup/signup.page').then((m) => m.SignupPage)
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./pages/verify-email/verify-email.page').then((m) => m.VerifyEmailPage)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'integrations',
        pathMatch: 'full'
      },
      {
        path: 'overview',
        loadComponent: () => import('./pages/overview/overview.page').then((m) => m.OverviewPage)
      },
      {
        path: 'ai-analytics',
        loadComponent: () => import('./pages/ai-analytics/ai-analytics.page').then((m) => m.AiAnalyticsPage)
      },
      {
        path: 'growth-deck',
        loadComponent: () => import('./pages/growth-deck/growth-deck.page').then((m) => m.GrowthDeckPage)
      },
      {
        path: 'orders',
        loadComponent: () => import('./pages/orders/orders.page').then((m) => m.OrdersPage)
      },
      {
        path: 'catalog',
        loadComponent: () => import('./pages/catalog/catalog.page').then((m) => m.CatalogPage)
      },
      {
        path: 'integrations',
        loadComponent: () => import('./pages/integrations/integrations.page').then((m) => m.IntegrationsPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage)
      }
    ]
  },
  {
    path: 'orders',
    redirectTo: 'dashboard/orders',
    pathMatch: 'full'
  },
  {
    path: 'catalog',
    redirectTo: 'dashboard/catalog',
    pathMatch: 'full'
  },
  {
    path: 'overview',
    redirectTo: 'dashboard/overview',
    pathMatch: 'full'
  },
  {
    path: 'ai-analytics',
    redirectTo: 'dashboard/ai-analytics',
    pathMatch: 'full'
  },
  {
    path: 'growth-deck',
    redirectTo: 'dashboard/growth-deck',
    pathMatch: 'full'
  },
  {
    path: 'integrations',
    redirectTo: 'dashboard/integrations',
    pathMatch: 'full'
  },
  {
    path: 'settings',
    redirectTo: 'dashboard/settings',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
