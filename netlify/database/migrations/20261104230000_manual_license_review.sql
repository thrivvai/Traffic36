-- License checks reviewed by the host. Renters upload the front and back of their driver's
-- license and a selfie holding it, and type the details printed on it; the host compares the two
-- and approves or rejects. Stripe Identity stays available behind the ID_CHECK=stripe setting.

ALTER TABLE users
  ADD COLUMN identity_method      text CHECK (identity_method IN ('manual', 'stripe')),
  ADD COLUMN identity_reviewed_by uuid REFERENCES users(id);

-- One row per time a renter sends their license in. Approved values are copied onto users.
CREATE TABLE identity_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'replaced')),
  legal_name         text NOT NULL CHECK (char_length(legal_name) BETWEEN 2 AND 120),
  dob                date NOT NULL,
  license_state      text NOT NULL CHECK (license_state ~ '^[A-Z]{2}$'),
  license_expires_on date NOT NULL,
  review_note        text,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_submissions_user_idx ON identity_submissions (user_id, created_at DESC);
CREATE UNIQUE INDEX identity_submissions_one_pending ON identity_submissions (user_id) WHERE status = 'pending';

-- The photos. Images live in a private Netlify Blobs store; only the host can open them.
CREATE TABLE identity_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES identity_submissions(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('license_front', 'license_back', 'selfie')),
  blob_key      text NOT NULL UNIQUE,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size     integer NOT NULL CHECK (byte_size > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_documents_user_idx ON identity_documents (user_id, created_at DESC);
CREATE INDEX identity_documents_submission_idx ON identity_documents (submission_id);
