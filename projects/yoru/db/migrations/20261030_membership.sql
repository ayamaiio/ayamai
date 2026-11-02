-- Additive cutover. Never infer administrator privileges from registration order.
CREATE TABLE IF NOT EXISTS members (
  user_id text PRIMARY KEY, source text NOT NULL, referred_by text,
  relationship_accepted_at timestamptz, joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS members_referrer_idx ON members(referred_by);
CREATE TABLE IF NOT EXISTS membership_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inviter_id text NOT NULL REFERENCES members(user_id),
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, redeemed_at timestamptz, redeemed_by text UNIQUE
);
CREATE INDEX IF NOT EXISTS membership_invitations_inviter_idx ON membership_invitations(inviter_id);
-- Existing app users are grandfathered. Auth-only legacy identities are resolved
-- using the fixed Clerk creation cutoff by the server on their next sign-in.
INSERT INTO members(user_id, source)
SELECT user_id, 'legacy' FROM (
  SELECT user_id FROM media_items UNION SELECT user_id FROM social_accounts
  UNION SELECT user_id FROM social_profiles UNION SELECT user_id FROM watch_settings
) existing WHERE user_id IS NOT NULL ON CONFLICT DO NOTHING;
