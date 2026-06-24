# Google Sheets Archive — Setup

Attendance is permanently archived to a Google Spreadsheet via the
`sheets-sync` edge function. Supabase remains the source of truth — if the
Sheets call fails, attendance is still saved locally.

## 1. Create a Google Cloud service account

1. Go to https://console.cloud.google.com/ and create (or select) a project.
2. Enable APIs: **Google Sheets API** and **Google Drive API**
   (https://console.cloud.google.com/apis/library).
3. Open **IAM & Admin → Service Accounts → Create service account**.
   - Name: `attendtrack-sheets`
   - Role: none required.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   Download the JSON file.

## 2. Add the credential to Lovable

The edge function reads the credential from the secret
**`GOOGLE_SERVICE_ACCOUNT_JSON`**. Paste the **entire contents** of the
downloaded JSON file (including the `{ ... }`) as the secret value.

No other env vars are required. The spreadsheet is created automatically
on first export and its ID is persisted in the `app_settings` table
(`key = 'google_sheet_id'`).

## 3. (Optional) Share an existing spreadsheet

If you'd rather archive into a spreadsheet you already own:

1. Open the spreadsheet, click **Share**, and add the service account
   email (`...@...iam.gserviceaccount.com`) as an **Editor**.
2. Insert its ID manually:

   ```sql
   insert into public.app_settings (key, value)
   values ('google_sheet_id', jsonb_build_object('id', 'YOUR_SHEET_ID'))
   on conflict (key) do update set value = excluded.value;
   ```

   Make sure the sheet contains a tab named **`Attendance`** with this
   header row in `A1:I1`:

   ```
   attendance_id | date | student_name | matric_no | course_code | course_name | department | status | marked_at
   ```

## 4. Using it in the app

In the **Dept Admin Dashboard → History** tab:

- **Sync to Google Sheets** — pushes only records that haven't been
  synced yet (recommended for routine use; also runs automatically each
  time you save attendance).
- **Export to Google Sheets** — re-appends every attendance record (use
  if you've reset the spreadsheet or want a full archive copy).

Successful syncs flip `attendance.synced_to_sheets = true` and stamp
`synced_at`, so duplicates aren't appended on the next run.
