import { type Response } from 'express';
import { callRow } from '@prairielearn/postgres';

import { ModeSchema, type User } from '../../lib/db-types';

function hasUserAcceptedTerms(user: User): boolean {
  // At the moment, we only have one revision of our terms and conditions, so
  // all we care about is whether the user has accepted the terms at any point.
  // In the future, if we add revisions, we could change this to check for
  // acceptance after the date that the most recent revision went into effect.
  return user.terms_accepted_at !== null;
}

/**
 * Determines whether the user should be redirected to the terms acceptance page.
 * This is the case if the user has not yet accepted the terms and the user is
 * accessing the site in Public mode. We want to avoid prompting for terms
 * acceptance if the user is accessing the site in Exam mode, since they may not
 * have time to read the terms or accept them before the exam starts, or the network
 * may not even allow them to the terms pages.
 *
 * @param user The user to check
 * @param ip The IP address of the request
 * @returns Whether the user should be redirected to the terms acceptance page
 */
export async function shouldRedirectToTermsPage(user: User, ip: string) {
  if (hasUserAcceptedTerms(user)) return false;

  const mode = await callRow('ip_to_mode', [ip, new Date(), user.user_id], ModeSchema);
  return mode === 'Public';
}

/**
 * Redirects the response to the terms acceptance page. If a `redirectUrl` is
 * provided, the original URL will be stored in a cookie and the user will be
 * redirected to the terms page. After accepting the terms, the user will be
 * redirected back to the original URL.
 */
export function redirectToTermsPage(res: Response, redirectUrl?: string): void {
  if (redirectUrl) {
    res.cookie('preTermsUrl', redirectUrl, { maxAge: 1000 * 60 * 60 });
  }
  res.redirect('/pl/terms');
}
