/**
 * Runtime mode.
 *
 * One codebase, two deployments, distinguished only by environment variables:
 *
 *   demo       public showcase. Seeded with a synthetic dataset, uploads and
 *              deletion disabled, no password. Nothing real is ever loaded.
 *
 *   production the operator's own instance. Starts empty, they upload their own
 *              export, and everything sits behind a password.
 *
 * The default is `production` deliberately. If APP_MODE is missing or
 * misspelled the app locks down rather than opening up — a wrong guess should
 * fail closed.
 */

export const APP_MODE = process.env.APP_MODE === 'demo' ? 'demo' : 'production';

export const isDemo = () => APP_MODE === 'demo';
export const isProduction = () => APP_MODE === 'production';

/** Shape handed to the frontend so it can hide controls that would 403 anyway. */
export const publicConfig = () => ({
  mode: APP_MODE,
  uploadsEnabled: isProduction(),
  authRequired: isProduction(),
});
