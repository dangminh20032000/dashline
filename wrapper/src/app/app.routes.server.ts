import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // All routes use server-side rendering since we fetch HTML at runtime
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
