/** Drop secrets from text that might be stored or copied. Matches the client rules. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/rnk_[A-Za-z0-9_-]+/g, 'rnk_[redacted]')
    .replace(/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, '[redacted-token]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
}
