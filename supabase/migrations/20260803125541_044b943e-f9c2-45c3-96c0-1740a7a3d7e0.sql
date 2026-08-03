CREATE POLICY "Users manage own face folder"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'faces' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'faces' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins read face photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'faces'
    AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'dept_admin'))
  );