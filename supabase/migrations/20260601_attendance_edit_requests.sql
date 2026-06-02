CREATE TABLE IF NOT EXISTS attendance_edit_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_log_id   uuid NOT NULL REFERENCES attendance_log(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  proposed_logged_at  timestamptz NOT NULL,
  proposed_notes      text,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
  reviewed_by         uuid REFERENCES profiles(id),
  reviewed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_edit_requests_profile  ON attendance_edit_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_edit_requests_status   ON attendance_edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_log_id   ON attendance_edit_requests(attendance_log_id);

ALTER TABLE attendance_edit_requests ENABLE ROW LEVEL SECURITY;

-- Employee: insert own requests, read own requests
DROP POLICY IF EXISTS "edit_request_insert_own" ON attendance_edit_requests;
CREATE POLICY "edit_request_insert_own" ON attendance_edit_requests
  FOR INSERT WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "edit_request_select" ON attendance_edit_requests;
CREATE POLICY "edit_request_select" ON attendance_edit_requests
  FOR SELECT USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','administration')
    )
  );

-- Admin only: approve/reject (UPDATE)
DROP POLICY IF EXISTS "edit_request_admin_update" ON attendance_edit_requests;
CREATE POLICY "edit_request_admin_update" ON attendance_edit_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
