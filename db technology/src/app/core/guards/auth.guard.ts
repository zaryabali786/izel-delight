import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router      = inject(Router);

  // If authenticated, allow through
  if (authService.isAuthenticated()) {
    return true;
  }

  // Try a silent token refresh before blocking
  const refreshed = await authService.silentRefresh();
  if (refreshed) {
    return true;
  }

  // Not authenticated — redirect to login
  router.navigate(['/login']);
  return false;
};
